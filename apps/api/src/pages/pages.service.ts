import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import {
  type ManagedPage,
  type Ok,
  type Page,
  type PageAdminRole,
  type PageAdminView,
  type PageCategory,
  type PageDetail,
  type PageInput,
  type PagesQuery,
  type PagesSettings,
  type PageStatus,
  type PageSummary,
  type PageUpdateInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { countries, files, follows, memberProfiles, pageAdmins, pages, posts } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { isUniqueViolation, likePrefix } from '../moderation/util.js';
import { isUuid } from '../media/uuid-param.js';

export type PageRow = typeof pages.$inferSelect;

/** Most admins a page can have, the owner included. */
export const MAX_PAGE_ADMINS = 10;

/** Slugs that would clash with routes under /pages. */
const RESERVED_SLUGS = new Set(['new', 'mine', 'manage', 'settings', 'admin', 'following', 'charter-mission', 'chartermission', 'official']);

export function slugifyPageName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return base.length >= 3 ? base : base ? `${base}-page` : 'page';
}

/** Staff with pages.manage can see and edit any page from the member app too. */
const isPagesStaff = (user: AuthUser | undefined) => !!user?.permissions.has('pages.manage');

/**
 * Pages: an organisation's presence on Charter Mission. Members follow pages (follows with
 * target_type 'page'); page admins edit the page and publish posts as it (posts.page_id).
 */
