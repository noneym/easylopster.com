import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteMcp, syncMcp } from "../actions";
import { McpForm } from "../mcp-form";

export const metadata = { title: "MCP server" };

export default async function McpDetailPage({ params }: PageProps<"/dashboard/mcp/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const s = await db.mcpServer.findFirst({ where: { id, userId: user.id }, include: { bots: { include: { bot: { select: { id: true, name: true } } } } } });
  if (!s) notFound();
  const tools = Array.isArray(s.toolsCache) ? (s.toolsCache as { name: string; description?: string }[]) : [];

  return (
    <>
      <PageHeader
        title={s.name}
        description={`${s.transport} · ${s.url}`}
        action={
          <form action={syncMcp.bind(null, s.id)}>
            <button type="submit" className="btn-secondary">
              Reconnect and refresh tools
            </button>
          </form>
        }
      />
      {s.lastError && (
        <div role="alert" className="mb-6 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
          <p className="font-medium">Last error</p>
          <p className="mt-0.5 text-fg-muted break-all">{s.lastError}</p>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] max-w-5xl">
        <div className="space-y-6">
          <McpForm initial={{ id: s.id, name: s.name, transport: s.transport, url: s.url, hasHeaders: !!s.encHeaders }} />
          <section className="card p-6">
            <h2 className="font-semibold tracking-tight">Tools ({tools.length})</h2>
            <p className="text-sm text-fg-muted mt-0.5">
              {s.toolsSyncAt ? `Listed ${s.toolsSyncAt.toISOString().replace("T", " ").slice(0, 16)} UTC.` : "Not listed yet."} Bots see them as{" "}
              <code className="font-mono text-xs">mcp_{s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}__&lt;tool&gt;</code>.
            </p>
            {tools.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {tools.map((t) => (
                  <li key={t.name} className="py-2.5">
                    <p className="font-mono text-sm">{t.name}</p>
                    {t.description && <p className="text-xs text-fg-muted mt-0.5 line-clamp-2">{t.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          <div className="card p-5">
            <p className="text-sm text-fg-muted">Status</p>
            <p className={`mt-1 font-medium capitalize ${s.status === "error" ? "text-accent-ink" : ""}`}>{s.status}</p>
          </div>
          <div className="card p-5">
            <p className="text-sm text-fg-muted">Used by</p>
            {s.bots.length === 0 ? (
              <p className="mt-1 text-sm">No bots yet. Enable it on a bot's page.</p>
            ) : (
              <ul className="mt-1 text-sm space-y-1">
                {s.bots.map((b) => (
                  <li key={b.bot.id}>{b.bot.name}</li>
                ))}
              </ul>
            )}
          </div>
          <form action={deleteMcp.bind(null, s.id)} className="card p-5">
            <p className="text-sm text-fg-muted">Danger</p>
            <p className="mt-1 text-sm">Removes the server from every bot.</p>
            <button type="submit" className="btn-secondary mt-3 text-accent-ink">
              Delete server
            </button>
          </form>
        </aside>
      </div>
    </>
  );
}
