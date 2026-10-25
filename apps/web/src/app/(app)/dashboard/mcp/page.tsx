import Link from "next/link";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { MCP_CATALOG, MCP_CATALOG_GROUPS, type McpCatalogGroup } from "@easylopster/shared/mcp-catalog";

export const metadata = { title: "MCP servers" };

export default async function McpPage({ searchParams }: PageProps<"/dashboard/mcp">) {
  const user = await requireUser();
  const sp = await searchParams;
  const servers = await db.mcpServer.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader
        title="MCP servers"
        description={`Remote Model Context Protocol servers over HTTP or SSE. ${servers.length} of ${LIMITS.mcp} used.`}
        action={
          <Link href="/dashboard/mcp/new" className="btn-primary">
            Add server
          </Link>
        }
      />
      {sp.oauth === "invalid" && (
        <div role="alert" className="mb-6 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
          That OAuth callback did not belong to a sign-in started from this account. Open the server and start the sign-in again.
        </div>
      )}
      {servers.length === 0 ? (
        <EmptyState
          icon={<PlugsConnectedIcon size={24} />}
          title="No MCP servers"
          body="Add a server URL and optional headers. We fetch its tool list and you choose which bots may use it. Local stdio servers can run on a node later."
          action={
            <Link href="/dashboard/mcp/new" className="btn-primary">
              Add an MCP server
            </Link>
          }
        />
      ) : (
        <ul className="card divide-y divide-line">
          {servers.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{s.name}</p>
                <p className="text-sm text-fg-muted truncate">{s.transport} · {s.url}</p>
              </div>
              <Link href={`/dashboard/mcp/${s.id}`} className="btn-secondary h-9">
                Manage
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-12">
        <p className="eyebrow mb-2">ready to use</p>
        <h2 className="text-xl">Popular servers</h2>
        <p className="mt-1 text-sm text-fg-muted max-w-[64ch]">
          Pick one, paste the credential it asks for (or sign in with the vendor for OAuth servers), test, save, then enable it for a bot.
        </p>
        {(Object.keys(MCP_CATALOG_GROUPS) as McpCatalogGroup[]).map((g) => {
          const items = MCP_CATALOG.filter((e) => e.group === g);
          if (!items.length) return null;
          return (
            <div key={g} className="mt-6">
              <h3 className="text-sm font-medium text-fg-muted mb-3">{MCP_CATALOG_GROUPS[g]}</h3>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((e) => (
                  <li key={e.id} className="card p-4 flex flex-col gap-2">
                    <div>
                      <p className="font-medium">{e.name}</p>
                      <p className="text-xs text-fg-faint">{e.vendor}</p>
                    </div>
                    <p className="text-sm text-fg-muted leading-relaxed flex-1">{e.description}</p>
                    <p className="text-xs text-fg-faint">{e.oauthOnly ? `Sign in with ${e.vendor}` : e.secretName ? `Secret ${e.secretName}` : e.headers || e.url.includes("<") ? "Needs a credential" : "No credentials"}</p>
                    {e.oauthOnly ? (
                      <Link href={`/dashboard/mcp/new?preset=${e.id}`} className="btn-secondary h-8 text-sm self-start" title={e.auth}>
                        Sign in and use
                      </Link>
                    ) : e.secretName ? (
                      <Link href={`/dashboard/secrets?name=${e.secretName}`} className="btn-secondary h-8 text-sm self-start" title={e.auth}>
                        Set up with a Secret
                      </Link>
                    ) : (
                      <Link href={`/dashboard/mcp/new?preset=${e.id}`} className="btn-secondary h-8 text-sm self-start">
                        Use
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
    </>
  );
}
