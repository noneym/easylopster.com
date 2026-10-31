import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { credsOf, putObject } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_BYTES = 200 * 1024 * 1024;

/** Browser upload into the account's bucket: multipart { path, file }. Goes through the server, so the bucket needs no CORS rules. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const cfg = await db.storageConfig.findUnique({ where: { userId: user.id } });
  if (!cfg) return Response.json({ error: "No storage connected" }, { status: 400 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  const path = String(form.get("path") ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!(file instanceof File) || !path) return Response.json({ error: "file and path are required" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: `Files up to ${MAX_BYTES / 1024 / 1024} MB` }, { status: 413 });
  try {
    await putObject(credsOf(cfg), path, Buffer.from(await file.arrayBuffer()), file.type || "application/octet-stream");
    return Response.json({ ok: true, path, bytes: file.size });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
