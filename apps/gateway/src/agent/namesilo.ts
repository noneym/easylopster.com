import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * NameSilo's "MCP server" (https://mcp.namesilo.com) is plain JSON-RPC 2.0 over HTTP with an
 * X-API-KEY header, not the MCP protocol, so it cannot be added as an MCP server. When a bot has
 * the secret NAMESILO_API_KEY, this built-in tool bridges to it. Method names come from the
 * server's manifest (/.well-known/mcp.json), refreshed hourly; parameters follow NameSilo's API.
 */
const RPC_URL = "https://mcp.namesilo.com/rpc";
const MANIFEST_URL = "https://mcp.namesilo.com/.well-known/mcp.json";
const TIMEOUT_MS = 30_000;

let manifest: { methods: string[]; fetchedAt: number } | null = null;

async function methods(): Promise<string[]> {
  if (manifest && Date.now() - manifest.fetchedAt < 3_600_000) return manifest.methods;
  try {
    const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(10_000) });
    const j = (await res.json()) as { methods?: string[] };
    if (Array.isArray(j.methods) && j.methods.length) manifest = { methods: j.methods, fetchedAt: Date.now() };
  } catch {}
  return manifest?.methods ?? [];
}

export function namesiloTools(apiKey: string): ToolSet {
  return {
    namesilo: tool({
      description:
        "NameSilo domain registrar (JSON-RPC bridge). `list_methods` returns every available method; otherwise pass `method` (e.g. namesilo.listDomains, namesilo.getDomainInfo, namesilo.dnsListRecords, namesilo.dnsAddRecord, namesilo.dnsUpdateRecord, namesilo.dnsDeleteRecord, namesilo.checkRegisterAvailability, namesilo.getAccountBalance, namesilo.changeNameServers, namesilo.listEmailForwards) and `params` as NameSilo's API expects (domain, rrhost, rrtype, rrvalue, rrttl, rrid, ...). Registration, renewal, transfers and fund changes spend money: confirm with the owner first. Set sandbox=true to use NameSilo's test environment.",
      inputSchema: z.object({
        action: z.enum(["call", "list_methods"]).default("call"),
        method: z.string().regex(/^namesilo\.[A-Za-z0-9_]+$/, "namesilo.<method>").optional(),
        params: z.record(z.string(), z.unknown()).default({}),
        sandbox: z.boolean().default(false),
      }),
      execute: async ({ action, method, params, sandbox }) => {
        if (action === "list_methods") {
          const list = await methods();
          return list.length ? { methods: list } : { error: "Could not load the method list; try a method name from NameSilo's API reference." };
        }
        if (!method) return { error: "method is required, e.g. namesilo.listDomains" };
        const known = await methods();
        if (known.length && !known.includes(method)) {
          const near = known.filter((m) => m.toLowerCase().includes(method.split(".")[1]?.toLowerCase().slice(0, 5) ?? "")).slice(0, 8);
          return { error: `Unknown method ${method}.${near.length ? ` Did you mean: ${near.join(", ")}` : ""} Use action list_methods for the full list.` };
        }
        const body = { jsonrpc: "2.0", id: Date.now(), method, params: sandbox ? { ...params, environment: "sandbox" } : params };
        try {
          const res = await fetch(RPC_URL, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json", "X-API-KEY": apiKey },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          const raw = await res.text();
          let j: { result?: unknown; error?: unknown } = {};
          try {
            j = JSON.parse(raw);
          } catch {
            return { error: `NameSilo answered HTTP ${res.status}: ${raw.slice(0, 300)}` };
          }
          if (!res.ok || j.error) return { error: typeof j.error === "string" ? j.error : JSON.stringify(j.error ?? `HTTP ${res.status}`).slice(0, 600) };
          const text = JSON.stringify(j.result ?? j);
          return { method, result: text.length > 20_000 ? JSON.parse(text.slice(0, 1)) ?? text.slice(0, 20_000) : (j.result ?? j), truncated: text.length > 20_000 ? `${text.length} chars, showing the first 20k` : undefined };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
