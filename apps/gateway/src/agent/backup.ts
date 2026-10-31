/**
 * Scheduled and manual backups of an agent into the owner's storage (their S3 bucket):
 * a zip with the workspace (persona, memory, skills, scripts; inbox optional), settings.json
 * (agent row without secrets, automations, allowlist, intents, linked MCP servers and nodes) and,
 * optionally, the conversations as JSON. Retention runs after every backup. Restore unpacks a
 * zip back into the workspace (and optionally re-applies the settings).
 */
import { ZipArchive } from "archiver";
import AdmZip from "adm-zip";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { db } from "@easylopster/db";
import { APP_VERSION } from "@easylopster/shared/version";
import { botScope } from "../account-scope.ts";
import { Workspace } from "../workspace/fs.ts";
import { nextRun, parseSchedule } from "./automations.ts";
import { storageDelete, storageFor, storageGet, storagePut, type StorageCreds } from "./storage.ts";

const log = (m: string) => console.log(`[backup] ${new Date().toISOString()} ${m}`);
const TICK_MS = 60_000;
const SKIP_DIRS = new Set([".git", "node_modules", ".cache", ".trash"]);
const MAX_FILE_BYTES = 200 * 1024 * 1024;

export interface BackupManifest {
  version: string;
  botId: string;
  botName: string;
  createdAt: string;
  files: number;
  bytes: number;
  conversations: number;
  includeInbox: boolean;
  settings: true;
}

async function* walk(root: string, rel = "", includeInbox = true): AsyncGenerator<{ rel: string; abs: string; size: number }> {
  let ents: import("node:fs").Dirent[] = [];
  try {
    ents = await readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of ents) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (!includeInbox && r === "inbox") continue;
      yield* walk(root, r, includeInbox);
    } else if (e.isFile()) {
      const s = await stat(path.join(root, r)).catch(() => null);
      if (!s || s.size > MAX_FILE_BYTES) continue;
      yield { rel: r, abs: path.join(root, r), size: s.size };
    }
  }
}

/** Everything about the agent that is not a file: for settings.json inside the archive (no secret values). */
async function exportSettings(botId: string) {
  const bot = await db.bot.findUnique({
    where: { id: botId },
    include: { automations: true, allowlist: true, intents: true, mcps: { include: { mcpServer: { select: { name: true, url: true } } } }, nodes: { include: { node: { select: { name: true } } } }, secrets: { include: { secret: { select: { name: true } } } }, providerKey: { select: { label: true, provider: true, defaultModel: true } } },
  });
  if (!bot) throw new Error("agent not found");
  const { encToken: _t, webhookSecret: _w, ...rest } = bot as typeof bot & { encToken?: unknown; webhookSecret?: unknown };
  void _t;
  void _w;
  return {
    ...rest,
    mcps: bot.mcps.map((m) => ({ serverName: m.mcpServer.name, url: m.mcpServer.url, ...(m as object) })),
    nodes: bot.nodes.map((n) => ({ nodeName: n.node.name, ...(n as object) })),
    secrets: bot.secrets.map((s) => ({ name: s.secret.name })),
  };
}

async function exportConversations(botId: string) {
  const convs = await db.conversation.findMany({ where: { botId }, include: { messages: { orderBy: { createdAt: "asc" }, select: { role: true, text: true, createdAt: true, model: true } } }, orderBy: { createdAt: "asc" } });
  return convs.map((c) => ({ id: c.id, sessionKey: c.sessionKey, title: c.title, createdAt: c.createdAt, messages: c.messages }));
}

async function buildZip(ws: Workspace, botId: string, botName: string, opts: { includeInbox: boolean; includeConversations: boolean }): Promise<{ buf: Buffer; manifest: BackupManifest }> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    out.on("end", () => resolve());
    archive.on("error", reject);
  });
  archive.pipe(out);
  let files = 0;
  let bytes = 0;
  for await (const f of walk(ws.root, "", opts.includeInbox)) {
    archive.file(f.abs, { name: `workspace/${f.rel}` });
    files++;
    bytes += f.size;
  }
  const settings = await exportSettings(botId);
  archive.append(JSON.stringify(settings, null, 2), { name: "settings.json" });
  let conversations = 0;
  if (opts.includeConversations) {
    const convs = await exportConversations(botId);
    conversations = convs.length;
    archive.append(JSON.stringify(convs, null, 2), { name: "conversations.json" });
  }
  const manifest: BackupManifest = { version: APP_VERSION, botId, botName, createdAt: new Date().toISOString(), files, bytes, conversations, includeInbox: opts.includeInbox, settings: true };
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });
  await archive.finalize();
  await done;
  return { buf: Buffer.concat(chunks), manifest };
}

