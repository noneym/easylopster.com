import { sessionByToken } from "@/lib/import-session";

export const dynamic = "force-dynamic";

/**
 * Step 0 of the remote import: the uploader asks what the owner ticked, so API keys and the
 * Telegram token are never sent when they were left unchecked. No secrets in the answer.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const s = await sessionByToken(token);
  if (!s) return Response.json({ error: "Unknown or expired import token. Generate a fresh command on the Import page." }, { status: 404 });
  if (s.status !== "waiting") return Response.json({ error: `This import command is ${s.status}; generate a fresh one.` }, { status: 409 });
  const o = s.options as unknown as { categories?: string[]; importKeys?: boolean; importTelegram?: boolean };
  return Response.json({ mode: s.mode, categories: o.categories ?? [], importKeys: s.mode === "new" && o.importKeys !== false, importTelegram: s.mode === "new" && o.importTelegram !== false });
}
