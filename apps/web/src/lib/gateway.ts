import "server-only";

/** Calls the gateway's internal HTTP API (shared secret). */
export async function gatewayFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const base = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const { timeoutMs = 8000, ...rest } = init;
  return fetch(`${base}${path}`, {
    ...rest,
    headers: { "x-internal-secret": process.env.INTERNAL_SECRET ?? "", ...(rest.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}
