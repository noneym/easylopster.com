"use client";

import { useActionState, useState } from "react";
import { SaveButton } from "@/components/app/save-button";
import { useFormStatus } from "react-dom";
import { createMcp, startMcpOAuth, testMcp, updateMcp, type McpFormState } from "./actions";

type Values = {
  id?: string;
  name: string;
  transport: string;
  url: string;
  hasHeaders?: boolean;
  headers?: string;
  preset?: { name: string; auth: string; docs: string };
  /** Catalog entry that only signs in with OAuth: skip headers, show the sign-in button right away. */
  oauth?: { vendor: string };
  /** Editing a server that was connected through OAuth (none | pending | connected | reauth). */
  authStatus?: string;
  /** Error carried back from a failed sign-in start (?error=). */
  error?: string;
};

export function McpForm({ initial }: { initial?: Values }) {
  const editing = !!initial?.id;
  const [create, createAction, creating] = useActionState<McpFormState, FormData>(editing ? updateMcp : createMcp, undefined);
  const [test, testAction, testing] = useActionState<McpFormState, FormData>(testMcp, undefined);
  const [name, setName] = useState(initial?.name ?? "");
  const [transport, setTransport] = useState(initial?.transport ?? "streamable-http");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [headers, setHeaders] = useState(editing && initial?.hasHeaders ? "__keep__" : (initial?.headers ?? ""));
  const placeholderLeft = /<[A-Z_]+>/.test(`${url} ${headers}`);
  const fe = { ...(test?.fieldErrors ?? {}), ...(create?.fieldErrors ?? {}) };
  const notice = create?.error ?? create?.message ?? test?.message ?? initial?.error;
  const bad = !!create?.error || test?.ok === false || !!initial?.error;
  const oauthEditing = editing && !!initial?.authStatus && initial.authStatus !== "none";
  const oauthVendor = initial?.oauth?.vendor ?? create?.needsOAuth?.vendor ?? test?.needsOAuth?.vendor;
  const oauthMode = !editing && !!oauthVendor;

  return (
    <form className="card p-6 space-y-6 max-w-xl" noValidate>
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}
      {initial?.preset && (
        <div className="rounded-md border border-line bg-bg-sunk px-3 py-2.5 text-sm">
          <p className="font-medium">{initial.preset.name} preset</p>
          <p className="text-fg-muted mt-0.5">{initial.preset.auth}</p>
          <a href={initial.preset.docs} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-4 text-fg-muted hover:text-fg">
            Provider docs
          </a>
          {placeholderLeft && <p className="mt-1 text-xs text-accent-ink">Replace the &lt;PLACEHOLDER&gt; parts below with your own values before testing.</p>}
        </div>
      )}
      <div>
        <label htmlFor="name" className="label">
          Name
        </label>
        <input id="name" name="name" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="GitHub" required />
        <p className="help">Used as the tool prefix, so keep it short.</p>
        {fe.name && <p className="error">{fe.name}</p>}
      </div>
      <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
        <div>
          <label htmlFor="transport" className="label">
            Transport
          </label>
          <select id="transport" name="transport" value={transport} onChange={(e) => setTransport(e.target.value)} className="input">
            <option value="streamable-http">Streamable HTTP</option>
            <option value="sse">SSE (legacy)</option>
          </select>
        </div>
        <div>
          <label htmlFor="url" className="label">
            Server URL
          </label>
          <input id="url" name="url" value={url} onChange={(e) => setUrl(e.target.value)} className="input font-mono text-sm" placeholder="https://mcp.example.com/mcp" required />
          {fe.url && <p className="error">{fe.url}</p>}
        </div>
      </div>
      {oauthEditing ? (
        <div>
          <p className="label">Authorization</p>
          <p className="text-sm text-fg-muted">
            {initial?.authStatus === "connected"
              ? "Signed in with OAuth. Tokens are stored encrypted and refreshed automatically."
              : initial?.authStatus === "pending"
                ? "OAuth sign-in started but not finished."
                : "The OAuth sign-in has expired; use “Sign in again” above."}
          </p>
        </div>
      ) : oauthMode ? (
        <div>
          <p className="label">Authorization</p>
          <p className="text-sm text-fg-muted">
            {oauthVendor} signs you in on its own site (OAuth 2.1 with PKCE). You will be sent there and back; no token to paste.
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor="headers" className="label">
            Headers (optional)
          </label>
          {headers === "__keep__" ? (
            <div className="flex items-center gap-3">
              <input type="hidden" name="headers" value="__keep__" />
              <p className="text-sm text-fg-muted">Saved headers are kept.</p>
              <button type="button" className="btn-ghost h-8 text-sm" onClick={() => setHeaders("")}>
                Replace
              </button>
            </div>
          ) : (
            <textarea
              id="headers"
              name="headers"
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              rows={3}
              className="input h-auto py-2 font-mono text-sm"
              placeholder={"Authorization: Bearer …\nX-Api-Key: …"}
            />
          )}
          <p className="help">One per line, stored encrypted. Servers that only sign in with OAuth are detected on test: leave this empty and use the sign-in button.</p>
          {fe.headers && <p className="error">{fe.headers}</p>}
        </div>
      )}

      {notice && (
        <div role="status" className={`rounded-md border px-3 py-2 text-sm ${bad ? "border-accent/40 bg-accent-soft" : "border-line bg-bg-sunk"}`}>
          {notice}
          {test?.tools && test.tools.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-fg-muted">
              {test.tools.slice(0, 30).map((t) => (
                <li key={t.name}>
                  <span className="font-mono text-fg">{t.name}</span>
                  {t.description ? ` · ${t.description.slice(0, 100)}` : ""}
                </li>
              ))}
              {test.tools.length > 30 && <li>and {test.tools.length - 30} more</li>}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {oauthMode ? (
          <SignInButton vendor={oauthVendor!} ready={!!name.trim() && !!url.trim()} />
        ) : (
          <>
            {!oauthEditing && (
              <SaveButton pending={testing} state={test} formAction={testAction} disabled={creating || headers === "__keep__"} className="btn-secondary" pendingLabel="Connecting" savedLabel="Connected" success="Connected.">
                Test connection
              </SaveButton>
            )}
            <SaveButton pending={creating} state={create} formAction={createAction} disabled={testing} success={editing ? "Saved." : "Server added."}>
              {editing ? "Save" : "Add server"}
            </SaveButton>
          </>
        )}
      </div>
    </form>
  );
}

function SignInButton({ vendor, ready }: { vendor: string; ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" formAction={startMcpOAuth} disabled={pending || !ready} className="btn-primary">
      {pending ? "Redirecting" : `Sign in with ${vendor}`}
    </button>
  );
}
