# easylopster.com

Hosted, zero-install AI assistant platform inspired by [OpenClaw](https://github.com/openclaw/openclaw):
sign up on the web, add an LLM API key, paste a Telegram bot token, and you have a working assistant.
Add MCP servers and connect your own machine as a *node* when you need local files or a shell.

See [PLAN.md](PLAN.md) for architecture, data model and phases.

## Layout

```
apps/web            Next.js 16 (SSR landing, auth, dashboard, Telegram webhook receiver, web chat)
apps/gateway        Node worker: agent loop (AI SDK), Telegram sender, MCP clients, node WebSocket server
packages/db         Prisma 7 schema + client (MariaDB via @prisma/adapter-mariadb)
packages/shared     zod schemas, crypto, provider registry, node protocol
packages/node-agent CLI / Docker image that connects a machine to your account
docker/             web.Dockerfile, gateway.Dockerfile
docs/openclaw-notes Behaviour notes distilled from the OpenClaw source
```

## Development

```bash
pnpm install
cp .env.example .env        # fill DATABASE_URL, REDIS_URL, ENCRYPTION_KEY, INTERNAL_SECRET
pnpm db:generate
pnpm --filter @easylopster/db deploy
pnpm dev                     # web :3000 + gateway :GATEWAY_PORT
```

Schema changes: edit `packages/db/prisma/schema.prisma`, then

```bash
pnpm --filter @easylopster/db migrate:new <name>   # diffs the live DB against the schema (no shadow DB needed)
pnpm --filter @easylopster/db deploy
```

## Deploy (dockxo)

Two services built from this repo: `docker/web.Dockerfile` (port 3000, domain easylopster.com) and
`docker/gateway.Dockerfile` (port 4000, WebSocket for nodes, volume at `/data/workspaces`).
Both read the same `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY`, `INTERNAL_SECRET`.
Redis must run with `maxmemory-policy noeviction` (BullMQ requirement).
