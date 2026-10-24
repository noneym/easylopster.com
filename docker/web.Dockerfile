# Build context: repo root.  docker build -f docker/web.Dockerfile .
FROM node:22-bookworm-slim AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm i -g pnpm@10
WORKDIR /app

# ---------- build ----------
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# Workspace packages are linked into each app's own node_modules, so install after the full copy.
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @easylopster/db generate \
 && pnpm --filter @easylopster/web build

# ---------- runtime ----------
FROM node:22-bookworm-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
# Next standalone output (traced from the monorepo root)
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
# Prisma CLI + migrations for `migrate deploy` at boot
COPY --from=build /app/packages/db/prisma ./packages/db/prisma
COPY --from=build /app/packages/db/prisma.config.ts ./packages/db/prisma.config.ts
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/dotenv ./node_modules/dotenv
COPY docker/web-entrypoint.sh ./web-entrypoint.sh
RUN chmod +x web-entrypoint.sh && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./web-entrypoint.sh"]
