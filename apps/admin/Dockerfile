# Charter Mission admin app (Next.js standalone). Build context: repository root.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Rewrites in next.config.ts are fixed at build time, so the API address must be known here.
ARG API_INTERNAL_URL
ARG NEXT_PUBLIC_WEB_URL
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL
COPY . .
RUN pnpm install --frozen-lockfile --filter "@chartermission/admin..."
RUN pnpm --filter "@chartermission/admin..." run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/admin/.next/static ./apps/admin/.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS -o /dev/null http://127.0.0.1:3001/ || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/admin/server.js"]
