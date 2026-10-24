import { redis, createRedis } from "../redis.ts";

/** Web-chat streaming goes through Redis pub/sub: gateway publishes, the web app's SSE route subscribes. */
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; status: "start" | "end" }
  | { type: "final"; text: string; messageId: string }
  | { type: "approval"; id: string; target?: string; preview?: string; status: "pending" | "approved" | "denied" | "expired" }
  | { type: "error"; message: string };

export function chatChannel(conversationId: string) {
  return `chat:${conversationId}`;
}

export async function publishChat(conversationId: string, ev: ChatEvent) {
  await redis().publish(chatChannel(conversationId), JSON.stringify(ev));
}

/** Per-run abort flags (for /stop): set by inbound handler, checked by the runner. */
export function abortKey(sessionKey: string) {
  return `abort:${sessionKey}`;
}

export const subscriberRedis = createRedis;
