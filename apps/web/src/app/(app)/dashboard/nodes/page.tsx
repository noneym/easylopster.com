import Link from "next/link";
import { DesktopIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitsFor } from "@/lib/limits";

export const metadata = { title: "Nodes" };

export default async function NodesPage() {
  const user = await requireUser();
  const nodes = await db.node.findMany({ where: { userId: user.id, status: { not: "revoked" } }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader
        title="Nodes"
        description={`Machines and containers that run the node agent and give your bots files and a shell. ${nodes.length} of ${limitsFor(user).nodes} used.`}
        action={
          <Link href="/dashboard/nodes/new" className="btn-primary">
            New node
          </Link>
        }
      />
      {nodes.length === 0 ? (
        <EmptyState
          icon={<DesktopIcon size={24} />}
          title="No nodes connected"
          body="Create a node to get a pairing code, then run the agent on Windows, macOS, Linux or as a Docker container. The agent connects outbound, so no ports to open."
          action={
            <Link href="/dashboard/nodes/new" className="btn-primary">
              Connect a machine
            </Link>
          }
        />
      ) : (
        <ul className="card divide-y divide-line">
          {nodes.map((n) => (
            <li key={n.id} className="flex items-center justify-between px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{n.name}</p>
                <p className="text-sm text-fg-muted truncate">
                  {n.status}
                  {n.platform ? ` · ${n.platform}` : ""}
                  {n.lastSeenAt ? ` · seen ${n.lastSeenAt.toISOString().slice(0, 16).replace("T", " ")}` : ""}
                </p>
              </div>
              <Link href={`/dashboard/nodes/${n.id}`} className="btn-secondary h-9">
                Manage
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
