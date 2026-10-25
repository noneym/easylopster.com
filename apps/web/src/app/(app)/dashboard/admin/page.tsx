import Link from "next/link";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { LIMITS, limitsFor } from "@/lib/limits";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

function utcToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export default async function AdminUsersPage({ searchParams }: PageProps<"/dashboard/admin">) {
  await requireAdmin();
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 100);

  const users = await db.user.findMany({
    where: q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }] } : undefined,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      emailVerifiedAt: true,
      limitBots: true,
      limitNodes: true,
      limitMcp: true,
      limitMessagesPerDay: true,
      _count: { select: { bots: true, mcpServers: true, nodes: { where: { status: { not: "revoked" } } } } },
    },
  });
  const today = await db.usageDaily.groupBy({ by: ["userId"], where: { day: utcToday(), userId: { in: users.map((u) => u.id) } }, _sum: { messages: true } });
  const msgs = new Map(today.map((t) => [t.userId, t._sum.messages ?? 0]));
  const total = await db.user.count();

  return (
    <>
      <PageHeader
        title="Admin"
        description={`${total} accounts. Global defaults: ${LIMITS.bots} bots, ${LIMITS.nodes} nodes, ${LIMITS.mcp} MCP servers, ${LIMITS.messagesPerDay} messages/day. Click a user to change their limits or sign in as them.`}
        action={
          <form method="get" className="flex items-center gap-2" role="search">
            <div className="relative">
              <MagnifyingGlassIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
              <input name="q" defaultValue={q} placeholder="Search email or name" className="input pl-9! w-64" aria-label="Search users" />
            </div>
            <button type="submit" className="btn-secondary">
              Search
            </button>
          </form>
        }
      />
      <section className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-fg-faint">
            <tr className="border-b border-line">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Bots</th>
              <th className="px-4 py-3 font-medium text-right">Nodes</th>
              <th className="px-4 py-3 font-medium text-right">MCP</th>
              <th className="px-4 py-3 font-medium text-right">Today</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-fg-muted">
                  No users match “{q}”.
                </td>
              </tr>
            )}
            {users.map((u) => {
              const lim = limitsFor(u);
              const custom = u.limitBots != null || u.limitNodes != null || u.limitMcp != null || u.limitMessagesPerDay != null;
              const cell = (used: number, limit: number) => (
                <span className={`font-mono tabular-nums ${used >= limit ? "text-accent-ink" : ""}`}>
                  {used} <span className="text-fg-faint">/ {limit}</span>
                </span>
              );
              return (
                <tr key={u.id} className="hover:bg-bg-sunk/50">
                  <td className="px-4 py-2.5">
                    <Link href={`/dashboard/admin/${u.id}`} className="block min-w-0 hover:underline">
                      <span className="block truncate font-medium">{u.email}</span>
                      <span className="block truncate text-xs text-fg-muted">{u.name ?? "—"}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-fg-muted whitespace-nowrap">{u.createdAt.toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="inline-flex flex-wrap gap-1">
                      {u.role === "admin" && <span className="rounded-full bg-accent-soft text-accent-ink px-2 py-0.5 text-xs font-medium">admin</span>}
                      <span className={`rounded-full px-2 py-0.5 text-xs ${u.emailVerifiedAt ? "bg-bg-sunk text-fg-muted" : "border border-line-strong text-fg-faint"}`}>
                        {u.emailVerifiedAt ? "verified" : "unverified"}
                      </span>
                      {custom && <span className="rounded-full border border-line-strong px-2 py-0.5 text-xs text-fg-muted">custom limits</span>}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">{cell(u._count.bots, lim.bots)}</td>
                  <td className="px-4 py-2.5 text-right">{cell(u._count.nodes, lim.nodes)}</td>
                  <td className="px-4 py-2.5 text-right">{cell(u._count.mcpServers, lim.mcp)}</td>
                  <td className="px-4 py-2.5 text-right">{cell(msgs.get(u.id) ?? 0, lim.messagesPerDay)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
