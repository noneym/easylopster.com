"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decrypt, encrypt } from "@easylopster/shared/crypto";
import { connectMcp, isAuthRequiredError, type McpTransport } from "@easylopster/shared/mcp";
import { startMcpOAuth as beginOAuth, mcpVendorName, type McpOAuthState } from "@easylopster/shared/mcp-oauth";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { limitsFor } from "@/lib/limits";
import { newOAuthStateParam, providerFor, readOAuthState } from "@/lib/mcp-oauth";

export type McpFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      ok?: boolean;
      message?: string;
      tools?: { name: string; description?: string }[];
      /** The server answered 401 without accepting a token: offer "Sign in with <vendor>". */
      needsOAuth?: { vendor: string };
    }
  | undefined;

const schema = z.object({
  name: z.string().trim().min(1, "Give the server a name").max(60),
  transport: z.enum(["streamable-http", "sse"]),
  url: z.string().trim().url("Enter the full server URL (https://…)"),
  headers: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || ""),
});

function fieldErrorsOf(err: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0])] = i.message;
  return out;
}

/** "Authorization: Bearer x\nX-Api-Key: y" → { Authorization: "Bearer x", ... } */
function parseHeaders(text: string): Record<string, string> | { error: string } {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf(":");
    if (i <= 0) return { error: `Header line without a colon: "${t.slice(0, 40)}"` };
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

async function probe(url: string, transport: McpTransport, headers: Record<string, string>, authProvider?: ReturnType<typeof providerFor>) {
  const conn = await connectMcp({ url, transport, headers, authProvider });
  try {
    return { tools: conn.tools, instructions: conn.instructions, serverName: conn.serverName };
  } finally {
    await conn.close();
  }
}

export async function testMcp(_prev: McpFormState, formData: FormData): Promise<McpFormState> {
  await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
  const headers = parseHeaders(parsed.data.headers);
  if ("error" in headers) return { fieldErrors: { headers: headers.error } };
  try {
    const r = await probe(parsed.data.url, parsed.data.transport, headers);
    return { ok: true, message: `Connected${r.serverName ? ` to ${r.serverName}` : ""}. ${r.tools.length} tools.`, tools: r.tools.map((t) => ({ name: t.name, description: t.description })) };
  } catch (err) {
    if (isAuthRequiredError(err)) return { ok: false, message: "This server signs in with OAuth. Use the button below; no token header is needed.", needsOAuth: { vendor: mcpVendorName(parsed.data.url) } };
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function createMcp(_prev: McpFormState, formData: FormData): Promise<McpFormState> {
  const user = await requireUser();
  const limits = limitsFor(user);
  const count = await db.mcpServer.count({ where: { userId: user.id } });
  if (count >= limits.mcp) return { error: `Your account allows ${limits.mcp} MCP servers.` };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
  const headers = parseHeaders(parsed.data.headers);
  if ("error" in headers) return { fieldErrors: { headers: headers.error } };

  let tools: unknown = null;
  let status = "unknown";
  let lastError: string | null = null;
  try {
    const r = await probe(parsed.data.url, parsed.data.transport, headers);
    tools = r.tools;
    status = "ok";
  } catch (err) {
    if (isAuthRequiredError(err) && Object.keys(headers).length === 0) {
      return { ok: false, message: "This server signs in with OAuth. Use the button below; no token header is needed.", needsOAuth: { vendor: mcpVendorName(parsed.data.url) } };
    }
    status = "error";
    lastError = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
  }

  const row = await db.mcpServer.create({
    data: {
      userId: user.id,
      name: parsed.data.name,
      transport: parsed.data.transport,
      url: parsed.data.url,
      encHeaders: Object.keys(headers).length ? encrypt(JSON.stringify(headers)) : null,
      status,
      lastError,
      toolsCache: tools as never,
      toolsSyncAt: tools ? new Date() : null,
    },
  });
  revalidatePath("/dashboard/mcp");
  redirect(`/dashboard/mcp/${row.id}`);
}

export async function syncMcp(id: string) {
  const user = await requireUser();
  const row = await db.mcpServer.findFirst({ where: { id, userId: user.id } });
  if (!row) return;
  const headers = row.encHeaders ? (JSON.parse(decrypt(row.encHeaders)) as Record<string, string>) : {};
  const oauth = row.authStatus !== "none" ? providerFor(row.id, readOAuthState(row.encOAuth)) : undefined;
  try {
    const r = await probe(row.url, row.transport as McpTransport, headers, oauth);
    await db.mcpServer.update({
      where: { id },
      data: { status: "ok", lastError: null, toolsCache: r.tools as never, toolsSyncAt: new Date(), ...(oauth ? { authStatus: "connected" } : {}) },
    });
  } catch (err) {
    const reauth = err instanceof Error && err.name === "McpReauthRequiredError";
    await db.mcpServer.update({
      where: { id },
      data: { status: "error", lastError: (err instanceof Error ? err.message : String(err)).slice(0, 1000), ...(reauth ? { authStatus: "reauth" } : {}) },
    });
  }
  revalidatePath(`/dashboard/mcp/${id}`);
}

const oauthSchema = schema.pick({ name: true, transport: true, url: true });

/**
 * "Sign in with <vendor>": creates the server row (or reuses `id` for a re-authorization), runs
 * discovery + dynamic client registration + PKCE through the MCP SDK and sends the browser to the
 * vendor's consent page. The callback route finishes the exchange.
 */
export async function startMcpOAuth(formData: FormData): Promise<void> {
  const user = await requireUser();
  const existingId = String(formData.get("id") ?? "");
  let row: { id: string; url: string; encOAuth: string | null };
  if (existingId) {
    const found = await db.mcpServer.findFirst({ where: { id: existingId, userId: user.id }, select: { id: true, url: true, encOAuth: true } });
    if (!found) redirect("/dashboard/mcp");
    row = found;
  } else {
    const parsed = oauthSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`/dashboard/mcp/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid form")}`);
    const limits = limitsFor(user);
    const count = await db.mcpServer.count({ where: { userId: user.id } });
    if (count >= limits.mcp) redirect(`/dashboard/mcp/new?error=${encodeURIComponent(`Your account allows ${limits.mcp} MCP servers.`)}`);
    row = await db.mcpServer.create({
      data: { userId: user.id, name: parsed.data.name, transport: parsed.data.transport, url: parsed.data.url, authStatus: "pending", status: "unknown" },
      select: { id: true, url: true, encOAuth: true },
    });
  }

  // Keep the client registration and discovery from a previous sign-in; drop tokens and any stale flow.
  const prev = readOAuthState(row.encOAuth);
  const state: McpOAuthState = { client: prev.client, discovery: prev.discovery, state: newOAuthStateParam(row.id) };
  const provider = providerFor(row.id, state);
  let target: URL;
  try {
    target = await beginOAuth(provider, row.url);
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    await db.mcpServer.update({ where: { id: row.id }, data: { status: "error", lastError: `OAuth sign-in could not start: ${msg}`, authStatus: "reauth" } });
    revalidatePath(`/dashboard/mcp/${row.id}`);
    redirect(`/dashboard/mcp/${row.id}`);
  }
  await db.mcpServer.update({ where: { id: row.id }, data: { authStatus: "pending", lastError: null } });
  redirect(target.toString());
}

export async function updateMcp(_prev: McpFormState, formData: FormData): Promise<McpFormState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };
  const row = await db.mcpServer.findFirst({ where: { id, userId: user.id } });
  if (!row) return { error: "Server not found" };
  const keepHeaders = parsed.data.headers === "__keep__";
  const headers = keepHeaders ? null : parseHeaders(parsed.data.headers);
  if (headers && "error" in headers) return { fieldErrors: { headers: headers.error } };
  await db.mcpServer.update({
    where: { id },
    data: {
      name: parsed.data.name,
      transport: parsed.data.transport,
      url: parsed.data.url,
      ...(headers ? { encHeaders: Object.keys(headers).length ? encrypt(JSON.stringify(headers)) : null } : {}),
    },
  });
  revalidatePath(`/dashboard/mcp/${id}`);
  revalidatePath("/dashboard/mcp");
  return { ok: true, message: "Saved." };
}

