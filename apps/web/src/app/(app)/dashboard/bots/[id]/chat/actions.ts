"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { inboundQueue } from "@/lib/queue";

export async function ensureWebConversation(botId: string) {
  const user = await requireUser();
  const bot = await db.bot.findFirst({ where: { id: botId, userId: user.id }, select: { id: true } });
  if (!bot) throw new Error("Bot not found");
  const sessionKey = `web:${botId}:${user.id}`;
  const conv = await db.conversation.upsert({
    where: { botId_sessionKey: { botId, sessionKey } },
    create: { botId, sessionKey, kind: "web", title: "Web chat" },
    update: {},
  });
  const messages = await db.message.findMany({
    where: { conversationId: conv.id, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, role: true, text: true, createdAt: true, error: true },
  });
  return { conversationId: conv.id, messages: messages.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", text: m.text ?? "", error: m.error })) };
}

/** Messages after a given id (or all). Used as a catch-up when the SSE stream missed the final event. */
export async function listWebMessages(botId: string, conversationId: string, afterId?: string) {
  const user = await requireUser();
  const conv = await db.conversation.findFirst({ where: { id: conversationId, botId, bot: { userId: user.id } }, select: { id: true } });
  if (!conv) return { messages: [] as { id: string; role: "user" | "assistant"; text: string; error: string | null; createdAt: string }[], busy: false };
  const after = afterId ? await db.message.findUnique({ where: { id: afterId }, select: { createdAt: true } }) : null;
  const rows = await db.message.findMany({
    where: { conversationId: conv.id, role: { in: ["user", "assistant"] }, ...(after ? { createdAt: { gt: after.createdAt } } : {}) },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, role: true, text: true, error: true, createdAt: true },
  });
  const last = await db.message.findFirst({ where: { conversationId: conv.id, role: { in: ["user", "assistant"] } }, orderBy: { createdAt: "desc" }, select: { role: true, error: true } });
  return {
    messages: rows.map((m) => ({ id: m.id, role: m.role as "user" | "assistant", text: m.text ?? "", error: m.error, createdAt: m.createdAt.toISOString() })),
    // A run is still in flight when the newest row is the user's message without an error.
    busy: !!last && last.role === "user" && !last.error,
  };
}

export async function sendWebMessage(botId: string, conversationId: string, text: string) {
  const user = await requireUser();
  const parsed = z.string().trim().min(1).max(20_000).safeParse(text);
  if (!parsed.success) return { error: "Message is empty or too long" };
  const conv = await db.conversation.findFirst({ where: { id: conversationId, botId, bot: { userId: user.id } }, select: { id: true, sessionKey: true } });
  if (!conv) return { error: "Conversation not found" };
  await inboundQueue().add("web", {
    botId,
    source: "web",
    sessionKey: conv.sessionKey,
    payload: { text: parsed.data, conversationId: conv.id },
    receivedAt: new Date().toISOString(),
  });
  return { ok: true };
}

export async function decideWebApproval(botId: string, approvalId: string, decision: "approved" | "denied" | "always") {
  const user = await requireUser();
  const row = await db.toolApproval.findFirst({ where: { id: approvalId, botId, bot: { userId: user.id } } });
  if (!row || row.status !== "pending") return { ok: false };
  await db.toolApproval.update({ where: { id: approvalId }, data: { status: decision === "denied" ? "denied" : "approved", decidedBy: "web", decidedAt: new Date() } });
  // "Always allow": remember the capability on the node so the next call skips the prompt.
  const m = decision === "always" ? row.scopeKey?.match(/^node:([^:]+):(.+)$/) : null;
  if (m) {
    const node = await db.node.findFirst({ where: { id: m[1]!, userId: user.id }, select: { autoApprove: true } });
    if (node) {
      const list = new Set(Array.isArray(node.autoApprove) ? (node.autoApprove as string[]) : []);
      list.add(m[2]!);
      await db.node.update({ where: { id: m[1]! }, data: { autoApprove: [...list] } });
    }
  }
  return { ok: true };
}

export async function resetWebConversation(botId: string, conversationId: string) {
  const user = await requireUser();
  const conv = await db.conversation.findFirst({ where: { id: conversationId, botId, bot: { userId: user.id } } });
  if (!conv) return;
  await db.conversation.update({ where: { id: conv.id }, data: { sessionKey: `${conv.sessionKey}#${Date.now().toString(36)}`, archivedAt: new Date() } });
}
