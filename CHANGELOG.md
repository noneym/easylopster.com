# Changelog

All notable changes to easylopster are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- A development gateway sharing the production database ran everyone's automations and dreaming
  on the developer's machine (wrong workspace, no nodes) and messaged the owners; `GATEWAY_ACCOUNT_EMAILS`
  now scopes polling, the automation scheduler and dreaming to the listed accounts.
- A reply ending in a NO_REPLY line is delivered without that line; a reply that is only NO_REPLY
  (with or without punctuation) stays silent.

### Added
- Telegram streaming modes "Block" and "Progress" now do what their labels say: Block sends each
  completed paragraph as its own message while the reply is still being written (code fences are
  never split); Progress shows one silent status message (thinking / running <tool> / writing…)
  and replaces it with the final answer as a fresh, notifying message. Partial and Off are unchanged.
- MCP catalog on the MCP servers page: Cloudflare (API, Docs, Browser Rendering), GitHub, Context7,
  DeepWiki, Hugging Face, Exa, Tavily, Firecrawl, Stripe, Zapier and Composio (the last two are the
  route to Gmail, Google Calendar, Drive, Sheets and thousands of other apps). "Use" opens the add
  form prefilled with the URL, transport and header template plus where to get the credential.
- NameSilo bridge: mcp.namesilo.com speaks plain JSON-RPC rather than MCP, so a built-in `namesilo`
  tool (domains, DNS, name servers, email forwarding, balance; 80+ methods from the server's
  manifest) appears for bots that have the Secret NAMESILO_API_KEY; the catalog card links to the
  Secrets page with the name prefilled.

### Changed
- Workspace file browser is a real tree: folders collapse and expand (memory/ and skills/ open by default), files sit inside their folders; the filter still searches flat.

## [1.3.0] - 2026-10-24

### Added
- Long tasks are no longer left half done: the per-turn tool budget is 40 steps (was 12, env
  `MAX_STEPS`), the run timeout is 10 minutes (`RUN_TIMEOUT_MS`), and when a turn is cut off by
  the budget the gateway automatically continues it (up to `MAX_CONTINUATIONS`, default 2) with a
  "continue where you stopped" nudge; the partial reply stays in history, the final reply is sent once.
- `/crons` (alias `/automations`) on Telegram lists the bot's automations with schedule, next run and
  last status in the owner's time zone.
- Web chat shows earlier sessions of the bot in a left panel (desktop widths) with links to their
  transcripts.
- Import from OpenClaw (bot page → Import): pick the OpenClaw workspace folder in the browser, see
  what is importable grouped as persona, memory, heartbeat, skills and scripts (media, .git, trash
  and large files are skipped before upload), choose append or replace for MEMORY.md, optionally
  create a "Proactive check" automation that follows HEARTBEAT.md. Persona files are mirrored into
  settings and BOOTSTRAP.md is removed so the imported bot skips the first-run interview. TOOLS.md
  is now loaded as workspace context like AGENTS.md and IDENTITY.md. Large imports go up in batches of 120 files (up to 2000 files / 50 MB).
- "Always allow" answer on node approvals (Telegram button and web chat): the action (exec,
  browser.open, browser.click, browser.type) stops asking on that node; the node page lists these
  and lets you remove one to be asked again.
- "Test this model" next to the model picker (bot settings and API key page): one tiny prompt
  through the gateway shows the latency and reply, or the provider's error / a 25 s timeout, so
  broken models on a provider are caught before a bot is pointed at them.

### Fixed
- Icon-only buttons (theme toggle, mobile sign-out) rendered a 2px icon because the shared button
  padding overrode `px-0`; the theme toggle is now a bordered 36px button with a bold icon.
- Landing nav/footer section links point at the home page, so they work from /changelog.
- Node tool names: the runtime context now spells out the exact tool prefix per node
  (`node_<slug>_<cap>`) and says when a node is offline, so the model stops guessing names.
- Tray app dev runs (`electron .`) use their own config file instead of the installed app's
  `~/.easylopster/node.json`, so a development session can no longer repoint a real node at a
  local gateway.

## [1.2.0] - 2026-10-24

