import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { wsRead } from "../files/actions";
import { ImportClient } from "./import-client";

export const metadata = { title: "Import from OpenClaw" };

export default async function BotImportPage({ params }: PageProps<"/dashboard/bots/[id]/import">) {
  const user = await requireUser();
  const { id } = await params;
  const bot = await db.bot.findFirst({ where: { id, userId: user.id }, select: { id: true, name: true } });
  if (!bot) notFound();
  const memory = await wsRead(bot.id, "MEMORY.md").catch(() => ({ content: "" }));
  const hasMemory = !!memory.content?.trim();

  return (
    <>
      <PageHeader
        title={`${bot.name} · import from OpenClaw`}
        description="Move an OpenClaw bot here with its personality, memory, heartbeat checklist, skills and scripts. Stop the OpenClaw instance first if it uses the same Telegram token."
        action={
          <Link href={`/dashboard/bots/${bot.id}`} className="btn-ghost">
            Bot settings
          </Link>
        }
      />
      <div className="max-w-3xl">
        <ImportClient botId={bot.id} hasMemory={hasMemory} />
        <section className="mt-8 text-sm text-fg-muted space-y-2">
          <p className="font-medium text-fg">What is not imported</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>openclaw.json settings (model, allowlists, cron): set the model and access policy in bot settings; recurring jobs go under Automations.</li>
            <li>ClawHub skills: they live outside the workspace; re-add them under Skills (import from URL works for a raw SKILL.md).</li>
            <li>Session transcripts: the daily memory notes and MEMORY.md carry what the bot learned; transcripts are not needed.</li>
            <li>Media and binaries: keep them on your machine and link a node if the bot needs them.</li>
          </ul>
        </section>
      </div>
    </>
  );
}
