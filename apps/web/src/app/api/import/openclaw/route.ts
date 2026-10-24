import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { gatewayFetch } from "@/lib/gateway";
import { classify, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, type ImportCategory } from "@/lib/openclaw-import";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Import an OpenClaw workspace into a bot's cloud workspace.
 * multipart/form-data: botId, options (JSON), file (repeated; File.name = path relative to the workspace root).
 * Only text files already filtered by the picker are accepted; the server re-applies the same rules.
 */
interface Options {
  categories: ImportCategory[];
  memoryMode: "append" | "replace";
  heartbeatAutomation: boolean;
  /** Large imports arrive in sequential batches; the summary note is written with the last one. */
  batch: { index: number; total: number; totalFiles: number };
}

const HEARTBEAT_IMPORT_PROMPT =
  "Proactive check. Read HEARTBEAT.md in your workspace with fs_read and follow it exactly; it is the owner's checklist for this run. Also review your memory notes and anything time-sensitive. Recurring tasks are automations; create or change their schedules with the automations tool. If nothing needs attention, reply NO_REPLY.";

const q = (path: string) => `?path=${encodeURIComponent(path)}`;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const botId = String(form.get("botId") ?? "");
  const bot = await db.bot.findFirst({ where: { id: botId, userId: user.id }, select: { id: true, userId: true, user: { select: { timezone: true } } } });
  if (!bot) return Response.json({ error: "Bot not found" }, { status: 404 });
  let options: Options;
  try {
    const raw = JSON.parse(String(form.get("options") ?? "{}")) as Partial<Options>;
    options = {
      categories: Array.isArray(raw.categories) ? (raw.categories as ImportCategory[]) : ["persona", "memory", "heartbeat", "skills", "other"],
      memoryMode: raw.memoryMode === "replace" ? "replace" : "append",
      heartbeatAutomation: !!raw.heartbeatAutomation,
      batch: raw.batch && typeof raw.batch === "object" ? { index: Number(raw.batch.index ?? 0), total: Number(raw.batch.total ?? 1), totalFiles: Number(raw.batch.totalFiles ?? 0) } : { index: 0, total: 1, totalFiles: 0 },
    };
  } catch {
    return Response.json({ error: "Bad options" }, { status: 400 });
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "No files" }, { status: 400 });
  if (files.length > MAX_FILES || options.batch.totalFiles > MAX_FILES) return Response.json({ error: `At most ${MAX_FILES} files per import` }, { status: 400 });
  let total = 0;
  for (const f of files) total += f.size;
  if (total > MAX_TOTAL_BYTES) return Response.json({ error: `Import larger than ${MAX_TOTAL_BYTES / 1024 / 1024} MB` }, { status: 400 });

  const wanted = new Set(options.categories);
  const written: { path: string; category: ImportCategory }[] = [];
  const skipped: { path: string; reason: string }[] = [];
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
      // The picker already stripped the folder name; the name is the workspace-relative path.
      const path = f.name.replace(/\\/g, "/").replace(/^\.?\/+/, "");
      if (!path || path.split("/").some((seg) => seg === "..")) {
        skipped.push({ path, reason: "invalid path" });
        continue;
      }
      const c = classify(path, f.size);
      if (!c.entry) {
        skipped.push({ path, reason: c.skipped?.reason ?? "not importable" });
        continue;
      }
      if (!wanted.has(c.entry.category)) {
        skipped.push({ path, reason: "category not selected" });
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        skipped.push({ path, reason: "too large" });
        continue;
      }
      const buf = Buffer.from(await f.arrayBuffer());
      if (buf.includes(0)) {
        skipped.push({ path, reason: "binary content" });
        continue;
      }
      const text = buf.toString("utf8");
      // Only the first batch may replace MEMORY.md; later batches never carry it twice anyway.
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

    // Heartbeat automation that follows the imported HEARTBEAT.md.
    let heartbeat: "created" | "exists" | "skipped" = "skipped";
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
      const tz = bot.user.timezone || "UTC";
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const rel = `memory/${day}.md`;
      const existing = await read(rel);
      const count = Math.max(options.batch.totalFiles, written.length);
      const line = `- Imported ${count} file${count === 1 ? "" : "s"} from an OpenClaw workspace.`;
      await put(rel, `${existing ? existing.replace(/\s+$/, "") + "\n" : `# ${day}\n\n`}${line}\n`);
    }

    return Response.json({ ok: true, written, skipped, heartbeat, memoryMode: options.memoryMode });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err), written, skipped }, { status: 500 });
  }
}
