import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import { db, type McpServer } from "@easylopster/db";
import { decrypt } from "@easylopster/shared/crypto";
import { connectMcp, mcpToolName, type McpConnection, type McpTransport } from "@easylopster/shared/mcp";

const CALL_TIMEOUT_MS = 60_000;
const IDLE_CLOSE_MS = 10 * 60_000;

interface Pooled {
  conn: Promise<McpConnection>;
  lastUsed: number;
  updatedAt: number;
}

/** One live MCP session per server, shared across runs, closed after 10 minutes idle. */
const pool = new Map<string, Pooled>();

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of pool) {
    if (now - p.lastUsed > IDLE_CLOSE_MS) {
      pool.delete(id);
      void p.conn.then((c) => c.close()).catch(() => {});
    }
  }
}, 60_000).unref();

async function getConnection(server: McpServer): Promise<McpConnection> {
  const existing = pool.get(server.id);
  if (existing && existing.updatedAt === server.updatedAt.getTime()) {
    existing.lastUsed = Date.now();
    try {
      return await existing.conn;
    } catch {
      pool.delete(server.id);
    }
  } else if (existing) {
    pool.delete(server.id);
    void existing.conn.then((c) => c.close()).catch(() => {});
  }
  const headers = server.encHeaders ? (JSON.parse(decrypt(server.encHeaders)) as Record<string, string>) : {};
  const conn = connectMcp({ url: server.url, transport: server.transport as McpTransport, headers });
  pool.set(server.id, { conn, lastUsed: Date.now(), updatedAt: server.updatedAt.getTime() });
  conn.catch(() => pool.delete(server.id));
  return conn;
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "server";
}

export interface BotMcpTools {
  tools: ToolSet;
  instructions: { server: string; text: string }[];
  errors: string[];
}

/** Builds AI SDK tools for every MCP server linked to a bot. Failures degrade to a note, never block the run. */
export async function mcpToolsForBot(botId: string): Promise<BotMcpTools> {
  const links = await db.botMcp.findMany({ where: { botId }, include: { mcpServer: true } });
  const tools: ToolSet = {};
  const instructions: { server: string; text: string }[] = [];
  const errors: string[] = [];

  await Promise.all(
    links.map(async (link) => {
      const server = link.mcpServer;
      let conn: McpConnection;
      try {
        conn = await getConnection(server);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${server.name}: ${msg}`);
        await db.mcpServer.update({ where: { id: server.id }, data: { status: "error", lastError: msg.slice(0, 1000) } }).catch(() => {});
        return;
      }
      const allowed = Array.isArray(link.allowedTools) ? new Set(link.allowedTools as string[]) : null;
      if (conn.instructions) instructions.push({ server: server.name, text: conn.instructions });
      for (const t of conn.tools) {
        if (allowed && !allowed.has(t.name)) continue;
        const name = mcpToolName(slug(server.name), t.name);
        tools[name] = dynamicTool({
          description: `[${server.name}] ${t.description ?? t.name}`.slice(0, 1024),
          inputSchema: jsonSchema(t.inputSchema as never),
          execute: async (input) => {
            const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${t.name} timed out after ${CALL_TIMEOUT_MS / 1000}s`)), CALL_TIMEOUT_MS));
            try {
              const result = (await Promise.race([conn.client.callTool({ name: t.name, arguments: (input ?? {}) as Record<string, unknown> }), timer])) as {
                content?: { type: string; text?: string; data?: string; mimeType?: string }[];
                isError?: boolean;
                structuredContent?: unknown;
              };
              const text = (result.content ?? [])
                .map((c) => (c.type === "text" ? c.text ?? "" : c.type === "image" ? `[image ${c.mimeType ?? ""}]` : `[${c.type}]`))
                .join("\n")
                .slice(0, 40_000);
              return result.isError ? { error: text || "tool reported an error" } : result.structuredContent ?? { result: text };
            } catch (err) {
              // Connection may be dead; drop it so the next run reconnects.
              pool.delete(server.id);
              return { error: err instanceof Error ? err.message : String(err) };
            }
          },
        });
      }
    }),
  );

  return { tools, instructions, errors };
}
