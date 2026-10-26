import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { clearAutoApprove, deleteNode, onlineNodeIds, renewPairing, revokeNode } from "../actions";
import { NodeSettingsForm } from "./node-settings-form";

export const metadata = { title: "Node" };

const CAP_LABELS: Record<string, string> = {
  "fs.read": "Read files",
  "fs.write": "Write files",
  "fs.list": "List folders",
  "fs.search": "Search files",
  exec: "Run shell commands",
  "system.which": "Check installed programs",
  "system.notify": "Desktop notifications",
  "screen.snapshot": "Screenshots",
  "device.info": "Machine info",
  "browser.open": "Browser: open pages (Brave)",
  "browser.snapshot": "Browser: read pages",
  "browser.click": "Browser: click",
  "browser.type": "Browser: type",
  "browser.screenshot": "Browser: screenshots",
  "browser.tabs": "Browser: list/close tabs",
  "browser.eval": "Browser: run JavaScript",
  "browser.interact": "Browser: keys, scroll, hover, select, back/forward, wait",
  "browser.html": "Browser: read HTML",
  "browser.pdf": "Browser: save as PDF",
  "browser.cookies": "Browser: cookies (list/export/import/clear)",
  "browser.upload": "Browser: upload files from the shared folder",
  "browser.downloads": "Browser: list downloads",
  "browser.network": "Browser: network requests and API responses",
  "browser.profiles": "Browser: multiple Brave profiles",
  "system.clipboard": "Clipboard (read with approval / write)",
  "exec.jobs": "Background jobs (status/log/kill)",
};

export default async function NodeDetailPage({ params }: PageProps<"/dashboard/nodes/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const [node, online] = await Promise.all([
    db.node.findFirst({ where: { id, userId: user.id }, include: { bots: { include: { bot: { select: { id: true, name: true } } } } } }),
    onlineNodeIds(),
  ]);
  if (!node) notFound();
  const isOnline = online.has(node.id);
  const declared = Array.isArray(node.caps) ? (node.caps as string[]) : [];
  const enabled = new Set(Array.isArray(node.enabledCaps) ? (node.enabledCaps as string[]) : []);
  const gw = process.env.GATEWAY_WS_URL ?? "wss://gw.easylopster.com/ws";
  const pairingLive = node.status === "pending" && node.pairingCode && node.pairingExpiresAt && node.pairingExpiresAt > new Date();

  return (
    <>
      <PageHeader
        title={node.name}
        description={`${node.status === "revoked" ? "revoked" : isOnline ? "online" : node.status === "pending" ? "waiting for first connection" : "offline"}${node.platform ? ` · ${node.platform}${node.arch ? `/${node.arch}` : ""}` : ""}${
          node.agentVersion ? ` · agent ${node.agentVersion}` : ""
        }`}
      />

      {pairingLive && (
        <section className="card p-6 mb-6 border-accent/40">
          <h2 className="font-semibold tracking-tight">Pairing code</h2>
          <p className="mt-3 font-mono text-3xl tracking-[0.2em]">{node.pairingCode}</p>
          <p className="mt-1 text-xs text-fg-muted">Valid until {node.pairingExpiresAt!.toISOString().replace("T", " ").slice(0, 16)} UTC. Use it once; the agent then stores its own token.</p>
          <div className="mt-5 space-y-4 text-sm">
            <div>
              <p className="font-medium">Windows: install easylopster Node (tray app)</p>
              <p className="mt-1 text-fg-muted">
                Download <code>easylopster-node-setup-*.exe</code> from{" "}
                <a className="underline" href="https://github.com/noneym/easylopster.com/releases/latest" target="_blank" rel="noreferrer">
                  GitHub Releases
                </a>
                , open it, paste the code above and pick the folder to share. It keeps running in the tray and can start with Windows.
              </p>
            </div>
            <div>
              <p className="font-medium">Any machine with Node 22+ (Windows, macOS, Linux)</p>
              <pre className="mt-1 card p-3 overflow-x-auto font-mono text-xs leading-relaxed">{`npx easylopster-node connect ${node.pairingCode} --gateway ${gw} --workspace ~/easylopster`}</pre>
            </div>
            <div>
              <p className="font-medium">Or as a container with its own persistent folder</p>
              <pre className="mt-1 card p-3 overflow-x-auto font-mono text-xs leading-relaxed">{`docker run -d --name easylopster-node --restart unless-stopped \\
  -e EASYLOPSTER_GATEWAY=${gw} \\
  -e EASYLOPSTER_PAIRING_CODE=${node.pairingCode} \\
  -v easylopster-node:/data \\
  ghcr.io/noneym/easylopster-node:latest`}</pre>
            </div>
            <p className="text-fg-muted">The agent only opens an outbound connection; nothing to expose. --workspace limits what bots can see; commands run in that folder.</p>
          </div>
        </section>
      )}

      {node.status === "pending" && !pairingLive && (
        <section className="card p-6 mb-6">
          <p className="font-medium">Pairing code expired</p>
          <form action={renewPairing.bind(null, node.id)} className="mt-3">
            <button type="submit" className="btn-primary">
              New pairing code
            </button>
          </form>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <NodeSettingsForm
          node={{ id: node.id, name: node.name, execApproval: node.execApproval }}
          autoApprove={Array.isArray(node.autoApprove) ? (node.autoApprove as string[]) : []}
          clearAutoApprove={clearAutoApprove.bind(null, node.id)}
          caps={declared.map((c) => ({ id: c, label: CAP_LABELS[c] ?? c, enabled: enabled.has(c) }))}
        />
        <aside className="space-y-4">
          <div className="card p-5">
            <p className="text-sm text-fg-muted">Shared folder</p>
            <p className="mt-1 font-mono text-sm break-all">{node.workspaceRoot ?? "not reported yet"}</p>
            <p className="mt-3 text-sm text-fg-muted">Last seen</p>
            <p className="mt-1 text-sm">{node.lastSeenAt ? node.lastSeenAt.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never"}</p>
          </div>
          <div className="card p-5">
            <p className="text-sm text-fg-muted">Used by</p>
            {node.bots.length === 0 ? <p className="mt-1 text-sm">No bots yet. Enable it on a bot's page.</p> : <ul className="mt-1 text-sm space-y-1">{node.bots.map((b) => <li key={b.bot.id}>{b.bot.name}</li>)}</ul>}
          </div>
          <div className="card p-5 space-y-3">
            <p className="text-sm text-fg-muted">Danger</p>
            {node.status !== "revoked" && (
              <form action={revokeNode.bind(null, node.id)}>
                <button type="submit" className="btn-secondary">
                  Revoke access
                </button>
                <p className="help">Disconnects the agent and invalidates its token. Pair again to restore.</p>
              </form>
            )}
            {node.status === "revoked" && (
              <form action={renewPairing.bind(null, node.id)}>
                <button type="submit" className="btn-secondary">
                  Pair again
                </button>
              </form>
            )}
            <form action={deleteNode.bind(null, node.id)}>
              <button type="submit" className="btn-ghost text-accent-ink">
                Delete node
              </button>
            </form>
          </div>
        </aside>
      </div>
    </>
  );
}
