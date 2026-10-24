# Changelog

All notable changes to easylopster are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Cloudflare Email Service as the mail transport (`MAIL_MAILER=cloudflare`), with SMTP still available; styled verification email.

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

[Unreleased]: https://github.com/noneym/easylopster.com/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/noneym/easylopster.com/releases/tag/v1.0.0
