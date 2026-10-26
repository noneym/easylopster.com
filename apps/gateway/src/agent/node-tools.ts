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
    const autoApprove = new Set(Array.isArray(node.autoApprove) ? (node.autoApprove as string[]) : []);
    /** Owner approval in chat (same flow as exec); returns an error object to hand back to the model when not approved. */
    const approve = async (toolName: string, args: Record<string, unknown>, preview: string, cap: string): Promise<{ error: string } | null> => {
      if (autoApprove.has(cap)) return null; // the owner answered "Always allow" for this action on this node
      if (!ctx.channel) return { error: `No approval channel for this conversation; ${toolName} on this node needs owner approval.` };
      const d: ApprovalDecision = await requestApproval({ botId: ctx.botId, conversationId: ctx.conversationId, toolName, args, target: `node:${node.name}`, preview, channel: ctx.channel, scopeKey: `node:${node.id}:${cap}` });
      if (d === "approved") return null;
      return { error: d === "denied" ? "The owner denied this action." : "Approval request expired; nothing was done." };
    };

    if (caps.includes("exec")) {
      tools[`node_${s}_exec`] = tool({
        description: `Run a shell command on node "${node.name}" (${node.platform ?? "machine"}; ${node.platform === "windows" ? "PowerShell" : "bash"}). ${
          needsApproval && !autoApprove.has("exec") ? "The owner must approve each command in chat before it runs (they can answer Allow once, Always or Deny); show the exact command you intend to run." : "Runs without approval."
        } Default timeout 60s (max 300): when the timeout hits, the process is killed. Anything that can take longer (downloads, installs, builds, long scripts) MUST use background=true: it starts detached, returns a jobId at once and keeps running; follow it with the jobs tool (status / tail) and read its output from jobs/<id>.log in the shared folder. Returns exit code, stdout, stderr.`,
        inputSchema: z.object({
          command: z.string().min(1).max(8000),
          timeoutSec: z.number().int().min(1).max(300).optional(),
          cwd: z.string().max(400).optional(),
          background: z.boolean().default(false).describe("Detach and return a jobId immediately; required for work longer than the timeout."),
        }),
        execute: async ({ command, timeoutSec, cwd, background }) => {
          if (needsApproval) {
            const denied = await approve(`node_${s}_exec`, { command, timeoutSec, cwd, background }, `${background ? "[background] " : ""}${command}`, "exec");
            if (denied) return denied;
          }
          return safe(() => call("exec", { command, timeoutSec, cwd, background, env: ctx.env ?? {} }, background ? 20_000 : ((timeoutSec ?? 60) + 15) * 1000));
        },
      });
    }
    if (caps.includes("exec.jobs")) {
      tools[`node_${s}_jobs`] = tool({
        description: `Background jobs started with exec background=true on node "${node.name}": list them, check status, tail the log (last N lines), or kill one. Free, no approval. Poll with tail every so often instead of blocking; do not re-run a job that is still running.`,
        inputSchema: z.object({ action: z.enum(["list", "status", "tail", "kill"]).default("list"), jobId: z.string().max(40).optional(), lines: z.number().int().min(1).max(400).optional() }),
        execute: ({ action, jobId, lines }) => safe(() => call("exec.jobs", { action, jobId, lines }, 30_000)),
      });
    }

    if (caps.includes("system.clipboard")) {
      tools[`node_${s}_clipboard`] = tool({
        description: `Clipboard of node "${node.name}": read the current text (needs the owner's approval, it may hold private data) or write text to it (free). Useful to hand text to the owner or to pick up what they copied.`,
        inputSchema: z.object({ action: z.enum(["read", "write"]).default("read"), text: z.string().max(100_000).optional().describe("write: the text to put on the clipboard") }),
        execute: async ({ action, text }) => {
          if (action === "read" && needsApproval) {
            const denied = await approve(`node_${s}_clipboard`, { action }, "read the clipboard", "system.clipboard");
            if (denied) return denied;
          }
          return safe(() => call("system.clipboard", { action, text }, 20_000));
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
      const profileArg = z.string().max(32).optional().describe('Brave profile name (see browser_profiles); omit for "default". Each profile has its own cookies and logins.');

      if (browserCaps.includes("browser.open")) {
        tools[`node_${s}_browser_open`] = tool({
          description: `Open a URL in ${where}. Returns the tab id, final URL and title. Follow with browser_snapshot to read the page.${gate}`,
          inputSchema: z.object({ url: z.string().min(1).max(2000), tabId: tabArg.describe("Navigate an existing tab instead of opening a new one."), profile: profileArg }),
          execute: async ({ url, tabId, profile }) => {
            if (needsApproval) {
              const denied = await approve(`node_${s}_browser_open`, { url, tabId, profile }, `open ${url}${profile ? ` (profile ${profile})` : ""}`, "browser.open");
              if (denied) return denied;
            }
            return safe(() => call("browser.open", { url, tabId, profile }, 45_000));
          },
        });
      }
      if (browserCaps.includes("browser.snapshot")) {
        tools[`node_${s}_browser_snapshot`] = tool({
          description: `Read the current page in ${where} as text: headings, paragraphs, links and form controls with refs like [e12] you can pass to browser_click / browser_type. Truncated at ~20k characters; pass scrollTo (pixels) to read further down. Free, no approval.`,
          inputSchema: z.object({ tabId: tabArg, scrollTo: z.number().int().min(0).optional(), profile: profileArg }),
          execute: ({ tabId, scrollTo, profile }) => safe(() => call("browser.snapshot", { tabId, scrollTo, profile }, 30_000)),
        });
      }
      if (browserCaps.includes("browser.click")) {
        tools[`node_${s}_browser_click`] = tool({
          description: `Click an element in ${where} by ref or CSS selector. Refs change after navigation; take a fresh snapshot afterwards.${gate}`,
          inputSchema: z.object({ target: refArg, tabId: tabArg, profile: profileArg }),
          execute: async ({ target, tabId, profile }) => {
            if (needsApproval) {
              const denied = await approve(`node_${s}_browser_click`, { target, tabId, profile }, `click ${target}`, "browser.click");
              if (denied) return denied;
            }
            return safe(() => call("browser.click", { target, tabId, profile }, 30_000));
          },
        });
      }
      if (browserCaps.includes("browser.type")) {
        tools[`node_${s}_browser_type`] = tool({
          description: `Type into an input in ${where} (replaces the current value unless clear=false); enter=true submits with Enter. Never type passwords or payment details.${gate}`,
          inputSchema: z.object({ target: refArg, text: z.string().max(4000), enter: z.boolean().default(false), clear: z.boolean().default(true), tabId: tabArg, profile: profileArg }),
          execute: async ({ target, text, enter, clear, tabId, profile }) => {
            if (needsApproval) {
              const denied = await approve(`node_${s}_browser_type`, { target, text, enter, clear, tabId, profile }, `type "${text.slice(0, 200)}"${enter ? " + Enter" : ""} into ${target}`, "browser.type");
              if (denied) return denied;
            }
            return safe(() => call("browser.type", { target, text, enter, clear, tabId, profile }, 30_000));
          },
        });
      }
      if (browserCaps.includes("browser.screenshot")) {
        type ShotInput = { tabId?: string; fullPage: boolean; profile?: string };
        type Shot = { error?: string; tabId?: string; url?: string; title?: string; bytes?: number; nodePath?: string; path?: string; data?: string; mediaType?: "image/png" };
        tools[`node_${s}_browser_screenshot`] = tool({
          description: `Screenshot the page in ${where} (PNG). You see the image, and it is saved to your cloud workspace under inbox/ so you can attach it with a MEDIA: line. Free, no approval.`,
          inputSchema: z.object({ tabId: tabArg, fullPage: z.boolean().default(false), profile: profileArg }),
          execute: async ({ tabId, fullPage, profile }: ShotInput): Promise<Shot> => {
            const r = await safe(() => call<{ tabId: string; path: string; data: string; url: string; title: string; bytes: number }>("browser.screenshot", { tabId, fullPage, profile }, 45_000));
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
      if (browserCaps.includes("browser.eval")) {
        tools[`node_${s}_browser_eval`] = tool({
          description: `Run JavaScript in the page in ${where} and get the (awaited) result as JSON: read data the snapshot cannot show, call page functions, change the DOM, read localStorage. Expression or statements; max 20k chars back.${gate}`,
          inputSchema: z.object({ expression: z.string().min(1).max(20_000), tabId: tabArg, profile: profileArg }),
          execute: async ({ expression, tabId, profile }) => {
            if (needsApproval) {
              const denied = await approve(`node_${s}_browser_eval`, { expression, tabId, profile }, `eval ${expression.slice(0, 300)}`, "browser.eval");
              if (denied) return denied;
            }
            return safe(() => call("browser.eval", { expression, tabId, profile }, 45_000));
          },
        });
      }
      if (browserCaps.includes("browser.interact")) {
        const interact = (action: string, params: Record<string, unknown>, preview: string, gated: boolean) => async () => {
          if (gated && needsApproval) {
            const denied = await approve(`node_${s}_browser_${action}`, params, preview, "browser.interact");
            if (denied) return denied;
          }
          return safe(() => call("browser.interact", { action, ...params }, 65_000));
        };
        tools[`node_${s}_browser_press`] = tool({
          description: `Press a key in ${where}: Enter, Tab, Escape, Backspace, Delete, Arrow keys, Home/End, PageUp/PageDown, Space, F1-F12 or one character, with optional modifiers (ctrl, shift, alt, meta). Optionally focus a target first.${gate}`,
          inputSchema: z.object({ key: z.string().min(1).max(20), modifiers: z.array(z.enum(["ctrl", "shift", "alt", "meta"])).optional(), target: refArg.optional(), tabId: tabArg, profile: profileArg }),
          execute: ({ key, modifiers, target, tabId, profile }) => interact("press", { key, modifiers, target, tabId, profile }, `press ${[...(modifiers ?? []), key].join("+")}${target ? ` in ${target}` : ""}`, true)(),
        });
        tools[`node_${s}_browser_scroll`] = tool({
          description: `Scroll the page in ${where}: by direction (down/up a screen, top, bottom), to a pixel offset, or until an element is in view. Free, no approval.`,
          inputSchema: z.object({ direction: z.enum(["down", "up", "top", "bottom"]).optional(), amount: z.number().int().min(1).max(20_000).optional().describe("pixels, for up/down"), y: z.number().int().min(0).optional(), target: refArg.optional(), tabId: tabArg, profile: profileArg }),
          execute: ({ direction, amount, y, target, tabId, profile }) => interact("scroll", { direction, amount, y, target, tabId, profile }, "", false)(),
        });
        tools[`node_${s}_browser_hover`] = tool({
          description: `Move the mouse over an element in ${where} (opens hover menus, tooltips). Free, no approval.`,
          inputSchema: z.object({ target: refArg, tabId: tabArg, profile: profileArg }),
          execute: ({ target, tabId, profile }) => interact("hover", { target, tabId, profile }, "", false)(),
        });
        tools[`node_${s}_browser_drag`] = tool({
          description: `Drag and drop in ${where}: press on one element and release on another (ref/selector) or at page coordinates x,y. Works for sortable lists, kanban boards, sliders and HTML5 drag targets (the drop data is forwarded).${gate}`,
          inputSchema: z.object({ target: refArg.describe("element to drag"), to: refArg.optional().describe("drop target (ref or selector)"), x: z.number().optional(), y: z.number().optional(), tabId: tabArg, profile: profileArg }),
          execute: ({ target, to, x, y, tabId, profile }) => interact("drag", { target, to, x, y, tabId, profile }, `drag ${target} to ${to ?? `${x},${y}`}`, true)(),
        });
        tools[`node_${s}_browser_select`] = tool({
          description: `Choose an option in a <select> dropdown in ${where} by value or visible label; returns the available options when nothing matches.${gate}`,
          inputSchema: z.object({ target: refArg, value: z.string().max(500).optional(), label: z.string().max(500).optional(), tabId: tabArg, profile: profileArg }),
          execute: ({ target, value, label, tabId, profile }) => interact("select", { target, value, label, tabId, profile }, `select ${label ?? value} in ${target}`, true)(),
        });
        tools[`node_${s}_browser_navigate`] = tool({
          description: `History navigation in ${where}: back, forward or reload the current tab.${gate}`,
          inputSchema: z.object({ action: z.enum(["back", "forward", "reload"]), hard: z.boolean().default(false).describe("reload ignoring cache"), tabId: tabArg, profile: profileArg }),
          execute: ({ action, hard, tabId, profile }) => interact(action, { hard, tabId, profile }, action, true)(),
        });
        tools[`node_${s}_browser_wait`] = tool({
          description: `Wait in ${where} until an element (ref or selector) is visible and/or a text appears on the page, up to timeoutMs (default 10s, max 60s); with neither, just pauses. Free, no approval.`,
          inputSchema: z.object({ target: refArg.optional(), text: z.string().max(300).optional(), timeoutMs: z.number().int().min(500).max(60_000).optional(), tabId: tabArg, profile: profileArg }),
          execute: ({ target, text, timeoutMs, tabId, profile }) => interact("wait", { target, text, timeoutMs, tabId, profile }, "", false)(),
        });
      }
      if (browserCaps.includes("browser.html")) {
        tools[`node_${s}_browser_html`] = tool({
          description: `Raw HTML of the page in ${where}, or of one element (ref/selector), truncated at 60k chars. Prefer browser_snapshot for reading; use this for markup, attributes, hidden data. Free, no approval.`,
          inputSchema: z.object({ target: refArg.optional(), tabId: tabArg, profile: profileArg }),
          execute: ({ target, tabId, profile }) => safe(() => call("browser.html", { target, tabId, profile }, 30_000)),
        });
      }
      if (browserCaps.includes("browser.pdf")) {
        tools[`node_${s}_browser_pdf`] = tool({
          description: `Save the page in ${where} as a PDF into your cloud workspace inbox/ (attach with MEDIA:). Free, no approval.`,
          inputSchema: z.object({ tabId: tabArg, profile: profileArg }),
          execute: async ({ tabId, profile }) => {
            const r = await safe(() => call<{ tabId: string; path: string; data: string; url: string; title: string; bytes: number }>("browser.pdf", { tabId, profile }, 60_000));
            if (!("data" in r) || !r.data) return r;
            let cloudPath: string | undefined;
            if (ctx.workspace) {
              const rel = `inbox/node-${s}-${path.basename(r.path)}`;
              const abs = ctx.workspace.resolve(rel);
              await mkdir(path.dirname(abs), { recursive: true });
              await writeFile(abs, Buffer.from(r.data, "base64"));
              cloudPath = rel;
            }
            return { tabId: r.tabId, url: r.url, title: r.title, bytes: r.bytes, path: cloudPath, attach: cloudPath ? `MEDIA:${cloudPath}` : undefined };
          },
        });
      }
      if (browserCaps.includes("browser.cookies")) {
        tools[`node_${s}_browser_cookies`] = tool({
          description: `Cookies of the Brave profile in ${where}. list: names/domains/expiry for the current site (all=true for every site; includeValues only when the owner asks). export: writes a Netscape cookies.txt into the shared folder (cookies/<host>.txt) for tools like yt-dlp / curl --cookie. import: load a cookies.txt from the shared folder. clear: delete the site's (or all) cookies. export, import and clear need approval; list is free.`,
          inputSchema: z.object({ action: z.enum(["list", "export", "import", "clear"]).default("list"), all: z.boolean().default(false), includeValues: z.boolean().default(false), path: z.string().max(400).optional().describe("import: cookies.txt path inside the shared folder"), tabId: tabArg, profile: profileArg }),
          execute: async ({ action, all, includeValues, path: filePath, tabId, profile }) => {
            if (action !== "list" && needsApproval) {
              const denied = await approve(`node_${s}_browser_cookies`, { action, all, path: filePath, tabId, profile }, `cookies ${action}${all ? " (all sites)" : ""}${filePath ? ` ${filePath}` : ""}`, "browser.cookies");
              if (denied) return denied;
            }
            return safe(() => call("browser.cookies", { action, all, includeValues, path: filePath, tabId, profile }, 30_000));
          },
        });
      }
      if (browserCaps.includes("browser.upload")) {
        tools[`node_${s}_browser_upload`] = tool({
          description: `Attach files from the node's shared folder to a file input in ${where} (target = ref or selector of the <input type=file>). Then click the page's submit/upload button yourself.${gate}`,
          inputSchema: z.object({ target: refArg, files: z.array(z.string().min(1).max(400)).min(1).max(20).describe("paths inside the shared folder, e.g. downloads/report.pdf"), tabId: tabArg, profile: profileArg }),
          execute: async ({ target, files, tabId, profile }) => {
            if (needsApproval) {
              const denied = await approve(`node_${s}_browser_upload`, { target, files, tabId, profile }, `upload ${files.join(", ")} to ${target}`, "browser.upload");
              if (denied) return denied;
            }
            return safe(() => call("browser.upload", { target, files, tabId, profile }, 30_000));
          },
        });
      }
      if (browserCaps.includes("browser.downloads")) {
        tools[`node_${s}_browser_downloads`] = tool({
          description: `Files the browser in ${where} downloaded (they land in the shared folder under downloads/; .crdownload = still in progress). Free, no approval.`,
          inputSchema: z.object({}),
          execute: () => safe(() => call("browser.downloads", {}, 20_000)),
        });
      }
      if (browserCaps.includes("browser.network")) {
        tools[`node_${s}_browser_network`] = tool({
          description: `Network requests the page made in ${where} (recorded since the tab was first used): list them (filter by URL substring, types like XHR/Fetch/Document/Script/Image), fetch one response body by requestId (JSON APIs, HTML fragments; up to 200k chars), or clear the log. Use it to read data behind a page's API calls instead of scraping the DOM. Free, no approval.`,
          inputSchema: z.object({
            action: z.enum(["list", "body", "clear"]).default("list"),
            filter: z.string().max(300).optional().describe("list: only URLs (or POST bodies) containing this"),
            types: z.array(z.string().max(20)).optional().describe("list: resource types, e.g. [\"XHR\",\"Fetch\"]"),
            limit: z.number().int().min(1).max(400).optional(),
            includePostData: z.boolean().default(false),
            requestId: z.string().max(60).optional().describe("body: id from the list"),
            maxChars: z.number().int().min(1000).max(200_000).optional(),
            tabId: tabArg,
            profile: profileArg,
          }),
          execute: (args) => safe(() => call("browser.network", args, 30_000)),
        });
      }
      if (browserCaps.includes("browser.profiles")) {
        tools[`node_${s}_browser_profiles`] = tool({
          description: `Brave profiles in ${where}: each profile is a separate browser with its own cookies and logins (e.g. two accounts of the same site). list (free), create a new one, close its window, or delete it with all its data (delete needs approval). Pass profile=<name> to the other browser tools to use it.`,
          inputSchema: z.object({ action: z.enum(["list", "create", "close", "delete"]).default("list"), name: z.string().max(32).optional() }),
          execute: async ({ action, name }) => {
            if (action === "delete" && needsApproval) {
              const denied = await approve(`node_${s}_browser_profiles`, { action, name }, `delete browser profile ${name}`, "browser.profiles");
              if (denied) return denied;
            }
            return safe(() => call("browser.profiles", { action, name }, 30_000));
          },
        });
      }
      if (browserCaps.includes("browser.tabs")) {
        tools[`node_${s}_browser_tabs`] = tool({
          description: `List or close tabs in ${where}. Free, no approval.`,
          inputSchema: z.object({ action: z.enum(["list", "close", "activate"]).default("list"), tabId: tabArg, profile: profileArg }),
          execute: ({ action, tabId, profile }) => safe(() => call("browser.tabs", { action, tabId, profile }, 20_000)),
        });
      }
    }
  }
  return { tools, summary };
}

export type { Node };
