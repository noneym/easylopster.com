/**
 * MCP authorization (OAuth 2.1 + PKCE, dynamic client registration) backed by a JSON blob that the
 * caller persists encrypted in McpServer.encOAuth. One provider instance = one server row.
 *
 * Flow: `startMcpOAuth` runs the SDK's `auth()` which discovers the authorization server, registers
 * a client, stores the PKCE verifier and hands back the authorization URL. The callback route runs
 * `finishMcpOAuth` with the code; after that `connectMcp({ authProvider })` sends the bearer token
 * and the SDK transport refreshes it on 401. `tokens()` also refreshes proactively when the access
 * token is about to expire, so long-lived gateway sessions never start with a stale token.
 */
import { auth, refreshAuthorization, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export interface McpOAuthState {
  /** Dynamic client registration result (client_id, optional secret), stamped with the issuer. */
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  /** Unix ms when `tokens.access_token` expires (from expires_in at save time); undefined = unknown. */
  expiresAt?: number;
  discovery?: OAuthDiscoveryState;
  /** In-flight authorization: PKCE verifier and the state parameter we expect back. */
  verifier?: string;
  state?: string;
  /** Unix ms of the last successful token save. */
  savedAt?: number;
}

/** Thrown when the stored refresh token no longer works: the user has to sign in again from the dashboard. */
export class McpReauthRequiredError extends Error {
  constructor(message = "The OAuth sign-in has expired. Open the server in the dashboard and sign in again.") {
    super(message);
    this.name = "McpReauthRequiredError";
  }
}

export function isReauthError(err: unknown): err is McpReauthRequiredError {
  return err instanceof McpReauthRequiredError || (err instanceof Error && err.name === "McpReauthRequiredError");
}

const EXPIRY_MARGIN_MS = 60_000;

/** Refreshes in flight per state object so concurrent tool calls share one token request. */
const refreshing = new WeakMap<McpOAuthState, Promise<OAuthTokens>>();

export interface McpOAuthProviderOptions {
  /** Absolute callback URL, e.g. https://easylopster.com/api/mcp/oauth/callback */
  redirectUrl: string;
  /** Public site URL sent as client_uri during registration. */
  appUrl: string;
  /** Mutable; the provider writes into it and calls `save` after every change. */
  state: McpOAuthState;
  save: (state: McpOAuthState) => Promise<void>;
  /**
   * Called when the SDK wants to send the user to the authorization server. The dashboard flow
   * records the URL and redirects; the gateway cannot and treats it as "sign in again".
   */
  onRedirect?: (url: URL) => void | Promise<void>;
}

export class McpOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: string;
  readonly clientMetadata: OAuthClientMetadata;
  private readonly st: McpOAuthState;
  private readonly persist: (s: McpOAuthState) => Promise<void>;
  /** Settable so the dashboard flow can capture the URL. */
  onRedirect?: (url: URL) => void | Promise<void>;

  constructor(opts: McpOAuthProviderOptions) {
    this.redirectUrl = opts.redirectUrl;
    this.st = opts.state;
    this.persist = opts.save;
    this.onRedirect = opts.onRedirect;
    this.clientMetadata = {
      client_name: "easylopster",
      client_uri: opts.appUrl,
      redirect_uris: [opts.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  get snapshot(): McpOAuthState {
    return this.st;
  }

  state() {
    return this.st.state ?? "";
  }

  clientInformation() {
    return this.st.client;
  }

  async saveClientInformation(info: OAuthClientInformationMixed) {
    this.st.client = info;
    await this.persist(this.st);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const t = this.st.tokens;
    if (!t) return undefined;
    const expired = this.st.expiresAt !== undefined && this.st.expiresAt - EXPIRY_MARGIN_MS <= Date.now();
    if (!expired) return t;
    if (!t.refresh_token) return t; // let the server answer 401 and the SDK start a new flow
    return this.refresh(t.refresh_token);
  }

  /** Proactive refresh with the stored discovery metadata; failures mean "sign in again". */
  private refresh(refreshToken: string): Promise<OAuthTokens> {
    const inflight = refreshing.get(this.st);
    if (inflight) return inflight;
    const p = (async () => {
      const d = this.st.discovery;
      const issuer = this.st.tokens?.issuer ?? d?.authorizationServerUrl;
      const client = this.st.client;
      if (!issuer || !client) throw new McpReauthRequiredError();
      try {
        const fresh = await refreshAuthorization(issuer, {
          metadata: d?.authorizationServerMetadata,
          clientInformation: client,
          refreshToken,
          resource: d?.resourceMetadata?.resource,
        });
        await this.saveTokens({ ...fresh, issuer });
        return this.st.tokens!;
      } catch (err) {
        if (isReauthError(err)) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        throw new McpReauthRequiredError(`Token refresh failed (${msg.slice(0, 160)}). Open the server in the dashboard and sign in again.`);
      }
    })();
    refreshing.set(this.st, p);
    p.finally(() => refreshing.delete(this.st)).catch(() => {});
    return p;
  }

  async saveTokens(tokens: OAuthTokens) {
    this.st.tokens = tokens;
    this.st.expiresAt = tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : undefined;
    this.st.savedAt = Date.now();
    this.st.verifier = undefined;
    this.st.state = undefined;
    await this.persist(this.st);
  }

  async redirectToAuthorization(url: URL) {
    if (this.onRedirect) {
      await this.onRedirect(url);
      return;
    }
    throw new McpReauthRequiredError();
  }

  async saveCodeVerifier(v: string) {
    this.st.verifier = v;
    await this.persist(this.st);
  }

  codeVerifier() {
    if (!this.st.verifier) throw new Error("No PKCE verifier stored; start the sign-in again.");
    return this.st.verifier;
  }

  discoveryState() {
    return this.st.discovery;
  }

  async saveDiscoveryState(d: OAuthDiscoveryState) {
    this.st.discovery = d;
    await this.persist(this.st);
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "client") this.st.client = undefined;
    if (scope === "all" || scope === "tokens") {
      this.st.tokens = undefined;
      this.st.expiresAt = undefined;
    }
    if (scope === "all" || scope === "verifier") this.st.verifier = undefined;
    if (scope === "all" || scope === "discovery") this.st.discovery = undefined;
    await this.persist(this.st);
  }
}

/**
 * Starts the interactive flow for `serverUrl`: discovery, registration, PKCE. Returns the vendor's
 * authorization URL to send the browser to. `state.state` must be set by the caller beforehand.
 */
export async function startMcpOAuth(provider: McpOAuthProvider, serverUrl: string): Promise<URL> {
  let target: URL | undefined;
  const prev = provider.onRedirect;
  provider.onRedirect = (u) => {
    target = u;
  };
  try {
    const result = await auth(provider, { serverUrl });
    if (result === "AUTHORIZED") throw new Error("The server accepted the stored credentials; no sign-in is needed.");
  } finally {
    provider.onRedirect = prev;
  }
  if (!target) throw new Error("The authorization server did not return a sign-in URL.");
  return target;
}

/** Exchanges the authorization code; on success the provider has saved the tokens. */
export async function finishMcpOAuth(provider: McpOAuthProvider, serverUrl: string, code: string): Promise<void> {
  const result = await auth(provider, { serverUrl, authorizationCode: code });
  if (result !== "AUTHORIZED") throw new Error("Token exchange did not complete.");
}

/** Human-readable vendor name from a server URL: mcp.notion.com → Notion. */
export function mcpVendorName(serverUrl: string): string {
  try {
    const host = new URL(serverUrl).hostname.replace(/^(mcp|api|www)\./, "");
    const label = host.split(".").slice(0, -1).join(".") || host;
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return "the server";
  }
}
