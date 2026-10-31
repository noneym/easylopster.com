import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { publicSession } from "@/lib/import-session";

export const dynamic = "force-dynamic";

/** The import page polls this while the uploader script runs on the OpenClaw machine. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const s = await db.importSession.findFirst({ where: { id, userId: user.id } });
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  if (s.expiresAt < new Date() && (s.status === "waiting" || s.status === "scanning" || s.status === "uploading")) {
    await db.importSession.update({ where: { id: s.id }, data: { status: "expired" } }).catch(() => {});
    s.status = "expired";
  }
  return Response.json(publicSession(s), { headers: { "cache-control": "no-store" } });
}
