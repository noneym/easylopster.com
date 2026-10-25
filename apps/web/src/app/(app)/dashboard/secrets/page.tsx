import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteSecret } from "./actions";
import { SecretForm } from "./secret-form";

export const metadata = { title: "Secrets" };

export default async function SecretsPage({ searchParams }: PageProps<"/dashboard/secrets">) {
  const sp = await searchParams;
  const initialName = typeof sp.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(sp.name) ? sp.name : "";
  const user = await requireUser();
  const secrets = await db.secret.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, include: { bots: { include: { bot: { select: { name: true } } } } } });

  return (
    <>
      <PageHeader
        title="Secrets"
        description="Credentials your bots can use without ever seeing them: injected as environment variables into shell commands on the sandbox and your nodes. Encrypted at rest, never shown again."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="card">
          {secrets.length === 0 ? (
            <p className="p-6 text-sm text-fg-muted">No secrets yet. Add one on the right, then enable it per bot.</p>
          ) : (
            <ul className="divide-y divide-line">
              {secrets.map((s) => (
                <li key={s.id} className="px-5 py-4 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm">${s.name}</p>
                    {s.description && <p className="text-sm text-fg-muted">{s.description}</p>}
                    <p className="text-xs text-fg-faint mt-1">
                      {s.bots.length ? `Enabled for ${s.bots.map((b) => b.bot.name).join(", ")}` : "Not enabled for any bot yet"} · updated {s.updatedAt.toISOString().slice(0, 10)}
                    </p>
                  </div>
                  <form action={deleteSecret.bind(null, s.id)}>
                    <button type="submit" className="btn-ghost h-8 text-sm text-accent-ink">
                      Delete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
        <SecretForm initialName={initialName} />
      </div>
    </>
  );
}
