import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { createDb, createPool, type Db } from './client.js';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

/** Inject the Drizzle database: `constructor(@InjectDb() private readonly db: Db)`. */
export const InjectDb = () => Inject(DB);

@Global()
@Module({
  providers: [
    { provide: PG_POOL, useFactory: () => createPool() },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: pg.Pool) => createDb(pool) },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

export type { Db };
