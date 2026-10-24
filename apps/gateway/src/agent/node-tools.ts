import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db, type Node } from "@easylopster/db";
import type { NodeCapability } from "@easylopster/shared";
import type { NodeServer } from "../nodes/server.ts";
import { requestApproval, type ApprovalChannel } from "./approvals.ts";

export interface NodeToolContext {
  botId: string;
  conversationId?: string;
  nodes: NodeServer;
  channel?: ApprovalChannel;
  /** secrets injected into node exec as environment variables */
  env?: Record<string, string>;
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "node";
}

/**
 * Tools for every node linked to the bot that is online right now. Names are `node_<name>_<cap>`.
 * Capabilities are gated by what the owner enabled on the node; exec may require a chat approval.
 */
export async function nodeToolsForBot(ctx: NodeToolContext): Promise<{ tools: ToolSet; summary: string[] }> {
  const links = await db.botNode.findMany({ where: { botId: ctx.botId }, include: { node: true } });
  const tools: ToolSet = {};
  const summary: string[] = [];

  for (const { node } of links) {
    if (node.status === "revoked") continue;
    const online = ctx.nodes.isOnline(node.id);
    const enabled = new Set<NodeCapability>(Array.isArray(node.enabledCaps) ? (node.enabledCaps as NodeCapability[]) : []);
    const declared = new Set<NodeCapability>(Array.isArray(node.caps) ? (node.caps as NodeCapability[]) : []);
    const caps = [...enabled].filter((c) => declared.has(c));
    summary.push(`${node.name}: ${online ? "online" : "offline"}${caps.length ? `, caps ${caps.join(", ")}` : ""}${node.workspaceRoot ? `, root ${node.workspaceRoot}` : ""}`);
    if (!online) continue;
    const s = slug(node.name);
    const call = <T>(method: NodeCapability, params: Record<string, unknown>, timeoutMs?: number) => ctx.nodes.invoke<T>(node.id, method, params, timeoutMs);
    const safe = async <T>(fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) } as unknown as T;
      }
    };

    if (caps.includes("fs.read")) {
      tools[`node_${s}_fs_read`] = tool({
        description: `Read a text file on node "${node.name}" (${node.platform ?? "machine"}). Paths are relative to the node's shared folder${node.workspaceRoot ? ` (${node.workspaceRoot})` : ""}.`,
        inputSchema: z.object({ path: z.string() }),
        execute: ({ path }) => safe(() => call("fs.read", { path })),
      });
    }
    if (caps.includes("fs.write")) {
      tools[`node_${s}_fs_write`] = tool({
        description: `Create or overwrite a text file on node "${node.name}". Relative to the node's shared folder.`,
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: ({ path, content }) => safe(() => call("fs.write", { path, content })),
      });
    }
    if (caps.includes("fs.list")) {
      tools[`node_${s}_fs_list`] = tool({
        description: `List files and folders on node "${node.name}" (relative to its shared folder).`,
        inputSchema: z.object({ path: z.string().default("."), depth: z.number().int().min(0).max(4).default(1) }),
        execute: ({ path, depth }) => safe(() => call("fs.list", { path, depth })),
      });
    }
    if (caps.includes("fs.search")) {
      tools[`node_${s}_fs_search`] = tool({
        description: `Search text in files on node "${node.name}" (case-insensitive substring).`,
        inputSchema: z.object({ query: z.string().min(1), maxResults: z.number().int().min(1).max(100).default(40) }),
        execute: ({ query, maxResults }) => safe(() => call("fs.search", { query, maxResults })),
      });
    }
    if (caps.includes("system.which")) {
      tools[`node_${s}_which`] = tool({
        description: `Check whether a program is installed on node "${node.name}" and where.`,
        inputSchema: z.object({ name: z.string().min(1) }),
        execute: ({ name }) => safe(() => call("system.which", { name })),
      });
    }
    if (caps.includes("system.notify")) {
      tools[`node_${s}_notify`] = tool({
        description: `Show a desktop notification on node "${node.name}".`,
        inputSchema: z.object({ title: z.string().max(80), body: z.string().max(400) }),
        execute: ({ title, body }) => safe(() => call("system.notify", { title, body })),
      });
    }
    if (caps.includes("device.info")) {
      tools[`node_${s}_info`] = tool({
        description: `Host, OS, CPU, memory and disk facts about node "${node.name}".`,
        inputSchema: z.object({}),
        execute: () => safe(() => call("device.info", {})),
      });
    }
    if (caps.includes("exec")) {
      const needsApproval = node.execApproval !== "never";
      tools[`node_${s}_exec`] = tool({
        description: `Run a shell command on node "${node.name}" (${node.platform ?? "machine"}; ${node.platform === "windows" ? "PowerShell" : "bash"}). ${
          needsApproval ? "The owner must approve each command in chat before it runs; show the exact command you intend to run." : "Runs without approval."
        } Default timeout 60s (max 300). Returns exit code, stdout, stderr.`,
        inputSchema: z.object({
          command: z.string().min(1).max(8000),
          timeoutSec: z.number().int().min(1).max(300).optional(),
          cwd: z.string().max(400).optional(),
        }),
        execute: async ({ command, timeoutSec, cwd }) => {
          if (needsApproval) {
            if (!ctx.channel) return { error: "No approval channel for this conversation; exec on this node needs owner approval." };
            const d = await requestApproval({
              botId: ctx.botId,
              conversationId: ctx.conversationId,
              toolName: `node_${s}_exec`,
              args: { command, timeoutSec, cwd },
              target: `node:${node.name}`,
              preview: command,
              channel: ctx.channel,
            });
            if (d !== "approved") return { error: d === "denied" ? "The owner denied this command." : "Approval request expired; the command was not run." };
          }
          return safe(() => call("exec", { command, timeoutSec, cwd, env: ctx.env ?? {} }, ((timeoutSec ?? 60) + 15) * 1000));
        },
      });
    }
  }
  return { tools, summary };
}

export type { Node };
