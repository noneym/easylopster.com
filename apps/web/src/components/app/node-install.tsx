import { DesktopIcon, TerminalWindowIcon, CubeIcon } from "@phosphor-icons/react/dist/ssr";
import { APP_VERSION } from "@easylopster/shared/version";

const RELEASES = "https://github.com/noneym/easylopster.com/releases";

/**
 * "Get the node agent" card: what a node is and the three ways to run one, with the direct link
 * to the current Windows installer. Shown on the nodes list, the new-node page and a node's page.
 */
export function NodeInstall({ pairingCode, gateway, compact = false }: { pairingCode?: string | null; gateway?: string; compact?: boolean }) {
  const code = pairingCode ?? "<pairing code>";
  const gw = gateway ?? "wss://gateway.easylopster.com/ws";
  const exe = `easylopster-node-setup-${APP_VERSION}.exe`;
  return (
    <section className="card p-6 space-y-5">
      <div>
        <h2 className="font-[650] tracking-[-0.01em]">Install the node agent</h2>
        <p className="text-sm text-fg-muted mt-1">
          A node is a small program on a machine you own. It connects outbound to easylopster (no ports to open) and lets your bots read files in one shared folder, run commands there and, on Windows, drive a Brave browser. Create a node here to get a pairing code, then install the agent and paste the code once.
        </p>
      </div>
      <div className={`grid gap-5 ${compact ? "" : "lg:grid-cols-3"}`}>
        <div className="space-y-2">
          <p className="inline-flex items-center gap-2 font-medium">
            <DesktopIcon size={18} className="text-accent-ink" /> Windows: tray app
          </p>
          <a href={`${RELEASES}/latest/download/${exe}`} className="btn-primary h-9" download>
            Download for Windows (v{APP_VERSION})
          </a>
          <p className="text-xs text-fg-muted">
            Open the installer, paste the pairing code, pick the folder to share. Runs in the tray, can start with Windows, updates itself, and installs Brave for browser control when needed. Unsigned for now, so SmartScreen may ask for “More info → Run anyway”.{" "}
            <a href={RELEASES} target="_blank" rel="noreferrer" className="underline underline-offset-4 text-fg">
              All releases
            </a>
          </p>
        </div>
        <div className="space-y-2">
          <p className="inline-flex items-center gap-2 font-medium">
            <TerminalWindowIcon size={18} className="text-accent-ink" /> Any machine with Node 22+
          </p>
          <pre className="card p-3 overflow-x-auto font-mono text-xs leading-relaxed">{`npx easylopster-node connect ${code} \\
  --gateway ${gw} --workspace ~/easylopster`}</pre>
          <p className="text-xs text-fg-muted">macOS, Linux or Windows. --workspace is the only folder bots can see; commands run inside it.</p>
        </div>
        <div className="space-y-2">
          <p className="inline-flex items-center gap-2 font-medium">
            <CubeIcon size={18} className="text-accent-ink" /> Docker
          </p>
          <pre className="card p-3 overflow-x-auto font-mono text-xs leading-relaxed">{`docker run -d --name easylopster-node --restart unless-stopped \\
  -e EASYLOPSTER_GATEWAY=${gw} \\
  -e EASYLOPSTER_PAIRING_CODE=${code} \\
  -v easylopster-node:/data \\
  ghcr.io/noneym/easylopster-node:latest`}</pre>
          <p className="text-xs text-fg-muted">A container with its own persistent folder; good for servers.</p>
        </div>
      </div>
    </section>
  );
}
