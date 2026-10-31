import Link from "next/link";
import { RobotIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitsFor } from "@/lib/limits";

export const metadata = { title: "Agents" };

export default async function BotsPage() {
  const user = await requireUser();
  const bots = await db.bot.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader
        title="Agents"
        description={`Each agent has its own model, persona, memory, tools and access list, and answers in the web chat and, when connected, on Telegram. ${bots.length} of ${limitsFor(user).bots} used.`}
        action={
          <Link href="/dashboard/agents/new" className="btn-primary" aria-disabled={bots.length >= limitsFor(user).bots}>
            New agent
          </Link>
        }
      />
      {bots.length === 0 ? (
        <EmptyState
          icon={<RobotIcon size={24} />}
          title="No agents yet"
          body="Create one from scratch (a Telegram token is optional) or move an existing OpenClaw agent here with one command."
          action={
            <Link href="/dashboard/agents/new" className="btn-primary">
              Create an agent
            </Link>
          }
        />
      ) : (
        <ul className="card divide-y divide-line">
          {bots.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{b.name}</p>
                <p className="text-sm text-fg-muted truncate">{b.tgUsername ? `@${b.tgUsername}` : b.platform === "web" ? "web chat only" : "not verified"} · {b.model ?? "no model"}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link href={`/dashboard/agents/${b.id}/chat`} className="btn-primary h-9">
                  Web chat
                </Link>
                <Link href={`/dashboard/agents/${b.id}`} className="btn-secondary h-9">
                  Manage
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