export async function deleteMcp(id: string) {
  const user = await requireUser();
  await db.mcpServer.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/dashboard/mcp");
  redirect("/dashboard/mcp");
}

/** Bot page: which servers (and which of their tools) a bot may use. */
export async function setBotMcps(botId: string, formData: FormData) {
  const user = await requireUser();
  const bot = await db.bot.findFirst({ where: { id: botId, userId: user.id }, select: { id: true } });
  if (!bot) return;
  const servers = await db.mcpServer.findMany({ where: { userId: user.id }, select: { id: true, toolsCache: true } });
  await db.$transaction(async (tx) => {
    await tx.botMcp.deleteMany({ where: { botId } });
    for (const s of servers) {
      if (formData.get(`server:${s.id}`) !== "on") continue;
      const all = (Array.isArray(s.toolsCache) ? (s.toolsCache as { name: string }[]) : []).map((t) => t.name);
      // The per-tool checkboxes only exist in the form when the list was expanded; absent = keep "all tools".
      const expanded = formData.get(`tools-expanded:${s.id}`) === "1";
      const picked = all.filter((n) => formData.get(`tool:${s.id}:${n}`) === "on");
      const allowedTools = !expanded || picked.length === all.length || all.length === 0 ? null : picked;
      await tx.botMcp.create({ data: { botId, mcpServerId: s.id, allowedTools: allowedTools as never } });
    }
  });
  revalidatePath(`/dashboard/bots/${botId}`);
}
