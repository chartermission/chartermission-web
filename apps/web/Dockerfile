# Charter Mission web app (Next.js standalone). Build context: repository root.
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
RUN pnpm install --frozen-lockfile --filter "@chartermission/web..."
RUN pnpm --filter "@chartermission/web..." run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends curl tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
# Files in public/ (brand artwork) are not part of the standalone output and must be copied too.
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS -o /dev/null http://127.0.0.1:3000/ || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
