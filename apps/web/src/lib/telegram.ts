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

async function call<T>(token: string, method: string, body?: Record<string, unknown>): Promise<{ ok: true; result: T } | { ok: false; description: string; error_code?: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string; error_code?: number };
    if (json.ok && json.result !== undefined) return { ok: true, result: json.result };
    return { ok: false, description: json.description ?? `HTTP ${res.status}`, error_code: json.error_code };
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
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
  { command: "whoami", description: "Show your sender id." },
  { command: "stop", description: "Stop the current run." },
];

export function isValidBotToken(token: string) {
  return /^\d{6,12}:[A-Za-z0-9_-]{30,60}$/.test(token.trim());
}
