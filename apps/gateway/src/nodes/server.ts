import type http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { db } from "@easylopster/db";
import {
  nodeToGatewayFrameSchema,
  type GatewayToNodeFrame,
  type NodeCapability,
  randomToken,
  sha256,
} from "@easylopster/shared";

interface LiveNode {
  nodeId: string;
  userId: string;
  caps: NodeCapability[];
  ws: WebSocket;
  pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  lastPong: number;
}

export interface NodeServer {
  onlineNodeIds(): string[];
  isOnline(nodeId: string): boolean;
  /** Invoke a capability on a node; rejects if offline, not enabled, or timed out. */
  invoke<T = unknown>(nodeId: string, method: NodeCapability, params: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  close(): void;
}

const send = (ws: WebSocket, frame: GatewayToNodeFrame) => ws.send(JSON.stringify(frame));

/**
 * Minimal node protocol server (see packages/shared/src/node-protocol.ts).
 * Faz 4 fills in exec approval and capability gating; Faz 0 only wires connect/pairing/req-res.
 */
export function attachNodeServer(server: http.Server, path: string): NodeServer {
  const wss = new WebSocketServer({ noServer: true });
  const live = new Map<string, LiveNode>();

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== path) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws, req) => {
    let node: LiveNode | undefined;
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? undefined;

    const connectTimer = setTimeout(() => {
      if (!node) ws.close(4000, "connect timeout");
    }, 10_000);

    ws.on("message", async (raw) => {
      let frame;
      try {
        frame = nodeToGatewayFrameSchema.parse(JSON.parse(raw.toString()));
      } catch {
        send(ws, { type: "error", code: "bad_frame", message: "Invalid frame" });
        if (!node) ws.close(4001, "bad first frame");
        return;
      }

      if (frame.type === "connect") {
        if (node) return;
        clearTimeout(connectTimer);
        try {
          node = await handleConnect(frame, ws, ip);
          live.set(node.nodeId, node);
        } catch (err) {
          send(ws, { type: "error", code: "auth_failed", message: (err as Error).message });
          ws.close(4003, "auth failed");
        }
        return;
      }
      if (!node) return;

      if (frame.type === "res") {
        const p = node.pending.get(frame.id);
        if (!p) return;
        node.pending.delete(frame.id);
        clearTimeout(p.timer);
        if (frame.ok) p.resolve(frame.payload);
        else p.reject(new Error(frame.error?.message ?? "node error"));
      } else if (frame.type === "pong") {
        node.lastPong = Date.now();
      }
      // "chunk" frames: Faz 4 (streaming exec output)
    });

    ws.on("close", async () => {
      clearTimeout(connectTimer);
      if (!node) return;
      live.delete(node.nodeId);
      for (const p of node.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("node disconnected"));
      }
      await db.node.update({ where: { id: node.nodeId }, data: { status: "offline", lastSeenAt: new Date() } }).catch(() => {});
    });
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const n of live.values()) {
      if (now - n.lastPong > 90_000) {
        n.ws.terminate();
        continue;
      }
      send(n.ws, { type: "ping", t: now });
    }
  }, 30_000);

  async function handleConnect(frame: Extract<import("@easylopster/shared").NodeToGatewayFrame, { type: "connect" }>, ws: WebSocket, ip?: string): Promise<LiveNode> {
    let row;
    let issuedToken: string | undefined;

    if (frame.auth.kind === "pairing") {
      row = await db.node.findUnique({ where: { pairingCode: frame.auth.code.toUpperCase() } });
      if (!row || row.status !== "pending" || !row.pairingExpiresAt || row.pairingExpiresAt < new Date()) {
        throw new Error("Pairing code is invalid or expired");
      }
      issuedToken = randomToken(32);
      row = await db.node.update({
        where: { id: row.id },
        data: {
          tokenHash: sha256(issuedToken),
          pairingCode: null,
          pairingExpiresAt: null,
          status: "online",
          name: row.name || frame.node.name,
          platform: frame.node.platform,
          arch: frame.node.arch,
          agentVersion: frame.node.agentVersion,
          caps: frame.node.caps,
          enabledCaps: row.enabledCaps ?? frame.node.caps.filter((c) => c !== "exec"),
          workspaceRoot: frame.node.workspaceRoot,
          lastSeenAt: new Date(),
          lastIp: ip,
        },
      });
    } else {
      row = await db.node.findUnique({ where: { tokenHash: sha256(frame.auth.token) } });
      if (!row || row.status === "revoked") throw new Error("Node token is invalid or revoked");
      row = await db.node.update({
        where: { id: row.id },
        data: {
          status: "online",
          platform: frame.node.platform,
          arch: frame.node.arch,
          agentVersion: frame.node.agentVersion,
          caps: frame.node.caps,
          workspaceRoot: frame.node.workspaceRoot,
          lastSeenAt: new Date(),
          lastIp: ip,
        },
      });
    }

    const existing = live.get(row.id);
    if (existing) existing.ws.close(4002, "replaced by new connection");

    send(ws, { type: "connected", nodeId: row.id, token: issuedToken, serverTime: new Date().toISOString() });
    return { nodeId: row.id, userId: row.userId, caps: frame.node.caps, ws, pending: new Map(), lastPong: Date.now() };
  }

  return {
    onlineNodeIds: () => [...live.keys()],
    isOnline: (id) => live.has(id),
    invoke<T>(nodeId: string, method: NodeCapability, params: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
      const n = live.get(nodeId);
      if (!n) return Promise.reject(new Error("Node is offline"));
      if (!n.caps.includes(method)) return Promise.reject(new Error(`Node does not support ${method}`));
      const id = randomUUID();
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          n.pending.delete(id);
          reject(new Error(`Node call ${method} timed out`));
        }, timeoutMs);
        n.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        send(n.ws, { type: "req", id, method, params, timeoutMs });
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const n of live.values()) n.ws.close(1001, "gateway shutting down");
      wss.close();
    },
  };
}
