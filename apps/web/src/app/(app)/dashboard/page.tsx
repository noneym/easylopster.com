import Link from "next/link";
import { ArrowRightIcon, CheckCircleIcon, CircleIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { limitsFor } from "@/lib/limits";

export default async function OverviewPage() {
  const user = await requireUser();
  const limits = limitsFor(user);
  const [keys, bots, mcps, nodes, pending] = await Promise.all([
    db.providerKey.count({ where: { userId: user.id } }),
    db.bot.count({ where: { userId: user.id } }),
    db.mcpServer.count({ where: { userId: user.id } }),
    db.node.count({ where: { userId: user.id, status: { not: "revoked" } } }),
    db.pairingRequest.count({ where: { bot: { userId: user.id }, status: "pending", expiresAt: { gt: new Date() } } }),
  ]);

  const steps = [
    { done: keys > 0, label: "Add an API key", href: "/dashboard/keys", hint: "Anthropic, OpenAI, Gemini, OpenRouter or a custom endpoint." },
    { done: bots > 0, label: "Create an agent", href: "/dashboard/agents/new", hint: "From scratch (web chat, optionally Telegram) or imported from OpenClaw." },
    { done: pending === 0 && bots > 0, label: "Approve your first pairing", href: "/dashboard/agents", hint: "Message the bot, then approve the code here." },
  ];
  const firstName = user.name?.split(" ")[0] ?? "there";

  return (
    <>
      <PageHeader title={`Hi ${firstName}`} description="Your assistants, keys and machines in one place." />

      {steps.some((s) => !s.done) && (
        <section className="card p-6 mb-8">
          <h2 className="font-semibold tracking-tight">Get set up</h2>
          <ol className="mt-4 divide-y divide-line">
            {steps.map((s) => (
              <li key={s.label} className="py-3 flex items-start gap-3">
                {s.done ? (
                  <CheckCircleIcon size={20} weight="fill" className="text-accent-ink mt-0.5 shrink-0" />
                ) : (
                  <CircleIcon size={20} className="text-fg-faint mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${s.done ? "line-through text-fg-muted" : ""}`}>{s.label}</p>
                  <p className="text-xs text-fg-muted mt-0.5">{s.hint}</p>
                </div>
                {!s.done && (
                  <Link href={s.href} className="btn-ghost h-8 text-sm shrink-0">
                    Open <ArrowRightIcon size={14} />
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Agents", value: bots, limit: limits.bots, href: "/dashboard/agents" },
          { label: "API keys", value: keys, href: "/dashboard/keys" },
          { label: "MCP servers", value: mcps, limit: limits.mcp, href: "/dashboard/mcp" },
          { label: "Nodes", value: nodes, limit: limits.nodes, href: "/dashboard/nodes" },
        ].map((m) => (
          <Link key={m.label} href={m.href} className="card p-5 hover:border-line-strong transition-colors">
            <p className="text-sm text-fg-muted">{m.label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight font-mono tabular-nums">
              {m.value}
              {m.limit !== undefined && <span className="text-base text-fg-faint font-normal"> / {m.limit}</span>}
            </p>
          </Link>
        ))}
      </section>

      {pending > 0 && (
        <p className="mt-6 text-sm text-fg-muted">
          {pending} pairing {pending === 1 ? "request is" : "requests are"} waiting.{" "}
          <Link href="/dashboard/agents" className="text-fg underline underline-offset-4">
            Review
          </Link>
        </p>
      )}
    </>
  );
}
