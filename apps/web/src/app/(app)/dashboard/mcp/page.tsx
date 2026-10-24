import Link from "next/link";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { LIMITS } from "@/lib/limits";

export const metadata = { title: "MCP servers" };

export default async function McpPage() {
  const user = await requireUser();
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
    </>
  );
}
