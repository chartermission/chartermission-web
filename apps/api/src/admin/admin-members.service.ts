import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type {
  AdminAwardBadgeInput,
  AdminBadge,
  AdminBadgeInput,
  AdminBadgeUpdateInput,
  AdminMemberRow,
  AdminMembersQuery,
  BadgeTone,
  Ok,
  Page,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { badges, featuredMembers, memberBadges, memberProfiles, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { mediaUrl } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { Errors } from '../common/errors.js';
import { isUniqueViolation, likePrefix, uuidOr404 } from '../moderation/util.js';

type BadgeRow = typeof badges.$inferSelect;

const slugify = (v: string) =>
  v
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/** Admin console: the badge catalogue and per-member controls (verified tick, badges, featured suggestion). */
@Injectable()
export class AdminMembersService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------ Badge catalogue ------------------------------ */

  /** GET /admin/badges */
  async badges(): Promise<AdminBadge[]> {
    const holders = sql<number>`(select count(*)::int from ${memberBadges} mb where mb.badge_id = ${badges.id})`;
    const rows = await this.db
      .select({ badge: badges, holders })
      .from(badges)
      .orderBy(asc(badges.position), asc(badges.name));
    return rows.map(({ badge, holders }) => this.badgeView(badge, holders));
  }

  /** POST /admin/badges */
  async createBadge(ctx: AuthContext, input: AdminBadgeInput, ip?: string): Promise<AdminBadge> {
    const base = slugify(input.name) || 'badge';
    const [{ next } = { next: 0 }] = await this.db.select({ next: sql<number>`coalesce(max(${badges.position}) + 1, 0)::int` }).from(badges);
    for (let n = 1; n < 20; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;
      try {
        const [row] = await this.db
          .insert(badges)
          .values({ ...input, slug, position: next })
          .returning();
        await this.audit.record({ actorId: ctx.user.id, action: 'badge.created', targetType: 'badge', targetId: row!.id, after: input, ip });
        return this.badgeView(row!, 0);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw Errors.conflict('Choose a different badge name.');
  }

  /** PATCH /admin/badges/{id} */
  async updateBadge(ctx: AuthContext, rawId: string, input: AdminBadgeUpdateInput, ip?: string): Promise<AdminBadge> {
    const id = uuidOr404(rawId, 'That badge');
    const [before] = await this.db.select().from(badges).where(eq(badges.id, id)).limit(1);
    if (!before) throw Errors.notFound('That badge');
    const [row] = await this.db
      .update(badges)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(badges.id, id))
      .returning();
    await this.audit.record({ actorId: ctx.user.id, action: 'badge.updated', targetType: 'badge', targetId: id, before, after: input, ip });
    return (await this.badges()).find((b) => b.id === row!.id)!;
  }

  /** DELETE /admin/badges/{id}: also takes the badge off every member who holds it. */
  async removeBadge(ctx: AuthContext, rawId: string, ip?: string): Promise<Ok> {
    const id = uuidOr404(rawId, 'That badge');
    const [before] = await this.db.select().from(badges).where(eq(badges.id, id)).limit(1);
    if (!before) throw Errors.notFound('That badge');
    await this.db.delete(badges).where(eq(badges.id, id));
    await this.audit.record({ actorId: ctx.user.id, action: 'badge.removed', targetType: 'badge', targetId: id, before, ip });
    return { ok: true };
  }

  private badgeView(b: BadgeRow, holders: number): AdminBadge {
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      description: b.description,
      tone: b.tone as BadgeTone,
      icon: b.icon,
      status: b.status as AdminBadge['status'],
      position: b.position,
      holders,
    };
  }

  /* ---------------------------------- Members ---------------------------------- */

  /** GET /admin/members: search by name, handle or email. */
  async list(q: AdminMembersQuery): Promise<Page<AdminMemberRow>> {
    const offset = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString()) : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw Errors.badRequest('Invalid cursor');
    const conds: SQL[] = [ne(users.status, 'deleted')];
    if (q.q) {
      const term = `%${likePrefix(q.q.replace(/^@/, '')).slice(0, -1)}%`;
      conds.push(or(ilike(memberProfiles.displayName, term), ilike(memberProfiles.handle, term), ilike(users.email, term))!);
    }
    if (q.filter === 'verified') conds.push(isNotNull(users.verifiedAt));
    if (q.filter === 'unverified') conds.push(isNull(users.verifiedAt));
    if (q.filter === 'featured') conds.push(sql`exists (select 1 from ${featuredMembers} fm where fm.user_id = ${users.id})`);
    if (q.filter === 'badge') {
      if (!q.badge) throw Errors.validation({ badge: 'Choose a badge' });
      conds.push(
        sql`exists (select 1 from ${memberBadges} mb join ${badges} b on b.id = mb.badge_id where mb.user_id = ${users.id} and b.slug = ${q.badge})`,
      );
    }
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(and(...conds))
      .orderBy(desc(users.createdAt), asc(users.id))
      .limit(q.limit + 1)
      .offset(offset);
    const ids = rows.slice(0, q.limit).map((r) => r.id);
    return {
      items: await this.rows(ids),
      nextCursor: rows.length > q.limit ? Buffer.from(String(offset + q.limit)).toString('base64url') : null,
    };
  }

  async row(rawId: string): Promise<AdminMemberRow> {
    const id = uuidOr404(rawId, 'That member');
    const [row] = await this.rows([id]);
    if (!row) throw Errors.notFound('That member');
    return row;
  }

  /** PUT /admin/members/{id}/verified */
  async setVerified(ctx: AuthContext, rawId: string, verified: boolean, ip?: string): Promise<AdminMemberRow> {
    const before = await this.row(rawId);
    if (before.verified !== verified) {
      await this.db
        .update(users)
        .set({ verifiedAt: verified ? new Date() : null, updatedAt: new Date() })
        .where(eq(users.id, before.id));
      await this.audit.record({
        actorId: ctx.user.id,
        action: verified ? 'member.verified' : 'member.unverified',
        targetType: 'user',
        targetId: before.id,
        ip,
      });
    }
    return this.row(before.id);
  }

  /** PUT /admin/members/{id}/featured */
  async setFeatured(ctx: AuthContext, rawId: string, featured: boolean, ip?: string): Promise<AdminMemberRow> {
    const before = await this.row(rawId);
    if (before.featured !== featured) {
      if (featured) {
        await this.db.insert(featuredMembers).values({ userId: before.id, addedBy: ctx.user.id }).onConflictDoNothing();
      } else {
        await this.db.delete(featuredMembers).where(eq(featuredMembers.userId, before.id));
      }
      await this.audit.record({
        actorId: ctx.user.id,
        action: featured ? 'member.featured' : 'member.unfeatured',
        targetType: 'user',
        targetId: before.id,
        ip,
      });
    }
    return this.row(before.id);
  }

  /** POST /admin/members/{id}/badges */
  async award(ctx: AuthContext, rawId: string, input: AdminAwardBadgeInput, ip?: string): Promise<AdminMemberRow> {
    const member = await this.row(rawId);
    const [badge] = await this.db.select().from(badges).where(eq(badges.id, input.badgeId)).limit(1);
    if (!badge) throw Errors.notFound('That badge');
    if (badge.status !== 'active') throw Errors.validation({ badgeId: 'This badge is disabled. Turn it on before awarding it.' });
    const inserted = await this.db
      .insert(memberBadges)
      .values({ userId: member.id, badgeId: badge.id, awardedBy: ctx.user.id, note: input.note || null })
      .onConflictDoNothing()
      .returning({ id: memberBadges.id });
    if (inserted.length) {
      await this.audit.record({
        actorId: ctx.user.id,
        action: 'member.badge_awarded',
        targetType: 'user',
        targetId: member.id,
        after: { badge: badge.slug, note: input.note ?? null },
        ip,
      });
    }
    return this.row(member.id);
  }

  /** DELETE /admin/members/{id}/badges/{badgeId} */
  async revoke(ctx: AuthContext, rawId: string, rawBadgeId: string, ip?: string): Promise<AdminMemberRow> {
    const member = await this.row(rawId);
    const badgeId = uuidOr404(rawBadgeId, 'That badge');
    const removed = await this.db
      .delete(memberBadges)
      .where(and(eq(memberBadges.userId, member.id), eq(memberBadges.badgeId, badgeId)))
      .returning({ id: memberBadges.id });
    if (removed.length) {
      await this.audit.record({ actorId: ctx.user.id, action: 'member.badge_revoked', targetType: 'user', targetId: member.id, before: { badgeId }, ip });
    }
    return this.row(member.id);
  }

  /** Rows in the order of `ids`. Disabled badges are listed too, so admins can still revoke them. */
  private async rows(ids: string[]): Promise<AdminMemberRow[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        verifiedAt: users.verifiedAt,
        isStaff: users.isStaff,
        createdAt: users.createdAt,
        handle: memberProfiles.handle,
        name: memberProfiles.displayName,
        headline: memberProfiles.headline,
        avatarFileId: memberProfiles.avatarFileId,
        countryCode: memberProfiles.countryCode,
        featured: sql<boolean>`exists (select 1 from ${featuredMembers} fm where fm.user_id = ${users.id})`,
      })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(inArray(users.id, ids));
    const awarded = await this.db
      .select({ userId: memberBadges.userId, badge: badges })
      .from(memberBadges)
      .innerJoin(badges, eq(badges.id, memberBadges.badgeId))
      .where(inArray(memberBadges.userId, ids))
      .orderBy(asc(badges.position), asc(badges.name));
    const byUser = new Map<string, AdminMemberRow['badges']>();
    for (const { userId, badge: b } of awarded) {
      const list = byUser.get(userId) ?? [];
      list.push({ id: b.id, slug: b.slug, name: b.name, description: b.description, tone: b.tone as BadgeTone, icon: b.icon });
      byUser.set(userId, list);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({
        id: r.id,
        handle: r.handle,
        name: r.name,
        email: r.email,
        headline: r.headline,
        avatarUrl: mediaUrl(r.avatarFileId),
        countryCode: r.countryCode,
        status: r.status,
        verified: !!r.verifiedAt,
        staff: r.isStaff,
        featured: r.featured,
        badges: byUser.get(r.id) ?? [],
        joinedAt: r.createdAt.toISOString(),
      }));
  }
}
