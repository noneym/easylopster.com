import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, UserSwitchIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/app/page-header";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { LIMITS, limitsFor } from "@/lib/limits";
import { impersonateUser } from "../actions";
import { AdminUserForm } from "./user-form";

export const dynamic = "force-dynamic";

export default async function AdminUserPage({ params }: PageProps<"/dashboard/admin/[id]">) {
  const admin = await requireAdmin();
  const { id } = await params;
  const user = await db.user.findUnique({ where: { id } });
  if (!user) notFound();
  const [bots, nodeCount, mcpCount, keyCount, sessionCount] = await Promise.all([
    db.bot.findMany({ where: { userId: id }, select: { id: true, name: true, tgUsername: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    db.node.count({ where: { userId: id, status: { not: "revoked" } } }),
    db.mcpServer.count({ where: { userId: id } }),
    db.providerKey.count({ where: { userId: id } }),
    db.session.count({ where: { userId: id, expiresAt: { gt: new Date() } } }),
  ]);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  since.setUTCHours(0, 0, 0, 0);
  const usage = await db.usageDaily.aggregate({ where: { userId: id, day: { gte: since } }, _sum: { messages: true, tokensIn: true, tokensOut: true } });
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const today = await db.usageDaily.aggregate({ where: { userId: id, day: todayStart }, _sum: { messages: true } });
  const lim = limitsFor(user);
  const self = user.id === admin.id;

  return (
    <>
      <div className="mb-4">
        <Link href="/dashboard/admin" className="btn-ghost h-8 text-sm -ml-3">
          <ArrowLeftIcon size={14} /> All users
        </Link>
      </div>
      <PageHeader
        title={user.email}
        description={`${user.name ?? "No name"} · joined ${user.createdAt.toISOString().slice(0, 10)} · ${user.emailVerifiedAt ? "email verified" : "email not verified"} · ${user.role}`}
        action={
          !self && (
            <form action={impersonateUser}>
              <input type="hidden" name="id" value={user.id} />
              <button type="submit" className="btn-secondary">
                <UserSwitchIcon size={16} /> Sign in as this user
              </button>
            </form>
          )
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {[
          { label: "Bots", value: `${bots.length} / ${lim.bots}` },
          { label: "Nodes", value: `${nodeCount} / ${lim.nodes}` },
          { label: "MCP servers", value: `${mcpCount} / ${lim.mcp}` },
          { label: "Messages today", value: `${today._sum.messages ?? 0} / ${lim.messagesPerDay}` },
        ].map((c) => (
          <div key={c.label} className="card p-5">
            <p className="text-sm text-fg-muted">{c.label}</p>
            <p className="mt-2 text-2xl font-semibold tracking-tight font-mono tabular-nums">{c.value}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <AdminUserForm
          user={{ id: user.id, role: user.role, limitBots: user.limitBots, limitNodes: user.limitNodes, limitMcp: user.limitMcp, limitMessagesPerDay: user.limitMessagesPerDay }}
          defaults={LIMITS}
          self={self}
        />
        <aside className="space-y-6">
          <div className="card p-5 text-sm">
            <h2 className="font-semibold tracking-tight mb-3">Account</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-fg-muted">
              <dt>User id</dt>
              <dd className="font-mono text-xs text-fg break-all">{user.id}</dd>
              <dt>Time zone</dt>
              <dd className="text-fg">{user.timezone}</dd>
              <dt>API keys</dt>
              <dd className="text-fg">{keyCount}</dd>
              <dt>Sessions</dt>
              <dd className="text-fg">{sessionCount}</dd>
              <dt>30 days</dt>
              <dd className="text-fg">
                {usage._sum.messages ?? 0} msgs · {((usage._sum.tokensIn ?? 0) / 1000).toFixed(0)}k / {((usage._sum.tokensOut ?? 0) / 1000).toFixed(0)}k tokens
              </dd>
            </dl>
          </div>
          <div className="card p-5 text-sm">
            <h2 className="font-semibold tracking-tight mb-3">Bots</h2>
            {bots.length === 0 ? (
              <p className="text-fg-muted">No bots.</p>
            ) : (
              <ul className="space-y-1.5">
                {bots.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{b.name}</span>
                    <span className="text-xs text-fg-muted truncate">{b.tgUsername ? `@${b.tgUsername}` : b.createdAt.toISOString().slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
