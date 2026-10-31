import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { MAX_FILES, MAX_TOTAL_BYTES } from "@/lib/openclaw-import";
import { applyImportBatch, parseApplyOptions, type ApplyOptions } from "@/lib/openclaw-import-apply";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Import an OpenClaw workspace into a bot's cloud workspace from the browser folder picker.
 * multipart/form-data: botId, options (JSON), file (repeated; File.name = path relative to the workspace root).
 * Only text files already filtered by the picker are accepted; the server re-applies the same rules.
 */
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
  let options: ApplyOptions;
  try {
    options = parseApplyOptions(JSON.parse(String(form.get("options") ?? "{}")) as Partial<ApplyOptions>);
  } catch {
    return Response.json({ error: "Bad options" }, { status: 400 });
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "No files" }, { status: 400 });
  if (files.length > MAX_FILES || options.batch.totalFiles > MAX_FILES) return Response.json({ error: `At most ${MAX_FILES} files per import` }, { status: 400 });
  let total = 0;
  for (const f of files) total += f.size;
  if (total > MAX_TOTAL_BYTES) return Response.json({ error: `Import larger than ${MAX_TOTAL_BYTES / 1024 / 1024} MB` }, { status: 400 });

  try {
    const payload = await Promise.all(files.map(async (f) => ({ path: f.name, data: Buffer.from(await f.arrayBuffer()) })));
    const r = await applyImportBatch({ id: bot.id, userId: bot.userId, timezone: bot.user.timezone || "UTC" }, payload, options);
    return Response.json({ ok: true, ...r, memoryMode: options.memoryMode });
  } catch (err) {
    const e = err as Error & { written?: unknown; skipped?: unknown };
    return Response.json({ error: e.message, written: e.written ?? [], skipped: e.skipped ?? [] }, { status: 500 });
  }
}