export function backupKey(botId: string, when: Date) {
  return `backups/${botId}/${when.toISOString().replace(/[:.]/g, "-")}.zip`;
}

/** One backup of one agent into the owner's storage; records it and applies retention. */
export async function runBackup(botId: string, trigger: "scheduled" | "manual"): Promise<{ id: string; key: string; bytes: number; manifest: BackupManifest }> {
  const bot = await db.bot.findUnique({ where: { id: botId }, select: { id: true, name: true, userId: true } });
  if (!bot) throw new Error("agent not found");
  const creds = await storageFor(bot.userId);
  if (!creds) throw new Error("No storage connected; connect your S3 bucket on the Storage page first.");
  const policy = await db.backupPolicy.findUnique({ where: { botId } });
  const ws = new Workspace(bot.userId, bot.id);
  const { buf, manifest } = await buildZip(ws, bot.id, bot.name, { includeInbox: policy?.includeInbox ?? false, includeConversations: policy?.includeConversations ?? false });
  const when = new Date();
  const key = backupKey(bot.id, when);
  await storagePut(creds, key, buf, "application/zip");
  const row = await db.backup.create({ data: { botId: bot.id, userId: bot.userId, key: creds.prefix + key, bytes: buf.length, manifest: manifest as never, trigger, createdAt: when } });
  log(`${trigger} backup bot=${bot.id} ${manifest.files} files ${buf.length} bytes -> ${key}`);
  if (policy) await applyRetention(bot.id, creds, policy.retentionDays, policy.keepLast);
  return { id: row.id, key: row.key, bytes: buf.length, manifest };
}

/** Deletes backups older than retentionDays, always keeping the newest keepLast. */
export async function applyRetention(botId: string, creds: StorageCreds, retentionDays: number | null, keepLast: number) {
  const rows = await db.backup.findMany({ where: { botId }, orderBy: { createdAt: "desc" } });
  const cutoff = retentionDays ? Date.now() - retentionDays * 86_400_000 : null;
  const victims = rows.filter((r, i) => i >= Math.max(keepLast, 0) && cutoff != null && r.createdAt.getTime() < cutoff);
  for (const v of victims) {
    await storageDelete(creds, v.key.slice(creds.prefix.length)).catch((err) => log(`retention delete failed ${v.key}: ${(err as Error).message}`));
    await db.backup.delete({ where: { id: v.id } }).catch(() => {});
  }
  if (victims.length) log(`retention bot=${botId} removed ${victims.length}`);
}

export async function deleteBackup(backupId: string) {
  const row = await db.backup.findUnique({ where: { id: backupId } });
  if (!row) return;
  const creds = await storageFor(row.userId);
  if (creds) await storageDelete(creds, row.key.slice(creds.prefix.length)).catch((err) => log(`delete failed ${row.key}: ${(err as Error).message}`));
  await db.backup.delete({ where: { id: row.id } });
}

