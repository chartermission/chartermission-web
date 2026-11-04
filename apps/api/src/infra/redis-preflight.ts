import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/**
 * Development start-up check. Without Redis the queues wait forever and the API never starts listening,
 * so fail fast with a clear message instead.
 */
export async function checkRedis(): Promise<void> {
  const url = env().REDIS_URL;
  const target = (() => {
    try {
      const u = new URL(url);
      return `${u.hostname}:${u.port || '6379'}`;
    } catch {
      return url;
    }
  })();
  const client = new Redis(url, { lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  let lastError: Error | undefined;
  client.on('error', (error: Error) => {
    lastError = error;
  });
  try {
    await client.connect();
    const reply = await client.ping();
    if (reply !== 'PONG') throw new Error(`unexpected reply ${reply}`);
  } catch (error) {
    const cause = lastError ?? error;
    const message = (cause instanceof Error ? cause.message : String(cause)).replace(/\.+$/, '');
    const hint = /NOAUTH|WRONGPASS|auth/i.test(message)
      ? 'A different Redis that needs a password is answering on this port; see the README (port note)'
      : 'Start it with: docker compose up -d';
    console.error(`\n[Redis] Cannot use ${target}: ${message}. ${hint}\n`);
    process.exit(1);
  } finally {
    client.disconnect();
  }
}
