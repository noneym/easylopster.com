import { db } from "@/lib/db";
import { gatewayFetch } from "@/lib/gateway";
import { classify, MAX_FILE_BYTES, type ImportCategory } from "@/lib/openclaw-import";

/**
 * Writes one batch of OpenClaw workspace files into a bot's cloud workspace. Shared by the browser
 * import (folder picker) and the remote import (uploader script on the OpenClaw machine).
 */
export interface ApplyOptions {
  categories: ImportCategory[];
  memoryMode: "append" | "replace";
  heartbeatAutomation: boolean;
  /** Large imports arrive in sequential batches; the summary note is written with the last one. */
  batch: { index: number; total: number; totalFiles: number };
}

export interface ApplyResult {
  written: { path: string; category: ImportCategory }[];
  skipped: { path: string; reason: string }[];
  heartbeat: "created" | "exists" | "skipped";
}

export const HEARTBEAT_IMPORT_PROMPT =
  "Proactive check. Read HEARTBEAT.md in your workspace with fs_read and follow it exactly; it is the owner's checklist for this run. Also review your memory notes and anything time-sensitive. Recurring tasks are automations; create or change their schedules with the automations tool. If nothing needs attention, reply NO_REPLY.";

const q = (path: string) => `?path=${encodeURIComponent(path)}`;

export function parseApplyOptions(raw: Partial<ApplyOptions> | null | undefined): ApplyOptions {
  const r = raw ?? {};
  return {
    categories: Array.isArray(r.categories) ? (r.categories as ImportCategory[]) : ["persona", "memory", "heartbeat", "skills", "other"],
    memoryMode: r.memoryMode === "replace" ? "replace" : "append",
    heartbeatAutomation: !!r.heartbeatAutomation,
    batch: r.batch && typeof r.batch === "object" ? { index: Number(r.batch.index ?? 0), total: Number(r.batch.total ?? 1), totalFiles: Number(r.batch.totalFiles ?? 0) } : { index: 0, total: 1, totalFiles: 0 },
  };
}

export async function applyImportBatch(
  bot: { id: string; userId: string; timezone: string },
  files: { path: string; data: Buffer }[],
  options: ApplyOptions,
): Promise<ApplyResult> {
  const wanted = new Set(options.categories);
  const written: ApplyResult["written"] = [];
  const skipped: ApplyResult["skipped"] = [];
  const persona: Record<string, string> = {};
  let hadHeartbeat = false;
  const base = `/internal/ws/${bot.userId}/${bot.id}`;
  const put = async (path: string, content: string) => {
    const r = await gatewayFetch(`${base}/file${q(path)}`, { method: "PUT", body: content, headers: { "content-type": "text/plain; charset=utf-8" }, timeoutMs: 15_000 });
    if (!r.ok) throw new Error(`gateway ${r.status} for ${path}`);
  };
  const read = async (path: string): Promise<string | null> => {
    const r = await gatewayFetch(`${base}/file${q(path)}`, { timeoutMs: 15_000 }).catch(() => null);
    if (!r || !r.ok) return null;
    const j = (await r.json()) as { content?: string };
    return j.content ?? null;
  };

  try {
    for (const f of files) {
      const path = f.path.replace(/\\/g, "/").replace(/^\.?\/+/, "");
      if (!path || path.split("/").some((seg) => seg === "..")) {
        skipped.push({ path, reason: "invalid path" });
        continue;
      }
      const c = classify(path, f.data.length);
      if (!c.entry) {
        skipped.push({ path, reason: c.skipped?.reason ?? "not importable" });
        continue;
      }
      if (!wanted.has(c.entry.category)) {
        skipped.push({ path, reason: "category not selected" });
        continue;
      }
      if (f.data.length > MAX_FILE_BYTES) {
        skipped.push({ path, reason: "too large" });
        continue;
      }
      if (f.data.includes(0)) {
        skipped.push({ path, reason: "binary content" });
        continue;
      }
      const text = f.data.toString("utf8");
      if (path === "MEMORY.md" && options.memoryMode === "append") {
        const existing = (await read("MEMORY.md"))?.trim();
        const merged = existing ? `${existing}\n\n## Imported from OpenClaw (${new Date().toISOString().slice(0, 10)})\n\n${text.trim()}\n` : text;
        await put("MEMORY.md", merged);
      } else {
        await put(path, text);
      }
      if (c.entry.category === "persona") persona[path] = text;
      if (path === "HEARTBEAT.md") hadHeartbeat = true;
      written.push({ path, category: c.entry.category });
    }

    // Mirror persona columns so the settings form shows the imported text.
    const data: { systemPrompt?: string; userProfile?: string } = {};
    if (persona["SOUL.md"]) data.systemPrompt = persona["SOUL.md"].slice(0, 20_000);
    if (persona["USER.md"]) data.userProfile = persona["USER.md"].slice(0, 20_000);
    if (Object.keys(data).length) await db.bot.update({ where: { id: bot.id }, data });

    let heartbeat: ApplyResult["heartbeat"] = "skipped";
    if (options.heartbeatAutomation && hadHeartbeat) {
      const exists = await db.automation.findFirst({ where: { botId: bot.id, name: "Proactive check" } });
      if (exists) {
        await db.automation.update({ where: { id: exists.id }, data: { prompt: HEARTBEAT_IMPORT_PROMPT, enabled: true } });
        heartbeat = "exists";
      } else {
        await db.automation.create({
          data: { botId: bot.id, name: "Proactive check", schedule: { kind: "every", everyMs: 30 * 60_000 }, prompt: HEARTBEAT_IMPORT_PROMPT, sessionTarget: "main", idleOnly: true, createdBy: "owner" },
        });
        heartbeat = "created";
      }
    }

    // Onboarding is done by the import; leave a trace in today's memory note (once, with the last batch).
    const last = options.batch.index >= options.batch.total - 1;
    if (written.length && last) {
      await gatewayFetch(`${base}/file${q("BOOTSTRAP.md")}`, { method: "DELETE", timeoutMs: 10_000 }).catch(() => null);
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: bot.timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const rel = `memory/${day}.md`;
      const existing = await read(rel);
      const count = Math.max(options.batch.totalFiles, written.length);
      const line = `- Imported ${count} file${count === 1 ? "" : "s"} from an OpenClaw workspace.`;
      await put(rel, `${existing ? existing.replace(/\s+$/, "") + "\n" : `# ${day}\n\n`}${line}\n`);
    }
    return { written, skipped, heartbeat };
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), { written, skipped });
  }
}
