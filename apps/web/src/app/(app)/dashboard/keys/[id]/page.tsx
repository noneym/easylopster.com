import { notFound } from "next/navigation";
import { PROVIDERS, type ProviderId } from "@easylopster/shared/providers";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteKey, retestKey } from "../actions";
import { KeyEditForm } from "./key-edit-form";
import { KeyRotateForm } from "./key-rotate-form";

export const metadata = { title: "API key" };

function rotatedLabel(at: Date | null): string {
  if (!at) return "Never rotated";
  const mins = Math.round((Date.now() - at.getTime()) / 60_000);
  if (mins < 1) return "Rotated just now";
  if (mins < 60) return `Rotated ${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Rotated ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `Rotated ${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function KeyDetailPage({ params }: PageProps<"/dashboard/keys/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const key = await db.providerKey.findFirst({ where: { id, userId: user.id }, include: { bots: { select: { id: true, name: true } } } });
  if (!key) notFound();
  const info = PROVIDERS[key.provider as ProviderId];

  return (
    <>
      <PageHeader
        title={key.label}
        description={`${info?.label ?? key.provider} · ends in ${key.keyLast4}${key.baseUrl ? ` · ${key.baseUrl}` : ""}`}
        action={
          <form action={retestKey.bind(null, key.id)}>
            <button type="submit" className="btn-secondary">
              Test again
            </button>
          </form>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] max-w-5xl">
        <KeyEditForm id={key.id} label={key.label} defaultModel={key.defaultModel} models={(Array.isArray(key.modelsCache) ? (key.modelsCache as string[]) : null) ?? info?.models.map((m) => m.id) ?? []} />

        <aside className="space-y-4">
          <div className="card p-5">
            <p className="text-sm text-fg-muted">Last test</p>
            <p className={`mt-1 font-medium ${key.lastTestOk === false ? "text-accent-ink" : ""}`}>
              {key.lastTestOk == null ? "Never" : key.lastTestOk ? "Passed" : "Failed"}
            </p>
            {key.lastTestMsg && <p className="mt-1 text-sm text-fg-muted">{key.lastTestMsg}</p>}
            {key.lastTestedAt && <p className="mt-1 text-xs text-fg-faint">{key.lastTestedAt.toISOString().replace("T", " ").slice(0, 16)} UTC</p>}
          </div>
          <div className="card p-5">
            <p className="text-sm text-fg-muted">Used by</p>
            {key.bots.length === 0 ? (
              <p className="mt-1 text-sm">No agents yet.</p>
            ) : (
              <ul className="mt-1 text-sm space-y-1">
                {key.bots.map((b) => (
                  <li key={b.id}>{b.name}</li>
                ))}
              </ul>
            )}
          </div>
          <KeyRotateForm id={key.id} rotated={rotatedLabel(key.rotatedAt)} />
          <form action={deleteKey.bind(null, key.id)} className="card p-5">
            <p className="text-sm text-fg-muted">Danger</p>
            <p className="mt-1 text-sm">Deleting the key stops every bot that uses it until you assign another one.</p>
            <button type="submit" className="btn-secondary mt-3 text-accent-ink">
              Delete key
            </button>
          </form>
        </aside>
      </div>
    </>
  );
}
