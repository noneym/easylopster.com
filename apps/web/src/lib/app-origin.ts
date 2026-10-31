import { headers } from "next/headers";

/** Public origin for links shown in server components (APP_URL in production, the request host in dev). */
export async function appOriginFromHeaders(): Promise<string> {
  const env = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (env && !/localhost|127\.0\.0\.1/.test(env)) return env;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
