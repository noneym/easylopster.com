import Link from "next/link";
import { notFound } from "next/navigation";
import { PROVIDERS, type ProviderId } from "@easylopster/shared/providers";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { decidePairing, deleteBot, removeAllowlistEntry, resetWebhook, setBotStatus } from "../actions";
import { BotSettingsForm } from "./bot-settings-form";
import { AllowlistForm } from "./allowlist-form";
import { BotMcpForm } from "./bot-mcp-form";
import { BotNodesForm } from "./bot-nodes-form";
import { BotSecretsForm } from "./bot-secrets-form";
import { AutomationsSection } from "./automations/automations-section";
import { onlineNodeIds } from "../../nodes/actions";

export const metadata = { title: "Bot" };

export default async function BotDetailPage({ params }: PageProps<"/dashboard/bots/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [bot, keys, mcpServers, nodes, online, secrets] = await Promise.all([
    db.bot.findFirst({
      where: { id, userId: user.id },
      include: {
        allowlist: { orderBy: { createdAt: "asc" } },
        mcps: true,
        nodes: true,
        secrets: true,
        automations: { orderBy: { createdAt: "asc" } },
        pairings: { where: { status: "pending", expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } },
        _count: { select: { conversations: true } },
      },
    }),
    db.providerKey.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.mcpServer.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.node.findMany({ where: { userId: user.id, status: { not: "revoked" } }, orderBy: { createdAt: "asc" } }),
    onlineNodeIds(),
    db.secret.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { id: true, name: true, description: true } }),
  ]);
  if (!bot) notFound();

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const usage = await db.usageDaily.findFirst({ where: { botId: bot.id, day: today } });

  return (
    <>
      <PageHeader
        title={bot.name}
        description={`${bot.tgUsername ? `@${bot.tgUsername}` : "unverified"} · ${bot.status}${bot.webhookSetAt ? " · webhook set" : " · webhook missing"}`}
        action={
          <div className="flex gap-2">
            <Link href={`/dashboard/bots/${bot.id}/conversations`} className="btn-secondary">
              Conversations
            </Link>
            <Link href={`/dashboard/bots/${bot.id}/files`} className="btn-secondary">
              Workspace
            </Link>
            <Link href={`/dashboard/bots/${bot.id}/skills`} className="btn-secondary">
              Skills
            </Link>
            <Link href={`/dashboard/bots/${bot.id}/chat`} className="btn-secondary">
              Web chat
            </Link>
            {bot.tgUsername && (
              <a href={`https://t.me/${bot.tgUsername}`} target="_blank" rel="noreferrer" className="btn-primary">
                Open in Telegram
              </a>
            )}
          </div>
        }
      />

      {bot.lastError && (
        <div role="alert" className="mb-6 rounded-md border border-accent/40 bg-accent-soft px-4 py-3 text-sm">
          <p className="font-medium">Last error</p>
          <p className="mt-0.5 text-fg-muted break-all">{bot.lastError}</p>
          <form action={resetWebhook.bind(null, bot.id)} className="mt-2">
            <button type="submit" className="btn-secondary h-8">
              Re-register webhook
            </button>
          </form>
        </div>
      )}

      {bot.pairings.length > 0 && (
        <section className="card p-5 mb-6 border-accent/40">
          <h2 className="font-semibold tracking-tight">Pairing requests</h2>
          <p className="text-sm text-fg-muted mt-0.5">People who messaged the bot and are waiting for access. Codes expire after an hour.</p>
          <ul className="mt-3 divide-y divide-line">
            {bot.pairings.map((p) => (
              <li key={p.id} className="py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {p.tgName ?? "Unknown"} {p.tgUsername ? <span className="text-fg-muted">@{p.tgUsername}</span> : null}
                  </p>
                  <p className="text-xs text-fg-muted font-mono">
                    id {p.tgUserId} · code {p.code}
                  </p>
                </div>
                <form action={decidePairing.bind(null, p.id, "approved")}>
                  <button type="submit" className="btn-primary h-8">
                    Approve
                  </button>
                </form>
                <form action={decidePairing.bind(null, p.id, "rejected")}>
                  <button type="submit" className="btn-ghost h-8">
                    Dismiss
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <BotSettingsForm
            bot={{
              id: bot.id,
              name: bot.name,
              agentName: bot.agentName ?? "",
              providerKeyId: bot.providerKeyId ?? "",
              model: bot.model ?? "",
              thinking: bot.thinking,
              systemPrompt: bot.systemPrompt ?? "",
              userProfile: bot.userProfile ?? "",
              dmPolicy: bot.dmPolicy,
              groupPolicy: bot.groupPolicy,
              requireMention: bot.requireMention,
              streaming: bot.streaming,
              replyToMode: bot.replyToMode,
              exec: (bot.toolPolicy as { exec?: string } | null)?.exec ?? "off",
              sessionReset: bot.sessionReset,
              resetAtHour: bot.resetAtHour,
              resetIdleMinutes: bot.resetIdleMinutes,
              ackReaction: bot.ackReaction,
              dreaming: bot.dreaming,
            }}
            keys={keys.map((k) => ({
              id: k.id,
              label: `${k.label} (${PROVIDERS[k.provider as ProviderId]?.label ?? k.provider})`,
              defaultModel: k.defaultModel,
              models: (Array.isArray(k.modelsCache) ? (k.modelsCache as string[]) : null) ?? PROVIDERS[k.provider as ProviderId]?.models.map((m) => m.id) ?? [],
            }))}
          />

          <section className="card p-6">
            <h2 className="font-semibold tracking-tight">Allowed users and groups</h2>
            <p className="text-sm text-fg-muted mt-0.5">
              Approved pairings land here. With the allowlist policy, only these ids can talk to the bot. Send /whoami to the bot to find an id.
            </p>
            {bot.allowlist.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {bot.allowlist.map((a) => (
                  <li key={a.id} className="py-2.5 flex items-center gap-3">
                    <span className="text-xs uppercase tracking-wide text-fg-faint w-12">{a.kind}</span>
                    <span className="font-mono text-sm">{a.tgId}</span>
                    <span className="text-sm text-fg-muted flex-1 truncate">{a.label}</span>
                    <form action={removeAllowlistEntry.bind(null, a.id)}>
                      <button type="submit" className="btn-ghost h-8 text-sm">
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <AllowlistForm botId={bot.id} />
          </section>

          <BotMcpForm
            botId={bot.id}
            servers={mcpServers.map((s) => ({
              id: s.id,
              name: s.name,
              status: s.status,
              tools: Array.isArray(s.toolsCache) ? (s.toolsCache as { name: string; description?: string }[]) : [],
            }))}
            links={bot.mcps.map((m) => ({ mcpServerId: m.mcpServerId, allowedTools: Array.isArray(m.allowedTools) ? (m.allowedTools as string[]) : null }))}
          />

          <BotNodesForm
            botId={bot.id}
            nodes={nodes.map((n) => ({
              id: n.id,
              name: n.name,
              status: n.status,
              online: online.has(n.id),
              caps: Array.isArray(n.enabledCaps) ? (n.enabledCaps as string[]) : [],
            }))}
            linked={bot.nodes.map((l) => l.nodeId)}
          />

          <BotSecretsForm botId={bot.id} secrets={secrets} linked={bot.secrets.map((l) => l.secretId)} />

          <AutomationsSection
            botId={bot.id}
            hasOwnerChat={!!bot.ownerTgChatId}
            hasHeartbeat={bot.automations.some((a) => a.name === "Proactive check")}
            rows={bot.automations.map((a) => {
              const s = a.schedule as { kind: string; everyMs?: number; expr?: string; tz?: string; at?: string };
              const schedule = s.kind === "every" ? `every ${Math.round((s.everyMs ?? 0) / 60000)} min` : s.kind === "cron" ? `cron ${s.expr}` : `once at ${s.at}`;
              return {
                id: a.id,
                name: a.name,
                enabled: a.enabled,
                schedule,
                prompt: a.prompt,
                sessionTarget: a.sessionTarget,
                idleOnly: a.idleOnly,
                createdBy: a.createdBy,
                nextRunAt: a.nextRunAt?.toISOString() ?? null,
                lastRunAt: a.lastRunAt?.toISOString() ?? null,
                lastStatus: a.lastStatus,
                lastResult: a.lastResult,
                lastError: a.lastError,
                runCount: a.runCount,
              };
            })}
          />
        </div>

        <aside className="space-y-4">
          <div className="card p-5">
            <p className="text-sm text-fg-muted">Today</p>
            <p className="mt-1 text-2xl font-semibold font-mono tabular-nums">{usage?.messages ?? 0}</p>
            <p className="text-xs text-fg-muted">
              messages · {(usage?.tokensIn ?? 0) + (usage?.tokensOut ?? 0)} tokens · {bot._count.conversations} conversations
            </p>
          </div>
          <div className="card p-5 space-y-3">
            <p className="text-sm text-fg-muted">Status</p>
            <p className="font-medium capitalize">{bot.status}</p>
            <div className="flex flex-wrap gap-2">
              {bot.status === "active" ? (
                <form action={setBotStatus.bind(null, bot.id, "paused")}>
                  <button type="submit" className="btn-secondary h-8">
                    Pause
                  </button>
                </form>
              ) : (
                <form action={setBotStatus.bind(null, bot.id, "active")}>
                  <button type="submit" className="btn-primary h-8">
                    Resume
                  </button>
                </form>
              )}
              <form action={resetWebhook.bind(null, bot.id)}>
                <button type="submit" className="btn-ghost h-8">
                  Re-register webhook
                </button>
              </form>
            </div>
          </div>
          <form action={deleteBot.bind(null, bot.id)} className="card p-5">
            <p className="text-sm text-fg-muted">Danger</p>
            <p className="mt-1 text-sm">Deletes the bot, its conversations and workspace. The Telegram bot itself stays in BotFather.</p>
            <button type="submit" className="btn-secondary mt-3 text-accent-ink">
              Delete bot
            </button>
          </form>
        </aside>
      </div>
    </>
  );
}
