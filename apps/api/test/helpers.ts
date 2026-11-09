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
import { SettingsService } from '../src/infra/settings.service.js';

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
  app.get(SettingsService).clearCache();
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

let seq = 0;

/**
 * Creates a member directly in the database and returns a signed-in client.
 * Use this to set up actors without going through the registration flow.
 *   const amara = await createMember(t, { name: 'Amara Okafor' });
 *   const mod = await createMember(t, { roles: ['moderator'], admin: true }); // admin-audience, MFA verified
 */
export async function createMember(
  t: TestApp,
  opts: {
    name?: string;
    handle?: string;
    email?: string;
    verified?: boolean;
    roles?: string[];
    /** Sign in to the admin console (admin-audience session with MFA enabled and verified). */
    admin?: boolean;
    /**
     * Two-step verification on and verified for this session. Defaults to on for admin sessions and for
     * staff roles (they must use it everywhere); pass false to test the setup flow.
     */
    mfa?: boolean;
    countryCode?: string;
    status?: 'unverified' | 'active' | 'suspended' | 'deactivated';
  } = {},
) {
  const { hash } = await import('@node-rs/argon2');
  const { SessionService, COOKIE_NAMES } = await import('../src/core/session.service.js');
  const { encrypt } = await import('../src/common/crypto.js');
  seq += 1;
  const name = opts.name ?? `Test Member ${seq}`;
  const handle = opts.handle ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${seq}`;
  const email = opts.email ?? `${handle}@example.test`;
  const verified = opts.verified ?? true;
  const { ADMIN_SIGNIN_ROLES } = await import('../src/core/permissions.js');
  const mfa = opts.mfa ?? (!!opts.admin || (opts.roles ?? []).some((r) => ADMIN_SIGNIN_ROLES.includes(r)));
  const [user] = await t.db
    .insert(s.users)
    .values({
      email,
      passwordHash: await hash(PASSWORD),
      status: opts.status ?? (verified ? 'active' : 'unverified'),
      emailVerifiedAt: verified ? new Date() : null,
      mfaSecretEnc: mfa ? encrypt('JBSWY3DPEHPK3PXP') : null,
      mfaEnabledAt: mfa ? new Date() : null,
    })
    .returning();
  await t.db.insert(s.memberProfiles).values({
    userId: user!.id,
    handle,
    displayName: name,
    countryCode: opts.countryCode ?? 'NG',
    onboardingStep: 4,
    onboardingCompletedAt: new Date(),
  });
  for (const key of opts.roles ?? []) {
    const [role] = await t.db.select().from(s.roles).where(eq(s.roles.key, key));
    if (!role) throw new Error(`Unknown role ${key}`);
    await t.db.insert(s.userRoles).values({ userId: user!.id, roleId: role.id });
  }
  const audience = opts.admin ? 'admin' : 'member';
  const sessions = t.app.get(SessionService);
  const fakeReq = { ip: '127.0.0.1', headers: { 'user-agent': 'vitest' } } as any;
  const { token } = await sessions.create(user!.id, audience, fakeReq, { mfaVerified: mfa });
  const c = client(t, audience);
  c.agent.jar.setCookie(`${COOKIE_NAMES[audience]}=${token}; Path=/`, '127.0.0.1');
  return { ...c, user: user!, id: user!.id, handle, email, name };
}