### Added
- Browser control on Windows nodes: easylopster Node (tray app) gets a "Browser control (Brave)"
  toggle. When on, the node declares `browser.open / snapshot / click / type / screenshot / tabs`
  and drives a separate Brave window (its own profile under the app's data folder, the user's
  normal Brave profile is untouched) over the Chrome DevTools protocol. Bots get
  `node_<name>_browser_*` tools: text snapshots with element refs, clicks and typing by ref or
  selector, PNG screenshots the model sees and can attach with `MEDIA:` (copied into the bot's
  cloud workspace `inbox/`). Open / click / type go through the same chat approval as shell
  commands when the node is set to "ask"; snapshot, screenshot and tabs are free. brave.exe is
  auto-detected or can be located in the app's settings.

### Fixed
- Dashboard forms no longer reset after saving (React 19 action reset), which snapped the model
  picker back to the first entry and made the next save submit the wrong model.
- Web chat shows a "Thinking" / "Running <tool>" indicator while a reply is pending.
- Dev polling can be limited to specific accounts (`TELEGRAM_POLLING_EMAILS`) so a local gateway on a shared database never takes over production bots' webhooks.
- Node settings: capabilities the dashboard did not know yet (the new browser.* ones) were silently dropped on save, so enabling them appeared to revert; the schema now includes them.

## [1.1.1] - 2026-10-24

### Added
- Public changelog page at /changelog (rendered from CHANGELOG.md at build time), a detailed
  "everything in the box" feature section on the landing page, contact address hello@easylopster.com.
- Web chat button on the bots list; time zone picker (grouped IANA list) in settings.

