import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWebConversation, sendWebMessage } from "./actions";
import { ChatClient } from "./chat-client";

export const metadata = { title: "Web chat" };

export default async function BotChatPage({ params, searchParams }: PageProps<"/dashboard/bots/[id]/chat">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const bot = await db.bot.findFirst({ where: { id, userId: user.id }, select: { id: true, name: true, agentName: true, model: true, providerKeyId: true } });
  if (!bot) notFound();
  const { conversationId, messages } = await ensureWebConversation(bot.id);
  const gauge = await db.conversation.findUnique({ where: { id: conversationId }, select: { lastInputTokens: true, contextWindow: true } });
  const initialContext = gauge?.lastInputTokens && gauge.contextWindow ? { used: gauge.lastInputTokens, window: gauge.contextWindow } : null;
  // Earlier web sessions of this owner (archived with /new or "New session"); newest first.
  const sessions = await db.conversation.findMany({
    where: { botId: bot.id, kind: "web", sessionKey: { startsWith: `web:${bot.id}:${user.id}` } },
    orderBy: { startedAt: "desc" },
    take: 40,
    select: { id: true, title: true, summary: true, startedAt: true, archivedAt: true, _count: { select: { messages: true } } },
  });
  const sessionDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: user.timezone || "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
  // Fresh bot opened from the create flow: say hello for the owner so the bootstrap interview starts right away.
  let kickoff = false;
  if (sp.welcome === "1" && messages.length === 0 && bot.providerKeyId) {
    const r = await sendWebMessage(bot.id, conversationId, "Hi! I just created you.");
    kickoff = !("error" in r && r.error);
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] md:h-[calc(100dvh-4rem)] -my-8">
      <div className="flex items-center justify-between py-4 border-b border-line">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{bot.agentName || bot.name}</h1>
          <p className="text-xs text-fg-muted font-mono">{bot.model ?? "no model"} · web session</p>
        </div>
        <Link href={`/dashboard/bots/${bot.id}`} className="btn-ghost h-9">
          Settings
        </Link>
      </div>
      <div className="flex-1 min-h-0 flex gap-6">
        <aside className="hidden lg:flex w-56 shrink-0 flex-col border-r border-line pr-4 py-4 overflow-y-auto">
          <p className="eyebrow mb-3">sessions</p>
          <ul className="space-y-1 text-sm">
            {sessions.map((s) => {
              const current = s.id === conversationId;
              const label = s.title && s.title !== "Web chat" ? s.title : s.summary?.split("\n")[0]?.slice(0, 40) || sessionDate(s.startedAt);
              return (
                <li key={s.id}>
                  {current ? (
                    <span className="block rounded-md bg-bg-sunk px-2.5 py-1.5 font-medium">
                      Current session
                      <span className="block text-xs text-fg-muted font-normal">{s._count.messages} messages</span>
                    </span>
                  ) : (
                    <Link href={`/dashboard/bots/${bot.id}/conversations/${s.id}`} className="block rounded-md px-2.5 py-1.5 text-fg-muted hover:bg-bg-sunk hover:text-fg">
                      <span className="block truncate">{label}</span>
                      <span className="block text-xs text-fg-faint">
                        {sessionDate(s.startedAt)} · {s._count.messages} msgs
                      </span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {sessions.length <= 1 && <p className="mt-2 text-xs text-fg-faint">Earlier sessions appear here after you press New session.</p>}
        </aside>
        <div className="flex-1 min-w-0 flex flex-col">
          {!bot.providerKeyId ? (
            <p className="py-8 text-sm text-fg-muted">This bot has no API key. Assign one in settings first.</p>
          ) : (
            <ChatClient botId={bot.id} conversationId={conversationId} initial={kickoff ? [{ id: "kickoff", role: "user", text: "Hi! I just created you." }] : messages} initialBusy={kickoff} initialContext={initialContext} />
          )}
        </div>
      </div>
    </div>
  );
}
