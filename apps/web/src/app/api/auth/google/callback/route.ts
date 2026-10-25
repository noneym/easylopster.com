import { cookies } from "next/headers";
import { randomToken } from "@easylopster/shared/crypto";
import { db } from "@/lib/db";
import { createSession, hashPassword, promoteIfAdminEmail } from "@/lib/auth";
import { notifyAdminNewUser } from "@/lib/admin-notify";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expected = jar.get("el_oauth_state")?.value;
  const next = jar.get("el_oauth_next")?.value ?? "/dashboard";
  jar.delete("el_oauth_state");
  jar.delete("el_oauth_next");
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  if (!code || !state || state !== expected) return Response.redirect(`${base}/login?error=oauth`, 302);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${base}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return Response.redirect(`${base}/login?error=oauth`, 302);
  const tok = (await tokenRes.json()) as { access_token: string };
  const info = (await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } })).json()) as { email?: string; email_verified?: boolean; name?: string };
  if (!info.email || !info.email_verified) return Response.redirect(`${base}/login?error=oauth`, 302);

  const email = info.email.toLowerCase();
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    user = await db.user.create({ data: { email, name: info.name ?? null, passwordHash: await hashPassword(randomToken(24)), emailVerifiedAt: new Date() } });
    await notifyAdminNewUser({ id: user.id, email: user.email, name: user.name, provider: "google" });
  } else if (!user.emailVerifiedAt) {
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }
  await promoteIfAdminEmail(user);
  await createSession(user.id);
  return Response.redirect(`${base}${next}`, 302);
}
