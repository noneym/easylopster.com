import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Conversations" };

export default async function ConversationsPage({ params, searchParams }: PageProps<"/dashboard/bots/[id]/conversations">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const bot = await db.bot.findFirst({ where: { id, userId: user.id }, select: { id: true, name: true } });
  if (!bot) notFound();

  const conversations = await db.conversation.findMany({
    where: { botId: bot.id },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    include: { _count: { select: { messages: true } } },
  });
  const hits = q
    ? await db.message.findMany({
        where: { conversation: { botId: bot.id }, text: { contains: q } },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { conversation: { select: { id: true, sessionKey: true, title: true } } },
      })
    : [];

  return (
    <>
      <PageHeader
        title={`${bot.name} · conversations`}
        description="Every session this bot has: Telegram DMs and groups, web chats, automation and subagent runs. Archived sessions keep a # suffix."
        action={
          <Link href={`/dashboard/bots/${bot.id}`} className="btn-ghost">
            Settings
          </Link>
        }
      />
      <form className="mb-6 flex gap-2 max-w-xl" action={`/dashboard/bots/${bot.id}/conversations`}>
        <input name="q" defaultValue={q} className="input" placeholder="Search message text" aria-label="Search" />
        <button type="submit" className="btn-secondary">
          Search
        </button>
      </form>

      {q && (
        <section className="card mb-6">
          <p className="px-5 py-3 text-sm text-fg-muted border-b border-line">
            {hits.length} match{hits.length === 1 ? "" : "es"} for "{q}"
          </p>
          <ul className="divide-y divide-line">
            {hits.map((h) => (
              <li key={h.id} className="px-5 py-3 text-sm">
                <Link href={`/dashboard/bots/${bot.id}/conversations/${h.conversation.id}#m-${h.id}`} className="font-medium hover:underline underline-offset-4">
                  {h.conversation.title ?? h.conversation.sessionKey}
                </Link>
                <span className="text-xs text-fg-faint ml-2">{h.createdAt.toISOString().replace("T", " ").slice(0, 16)}</span>
                <p className="text-fg-muted mt-0.5 line-clamp-2">
                  <span className="text-fg-faint">{h.role}:</span> {h.text}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="card divide-y divide-line">
        {conversations.length === 0 && <li className="px-5 py-6 text-sm text-fg-muted">No conversations yet.</li>}
        {conversations.map((c) => (
          <li key={c.id} className="px-5 py-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <Link href={`/dashboard/bots/${bot.id}/conversations/${c.id}`} className="font-medium hover:underline underline-offset-4">
                {c.title ?? c.sessionKey}
              </Link>
              <p className="text-xs text-fg-muted font-mono truncate">
                {c.kind} · {c.sessionKey}
                {c.archivedAt ? " · archived" : ""}
                {c.summary ? " · compacted" : ""}
              </p>
            </div>
            <span className="text-xs text-fg-faint tabular-nums">{c._count.messages} msgs</span>
            <span className="text-xs text-fg-faint">{c.lastMessageAt ? c.lastMessageAt.toISOString().replace("T", " ").slice(0, 16) : "–"}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
