import { db, type Bot, type ProviderKey } from "@easylopster/db";
import { decrypt, pairingCode } from "@easylopster/shared/crypto";
import { TelegramSender } from "./api.ts";
import { runAgent } from "../agent/run.ts";
import { archiveConversation, getOrCreateConversation } from "../agent/session.ts";
import { checkQuota } from "../agent/usage.ts";
import { redis } from "../redis.ts";
import { abortKey } from "../agent/pubsub.ts";
import { decideApproval } from "../agent/approvals.ts";
import type { NodeServer } from "../nodes/server.ts";
import { Workspace } from "../workspace/fs.ts";
import { collectInboundMedia, sendMedia } from "./media.ts";
import { maybeCompact, SUMMARIZE_INSTRUCTIONS } from "../agent/session.ts";
import { generateText } from "ai";
import { resolveModel } from "../agent/providers.ts";

type BotFull = Bot & { providerKey: ProviderKey | null; user: { id: string; timezone: string } };

interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}
interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  is_forum?: boolean;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  message_thread_id?: number;
  entities?: { type: string; offset: number; length: number; user?: TgUser }[];
  reply_to_message?: TgMessage;
  forward_origin?: { type: string; sender_user?: TgUser; sender_user_name?: string; chat?: TgChat; date: number };
  photo?: { file_id: string; file_size?: number; width: number; height: number }[];
  document?: { file_id: string; file_size?: number; mime_type?: string; file_name?: string };
  voice?: { file_id: string; file_size?: number; duration?: number };
  audio?: { file_id: string; file_size?: number; file_name?: string; mime_type?: string };
  video?: { file_id: string; file_size?: number; file_name?: string };
  video_note?: { file_id: string; file_size?: number };
  sticker?: { emoji?: string };
  location?: { latitude: number; longitude: number };
}
interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: unknown;
}

const PAIRING_TTL_MS = 60 * 60 * 1000;
const PAIRING_MAX_PENDING = 3;

const log = (msg: string) => console.log(`[tg] ${new Date().toISOString()} ${msg}`);

function senderLabel(u: TgUser | undefined): string {
  if (!u) return "id:unknown";
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  const at = u.username ? ` (@${u.username})` : "";
  return name ? `${name}${at}` : u.username ? `@${u.username}` : `id:${u.id}`;
}

function stamp(date: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    .format(date)
    .replace(",", "");
}

function describeNonText(m: TgMessage): string {
  const parts: string[] = [];
  if (m.photo) parts.push("[media:image]");
  if (m.document) parts.push(`[media:document ${m.document.file_name ?? ""}]`.trim());
  if (m.voice) parts.push("[media:voice note, transcription not available yet]");
  if (m.sticker) parts.push(`[sticker ${m.sticker.emoji ?? ""}]`.trim());
  if (m.location) parts.push(`[location ${m.location.latitude},${m.location.longitude}]`);
  return parts.join(" ");
}

/** OpenClaw-style envelope: [Telegram <label> <timestamp>] <sender>: <body> */
function envelope(bot: BotFull, m: TgMessage, body: string, chatType: "direct" | "group"): string {
  const tz = bot.user.timezone || "UTC";
  const label =
    chatType === "direct"
      ? `${senderLabel(m.from)} id:${m.from?.id ?? "unknown"}`
      : `${(m.chat.title ?? `group:${m.chat.id}`).replace(/[\[\]]/g, "")} id:${m.chat.id}${m.message_thread_id ? ` topic:${m.message_thread_id}` : ""}`;
  const sender = chatType === "direct" ? senderLabel(m.from) : `${senderLabel(m.from)} (${m.from?.id ?? "unknown"})`;
  let text = body;
  if (m.forward_origin) {
    const from = m.forward_origin.sender_user ? senderLabel(m.forward_origin.sender_user) : m.forward_origin.sender_user_name ?? m.forward_origin.chat?.title ?? "unknown";
    text = `[Forwarded from ${from} at ${new Date(m.forward_origin.date * 1000).toISOString()}]\n${text}`;
  }
  if (m.reply_to_message && (m.reply_to_message.text || m.reply_to_message.caption)) {
    const r = m.reply_to_message;
    text += `\n\n[Reply chain - nearest first]\n[1. ${senderLabel(r.from)} id:${r.message_id} ${new Date(r.date * 1000).toISOString()}]\n${(r.text ?? r.caption ?? "").slice(0, 1500)}\n[/Reply chain]`;
  }
  return `[Telegram ${label} ${stamp(new Date(m.date * 1000), tz)}] ${sender}: ${text}`;
}

