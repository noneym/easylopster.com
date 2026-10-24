import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Workspace } from "../workspace/fs.ts";

export interface ToolContext {
  ws: Workspace;
  timezone: string;
  now: () => Date;
}

/** Built-in tools available to every bot (fs over the cloud workspace, memory, web fetch, time). */
export function builtinTools(ctx: ToolContext): ToolSet {
  return {
    fs_read: tool({
      description: "Read a text file from the workspace. Path is relative to the workspace root.",
      inputSchema: z.object({ path: z.string().describe("Relative path, e.g. notes/todo.md") }),
      execute: async ({ path }) => {
        try {
          return { path, content: await ctx.ws.read(path) };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
    fs_write: tool({
      description: "Create or overwrite a text file in the workspace. Creates parent folders. SOUL.md and USER.md are read-only.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        if (/^(SOUL|USER)\.md$/i.test(path.replace(/^\.?\//, ""))) return { error: "SOUL.md and USER.md are edited by the owner in the dashboard." };
        try {
          await ctx.ws.write(path, content);
          return { ok: true, path, bytes: Buffer.byteLength(content) };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
    fs_list: tool({
      description: "List files and folders in the workspace (recursive, depth 2 by default).",
      inputSchema: z.object({ path: z.string().default("."), depth: z.number().int().min(0).max(6).default(2) }),
      execute: async ({ path, depth }) => {
        try {
          return { entries: await ctx.ws.list(path, depth) };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
    fs_search: tool({
      description: "Search workspace files (including memory notes) for a text snippet. Case-insensitive. Returns file, line and matching text.",
      inputSchema: z.object({ query: z.string().min(1), regex: z.boolean().default(false), maxResults: z.number().int().min(1).max(100).default(40) }),
      execute: async ({ query, regex, maxResults }) => {
        try {
          return { hits: await ctx.ws.search(query, { regex, maxResults }) };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
    memory_append: tool({
      description:
        "Append a durable note to today's memory file (memory/YYYY-MM-DD.md). Use for facts about the user, decisions, and ongoing work worth remembering across sessions. Keep entries short.",
      inputSchema: z.object({ note: z.string().min(1).max(4000) }),
      execute: async ({ note }) => {
        const now = ctx.now();
        const rel = ctx.ws.dailyMemoryPath(now, ctx.timezone);
        const time = new Intl.DateTimeFormat("en-GB", { timeZone: ctx.timezone, hour: "2-digit", minute: "2-digit" }).format(now);
        const existing = await ctx.ws.readOptional(rel);
        await ctx.ws.append(rel, `${existing ? "" : `# ${rel.slice(7, 17)}\n\n`}- ${time} ${note.trim().replace(/\n+/g, " ")}\n`);
        return { ok: true, file: rel };
      },
    }),
    web_fetch: tool({
      description: "Fetch a public https URL and return its text content (HTML stripped, max 20k chars). Use for reading pages the user links or looking something up.",
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        if (!/^https?:\/\//i.test(url)) return { error: "Only http(s) URLs" };
        const host = new URL(url).hostname;
        if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\])/.test(host)) return { error: "Private hosts are not allowed" };
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 15_000);
          const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "easylopster/0.1 (+https://easylopster.com)" }, redirect: "follow" });
          clearTimeout(t);
          const type = res.headers.get("content-type") ?? "";
          const raw = await res.text();
          const text = /html/i.test(type)
            ? raw
                .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/g, " ")
                .replace(/&amp;/g, "&")
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/\s+\n/g, "\n")
                .replace(/[ \t]{2,}/g, " ")
                .trim()
            : raw;
          return { url, status: res.status, contentType: type, text: text.slice(0, 20_000) };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
    current_time: tool({
      description: "Current date and time in the user's timezone, plus ISO UTC.",
      inputSchema: z.object({}),
      execute: async () => {
        const now = ctx.now();
        return {
          local: new Intl.DateTimeFormat("en-GB", { timeZone: ctx.timezone, dateStyle: "full", timeStyle: "medium" }).format(now),
          timezone: ctx.timezone,
          iso: now.toISOString(),
        };
      },
    }),
  };
}
