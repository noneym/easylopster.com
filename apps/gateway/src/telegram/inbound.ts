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
  photo?: unknown;
  document?: { file_name?: string };
  voice?: unknown;
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
        ["/new - Start a new session", "/reset - Reset the current session", "/status - Show current status", "/model [id] - Show or set the model for this chat", "/whoami - Show your sender id", "/stop - Stop the current run"].join("\n"),
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
    default:
      return false;
  }
}

export async function handleTelegramUpdate(bot: BotFull, update: TgUpdate, sessionKey: string, nodes?: NodeServer): Promise<void> {
  if (update.callback_query) {
    await handleCallback(bot, update.callback_query);
    return;
  }
  const m = update.message;
  if (!m) return; // edits, membership changes: later
  if (!m.from || m.from.is_bot) return;
  const token = decrypt(bot.encToken);
  const tg = new TelegramSender(token);
  const chatType: "direct" | "group" = m.chat.type === "private" ? "direct" : "group";
  const sender = m.from;
  const rawText = (m.text ?? m.caption ?? "").trim();
  const bodyText = [rawText, describeNonText(m)].filter(Boolean).join("\n").trim();

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
    if (bot.requireMention && !wasMentioned(bot, m)) return;
  }

  // ── Commands ──
  const cmdMatch = rawText.match(/^\/([a-z0-9_]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i);
  if (cmdMatch) {
    const [, cmd, at, args] = cmdMatch;
    if (at && bot.tgUsername && at.toLowerCase() !== bot.tgUsername.toLowerCase()) return;
    if (await handleCommand(bot, m, cmd!.toLowerCase(), (args ?? "").trim(), sessionKey, tg)) return;
  }
  if (!bodyText) return;

  // ── Quota ──
  const quota = await checkQuota(bot.userId);
  if (!quota.ok) {
    await tg.sendText(m.chat.id, `Daily beta limit reached (${quota.limit} messages). Try again tomorrow.`, { threadId: m.message_thread_id });
    return;
  }

  // ── Run ──
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
      onDelta: draft ? (t) => draft.update(t) : undefined,
    });
    stopTyping();
    if (out.silent || !out.text) {
      await draft?.discard();
      return;
    }
    if (draft) await draft.finish(out.text);
    else await tg.sendMarkdown(m.chat.id, out.text, { threadId: m.message_thread_id, replyTo });
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
