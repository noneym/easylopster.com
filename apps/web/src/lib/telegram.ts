import "server-only";

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

const ATTEMPT_TIMEOUT_MS = 15_000;

/** One Bot API request. `network` marks failures where Telegram never answered (timeout, DNS, connection reset). */
async function attempt<T>(token: string, method: string, body?: Record<string, unknown>): Promise<TgResult<T>> {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
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

/** Retries once when Telegram could not be reached; a real answer (401 etc.) is returned as is. */
async function call<T>(token: string, method: string, body?: Record<string, unknown>): Promise<TgResult<T>> {
  const first = await attempt<T>(token, method, body);
  if (first.ok || !first.network) return first;
  return attempt<T>(token, method, body);
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
