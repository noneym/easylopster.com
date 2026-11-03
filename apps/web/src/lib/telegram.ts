import "server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";

/** Thin Telegram Bot API client for setup-time calls (getMe, webhook). Runtime messaging lives in the gateway. */

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
}

export type TgResult<T> = { ok: true; result: T } | { ok: false; description: string; error_code?: number; network?: true };

const FETCH_TIMEOUT_MS = 10_000;
const IPV4_TIMEOUT_MS = 15_000;

/** One Bot API request. `network` marks failures where Telegram never answered (timeout, DNS, connection reset). */
async function attempt<T>(token: string, method: string, body?: Record<string, unknown>): Promise<TgResult<T>> {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const timedOut = e.name === "TimeoutError" || e.name === "AbortError";
    return { ok: false, network: true, description: timedOut ? "timeout" : (e.cause?.code ?? e.message) };
  }
  try {
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string; error_code?: number };
    if (json.ok && json.result !== undefined) return { ok: true, result: json.result };
    return { ok: false, description: json.description ?? `HTTP ${res.status}`, error_code: json.error_code ?? res.status };
  } catch (err) {
    // Body cut off (timeout mid-read) or a non-JSON page from a proxy: Telegram's answer never arrived intact.
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") return { ok: false, network: true, description: "timeout" };
    return { ok: false, description: `HTTP ${res.status}`, error_code: res.status };
  }
}

/**
 * Same request over node:https pinned to IPv4. In some Docker networks the AAAA record of
 * api.telegram.org resolves but IPv6 has no route, so fetch (undici) hangs until the timeout.
 */
function attemptIpv4<T>(token: string, method: string, body?: Record<string, unknown>): Promise<TgResult<T>> {
  const payload = body ? JSON.stringify(body) : "";
  return new Promise((resolve) => {
    const req = request(
      { host: "api.telegram.org", path: `/bot${token}/${method}`, method: "POST", family: 4, timeout: IPV4_TIMEOUT_MS, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (raw += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(raw) as { ok: boolean; result?: T; description?: string; error_code?: number };
            if (json.ok && json.result !== undefined) resolve({ ok: true, result: json.result });
            else resolve({ ok: false, description: json.description ?? `HTTP ${res.statusCode}`, error_code: json.error_code ?? res.statusCode });
          } catch {
            resolve({ ok: false, description: `HTTP ${res.statusCode}`, error_code: res.statusCode });
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "timeout" })));
    req.on("error", (err: Error & { code?: string }) => resolve({ ok: false, network: true, description: err.code ?? err.message }));
    req.end(payload);
  });
}

/** Falls back to IPv4 over node:https when fetch could not reach Telegram; a real answer (401 etc.) is returned as is. */
async function call<T>(token: string, method: string, body?: Record<string, unknown>): Promise<TgResult<T>> {
  const first = await attempt<T>(token, method, body);
  if (first.ok || !first.network) return first;
  const second = await attemptIpv4<T>(token, method, body);
  const dns = await lookup("api.telegram.org", { all: true }).then((a) => a.map((x) => x.address).join(","), (e: Error) => e.message);
  console.warn(`[telegram] ${method}: fetch failed (${first.description}); IPv4 retry ${second.ok || !second.network ? "reached Telegram" : `failed (${second.description})`}; dns=${dns}`);
  return second;
}

/** User-facing text for a failed getMe: only a 401/404 from Telegram means the token itself is bad. */
export function tokenErrorText(r: { description: string; error_code?: number; network?: true }) {
  if (r.network) return r.description === "timeout" ? "Could not reach Telegram (timeout), try again" : `Could not reach Telegram (${r.description}), try again`;
  if (r.error_code === 401 || r.error_code === 404) return `Telegram rejected the token: ${r.description}`;
  return `Telegram returned an error (${r.description}), try again`;
}

export const tg = {
  getMe: (token: string) => call<TgUser>(token, "getMe"),
  setWebhook: (token: string, url: string, secret: string) =>
    call<boolean>(token, "setWebhook", {
      url,
      secret_token: secret,
      allowed_updates: ["message", "edited_message", "callback_query", "message_reaction", "my_chat_member"],
      drop_pending_updates: false,
      max_connections: 40,
    }),
  deleteWebhook: (token: string) => call<boolean>(token, "deleteWebhook", { drop_pending_updates: false }),
  getWebhookInfo: (token: string) => call<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>(token, "getWebhookInfo"),
  setMyCommands: (token: string, commands: { command: string; description: string }[]) => call<boolean>(token, "setMyCommands", { commands }),
  sendMessage: (token: string, chat_id: string | number, text: string, extra?: Record<string, unknown>) =>
    call<{ message_id: number }>(token, "sendMessage", { chat_id, text, ...extra }),
};

/** Commands registered on every bot (mirrors the OpenClaw essentials). */
export const BOT_COMMANDS = [
  { command: "help", description: "Show available commands." },
  { command: "new", description: "Start a new session." },
  { command: "reset", description: "Reset the current session." },
  { command: "status", description: "Show current status." },
  { command: "model", description: "Show or set the model for this chat." },
  { command: "crons", description: "List this bot's automations." },
  { command: "whoami", description: "Show your sender id." },
  { command: "stop", description: "Stop the current run." },
];

export function isValidBotToken(token: string) {
  return /^\d{6,12}:[A-Za-z0-9_-]{30,60}$/.test(token.trim());
}
