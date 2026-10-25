import { db, type Bot, type ProviderKey } from "@easylopster/db";
import { decrypt } from "@easylopster/shared/crypto";
import type { NodeServer } from "../nodes/server.ts";
import { TelegramSender } from "../telegram/api.ts";
import { runAgent } from "./run.ts";
import { getOrCreateConversation } from "./session.ts";
import { checkQuota } from "./usage.ts";
import { publishChat } from "./pubsub.ts";
import { automationReplyIsSilent, ownerActiveRecently, parseSchedule, recordRun, scheduleSummary } from "./automations.ts";

type BotFull = Bot & { providerKey: ProviderKey | null; user: { id: string; timezone: string } };

const log = (m: string) => console.log(`[automations] ${new Date().toISOString()} ${m}`);

/** Executes one scheduled turn and delivers the reply (OpenClaw "[cron wake]"). */
export async function runAutomationJob(bot: BotFull, automationId: string, nodes: NodeServer): Promise<void> {
  const a = await db.automation.findUnique({ where: { id: automationId } });
  if (!a || a.botId !== bot.id) return;
  const schedule = parseSchedule(a.schedule);
  if (a.idleOnly && (await ownerActiveRecently(bot.id))) {
    await recordRun(a, "skipped", undefined, "owner active");
    return;
  }
  const quota = await checkQuota(bot.userId);
  if (!quota.ok) {
    await recordRun(a, "skipped", undefined, "daily quota reached");
    return;
  }

  const isolated = a.sessionTarget === "isolated";
  const tg = bot.ownerTgChatId && bot.tgBotId !== "0" ? new TelegramSender(decrypt(bot.encToken)) : null;
  // Main session = the owner's Telegram DM when the bot has one, otherwise the owner's web chat.
  const mainKey = tg ? `dm:${bot.id}:main` : `web:${bot.id}:${bot.userId}`;
  const sessionKey = isolated ? `auto:${bot.id}:${a.id}` : mainKey;
  const conversation = await getOrCreateConversation(bot.id, sessionKey, isolated || !tg ? "web" : "dm", { title: isolated ? `Automation: ${a.name}` : undefined, tgChatId: bot.ownerTgChatId ?? undefined });
  const tz = bot.user.timezone || "UTC";
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date());
  const userText = `[easylopster cron wake] Automation "${a.name}" (${schedule ? scheduleSummary(schedule) : "manual"}) fired at ${now} ${tz}.\n${a.prompt}\n\nIf nothing needs the owner's attention, reply with exactly NO_REPLY and nothing else (no other marker, no explanation). Otherwise write only what the owner should read.`;

  try {
    const out = await runAgent({
      bot,
      conversation,
      channel: tg ? "telegram" : "web",
      chatType: "direct",
      userText,
      storedText: `[automation ${a.name}] ${a.prompt}`,
      senderName: "automation",
      nodes,
      approvalChannel: tg ? { kind: "telegram", sender: tg, chatId: bot.ownerTgChatId! } : { kind: "web", conversationId: conversation.id },
    });
    const { silent, text } = automationReplyIsSilent(out.silent ? "" : out.text);
    if (silent) {
      await recordRun(a, "silent", text || undefined);
      log(`${a.name}: silent`);
      return;
    }
    if (a.delivery === "announce" && tg && bot.ownerTgChatId) {
      await tg.sendMarkdown(bot.ownerTgChatId, text);
    } else if (!tg) {
      await publishChat(conversation.id, { type: "final", text, messageId: out.messageId });
    }
    await recordRun(a, "ok", text);
    log(`${a.name}: delivered ${text.length} chars`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordRun(a, "error", undefined, msg);
    log(`${a.name}: error ${msg}`);
  }
}
