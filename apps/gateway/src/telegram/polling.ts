import { Api } from "grammy";
import { Queue } from "bullmq";
import { db } from "@easylopster/db";
import { QUEUES } from "@easylopster/shared";
import { decrypt } from "@easylopster/shared/crypto";
import { createRedis } from "../redis.ts";
import type { InboundJob } from "../agent/inbound.ts";

/**
 * Development-only long polling (TELEGRAM_POLLING=1): when the web app has no public HTTPS URL,
 * the gateway pulls updates with getUpdates and enqueues them exactly like the webhook route would.
 * Never enable in production alongside webhooks (Telegram refuses getUpdates while a webhook is set;
 * we delete the webhook for polled bots).
 */
export function startTelegramPolling(): () => void {
  const queue = new Queue<InboundJob>(QUEUES.inbound, { connection: createRedis() });
  const pollers = new Map<string, { stop: () => void }>();
  let stopped = false;
  const log = (m: string) => console.log(`[tg-poll] ${new Date().toISOString()} ${m}`);

  async function pollBot(botId: string, token: string) {
    const api = new Api(token);
    await api.deleteWebhook().catch(() => {});
    let offset = 0;
    let running = true;
    log(`polling bot=${botId}`);
    (async () => {
      while (running && !stopped) {
        try {
          const updates = await api.getUpdates({ offset, timeout: 25, allowed_updates: ["message", "edited_message", "callback_query"] });
          for (const u of updates) {
            offset = u.update_id + 1;
            const chat = u.message?.chat;
            const sessionKey = chat
              ? chat.type === "private"
                ? `dm:${botId}:main`
                : `group:${botId}:${chat.id}${u.message?.message_thread_id ? `:thread:${u.message.message_thread_id}` : ""}`
              : `dm:${botId}:main`;
            await queue.add(
              "telegram",
              { botId, source: "telegram", sessionKey, payload: u, receivedAt: new Date().toISOString() },
              { jobId: `tg:${botId}:${u.update_id}`, attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 1000, removeOnFail: 1000 },
            );
          }
        } catch (err) {
          log(`bot=${botId} poll error: ${(err as Error).message}`);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })();
    return { stop: () => (running = false) };
  }

  async function sync() {
    const bots = await db.bot.findMany({ where: { platform: "telegram", status: "active", NOT: { tgBotId: "0" } }, select: { id: true, encToken: true } });
    const ids = new Set(bots.map((b) => b.id));
    for (const [id, p] of pollers) if (!ids.has(id)) (p.stop(), pollers.delete(id), log(`stopped bot=${id}`));
    for (const b of bots) if (!pollers.has(b.id)) pollers.set(b.id, await pollBot(b.id, decrypt(b.encToken)));
  }

  void sync();
  const timer = setInterval(() => void sync().catch((e) => log(`sync error: ${e.message}`)), 30_000);
  return () => {
    stopped = true;
    clearInterval(timer);
    for (const p of pollers.values()) p.stop();
    void queue.close();
  };
}