function wasMentioned(bot: BotFull, m: TgMessage): boolean {
  const text = m.text ?? m.caption ?? "";
  if (bot.tgUsername && new RegExp(`@${bot.tgUsername}\\b`, "i").test(text)) return true;
  if (m.entities?.some((e) => e.type === "text_mention" && e.user && String(e.user.id) === bot.tgBotId)) return true;
  if (m.reply_to_message?.from && String(m.reply_to_message.from.id) === bot.tgBotId) return true;
  if (/^\/[a-z0-9_]+(@\w+)?(\s|$)/i.test(text)) return true;
  return false;
}

async function isAllowed(botId: string, kind: "user" | "group", tgId: string) {
  const row = await db.botAllowlist.findUnique({ where: { botId_kind_tgId: { botId, kind, tgId } } });
  return !!row;
}

/** Issues (or silently refreshes) a pairing challenge. Returns true when a new code was sent. */
async function pairingChallenge(bot: BotFull, sender: TgSender, m: TgMessage, tg: TelegramSender): Promise<void> {
  const now = new Date();
  const existing = await db.pairingRequest.findFirst({ where: { botId: bot.id, tgUserId: String(sender.id), status: "pending", expiresAt: { gt: now } } });
  if (existing) return; // repeated messages while pending are dropped silently (OpenClaw behaviour)

  const pending = await db.pairingRequest.findMany({ where: { botId: bot.id, status: "pending", expiresAt: { gt: now } }, orderBy: { createdAt: "asc" } });
  if (pending.length >= PAIRING_MAX_PENDING) {
    const drop = pending.slice(0, pending.length - PAIRING_MAX_PENDING + 1);
    await db.pairingRequest.updateMany({ where: { id: { in: drop.map((p) => p.id) } }, data: { status: "expired" } });
  }

  let code = pairingCode(2, 4).replace("-", "");
  for (let i = 0; i < 5; i++) {
    const clash = await db.pairingRequest.findUnique({ where: { botId_code: { botId: bot.id, code } } });
    if (!clash) break;
    code = pairingCode(2, 4).replace("-", "");
  }
  await db.pairingRequest.create({
    data: {
      botId: bot.id,
      tgUserId: String(sender.id),
      tgUsername: sender.username,
      tgName: [sender.first_name, sender.last_name].filter(Boolean).join(" ") || null,
      tgChatId: String(m.chat.id),
      code,
      expiresAt: new Date(now.getTime() + PAIRING_TTL_MS),
    },
  });
  log(`pairing request bot=${bot.id} user=${sender.id}`);
  await tg.sendText(
    m.chat.id,
    `${bot.name}: access not configured.\n\nYour Telegram user id: <code>${sender.id}</code>\nPairing code:\n<pre>${code}</pre>\n\nAsk the bot owner to approve it in the easylopster dashboard (Bots → ${bot.name} → Pairing requests).`,
    { html: true, threadId: m.message_thread_id },
  );
}

type TgSender = TgUser;

