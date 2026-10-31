import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { wsTree } from "./actions";
import { FileBrowser } from "./file-browser";

export const metadata = { title: "Workspace" };

export default async function BotFilesPage({ params, searchParams }: PageProps<"/dashboard/agents/[id]/files">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const bot = await db.bot.findFirst({ where: { id, userId: user.id }, select: { id: true, name: true } });
  if (!bot) notFound();
  const tree = await wsTree(bot.id);
  const initialPath = typeof sp.path === "string" ? sp.path : undefined;

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] -my-8">
      <div className="flex items-center justify-between py-4 border-b border-line">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{bot.name} · workspace</h1>
          <p className="text-xs text-fg-muted">MEMORY.md and memory/ are the bot's own notes; skills/ holds reusable SKILL.md procedures. SOUL.md, USER.md and IDENTITY.md are the persona files the bot wrote during onboarding (also editable in settings).</p>
        </div>
        <Link href={`/dashboard/agents/${bot.id}`} className="btn-ghost h-9">
          Settings
        </Link>
      </div>
      {tree.error ? (
        <p className="py-8 text-sm text-fg-muted">Could not reach the gateway: {tree.error}</p>
      ) : (
        <FileBrowser botId={bot.id} initialEntries={tree.entries} initialPath={initialPath} />
      )}
    </div>
  );
}
