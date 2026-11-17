# Charter Mission MCP server (Claude connector). Build context: repository root.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
# Only this app and what it depends on (@chartermission/contracts), then a self-contained production copy.
RUN pnpm install --frozen-lockfile --filter "@chartermission/mcp..."
RUN pnpm --filter "@chartermission/mcp..." run build
RUN pnpm --filter @chartermission/mcp deploy --prod --legacy /out \
 && rm -rf /out/dist \
 && cp -r apps/mcp/dist /out/dist

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4100
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4100
# Node's own fetch, so the image needs no curl.
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# main.ts handles SIGTERM itself (finishes in-flight requests, then exits).
CMD ["node", "dist/main.js"]
