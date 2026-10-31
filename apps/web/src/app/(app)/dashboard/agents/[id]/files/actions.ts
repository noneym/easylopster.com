"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { gatewayFetch } from "@/lib/gateway";

export type Entry = { path: string; type: "file" | "dir"; size: number };

async function ownBot(botId: string) {
  const user = await requireUser();
  const bot = await db.bot.findFirst({ where: { id: botId, userId: user.id }, select: { id: true, userId: true } });
  if (!bot) throw new Error("Bot not found");
  return bot;
}

const q = (path: string) => `?path=${encodeURIComponent(path)}`;

export async function wsTree(botId: string): Promise<{ entries: Entry[]; error?: string }> {
  const bot = await ownBot(botId);
  try {
    const r = await gatewayFetch(`/internal/ws/${bot.userId}/${bot.id}/tree${q(".")}&depth=6`);
    if (!r.ok) return { entries: [], error: `Gateway answered ${r.status}` };
    return { entries: ((await r.json()) as { entries: Entry[] }).entries };
  } catch (err) {
    return { entries: [], error: `Gateway unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function wsRead(botId: string, path: string): Promise<{ content?: string; size?: number; mtime?: string; error?: string }> {
  const bot = await ownBot(botId);
  const r = await gatewayFetch(`/internal/ws/${bot.userId}/${bot.id}/file${q(path)}`);
  const j = (await r.json()) as { content?: string; size?: number; mtime?: string; error?: string };
  return r.ok ? j : { error: j.error ?? `Gateway answered ${r.status}` };
}

export async function wsWrite(botId: string, path: string, content: string): Promise<{ ok?: boolean; error?: string }> {
  const bot = await ownBot(botId);
  if (!/^[\w./ -]+$/.test(path) || path.includes("..")) return { error: "Invalid path" };
  const r = await gatewayFetch(`/internal/ws/${bot.userId}/${bot.id}/file${q(path)}`, { method: "PUT", body: content, headers: { "content-type": "text/plain; charset=utf-8" } });
  const j = (await r.json()) as { ok?: boolean; error?: string };
  return r.ok ? j : { error: j.error ?? `Gateway answered ${r.status}` };
}

export async function wsDelete(botId: string, path: string): Promise<{ ok?: boolean; error?: string }> {
  const bot = await ownBot(botId);
  const r = await gatewayFetch(`/internal/ws/${bot.userId}/${bot.id}/file${q(path)}`, { method: "DELETE" });
  const j = (await r.json()) as { ok?: boolean; error?: string };
  return r.ok ? j : { error: j.error ?? `Gateway answered ${r.status}` };
}

export async function wsMkdir(botId: string, path: string): Promise<{ ok?: boolean; error?: string }> {
  const bot = await ownBot(botId);
  const r = await gatewayFetch(`/internal/ws/${bot.userId}/${bot.id}/mkdir${q(path)}`, { method: "POST" });
  const j = (await r.json()) as { ok?: boolean; error?: string };
  return r.ok ? j : { error: j.error ?? `Gateway answered ${r.status}` };
}
