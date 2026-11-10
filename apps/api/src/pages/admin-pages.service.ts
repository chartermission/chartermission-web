import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type {
  AdminPageCreateInput,
  AdminPageRow,
  AdminPagesQuery,
  AdminPageStatusInput,
  AdminPageUpdateInput,
  AdminQueueCounts,
  Ok,
  Page,
  PageCategory,
  PagesSettings,
  PageStatus,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { follows, memberProfiles, pageAdmins, pages, posts, users, verificationRequests } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { likePrefix, tsKey, uuidOr404 } from '../moderation/util.js';
import { PagesService, type PageRow } from './pages.service.js';

const NEXT_STATUS: Record<AdminPageStatusInput['action'], { from: PageStatus[]; to: PageStatus }> = {
  approve: { from: ['pending', 'rejected'], to: 'active' },
  reject: { from: ['pending'], to: 'rejected' },
  suspend: { from: ['active'], to: 'suspended' },
  restore: { from: ['suspended'], to: 'active' },
};

/** Admin console → Pages: create pages, review the ones members create, verify, suspend and remove. */
@Injectable()
export class AdminPagesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly pages: PagesService,
    private readonly members: MembersService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /** GET /admin/pages: pages waiting for review first, then newest. */
  async list(q: AdminPagesQuery): Promise<Page<AdminPageRow>> {
    const cursor = decodeCursor<{ o: number; t: string; id: string }>(q.cursor);
    const conds: (SQL | undefined)[] = [];
    if (q.status !== 'all') conds.push(eq(pages.status, q.status));
    if (q.q) conds.push(or(ilike(pages.name, `%${likePrefix(q.q)}`), ilike(pages.slug, likePrefix(q.q))));
    const order = sql<number>`(case when ${pages.status} = 'pending' then 0 else 1 end)`;
    if (cursor) {
      conds.push(
        sql`(${order} > ${Number(cursor.o)}::int or (${order} = ${Number(cursor.o)}::int and (${pages.createdAt}, ${pages.id}) < (${String(cursor.t)}::timestamptz, ${String(cursor.id)}::uuid)))`,
      );
    }
    const rows = await this.db
      .select({ page: pages, o: order, t: tsKey(pages.createdAt) })
      .from(pages)
      .where(and(...conds))
      .orderBy(order, desc(pages.createdAt), desc(pages.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ o: last.o, t: last.t, id: last.page.id }));
    return { items: await this.rows(page.items.map((r) => r.page)), nextCursor: page.nextCursor };
  }

  private async rows(list: PageRow[]): Promise<AdminPageRow[]> {
    if (!list.length) return [];
    const ids = list.map((p) => p.id);
    const [adminRows, followerRows, postRows] = await Promise.all([
      this.db.select({ pageId: pageAdmins.pageId, userId: pageAdmins.userId, role: pageAdmins.role }).from(pageAdmins).where(inArray(pageAdmins.pageId, ids)),
      this.db
        .select({ pageId: follows.targetId, n: sql<number>`count(*)::int` })
        .from(follows)
        .where(and(eq(follows.targetType, 'page'), inArray(follows.targetId, ids)))
        .groupBy(follows.targetId),
      this.db
        .select({ pageId: posts.pageId, n: sql<number>`count(*)::int` })
        .from(posts)
        .where(and(inArray(posts.pageId, ids), sql`${posts.deletedAt} is null`))
        .groupBy(posts.pageId),
    ]);
    const ownerIds = adminRows.filter((a) => a.role === 'owner').map((a) => a.userId);
    const [refs, emails] = await Promise.all([
      this.members.refs(ownerIds),
      ownerIds.length ? this.db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ownerIds)) : [],
    ]);
    const emailOf = new Map(emails.map((e) => [e.id, e.email]));
    const followers = new Map(followerRows.map((r) => [r.pageId, r.n]));
    const postCount = new Map(postRows.map((r) => [r.pageId, r.n]));
    return list.map((p) => {
      const ownerId = adminRows.find((a) => a.pageId === p.id && a.role === 'owner')?.userId;
      const owner = ownerId ? refs.get(ownerId) : undefined;
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        tagline: p.tagline,
        about: p.about,
        category: p.category as PageCategory,
        website: p.website,
        countryCode: p.countryCode,
        city: p.city,
        logoUrl: mediaUrl(p.logoFileId),
        coverUrl: mediaUrl(p.coverFileId),
        status: p.status as PageStatus,
        reviewNote: p.reviewNote,
        verified: !!p.verifiedAt,
        official: p.official,
        owner: owner ? { ...owner, email: emailOf.get(ownerId!) ?? '' } : null,
        admins: adminRows.filter((a) => a.pageId === p.id).length,
        followers: followers.get(p.id) ?? 0,
        posts: postCount.get(p.id) ?? 0,
        createdAt: p.createdAt.toISOString(),
      };
    });
  }

  private async row(id: string): Promise<AdminPageRow> {
    const page = await this.pages.findRow(id);
    if (!page) throw Errors.notFound('That page');
    return (await this.rows([page]))[0]!;
  }

  /** A member by handle or email, for the page owner field. */
  private async ownerId(value: string): Promise<string> {
    const clean = value.trim().replace(/^@/, '').toLowerCase();
    const [found] = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(and(or(sql`lower(${users.email}) = ${clean}`, sql`lower(${memberProfiles.handle}) = ${clean}`), inArray(users.status, ['active', 'unverified'])))
      .limit(1);
    if (!found) throw Errors.validation({ owner: 'No active member has that handle or email' });
    return found.id;
  }

  /** POST /admin/pages: live straight away; owned by the named member, or by the admin creating it. */
  async create(ctx: AuthContext, input: AdminPageCreateInput, ip?: string): Promise<AdminPageRow> {
    const { owner, official, verified, ...page } = input;
    const ownerId = owner ? await this.ownerId(owner) : ctx.user.id;
    const row = await this.pages.insert(page, { status: 'active', createdBy: ctx.user.id, ownerId, official, verified });
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'page.created',
      targetType: 'page',
      targetId: row.id,
      after: { name: row.name, official, verified, ownerId },
      ip,
    });
    if (ownerId !== ctx.user.id) await this.events.emit({ type: 'page.admin_added', pageId: row.id, userId: ownerId, actorId: ctx.user.id });
    return this.row(row.id);
  }

  /** PATCH /admin/pages/{id} */
  async update(ctx: AuthContext, rawId: string, input: AdminPageUpdateInput, ip?: string): Promise<AdminPageRow> {
    const id = uuidOr404(rawId, 'That page');
    const before = await this.pages.findRow(id);
    if (!before) throw Errors.notFound('That page');
    const { owner, official, verified, ...fields } = input;
    const set = this.pages.changes(fields);
    if (official !== undefined) set.official = official;
    if (verified !== undefined && verified !== !!before.verifiedAt) set.verifiedAt = verified ? new Date() : null;
    if (Object.keys(set).length) {
      await this.db
        .update(pages)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(pages.id, id));
    }
    if (owner) {
      const ownerId = await this.ownerId(owner);
      await this.pages.setOwner(id, ownerId, true);
      await this.events.emit({ type: 'page.admin_added', pageId: id, userId: ownerId, actorId: ctx.user.id });
    }
    await this.audit.record({ actorId: ctx.user.id, action: 'page.updated', targetType: 'page', targetId: id, after: { fields: Object.keys(input) }, ip });
    return this.row(id);
  }

  /** POST /admin/pages/{id}/status: approve, reject, suspend or restore. The page's admins are told. */
  async setStatus(ctx: AuthContext, rawId: string, input: AdminPageStatusInput, ip?: string): Promise<AdminPageRow> {
    const id = uuidOr404(rawId, 'That page');
    const rule = NEXT_STATUS[input.action];
    const [updated] = await this.db
      .update(pages)
      .set({ status: rule.to, reviewNote: rule.to === 'active' ? null : (input.note ?? null), updatedAt: new Date() })
      .where(and(eq(pages.id, id), inArray(pages.status, rule.from)))
      .returning({ id: pages.id });
    if (!updated) {
      if (!(await this.pages.findRow(id))) throw Errors.notFound('That page');
      throw Errors.conflict('This page was changed by someone else. Reload and try again.');
    }
    await this.audit.record({ actorId: ctx.user.id, action: `page.${input.action}`, targetType: 'page', targetId: id, after: { note: input.note ?? null }, ip });
    await this.events.emit({ type: 'page.reviewed', pageId: id, action: input.action, actorId: ctx.user.id });
    return this.row(id);
  }

  /** DELETE /admin/pages/{id}: removes the page with its posts and followers. */
  async remove(ctx: AuthContext, rawId: string, ip?: string): Promise<Ok> {
    const id = uuidOr404(rawId, 'That page');
    const before = await this.pages.findRow(id);
    if (!before) throw Errors.notFound('That page');
    await this.db.transaction(async (tx) => {
      await tx.delete(follows).where(and(eq(follows.targetType, 'page'), eq(follows.targetId, id)));
      await tx.delete(pages).where(eq(pages.id, id));
    });
    await this.audit.record({ actorId: ctx.user.id, action: 'page.deleted', targetType: 'page', targetId: id, before: { name: before.name, slug: before.slug }, ip });
    return { ok: true };
  }

  getSettings(): Promise<PagesSettings> {
    return this.settings.get('pages');
  }

  async setSettings(ctx: AuthContext, input: PagesSettings, ip?: string): Promise<PagesSettings> {
    const before = await this.settings.get('pages');
    await this.settings.set('pages', input, ctx.user.id);
    await this.audit.record({ actorId: ctx.user.id, action: 'settings.pages_updated', targetType: 'setting', targetId: 'pages', before, after: input, ip });
    return input;
  }

  /** GET /admin/queues: open review items, for the sidebar counts. */
  async queueCounts(): Promise<AdminQueueCounts> {
    const [[p], [v]] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(pages).where(eq(pages.status, 'pending')),
      this.db.select({ n: sql<number>`count(*)::int` }).from(verificationRequests).where(eq(verificationRequests.status, 'pending')),
    ]);
    return { pages: p?.n ?? 0, verification: v?.n ?? 0 };
  }
}
