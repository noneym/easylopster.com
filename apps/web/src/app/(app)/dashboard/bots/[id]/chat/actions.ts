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

export async function resetWebConversation(botId: string, conversationId: string) {
  const user = await requireUser();
  const conv = await db.conversation.findFirst({ where: { id: conversationId, botId, bot: { userId: user.id } } });
  if (!conv) return;
  await db.conversation.update({ where: { id: conv.id }, data: { sessionKey: `${conv.sessionKey}#${Date.now().toString(36)}`, archivedAt: new Date() } });
}
