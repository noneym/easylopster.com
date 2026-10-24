import { db } from "@/lib/db";
import { inboundQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";

/**
 * Telegram webhook receiver. Validates the per-bot secret (path + header), enqueues the raw update
 * for the gateway and answers 200 immediately. Telegram retries on non-2xx, so we only fail on
 * genuinely unknown bots.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/tg/[botId]/[secret]">) {
  const { botId, secret } = await ctx.params;
  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");

  const bot = await db.bot.findUnique({ where: { id: botId }, select: { id: true, webhookSecret: true, status: true } });
  if (!bot || bot.webhookSecret !== secret || headerSecret !== secret) {
    return new Response("not found", { status: 404 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return new Response("bad json", { status: 200 });
  }
  if (bot.status !== "active") return new Response("paused", { status: 200 });

  const u = update as {
    update_id?: number;
    message?: { chat?: { id: number; type: string }; message_thread_id?: number };
    callback_query?: { message?: { chat?: { id: number; type: string }; message_thread_id?: number } };
  };
  const msg = u.message ?? u.callback_query?.message;
  const chat = msg?.chat;
  // Session key mirrors OpenClaw: all DMs share the bot's main session; each group (and topic) is its own.
  const sessionKey = chat
    ? chat.type === "private"
      ? `dm:${botId}:main`
      : `group:${botId}:${chat.id}${msg?.message_thread_id ? `:thread:${msg.message_thread_id}` : ""}`
    : `dm:${botId}:main`;

  await inboundQueue().add(
    "telegram",
    { botId, source: "telegram", sessionKey, payload: update, receivedAt: new Date().toISOString() },
    { jobId: u.update_id ? `tg-${botId}-${u.update_id}` : undefined },
  );
  return new Response("ok", { status: 200 });
}
