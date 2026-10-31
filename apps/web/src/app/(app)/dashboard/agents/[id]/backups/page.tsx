import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { BackupsClient } from "./backups-client";

export const metadata = { title: "Backups" };

export default async function BackupsPage({ params }: PageProps<"/dashboard/agents/[id]/backups">) {
  const user = await requireUser();
  const { id } = await params;
  const [bot, storage] = await Promise.all([
    db.bot.findFirst({ where: { id, userId: user.id }, select: { id: true, name: true, backupPolicy: true, backups: { orderBy: { createdAt: "desc" }, take: 100 }, user: { select: { timezone: true } } } }),
    db.storageConfig.findUnique({ where: { userId: user.id }, select: { bucket: true, prefix: true } }),
  ]);
  if (!bot) notFound();
  const p = bot.backupPolicy;
  const schedule = (p?.schedule ?? null) as { kind: string; everyMs?: number; expr?: string } | null;
  let kind: "daily" | "hours" | "weekly" = "daily";
  let time = "03:00";
  let hours = 6;
  let weekday = 0;
  if (schedule?.kind === "every") {
    kind = "hours";
    hours = Math.max(1, Math.round((schedule.everyMs ?? 0) / 3_600_000));
  } else if (schedule?.kind === "cron" && schedule.expr) {
    const [m, h, , , dow] = schedule.expr.split(" ");
    time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    if (dow && dow !== "*") {
      kind = "weekly";
      weekday = Number(dow);
    }
  }

  return (
    <>
      <PageHeader
        title={`${bot.name} · backups`}
        description="Zip archives of the workspace (persona, memory, skills, scripts) and the agent's settings, written to your storage on a schedule. Restore brings a workspace back."
        action={
          <Link href={`/dashboard/agents/${bot.id}`} className="btn-ghost">
            Agent settings
          </Link>
        }
      />
      {!storage && (
        <div className="mb-6 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
          Backups are written to your own bucket.{" "}
          <Link href="/dashboard/storage" className="underline underline-offset-4 font-medium">
            Connect your storage
          </Link>{" "}
          first.
        </div>
      )}
      <BackupsClient
        botId={bot.id}
        timezone={bot.user.timezone || "UTC"}
        hasStorage={!!storage}
        storageLabel={storage ? `${storage.bucket}${storage.prefix ? `/${storage.prefix}` : ""}backups/${bot.id}/` : null}
        policy={p ? { enabled: p.enabled, kind, time, hours, weekday, retentionDays: p.retentionDays, keepLast: p.keepLast, includeConversations: p.includeConversations, includeInbox: p.includeInbox, nextRunAt: p.nextRunAt?.toISOString() ?? null, lastRunAt: p.lastRunAt?.toISOString() ?? null, lastStatus: p.lastStatus, lastError: p.lastError } : null}
        backups={bot.backups.map((b) => ({ id: b.id, key: b.key, bytes: b.bytes, trigger: b.trigger, createdAt: b.createdAt.toISOString(), manifest: (b.manifest ?? null) as { files?: number; conversations?: number } | null }))}
      />
    </>
  );
}
