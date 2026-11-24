import { Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type {
  AdminGroupAction,
  AdminGroupDetail,
  AdminGroupMember,
  AdminGroupMembersQuery,
  AdminGroupPost,
  AdminGroupReport,
  AdminGroupRow,
  AdminGroupsBulkInput,
  AdminGroupsPage,
  AdminGroupsQuery,
  BulkResult,
  ChapterRef,
  GroupMemberStatus,
  GroupOwnerType,
  GroupPostPermission,
  GroupRole,
  GroupStatus,
  GroupsSettings,
  GroupVisibility,
  Page,
  ReportReason,
  ReportStatus,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { auditLog, chapters, contentReports, countries, groupMembers, groups, memberProfiles, pageAdmins, posts, roles, userRoles, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { Errors } from '../common/errors.js';
import { runEach } from '../common/bulk.js';
import { checkCursor, decodeCursor, paginate } from '../common/cursor.js';
import { CHAPTER_TEAM_ROLE_KEYS } from '../groups/group-access.js';
import { OPEN_STATUSES } from '../moderation/reports.service.js';
import { likePrefix, truncate, tsKey, uuidOr404 } from '../moderation/util.js';
import { auditSummary, csvCell } from './admin-audit.service.js';

type GroupRow = typeof groups.$inferSelect;

const OPEN = sql.raw(`(${OPEN_STATUSES.map((s) => `'${s}'`).join(',')})`);

/** Open reports on a group and on its posts (the group's id column or value). */
function openReportsSql(groupId: SQL | typeof groups.id): SQL<number> {
  return sql<number>`((select count(*) from ${contentReports} gr where gr.status in ${OPEN} and gr.target_type = 'group' and gr.target_id = ${groupId}::text)
    + (select count(*) from ${contentReports} pr join ${posts} rp on rp.id::text = pr.target_id where pr.status in ${OPEN} and pr.target_type = 'post' and rp.group_id = ${groupId}))::int`;
}

type SortSpec = { expr: SQL; kind: 'date' | 'int' | 'text'; dir: 'asc' | 'desc' };

function sortSpec(sort: AdminGroupsQuery['sort']): SortSpec {
  switch (sort) {
    case 'members':
      return { expr: sql`${groups.memberCount}`, kind: 'int', dir: 'desc' };
    case 'activity':
      return { expr: sql`coalesce(${groups.lastPostAt}, 'epoch'::timestamptz)`, kind: 'date', dir: 'desc' };
    case 'name':
      return { expr: sql`lower(${groups.name})`, kind: 'text', dir: 'asc' };
    case 'reports':
      return { expr: openReportsSql(groups.id), kind: 'int', dir: 'desc' };
    default:
      return { expr: sql`${groups.createdAt}`, kind: 'date', dir: 'desc' };
  }
}

const CAST = { date: sql.raw('timestamptz'), int: sql.raw('int'), text: sql.raw('text') };

const ROLE_RANK: Record<GroupRole, number> = { owner: 0, admin: 1, moderator: 2, member: 3 };

const MEMBER_CSV_COLUMNS = ['name', 'handle', 'email', 'role', 'status', 'joined_at', 'since', 'invited_by', 'request_answer'];

function write(res: Response, chunk: string): Promise<void> {
  return new Promise((resolve) => {
    if (res.write(chunk)) resolve();
    else res.once('drain', () => resolve());
  });
}

const statusOf = (g: GroupRow): AdminGroupRow['status'] => (g.deletedAt ? 'deleted' : (g.status as GroupStatus));

/**
 * Admin console → Groups: every group members, pages and chapters run, with staff actions (suspend,
 * restore, feature, delete, change the owner), the members of each group and the creation settings.
 * Staff may read private groups' posts here. Notifications go out from domain events.
 */
@Injectable()
export class AdminGroupsService {
  private readonly log = new Logger('AdminGroups');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly pageRefs: PageRefsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /* ------------------------------ List ------------------------------ */

  /** Filters other than the status tab (the tab counts use these). */
  private filterConds(q: AdminGroupsQuery, opts: { visibility: boolean }): (SQL | undefined)[] {
    const conds: (SQL | undefined)[] = [];
    if (opts.visibility && q.visibility) conds.push(eq(groups.visibility, q.visibility));
    if (q.ownerType) conds.push(eq(groups.ownerType, q.ownerType));
    if (q.chapter) conds.push(eq(groups.chapterId, q.chapter));
    if (q.featured) conds.push(q.featured === 'yes' ? isNotNull(groups.featuredAt) : isNull(groups.featuredAt));
    if (q.reported) conds.push(sql`${openReportsSql(groups.id)} > 0`);
    if (q.q) {
      const term = q.q.replace(/^@/, '');
      const contains = `%${likePrefix(term)}`;
      conds.push(
        or(
          ilike(groups.name, contains),
          ilike(groups.slug, likePrefix(term)),
          sql`exists (select 1 from ${groupMembers} sgm join ${users} su on su.id = sgm.user_id join ${memberProfiles} smp on smp.user_id = sgm.user_id
            where sgm.group_id = ${groups.id} and sgm.role = 'owner' and (smp.display_name ilike ${contains} or su.email ilike ${contains} or smp.handle ilike ${likePrefix(term)}))`,
          sql`exists (select 1 from ${users} cu join ${memberProfiles} cmp on cmp.user_id = cu.id
            where cu.id = ${groups.createdBy} and (cmp.display_name ilike ${contains} or cu.email ilike ${contains}))`,
        ),
      );
    }
    return conds;
  }

  private statusCond(status: AdminGroupsQuery['status']): SQL | undefined {
    if (status === 'all') return isNull(groups.deletedAt);
    if (status === 'deleted') return isNotNull(groups.deletedAt);
    return and(eq(groups.status, status), isNull(groups.deletedAt));
  }

  /** GET /admin/groups: keyset paging per sort; counts for the tabs under the other filters. */
  async list(q: AdminGroupsQuery): Promise<AdminGroupsPage> {
    const spec = sortSpec(q.sort);
    const cursor = decodeCursor<{ k: string | number; id: string }>(q.cursor);
    checkCursor(cursor, { k: spec.kind, id: 'uuid' });
    const conds = [...this.filterConds(q, { visibility: true }), this.statusCond(q.status)];
    if (cursor) {
      const op = spec.dir === 'desc' ? sql`<` : sql`>`;
      const value = spec.kind === 'int' ? Number(cursor.k) : String(cursor.k);
      conds.push(sql`(${spec.expr}, ${groups.id}) ${op} (${value}::${CAST[spec.kind]}, ${String(cursor.id)}::uuid)`);
    }
    const key = spec.kind === 'date' ? tsKey(spec.expr) : spec.expr;
    const dir = sql.raw(spec.dir);
    const [rows, counts] = await Promise.all([
      this.db
        .select({ group: groups, k: sql<string | number>`${key}` })
        .from(groups)
        .where(and(...conds))
        .orderBy(sql`${spec.expr} ${dir}`, sql`${groups.id} ${dir}`)
        .limit(q.limit + 1),
      this.counts(q),
    ]);
    const page = paginate(rows, q.limit, (last) => ({ k: last.k, id: last.group.id }));
    return { items: await this.rows(page.items.map((r) => r.group)), nextCursor: page.nextCursor, counts };
  }

  private async counts(q: AdminGroupsQuery): Promise<AdminGroupsPage['counts']> {
    const live = sql`${groups.deletedAt} is null`;
    const [row] = await this.db
      .select({
        all: sql<number>`count(*) filter (where ${live} ${q.visibility ? sql`and ${groups.visibility} = ${q.visibility}` : sql``})::int`,
        active: sql<number>`count(*) filter (where ${live} and ${groups.status} = 'active' ${q.visibility ? sql`and ${groups.visibility} = ${q.visibility}` : sql``})::int`,
        suspended: sql<number>`count(*) filter (where ${live} and ${groups.status} = 'suspended' ${q.visibility ? sql`and ${groups.visibility} = ${q.visibility}` : sql``})::int`,
        archived: sql<number>`count(*) filter (where ${live} and ${groups.status} = 'archived' ${q.visibility ? sql`and ${groups.visibility} = ${q.visibility}` : sql``})::int`,
        deleted: sql<number>`count(*) filter (where ${groups.deletedAt} is not null ${q.visibility ? sql`and ${groups.visibility} = ${q.visibility}` : sql``})::int`,
        private: sql<number>`count(*) filter (where ${live} and ${groups.visibility} = 'private')::int`,
        public: sql<number>`count(*) filter (where ${live} and ${groups.visibility} = 'public')::int`,
      })
      .from(groups)
      .where(and(...this.filterConds(q, { visibility: false })));
    return {
      all: row?.all ?? 0,
      active: row?.active ?? 0,
      suspended: row?.suspended ?? 0,
      archived: row?.archived ?? 0,
      deleted: row?.deleted ?? 0,
      private: row?.private ?? 0,
      public: row?.public ?? 0,
    };
  }

  private async chapterRefs(ids: string[]): Promise<Map<string, ChapterRef>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
      .from(chapters)
      .where(inArray(chapters.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async rows(list: GroupRow[]): Promise<AdminGroupRow[]> {
    if (!list.length) return [];
    const ids = list.map((g) => g.id);
    const [ownerRows, pendingRows, recentRows, groupReports, postReports] = await Promise.all([
      this.db
        .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
        .from(groupMembers)
        .where(and(inArray(groupMembers.groupId, ids), eq(groupMembers.role, 'owner'), eq(groupMembers.status, 'active'))),
      this.db
        .select({ groupId: groupMembers.groupId, n: sql<number>`count(*)::int` })
        .from(groupMembers)
        .where(and(inArray(groupMembers.groupId, ids), eq(groupMembers.status, 'pending')))
        .groupBy(groupMembers.groupId),
      this.db
        .select({ groupId: posts.groupId, n: sql<number>`count(*)::int` })
        .from(posts)
        .where(and(inArray(posts.groupId, ids), isNull(posts.deletedAt), sql`${posts.createdAt} > now() - interval '30 days'`))
        .groupBy(posts.groupId),
      this.db
        .select({ groupId: contentReports.targetId, n: sql<number>`count(*)::int` })
        .from(contentReports)
        .where(and(eq(contentReports.targetType, 'group'), inArray(contentReports.targetId, ids), inArray(contentReports.status, [...OPEN_STATUSES])))
        .groupBy(contentReports.targetId),
      this.db
        .select({ groupId: posts.groupId, n: sql<number>`count(*)::int` })
        .from(contentReports)
        .innerJoin(posts, sql`${posts.id}::text = ${contentReports.targetId}`)
        .where(and(eq(contentReports.targetType, 'post'), inArray(posts.groupId, ids), inArray(contentReports.status, [...OPEN_STATUSES])))
        .groupBy(posts.groupId),
    ]);
    const ownerOf = new Map(ownerRows.map((r) => [r.groupId, r.userId]));
    const [refs, pageRefs, chapterRefs] = await Promise.all([
      this.members.refs([...ownerRows.map((r) => r.userId), ...list.flatMap((g) => (g.createdBy ? [g.createdBy] : []))]),
      this.pageRefs.refs(list.flatMap((g) => (g.pageId ? [g.pageId] : []))),
      this.chapterRefs(list.flatMap((g) => (g.chapterId ? [g.chapterId] : []))),
    ]);
    const count = (rows: { groupId: string | null; n: number }[]) => new Map(rows.map((r) => [r.groupId, r.n]));
    const pending = count(pendingRows);
    const recent = count(recentRows);
    const reportsOnGroup = count(groupReports);
    const reportsOnPosts = count(postReports);
    return list.map((g) => {
      const ownerId = ownerOf.get(g.id);
      const page = g.pageId ? pageRefs.get(g.pageId) : undefined;
      return {
        id: g.id,
        slug: g.slug,
        name: g.name,
        tagline: g.tagline,
        logoUrl: mediaUrl(g.logoFileId),
        visibility: g.visibility as GroupVisibility,
        ownerType: g.ownerType as GroupOwnerType,
        page: page ? PageRefsService.toRef(page) : null,
        chapter: g.chapterId ? (chapterRefs.get(g.chapterId) ?? null) : null,
        createdBy: g.createdBy ? (refs.get(g.createdBy) ?? null) : null,
        owner: ownerId ? (refs.get(ownerId) ?? null) : null,
        status: statusOf(g),
        statusNote: g.statusNote,
        featured: !!g.featuredAt,
        memberCount: g.memberCount,
        pendingRequests: pending.get(g.id) ?? 0,
        postCount: g.postCount,
        postsLast30Days: recent.get(g.id) ?? 0,
        openReports: (reportsOnGroup.get(g.id) ?? 0) + (reportsOnPosts.get(g.id) ?? 0),
        lastPostAt: g.lastPostAt?.toISOString() ?? null,
        createdAt: g.createdAt.toISOString(),
        deletedAt: g.deletedAt?.toISOString() ?? null,
      };
    });
  }

  private async find(rawId: string): Promise<GroupRow> {
    const id = uuidOr404(rawId, 'That group');
    const [group] = await this.db.select().from(groups).where(eq(groups.id, id)).limit(1);
    if (!group) throw Errors.notFound('That group');
    return group;
  }

  async row(rawId: string): Promise<AdminGroupRow> {
    return (await this.rows([await this.find(rawId)]))[0]!;
  }

  /* ------------------------------ Detail ------------------------------ */

  /** GET /admin/groups/{id}: everything the group's console page shows. Private posts included (marked). */
  async detail(rawId: string): Promise<AdminGroupDetail> {
    const group = await this.find(rawId);
    const [[row], adminRows, postRows, reportRows, auditRows, country] = await Promise.all([
      this.rows([group]),
      this.db
        .select({ userId: groupMembers.userId, role: groupMembers.role })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.status, 'active'), inArray(groupMembers.role, ['owner', 'admin', 'moderator']))),
      this.db.select().from(posts).where(eq(posts.groupId, group.id)).orderBy(desc(posts.createdAt), desc(posts.id)).limit(20),
      this.db
        .select({
          id: contentReports.id,
          targetType: contentReports.targetType,
          targetId: contentReports.targetId,
          reason: contentReports.reasonCode,
          detail: contentReports.detail,
          status: contentReports.status,
          reporterId: contentReports.reporterId,
          createdAt: contentReports.createdAt,
          postBody: posts.body,
        })
        .from(contentReports)
        .leftJoin(posts, and(eq(contentReports.targetType, 'post'), sql`${posts.id}::text = ${contentReports.targetId}`))
        .where(
          and(
            inArray(contentReports.status, [...OPEN_STATUSES]),
            or(and(eq(contentReports.targetType, 'group'), eq(contentReports.targetId, group.id)), and(eq(contentReports.targetType, 'post'), eq(posts.groupId, group.id))),
          ),
        )
        .orderBy(desc(contentReports.createdAt), desc(contentReports.id))
        .limit(20),
      this.db
        .select({ id: auditLog.id, actorId: auditLog.actorId, action: auditLog.action, targetType: auditLog.targetType, targetId: auditLog.targetId, createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(and(eq(auditLog.targetType, 'group'), eq(auditLog.targetId, group.id)))
        .orderBy(desc(auditLog.id))
        .limit(30),
      group.countryCode
        ? this.db.select({ code: countries.code, name: countries.name }).from(countries).where(eq(countries.code, group.countryCode)).limit(1)
        : Promise.resolve([]),
    ]);
    const refs = await this.members.refs([
      ...adminRows.map((a) => a.userId),
      ...postRows.map((p) => p.authorId),
      ...reportRows.map((r) => r.reporterId),
      ...auditRows.flatMap((r) => (r.actorId ? [r.actorId] : [])),
    ]);
    const recentPosts: AdminGroupPost[] = postRows.map((p) => ({
      id: p.id,
      author: refs.get(p.authorId) ?? null,
      preview: truncate(p.body, 200) || 'Post',
      private: p.visibility === 'group',
      status: p.status,
      moderationState: p.moderationState as AdminGroupPost['moderationState'],
      deleted: !!p.deletedAt,
      createdAt: p.createdAt.toISOString(),
      href: `/posts/${p.id}`,
    }));
    const reports: AdminGroupReport[] = reportRows.map((r) => ({
      id: r.id,
      target: r.targetType === 'group' ? { type: 'group', id: group.id, preview: group.name } : { type: 'post', id: r.targetId, preview: truncate(r.postBody) || 'Post' },
      reason: r.reason as ReportReason,
      detail: r.detail,
      status: r.status as ReportStatus,
      reporter: refs.get(r.reporterId) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
    return {
      ...row!,
      tagline: group.tagline,
      about: group.about,
      rules: group.rules,
      joinQuestion: group.joinQuestion,
      postPermission: group.postPermission as GroupPostPermission,
      postApproval: group.postApproval,
      hashtags: group.hashtags,
      country: country[0] ?? null,
      coverUrl: mediaUrl(group.coverFileId),
      admins: adminRows
        .flatMap((a) => {
          const member = refs.get(a.userId);
          return member ? [{ member, role: a.role as GroupRole }] : [];
        })
        .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.member.name.localeCompare(b.member.name)),
      recentPosts,
      reports,
      history: auditRows.map((r) => ({
        id: String(r.id),
        actor: r.actorId ? (refs.get(r.actorId) ?? null) : null,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        summary: auditSummary(r, refs),
        createdAt: r.createdAt.toISOString(),
        ipHash: null,
      })),
    };
  }

  /* ------------------------------ Members ------------------------------ */

  private memberConds(groupId: string, q: Omit<AdminGroupMembersQuery, 'cursor' | 'limit'>): (SQL | undefined)[] {
    const conds: (SQL | undefined)[] = [eq(groupMembers.groupId, groupId)];
    if (q.status) conds.push(eq(groupMembers.status, q.status));
    if (q.role) conds.push(eq(groupMembers.role, q.role));
    if (q.q) {
      const term = q.q.replace(/^@/, '');
      const contains = `%${likePrefix(term)}`;
      conds.push(or(ilike(memberProfiles.displayName, contains), ilike(memberProfiles.handle, likePrefix(term)), ilike(users.email, contains)));
    }
    return conds;
  }

  /** Owner, admins and moderators first, then by name. */
  private memberOrder() {
    const rank = sql<number>`(case ${groupMembers.role} when 'owner' then 0 when 'admin' then 1 when 'moderator' then 2 else 3 end)`;
    const name = sql<string>`lower(${memberProfiles.displayName})`;
    return { rank, name };
  }

  private async memberPage(groupId: string, q: AdminGroupMembersQuery) {
    const { rank, name } = this.memberOrder();
    const cursor = decodeCursor<{ r: number; n: string; id: string }>(q.cursor);
    checkCursor(cursor, { r: 'int', n: 'text', id: 'uuid' });
    const conds = this.memberConds(groupId, q);
    if (cursor) conds.push(sql`(${rank}, ${name}, ${groupMembers.userId}) > (${Number(cursor.r)}::int, ${String(cursor.n)}, ${String(cursor.id)}::uuid)`);
    const rows = await this.db
      .select({ m: groupMembers, email: users.email, r: rank, n: name })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .innerJoin(memberProfiles, eq(memberProfiles.userId, groupMembers.userId))
      .where(and(...conds))
      .orderBy(asc(rank), asc(name), asc(groupMembers.userId))
      .limit(q.limit + 1);
    return paginate(rows, q.limit, (last) => ({ r: last.r, n: last.n, id: last.m.userId }));
  }

  private async memberViews(rows: { m: typeof groupMembers.$inferSelect; email: string }[]): Promise<AdminGroupMember[]> {
    const refs = await this.members.refs(rows.flatMap((r) => [r.m.userId, ...(r.m.invitedBy ? [r.m.invitedBy] : [])]));
    return rows.flatMap(({ m, email }) => {
      const member = refs.get(m.userId);
      if (!member) return [];
      return [
        {
          member,
          email,
          role: m.role as GroupRole,
          status: m.status as GroupMemberStatus,
          requestAnswer: m.requestAnswer,
          invitedBy: m.invitedBy ? (refs.get(m.invitedBy) ?? null) : null,
          joinedAt: m.joinedAt?.toISOString() ?? null,
          since: (m.status === 'active' ? (m.joinedAt ?? m.createdAt) : m.updatedAt).toISOString(),
        },
      ];
    });
  }

  /** GET /admin/groups/{id}/members: every status unless filtered (staff see private groups' members too). */
  async membersOf(rawId: string, q: AdminGroupMembersQuery): Promise<Page<AdminGroupMember>> {
    const group = await this.find(rawId);
    const page = await this.memberPage(group.id, q);
    return { items: await this.memberViews(page.items), nextCursor: page.nextCursor };
  }

  /** GET /admin/groups/{id}/members/export.csv (members.manage or groups.manage): streamed, audited first. */
  async exportMembers(ctx: AuthContext, rawId: string, q: AdminGroupMembersQuery, res: Response, ip?: string): Promise<void> {
    if (!ctx.user.permissions.has('members.manage') && !ctx.user.permissions.has('groups.manage')) throw Errors.forbidden();
    const group = await this.find(rawId);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'group.members_exported',
      targetType: 'group',
      targetId: group.id,
      after: { filters: { q: q.q ?? null, status: q.status ?? null, role: q.role ?? null } },
      ip,
    });
    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="group-${group.slug}-members-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    await write(res, `${MEMBER_CSV_COLUMNS.join(',')}\r\n`);
    let cursor: string | undefined;
    for (;;) {
      const page = await this.memberPage(group.id, { ...q, cursor, limit: 100 });
      if (!page.items.length) break;
      const views = await this.memberViews(page.items);
      const lines = views.map((v) =>
        [v.member.name, v.member.handle, v.email, v.role, v.status, v.joinedAt?.slice(0, 10) ?? '', v.since.slice(0, 10), v.invitedBy?.handle ?? '', v.requestAnswer ?? '']
          .map(csvCell)
          .join(','),
      );
      if (lines.length) await write(res, `${lines.join('\r\n')}\r\n`);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    res.end();
  }

  /* ------------------------------ Actions ------------------------------ */

  /** POST /admin/groups/{id}: suspend, restore, feature, unfeature, delete or set the owner. Audited; the group's admins are told. */
  async act(ctx: AuthContext, rawId: string, input: AdminGroupAction, ip?: string): Promise<AdminGroupRow> {
    const group = await this.find(rawId);
    const now = new Date();
    const record = (action: string, before: unknown, after: unknown) =>
      this.audit.record({ actorId: ctx.user.id, action, targetType: 'group', targetId: group.id, before, after, ip });
    switch (input.action) {
      case 'suspend': {
        if (group.deletedAt) throw Errors.conflict('This group was deleted. Restore it first.');
        if (group.status === 'suspended') throw Errors.conflict('Already suspended');
        await this.update(group, ['active', 'archived'], { status: 'suspended', statusNote: input.note, featuredAt: null });
        const reportIds = await this.resolveGroupReports(group.id, now);
        await record('group.suspended', { status: group.status }, { status: 'suspended', note: input.note, reportIds });
        await this.events.emit({ type: 'group.staff_action', groupId: group.id, action: 'suspend', actorId: ctx.user.id, at: now.toISOString() });
        for (const reportId of reportIds) await this.events.emit({ type: 'report.resolved', reportId, outcome: 'actioned' });
        break;
      }
      case 'restore': {
        if (group.deletedAt) {
          const [done] = await this.db
            .update(groups)
            .set({ deletedAt: null, updatedAt: now })
            .where(and(eq(groups.id, group.id), isNotNull(groups.deletedAt)))
            .returning({ id: groups.id });
          if (!done) throw Errors.conflict('This group was changed by someone else. Reload and try again.');
          await record('group.restored', { deleted: true, status: group.status }, { deleted: false, status: group.status });
        } else if (group.status === 'suspended') {
          await this.update(group, ['suspended'], { status: 'active', statusNote: null });
          await record('group.restored', { status: 'suspended', note: group.statusNote }, { status: 'active' });
        } else {
          throw Errors.conflict('Only suspended or deleted groups can be restored');
        }
        await this.events.emit({ type: 'group.staff_action', groupId: group.id, action: 'restore', actorId: ctx.user.id, at: now.toISOString() });
        break;
      }
      case 'feature':
      case 'unfeature': {
        const on = input.action === 'feature';
        if (group.deletedAt) throw Errors.conflict('This group was deleted');
        if (on && group.status !== 'active') throw Errors.conflict('Only active groups can be featured');
        if (on === !!group.featuredAt) throw Errors.conflict(on ? 'Already featured' : 'Not featured');
        await this.db.update(groups).set({ featuredAt: on ? now : null, updatedAt: now }).where(eq(groups.id, group.id));
        await record(on ? 'group.featured' : 'group.unfeatured', { featured: !on }, { featured: on });
        break;
      }
      case 'delete': {
        if (group.deletedAt) throw Errors.conflict('Already deleted');
        const [done] = await this.db
          .update(groups)
          .set({ deletedAt: now, featuredAt: null, statusNote: input.note ?? group.statusNote, updatedAt: now })
          .where(and(eq(groups.id, group.id), isNull(groups.deletedAt)))
          .returning({ id: groups.id });
        if (!done) throw Errors.conflict('This group was changed by someone else. Reload and try again.');
        const reportIds = await this.resolveGroupReports(group.id, now);
        await record('group.deleted', { name: group.name, slug: group.slug, status: group.status }, { note: input.note ?? null, reportIds });
        await this.events.emit({ type: 'group.staff_action', groupId: group.id, action: 'delete', actorId: ctx.user.id, at: now.toISOString() });
        for (const reportId of reportIds) await this.events.emit({ type: 'report.resolved', reportId, outcome: 'actioned' });
        break;
      }
      case 'set_owner':
        await this.setOwner(ctx, group, input.memberId, now, ip);
        break;
    }
    return this.row(group.id);
  }

  /** Status change guarded by the status it was read with (a concurrent change is a conflict). */
  private async update(group: GroupRow, from: GroupStatus[], set: Partial<typeof groups.$inferInsert>) {
    const [done] = await this.db
      .update(groups)
      .set({ ...set, updatedAt: new Date() })
      .where(and(eq(groups.id, group.id), inArray(groups.status, from), isNull(groups.deletedAt)))
      .returning({ id: groups.id });
    if (!done) throw Errors.conflict('This group was changed by someone else. Reload and try again.');
  }

  /** Open reports on the group itself are closed as actioned (its posts' reports stay for moderators). */
  private async resolveGroupReports(groupId: string, now: Date): Promise<string[]> {
    const rows = await this.db
      .update(contentReports)
      .set({ status: 'actioned', resolvedAt: now, updatedAt: now })
      .where(and(eq(contentReports.targetType, 'group'), eq(contentReports.targetId, groupId), inArray(contentReports.status, [...OPEN_STATUSES])))
      .returning({ id: contentReports.id });
    return rows.map((r) => r.id);
  }

  /** Hands a member-run group to one of its active members; the previous owner stays on as an admin. */
  private async setOwner(ctx: AuthContext, group: GroupRow, rawMemberId: string, now: Date, ip?: string) {
    if (group.deletedAt) throw Errors.conflict('This group was deleted');
    if (group.ownerType !== 'member') {
      throw Errors.validation({ memberId: 'Page and chapter groups are run by their page’s admins or chapter team, so they have no single owner.' });
    }
    const memberId = uuidOr404(rawMemberId, 'That member');
    const previous = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`group-owner:${group.id}`}))`);
      const [target] = await tx
        .select({ role: groupMembers.role, status: groupMembers.status, accountStatus: users.status })
        .from(groupMembers)
        .innerJoin(users, eq(users.id, groupMembers.userId))
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, memberId)))
        .limit(1);
      if (!target || target.status !== 'active' || !['active', 'unverified'].includes(target.accountStatus)) {
        throw Errors.validation({ memberId: 'The new owner must be an active member of the group' });
      }
      if (target.role === 'owner') throw Errors.conflict('They already own this group');
      const owners = await tx
        .update(groupMembers)
        .set({ role: 'admin', decidedBy: ctx.user.id, updatedAt: now })
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.role, 'owner')))
        .returning({ userId: groupMembers.userId });
      await tx
        .update(groupMembers)
        .set({ role: 'owner', decidedBy: ctx.user.id, updatedAt: now })
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, memberId)));
      await this.audit.record(
        {
          actorId: ctx.user.id,
          action: 'group.owner_changed',
          targetType: 'group',
          targetId: group.id,
          before: { ownerIds: owners.map((o) => o.userId), newOwnerRole: target.role },
          after: { ownerId: memberId },
          ip,
        },
        tx,
      );
      return owners.map((o) => o.userId);
    });
    await this.events.emit({
      type: 'group.staff_action',
      groupId: group.id,
      action: 'set_owner',
      actorId: ctx.user.id,
      at: now.toISOString(),
      ownerId: memberId,
      previousOwnerIds: previous,
    });
  }

  /** POST /admin/groups/bulk: the single action for each group, so each keeps its checks, audit entry and notifications. */
  async bulk(ctx: AuthContext, input: AdminGroupsBulkInput, ip?: string): Promise<BulkResult> {
    if (input.action === 'suspend' && (!input.note || input.note.length < 3)) {
      throw Errors.validation({ note: 'Say why, for the groups’ admins' });
    }
    return runEach(
      input.ids,
      (id) => {
        const action: AdminGroupAction =
          input.action === 'suspend' ? { action: 'suspend', note: input.note! } : input.action === 'delete' ? { action: 'delete', note: input.note } : { action: input.action };
        return this.act(ctx, id, action, ip);
      },
      this.log,
    );
  }

  /* ------------------------------ Settings ------------------------------ */

  getSettings(): Promise<GroupsSettings> {
    return this.settings.get('groups');
  }

  async setSettings(ctx: AuthContext, input: GroupsSettings, ip?: string): Promise<GroupsSettings> {
    const before = await this.settings.get('groups');
    await this.settings.set('groups', input, ctx.user.id);
    await this.audit.record({ actorId: ctx.user.id, action: 'settings.groups_updated', targetType: 'setting', targetId: 'groups', before, after: input, ip });
    return this.settings.get('groups');
  }

  /* ------------------------------ Helpers for other admin views ------------------------------ */

  /** People who run a group: its owner and admins, the owning page's admins, the owning chapter's team. */
  async runnerIds(group: Pick<GroupRow, 'id' | 'ownerType' | 'pageId' | 'chapterId'>): Promise<string[]> {
    const ids = new Set<string>();
    const own = await this.db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.status, 'active'), inArray(groupMembers.role, ['owner', 'admin'])));
    for (const r of own) ids.add(r.userId);
    if (group.ownerType === 'page' && group.pageId) {
      for (const r of await this.db.select({ userId: pageAdmins.userId }).from(pageAdmins).where(eq(pageAdmins.pageId, group.pageId))) ids.add(r.userId);
    }
    if (group.ownerType === 'chapter' && group.chapterId) {
      const team = await this.db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(and(inArray(roles.key, [...CHAPTER_TEAM_ROLE_KEYS]), eq(userRoles.scopeType, 'chapter'), eq(userRoles.scopeId, group.chapterId), isNull(userRoles.revokedAt)));
      for (const r of team) ids.add(r.userId);
    }
    return [...ids];
  }
}

