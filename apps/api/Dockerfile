# Charter Mission API (NestJS). Build context: repository root.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter "@chartermission/api..."
RUN pnpm --filter "@chartermission/api..." run build
RUN pnpm --filter @chartermission/api deploy --prod --legacy /out \
 && rm -rf /out/dist /out/drizzle \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/drizzle /out/drizzle

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=4000 FFMPEG_PATH=/usr/bin/ffmpeg FFPROBE_PATH=/usr/bin/ffprobe STORAGE_LOCAL_DIR=/app/.uploads
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /app/.uploads && chown node:node /app/.uploads
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD curl -fsS http://127.0.0.1:4000/api/v1/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
# Apply pending migrations and reference data (roles, permissions, taxonomies), then start. Single instance, so no race.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/bootstrap.js && exec node dist/main.js"]
