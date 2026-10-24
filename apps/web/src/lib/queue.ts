import "server-only";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { QUEUES } from "@easylopster/shared";

/** Shape must match apps/gateway/src/agent/inbound.ts InboundJob. */
export interface InboundJob {
  botId: string;
  source: "telegram" | "web";
  sessionKey: string;
  payload: unknown;
  receivedAt: string;
}

const g = globalThis as unknown as { elRedis?: Redis; elInbound?: Queue<InboundJob> };

export function redis(): Redis {
  if (!g.elRedis) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL is not set");
    g.elRedis = new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
  }
  return g.elRedis;
}

export function inboundQueue(): Queue<InboundJob> {
  if (!g.elInbound) {
    g.elInbound = new Queue<InboundJob>(QUEUES.inbound, {
      connection: redis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 1000, age: 3600 },
        removeOnFail: { count: 1000, age: 86_400 },
      },
    });
  }
  return g.elInbound;
}
