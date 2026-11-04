import { Logger } from '@nestjs/common';
import type pg from 'pg';
import { env } from '../config/env.js';

/** Development start-up check: says plainly when the database is unreachable, empty or not migrated. */
export async function checkDatabase(pool: pg.Pool): Promise<void> {
  const logger = new Logger('Database');
  const target = (() => {
    try {
      const url = new URL(env().DATABASE_URL);
      return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
    } catch {
      return 'the configured database';
    }
  })();
  try {
    const { rows } = await pool.query<{ countries: string | null; drafts: string | null }>(
      "select to_regclass('public.countries') as countries, to_regclass('public.post_drafts') as drafts",
    );
    const row = rows[0];
    if (!row?.countries) {
      logger.error(`Connected to ${target}, but it has no Charter Mission tables. Run: pnpm --filter @chartermission/api db:reset`);
    } else if (!row.drafts) {
      logger.error(`Connected to ${target}, but migrations are behind. Run: pnpm --filter @chartermission/api db:migrate`);
    } else {
      logger.log(`Connected to ${target}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Cannot use ${target}: ${message}. Start it with: docker compose up -d`);
  }
}
