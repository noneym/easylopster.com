import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db, type Node } from "@easylopster/db";
import type { NodeCapability } from "@easylopster/shared";
import type { NodeServer } from "../nodes/server.ts";
import type { Workspace } from "../workspace/fs.ts";
import { requestApproval, type ApprovalChannel, type ApprovalDecision } from "./approvals.ts";

export interface NodeToolContext {
  botId: string;
  conversationId?: string;
  nodes: NodeServer;
  channel?: ApprovalChannel;
  /** secrets injected into node exec as environment variables */
  env?: Record<string, string>;
  /** bot's cloud workspace; node browser screenshots are copied into its inbox/ so MEDIA: can deliver them */
  workspace?: Workspace;
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
    const s = slug(node.name);
    summary.push(
      `${node.name}: ${online ? `online, tools node_${s}_<cap>` : "offline (its tools are not available until it reconnects; tell the owner to start the node app)"}${caps.length ? `, caps ${caps.join(", ")}` : ""}${node.workspaceRoot ? `, root ${node.workspaceRoot}` : ""}`,
    );
    if (!online) continue;
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
    const needsApproval = node.execApproval !== "never";
    /** Owner approval in chat (same flow as exec); returns an error object to hand back to the model when not approved. */
    const approve = async (toolName: string, args: Record<string, unknown>, preview: string): Promise<{ error: string } | null> => {
      if (!ctx.channel) return { error: `No approval channel for this conversation; ${toolName} on this node needs owner approval.` };
      const d: ApprovalDecision = await requestApproval({ botId: ctx.botId, conversationId: ctx.conversationId, toolName, args, target: `node:${node.name}`, preview, channel: ctx.channel });
      if (d === "approved") return null;
      return { error: d === "denied" ? "The owner denied this action." : "Approval request expired; nothing was done." };
    };

