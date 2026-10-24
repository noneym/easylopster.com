import type http from "node:http";
import { rm, mkdir, stat } from "node:fs/promises";
import { Workspace } from "./fs.ts";

/**
 * Internal file API used by the dashboard's file browser/editor (shared-secret protected, see index.ts).
 *   GET    /internal/ws/:userId/:botId/tree?path=&depth=
 *   GET    /internal/ws/:userId/:botId/file?path=
 *   PUT    /internal/ws/:userId/:botId/file?path=      body = utf8 content
 *   DELETE /internal/ws/:userId/:botId/file?path=      (file or empty/recursive folder)
 *   POST   /internal/ws/:userId/:botId/mkdir?path=
 */
export async function handleWorkspaceHttp(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const m = url.pathname.match(/^\/internal\/ws\/([a-z0-9]+)\/([a-z0-9]+)\/(tree|file|mkdir)$/i);
  if (!m) return false;
  const [, userId, botId, op] = m;
  const ws = new Workspace(userId!, botId!);
  await ws.ensure();
  const rel = url.searchParams.get("path") ?? ".";
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    if (op === "tree" && req.method === "GET") {
      const depth = Math.min(Number(url.searchParams.get("depth") ?? 3), 8);
      return json(200, { root: ws.root, entries: await ws.list(rel, depth) }), true;
    }
    if (op === "file" && req.method === "GET") {
      const abs = ws.resolve(rel);
      const s = await stat(abs);
      if (s.size > 2_000_000) return json(413, { error: "File too large to edit here (2 MB limit)" }), true;
      return json(200, { path: rel, size: s.size, mtime: s.mtime.toISOString(), content: await ws.read(rel, 2_000_000) }), true;
    }
    if (op === "file" && req.method === "PUT") {
      let body = "";
      for await (const chunk of req) body += chunk;
      await ws.write(rel, body);
      return json(200, { ok: true, path: rel, bytes: Buffer.byteLength(body) }), true;
    }
    if (op === "file" && req.method === "DELETE") {
      const abs = ws.resolve(rel);
      if (abs === ws.root) return json(400, { error: "Cannot delete the workspace root" }), true;
      await rm(abs, { recursive: true, force: true });
      return json(200, { ok: true }), true;
    }
    if (op === "mkdir" && req.method === "POST") {
      await mkdir(ws.resolve(rel), { recursive: true });
      return json(200, { ok: true }), true;
    }
    return json(405, { error: "method not allowed" }), true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json(/ENOENT/.test(msg) ? 404 : 400, { error: msg }), true;
  }
}
