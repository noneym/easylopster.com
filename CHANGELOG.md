# Changelog

All notable changes to easylopster are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.10.0] - 2026-10-31

### Added
- Storage: connect your own S3-compatible bucket (Amazon S3, Cloudflare R2, MinIO, Backblaze B2 or
  any S3 endpoint) on the new Storage page; the connection is tested for read and write and the
  keys are stored encrypted. The page is a file browser over the bucket (folders, upload up to
  200 MB per file through the server, download links, delete, new folder) with usage figures.
- Agents get a shared drive: `storage_list`, `storage_read`, `storage_write`, `storage_delete`,
  `storage_copy` (workspace ⇄ storage, binary files included) and `storage_link` (24-hour download
  link) work on the owner's bucket and are shared by all of the owner's agents.
- Backups: per agent, a schedule (daily at a time, weekly, or every N hours, in the owner's time
  zone), retention (delete after N days, always keep the newest N), optional conversations and
  inbox. Archives are zips with `workspace/`, `settings.json` (model, policies, automations,
  allowlist, linked servers and nodes; never secret values) and `manifest.json`, written to
  `backups/<agent>/` in the bucket. The Backups page lists them with download, restore (files, or
  files + settings and automations) and delete, plus "Back up now". The gateway runs due backups
  once a minute (`BACKUPS_ENABLED=0` turns the scheduler off).

### Changed
- "Bots" are now "Agents" across the dashboard (menu, pages, copy) and live under
  `/dashboard/agents`; old `/dashboard/bots` links redirect. The database model keeps its name.

## [1.9.1] - 2026-10-31

### Added
- Import from OpenClaw: "Import API keys (agent tokens)" and "Import Telegram token" checkboxes;
  unchecked values never leave the machine. When the import ends without a usable key or without
  Telegram, a "Finish setup" panel on the same page asks for the API key + model (OpenClaw's model
  preselected when the key has it) and the Telegram token. A missing key no longer aborts the import.
- Bots → Manage → Telegram: connect a web-only bot to Telegram, switch an existing bot to another
  BotFather token (webhook and command menu re-registered, the old webhook dropped), or disconnect
  Telegram and keep the bot in the web chat.
- The uploader parses real openclaw.json files (JSON5: comments, trailing commas, unquoted keys).

### Fixed
- A session cookie whose session was deleted looped between /login and /dashboard.

## [1.9.0] - 2026-10-31

### Added
- Import from OpenClaw with one command: New bot → "Import from OpenClaw" (or a bot's Import page →
  "Run a command on the OpenClaw machine") gives a one-hour, single-use command
  (`curl -fsSL https://easylopster.com/import.sh | bash -s -- TOKEN`, PowerShell variant for
  Windows). On the OpenClaw machine it reads openclaw.json (bot name, Telegram token, model, API
  keys from the config, env vars or legacy auth profiles) and the workspace, creates the bot here
  with its keys, and uploads persona, memory, heartbeat, skills and scripts in batches. The page
  follows it live: step bar (command ready → connected from <host> → uploading → done), per-category
  bars, every file with written/skipped state, what was created (bot, @username, model, keys) and
  notes on anything that needs a manual step. Served scripts: /import.sh, /import.ps1, /import.mjs.
- Web-only bots: the Telegram token is optional when creating a bot; without one the bot lives in
  the web chat and a token can be added later. The new-bot form explains how to get a token from
  @BotFather step by step.
- "Refresh model list" wherever a key is used: the new-key form asks the provider for its models as
  soon as a key is pasted (and on demand), the key page and bot settings reload the list from the
  provider with one click.
- Nodes pages explain what a node is and how to install the agent: direct download of the current
  Windows tray installer, the npx one-liner and the Docker command, on the nodes list, the new-node
  page and a node's page.
- Dashboard forms give visible feedback everywhere: spinner while saving, a "Saved" tick, a toast
  for success and errors, and a scroll to the first field error.
- Telegram voice notes are transcribed with the platform's `OPENAI_API_KEY` when the account has no
  OpenAI key of its own (`OPENAI_TRANSCRIBE_MODEL` picks the model).
- Landing page lists the browser, live status, background jobs, import and self-update features.

