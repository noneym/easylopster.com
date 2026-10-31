import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitsFor } from "@/lib/limits";
import { appOriginFromHeaders } from "@/lib/app-origin";
import { PROVIDERS, type ProviderId } from "@easylopster/shared/providers";
import { NewBotForm } from "./new-bot-form";
import { RemoteImport } from "../[id]/import/remote-import";
import { latestImportSession } from "../[id]/import/actions";

export const metadata = { title: "New agent" };

export default async function NewBotPage() {
  const user = await requireUser();
  const [keys, count, origin, lastImport] = await Promise.all([
    db.providerKey.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.bot.count({ where: { userId: user.id } }),
    appOriginFromHeaders(),
    latestImportSession(null),
  ]);
  const limitReached = count >= limitsFor(user).bots;

  return (
    <>
      <PageHeader title="New agent" description="Create one from scratch, or move an existing OpenClaw agent here with one command on its machine." />
      {keys.length === 0 && !limitReached && (
        <div className="mb-6 rounded-md border border-line bg-bg-sunk px-4 py-3 text-sm text-fg-muted">
          No API key on the account yet. You can still import from OpenClaw (its keys come along when ticked); an agent from scratch needs a key first.
        </div>
      )}
      {limitReached ? (
        <div className="card p-6 max-w-xl">
          <p className="font-medium">Bot limit reached</p>
          <p className="mt-1 text-sm text-fg-muted">Your account allows {limitsFor(user).bots} bots. Delete one to create another.</p>
        </div>
      ) : (
        <div className="grid gap-8 xl:grid-cols-2 items-start">
          <section className="space-y-3">
            <div>
              <h2 className="font-[650] tracking-[-0.01em]">Start from scratch</h2>
              <p className="text-sm text-fg-muted mt-1">Name it, pick a model, optionally add a Telegram token. The first chat is an interview where the bot writes its own persona files.</p>
            </div>
            {keys.length === 0 ? (
              <div className="card p-6">
                <p className="font-medium">Add an API key first</p>
                <p className="mt-1 text-sm text-fg-muted">A bot needs a model to answer with. Keys take a minute to add.</p>
                <Link href="/dashboard/keys/new" className="btn-primary mt-4">
                  Add API key
                </Link>
              </div>
            ) : (
              <NewBotForm
                keys={keys.map((k) => ({
                  id: k.id,
                  label: `${k.label} (${PROVIDERS[k.provider as ProviderId]?.label ?? k.provider})`,
                  defaultModel: k.defaultModel,
                  models: (Array.isArray(k.modelsCache) ? (k.modelsCache as string[]) : null) ?? PROVIDERS[k.provider as ProviderId]?.models.map((m) => m.id) ?? [],
                }))}
              />
            )}
          </section>
          <section className="space-y-3">
            <div>
              <h2 className="font-[650] tracking-[-0.01em]">Import from OpenClaw</h2>
              <p className="text-sm text-fg-muted mt-1">
                Run one command on the machine where OpenClaw runs. It reads <span className="font-mono">openclaw.json</span> (bot name, Telegram token, model, API keys) and the workspace (persona, memory, skills, scripts), creates the bot here and shows every step on this page.
              </p>
            </div>
            <RemoteImport
              botId={null}
              origin={origin}
              hasMemory={false}
              initial={lastImport}
              keys={keys.map((k) => ({
                id: k.id,
                provider: k.provider,
                label: `${k.label} (${PROVIDERS[k.provider as ProviderId]?.label ?? k.provider})`,
                defaultModel: k.defaultModel,
                models: (Array.isArray(k.modelsCache) ? (k.modelsCache as string[]) : null) ?? PROVIDERS[k.provider as ProviderId]?.models.map((m) => m.id) ?? [],
              }))}
            />
          </section>
        </div>
      )}
    </>
  );
}
