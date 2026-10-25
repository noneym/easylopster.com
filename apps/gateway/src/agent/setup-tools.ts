import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@easylopster/db";
import { encrypt, pairingCode } from "@easylopster/shared/crypto";
import { connectMcp, type McpTransport } from "@easylopster/shared/mcp";
import { env } from "../env.ts";
import { limitsFor } from "@easylopster/shared/limits";

/**
 * Conversational setup: the same operations the dashboard forms do (MCP servers, nodes, API keys /
 * model, secrets) exposed as tools so the owner can configure the bot by talking to it. Everything
 * is scoped to the bot's owner and mirrors the dashboard's beta limits.
 */
export interface SetupContext {
  botId: string;
  userId: string;
  conversationId: string;
}

/** Effective quotas of the bot's owner (admin overrides applied). */
async function ownerLimits(userId: string) {
  return limitsFor(await db.user.findUnique({ where: { id: userId }, select: { limitNodes: true, limitMcp: true, limitBots: true, limitMessagesPerDay: true } }));
}
const PAIRING_TTL_MS = 15 * 60_000;
const RELEASES_URL = "https://github.com/noneym/easylopster.com/releases/latest";

const err = (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) });

export function setupTools(ctx: SetupContext): ToolSet {
  return {
    setup_keys: tool({
      description:
        "API keys and models. `list` shows the owner's provider keys with the models each one reported, and which key/model this bot uses now. `set_model` switches this bot to a key (by id or label) and model id from that list. Keys themselves are added in the dashboard (the owner pastes them there, never in chat).",
      inputSchema: z.object({
        action: z.enum(["list", "set_model"]),
        key: z.string().optional().describe("Key id or label (for set_model)"),
        model: z.string().optional().describe("Model id as listed (for set_model)"),
      }),
      execute: async ({ action, key, model }) => {
        const keys = await db.providerKey.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "asc" } });
        const bot = await db.bot.findUnique({ where: { id: ctx.botId }, select: { providerKeyId: true, model: true } });
        if (action === "list") {
          return {
            current: { keyId: bot?.providerKeyId, model: bot?.model },
            keys: keys.map((k) => ({
              id: k.id,
              label: k.label,
              provider: k.provider,
              defaultModel: k.defaultModel,
              lastTestOk: k.lastTestOk,
              models: Array.isArray(k.modelsCache) ? (k.modelsCache as string[]).slice(0, 80) : [],
            })),
            note: "To add a key the owner opens Dashboard → API keys.",
          };
        }
        const k = keys.find((x) => x.id === key || x.label.toLowerCase() === (key ?? "").toLowerCase()) ?? (keys.length === 1 ? keys[0] : undefined);
        if (!k) return { error: `Key not found. Available: ${keys.map((x) => `${x.label} (${x.id})`).join(", ") || "none"}` };
        const models = Array.isArray(k.modelsCache) ? (k.modelsCache as string[]) : [];
        const m = (model ?? "").trim() || k.defaultModel;
        if (models.length && !models.includes(m)) return { error: `${m} is not in the model list of ${k.label}. Pick one of: ${models.slice(0, 40).join(", ")}` };
        await db.bot.update({ where: { id: ctx.botId }, data: { providerKeyId: k.id, model: m } });
        return { ok: true, key: k.label, model: m, note: "Takes effect on the next message." };
      },
    }),

    setup_mcp: tool({
      description:
        "MCP servers (remote, Streamable HTTP or SSE). `list` shows the owner's servers and which are linked to this bot. `add` connects to a URL (optional headers like Authorization), stores it and links it to this bot; it fails loudly if the server does not answer. `link`/`unlink` attach an existing server to this bot; `remove` deletes a server from the account.",
      inputSchema: z.object({
        action: z.enum(["list", "add", "link", "unlink", "remove"]),
        name: z.string().max(60).optional().describe("Server name (add) or name/id (link, unlink, remove)"),
        url: z.string().url().optional(),
        transport: z.enum(["streamable-http", "sse"]).default("streamable-http"),
        headers: z.record(z.string(), z.string()).optional().describe('e.g. {"Authorization": "Bearer ..."}'),
      }),
      execute: async ({ action, name, url, transport, headers }) => {
        const servers = await db.mcpServer.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "asc" }, include: { bots: { where: { botId: ctx.botId } } } });
        const find = () => servers.find((s) => s.id === name || s.name.toLowerCase() === (name ?? "").toLowerCase());
        if (action === "list") {
          return {
            servers: servers.map((s) => ({
              id: s.id,
              name: s.name,
              url: s.url,
              status: s.status,
              linkedToThisBot: s.bots.length > 0,
              tools: Array.isArray(s.toolsCache) ? (s.toolsCache as { name: string }[]).map((t) => t.name).slice(0, 60) : [],
            })),
          };
        }
        if (action === "add") {
          if (!url || !name) return { error: "name and url are required" };
          const limits = await ownerLimits(ctx.userId);
          if (servers.length >= limits.mcp) return { error: `This account allows ${limits.mcp} MCP servers.` };
          if (find()) return { error: `A server named ${name} already exists; use link instead.` };
          let probe;
          try {
            const conn = await connectMcp({ url, transport: transport as McpTransport, headers: headers ?? {} });
            probe = { tools: conn.tools, serverName: conn.serverName };
            await conn.close();
          } catch (e) {
            return { error: `Could not connect: ${(e as Error).message}. Check the URL, transport and headers.` };
          }
          const row = await db.mcpServer.create({
            data: {
              userId: ctx.userId,
              name,
              transport,
              url,
              encHeaders: headers && Object.keys(headers).length ? encrypt(JSON.stringify(headers)) : null,
              status: "ok",
              toolsCache: JSON.parse(JSON.stringify(probe.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })))),
              toolsSyncAt: new Date(),
              bots: { create: { botId: ctx.botId } },
            },
          });
          return { ok: true, id: row.id, server: probe.serverName, tools: probe.tools.map((t) => t.name), note: "Linked to this bot; its tools appear on the next message." };
        }
        const s = find();
        if (!s) return { error: `No server named ${name}. Known: ${servers.map((x) => x.name).join(", ") || "none"}` };
        if (action === "link") {
          await db.botMcp.upsert({ where: { botId_mcpServerId: { botId: ctx.botId, mcpServerId: s.id } }, create: { botId: ctx.botId, mcpServerId: s.id }, update: {} });
          return { ok: true, linked: s.name };
        }
        if (action === "unlink") {
          await db.botMcp.deleteMany({ where: { botId: ctx.botId, mcpServerId: s.id } });
          return { ok: true, unlinked: s.name };
        }
        await db.mcpServer.delete({ where: { id: s.id } });
        return { ok: true, removed: s.name };
      },
    }),

    setup_node: tool({
      description:
        "The owner's own machines (nodes). `list` shows nodes, status and whether they are linked to this bot. `pair` creates a node with a 15-minute pairing code and returns install instructions (Windows app, npx or Docker) for the owner to run on that machine; once it connects it is linked to this bot automatically. `link`/`unlink` attach an existing node to this bot.",
      inputSchema: z.object({
        action: z.enum(["list", "pair", "link", "unlink"]),
        name: z.string().max(60).optional().describe("Node name, e.g. 'office pc' (pair) or name/id (link, unlink)"),
      }),
      execute: async ({ action, name }) => {
        const nodes = await db.node.findMany({ where: { userId: ctx.userId, status: { not: "revoked" } }, orderBy: { createdAt: "asc" }, include: { bots: { where: { botId: ctx.botId } } } });
        const find = () => nodes.find((n) => n.id === name || n.name.toLowerCase() === (name ?? "").toLowerCase());
        if (action === "list") {
          return {
            nodes: nodes.map((n) => ({ id: n.id, name: n.name, status: n.status, platform: n.platform, linkedToThisBot: n.bots.length > 0, caps: n.enabledCaps ?? n.caps, workspaceRoot: n.workspaceRoot, lastSeenAt: n.lastSeenAt })),
          };
        }
        if (action === "pair") {
          if (!name) return { error: "Give the node a name" };
          const limits = await ownerLimits(ctx.userId);
          if (nodes.length >= limits.nodes) return { error: `This account allows ${limits.nodes} nodes.` };
          let code = pairingCode(2, 4);
          for (let i = 0; i < 5 && (await db.node.findUnique({ where: { pairingCode: code } })); i++) code = pairingCode(2, 4);
          const node = await db.node.create({
            data: { userId: ctx.userId, name, pairingCode: code, pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS), status: "pending", bots: { create: { botId: ctx.botId } } },
          });
          const gw = env().GATEWAY_WS_URL;
          return {
            ok: true,
            nodeId: node.id,
            pairingCode: code,
            expiresInMinutes: 15,
            install: {
              windows: `Install "easylopster Node" from ${RELEASES_URL} (easylopster-node-setup-*.exe), open it from the tray and enter the code ${code}.`,
              npx: `npx easylopster-node connect ${code} --gateway ${gw} --workspace ~/easylopster`,
              docker: `docker run -d --name easylopster-node --restart unless-stopped -e EASYLOPSTER_PAIRING_CODE=${code} -e EASYLOPSTER_GATEWAY=${gw} -v easylopster-node:/data ghcr.io/noneym/easylopster-node:latest`,
            },
            note: "Show the code and the matching instructions to the owner. Capabilities (files, exec, notifications) are enabled on the node page in the dashboard after it connects; exec asks for approval in chat by default.",
          };
        }
        const n = find();
        if (!n) return { error: `No node named ${name}. Known: ${nodes.map((x) => x.name).join(", ") || "none"}` };
        if (action === "link") {
          await db.botNode.upsert({ where: { botId_nodeId: { botId: ctx.botId, nodeId: n.id } }, create: { botId: ctx.botId, nodeId: n.id }, update: {} });
          return { ok: true, linked: n.name };
        }
        await db.botNode.deleteMany({ where: { botId: ctx.botId, nodeId: n.id } });
        return { ok: true, unlinked: n.name };
      },
    }),
  };
}

