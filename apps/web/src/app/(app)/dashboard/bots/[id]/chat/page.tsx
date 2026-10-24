import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ensureWebConversation } from "./actions";
import { ChatClient } from "./chat-client";

export const metadata = { title: "Web chat" };

export default async function BotChatPage({ params }: PageProps<"/dashboard/bots/[id]/chat">) {
  const user = await requireUser();
  const { id } = await params;
  const bot = await db.bot.findFirst({ where: { id, userId: user.id }, select: { id: true, name: true, agentName: true, model: true, providerKeyId: true } });
  if (!bot) notFound();
  const { conversationId, messages } = await ensureWebConversation(bot.id);

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
      {!bot.providerKeyId ? (
        <p className="py-8 text-sm text-fg-muted">This bot has no API key. Assign one in settings first.</p>
      ) : (
        <ChatClient botId={bot.id} conversationId={conversationId} initial={messages} />
      )}
    </div>
  );
}
