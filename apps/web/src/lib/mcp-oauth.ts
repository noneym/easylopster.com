import "server-only";
import { decrypt, encrypt, randomToken } from "@easylopster/shared/crypto";
import { McpOAuthProvider, type McpOAuthState } from "@easylopster/shared/mcp-oauth";
import { db } from "./db";

export function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function mcpOAuthRedirectUrl() {
  return `${appUrl()}/api/mcp/oauth/callback`;
}

export function readOAuthState(encOAuth: string | null): McpOAuthState {
  if (!encOAuth) return {};
  try {
    return JSON.parse(decrypt(encOAuth)) as McpOAuthState;
  } catch {
    return {};
  }
}

/** Provider for one McpServer row; every change is written back encrypted. */
export function providerFor(serverId: string, state: McpOAuthState) {
  return new McpOAuthProvider({
    redirectUrl: mcpOAuthRedirectUrl(),
    appUrl: appUrl(),
    state,
    save: async (s) => {
      await db.mcpServer.update({ where: { id: serverId }, data: { encOAuth: encrypt(JSON.stringify(s)) } });
    },
  });
}

/** The OAuth `state` parameter: "<serverId>.<random>" so the callback can find the row before verifying. */
export function newOAuthStateParam(serverId: string) {
  return `${serverId}.${randomToken(24)}`;
}

export function serverIdFromState(state: string | null): string | null {
  if (!state) return null;
  const i = state.indexOf(".");
  return i > 0 ? state.slice(0, i) : null;
}
