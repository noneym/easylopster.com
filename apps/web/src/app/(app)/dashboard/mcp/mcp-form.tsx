"use client";

import { useActionState, useState } from "react";
import { createMcp, testMcp, updateMcp, type McpFormState } from "./actions";

type Values = { id?: string; name: string; transport: string; url: string; hasHeaders?: boolean; headers?: string; preset?: { name: string; auth: string; docs: string } };

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
  const notice = create?.error ?? create?.message ?? test?.message;
  const bad = !!create?.error || test?.ok === false;

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
        <p className="help">One per line, stored encrypted. Local stdio servers are not supported here; run them on a node later.</p>
        {fe.headers && <p className="error">{fe.headers}</p>}
      </div>

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
        <button type="submit" formAction={testAction} disabled={testing || creating || headers === "__keep__"} className="btn-secondary">
          {testing ? "Connecting" : "Test connection"}
        </button>
        <button type="submit" formAction={createAction} disabled={creating || testing} className="btn-primary">
          {creating ? "Saving" : editing ? "Save" : "Add server"}
        </button>
      </div>
    </form>
  );
}
