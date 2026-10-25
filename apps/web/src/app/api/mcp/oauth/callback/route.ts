/**
 * OAuth redirect target for MCP servers: ?code=&state= (or ?error=). Verifies the state against the
 * row it names, exchanges the code with the PKCE verifier stored on that row, lists the server's
 * tools with the new token and sends the user to the server page.
 */
import { NextResponse, type NextRequest } from "next/server";
import { connectMcp, type McpTransport } from "@easylopster/shared/mcp";
import { finishMcpOAuth } from "@easylopster/shared/mcp-oauth";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { appUrl, providerFor, readOAuthState, serverIdFromState } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const state = q.get("state");
  const id = serverIdFromState(state);
  const to = (path: string) => NextResponse.redirect(`${appUrl()}${path}`);

  const user = await getCurrentUser();
  if (!user) return to(`/login?next=${encodeURIComponent(`/dashboard/mcp/${id ?? ""}`)}`);
  if (!id) return to("/dashboard/mcp?oauth=invalid");

  const row = await db.mcpServer.findFirst({ where: { id, userId: user.id } });
  if (!row) return to("/dashboard/mcp?oauth=invalid");

  const fail = async (message: string) => {
    await db.mcpServer.update({ where: { id }, data: { status: "error", authStatus: "reauth", lastError: message.slice(0, 1000) } });
    return to(`/dashboard/mcp/${id}?oauth=error`);
  };

  const stored = readOAuthState(row.encOAuth);
  if (!stored.state || stored.state !== state) return fail("OAuth callback did not match the sign-in that was started. Try signing in again.");

  const err = q.get("error");
  if (err) return fail(`The authorization server refused the sign-in: ${err}${q.get("error_description") ? ` (${q.get("error_description")})` : ""}`);
  const code = q.get("code");
  if (!code) return fail("The authorization server returned no code.");

  const provider = providerFor(id, stored);
  try {
    await finishMcpOAuth(provider, row.url, code);
  } catch (e) {
    return fail(`Token exchange failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    const conn = await connectMcp({ url: row.url, transport: row.transport as McpTransport, authProvider: provider });
    try {
      await db.mcpServer.update({
        where: { id },
        data: { status: "ok", authStatus: "connected", lastError: null, toolsCache: conn.tools as never, toolsSyncAt: new Date() },
      });
    } finally {
      await conn.close();
    }
  } catch (e) {
    await db.mcpServer.update({
      where: { id },
      data: { status: "error", authStatus: "connected", lastError: `Signed in, but listing tools failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 1000) },
    });
    return to(`/dashboard/mcp/${id}?oauth=error`);
  }
  return to(`/dashboard/mcp/${id}?oauth=ok`);
}
