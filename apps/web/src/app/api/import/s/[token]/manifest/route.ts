import { db } from "@/lib/db";
import { sessionByToken, type ImportManifest } from "@/lib/import-session";
import { BATCH_BYTES, BATCH_FILES, MAX_FILES, classify, type ImportCategory } from "@/lib/openclaw-import";
import { createBotFromOpenClaw, type OpenClawConfigPayload } from "@/lib/openclaw-import-bootstrap";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Step 1 of the remote import: the uploader script sends the file list of the workspace it found
 * (and, for a "new" import, what it read from openclaw.json). The server classifies the files with
 * the same rules as the browser import, creates the bot when asked to, stores the manifest for the
 * page to visualize, and answers with the paths the script should upload.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const s = await sessionByToken(token);
  if (!s) return Response.json({ error: "Unknown or expired import token. Generate a fresh command on the Import page." }, { status: 404 });
  if (s.status === "expired") return Response.json({ error: "This import command expired; generate a fresh one on the Import page." }, { status: 410 });
  if (s.status !== "waiting") return Response.json({ error: "This import command was already used; generate a fresh one." }, { status: 409 });

  let body: { hostname?: string; workspace?: string; platform?: string; files?: { path?: string; size?: number }[]; config?: OpenClawConfigPayload };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected JSON" }, { status: 400 });
  }
  const hostname = String(body.hostname ?? "").slice(0, 190) || null;
  const workspace = String(body.workspace ?? "").slice(0, 1000) || null;

  // "new" mode: the bot (and its keys) come from openclaw.json before any file is written.
  let bot = s.bot;
  let created = null;
  if (s.mode === "new" && !bot) {
    const user = await db.user.findUnique({ where: { id: s.userId } });
    if (!user) return Response.json({ error: "Account not found" }, { status: 404 });
    try {
      created = await createBotFromOpenClaw(user, body.config ?? {}, hostname ? `OpenClaw on ${hostname}` : "Imported from OpenClaw");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.importSession.update({ where: { id: s.id }, data: { status: "failed", error: msg.slice(0, 1000), hostname, workspace } });
      return Response.json({ error: msg }, { status: 400 });
    }
    bot = await db.bot.findUnique({ where: { id: created.botId }, select: { id: true, name: true, userId: true, user: { select: { timezone: true } } } });
  }
  if (!bot) return Response.json({ error: "Import has no target bot" }, { status: 400 });

  const files = Array.isArray(body.files) ? body.files.slice(0, 10_000) : [];
  const options = s.options as unknown as { categories?: ImportCategory[] };
  const wanted = new Set(options.categories ?? ["persona", "memory", "heartbeat", "skills", "other"]);
  const manifest: ImportManifest = { entries: [], skipped: [] };
  for (const f of files) {
    const path = String(f.path ?? "").replace(/\\/g, "/").replace(/^\.?\/+/, "");
    const size = Number(f.size ?? 0);
    if (!path || path.split("/").some((seg) => seg === "..")) continue;
    const c = classify(path, size);
    if (c.entry) {
      if (wanted.has(c.entry.category)) manifest.entries.push(c.entry);
      else manifest.skipped.push({ path, size, reason: "category not selected" });
    } else if (c.skipped) manifest.skipped.push(c.skipped);
  }
  if (manifest.entries.length > MAX_FILES) {
    manifest.skipped.push(...manifest.entries.slice(MAX_FILES).map((e) => ({ path: e.path, size: e.size, reason: `beyond the ${MAX_FILES}-file limit` })));
    manifest.entries = manifest.entries.slice(0, MAX_FILES);
  }
  const bytesTotal = manifest.entries.reduce((n, e) => n + e.size, 0);
  await db.importSession.update({
    where: { id: s.id },
    data: {
      botId: bot.id,
      status: manifest.entries.length ? "uploading" : "done",
      hostname,
      workspace,
      manifest: manifest as never,
      progress: { filesTotal: manifest.entries.length, filesDone: 0, bytesTotal, bytesDone: 0 } as never,
      result: { written: [], skipped: [], heartbeat: "skipped" } as never,
      ...(created ? { created: created as never } : {}),
    },
  });
  return Response.json({
    bot: bot.name,
    created: created ? { name: created.name, platform: created.platform, tgUsername: created.tgUsername, model: created.model, keys: created.keys.map((k) => `${k.label}: ${k.status}`), notes: created.notes } : null,
    upload: manifest.entries.map((e) => e.path),
    skipped: manifest.skipped.length,
    batchFiles: BATCH_FILES,
    batchBytes: BATCH_BYTES,
  });
}
