import { db, type Conversation, type Message } from "@easylopster/db";
import type { ModelMessage } from "ai";
import { estimateTokens, historyBudgetTokens, DEFAULT_CONTEXT_WINDOW } from "@easylopster/shared/context";

const COMPACT_AFTER_MESSAGES = 60;
const KEEP_RECENT_ON_COMPACT = 20;

export async function getOrCreateConversation(botId: string, sessionKey: string, kind: "dm" | "group" | "web", meta: { tgChatId?: string; tgThreadId?: string; title?: string } = {}): Promise<Conversation> {
  return db.conversation.upsert({
    where: { botId_sessionKey: { botId, sessionKey } },
    create: { botId, sessionKey, kind, tgChatId: meta.tgChatId, tgThreadId: meta.tgThreadId, title: meta.title },
    update: meta.title ? { title: meta.title } : {},
  });
}

/** /new and /reset: archive the current conversation (sessionKey gets a suffix) so the next message starts fresh. */
export async function archiveConversation(botId: string, sessionKey: string): Promise<boolean> {
  const existing = await db.conversation.findUnique({ where: { botId_sessionKey: { botId, sessionKey } } });
  if (!existing) return false;
  await db.conversation.update({
    where: { id: existing.id },
    data: { sessionKey: `${sessionKey}#${Date.now().toString(36)}`, archivedAt: new Date() },
  });
  return true;
}

/** Converts stored messages into model messages, newest-last, within a token budget derived from the model's context window. */
export async function loadHistory(conversation: Conversation, contextWindow = DEFAULT_CONTEXT_WINDOW): Promise<ModelMessage[]> {
  const budget = historyBudgetTokens(contextWindow);
  const rows = await db.message.findMany({
    where: { conversationId: conversation.id, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: 400,
  });
  const picked: Message[] = [];
  let tokens = 0;
  for (const r of rows) {
    const len = estimateTokens(r.text ?? JSON.stringify(r.content));
    if (tokens + len > budget && picked.length > 2) break;
    tokens += len;
    picked.push(r);
  }
  picked.reverse();

  const out: ModelMessage[] = [];
  if (conversation.summary) {
    out.push({ role: "user", content: `[Earlier conversation summary]\n${conversation.summary}` });
    out.push({ role: "assistant", content: "Understood, I have the earlier context." });
  }
  for (const m of picked) {
    const text = m.text ?? "";
    if (!text.trim()) continue;
    out.push({ role: m.role as "user" | "assistant", content: text });
  }
  return out;
}

export async function saveMessage(conversationId: string, data: Omit<Parameters<typeof db.message.create>[0]["data"], "conversationId" | "conversation">) {
  const row = await db.message.create({ data: { ...data, conversationId } });
  await db.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
  return row;
}

/**
 * Cheap compaction: when a conversation grows past the threshold, fold everything but the most
 * recent messages into the summary using the same model, then delete the folded rows.
 */
export async function maybeCompact(conversation: Conversation, summarize: (text: string) => Promise<string>, force = false, contextWindow = DEFAULT_CONTEXT_WINDOW): Promise<void> {
  const count = await db.message.count({ where: { conversationId: conversation.id } });
  if (!force && count < COMPACT_AFTER_MESSAGES) {
    // Fewer messages than the count threshold, but maybe very long ones: compact when the stored
    // history is past ~70% of what fits in this model's window.
    const recent = await db.message.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "desc" }, take: 400, select: { text: true } });
    const tokens = recent.reduce((n, m) => n + estimateTokens(m.text ?? ""), 0);
    if (tokens < historyBudgetTokens(contextWindow) * 0.7 || count <= KEEP_RECENT_ON_COMPACT + 4) return;
  }
  if (force && count <= 4) return;
  const rows = await db.message.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: "asc" } });
  const old = rows.slice(0, rows.length - (force ? 4 : KEEP_RECENT_ON_COMPACT));
  if (old.length === 0) return;
  const transcript = old.map((m) => `${m.role}: ${m.text ?? ""}`).join("\n").slice(0, 160_000);
  const prior = conversation.summary ? `Previous summary:\n${conversation.summary}\n\n` : "";
  let summary: string;
  try {
    summary = await summarize(`${prior}Conversation to fold in:\n${transcript}`);
  } catch {
    return;
  }
  await db.$transaction([
    db.message.deleteMany({ where: { id: { in: old.map((m) => m.id) } } }),
    db.conversation.update({ where: { id: conversation.id }, data: { summary: summary.slice(0, 20_000), compactedAt: new Date() } }),
  ]);
}

export const SUMMARIZE_INSTRUCTIONS =
  "Summarize the conversation for your own future reference. Preserve: user preferences, decisions, open tasks, names, ids, paths, URLs and exact identifiers. Be dense, use bullet points, no preamble. Max 600 words.";