    if (caps.includes("exec")) {
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
            const denied = await approve(`node_${s}_exec`, { command, timeoutSec, cwd }, command);
            if (denied) return denied;
          }
          return safe(() => call("exec", { command, timeoutSec, cwd, env: ctx.env ?? {} }, ((timeoutSec ?? 60) + 15) * 1000));
        },
      });
    }

    // ── Browser control (Windows tray app driving Brave over the DevTools protocol) ──
    const browserCaps = caps.filter((c) => c.startsWith("browser."));
    if (browserCaps.length) {
      const where = `the browser on node "${node.name}" (Brave, separate profile)`;
      const gate = needsApproval ? " The owner must approve this action in chat; keep going with the task after approval, do not retry a denied action." : "";
      const tabArg = z.string().max(20).optional().describe("Tab id from an earlier browser call; defaults to the most recent tab.");
      const refArg = z.string().min(1).max(400).describe('Element ref from the last snapshot (e.g. "e12") or a CSS selector.');

      if (browserCaps.includes("browser.open")) {
        tools[`node_${s}_browser_open`] = tool({
          description: `Open a URL in ${where}. Returns the tab id, final URL and title. Follow with browser_snapshot to read the page.${gate}`,
          inputSchema: z.object({ url: z.string().min(1).max(2000), tabId: tabArg.describe("Navigate an existing tab instead of opening a new one.") }),
          execute: async ({ url, tabId }) => {
            if (needsApproval) {
              const denied = await approve(`node_${s}_browser_open`, { url, tabId }, `open ${url}`);
              if (denied) return denied;
            }
            return safe(() => call("browser.open", { url, tabId }, 45_000));
          },
        });
      }
      if (browserCaps.includes("browser.snapshot")) {
        tools[`node_${s}_browser_snapshot`] = tool({
          description: `Read the current page in ${where} as text: headings, paragraphs, links and form controls with refs like [e12] you can pass to browser_click / browser_type. Truncated at ~20k characters; pass scrollTo (pixels) to read further down. Free, no approval.`,
          inputSchema: z.object({ tabId: tabArg, scrollTo: z.number().int().min(0).optional() }),
          execute: ({ tabId, scrollTo }) => safe(() => call("browser.snapshot", { tabId, scrollTo }, 30_000)),
        });
      }
      if (browserCaps.includes("browser.click")) {
        tools[`node_${s}_browser_click`] = tool({
          description: `Click an element in ${where} by ref or CSS selector. Refs change after navigation; take a fresh snapshot afterwards.${gate}`,
          inputSchema: z.object({ target: refArg, tabId: tabArg }),
          execute: async ({ target, tabId }) => {
            if (needsApproval) {
              const denied = await approve(`node_${s}_browser_click`, { target, tabId }, `click ${target}`);
              if (denied) return denied;
            }
            return safe(() => call("browser.click", { target, tabId }, 30_000));
          },
        });
      }
      if (browserCaps.includes("browser.type")) {
        tools[`node_${s}_browser_type`] = tool({
          description: `Type into an input in ${where} (replaces the current value unless clear=false); enter=true submits with Enter. Never type passwords or payment details.${gate}`,
          inputSchema: z.object({ target: refArg, text: z.string().max(4000), enter: z.boolean().default(false), clear: z.boolean().default(true), tabId: tabArg }),
          execute: async ({ target, text, enter, clear, tabId }) => {
            if (needsApproval) {
              const denied = await approve(`node_${s}_browser_type`, { target, text, enter, clear, tabId }, `type "${text.slice(0, 200)}"${enter ? " + Enter" : ""} into ${target}`);
              if (denied) return denied;
            }
            return safe(() => call("browser.type", { target, text, enter, clear, tabId }, 30_000));
          },
        });
      }
      if (browserCaps.includes("browser.screenshot")) {
        type ShotInput = { tabId?: string; fullPage: boolean };
        type Shot = { error?: string; tabId?: string; url?: string; title?: string; bytes?: number; nodePath?: string; path?: string; data?: string; mediaType?: "image/png" };
        tools[`node_${s}_browser_screenshot`] = tool({
          description: `Screenshot the page in ${where} (PNG). You see the image, and it is saved to your cloud workspace under inbox/ so you can attach it with a MEDIA: line. Free, no approval.`,
          inputSchema: z.object({ tabId: tabArg, fullPage: z.boolean().default(false) }),
          execute: async ({ tabId, fullPage }: ShotInput): Promise<Shot> => {
            const r = await safe(() => call<{ tabId: string; path: string; data: string; url: string; title: string; bytes: number }>("browser.screenshot", { tabId, fullPage }, 45_000));
            if (!("data" in r) || !r.data) return r as Shot;
            let cloudPath: string | undefined;
            if (ctx.workspace) {
              const rel = `inbox/node-${s}-${path.basename(r.path)}`;
              const abs = ctx.workspace.resolve(rel);
              await mkdir(path.dirname(abs), { recursive: true });
              await writeFile(abs, Buffer.from(r.data, "base64"));
              cloudPath = rel;
            }
            return { tabId: r.tabId, url: r.url, title: r.title, bytes: r.bytes, nodePath: r.path, path: cloudPath, data: r.data, mediaType: "image/png" };
          },
          toModelOutput: ({ output: o }: { output: Shot }) => {
            if (!o.data) return { type: "json" as const, value: { error: o.error ?? "screenshot failed" } };
            return {
              type: "content" as const,
              value: [
                { type: "text" as const, text: JSON.stringify({ tabId: o.tabId, url: o.url, title: o.title, path: o.path, attach: o.path ? `MEDIA:${o.path}` : undefined }) },
                { type: "image-data" as const, data: o.data, mediaType: "image/png" },
              ],
            };
          },
        });
      }
      if (browserCaps.includes("browser.tabs")) {
        tools[`node_${s}_browser_tabs`] = tool({
          description: `List or close tabs in ${where}. Free, no approval.`,
          inputSchema: z.object({ action: z.enum(["list", "close", "activate"]).default("list"), tabId: tabArg }),
          execute: ({ action, tabId }) => safe(() => call("browser.tabs", { action, tabId }, 20_000)),
        });
      }
    }
  }
  return { tools, summary };
}

export type { Node };
