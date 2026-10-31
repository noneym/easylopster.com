import { AppleLogoIcon, DesktopIcon, TerminalWindowIcon, CubeIcon } from "@phosphor-icons/react/dist/ssr";
import { APP_VERSION } from "@easylopster/shared/version";

const RELEASES = "https://github.com/noneym/easylopster.com/releases";

/**
 * "Get the node agent" card: what a node is and the ways to run one, with direct links to the
 * current Windows installer and macOS disk images. Shown on the nodes list, the new-node page and a node's page.
 */
export function NodeInstall({ pairingCode, gateway, compact = false }: { pairingCode?: string | null; gateway?: string; compact?: boolean }) {
  const code = pairingCode ?? "<pairing code>";
  const gw = gateway ?? "wss://gw.easylopster.com/ws";
  const exe = `easylopster-node-setup-${APP_VERSION}.exe`;
  const dmg = (arch: "arm64" | "x64") => `${RELEASES}/latest/download/easylopster-node-${APP_VERSION}-mac-${arch}.dmg`;
  return (
    <section className="card p-6 space-y-5">
      <div>
        <h2 className="font-[650] tracking-[-0.01em]">Install the node agent</h2>
        <p className="text-sm text-fg-muted mt-1">
          A node is a small program on a machine you own. It connects outbound to easylopster (no ports to open) and lets your agents read files in one shared folder, run commands there and, with the Windows or Mac app, drive a Brave browser. Create a node here to get a pairing code, then install the agent and paste the code once.
        </p>
      </div>
      <div className={`grid gap-5 ${compact ? "" : "lg:grid-cols-2 2xl:grid-cols-4"}`}>
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
            <AppleLogoIcon size={18} className="text-accent-ink" /> macOS: menu-bar app
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={dmg("arm64")} className="btn-primary h-9" download>
              Apple Silicon (M1–M4)
            </a>
            <a href={dmg("x64")} className="btn-secondary h-9" download>
              Intel Mac
            </a>
          </div>
          <p className="text-xs text-fg-muted">
            Open the .dmg and drag easylopster Node to Applications. It lives in the menu bar, can open at login and installs Brave when an agent first needs a browser. Not sure which Mac you have: Apple menu → About This Mac → Chip (or Processor).
          </p>
          <details className="text-xs text-fg-muted">
            <summary className="cursor-pointer text-fg font-medium">The app is not signed by Apple yet: how to open it</summary>
            <div className="mt-2 space-y-2">
              <p>macOS blocks unsigned apps the first time (“cannot be opened” or “is damaged”). Either:</p>
              <ol className="list-decimal pl-5 space-y-1">
                <li>
                  System Settings → Privacy &amp; Security → scroll down → <span className="text-fg">Open Anyway</span> next to easylopster Node, then confirm. Or right-click the app → Open.
                </li>
                <li>Or run this once in Terminal after copying it to Applications:</li>
              </ol>
              <pre className="card p-3 overflow-x-auto font-mono text-xs leading-relaxed text-fg">{`xattr -dr com.apple.quarantine "/Applications/easylopster Node.app"`}</pre>
              <p>It removes the “downloaded from the internet” flag; the app then opens normally. New versions are announced in the app with a Download button, since unsigned apps cannot update themselves on macOS.</p>
            </div>
          </details>
        </div>
        <div className="space-y-2">
          <p className="inline-flex items-center gap-2 font-medium">
            <TerminalWindowIcon size={18} className="text-accent-ink" /> Any machine with Node 22+
          </p>
          <pre className="card p-3 overflow-x-auto font-mono text-xs leading-relaxed">{`npx easylopster-node connect ${code} \\
  --gateway ${gw} --workspace ~/easylopster`}</pre>
          <p className="text-xs text-fg-muted">Linux servers, or Windows and macOS without the app. --workspace is the only folder agents can see; commands run inside it.</p>
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
