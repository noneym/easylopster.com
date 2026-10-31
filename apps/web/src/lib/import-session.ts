import { db } from "@/lib/db";
import type { ImportCategory } from "@/lib/openclaw-import";
import type { CreatedSummary } from "@/lib/openclaw-import-bootstrap";

/** Shapes stored in ImportSession's JSON columns and shown by the import page. */
export interface ImportSessionOptions {
  categories: ImportCategory[];
  memoryMode: "append" | "replace";
  heartbeatAutomation: boolean;
}
export interface ImportManifest {
  entries: { path: string; size: number; category: ImportCategory }[];
  skipped: { path: string; size: number; reason: string }[];
}
export interface ImportProgress {
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
  batchesTotal?: number;
  batchesDone?: number;
}
export interface ImportResult {
  written: { path: string; category: ImportCategory }[];
  skipped: { path: string; reason: string }[];
  heartbeat: "created" | "exists" | "skipped";
}
export type ImportStatus = "waiting" | "scanning" | "uploading" | "done" | "failed" | "expired";
export type ImportMode = "bot" | "new";

export const IMPORT_SESSION_TTL_MS = 60 * 60_000;

/** Session for the uploader script: by token, not expired, with the bot it imports into (null until a "new" import created it). */
export async function sessionByToken(token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const s = await db.importSession.findUnique({ where: { token }, include: { bot: { select: { id: true, name: true, userId: true, user: { select: { timezone: true } } } } } });
  if (!s) return null;
  if (s.expiresAt < new Date() && s.status !== "done" && s.status !== "failed") {
    await db.importSession.update({ where: { id: s.id }, data: { status: "expired" } }).catch(() => {});
    return { ...s, status: "expired" };
  }
  return s;
}

export function publicSession(s: {
  id: string;
  token: string;
  botId: string | null;
  mode: string;
  status: string;
  options: unknown;
  hostname: string | null;
  workspace: string | null;
  manifest: unknown;
  progress: unknown;
  result: unknown;
  created: unknown;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}) {
  return {
    id: s.id,
    token: s.token,
    botId: s.botId,
    mode: s.mode as ImportMode,
    status: s.status as ImportStatus,
    options: s.options as unknown as ImportSessionOptions,
    hostname: s.hostname,
    workspace: s.workspace,
    manifest: (s.manifest ?? null) as ImportManifest | null,
    progress: (s.progress ?? null) as ImportProgress | null,
    result: (s.result ?? null) as ImportResult | null,
    created: (s.created ?? null) as CreatedSummary | null,
    error: s.error,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
  };
}
export type PublicImportSession = ReturnType<typeof publicSession>;