### Fixed
- Settings page hydration mismatch from time-zone offsets rendered on the server.

## [1.8.0] - 2026-10-29

### Added
- Live activity status in every chat: while a reply is being worked on, Telegram shows one status
  message (edited in place, deleted when the answer arrives) listing the tool calls of the run with
  a short argument summary (URL, command, path), finished steps with their duration, the running step
  with a ticking elapsed time and a thinking/writing line. It is shown in all streaming modes, not
  only "progress", so a long browser or exec step is never silent. The web chat shows the same step
  list with elapsed times.

### Changed
- Tool progress events carry the tool-call id, an argument preview, duration and success flag
  (failed tool calls are marked ⚠️).

## [1.7.0] - 2026-10-29

### Added
- Windows tray app auto-update: the packaged app checks GitHub releases 30s after start and every
  6 hours, downloads the new installer in the background and installs it on the next restart
  (tray menu "Restart to update", "Check for updates"; the Settings window shows the state). The
  release workflow now publishes latest.yml and the blockmap next to the installer.
- Automatic Brave installation: when browser control is enabled (or a bot first uses a browser
  tool) and brave.exe is missing, the tray app installs Brave by itself, with winget when present
  and otherwise with Brave's installer run silently. A browser tool called meanwhile returns
  "installing, try again in a minute"; the Settings window has an "Install Brave" button too.

## [1.6.0] - 2026-10-26

### Added
- Browser network capture (`browser.network`): every tab records the requests the page makes
  (method, URL, type, status, size, timing); the tool lists them with URL/type filters, returns one
  response body by id (JSON APIs, HTML fragments, up to 200k chars) or clears the log. Reading a
  page's own API calls is usually easier than scraping its DOM.
- Multiple Brave profiles (`browser.profiles`): list / create / close / delete named profiles, each
  with its own cookies and logins; every browser tool takes `profile=<name>` (default = the existing
  profile). Deleting a profile needs approval.
- Drag and drop (`browser_drag` on `browser.interact`): mouse drag from one element to another or
  to coordinates; HTML5 drags are intercepted and completed with dragEnter/dragOver/drop so sortable
  lists, kanban boards and drop zones work.
- Clipboard (`system.clipboard`, tray app): read the PC clipboard text (needs approval) or write to it.
- Background jobs survive node restarts: the job list is kept in `jobs/index.json`; after a restart
  a still-running process is picked up again and a finished one is reported with an unknown exit code.

## [1.5.1] - 2026-10-26

### Added
- Background jobs on nodes: `exec` with `background=true` starts a detached process that survives
  the command timeout, writes its output to `jobs/<id>.log` in the shared folder and returns a job
  id; the new `jobs` tool (capability `exec.jobs`) lists, checks, tails and kills them. The exec
  description now tells the model to use it for downloads, installs and builds.
- Browser cookies: `browser.cookies` lists the current site's cookies (no values unless asked),
  exports a Netscape cookies.txt into the shared folder (cookies/<host>.txt, ready for yt-dlp or
  curl), imports one, or clears cookies; export/import/clear need approval.
- Browser file upload (`browser.upload`: attach files from the shared folder to a file input) and
  downloads (`browser.downloads`: the controlled Brave now saves downloads into the shared folder's
  downloads/ and the tool lists them). JavaScript dialogs (alert/confirm/prompt) are auto-accepted
  and logged instead of blocking the page.
- The controlled Brave profile keeps its logins between sessions: the tray app now closes Brave
  gracefully (Browser.close, then waits for it to exit) so cookies and site data are flushed to the
  persistent profile instead of being lost on a hard kill, and the "restore pages" bubble is hidden.

### Fixed
- Background jobs on Windows: Windows PowerShell does not run as a detached (console-less) process,
  so the job produced no output; jobs are now started as hidden children instead.

## [1.5.0] - 2026-10-26

### Added
- Full browser control on Windows nodes: `browser.eval` (run JavaScript in the page, awaited
  result as JSON), `browser.interact` (press keys with modifiers, scroll, hover, choose <select>
  options, back/forward/reload, wait for an element or text), `browser.html` (raw markup of the
  page or an element) and `browser.pdf` (print to PDF into the workspace inbox). Eval, key presses,
  selects and history navigation go through the chat approval (or "Always allow"); scroll, hover,
  wait, HTML and PDF are free. Enable the new capabilities on the node page after updating the tray app.