### Fixed
- Provider logos are served locally (OpenAI's icon had disappeared from the public CDN).
- Windows installer build: the generated .ico now carries a 256px frame (the 1.1.0 release had no
  installer because electron-builder rejected the icon).

## [1.1.0] - 2026-10-24

### Added
- Cloudflare Email Service as the mail transport (`MAIL_MAILER=cloudflare`), with SMTP still available; styled verification email.
- Conversational onboarding (OpenClaw-style BOOTSTRAP.md): a new bot's workspace ships with BOOTSTRAP.md,
  creating a bot opens the web chat and the bot interviews the owner, then writes IDENTITY.md, SOUL.md,
  USER.md and MEMORY.md itself and deletes BOOTSTRAP.md. SOUL.md/USER.md now live in the workspace
  (the dashboard form mirrors them) and the bot may edit them on request.
- Setup by conversation: `setup_keys` (list keys/models, switch model), `setup_mcp` (add with connection
  test, link, unlink, remove), `setup_node` (pairing code + install instructions), `secrets` with
  `set`/`link`/`unlink`/`remove` (pasted values are encrypted and scrubbed from the chat transcript),
  `skill_import` (from a raw SKILL.md URL), `skill_delete`, `fs_delete`.
- Skills page per bot in the dashboard: list from the workspace, create from template, import from URL,
  edit, delete.
- Web chat catch-up: a pending reply is fetched from the database if the live stream missed it.

### Changed
- Brand refresh from the "claw bubble" sheet: new mark and lockup, Bricolage Grotesque + JetBrains Mono,
  warm paper / ink palette with the #FF4F2E accent, heavier display headings, mono eyebrows; favicon,
  app icons, Open Graph card, bot avatar and Windows tray/installer icons regenerated from the mark
  (`node scripts/gen-icons.mjs`).
- Telegram polling stops polling a bot whose token Telegram rejects (401) and records the error on the bot; web chat keeps working.
- Windows tray app `easylopster Node` (`packages/node-desktop`, Electron): pair with a code, pick the shared
  folder, see status and activity, start with Windows, native notifications; NSIS installer attached to
  GitHub Releases by the release workflow.
- Node agent split into a library (`easylopster-node/agent`: `createNodeAgent` with status/log/notify hooks)
  and the thin CLI.

## [1.0.0] - 2026-10-24

First public beta. A hosted, zero-install reimplementation of the OpenClaw idea: sign up on the
web, bring your own LLM key, connect Telegram bots, MCP servers and your own machines.

### Added

**Accounts and dashboard**
- Email/password sign-up and sign-in (argon2id, database sessions), optional email verification
  (SMTP) and Google sign-in (env-gated).
- SSR landing page, auto light/dark theme, dashboard with overview checklist and beta quotas.
- Usage page (messages, tokens, tool calls per day, per bot).

**Models and bots**
- API keys for Anthropic, OpenAI, OpenRouter, Google, DeepSeek and any OpenAI-compatible endpoint;
  keys are validated with a list-models call, stored encrypted, and the provider's model list is
  cached for pickers.
- Telegram bots via BotFather token: getMe verification, webhook registration, command menu,
  per-bot model/thinking level, persona (SOUL.md) and owner profile (USER.md), access policies
  (pairing, allowlist, open), group mention gating, streaming modes, reply threading, ack reaction,
  daily/idle session reset policies.
- Pairing flow for strangers (8-character code, 1 hour, max 3 pending) with dashboard approval.
- Web chat per bot with live streaming (Redis pub/sub + SSE) and Markdown rendering.

**Agent runtime (gateway)**
- OpenClaw-style system prompt (Execution Bias, Promised Work, Care, Conversation Context,
  Silent Replies, Runtime) with a stable prefix and a per-turn runtime-context message.
- Workspace bootstrap files (SOUL.md, USER.md, MEMORY.md, recent daily notes, AGENTS.md,
  IDENTITY.md) with OpenClaw's size limits.
- Tools: fs read/write/list/search, memory_append, memory_search, memory_get, skill_read,
  skill_save, web_fetch, web_search (Brave or DuckDuckGo), current_time, secrets, automations,
  intent, sessions_spawn.
- Session history with a character budget, compaction with a pre-compaction memory flush,
  hybrid memory search (keyword + OpenAI embeddings when available), nightly "dreaming" that
  promotes durable facts into MEMORY.md.
- Automations (at / every / cron schedules, main or isolated session, idle-only, owner delivery)
  including a one-click heartbeat ("Proactive check" every 30 minutes, silent on NO_REPLY).
- Standing intents (event-conditioned reminders) and single-level subagents.
- Telegram: pairing texts, envelope formatting, edited messages, media inbound (photos as
  vision input, voice notes transcribed with Whisper when an OpenAI key exists, documents,
  video) saved under inbox/, `MEDIA:` outbound attachments, unaddressed group history window,
  commands /help /new /reset /status /model /think /usage /compact /activation /whoami /stop,
  exec approvals with inline Allow/Deny buttons.
- Whole-run timeout, daily message quota, usage accounting.

**Workspace, skills, secrets**
- Per-bot cloud workspace on a persistent volume with a dashboard file browser and editor
  (today's note, new skill template, any file).
- Skills catalog from skills/*/SKILL.md injected as `<available_skills>`.
- Secrets vault: encrypted values injected as environment variables into sandbox and node
  shell commands; the model never sees values.

**MCP**
- Remote MCP servers over Streamable HTTP or SSE with connection test and tool discovery,
  per-bot server and tool selection, pooled sessions, 60 second call timeout.

**Nodes and sandbox**
- Node agent (`easylopster-node`): pairing code, saved token, outbound WebSocket, capabilities
  fs.read/write/list/search, exec (PowerShell on Windows, bash elsewhere), system.which,
  system.notify, device.info; paths jailed to a shared folder; reconnect with backoff.
- Docker image `ghcr.io/noneym/easylopster-node` for self-hosted nodes and a single-file bundle
  built by GitHub Actions.
- Dashboard node management: capabilities, approval policy, revoke, re-pair, per-bot linking.
- Cloud sandbox (per-bot Debian container built on the host, capability-dropped and resource
  limited) behind `SANDBOX_ENABLED=1` and a mounted Docker socket.

**Operations**
- pnpm monorepo (Next.js 16 web, Node gateway, Prisma 7 on MariaDB, Redis/BullMQ), Dockerfiles
  for web and gateway, diff-based migrations, `QUEUE_PREFIX` for sharing Redis between
  environments, GitHub Actions for releases and the node image.

[Unreleased]: https://github.com/noneym/easylopster.com/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/noneym/easylopster.com/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/noneym/easylopster.com/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/noneym/easylopster.com/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/noneym/easylopster.com/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/noneym/easylopster.com/releases/tag/v1.0.0
