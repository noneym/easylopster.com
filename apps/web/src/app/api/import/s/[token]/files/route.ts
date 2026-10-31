import { db } from "@/lib/db";
import { sessionByToken, type ImportProgress, type ImportResult } from "@/lib/import-session";
import { MAX_TOTAL_BYTES } from "@/lib/openclaw-import";
import { applyImportBatch, parseApplyOptions } from "@/lib/openclaw-import-apply";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Step 2 of the remote import: one batch of files (multipart, File.name = workspace-relative path).
 * Each batch is written into the bot's workspace at once; the session's progress and result grow
 * with every batch so the page can show them live.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const s = await sessionByToken(token);
  if (!s) return Response.json({ error: "Unknown or expired import token." }, { status: 404 });
  if (s.status !== "uploading") return Response.json({ error: `Import is ${s.status}; send the manifest first or generate a fresh command.` }, { status: 409 });
  if (!s.bot) return Response.json({ error: "Import has no target bot" }, { status: 400 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  let batch = { index: 0, total: 1 };
  try {
    const b = JSON.parse(String(form.get("batch") ?? "{}")) as Partial<typeof batch>;
    batch = { index: Number(b.index ?? 0), total: Math.max(1, Number(b.total ?? 1)) };
  } catch {}
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return Response.json({ error: "No files" }, { status: 400 });
  let bytes = 0;
  for (const f of files) bytes += f.size;
  if (bytes > MAX_TOTAL_BYTES) return Response.json({ error: `Batch larger than ${MAX_TOTAL_BYTES / 1024 / 1024} MB` }, { status: 400 });

  const progress = (s.progress ?? { filesTotal: 0, filesDone: 0, bytesTotal: 0, bytesDone: 0 }) as unknown as ImportProgress;
  const result = (s.result ?? { written: [], skipped: [], heartbeat: "skipped" }) as unknown as ImportResult;
  const options = parseApplyOptions({ ...(s.options as object), batch: { ...batch, totalFiles: progress.filesTotal } });
  const bot = { id: s.bot.id, userId: s.bot.userId, timezone: s.bot.user.timezone || "UTC" };
  try {
    const payload = await Promise.all(files.map(async (f) => ({ path: f.name, data: Buffer.from(await f.arrayBuffer()) })));
    const r = await applyImportBatch(bot, payload, options);
    result.written.push(...r.written);
    result.skipped.push(...r.skipped);
    if (r.heartbeat !== "skipped") result.heartbeat = r.heartbeat;
    progress.filesDone += files.length;
    progress.bytesDone += bytes;
    progress.batchesTotal = batch.total;
    progress.batchesDone = batch.index + 1;
    await db.importSession.update({ where: { id: s.id }, data: { progress: progress as never, result: result as never } });
    return Response.json({ ok: true, written: r.written, skipped: r.skipped });
  } catch (err) {
    const e = err as Error & { written?: ImportResult["written"]; skipped?: ImportResult["skipped"] };
    result.written.push(...(e.written ?? []));
    result.skipped.push(...(e.skipped ?? []));
    await db.importSession.update({ where: { id: s.id }, data: { status: "failed", error: e.message.slice(0, 1000), progress: progress as never, result: result as never } }).catch(() => {});
    return Response.json({ error: e.message, written: e.written ?? [], skipped: e.skipped ?? [] }, { status: 500 });
  }
}