- Tray app development runs (`electron .`) use their own data folder and single-instance lock, so
  they can run next to the installed app; the default browser tab skips stray about:blank tabs.

## [1.4.0] - 2026-10-26

### Added
- Admin panel (/dashboard/admin, "Admin" in the sidebar for role=admin accounts): user list with
  search (email, name, created, verified, role, bots/nodes/MCP counts, today's messages, effective
  limits) and a per-user page. Accounts listed in `ADMIN_EMAILS` become admins when they sign in.
  Per-user quota overrides (User.limitBots/limitNodes/limitMcp/limitMessagesPerDay, null = global
  BETA_MAX_* default) are edited there and honored by the dashboard, the chat setup tools and the
  gateway's daily message quota (`limitsFor(user)` in @easylopster/shared/limits). "Sign in as this
  user" opens the member's dashboard with a persistent "Viewing as <email> — Back to admin" banner;
  the admin's own session is parked in the `el_admin_session` cookie and restored on return (logged
  on the server). Every registration (email or Google) emails `ADMIN_NOTIFY_EMAIL` with the new
  user's details and a link to their admin page; mail failures never block sign-up.
- Context-window awareness: the key test stores each model's context size when the provider lists
  it (OpenAI-compatible endpoints, OpenRouter, Google); other models come from a built-in table
  (default 128k). History and compaction budgets now scale with the window (about 55% of it for
  history, compaction at ~70% of that), a context-length error triggers an automatic compaction
  and one retry, and a gauge shows usage: web chat footer ("context 42% · 108k / 256k", with a
  nudge past 80%), Telegram /status, and the model picker lists sizes next to ids.
- MCP OAuth: remote servers that only sign in with OAuth (Notion, Evernote, Linear, Sentry and any
  server answering 401 with resource metadata) can now be added from the dashboard. The flow follows
  the MCP authorization spec (OAuth 2.1 + PKCE, dynamic client registration via the MCP SDK):
  "Sign in with <vendor>" registers a client, sends you to the vendor's consent page and the
  callback (/api/mcp/oauth/callback) exchanges the code, lists the tools and marks the server
  connected. Tokens, the client registration and discovery data live encrypted in McpServer.encOAuth;
  the gateway sends the bearer token, refreshes it with the refresh token before expiry or on 401
  and persists the new tokens. When a refresh fails the server shows "Sign in again" with a
  re-authorize button. The generic add form detects a 401 on "Test connection" and offers the
  sign-in; static-header servers work as before. Catalog: Notion and Evernote are usable, Linear
  (mcp.linear.app) and Sentry (mcp.sentry.dev) added.

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

### Fixed
- A development gateway sharing the production database ran everyone's automations and dreaming
  on the developer's machine (wrong workspace, no nodes) and messaged the owners; `GATEWAY_ACCOUNT_EMAILS`
  now scopes polling, the automation scheduler and dreaming to the listed accounts.
- Automation replies that are just a status marker (NO_NEW_POST, NOTHING_NEW, ... on one line) are
  logged as silent instead of being sent to the owner; the wake message now spells out the NO_REPLY rule.
- A reply ending in a NO_REPLY line is delivered without that line; a reply that is only NO_REPLY
  (with or without punctuation) stays silent.

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

[Unreleased]: https://github.com/noneym/easylopster.com/compare/v1.10.0...HEAD
[1.10.0]: https://github.com/noneym/easylopster.com/compare/v1.9.1...v1.10.0
[1.9.1]: https://github.com/noneym/easylopster.com/compare/v1.9.0...v1.9.1
[1.9.0]: https://github.com/noneym/easylopster.com/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/noneym/easylopster.com/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/noneym/easylopster.com/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/noneym/easylopster.com/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/noneym/easylopster.com/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/noneym/easylopster.com/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/noneym/easylopster.com/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/noneym/easylopster.com/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/noneym/easylopster.com/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/noneym/easylopster.com/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/noneym/easylopster.com/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/noneym/easylopster.com/releases/tag/v1.0.0
