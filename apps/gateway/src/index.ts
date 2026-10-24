import http from "node:http";
import { Worker, type Job } from "bullmq";
import { QUEUES } from "@easylopster/shared";
import { db } from "@easylopster/db";
import { env } from "./env.ts";
import { createRedis, redis } from "./redis.ts";
import { attachNodeServer } from "./nodes/server.ts";
import { handleInbound, type InboundJob } from "./agent/inbound.ts";
import { startTelegramPolling } from "./telegram/polling.ts";

const log = (msg: string, extra?: unknown) =>
  console.log(`[gateway] ${new Date().toISOString()} ${msg}`, extra ?? "");

async function main() {
  const e = env();

  // ── HTTP: health + internal admin (shared-secret) ───────────────────────────
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ ok: true, uptime: Math.round(process.uptime()) }));
      return;
    }
    if (url.pathname.startsWith("/internal/")) {
      if (!e.INTERNAL_SECRET || req.headers["x-internal-secret"] !== e.INTERNAL_SECRET) {
        res.writeHead(401).end();
        return;
      }
      if (url.pathname === "/internal/nodes/online") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nodes: nodeServer.onlineNodeIds() }));
        return;
      }
    }
    res.writeHead(404).end();
  });

  // ── WebSocket: nodes ────────────────────────────────────────────────────────
  const nodeServer = attachNodeServer(server, "/ws");

  // ── Queue: inbound messages → agent loop ────────────────────────────────────
  const worker = new Worker<InboundJob>(
    QUEUES.inbound,
    async (job: Job<InboundJob>) => {
      await handleInbound(job.data, { nodes: nodeServer });
    },
    {
      connection: createRedis(),
      concurrency: Number(process.env.GATEWAY_CONCURRENCY ?? 8),
    },
  );
  worker.on("failed", (job, err) => log(`job ${job?.id} failed: ${err.message}`));
  worker.on("error", (err) => log(`worker error: ${err.message}`));

  await redis().ping();
  await db.$queryRaw`SELECT 1`;

  server.listen(e.GATEWAY_PORT, "0.0.0.0", () => log(`listening on :${e.GATEWAY_PORT} (ws: ${e.GATEWAY_WS_URL})`));

  // Dev only: pull Telegram updates when there is no public webhook URL.
  const stopPolling = process.env.TELEGRAM_POLLING === "1" ? startTelegramPolling() : () => {};

  const shutdown = async (sig: string) => {
    log(`${sig} received, shutting down`);
    stopPolling();
    await worker.close();
    nodeServer.close();
    server.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[gateway] fatal", err);
  process.exit(1);
});
