import http from "node:http";
import { Worker, type Job } from "bullmq";
import { QUEUES, queuePrefix } from "@easylopster/shared";
import { db } from "@easylopster/db";
import { env } from "./env.ts";
import { createRedis, redis } from "./redis.ts";
import { attachNodeServer } from "./nodes/server.ts";
import { handleInbound, type InboundJob } from "./agent/inbound.ts";
import { startTelegramPolling } from "./telegram/polling.ts";
import { sandboxAvailable, sandboxExec, startSandboxReaper } from "./sandbox/docker.ts";
import { handleWorkspaceHttp } from "./workspace/http.ts";
import { startAutomationScheduler } from "./agent/automations.ts";
import { startDreaming } from "./agent/dreaming.ts";

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
      if (await handleWorkspaceHttp(req, res, url)) return;
      if (url.pathname === "/internal/nodes/online") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ nodes: nodeServer.onlineNodeIds() }));
        return;
      }
      // Operator smoke test for the cloud sandbox: POST {userId, botId, command}
      if (url.pathname === "/internal/sandbox/exec" && req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        try {
          const { userId, botId, command, timeoutSec } = JSON.parse(body || "{}");
          if (!sandboxAvailable()) throw new Error("SANDBOX_ENABLED is not 1");
          const r = await sandboxExec(String(userId ?? "smoke"), String(botId ?? "smoke"), String(command ?? "echo hello"), { timeoutSec });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(r));
        } catch (err) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
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
      prefix: queuePrefix(),
      concurrency: Number(process.env.GATEWAY_CONCURRENCY ?? 8),
    },
  );
  worker.on("failed", (job, err) => log(`job ${job?.id} failed: ${err.message}`));
  worker.on("error", (err) => log(`worker error: ${err.message}`));

  await redis().ping();
  await db.$queryRaw`SELECT 1`;

  server.listen(e.GATEWAY_PORT, "0.0.0.0", () => log(`listening on :${e.GATEWAY_PORT} (ws: ${e.GATEWAY_WS_URL}, queue prefix ${queuePrefix()})`));

  // Dev only: pull Telegram updates when there is no public webhook URL.
  const stopPolling = process.env.TELEGRAM_POLLING === "1" ? startTelegramPolling() : () => {};
  const stopSandbox = sandboxAvailable() ? startSandboxReaper() : () => {};
  const stopAutomations = process.env.AUTOMATIONS_ENABLED === "0" ? () => {} : startAutomationScheduler();
  const stopDreaming = process.env.DREAMING_ENABLED === "0" ? () => {} : startDreaming();

  const shutdown = async (sig: string) => {
    log(`${sig} received, shutting down`);
    stopPolling();
    stopSandbox();
    stopAutomations();
    stopDreaming();
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
