"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { gatewayFetch } from "@/lib/gateway";
import { credsOf, deleteObject, presignGet } from "@/lib/storage";

export type BackupFormState = { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string> } | undefined;

const schema = z.object({
  botId: z.string().min(1),
  enabled: z.string().optional(),
  kind: z.enum(["daily", "hours", "weekly"]),
  time: z.string().regex(/^\d{2}:\d{2}$/, "HH:MM").default("03:00"),
  hours: z.coerce.number().int().min(1).max(168).default(6),
  weekday: z.coerce.number().int().min(0).max(6).default(0),
  retentionDays: z.coerce.number().int().min(1).max(3650).optional().or(z.literal("")),
  keepLast: z.coerce.number().int().min(0).max(1000).default(3),
  includeConversations: z.string().optional(),
  includeInbox: z.string().optional(),
});

async function ownBot(userId: string, botId: string) {
  return db.bot.findFirst({ where: { id: botId, userId }, select: { id: true, user: { select: { timezone: true } } } });
}

/** Creates or updates the agent's backup schedule. */
export async function saveBackupPolicy(_prev: BackupFormState, formData: FormData): Promise<BackupFormState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fe: Record<string, string> = {};
    for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
    return { fieldErrors: fe };
  }
  const d = parsed.data;
  const bot = await ownBot(user.id, d.botId);
  if (!bot) return { error: "Agent not found" };
  const storage = await db.storageConfig.findUnique({ where: { userId: user.id }, select: { id: true } });
  if (!storage && d.enabled === "on") return { error: "Connect your storage first (Storage page); backups are written there." };
  const tz = bot.user.timezone || "UTC";
  const [hh, mm] = d.time.split(":").map(Number);
  const schedule = d.kind === "hours" ? { kind: "every", everyMs: d.hours * 3_600_000 } : d.kind === "daily" ? { kind: "cron", expr: `${mm} ${hh} * * *`, tz } : { kind: "cron", expr: `${mm} ${hh} * * ${d.weekday}`, tz };
  const data = {
    enabled: d.enabled === "on",
    schedule,
    retentionDays: d.retentionDays === "" || d.retentionDays == null ? null : d.retentionDays,
    keepLast: d.keepLast,
    includeConversations: d.includeConversations === "on",
    includeInbox: d.includeInbox === "on",
    nextRunAt: null,
  };
  await db.backupPolicy.upsert({ where: { botId: bot.id }, create: { botId: bot.id, ...data }, update: data });
  revalidatePath(`/dashboard/agents/${bot.id}/backups`);
  return { ok: true, message: data.enabled ? "Schedule saved." : "Schedule saved (paused)." };
}

export async function backupNow(botId: string): Promise<{ ok?: boolean; error?: string; bytes?: number; files?: number }> {
  const user = await requireUser();
  const bot = await ownBot(user.id, botId);
  if (!bot) return { error: "Agent not found" };
  const r = await gatewayFetch("/internal/backup/run", { method: "POST", body: JSON.stringify({ botId }), headers: { "content-type": "application/json" }, timeoutMs: 110_000 }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }) as unknown as Response);
  const j = (await r.json().catch(() => ({}))) as { error?: string; bytes?: number; manifest?: { files?: number } };
  if (!r.ok) return { error: j.error ?? `gateway ${r.status}` };
  revalidatePath(`/dashboard/agents/${botId}/backups`);
  return { ok: true, bytes: j.bytes, files: j.manifest?.files };
}

export async function restoreBackupAction(backupId: string, settings: boolean): Promise<{ ok?: boolean; error?: string; files?: number }> {
  const user = await requireUser();
  const row = await db.backup.findFirst({ where: { id: backupId, userId: user.id } });
  if (!row) return { error: "Backup not found" };
  const r = await gatewayFetch("/internal/backup/restore", { method: "POST", body: JSON.stringify({ backupId, settings }), headers: { "content-type": "application/json" }, timeoutMs: 110_000 }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }) as unknown as Response);
  const j = (await r.json().catch(() => ({}))) as { error?: string; files?: number };
  if (!r.ok) return { error: j.error ?? `gateway ${r.status}` };
  revalidatePath(`/dashboard/agents/${row.botId}`);
  revalidatePath(`/dashboard/agents/${row.botId}/files`);
  return { ok: true, files: j.files };
}

export async function deleteBackupAction(backupId: string): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  const row = await db.backup.findFirst({ where: { id: backupId, userId: user.id } });
  if (!row) return { error: "Backup not found" };
  const cfg = await db.storageConfig.findUnique({ where: { userId: user.id } });
  if (cfg) {
    const c = credsOf(cfg);
    await deleteObject(c, row.key.slice(c.prefix.length)).catch(() => {});
  }
  await db.backup.delete({ where: { id: row.id } });
  revalidatePath(`/dashboard/agents/${row.botId}/backups`);
  return { ok: true };
}

export async function backupDownloadUrl(backupId: string): Promise<{ url?: string; error?: string }> {
  const user = await requireUser();
  const row = await db.backup.findFirst({ where: { id: backupId, userId: user.id } });
  const cfg = await db.storageConfig.findUnique({ where: { userId: user.id } });
  if (!row || !cfg) return { error: "Backup or storage not found" };
  const c = credsOf(cfg);
  try {
    return { url: await presignGet(c, row.key.slice(c.prefix.length), { download: true, expiresIn: 600 }) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
