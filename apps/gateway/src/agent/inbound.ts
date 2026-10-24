import type { NodeServer } from "../nodes/server.ts";

/**
 * Job payload enqueued by the web app (Telegram webhook / web chat).
 * Faz 2 implements the agent loop; Faz 0 only logs.
 */
export interface InboundJob {
  botId: string;
  source: "telegram" | "web";
  sessionKey: string;
  /** Raw Telegram update (source=telegram) or { text, userId } (source=web). */
  payload: unknown;
  receivedAt: string;
}

export interface InboundContext {
  nodes: NodeServer;
}

export async function handleInbound(job: InboundJob, _ctx: InboundContext): Promise<void> {
  console.log(`[gateway] inbound bot=${job.botId} source=${job.source} session=${job.sessionKey}`);
}
