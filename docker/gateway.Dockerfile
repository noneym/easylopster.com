# Build context: repo root.  docker build -f docker/gateway.Dockerfile .
FROM node:22-bookworm-slim AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm i -g pnpm@10
WORKDIR /app

# ---------- build (bundles gateway + workspace packages into dist/) ----------
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @easylopster/db generate \
 && pnpm --filter @easylopster/gateway build

# ---------- production deps only ----------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/gateway/package.json apps/gateway/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/node-agent/package.json packages/node-agent/
RUN pnpm install --frozen-lockfile --prod --filter @easylopster/gateway...

# ---------- runtime ----------
FROM node:22-bookworm-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production GATEWAY_PORT=4000 WORKSPACE_ROOT=/data/workspaces
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/gateway/dist ./dist
RUN mkdir -p /data/workspaces && chown -R node:node /app /data
USER node
EXPOSE 4000
VOLUME ["/data/workspaces"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.GATEWAY_PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.mjs"]
