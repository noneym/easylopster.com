import Link from "next/link";
import { setBotSecrets } from "../../secrets/actions";

export function BotSecretsForm({ botId, secrets, linked }: { botId: string; secrets: { id: string; name: string; description: string | null }[]; linked: string[] }) {
  const action = setBotSecrets.bind(null, botId);
  return (
    <form action={action} className="card p-6">
      <h2 className="font-semibold tracking-tight">Secrets</h2>
      <p className="text-sm text-fg-muted mt-0.5">
        Injected as environment variables into this bot's shell commands (sandbox and nodes). The model never sees the values.{" "}
        <Link href="/dashboard/secrets" className="underline underline-offset-4 text-fg">
          Manage secrets
        </Link>
      </p>
      {secrets.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">No secrets yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {secrets.map((s) => (
            <li key={s.id} className="py-2.5 flex items-center gap-3">
              <input type="checkbox" id={`sec-${s.id}`} name={`secret:${s.id}`} defaultChecked={linked.includes(s.id)} className="size-4 accent-[var(--accent)]" />
              <label htmlFor={`sec-${s.id}`} className="text-sm">
                <span className="font-mono">${s.name}</span>
                {s.description && <span className="text-fg-muted"> · {s.description}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {secrets.length > 0 && (
        <button type="submit" className="btn-primary mt-4">
          Save secret settings
        </button>
      )}
    </form>
  );
}