/**
 * Secrets tool with write access (replaces the read-only one when setup is available). A value
 * the owner pastes in chat is encrypted at rest, linked to this bot, and scrubbed from the stored
 * chat transcript; the model still sees it once in the current turn.
 */
export function secretsSetupTools(ctx: SetupContext, meta: { name: string; description: string | null }[]): ToolSet {
  return {
    secrets: tool({
      description:
        "Protected credentials for exec on the sandbox or nodes, injected as environment variables ($NAME). `list` shows names/descriptions available to this bot. `set` stores a value the owner gives you (encrypted; the chat log is scrubbed afterwards) and links it to this bot. `link` attaches an existing secret of the account to this bot; `unlink` detaches it; `remove` deletes it from the account. Never echo a value back.",
      inputSchema: z.object({
        action: z.enum(["list", "set", "link", "unlink", "remove"]),
        name: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/, "ENV_STYLE_NAME").optional(),
        value: z.string().max(20_000).optional(),
        description: z.string().max(300).optional(),
      }),
      execute: async ({ action, name, value, description }) => {
        if (action === "list") {
          const all = await db.secret.findMany({ where: { userId: ctx.userId }, select: { name: true, description: true }, orderBy: { name: "asc" } });
          const linked = new Set(meta.map((m) => m.name));
          return { secrets: all.map((s) => ({ name: s.name, description: s.description, linkedToThisBot: linked.has(s.name) })), note: "Linked ones are available in exec as $NAME on the next turn." };
        }
        if (!name) return { error: "name is required" };
        if (action === "set") {
          if (!value) return { error: "value is required" };
          const row = await db.secret.upsert({
            where: { userId_name: { userId: ctx.userId, name } },
            create: { userId: ctx.userId, name, encValue: encrypt(value), description: description ?? null },
            update: { encValue: encrypt(value), ...(description ? { description } : {}) },
          });
          await db.botSecret.upsert({ where: { botId_secretId: { botId: ctx.botId, secretId: row.id } }, create: { botId: ctx.botId, secretId: row.id }, update: {} });
          // Scrub the plaintext from the stored transcript of this conversation.
          const recent = await db.message.findMany({ where: { conversationId: ctx.conversationId, role: "user" }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, text: true } });
          for (const m of recent) {
            if (m.text && m.text.includes(value)) {
              const scrubbed = m.text.split(value).join("[secret redacted]");
              await db.message.update({ where: { id: m.id }, data: { text: scrubbed, content: { text: scrubbed } } });
            }
          }
          return { ok: true, name, note: `Stored encrypted and linked to this bot as $${name}; the value was removed from the chat history.` };
        }
        const s = await db.secret.findUnique({ where: { userId_name: { userId: ctx.userId, name } } });
        if (!s) return { error: `No secret named ${name}` };
        if (action === "link") {
          await db.botSecret.upsert({ where: { botId_secretId: { botId: ctx.botId, secretId: s.id } }, create: { botId: ctx.botId, secretId: s.id }, update: {} });
          return { ok: true, linked: name };
        }
        if (action === "unlink") {
          await db.botSecret.deleteMany({ where: { botId: ctx.botId, secretId: s.id } });
          return { ok: true, unlinked: name };
        }
        await db.secret.delete({ where: { id: s.id } });
        return { ok: true, removed: name };
      },
    }),
  };
}
