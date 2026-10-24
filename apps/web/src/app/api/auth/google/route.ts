import { cookies } from "next/headers";
import { randomToken } from "@easylopster/shared/crypto";

export const dynamic = "force-dynamic";

/** Starts Google OAuth (authorization code flow). Enabled only when GOOGLE_CLIENT_ID/SECRET are set. */
export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return new Response("Google sign-in is not configured", { status: 404 });
  const state = randomToken(16);
  const jar = await cookies();
  jar.set("el_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  const next = new URL(req.url).searchParams.get("next") ?? "";
  if (next.startsWith("/dashboard")) jar.set("el_oauth_next", next, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  const redirectUri = `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/auth/google/callback`;
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "select_account");
  return Response.redirect(u.toString(), 302);
}
