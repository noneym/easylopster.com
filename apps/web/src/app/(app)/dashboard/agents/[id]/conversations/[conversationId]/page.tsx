import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Markdown } from "@/components/app/markdown";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: PageProps<"/dashboard/agents/[id]/conversations/[conversationId]">) {
  const user = await requireUser();
  const { id, conversationId } = await params;
  const conv = await db.conversation.findFirst({
    where: { id: conversationId, botId: id, bot: { userId: user.id } },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 500 } },
  });
  if (!conv) notFound();

  return (
    <>
      <PageHeader
        title={conv.title ?? conv.sessionKey}
        description={`${conv.kind} · ${conv.sessionKey}${conv.compactedAt ? ` · compacted ${conv.compactedAt.toISOString().slice(0, 10)}` : ""} · ${conv.messages.length} messages`}
        action={
          <Link href={`/dashboard/agents/${id}/conversations`} className="btn-ghost">
            All conversations
          </Link>
        }
      />
      {conv.summary && (
        <details className="card p-4 mb-6 text-sm">
          <summary className="cursor-pointer font-medium">Compaction summary</summary>
          <Markdown text={conv.summary} className="mt-3 whitespace-pre-wrap text-fg-muted" />
        </details>
      )}
      <ol className="space-y-3 max-w-3xl">
        {conv.messages.map((m) => {
          const c = m.content as { unaddressed?: boolean; media?: string[] } | null;
          return (
            <li key={m.id} id={`m-${m.id}`} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className={`max-w-[85%] rounded-lg px-3.5 py-2 text-sm leading-relaxed ${m.role === "user" ? (c?.unaddressed ? "bg-bg-sunk text-fg-muted" : "bg-accent text-accent-fg") : "bg-bg-sunk"}`}>
                {m.role === "user" ? <span className="whitespace-pre-wrap">{m.text}</span> : <Markdown text={m.text ?? ""} className="whitespace-pre-wrap" />}
                {c?.media?.length ? <p className="mt-1 text-xs opacity-80">📎 {c.media.join(", ")}</p> : null}
                {m.error && <p className="mt-1 text-xs text-accent-ink">{m.error}</p>}
                <p className={`mt-1 text-[10px] ${m.role === "user" ? "opacity-70" : "text-fg-faint"}`}>
                  {m.createdAt.toISOString().replace("T", " ").slice(0, 19)}
                  {m.senderName ? ` · ${m.senderName}` : ""}
                  {m.model ? ` · ${m.model}` : ""}
                  {m.tokensIn || m.tokensOut ? ` · ${m.tokensIn ?? 0}/${m.tokensOut ?? 0} tok` : ""}
                  {m.durationMs ? ` · ${(m.durationMs / 1000).toFixed(1)}s` : ""}
                  {c?.unaddressed ? " · not addressed" : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