async function handleCommand(bot: BotFull, m: TgMessage, cmd: string, args: string, sessionKey: string, tg: TelegramSender): Promise<boolean> {
  const chatId = m.chat.id;
  const opts = { threadId: m.message_thread_id, replyTo: m.message_id };
  switch (cmd) {
    case "start":
      await tg.sendMarkdown(chatId, `Hi, I'm **${bot.agentName || bot.name}**. Send me a message to get started, or /help for commands.`, opts);
      return true;
    case "help":
      await tg.sendMarkdown(
        chatId,
        [
          "/new - Start a new session",
          "/reset - Reset the current session",
          "/status - Show current status",
          "/model [id] - Show or set the model for this chat",
          "/think off|low|medium|high - Thinking level for this chat",
          "/usage - Today's usage",
          "/compact - Compact the session context now",
          "/activation mention|always - Group activation mode",
          "/whoami - Show your sender id",
          "/stop - Stop the current run",
        ].join("\n"),
        opts,
      );
      return true;
    case "whoami":
    case "id":
      await tg.sendText(chatId, `Your id: ${m.from?.id ?? "unknown"}\nChat id: ${chatId}${m.message_thread_id ? `\nTopic id: ${m.message_thread_id}` : ""}`, opts);
      return true;
    case "new":
    case "reset": {
      await redis().set(abortKey(sessionKey), "1", "EX", 30);
      const had = await archiveConversation(bot.id, sessionKey);
      await tg.sendText(chatId, had ? "Started a new session. Earlier history stays searchable in the dashboard." : "Nothing to reset, this is a fresh session.", opts);
      return true;
    }
    case "stop":
      await redis().set(abortKey(sessionKey), "1", "EX", 30);
      await tg.sendText(chatId, "Stopping the current run.", opts);
      return true;
    case "status": {
      const conv = await db.conversation.findUnique({ where: { botId_sessionKey: { botId: bot.id, sessionKey } }, include: { _count: { select: { messages: true } } } });
      const model = conv?.modelOverride || bot.model || bot.providerKey?.defaultModel || "none";
      await tg.sendMarkdown(
        chatId,
        `**${bot.agentName || bot.name}**\nModel: \`${bot.providerKey?.provider ?? "?"}/${model}\`\nThinking: ${bot.thinking}\nSession: \`${sessionKey}\` (${conv?._count.messages ?? 0} messages${conv?.summary ? ", compacted" : ""})\nStreaming: ${bot.streaming}`,
        opts,
      );
      return true;
    }
    case "model": {
      const conv = await db.conversation.findUnique({ where: { botId_sessionKey: { botId: bot.id, sessionKey } } });
      if (!args) {
        await tg.sendMarkdown(chatId, `Current model: \`${conv?.modelOverride || bot.model || bot.providerKey?.defaultModel}\`\nSet one for this chat with /model <id>, or /model default to clear.`, opts);
        return true;
      }
      const c = await getOrCreateConversation(bot.id, sessionKey, m.chat.type === "private" ? "dm" : "group", { tgChatId: String(chatId) });
      const next = args === "default" ? null : args.trim();
      await db.conversation.update({ where: { id: c.id }, data: { modelOverride: next } });
      await tg.sendMarkdown(chatId, next ? `Model for this chat set to \`${next}\`. Use /model default to go back to the bot default.` : `Model override cleared; using the bot default \`${bot.model}\`.`, opts);
      return true;
    }
    case "think":
    case "thinking":
    case "t": {
      const level = args.trim().toLowerCase();
      if (!["off", "low", "medium", "high", "default"].includes(level)) {
        await tg.sendText(chatId, `Usage: /think off|low|medium|high (default = bot setting). Current: ${(await db.conversation.findUnique({ where: { botId_sessionKey: { botId: bot.id, sessionKey } } }))?.thinkingOverride ?? bot.thinking}`, opts);
        return true;
      }
      const c = await getOrCreateConversation(bot.id, sessionKey, m.chat.type === "private" ? "dm" : "group", { tgChatId: String(chatId) });
      await db.conversation.update({ where: { id: c.id }, data: { thinkingOverride: level === "default" ? null : level } });
      await tg.sendText(chatId, `Thinking level for this chat: ${level === "default" ? bot.thinking + " (bot default)" : level}.`, opts);
      return true;
    }
    case "usage": {
      const day = new Date();
      day.setUTCHours(0, 0, 0, 0);
      const rows = await db.usageDaily.findMany({ where: { userId: bot.userId, day } });
      const sum = rows.reduce((a, r) => ({ m: a.m + r.messages, i: a.i + r.tokensIn, o: a.o + r.tokensOut, t: a.t + r.toolCalls }), { m: 0, i: 0, o: 0, t: 0 });
      await tg.sendMarkdown(chatId, `**Today (UTC, all bots)**\nMessages: ${sum.m}\nTokens in/out: ${sum.i} / ${sum.o}\nTool calls: ${sum.t}`, opts);
      return true;
    }
    case "compact": {
      const conv = await db.conversation.findUnique({ where: { botId_sessionKey: { botId: bot.id, sessionKey } } });
      if (!conv || !bot.providerKey) {
        await tg.sendText(chatId, "Nothing to compact.", opts);
        return true;
      }
      const model = resolveModel(bot.providerKey, conv.modelOverride || bot.model || bot.providerKey.defaultModel, "off").model;
      const ok = await maybeCompact(conv, async (t) => (await generateText({ model, system: SUMMARIZE_INSTRUCTIONS + (args ? `\nExtra instructions: ${args}` : ""), prompt: t, maxRetries: 1 })).text, true)
        .then(() => true)
        .catch(() => false);
      await tg.sendText(chatId, ok ? "Session compacted; older turns were folded into a summary." : "Compaction failed or nothing to fold.", opts);
      return true;
    }
    case "activation": {
      if (m.chat.type === "private") {
        await tg.sendText(chatId, "Activation applies to groups only.", opts);
        return true;
      }
      const mode = args.trim().toLowerCase();
      if (!["mention", "always", "default"].includes(mode)) {
        await tg.sendText(chatId, "Usage: /activation mention|always|default", opts);
        return true;
      }
      const c = await getOrCreateConversation(bot.id, sessionKey, "group", { tgChatId: String(chatId) });
      await db.conversation.update({ where: { id: c.id }, data: { activationOverride: mode === "default" ? null : mode } });
      await tg.sendText(chatId, mode === "always" ? "Activation: always-on for this group (session-scoped)." : mode === "mention" ? "Activation: trigger-only (mentions)." : "Activation: bot default.", opts);
      return true;
    }
    default:
      return false;
  }
}