/** Unpacks a backup's workspace/ back into the agent's workspace (overwriting files); optionally re-applies settings.json. */
export async function restoreBackup(backupId: string, opts: { settings: boolean }): Promise<{ files: number; settings: boolean }> {
  const row = await db.backup.findUnique({ where: { id: backupId }, include: { bot: { select: { id: true, userId: true } } } });
  if (!row) throw new Error("backup not found");
  const creds = await storageFor(row.userId);
  if (!creds) throw new Error("No storage connected");
  const buf = await storageGet(creds, row.key.slice(creds.prefix.length));
  const zip = new AdmZip(buf);
  const ws = new Workspace(row.bot.userId, row.bot.id);
  await ws.ensure();
  let files = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith("workspace/")) continue;
    const rel = entry.entryName.slice("workspace/".length);
    if (!rel || rel.split("/").some((s) => s === "..")) continue;
    const abs = ws.resolve(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, entry.getData());
    files++;
  }
  let settingsApplied = false;
  if (opts.settings) {
    const e = zip.getEntry("settings.json");
    if (e) {
      const s = JSON.parse(e.getData().toString("utf8")) as Record<string, unknown>;
      const pick = (k: string) => (k in s ? (s[k] as never) : undefined);
      await db.bot.update({
        where: { id: row.bot.id },
        data: {
          name: pick("name"),
          agentName: pick("agentName"),
          model: pick("model"),
          thinking: pick("thinking"),
          temperature: pick("temperature"),
          systemPrompt: pick("systemPrompt"),
          userProfile: pick("userProfile"),
          dmPolicy: pick("dmPolicy"),
          groupPolicy: pick("groupPolicy"),
          requireMention: pick("requireMention"),
          streaming: pick("streaming"),
          replyToMode: pick("replyToMode"),
          toolPolicy: pick("toolPolicy"),
          sessionReset: pick("sessionReset"),
          resetAtHour: pick("resetAtHour"),
          resetIdleMinutes: pick("resetIdleMinutes"),
          ackReaction: pick("ackReaction"),
          dreaming: pick("dreaming"),
        },
      });
      const autos = Array.isArray(s.automations) ? (s.automations as Record<string, unknown>[]) : [];
      for (const a of autos) {
        const name = String(a.name ?? "");
        if (!name) continue;
        const exists = await db.automation.findFirst({ where: { botId: row.bot.id, name } });
        const data = { name, enabled: !!a.enabled, schedule: a.schedule as never, prompt: String(a.prompt ?? ""), sessionTarget: String(a.sessionTarget ?? "main"), idleOnly: !!a.idleOnly, createdBy: String(a.createdBy ?? "owner") };
        if (exists) await db.automation.update({ where: { id: exists.id }, data });
        else await db.automation.create({ data: { botId: row.bot.id, ...data } });
      }
      settingsApplied = true;
    }
  }
  log(`restore bot=${row.bot.id} from ${row.key}: ${files} files${settingsApplied ? " + settings" : ""}`);
  return { files, settings: settingsApplied };
}

/** Runs due backup policies; like the automation scheduler, one tick a minute. */
export function startBackupScheduler(): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = new Date();
      const due = await db.backupPolicy.findMany({
        where: { enabled: true, OR: [{ nextRunAt: { lte: now } }, { nextRunAt: null }], bot: { ...botScope() } },
        include: { bot: { select: { id: true, user: { select: { timezone: true } } } } },
        take: 20,
      });
      for (const p of due) {
        const schedule = parseSchedule(p.schedule);
        const tz = p.bot.user.timezone || "UTC";
        if (!schedule) {
          await db.backupPolicy.update({ where: { id: p.id }, data: { enabled: false, lastStatus: "error", lastError: "invalid schedule" } });
          continue;
        }
        if (p.nextRunAt == null) {
          const next = nextRun(schedule, now, tz);
          await db.backupPolicy.update({ where: { id: p.id }, data: next ? { nextRunAt: next } : { enabled: false, lastStatus: "error", lastError: "schedule is in the past" } });
          continue;
        }
        const next = schedule.kind === "at" ? null : nextRun(schedule, now, tz);
        await db.backupPolicy.update({ where: { id: p.id }, data: { lastStatus: "running", nextRunAt: next, lastRunAt: now } });
        try {
          await runBackup(p.botId, "scheduled");
          await db.backupPolicy.update({ where: { id: p.id }, data: { lastStatus: "ok", lastError: null } });
        } catch (err) {
          await db.backupPolicy.update({ where: { id: p.id }, data: { lastStatus: "error", lastError: (err as Error).message.slice(0, 1000) } });
          log(`scheduled backup failed bot=${p.botId}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      log(`tick error: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const t = setInterval(() => void tick(), TICK_MS);
  return () => clearInterval(t);
}
