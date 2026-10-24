"use client";

import { useState } from "react";
import Link from "next/link";
import { setBotMcps } from "../../mcp/actions";

type Server = { id: string; name: string; status: string; tools: { name: string; description?: string }[] };
type Link_ = { mcpServerId: string; allowedTools: string[] | null };

export function BotMcpForm({ botId, servers, links }: { botId: string; servers: Server[]; links: Link_[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const action = setBotMcps.bind(null, botId);
  const linkFor = (id: string) => links.find((l) => l.mcpServerId === id);

  return (
    <form action={action} className="card p-6">
      <h2 className="font-semibold tracking-tight">MCP servers</h2>
      <p className="text-sm text-fg-muted mt-0.5">
        Tools from enabled servers are offered to the model on every turn.{" "}
        <Link href="/dashboard/mcp" className="underline underline-offset-4 text-fg">
          Manage servers
        </Link>
      </p>
      {servers.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">No MCP servers added yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {servers.map((s) => {
            const link = linkFor(s.id);
            const enabled = !!link;
            const allowed = link?.allowedTools;
            return (
              <li key={s.id} className="py-3">
                <div className="flex items-center gap-3">
                  <input type="checkbox" name={`server:${s.id}`} defaultChecked={enabled} className="size-4 accent-[var(--accent)]" id={`srv-${s.id}`} />
                  <label htmlFor={`srv-${s.id}`} className="flex-1 text-sm font-medium">
                    {s.name} <span className="text-fg-muted font-normal">· {s.tools.length} tools{s.status === "error" ? " · last connection failed" : ""}</span>
                  </label>
                  {s.tools.length > 0 && (
                    <button type="button" className="btn-ghost h-8 text-sm" onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>
                      {open[s.id] ? "Hide tools" : allowed ? `${allowed.length} selected` : "All tools"}
                    </button>
                  )}
                </div>
                {open[s.id] && <input type="hidden" name={`tools-expanded:${s.id}`} value="1" />}
                {open[s.id] && (
                  <ul className="mt-2 ml-7 grid gap-1.5 sm:grid-cols-2">
                    {s.tools.map((t) => (
                      <li key={t.name} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          name={`tool:${s.id}:${t.name}`}
                          defaultChecked={!allowed || allowed.includes(t.name)}
                          className="mt-1 size-3.5 accent-[var(--accent)]"
                          id={`tool-${s.id}-${t.name}`}
                        />
                        <label htmlFor={`tool-${s.id}-${t.name}`} className="min-w-0">
                          <span className="font-mono text-xs">{t.name}</span>
                          {t.description && <span className="block text-xs text-fg-muted line-clamp-1">{t.description}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {servers.length > 0 && (
        <button type="submit" className="btn-primary mt-4">
          Save MCP settings
        </button>
      )}
    </form>
  );
}
