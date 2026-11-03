import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { desc, eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { runMigrations } from '../src/db/migrate.js';
import { DB, type Db } from '../src/db/db.module.js';
import { resetDatabase, seedReference } from '../src/db/seed.js';
import * as s from '../src/db/schema.js';

export const ORIGIN = 'http://localhost:3000';
export const PASSWORD = 'correct-horse-battery-staple';

export interface TestApp {
  app: INestApplication;
  db: Db;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

let migrated = false;

/**
 * Boots the full API against the test database (migrated and emptied, reference data seeded).
 * Queues run inline, so notifications and emails exist as soon as a request returns.
 */
export async function createTestApp(): Promise<TestApp> {
  if (!migrated) {
    await runMigrations(process.env.DATABASE_URL);
    migrated = true;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();
  const db = app.get<Db>(DB);
  await resetDatabase(db);
  await seedReference(db);
  const redis = new Redis(process.env.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();
  return { app, db, http: () => request(app.getHttpServer()), close: () => app.close() };
}

/** A supertest agent that keeps cookies and sends the CSRF header and Origin on writes. */
export function client(t: TestApp, audience: 'member' | 'admin' = 'member') {
  const agent = request.agent(t.app.getHttpServer());
  const headers = (r: request.Test) => {
    r.set('Origin', audience === 'admin' ? 'http://localhost:3001' : ORIGIN).set('X-CM-CSRF', '1');
    if (audience === 'admin') r.set('X-CM-Audience', 'admin');
    return r;
  };
  return {
    agent,
    get: (url: string) => (audience === 'admin' ? agent.get(`/api/v1${url}`).set('X-CM-Audience', 'admin') : agent.get(`/api/v1${url}`)),
    post: (url: string, body?: object) => headers(agent.post(`/api/v1${url}`)).send(body ?? {}),
    put: (url: string, body?: object) => headers(agent.put(`/api/v1${url}`)).send(body ?? {}),
    patch: (url: string, body?: object) => headers(agent.patch(`/api/v1${url}`)).send(body ?? {}),
    delete: (url: string, body?: object) => headers(agent.delete(`/api/v1${url}`)).send(body ?? {}),
  };
}

/** The newest email sent to an address (from the outbox), for verification and reset links. */
export async function lastEmail(db: Db, to: string) {
  const [row] = await db
    .select()
    .from(s.emailOutbox)
    .where(eq(s.emailOutbox.toAddress, to.toLowerCase()))
    .orderBy(desc(s.emailOutbox.createdAt))
    .limit(1);
  return row;
}

export function tokenFrom(text: string | null | undefined): string {
  const m = text?.match(/token=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error(`No token link in email: ${text}`);
  return m[1]!;
}

export async function count(db: Db, table: Parameters<Db['select']>[0] extends never ? never : any, where?: any) {
  const q = db.select({ n: sql<number>`count(*)::int` }).from(table);
  const [row] = where ? await q.where(where) : await q;
  return row!.n;
}

export { s };
