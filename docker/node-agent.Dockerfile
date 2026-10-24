# Self-hosted node: connects a container (with its own persistent /data folder) to an easylopster account.
#   docker run -d -e EASYLOPSTER_PAIRING_CODE=XXXX-XXXX -v easylopster-node:/data ghcr.io/noneym/easylopster-node
# Build context: repo root.
FROM node:22-bookworm-slim AS build
RUN npm i -g pnpm@10
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter easylopster-node build

FROM node:22-bookworm-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends bash ca-certificates curl git jq ripgrep python3 procps && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/packages/node-agent/dist ./dist
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY --from=build /app/node_modules/zod ./node_modules/zod
RUN mkdir -p /data/workspace
VOLUME ["/data"]
ENV EASYLOPSTER_CONFIG=/data/node.json EASYLOPSTER_WORKSPACE=/data/workspace
CMD ["node", "dist/index.mjs", "run"]
