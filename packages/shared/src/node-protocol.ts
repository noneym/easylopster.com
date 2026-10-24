/**
 * easylopster node protocol (v1). JSON text frames over WebSocket.
 * Modeled after OpenClaw's gateway protocol (connect → req/res + events) but simplified:
 * a node authenticates with a long-lived node token issued at pairing time.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const nodeCapabilitySchema = z.enum([
  "fs.read",
  "fs.write",
  "fs.list",
  "fs.search",
  "exec",
  "system.which",
  "system.notify",
  "screen.snapshot",
  "device.info",
  // Browser control (Windows tray app drives the user's Brave over the DevTools protocol).
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.screenshot",
  "browser.tabs",
]);

export type NodeCapability = z.infer<typeof nodeCapabilitySchema>;

/** Capabilities served by the desktop app's browser controller. */
export const BROWSER_CAPS = ["browser.open", "browser.snapshot", "browser.click", "browser.type", "browser.screenshot", "browser.tabs"] as const satisfies readonly NodeCapability[];

/** First frame from node → gateway. */
export const connectFrameSchema = z.object({
  type: z.literal("connect"),
  v: z.literal(PROTOCOL_VERSION),
  role: z.literal("node"),
  /** Either a pairing code (first connect) or a node token (subsequent connects). */
  auth: z.union([
    z.object({ kind: z.literal("pairing"), code: z.string().min(4) }),
    z.object({ kind: z.literal("token"), token: z.string().min(16) }),
  ]),
  node: z.object({
    name: z.string().min(1).max(80),
    platform: z.enum(["windows", "macos", "linux", "docker"]),
    arch: z.string().optional(),
    agentVersion: z.string(),
    caps: z.array(nodeCapabilitySchema),
    /** Workspace root the node exposes to fs.* (absolute path on the node). */
    workspaceRoot: z.string().optional(),
  }),
});

export const connectedFrameSchema = z.object({
  type: z.literal("connected"),
  nodeId: z.string(),
  /** Issued on first (pairing) connect; the node must persist it. */
  token: z.string().optional(),
  serverTime: z.string(),
});

/** Gateway → node command. */
export const reqFrameSchema = z.object({
  type: z.literal("req"),
  id: z.string(),
  method: nodeCapabilitySchema,
  params: z.record(z.string(), z.unknown()).default({}),
  timeoutMs: z.number().int().positive().optional(),
});

/** Node → gateway response. */
export const resFrameSchema = z.object({
  type: z.literal("res"),
  id: z.string(),
  ok: z.boolean(),
  payload: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

/** Streaming chunk for long exec output (optional). */
export const chunkFrameSchema = z.object({
  type: z.literal("chunk"),
  id: z.string(),
  stream: z.enum(["stdout", "stderr"]),
  data: z.string(),
});

export const pingFrameSchema = z.object({ type: z.literal("ping"), t: z.number() });
export const pongFrameSchema = z.object({ type: z.literal("pong"), t: z.number() });

export const nodeToGatewayFrameSchema = z.discriminatedUnion("type", [
  connectFrameSchema,
  resFrameSchema,
  chunkFrameSchema,
  pongFrameSchema,
]);
export const gatewayToNodeFrameSchema = z.discriminatedUnion("type", [
  connectedFrameSchema,
  reqFrameSchema,
  pingFrameSchema,
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);

export type NodeToGatewayFrame = z.infer<typeof nodeToGatewayFrameSchema>;
export type GatewayToNodeFrame = z.infer<typeof gatewayToNodeFrameSchema>;
