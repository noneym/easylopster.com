import { db } from "@/lib/db";
import { sessionByToken } from "@/lib/import-session";

export const dynamic = "force-dynamic";

/** Step 3 of the remote import: the script reports completion (or the error that stopped it). */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const s = await sessionByToken(token);
  if (!s) return Response.json({ error: "Unknown or expired import token." }, { status: 404 });
  if (s.status === "done" || s.status === "failed" || s.status === "expired") return Response.json({ ok: true, status: s.status });
  let error = "";
  try {
    const j = (await req.json()) as { error?: string };
    error = String(j.error ?? "").slice(0, 1000);
  } catch {}
  await db.importSession.update({ where: { id: s.id }, data: error ? { status: "failed", error } : { status: "done" } });
  return Response.json({ ok: true, status: error ? "failed" : "done" });
}
