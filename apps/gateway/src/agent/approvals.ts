import { db } from "@easylopster/db";
import { TelegramSender } from "../telegram/api.ts";
import { publishChat } from "./pubsub.ts";

/**
 * Human-in-the-loop approvals for risky node commands (OpenClaw exec approvals, hosted flavour).
 * The run blocks until the owner taps Allow/Deny in Telegram or the web chat, or the request expires.
 */

export const APPROVAL_TTL_MS = 5 * 60_000;
const POLL_MS = 1500;

export type ApprovalChannel =
  | { kind: "telegram"; sender: TelegramSender; chatId: string | number; threadId?: number }
  | { kind: "web"; conversationId: string };

export interface ApprovalRequest {
  botId: string;
  conversationId?: string;
  toolName: string;
  args: Record<string, unknown>;
  target: string;
  /** One-line preview shown to the user (the exact command). */
  preview: string;
  channel: ApprovalChannel;
  /** "node:<nodeId>:<capability>": lets the owner answer "Always allow" for this action on this node. */
  scopeKey?: string;
}

export type ApprovalDecision = "approved" | "denied" | "expired";

export function approvalCallbackData(id: string, decision: "allow" | "always" | "deny") {
  return `apr:${id}:${decision}`;
}

export async function requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
  const row = await db.toolApproval.create({
    data: {
      botId: req.botId,
      conversationId: req.conversationId,
      toolName: req.toolName,
      args: req.args as never,
      target: req.target,
      scopeKey: req.scopeKey,
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    },
  });

  if (req.channel.kind === "telegram") {
    const text = `⚠️ Approval needed\n\n${req.target}\n<pre>${escapeHtml(req.preview.slice(0, 1500))}</pre>\n\nExpires in 5 minutes.`;
    const m = await req.channel.sender.api
      .sendMessage(req.channel.chatId, text, {
        parse_mode: "HTML",
        message_thread_id: req.channel.threadId && req.channel.threadId !== 1 ? req.channel.threadId : undefined,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Allow once", callback_data: approvalCallbackData(row.id, "allow") },
              ...(req.scopeKey ? [{ text: "♾️ Always", callback_data: approvalCallbackData(row.id, "always") }] : []),
              { text: "⛔ Deny", callback_data: approvalCallbackData(row.id, "deny") },
            ],
          ],
        },
      })
      .catch(() => null);
    await db.toolApproval.update({ where: { id: row.id }, data: { channel: { kind: "telegram", chatId: String(req.channel.chatId), messageId: m?.message_id ?? null } } });
  } else {
    await db.toolApproval.update({ where: { id: row.id }, data: { channel: { kind: "web" } } });
    await publishChat(req.channel.conversationId, { type: "approval", id: row.id, target: req.target, preview: req.preview, status: "pending", canAlways: !!req.scopeKey } as never);
  }

  // Poll until decided or expired.
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const cur = await db.toolApproval.findUnique({ where: { id: row.id } });
    if (!cur) return "denied";
    if (cur.status === "approved" || cur.status === "denied") {
      // Web decisions are written straight to the DB by the dashboard; tell the chat UI here.
      if (req.channel.kind === "web") await notifyOutcome(cur.id, cur.status);
      return cur.status;
    }
    if (cur.expiresAt < new Date()) {
      await db.toolApproval.update({ where: { id: row.id }, data: { status: "expired" } }).catch(() => {});
      await notifyOutcome(cur.id, "expired");
      return "expired";
    }
  }
}

/** Called by the Telegram callback handler / web action. Returns false when the id is unknown or already decided. */
export async function decideApproval(id: string, decision: "approved" | "denied", decidedBy: string, always = false): Promise<boolean> {
  const r = await db.toolApproval.updateMany({ where: { id, status: "pending", expiresAt: { gt: new Date() } }, data: { status: decision, decidedBy, decidedAt: new Date() } });
  if (r.count === 0) return false;
  if (decision === "approved" && always) await rememberAlways(id);
  await notifyOutcome(id, decision);
  return true;
}

/** "Always allow": add the capability to the node's autoApprove list so the next call skips the prompt. */
export async function rememberAlways(approvalId: string): Promise<string | null> {
  const row = await db.toolApproval.findUnique({ where: { id: approvalId }, select: { scopeKey: true } });
  const m = row?.scopeKey?.match(/^node:([^:]+):(.+)$/);
  if (!m) return null;
  const node = await db.node.findUnique({ where: { id: m[1]! }, select: { autoApprove: true } });
  if (!node) return null;
  const list = new Set(Array.isArray(node.autoApprove) ? (node.autoApprove as string[]) : []);
  list.add(m[2]!);
  await db.node.update({ where: { id: m[1]! }, data: { autoApprove: [...list] } });
  return m[2]!;
}

async function notifyOutcome(id: string, outcome: ApprovalDecision) {
  const row = await db.toolApproval.findUnique({ where: { id }, include: { bot: true } });
  if (!row) return;
  const ch = row.channel as { kind: string; chatId?: string; messageId?: number | null } | null;
  const label = outcome === "approved" ? "✅ Allowed" : outcome === "denied" ? "⛔ Denied" : "⌛ Expired";
  if (ch?.kind === "telegram" && ch.chatId && ch.messageId) {
    const { decrypt } = await import("@easylopster/shared/crypto");
    const api = new TelegramSender(decrypt(row.bot.encToken)).api;
    await api.editMessageText(ch.chatId, ch.messageId, `${label}\n\n${row.target}\n<pre>${escapeHtml(String((row.args as { command?: string }).command ?? row.toolName).slice(0, 1500))}</pre>`, { parse_mode: "HTML" }).catch(() => {});
  } else if (ch?.kind === "web" && row.conversationId) {
    await publishChat(row.conversationId, { type: "approval", id, status: outcome } as never);
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
