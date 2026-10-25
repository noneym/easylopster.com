import { db } from "@easylopster/db";
import type { NodeServer } from "../nodes/server.ts";
import { handleTelegramUpdate } from "../telegram/inbound.ts";
import { runAgent } from "./run.ts";
import { getOrCreateConversation } from "./session.ts";
import { checkQuota } from "./usage.ts";
import { publishChat } from "./pubsub.ts";
import { runAutomationJob } from "./automation-run.ts";

/** Job payload enqueued by the web app (Telegram webhook / web chat). Must match apps/web/src/lib/queue.ts. */
export interface InboundJob {
  botId: string;
  source: "telegram" | "web" | "automation";
  sessionKey: string;
  payload: unknown;
  receivedAt: string;
}

export interface InboundContext {
  nodes: NodeServer;
}

export async function handleInbound(job: InboundJob, _ctx: InboundContext): Promise<void> {
  const bot = await db.bot.findUnique({ where: { id: job.botId }, include: { providerKey: true, user: { select: { id: true, timezone: true } } } });
  if (!bot || bot.status !== "active") return;

  if (job.source === "automation") {
    await runAutomationJob(bot, (job.payload as { automationId: string }).automationId, _ctx.nodes);
    return;
  }

  if (job.source === "telegram") {
    await handleTelegramUpdate(bot, job.payload as never, job.sessionKey, _ctx.nodes);
    return;
  }

  // ── Web chat ──
  const { text, conversationId } = job.payload as { text: string; conversationId: string };
  const conversation = await db.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.botId !== bot.id) return;
  const quota = await checkQuota(bot.userId);
  if (!quota.ok) {
    await publishChat(conversation.id, { type: "error", message: `Daily beta limit reached (${quota.limit} messages).` });
    return;
  }
  try {
    const out = await runAgent({
      bot,
      conversation,
      channel: "web",
      chatType: "direct",
      userText: text,
      storedText: text,
      senderName: "owner",
      nodes: _ctx.nodes,
      approvalChannel: { kind: "web", conversationId: conversation.id },
      onDelta: (t) => void publishChat(conversation.id, { type: "delta", text: t }),
      onTool: (name, status) => void publishChat(conversation.id, { type: "tool", name, status }),
    });
    const finalText = out.media.length ? `${out.text}${out.text ? "\n\n" : ""}${out.media.map((m) => `📎 ${m}`).join("\n")}` : out.text;
    await publishChat(conversation.id, { type: "final", text: finalText, messageId: out.messageId, context: out.context } as never);
  } catch (err) {
    await publishChat(conversation.id, { type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

// Re-exported for the HTTP admin surface (web chat conversation bootstrap).
export { getOrCreateConversation };