@Injectable()
export class PagesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly pageRefs: PageRefsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /** GET /pages/settings */
  policy(): Promise<PagesSettings> {
    return this.settings.get('pages');
  }

  async findRow(idOrSlug: string): Promise<PageRow | null> {
    const [row] = await this.db
      .select()
      .from(pages)
      .where(isUuid(idOrSlug) ? eq(pages.id, idOrSlug) : sql`lower(${pages.slug}) = ${idOrSlug.toLowerCase()}`)
      .limit(1);
    return row ?? null;
  }

  /** The page if this viewer may open it: live pages for everyone, others for their admins and staff. */
  private async visibleRow(viewer: AuthUser | undefined, idOrSlug: string): Promise<{ row: PageRow; role: PageAdminRole | null }> {
    const row = await this.findRow(idOrSlug);
    if (!row) throw Errors.notFound('Page');
    const role = await this.pageRefs.role(viewer?.id, row.id);
    if (row.status !== 'active' && !role && !isPagesStaff(viewer)) throw Errors.notFound('Page');
    return { row, role };
  }

  /** The page, for someone allowed to change it. */
  async editableRow(user: AuthUser, idOrSlug: string, need: 'admin' | 'owner' = 'admin'): Promise<{ row: PageRow; role: PageAdminRole | null }> {
    const found = await this.visibleRow(user, idOrSlug);
    const allowed = isPagesStaff(user) || (need === 'owner' ? found.role === 'owner' : !!found.role);
    if (!allowed) throw Errors.forbidden(need === 'owner' ? 'Only the page’s owner can do that' : 'Only the page’s admins can do that');
    return found;
  }

  /** GET /pages: live pages, official ones first, then by name. */
  async list(viewer: AuthUser, q: PagesQuery): Promise<Page<PageSummary>> {
    const cursor = decodeCursor<{ o: number; n: string; id: string }>(q.cursor);
    const conds: (SQL | undefined)[] = [eq(pages.status, 'active')];
    if (q.q) conds.push(or(ilike(pages.name, `%${likePrefix(q.q)}`), ilike(pages.tagline, `%${likePrefix(q.q)}`)));
    if (q.category) conds.push(eq(pages.category, q.category));
    if (q.country) conds.push(eq(pages.countryCode, q.country.toUpperCase()));
    if (q.following) {
      conds.push(
        sql`exists (select 1 from ${follows} f where f.follower_id = ${viewer.id} and f.target_type = 'page' and f.target_id = ${pages.id}::text)`,
      );
    }
    const order = sql<number>`(case when ${pages.official} then 0 else 1 end)`;
    const name = sql<string>`lower(${pages.name})`;
    if (cursor) conds.push(sql`(${order}, ${name}, ${pages.id}) > (${Number(cursor.o)}::int, ${String(cursor.n)}, ${String(cursor.id)}::uuid)`);
    const rows = await this.db
      .select({ id: pages.id, o: order, n: name })
      .from(pages)
      .where(and(...conds))
      .orderBy(asc(order), asc(name), asc(pages.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ o: last.o, n: last.n, id: last.id }));
    return { items: await this.summaries(page.items.map((r) => r.id), viewer.id), nextCursor: page.nextCursor };
  }

  /** PageSummary for these ids, in the order given. */
  async summaries(ids: string[], viewerId: string | undefined): Promise<PageSummary[]> {
    if (!ids.length) return [];
    const followers = sql<number>`(select count(*)::int from ${follows} f where f.target_type = 'page' and f.target_id = ${pages.id}::text)`;
    const following = viewerId
      ? sql<boolean>`exists (select 1 from ${follows} f where f.follower_id = ${viewerId} and f.target_type = 'page' and f.target_id = ${pages.id}::text)`
      : sql<boolean>`false`;
    const rows = await this.db
      .select({ page: pages, countryName: countries.name, followers, following })
      .from(pages)
      .leftJoin(countries, eq(countries.code, pages.countryCode))
      .where(inArray(pages.id, ids));
    const byId = new Map(rows.map((r) => [r.page.id, r]));
    return ids.flatMap((id) => {
      const r = byId.get(id);
      return r ? [this.summary(r.page, r.countryName, r.followers, r.following)] : [];
    });
  }

  private summary(row: PageRow, countryName: string | null, followers: number, following: boolean): PageSummary {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      tagline: row.tagline,
      logoUrl: mediaUrl(row.logoFileId),
      verified: !!row.verifiedAt,
      official: row.official,
      category: row.category as PageCategory,
      country: row.countryCode ? { code: row.countryCode, name: countryName ?? row.countryCode } : null,
      followers,
      following,
      status: row.status as PageStatus,
    };
  }

  /** GET /pages/{slug} */
  async detail(viewer: AuthUser, idOrSlug: string): Promise<PageDetail> {
    const { row, role } = await this.visibleRow(viewer, idOrSlug);
    const staff = isPagesStaff(viewer);
    const [[summary], [postCount]] = await Promise.all([
      this.summaries([row.id], viewer.id),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(posts)
        .where(and(eq(posts.pageId, row.id), sql`${posts.deletedAt} is null`, eq(posts.status, 'published'), eq(posts.moderationState, 'visible'))),
    ]);
    const detail: PageDetail = {
      ...summary!,
      about: row.about,
      website: row.website,
      city: row.city,
      coverUrl: mediaUrl(row.coverFileId),
      posts: postCount?.n ?? 0,
      createdAt: row.createdAt.toISOString(),
      viewer: {
        role,
        canEdit: !!role || staff,
        canManageAdmins: role === 'owner' || staff,
        canPost: !!role && row.status === 'active',
      },
    };
    if (role || staff) {
      detail.reviewNote = row.reviewNote;
      detail.admins = await this.admins(row.id);
    }
    return detail;
  }

  async admins(pageId: string): Promise<PageAdminView[]> {
    const rows = await this.db
      .select({ userId: pageAdmins.userId, role: pageAdmins.role, createdAt: pageAdmins.createdAt })
      .from(pageAdmins)
      .where(eq(pageAdmins.pageId, pageId))
      .orderBy(sql`case when ${pageAdmins.role} = 'owner' then 0 else 1 end`, asc(pageAdmins.createdAt));
    const refs = await this.members.refs(rows.map((r) => r.userId));
    return rows.flatMap((r) => {
      const member = refs.get(r.userId);
      return member ? [{ member, role: r.role as PageAdminRole, addedAt: r.createdAt.toISOString() }] : [];
    });
  }

  /** GET /me/pages: every page the member manages, live or not. */
  async managed(userId: string): Promise<ManagedPage[]> {
    const rows = await this.db
      .select({ pageId: pageAdmins.pageId, role: pageAdmins.role })
      .from(pageAdmins)
      .innerJoin(pages, eq(pages.id, pageAdmins.pageId))
      .where(eq(pageAdmins.userId, userId))
      .orderBy(asc(sql`lower(${pages.name})`));
    const summaries = await this.summaries(rows.map((r) => r.pageId), userId);
    const roles = new Map(rows.map((r) => [r.pageId, r.role as PageAdminRole]));
    return summaries.map((s) => ({ ...s, role: roles.get(s.id)! }));
  }

  /** POST /pages: live straight away, or waiting for review, as the platform setting says. */
  async create(user: AuthUser, input: PageInput, ip?: string): Promise<PageDetail> {
    const staff = isPagesStaff(user);
    const policy = await this.policy();
    if (policy.memberCreation === 'closed' && !staff) {
      throw Errors.forbidden('Pages are created by the Charter Mission team for now. Contact us to request one.');
    }
    if (!staff) {
      const [owned] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(pageAdmins)
        .where(and(eq(pageAdmins.userId, user.id), eq(pageAdmins.role, 'owner')));
      if ((owned?.n ?? 0) >= policy.maxPagesPerMember) {
        throw Errors.conflict(`You can own up to ${policy.maxPagesPerMember} pages. Hand one over or delete one first.`);
      }
    }
    const status: PageStatus = staff || policy.memberCreation === 'open' ? 'active' : 'pending';
    const row = await this.insert(input, { status, createdBy: user.id, ownerId: user.id });
    await this.audit.record({ actorId: user.id, action: 'page.created', targetType: 'page', targetId: row.id, after: { name: row.name, status }, ip });
    return this.detail(user, row.id);
  }

  /** Inserts the page and its owner. Shared with the admin console. */
  async insert(
    input: PageInput,
    opts: { status: PageStatus; createdBy: string; ownerId: string; official?: boolean; verified?: boolean },
  ): Promise<PageRow> {
    await this.assertFiles(opts.createdBy, input);
    await this.assertCountry(input.countryCode);
    const base = input.slug ?? slugifyPageName(input.name);
    for (let n = 1; n <= 30; n++) {
      const slug = n === 1 ? base : `${base.slice(0, 56)}-${n}`;
      if (RESERVED_SLUGS.has(slug)) {
        if (input.slug) throw Errors.validation({ slug: 'That address is reserved. Choose another.' });
        continue;
      }
      try {
        return await this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(pages)
            .values({
              slug,
              name: input.name,
              tagline: input.tagline || null,
              about: input.about || null,
              category: input.category,
              website: input.website || null,
              countryCode: input.countryCode || null,
              city: input.city || null,
              logoFileId: input.logoFileId ?? null,
              coverFileId: input.coverFileId ?? null,
              status: opts.status,
              official: opts.official ?? false,
              verifiedAt: opts.verified ? new Date() : null,
              createdBy: opts.createdBy,
            })
            .returning();
          await tx.insert(pageAdmins).values({ pageId: row!.id, userId: opts.ownerId, role: 'owner' });
          return row!;
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        if (input.slug) throw Errors.validation({ slug: 'That address is taken. Choose another.' });
      }
    }
    throw Errors.conflict('Choose a different page name.');
  }

  /** PATCH /pages/{slug}. Editing a rejected page sends it back for review. */
  async update(user: AuthUser, idOrSlug: string, input: PageUpdateInput, ip?: string): Promise<PageDetail> {
    const { row } = await this.editableRow(user, idOrSlug);
    await this.assertFiles(user.id, input);
    await this.assertCountry(input.countryCode);
    const set = this.changes(input);
    const resubmit = row.status === 'rejected' && !isPagesStaff(user);
    if (resubmit) Object.assign(set, { status: 'pending', reviewNote: null });
    await this.db
      .update(pages)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(pages.id, row.id));
    await this.audit.record({
      actorId: user.id,
      action: 'page.updated',
      targetType: 'page',
      targetId: row.id,
      after: { fields: Object.keys(input), ...(resubmit ? { resubmitted: true } : {}) },
      ip,
    });
    return this.detail(user, row.id);
  }

  /** Column changes for the fields that were sent (empty strings clear a field). */
  changes(input: Partial<PageInput>): Partial<typeof pages.$inferInsert> {
    const set: Partial<typeof pages.$inferInsert> = {};
    if (input.name !== undefined) set.name = input.name;
    if (input.tagline !== undefined) set.tagline = input.tagline || null;
    if (input.about !== undefined) set.about = input.about || null;
    if (input.category !== undefined) set.category = input.category;
    if (input.website !== undefined) set.website = input.website || null;
    if (input.countryCode !== undefined) set.countryCode = input.countryCode || null;
    if (input.city !== undefined) set.city = input.city || null;
    if (input.logoFileId !== undefined) set.logoFileId = input.logoFileId;
    if (input.coverFileId !== undefined) set.coverFileId = input.coverFileId;
    return set;
  }

  /** DELETE /pages/{slug}: the owner (or staff). The page's posts and followers go with it. */
  async remove(user: AuthUser, idOrSlug: string, ip?: string): Promise<Ok> {
    const { row } = await this.editableRow(user, idOrSlug, 'owner');
    await this.db.transaction(async (tx) => {
      await tx.delete(follows).where(and(eq(follows.targetType, 'page'), eq(follows.targetId, row.id)));
      await tx.delete(pages).where(eq(pages.id, row.id));
    });
    await this.audit.record({ actorId: user.id, action: 'page.deleted', targetType: 'page', targetId: row.id, before: { name: row.name, slug: row.slug }, ip });
    return { ok: true };
  }

  /** POST /pages/{slug}/admins: the owner adds a member by handle. */
  async addAdmin(user: AuthUser, idOrSlug: string, handle: string, ip?: string): Promise<PageAdminView[]> {
    const { row } = await this.editableRow(user, idOrSlug, 'owner');
    const clean = handle.replace(/^@/, '').toLowerCase();
    const [member] = await this.db
      .select({ userId: memberProfiles.userId })
      .from(memberProfiles)
      .where(sql`lower(${memberProfiles.handle}) = ${clean}`)
      .limit(1);
    const ref = member ? await this.members.ref(member.userId) : null;
    if (!member || !ref || ref.handle === 'deleted-member') throw Errors.validation({ handle: 'No member has that handle' });
    const current = await this.db.select({ userId: pageAdmins.userId }).from(pageAdmins).where(eq(pageAdmins.pageId, row.id));
    if (current.some((a) => a.userId === member.userId)) throw Errors.conflict(`${ref.name} already manages this page`);
    if (current.length >= MAX_PAGE_ADMINS) throw Errors.conflict(`A page can have up to ${MAX_PAGE_ADMINS} admins`);
    await this.db.insert(pageAdmins).values({ pageId: row.id, userId: member.userId, role: 'admin' }).onConflictDoNothing();
    await this.audit.record({ actorId: user.id, action: 'page.admin_added', targetType: 'page', targetId: row.id, after: { userId: member.userId }, ip });
    await this.events.emit({ type: 'page.admin_added', pageId: row.id, userId: member.userId, actorId: user.id });
    return this.admins(row.id);
  }

  /** DELETE /pages/{slug}/admins/{userId}: the owner removes an admin, or an admin leaves. The owner stays. */
  async removeAdmin(user: AuthUser, idOrSlug: string, userId: string, ip?: string): Promise<PageAdminView[]> {
    const leaving = userId === user.id;
    const { row } = await this.editableRow(user, idOrSlug, leaving ? 'admin' : 'owner');
    const [target] = await this.db
      .select({ role: pageAdmins.role })
      .from(pageAdmins)
      .where(and(eq(pageAdmins.pageId, row.id), eq(pageAdmins.userId, userId)))
      .limit(1);
    if (!target) throw Errors.notFound('That admin');
    if (target.role === 'owner') throw Errors.conflict('The owner can’t be removed. Hand the page to another admin first.');
    await this.db.delete(pageAdmins).where(and(eq(pageAdmins.pageId, row.id), eq(pageAdmins.userId, userId)));
    await this.audit.record({ actorId: user.id, action: 'page.admin_removed', targetType: 'page', targetId: row.id, before: { userId }, ip });
    return leaving ? [] : this.admins(row.id);
  }

  /** POST /pages/{slug}/owner: the owner hands the page to one of its admins. */
  async transfer(user: AuthUser, idOrSlug: string, userId: string, ip?: string): Promise<PageAdminView[]> {
    const { row } = await this.editableRow(user, idOrSlug, 'owner');
    await this.setOwner(row.id, userId, false);
    await this.audit.record({ actorId: user.id, action: 'page.owner_changed', targetType: 'page', targetId: row.id, after: { userId }, ip });
    return this.admins(row.id);
  }

  /** Makes `userId` the owner; the previous owner stays on as an admin. */
  async setOwner(pageId: string, userId: string, addIfMissing: boolean) {
    await this.db.transaction(async (tx) => {
      const current = await tx.select({ userId: pageAdmins.userId, role: pageAdmins.role }).from(pageAdmins).where(eq(pageAdmins.pageId, pageId));
      if (!current.some((a) => a.userId === userId)) {
        if (!addIfMissing) throw Errors.validation({ userId: 'Choose one of the page’s admins' });
        await tx.insert(pageAdmins).values({ pageId, userId, role: 'admin' });
      }
      await tx.update(pageAdmins).set({ role: 'admin', updatedAt: new Date() }).where(and(eq(pageAdmins.pageId, pageId), eq(pageAdmins.role, 'owner')));
      await tx
        .update(pageAdmins)
        .set({ role: 'owner', updatedAt: new Date() })
        .where(and(eq(pageAdmins.pageId, pageId), eq(pageAdmins.userId, userId)));
    });
  }

  /** logoFileId / coverFileId must be the caller's own clean uploads of the right kind. */
  private async assertFiles(userId: string, input: { logoFileId?: string | null; coverFileId?: string | null }) {
    const wanted = [
      { id: input.logoFileId, purpose: 'page_logo', field: 'logoFileId' },
      { id: input.coverFileId, purpose: 'page_cover', field: 'coverFileId' },
    ].filter((w): w is { id: string; purpose: string; field: string } => !!w.id);
    if (!wanted.length) return;
    const rows = await this.db
      .select({ id: files.id, ownerId: files.ownerId, purpose: files.purpose, scanStatus: files.scanStatus })
      .from(files)
      .where(inArray(files.id, wanted.map((w) => w.id)));
    for (const w of wanted) {
      const file = rows.find((r) => r.id === w.id);
      if (!file || file.ownerId !== userId || file.purpose !== w.purpose || file.scanStatus !== 'clean') {
        throw Errors.validation({ [w.field]: 'Upload the picture again' });
      }
    }
  }

  private async assertCountry(code: string | null | undefined) {
    if (!code) return;
    const [country] = await this.db.select({ code: countries.code }).from(countries).where(eq(countries.code, code)).limit(1);
    if (!country) throw Errors.validation({ countryCode: 'Choose a country from the list' });
  }
}