/** Session reset policies (OpenClaw session.reset): daily at a local hour, or after idle minutes. */
async function applyResetPolicy(bot: BotFull, sessionKey: string): Promise<void> {
  if (bot.sessionReset === "none") return;
  const conv = await db.conversation.findUnique({ where: { botId_sessionKey: { botId: bot.id, sessionKey } } });
  if (!conv) return;
  const tz = bot.user.timezone || "UTC";
  const now = new Date();
  let reset = false;
  if (bot.sessionReset === "idle") {
    const last = conv.lastMessageAt ?? conv.startedAt;
    reset = now.getTime() - last.getTime() > bot.resetIdleMinutes * 60_000;
  } else if (bot.sessionReset === "daily") {
    const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now));
    reset = day(conv.startedAt) < day(now) && hour >= bot.resetAtHour;
  }
  if (reset) {
    await archiveConversation(bot.id, sessionKey);
    log(`session reset (${bot.sessionReset}) bot=${bot.id} key=${sessionKey}`);
  }
}

export async function handleTelegramUpdate(bot: BotFull, update: TgUpdate, sessionKey: string, nodes?: NodeServer): Promise<void> {
  if (update.callback_query) {
    await handleCallback(bot, update.callback_query);
    return;
  }
  const edited = !update.message && !!update.edited_message;
  const m = update.message ?? update.edited_message;
  if (!m) return; // membership changes etc.
  if (!m.from || m.from.is_bot) return;
  const token = decrypt(bot.encToken);
  const tg = new TelegramSender(token);
  const chatType: "direct" | "group" = m.chat.type === "private" ? "direct" : "group";
  const sender = m.from;
  const rawText = (m.text ?? m.caption ?? "").trim();
  const ws = new Workspace(bot.userId, bot.id);
  await ws.ensure();
  const media = m.photo || m.document || m.voice || m.audio || m.video || m.video_note || m.sticker ? await collectInboundMedia(tg.api, token, ws, bot.userId, bot.user.timezone || "UTC", m) : { notes: [], images: [] };
  const bodyText = [edited ? "[edited message]" : "", rawText, ...media.notes].filter(Boolean).join("\n").trim();

  // ── Access control ──
  if (chatType === "direct") {
    if (bot.dmPolicy === "disabled") return;
    if (bot.dmPolicy !== "open") {
      const ok = await isAllowed(bot.id, "user", String(sender.id));
      if (!ok) {
        if (bot.dmPolicy === "pairing") await pairingChallenge(bot, sender, m, tg);
        return;
      }
    }
  } else {
    if (bot.groupPolicy === "disabled") return;
    if (bot.groupPolicy === "allowlist" && !(await isAllowed(bot.id, "group", String(m.chat.id)))) return;
    const groupConv = await db.conversation.findUnique({ where: { botId_sessionKey: { botId: bot.id, sessionKey } }, select: { activationOverride: true } });
    const requireMention = groupConv?.activationOverride ? groupConv.activationOverride === "mention" : bot.requireMention;
    if (requireMention && !wasMentioned(bot, m)) {
      // Unaddressed group chatter is recorded as context (history window) but gets no reply.
      if (rawText && !rawText.startsWith("/")) {
        const c = await getOrCreateConversation(bot.id, sessionKey, "group", { tgChatId: String(m.chat.id), tgThreadId: m.message_thread_id ? String(m.message_thread_id) : undefined, title: m.chat.title });
        await db.message.create({ data: { conversationId: c.id, role: "user", content: { text: rawText, unaddressed: true }, text: `${senderLabel(sender)}: ${rawText}`, senderTgId: String(sender.id), senderName: senderLabel(sender), tgMessageId: String(m.message_id) } }).catch(() => {});
      }
      return;
    }
  }

  // ── Commands ──
  const cmdMatch = rawText.match(/^\/([a-z0-9_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i);
  if (cmdMatch) {
    const [, cmd, at, args] = cmdMatch;
    if (at && bot.tgUsername && at.toLowerCase() !== bot.tgUsername.toLowerCase()) return;
    if (await handleCommand(bot, m, cmd!.toLowerCase(), (args ?? "").trim(), sessionKey, tg)) return;
  }
  if (!bodyText) return;

  if (chatType === "direct" && bot.ownerTgChatId !== String(m.chat.id)) {
    // First (or changed) approved DM becomes the delivery target for automations.
    if (!bot.ownerTgChatId) await db.bot.update({ where: { id: bot.id }, data: { ownerTgChatId: String(m.chat.id) } }).catch(() => {});
  }

  // ── Quota ──
  const quota = await checkQuota(bot.userId);
  if (!quota.ok) {
    await tg.sendText(m.chat.id, `Daily beta limit reached (${quota.limit} messages). Try again tomorrow.`, { threadId: m.message_thread_id });
    return;
  }

  // ── Run ──
  await applyResetPolicy(bot, sessionKey);
  if (bot.ackReaction) await tg.react(m.chat.id, m.message_id, bot.ackReaction);
  const conversation = await getOrCreateConversation(bot.id, sessionKey, chatType === "direct" ? "dm" : "group", {
    tgChatId: String(m.chat.id),
    tgThreadId: m.message_thread_id ? String(m.message_thread_id) : undefined,
    title: chatType === "direct" ? senderLabel(sender) : m.chat.title,
  });

  const stopTyping = tg.typing(m.chat.id, m.message_thread_id);
  const replyTo = bot.replyToMode === "off" ? undefined : m.message_id;
  const draft = bot.streaming === "partial" ? tg.draft(m.chat.id, { threadId: m.message_thread_id, replyTo }) : null;

  try {
    const out = await runAgent({
      bot,
      conversation,
      channel: "telegram",
      chatType,
      userText: envelope(bot, m, bodyText.replace(bot.tgUsername ? new RegExp(`@${bot.tgUsername}\\b`, "gi") : /$^/, "").trim() || bodyText, chatType),
      storedText: `${senderLabel(sender)}: ${bodyText}`,
      senderTgId: String(sender.id),
      senderName: senderLabel(sender),
      tgMessageId: String(m.message_id),
      nodes,
      approvalChannel: { kind: "telegram", sender: tg, chatId: m.chat.id, threadId: m.message_thread_id },
      images: media.images,
      onDelta: draft ? (t) => draft.update(t) : undefined,
    });
    stopTyping();
    if (out.silent || (!out.text && out.media.length === 0)) {
      await draft?.discard();
      return;
    }
    if (out.text) {
      if (draft) await draft.finish(out.text);
      else await tg.sendMarkdown(m.chat.id, out.text, { threadId: m.message_thread_id, replyTo });
    } else await draft?.discard();
    if (out.media.length) await sendMedia(tg.api, m.chat.id, ws, out.media, m.message_thread_id);
  } catch (err) {
    stopTyping();
    await draft?.discard();
    const msg = err instanceof Error ? err.message : String(err);
    log(`run failed bot=${bot.id}: ${msg}`);
    await db.bot.update({ where: { id: bot.id }, data: { lastError: msg.slice(0, 1000), lastErrorAt: new Date() } }).catch(() => {});
    await tg.sendText(m.chat.id, `Something went wrong: ${msg.slice(0, 300)}`, { threadId: m.message_thread_id }).catch(() => {});
  }
}

/** Inline-button taps: exec approvals (`apr:<id>:allow|deny`). Only allowlisted senders may decide. */
async function handleCallback(bot: BotFull, cq: TgCallbackQuery): Promise<void> {
  const tg = new TelegramSender(decrypt(bot.encToken));
  const answer = (text: string) => tg.api.answerCallbackQuery(cq.id, { text, show_alert: false }).catch(() => {});
  const data = cq.data ?? "";
  const m = data.match(/^apr:([a-z0-9]+):(allow|deny)$/i);
  if (!m) {
    await answer("Unknown action");
    return;
  }
  const allowed = bot.dmPolicy === "open" || (await isAllowed(bot.id, "user", String(cq.from.id)));
  if (!allowed) {
    await answer("Only the bot owner can decide this.");
    return;
  }
  const ok = await decideApproval(m[1]!, m[2]!.toLowerCase() === "allow" ? "approved" : "denied", String(cq.from.id));
  await answer(ok ? (m[2]!.toLowerCase() === "allow" ? "Allowed" : "Denied") : "Already decided or expired");
}
