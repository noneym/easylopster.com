import Link from "next/link";
import { KeyIcon } from "@phosphor-icons/react/dist/ssr";
import { PROVIDERS, type ProviderId } from "@easylopster/shared/providers";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "API keys" };

export default async function KeysPage() {
  const user = await requireUser();
  const keys = await db.providerKey.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys are encrypted at rest and only decrypted inside the gateway when a bot needs them."
        action={
          <Link href="/dashboard/keys/new" className="btn-primary">
            Add key
          </Link>
        }
      />
      {keys.length === 0 ? (
        <EmptyState
          icon={<KeyIcon size={24} />}
          title="No API keys"
          body="Add a key from Anthropic, OpenAI, Google, OpenRouter, DeepSeek or any OpenAI-compatible endpoint. You pay your provider directly."
          action={
            <Link href="/dashboard/keys/new" className="btn-primary">
              Add your first key
            </Link>
          }
        />
      ) : (
        <ul className="card divide-y divide-line">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{k.label}</p>
                <p className="text-sm text-fg-muted truncate">
                  {PROVIDERS[k.provider as ProviderId]?.label ?? k.provider} · ends in {k.keyLast4} · {k.defaultModel}
                </p>
              </div>
              <Link href={`/dashboard/keys/${k.id}`} className="btn-secondary h-9">
                Manage
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
