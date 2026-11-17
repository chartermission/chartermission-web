import { createApp } from './app.js';
import { loadConfig } from './env.js';

const config = loadConfig();
const server = createApp(config).listen(config.PORT, () => {
  console.log(`[mcp] Charter Mission MCP server on :${config.PORT} (public ${config.PUBLIC_URL}, API ${config.API_INTERNAL_URL})`);
});

// Coolify stops containers with SIGTERM: finish in-flight requests, then exit.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
