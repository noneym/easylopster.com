import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteSkill, listSkills } from "./actions";
import { ImportSkillForm, NewSkillForm } from "./skill-forms";

export const metadata = { title: "Skills" };

export default async function BotSkillsPage({ params }: PageProps<"/dashboard/bots/[id]/skills">) {
  const user = await requireUser();
  const { id } = await params;
  const bot = await db.bot.findFirst({ where: { id, userId: user.id }, select: { id: true, name: true } });
  if (!bot) notFound();
  const { skills, error } = await listSkills(bot.id);

  return (
    <>
      <PageHeader
        title={`${bot.name} · skills`}
        description="Reusable procedures the bot reads when a task matches (skills/<name>/SKILL.md in its workspace). The bot writes its own with skill_save; you can add, import or edit them here, or just ask the bot."
        action={
          <div className="flex gap-2">
            <Link href={`/dashboard/bots/${bot.id}/files`} className="btn-secondary">
              Workspace
            </Link>
            <Link href={`/dashboard/bots/${bot.id}/chat`} className="btn-secondary">
              Web chat
            </Link>
            <Link href={`/dashboard/bots/${bot.id}`} className="btn-ghost">
              Settings
            </Link>
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="card">
          {error ? (
            <p className="p-6 text-sm text-fg-muted">Could not read the workspace: {error}</p>
          ) : skills.length === 0 ? (
            <div className="p-6">
              <p className="text-sm text-fg-muted">No skills yet.</p>
              <p className="text-sm text-fg-muted mt-1">
                Finish a repeatable task in chat and say <span className="font-mono">save this as a skill</span>, create one from the template, or import a SKILL.md.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {skills.map((s) => (
                <li key={s.slug} className="px-5 py-4 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{s.name}</p>
                    {s.description && <p className="text-sm text-fg-muted mt-0.5">{s.description}</p>}
                    <p className="text-xs text-fg-faint font-mono mt-1">
                      {s.location} · {s.size.toLocaleString()} bytes
                    </p>
                  </div>
                  <Link href={`/dashboard/bots/${bot.id}/files?path=${encodeURIComponent(s.location)}`} className="btn-secondary h-8 text-sm">
                    Edit
                  </Link>
                  <form action={deleteSkill.bind(null, bot.id, s.slug)}>
                    <button type="submit" className="btn-ghost h-8 text-sm text-accent-ink">
                      Delete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="space-y-6">
          <NewSkillForm botId={bot.id} />
          <ImportSkillForm botId={bot.id} />
        </div>
      </div>
    </>
  );
}
