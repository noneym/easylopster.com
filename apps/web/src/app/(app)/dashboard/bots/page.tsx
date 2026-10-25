import Link from "next/link";
import { RobotIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitsFor } from "@/lib/limits";

export const metadata = { title: "Bots" };

export default async function BotsPage() {
  const user = await requireUser();
  const bots = await db.bot.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader
        title="Bots"
        description={`Each bot is a Telegram bot with its own model, prompt and access list. ${bots.length} of ${limitsFor(user).bots} used.`}
        action={
          <Link href="/dashboard/bots/new" className="btn-primary" aria-disabled={bots.length >= limitsFor(user).bots}>
            New bot
          </Link>
        }
      />
      {bots.length === 0 ? (
        <EmptyState
          icon={<RobotIcon size={24} />}
          title="No bots yet"
          body="Create a bot with @BotFather in Telegram, copy its token and paste it here. We verify it and set the webhook for you."
          action={
            <Link href="/dashboard/bots/new" className="btn-primary">
              Connect a Telegram bot
            </Link>
          }
        />
      ) : (
        <ul className="card divide-y divide-line">
          {bots.map((b) => (
            <li key={b.id} className="flex items-center justify-between px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{b.name}</p>
                <p className="text-sm text-fg-muted truncate">{b.tgUsername ? `@${b.tgUsername}` : "not verified"} · {b.model ?? "no model"}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link href={`/dashboard/bots/${b.id}/chat`} className="btn-primary h-9">
                  Web chat
                </Link>
                <Link href={`/dashboard/bots/${b.id}`} className="btn-secondary h-9">
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
