import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { LIMITS } from "@/lib/limits";
import { PROVIDERS, type ProviderId } from "@easylopster/shared/providers";
import { NewBotForm } from "./new-bot-form";

export const metadata = { title: "New bot" };

export default async function NewBotPage() {
  const user = await requireUser();
  const [keys, count] = await Promise.all([
    db.providerKey.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.bot.count({ where: { userId: user.id } }),
  ]);

  return (
    <>
      <PageHeader title="Connect a Telegram bot" description="Open @BotFather in Telegram, send /newbot, and paste the token it gives you." />
      {keys.length === 0 ? (
        <div className="card p-6 max-w-xl">
          <p className="font-medium">Add an API key first</p>
          <p className="mt-1 text-sm text-fg-muted">A bot needs a model to answer with. Keys take a minute to add.</p>
          <Link href="/dashboard/keys/new" className="btn-primary mt-4">
            Add API key
          </Link>
        </div>
      ) : count >= LIMITS.bots ? (
        <div className="card p-6 max-w-xl">
          <p className="font-medium">Bot limit reached</p>
          <p className="mt-1 text-sm text-fg-muted">The beta allows {LIMITS.bots} bots per account. Delete one to connect another.</p>
        </div>
      ) : (
        <NewBotForm
          keys={keys.map((k) => ({
            id: k.id,
            label: `${k.label} (${PROVIDERS[k.provider as ProviderId]?.label ?? k.provider})`,
            defaultModel: k.defaultModel,
            models: PROVIDERS[k.provider as ProviderId]?.models.map((m) => m.id) ?? [],
          }))}
        />
      )}
    </>
  );
}
