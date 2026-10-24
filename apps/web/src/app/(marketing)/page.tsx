import Link from "next/link";
import {
  BrainIcon,
  DesktopIcon,
  FolderSimpleIcon,
  KeyIcon,
  PlugsConnectedIcon,
  TelegramLogoIcon,
} from "@phosphor-icons/react/dist/ssr";
import { ChatPreview } from "@/components/marketing/chat-preview";
import { Reveal } from "@/components/marketing/reveal";

export default function HomePage() {
  return (
    <>
      {/* ───────────── Hero: asymmetric split ───────────── */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-14 pb-16 md:pt-24 md:pb-24 grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-center">
        <div className="max-w-xl">
          <p className="eyebrow mb-5">hosted · bring your own key · free beta</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl leading-[1.0]">
            An AI assistant that lives in your Telegram.
          </h1>
          <p className="mt-6 text-lg text-fg-muted leading-relaxed max-w-[48ch]">
            Bring your own API key, paste a bot token, start talking. No server to run, nothing to install.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/register" className="btn-primary h-11 px-5">
              Start free
            </Link>
            <a href="#how" className="btn-secondary h-11 px-5">
              How it works
            </a>
          </div>
        </div>
        <div className="lg:pl-6">
          <ChatPreview />
        </div>
      </section>

      {/* ───────────── Providers: logo row under the hero ───────────── */}
      <section aria-label="Supported model providers" className="border-y border-line bg-bg-sunk/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
          <p className="text-sm text-fg-muted mb-5">Works with the keys you already have</p>
          <ul className="flex flex-wrap items-center gap-x-10 gap-y-5">
            {[
              { slug: "anthropic", name: "Anthropic" },
              { slug: "openai", name: "OpenAI" },
              { slug: "googlegemini", name: "Google Gemini" },
              { slug: "openrouter", name: "OpenRouter" },
              { slug: "ollama", name: "Ollama" },
              { slug: "telegram", name: "Telegram" },
            ].map((l) => (
              <li key={l.slug} className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://cdn.simpleicons.org/${l.slug}/71717a`}
                  alt={l.name}
                  width={22}
                  height={22}
                  loading="lazy"
                  className="size-[22px] opacity-80 dark:invert-[.15]"
                />
                <span className="text-sm font-medium text-fg-muted">{l.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ───────────── How it works: vertical steps ───────────── */}
      <section id="how" className="mx-auto max-w-7xl px-4 sm:px-6 py-24 md:py-32 scroll-mt-20">
        <Reveal>
          <h2 className="text-3xl md:text-4xl max-w-2xl">Three pastes and you have an assistant.</h2>
        </Reveal>
        <ol className="mt-14 grid gap-px bg-line rounded-lg overflow-hidden border border-line md:grid-cols-3">
          {[
            {
              icon: KeyIcon,
              title: "Add an API key",
              body: "Anthropic, OpenAI, Gemini, OpenRouter or any OpenAI-compatible endpoint. Encrypted at rest, tested on save.",
            },
            {
              icon: TelegramLogoIcon,
              title: "Paste a bot token",
              body: "Create a bot with BotFather, paste the token. We verify it and wire the webhook. Add as many bots as you like.",
            },
            {
              icon: BrainIcon,
              title: "Talk to it",
              body: "Your first message gets a pairing code. Approve it once in the dashboard and the bot is yours. Nobody else gets in.",
            },
          ].map((s, i) => (
            <Reveal key={s.title} delay={i * 0.08} className="bg-bg-elev">
              <li className="h-full p-7 md:p-8">
                <s.icon size={26} weight="regular" className="text-accent-ink" />
                <h3 className="mt-6 text-lg font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-sm text-fg-muted leading-relaxed">{s.body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* ───────────── Capabilities: bento, 5 cells ───────────── */}
      <section id="capabilities" className="border-t border-line bg-bg-sunk/60 scroll-mt-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-24 md:py-32">
          <Reveal>
            <h2 className="text-3xl md:text-4xl max-w-2xl">
              Hosted by default. Yours when you want it.
            </h2>
            <p className="mt-4 text-fg-muted max-w-[60ch] leading-relaxed">
              Everything runs on our side until you decide to plug in your own tools, servers or machines.
            </p>
          </Reveal>

          <div className="mt-14 grid gap-4 md:grid-cols-6 md:grid-rows-2">
            {/* 1: MCP, large, gradient */}
            <Reveal className="md:col-span-4 md:row-span-1">
              <article className="card h-full p-7 md:p-8 bg-[linear-gradient(135deg,var(--accent-soft),transparent_60%)]">
                <PlugsConnectedIcon size={26} className="text-accent-ink" />
                <h3 className="mt-6 text-xl font-semibold tracking-tight">MCP servers, pluggable per bot</h3>
                <p className="mt-2 text-sm text-fg-muted leading-relaxed max-w-[52ch]">
                  Point a bot at any Model Context Protocol server over HTTP or SSE. Tools are discovered automatically and you
                  pick which bots may call which tools.
                </p>
              </article>
            </Reveal>
            {/* 2: Workspace, dark tile */}
            <Reveal delay={0.05} className="md:col-span-2">
              <article className="card h-full p-7 bg-fg text-bg dark:bg-bg-elev dark:text-fg">
                <FolderSimpleIcon size={26} className="opacity-90" />
                <h3 className="mt-6 text-lg font-semibold tracking-tight">A workspace with memory</h3>
                <p className="mt-2 text-sm opacity-75 leading-relaxed">
                  Persona, notes and daily memory live as plain files you can read and edit.
                </p>
              </article>
            </Reveal>
            {/* 3: Nodes, image-like gradient */}
            <Reveal delay={0.1} className="md:col-span-2">
              <article className="card h-full p-7 relative overflow-hidden">
                <div
                  aria-hidden
                  className="absolute -right-10 -bottom-12 size-44 rounded-full bg-[radial-gradient(circle_at_30%_30%,var(--accent)_0%,transparent_65%)] opacity-40"
                />
                <DesktopIcon size={26} className="text-accent-ink" />
                <h3 className="mt-6 text-lg font-semibold tracking-tight">Your machine as a node</h3>
                <p className="mt-2 text-sm text-fg-muted leading-relaxed">
                  One command connects Windows, macOS, Linux or a Docker host. Files and shell, with approvals.
                </p>
              </article>
            </Reveal>
            {/* 4: Multi bot */}
            <Reveal delay={0.15} className="md:col-span-2">
              <article className="card h-full p-7">
                <TelegramLogoIcon size={26} className="text-accent-ink" />
                <h3 className="mt-6 text-lg font-semibold tracking-tight">Many bots, one account</h3>
                <p className="mt-2 text-sm text-fg-muted leading-relaxed">
                  A terse ops bot on one model, a chatty research bot on another. Each with its own prompt and access list.
                </p>
              </article>
            </Reveal>
            {/* 5: Providers */}
            <Reveal delay={0.2} className="md:col-span-2">
              <article className="card h-full p-7 bg-[linear-gradient(180deg,transparent,var(--accent-soft))]">
                <KeyIcon size={26} className="text-accent-ink" />
                <h3 className="mt-6 text-lg font-semibold tracking-tight">Your keys, your bill</h3>
                <p className="mt-2 text-sm text-fg-muted leading-relaxed">
                  We never resell tokens. Usage shows up on your provider invoice, and in the dashboard.
                </p>
              </article>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ───────────── Nodes: split with real code ───────────── */}
      <section id="nodes" className="mx-auto max-w-7xl px-4 sm:px-6 py-24 md:py-32 grid gap-12 lg:grid-cols-2 lg:items-center scroll-mt-20">
        <Reveal>
          <h2 className="text-3xl md:text-4xl">Reach your own machines when the cloud is not enough.</h2>
          <p className="mt-4 text-fg-muted max-w-[58ch] leading-relaxed">
            A node is a small agent you run anywhere. It opens an outbound connection, declares what it can do, and waits.
            Risky commands ask for approval right in the chat.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-fg-muted">
            <li>Windows, macOS and Linux binaries, or a Docker image with a persistent volume.</li>
            <li>Capabilities are opt-in per node: files, shell, screenshots, notifications.</li>
            <li>Revoke a node from the dashboard and it is gone instantly.</li>
          </ul>
        </Reveal>
        <Reveal delay={0.1}>
          <pre className="card overflow-x-auto p-5 text-[13px] leading-relaxed font-mono text-fg">
            <code>{`# on your machine
npx easylopster-node connect 7KQ2-M9XA

# or as a container with its own filesystem
docker run -d --name el-node \\
  -e EASYLOPSTER_TOKEN=... \\
  -v el-workspace:/workspace \\
  ghcr.io/noneym/easylopster-node`}</code>
          </pre>
        </Reveal>
      </section>

      {/* ───────────── CTA ───────────── */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20 md:py-28 flex flex-col md:flex-row md:items-end md:justify-between gap-8">
          <div>
            <h2 className="text-3xl md:text-4xl">Free while in beta.</h2>
            <p className="mt-3 text-fg-muted max-w-[50ch] leading-relaxed">
              Three bots, two nodes, five MCP servers per account. Enough to run a small team's worth of assistants.
            </p>
          </div>
          <Link href="/register" className="btn-primary h-11 px-6 self-start md:self-auto">
            Start free
          </Link>
        </div>
      </section>
    </>
  );
}
