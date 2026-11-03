import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { trendingOverrides, users } from '../db/schema.js';
import { AuditService } from '../infra/audit.service.js';
import { QueueService } from '../infra/queue.service.js';
import { iso } from './util.js';

export const EXPIRY_JOB = 'expire-restrictions';
export const EXPIRY_EVERY_MS = 10 * 60_000;

export interface ExpiryDeps {
  db: Db;
  audit: AuditService;
  queue: QueueService;
}

export interface ExpiryResult {
  postingLifted: number;
  connectingLifted: number;
  suspensionsLifted: number;
  overridesExpired: number;
}

/**
 * Maintenance job (every 10 minutes): lifts time-boxed restrictions and suspensions
 * whose end has passed, and expires trending overrides past expires_at. Each change is
 * audited as a system action (actor null). Exported so tests can run it directly.
 */
export async function expireRestrictions(deps: ExpiryDeps, now = new Date()): Promise<ExpiryResult> {
  const { db, audit, queue } = deps;

  const posting = await db
    .update(users)
    .set({ restrictedPostingUntil: null })
    .where(and(isNotNull(users.restrictedPostingUntil), lte(users.restrictedPostingUntil, now)))
    .returning({ id: users.id });
  for (const u of posting) {
    await audit.record({
      actorId: null,
      action: 'moderation.restriction_expired',
      targetType: 'member',
      targetId: u.id,
      after: { restriction: 'posting' },
    });
  }

  const connecting = await db
    .update(users)
    .set({ restrictedConnectingUntil: null })
    .where(and(isNotNull(users.restrictedConnectingUntil), lte(users.restrictedConnectingUntil, now)))
    .returning({ id: users.id });
  for (const u of connecting) {
    await audit.record({
      actorId: null,
      action: 'moderation.restriction_expired',
      targetType: 'member',
      targetId: u.id,
      after: { restriction: 'connecting' },
    });
  }

  const suspensions = await db
    .update(users)
    .set({
      status: sql`case when ${users.emailVerifiedAt} is null then 'unverified' else 'active' end`,
      suspendedUntil: null,
    })
    .where(and(eq(users.status, 'suspended'), isNotNull(users.suspendedUntil), lte(users.suspendedUntil, now)))
    .returning({ id: users.id, status: users.status });
  for (const u of suspensions) {
    await audit.record({
      actorId: null,
      action: 'moderation.suspension_expired',
      targetType: 'member',
      targetId: u.id,
      before: { status: 'suspended' },
      after: { status: u.status },
    });
  }

  const overrides = await db
    .update(trendingOverrides)
    .set({ revokedAt: now, revokeReason: 'Expired' })
    .where(
      and(
        isNull(trendingOverrides.revokedAt),
        isNotNull(trendingOverrides.expiresAt),
        lte(trendingOverrides.expiresAt, now),
      ),
    )
    .returning();
  for (const o of overrides) {
    await audit.record({
      actorId: null,
      action: 'trending.override.expired',
      targetType: 'trending_override',
      targetId: o.id,
      after: {
        action: o.action,
        hashtagId: o.hashtagId,
        scope: o.scopeType,
        scopeId: o.scopeId,
        expiresAt: iso(o.expiresAt),
      },
    });
  }
  if (overrides.length > 0) await queue.add('trending', 'compute', {});

  return {
    postingLifted: posting.length,
    connectingLifted: connecting.length,
    suspensionsLifted: suspensions.length,
    overridesExpired: overrides.length,
  };
}

/** Registers the maintenance job and its schedule. */
@Injectable()
export class ExpiryService implements OnModuleInit {
  private readonly logger = new Logger('ModerationExpiry');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit() {
    this.queue.process('maintenance', async (name) => {
      if (name === EXPIRY_JOB) await this.run();
    });
    this.queue.every('maintenance', EXPIRY_JOB, EXPIRY_EVERY_MS).catch((err: unknown) => {
      this.logger.warn(`Could not schedule ${EXPIRY_JOB}: ${String(err)}`);
    });
  }

  run(now = new Date()) {
    return expireRestrictions({ db: this.db, audit: this.audit, queue: this.queue }, now);
  }
}
