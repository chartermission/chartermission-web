import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDb, createPool } from './client.js';
import { isMain } from './is-main.js';

/** Apply pending migrations. Used by `pnpm db:migrate`, tests and the Railway release step. */
export async function runMigrations(url?: string) {
  const pool = createPool(url);
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const folder = path.resolve(here, '../../drizzle');
    await migrate(createDb(pool), { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}

if (isMain(import.meta.url)) {
  await runMigrations();
  console.log('Migrations applied');
}
