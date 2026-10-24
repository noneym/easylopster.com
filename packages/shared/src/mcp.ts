import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export type McpTransport = "streamable-http" | "sse";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpConnection {
  client: Client;
  tools: McpToolInfo[];
  serverName?: string;
  serverVersion?: string;
  instructions?: string;
  close: () => Promise<void>;
}

const CONNECT_TIMEOUT_MS = 15_000;

/**
 * Opens an MCP session over streamable-http (preferred) or SSE, lists tools and returns the live
 * client. Callers must close() it. Throws on auth/network failures with a readable message.
 */
export async function connectMcp(opts: { url: string; transport: McpTransport; headers?: Record<string, string> }): Promise<McpConnection> {
  const url = new URL(opts.url);
  const headers = opts.headers ?? {};
  const makeTransport = () =>
    opts.transport === "sse"
      ? new SSEClientTransport(url, { requestInit: { headers }, eventSourceInit: { fetch: (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), ...headers } }) } })
      : new StreamableHTTPClientTransport(url, { requestInit: { headers } });

  const client = new Client({ name: "easylopster", version: "0.1.0" }, { capabilities: {} });
  const transport = makeTransport();
  const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`MCP server did not answer within ${CONNECT_TIMEOUT_MS / 1000}s`)), CONNECT_TIMEOUT_MS));
  try {
    await Promise.race([client.connect(transport), timer]);
    const listed = await Promise.race([client.listTools(), timer]);
    const info = client.getServerVersion();
    return {
      client,
      tools: listed.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} } })),
      serverName: info?.name,
      serverVersion: info?.version,
      instructions: client.getInstructions(),
      close: () => client.close().catch(() => {}),
    };
  } catch (err) {
    await client.close().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg.replace(/^Error:\s*/, "").slice(0, 400));
  }
}

/** Sanitizes "<server label>__<tool>" into a provider-safe tool name. */
export function mcpToolName(serverSlug: string, tool: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return `mcp_${clean(serverSlug)}__${clean(tool)}`.slice(0, 64);
}
