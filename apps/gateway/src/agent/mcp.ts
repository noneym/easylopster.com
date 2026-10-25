import { dynamicTool, jsonSchema, type ToolSet } from "ai";
import { db, type McpServer } from "@easylopster/db";
import { decrypt, encrypt } from "@easylopster/shared/crypto";
import { connectMcp, mcpToolName, type McpConnection, type McpTransport } from "@easylopster/shared/mcp";
import { McpOAuthProvider, isReauthError, type McpOAuthState } from "@easylopster/shared/mcp-oauth";

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
  const authProvider = oauthProviderFor(server);
  const conn = connectMcp({ url: server.url, transport: server.transport as McpTransport, headers, authProvider });
  pool.set(server.id, { conn, lastUsed: Date.now(), updatedAt: server.updatedAt.getTime() });
  conn.catch(() => pool.delete(server.id));
  return conn;
}

/**
 * OAuth servers: the SDK sends the stored bearer token, refreshes it with the refresh token when it
 * is about to expire or the server answers 401, and we persist every new token set. When refreshing
 * fails the provider throws McpReauthRequiredError (it cannot send the user anywhere), which the
 * callers turn into authStatus "reauth" so the dashboard shows "Sign in again".
 */
function oauthProviderFor(server: McpServer): McpOAuthProvider | undefined {
  if (server.authStatus === "none" || !server.encOAuth) return undefined;
  let state: McpOAuthState;
  try {
    state = JSON.parse(decrypt(server.encOAuth)) as McpOAuthState;
  } catch {
    return undefined;
  }
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return new McpOAuthProvider({
    redirectUrl: `${appUrl}/api/mcp/oauth/callback`,
    appUrl,
    state,
    save: async (st) => {
      // Our own token writes bump updatedAt; keep the pool entry in step so the session is not reopened.
      const row = await db.mcpServer.update({ where: { id: server.id }, data: { encOAuth: encrypt(JSON.stringify(st)), authStatus: "connected" }, select: { updatedAt: true } });
      const pooled = pool.get(server.id);
      if (pooled) pooled.updatedAt = row.updatedAt.getTime();
    },
  });
}

async function recordFailure(server: McpServer, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const reauth = isReauthError(err);
  await db.mcpServer
    .update({
      where: { id: server.id },
      data: { status: "error", lastError: (reauth ? `Sign in again: ${msg}` : msg).slice(0, 1000), ...(reauth ? { authStatus: "reauth" } : {}) },
    })
    .catch(() => {});
  return msg;
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
        const msg = await recordFailure(server, err);
        errors.push(`${server.name}: ${isReauthError(err) ? "the OAuth sign-in expired; the owner must sign in again from the dashboard" : msg}`);
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
              if (isReauthError(err)) await recordFailure(server, err);
              return { error: err instanceof Error ? err.message : String(err) };
            }
          },
        });
      }
    }),
  );

  return { tools, instructions, errors };
}
