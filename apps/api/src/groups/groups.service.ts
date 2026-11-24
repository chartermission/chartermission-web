import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type {
  ChapterRef,
  GroupDetail,
  GroupInput,
  GroupOwnerType,
  GroupPostPermission,
  GroupRole,
  GroupStatus,
  GroupSummary,
  GroupUpdateInput,
  GroupVisibility,
  GroupsQuery,
  GroupsSettings,
  MemberRef,
  Ok,
  Page,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, connections, countries, files, follows, groupMembers, groups, pageAdmins, pages, posts, roles, userRoles, users } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { RelationsService } from '../core/relations.service.js';
import { AuditService } from '../infra/audit.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { Errors } from '../common/errors.js';
import { checkCursor, decodeCursor, encodeCursor } from '../common/cursor.js';
import { isUniqueViolation, likePrefix } from '../moderation/util.js';
import { isUuid } from '../media/uuid-param.js';
import { assertNotRestricted } from '../posts/posts.service.js';
import {
  accessFrom,
  CHAPTER_TEAM_ROLE_KEYS,
  groupAccess,
  groupMemberSql,
  isChapterTeam,
  membershipsFor,
  roleAtLeast,
  syncGroupMemberCount,
  syncGroupPostStats,
  type GroupAccess,
  type GroupRow,
} from './group-access.js';

/** New groups one member may start per day (on top of GroupsSettings.maxOwnedPerMember). */
export const GROUPS_PER_DAY = 5;

/** Slugs that would clash with routes under /groups. */
const RESERVED_SLUGS = new Set(['new', 'create', 'mine', 'managed', 'invited', 'requested', 'suggested', 'discover', 'settings', 'admin', 'bulk']);

export function slugifyGroupName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return base.length >= 3 ? base : base ? `${base}-group` : 'group';
}

/** Hashtags without repeats whatever their case (the first spelling wins). */
function cleanHashtags(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** SQL on the outer "groups" row: the viewer runs the group through the page or chapter that owns it. */
function runsViaOwnerSql(viewerId: string): SQL {
  return sql`(("groups"."owner_type" = 'page' and exists (select 1 from ${pageAdmins} lpa where lpa.page_id = "groups"."page_id" and lpa.user_id = ${viewerId}))
    or ("groups"."owner_type" = 'chapter' and exists (select 1 from ${userRoles} lur join ${roles} lrl on lrl.id = lur.role_id
          where lur.user_id = ${viewerId} and lur.scope_type = 'chapter' and lur.scope_id = "groups"."chapter_id"::text and lur.revoked_at is null
            and lrl.key in (${sql.join(CHAPTER_TEAM_ROLE_KEYS.map((k) => sql`${k}`), sql`, `)}))))`;
}

/** SQL on the outer "groups" row: the viewer's group_members row has this status (and role, when given). */
function membershipSql(viewerId: string, status: string, roleIn?: GroupRole[]): SQL {
  const role = roleIn ? sql` and lgm.role in (${sql.join(roleIn.map((r) => sql`${r}`), sql`, `)})` : sql``;
  return sql`exists (select 1 from ${groupMembers} lgm where lgm.group_id = "groups"."id" and lgm.user_id = ${viewerId} and lgm.status = ${status}${role})`;
}

type SortKey = { key: SQL; type: 'date' | 'int' | 'text'; dir: 'asc' | 'desc' };

/**
 * Groups for members (contracts/groups.ts): create, list, open, change and delete groups. Who may see
 * and do what comes from group-access.ts; memberships live in GroupMembersService.
 */
@Injectable()
export class GroupsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly pageRefs: PageRefsService,
    private readonly relations: RelationsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
  ) {}

  policy(): Promise<GroupsSettings> {
    return this.settings.get('groups');
  }

  async findRow(idOrSlug: string): Promise<GroupRow | null> {
    const [row] = await this.db
      .select()
      .from(groups)
      .where(isUuid(idOrSlug) ? eq(groups.id, idOrSlug) : sql`lower(${groups.slug}) = ${idOrSlug.toLowerCase()}`)
      .limit(1);
    return row ?? null;
  }

  /**
   * The group if this viewer may open it, with their access. Deleted groups are gone for everyone;
   * suspended ones open only for their admins (to read the reason) and staff.
   */
  async visibleRow(viewer: AuthUser | undefined, idOrSlug: string): Promise<{ row: GroupRow; access: GroupAccess }> {
    const row = await this.findRow(idOrSlug);
    if (!row || row.deletedAt) throw Errors.notFound('Group');
    const access = await groupAccess(this.db, row, viewer);
    if (row.status === 'suspended' && !access.staff && !roleAtLeast(access.role, 'admin')) throw Errors.notFound('Group');
    return { row, access };
  }

  /* ------------------------------ Lists ------------------------------ */

  /** GET /groups: listed groups (private ones too: their name and description are public), cursor paged. */
  async list(viewer: AuthUser, q: GroupsQuery): Promise<Page<GroupSummary>> {
    const conds: (SQL | undefined)[] = [isNull(groups.deletedAt)];
    const open = sql`"groups"."status" in ('active','archived')`;
    switch (q.scope) {
      case 'all':
        conds.push(open);
        break;
      case 'mine':
        conds.push(open, groupMemberSql(viewer.id, sql`"groups"."id"`));
        break;
      case 'managed':
        // Suspended groups stay on their admins' list, so they can read why.
        conds.push(sql`(${membershipSql(viewer.id, 'active', ['owner', 'admin'])} or ${runsViaOwnerSql(viewer.id)})`);
        break;
      case 'invited':
        conds.push(eq(groups.status, 'active'), membershipSql(viewer.id, 'invited'));
        break;
      case 'requested':
        conds.push(eq(groups.status, 'active'), membershipSql(viewer.id, 'pending'));
        break;
      case 'suggested':
        conds.push(
          eq(groups.status, 'active'),
          sql`not exists (select 1 from ${groupMembers} lgm where lgm.group_id = "groups"."id" and lgm.user_id = ${viewer.id})`,
          sql`not ${runsViaOwnerSql(viewer.id)}`,
        );
        break;
    }
    if (q.q) {
      const term = likePrefix(q.q);
      conds.push(sql`("groups"."name" ilike ${`%${term}`} or "groups"."tagline" ilike ${`%${term}`})`);
    }
    if (q.visibility) conds.push(eq(groups.visibility, q.visibility));
    if (q.ownerType) conds.push(eq(groups.ownerType, q.ownerType));
    if (q.country) conds.push(eq(groups.countryCode, q.country.toUpperCase()));
    if (q.page) {
      const [page] = await this.db
        .select({ id: pages.id })
        .from(pages)
        .where(isUuid(q.page) ? eq(pages.id, q.page) : sql`lower(${pages.slug}) = ${q.page.toLowerCase()}`)
        .limit(1);
      if (!page) return { items: [], nextCursor: null };
      conds.push(eq(groups.pageId, page.id));
    }
    if (q.chapter) {
      const [chapter] = await this.db
        .select({ id: chapters.id })
        .from(chapters)
        .where(isUuid(q.chapter) ? eq(chapters.id, q.chapter) : eq(chapters.slug, q.chapter.toLowerCase()))
        .limit(1);
      if (!chapter) return { items: [], nextCursor: null };
      conds.push(eq(groups.chapterId, chapter.id));
    }

    const sort = this.sortKey(viewer, q);
    const c = decodeCursor<{ k: string; id: string }>(q.cursor);
    checkCursor(c, { k: 'text', id: 'uuid' });
    if (c) {
      const cast = sort.type === 'date' ? sql`${c.k}::timestamptz` : sort.type === 'int' ? sql`${c.k}::int` : sql`${c.k}`;
      conds.push(sort.dir === 'desc' ? sql`(${sort.key}, "groups"."id") < (${cast}, ${c.id}::uuid)` : sql`(${sort.key}, "groups"."id") > (${cast}, ${c.id}::uuid)`);
    }
    const keyText = sort.type === 'date' ? sql<string>`to_char(${sort.key} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` : sql<string>`(${sort.key})::text`;
    const rows = await this.db
      .select({ group: groups, k: keyText })
      .from(groups)
      .where(and(...conds))
      .orderBy(sort.dir === 'desc' ? sql`${sort.key} desc, "groups"."id" desc` : sql`${sort.key} asc, "groups"."id" asc`)
      .limit(q.limit + 1);
    const hasMore = rows.length > q.limit;
    const items = rows.slice(0, q.limit);
    const last = items[items.length - 1];
    return {
      items: await this.summaries(items.map((r) => r.group), viewer),
      nextCursor: hasMore && last ? encodeCursor({ k: last.k, id: last.group.id }) : null,
    };
  }

  /**
   * Sort orders. suggested: featured groups first, then a transparent score: the viewer's chapters
   * (30), their country (20), each hashtag they follow (10) and each connection already in it (5, up to 5).
   */
  private sortKey(viewer: AuthUser, q: GroupsQuery): SortKey {
    if (q.scope === 'suggested') {
      const score = sql`((case when "groups"."featured_at" is not null then 1000 else 0 end)
        + (case when "groups"."chapter_id" is not null and exists (select 1 from ${follows} sf join ${chapters} sc on sc.id = "groups"."chapter_id"
              where sf.follower_id = ${viewer.id} and sf.target_type = 'chapter' and (sf.target_id = sc.id::text or sf.target_id = sc.slug)) then 30 else 0 end)
        + (case when "groups"."country_code" is not null and "groups"."country_code" = ${viewer.countryCode ?? ''} then 20 else 0 end)
        + 10 * (select count(*)::int from unnest("groups"."hashtags") sh(tag)
              where exists (select 1 from ${follows} hf where hf.follower_id = ${viewer.id} and hf.target_type = 'hashtag' and hf.target_id = lower(sh.tag)))
        + 5 * least(5, (select count(*)::int from ${groupMembers} cgm join ${connections} scn on scn.status = 'accepted'
              and least(scn.requester_id, scn.addressee_id) = least(${viewer.id}::uuid, cgm.user_id)
              and greatest(scn.requester_id, scn.addressee_id) = greatest(${viewer.id}::uuid, cgm.user_id)
              where cgm.group_id = "groups"."id" and cgm.status = 'active')))`;
      return { key: score, type: 'int', dir: 'desc' };
    }
    switch (q.sort) {
      case 'members':
        return { key: sql`"groups"."member_count"`, type: 'int', dir: 'desc' };
      case 'newest':
        return { key: sql`"groups"."created_at"`, type: 'date', dir: 'desc' };
      case 'name':
        return { key: sql`lower("groups"."name")`, type: 'text', dir: 'asc' };
      default:
        return { key: sql`coalesce("groups"."last_post_at", "groups"."created_at")`, type: 'date', dir: 'desc' };
    }
  }

  /** GroupSummary for these groups, in the order given. */
  async summaries(rows: GroupRow[], viewer: AuthUser | undefined): Promise<GroupSummary[]> {
    if (!rows.length) return [];
    const facts = await membershipsFor(this.db, rows, viewer?.id);
    const access = new Map(rows.map((g) => [g.id, accessFrom(g, viewer, facts.get(g.id)!)]));
    const inside = rows.filter((g) => access.get(g.id)!.abilities.seeContent);
    const insideIds = inside.map((g) => g.id);
    const [pageMap, chapterRows, countryRows, weekly, connected] = await Promise.all([
      this.pageRefs.refs(rows.map((g) => g.pageId).filter((x): x is string => !!x)),
      this.chapterRefs(rows),
      this.countryNames(rows),
      insideIds.length
        ? this.db
            .select({ groupId: posts.groupId, n: sql<number>`count(*)::int` })
            .from(posts)
            .where(
              and(
                inArray(posts.groupId, insideIds),
                isNull(posts.deletedAt),
                eq(posts.status, 'published'),
                eq(posts.moderationState, 'visible'),
                sql`${posts.createdAt} > now() - interval '7 days'`,
              ),
            )
            .groupBy(posts.groupId)
        : Promise.resolve([] as { groupId: string | null; n: number }[]),
      viewer && insideIds.length ? this.connectionsIn(viewer.id, insideIds) : Promise.resolve(new Map<string, MemberRef[]>()),
    ]);
    const weeklyMap = new Map(weekly.map((w) => [w.groupId!, w.n]));
    return rows.map((g) => {
      const a = access.get(g.id)!;
      const page = g.pageId ? pageMap.get(g.pageId) : undefined;
      return {
        id: g.id,
        slug: g.slug,
        name: g.name,
        visibility: g.visibility as GroupVisibility,
        logoUrl: mediaUrl(g.logoFileId),
        tagline: g.tagline,
        coverUrl: mediaUrl(g.coverFileId),
        ownerType: g.ownerType as GroupOwnerType,
        page: page ? PageRefsService.toRef(page) : null,
        chapter: (g.chapterId && chapterRows.get(g.chapterId)) || null,
        country: g.countryCode ? { code: g.countryCode, name: countryRows.get(g.countryCode) ?? g.countryCode } : null,
        memberCount: g.memberCount,
        // Private groups the viewer isn't in: no activity hint and no faces from inside.
        postsThisWeek: a.abilities.seeContent ? (weeklyMap.get(g.id) ?? 0) : null,
        connections: a.abilities.seeContent && viewer ? (connected.get(g.id) ?? []) : null,
        status: g.status as GroupStatus,
        featured: !!g.featuredAt,
        membership: a.membership,
        createdAt: g.createdAt.toISOString(),
      };
    });
  }

  private async chapterRefs(rows: GroupRow[]): Promise<Map<string, ChapterRef>> {
    const ids = [...new Set(rows.map((g) => g.chapterId).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const found = await this.db
      .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
      .from(chapters)
      .where(inArray(chapters.id, ids));
    return new Map(found.map((c) => [c.id, c]));
  }

  private async countryNames(rows: GroupRow[]): Promise<Map<string, string>> {
    const codes = [...new Set(rows.map((g) => g.countryCode).filter((x): x is string => !!x))];
    if (!codes.length) return new Map();
    const found = await this.db.select({ code: countries.code, name: countries.name }).from(countries).where(inArray(countries.code, codes));
    return new Map(found.map((c) => [c.code, c.name]));
  }

  /** Up to 3 active members per group the viewer is connected with (not blocked either way). */
  private async connectionsIn(viewerId: string, groupIds: string[]): Promise<Map<string, MemberRef[]>> {
    const result = await this.db.execute<{ group_id: string; user_id: string }>(sql`
      select group_id, user_id from (
        select gm.group_id, gm.user_id, row_number() over (partition by gm.group_id order by gm.joined_at desc nulls last, gm.user_id) as n
        from ${groupMembers} gm
        join ${connections} c on c.status = 'accepted'
          and least(c.requester_id, c.addressee_id) = least(${viewerId}::uuid, gm.user_id)
          and greatest(c.requester_id, c.addressee_id) = greatest(${viewerId}::uuid, gm.user_id)
        join ${users} u on u.id = gm.user_id and u.status in ('active','unverified')
        where gm.group_id in (${sql.join(groupIds.map((id) => sql`${id}::uuid`), sql`, `)}) and gm.status = 'active' and gm.user_id <> ${viewerId}
      ) t where n <= 3`);
    const blocked = await this.relations.blockedSet(viewerId);
    const rows = result.rows.filter((r) => !blocked.has(r.user_id));
    const refs = await this.members.refs(rows.map((r) => r.user_id));
    const out = new Map<string, MemberRef[]>();
    for (const r of rows) {
      const ref = refs.get(r.user_id);
      if (ref) out.set(r.group_id, [...(out.get(r.group_id) ?? []), ref]);
    }
    return out;
  }

  /* ------------------------------ One group ------------------------------ */

  /**
   * GET /groups/{slug}. Signed-in members open any listed group (private ones show what's listed:
   * name, description, rules, admins, counts; never posts or members). Visitors open public groups.
   */
  async detail(viewer: AuthUser | undefined, idOrSlug: string): Promise<GroupDetail> {
    if (!viewer) {
      const row = await this.findRow(idOrSlug);
      if (!row || row.deletedAt || row.status === 'suspended') throw Errors.notFound('Group');
      if (row.visibility !== 'public') throw Errors.unauthenticated();
    }
    const { row, access } = await this.visibleRow(viewer, idOrSlug);
    return this.toDetail(row, access, viewer);
  }

  async toDetail(row: GroupRow, access: GroupAccess, viewer: AuthUser | undefined): Promise<GroupDetail> {
    const moderates = roleAtLeast(access.role, 'moderator');
    const [[summary], admins, createdBy, pending] = await Promise.all([
      this.summaries([row], viewer),
      this.admins(row.id, viewer?.id),
      row.createdBy ? this.members.ref(row.createdBy) : Promise.resolve(null),
      moderates ? this.pendingCounts(row.id) : Promise.resolve(null),
    ]);
    return {
      ...summary!,
      about: row.about,
      rules: row.rules,
      joinQuestion: row.joinQuestion,
      postPermission: row.postPermission as GroupPostPermission,
      postApproval: row.postApproval,
      hashtags: row.hashtags,
      postCount: row.postCount,
      admins,
      createdBy,
      statusNote: roleAtLeast(access.role, 'admin') || access.staff ? row.statusNote : null,
      pending,
      abilities: access.abilities,
    };
  }

  /** Owner, admins and moderators (listed even for private groups), owner first. */
  private async admins(groupId: string, viewerId: string | undefined): Promise<GroupDetail['admins']> {
    const rows = await this.db
      .select({ userId: groupMembers.userId, role: groupMembers.role })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'active'), inArray(groupMembers.role, ['owner', 'admin', 'moderator'])))
      .orderBy(sql`case ${groupMembers.role} when 'owner' then 0 when 'admin' then 1 else 2 end`, asc(groupMembers.joinedAt))
      .limit(50);
    const blocked = viewerId ? await this.relations.blockedSet(viewerId) : new Set<string>();
    const refs = await this.members.refs(rows.map((r) => r.userId));
    return rows.flatMap((r) => {
      const member = refs.get(r.userId);
      return member && !blocked.has(r.userId) ? [{ member, role: r.role as GroupRole }] : [];
    });
  }

  private async pendingCounts(groupId: string): Promise<{ requests: number; posts: number }> {
    const [[requests], [waiting]] = await Promise.all([
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.status, 'pending'))),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(posts)
        .where(and(eq(posts.groupId, groupId), eq(posts.status, 'in_review'), eq(posts.groupReview, 'pending'), isNull(posts.deletedAt))),
    ]);
    return { requests: requests?.n ?? 0, posts: waiting?.n ?? 0 };
  }

  /* ------------------------------ Create, change, delete ------------------------------ */

  /**
   * POST /groups. Who may create one is a platform setting (everyone, verified members, staff); a member
   * owns up to maxOwnedPerMember member-run groups. Page groups need a live page the member manages;
   * chapter groups need the chapter's team (or staff with chapters.admin). The creator becomes the owner.
   */
  async create(user: AuthUser, input: GroupInput, ip?: string): Promise<GroupDetail> {
    assertNotRestricted(user);
    const policy = await this.policy();
    const verified = user.isStaff || !!(await this.db.select({ v: users.verifiedAt }).from(users).where(eq(users.id, user.id)).limit(1))[0]?.v;
    if (policy.whoCanCreate === 'staff' && !user.isStaff) {
      throw Errors.forbidden('Groups are started by the Charter Mission team for now. Contact us to suggest one.');
    }
    if (policy.whoCanCreate === 'verified' && !verified) throw Errors.forbidden('Only verified members can start groups for now.');
    await this.assertOwner(user, input);
    if (input.ownerType === 'member') {
      const [owned] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(groupMembers)
        .innerJoin(groups, eq(groups.id, groupMembers.groupId))
        .where(and(eq(groupMembers.userId, user.id), eq(groupMembers.role, 'owner'), eq(groups.ownerType, 'member'), isNull(groups.deletedAt)));
      if ((owned?.n ?? 0) >= policy.maxOwnedPerMember) {
        throw Errors.conflict(`You can own up to ${policy.maxOwnedPerMember} groups. Hand one over or delete one first.`);
      }
    }
    await this.assertFiles(user.id, input, null);
    await this.assertCountry(input.countryCode);
    await this.limits.consume(`groups:${user.id}`, GROUPS_PER_DAY, 24 * 3600, `You can start ${GROUPS_PER_DAY} groups a day.`);

    const base = input.slug ?? slugifyGroupName(input.name);
    for (let n = 1; n <= 30; n++) {
      const slug = n === 1 ? base : `${base.slice(0, 56)}-${n}`;
      if (RESERVED_SLUGS.has(slug)) {
        if (input.slug) throw Errors.validation({ slug: 'That address is reserved. Choose another.' });
        continue;
      }
      try {
        const row = await this.db.transaction(async (tx) => {
          const [g] = await tx
            .insert(groups)
            .values({
              slug,
              name: input.name,
              tagline: input.tagline || null,
              about: input.about || null,
              rules: input.rules || null,
              visibility: input.visibility,
              ownerType: input.ownerType,
              pageId: input.ownerType === 'page' ? input.pageId! : null,
              chapterId: input.ownerType === 'chapter' ? input.chapterId! : null,
              postPermission: input.postPermission,
              postApproval: input.postApproval,
              joinQuestion: input.visibility === 'private' ? input.joinQuestion || null : null,
              countryCode: input.countryCode || null,
              logoFileId: input.logoFileId ?? null,
              coverFileId: input.coverFileId ?? null,
              hashtags: cleanHashtags(input.hashtags),
              createdBy: user.id,
            })
            .returning();
          await tx.insert(groupMembers).values({ groupId: g!.id, userId: user.id, role: 'owner', status: 'active', joinedAt: new Date() });
          await syncGroupMemberCount(tx, g!.id);
          return g!;
        });
        await this.audit.record({ actorId: user.id, action: 'group.created', targetType: 'group', targetId: row.id, after: { name: row.name, visibility: row.visibility, ownerType: row.ownerType }, ip });
        return this.detail(user, row.id);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        if (input.slug) throw Errors.validation({ slug: 'That address is taken. Choose another.' });
      }
    }
    throw Errors.conflict('Choose a different group name.');
  }

  /** Page groups: a live page the member manages. Chapter groups: the chapter's team, or staff who run chapters. */
  private async assertOwner(user: AuthUser, input: GroupInput) {
    if (input.ownerType === 'member') {
      if (input.pageId || input.chapterId) throw Errors.validation({ ownerType: 'Choose a page or a chapter to run the group, or run it yourself' });
      return;
    }
    if (input.ownerType === 'page') {
      if (!input.pageId || input.chapterId) throw Errors.validation({ pageId: 'Choose the page that runs the group' });
      const [page, role] = await Promise.all([this.pageRefs.refs([input.pageId]).then((m) => m.get(input.pageId!)), this.pageRefs.role(user.id, input.pageId)]);
      if (!page || !role) throw Errors.forbidden('You can only start a group for a page you manage');
      if (page.status !== 'active') throw Errors.forbidden('This page isn’t live, so it can’t run a group yet.');
      return;
    }
    if (!input.chapterId || input.pageId) throw Errors.validation({ chapterId: 'Choose the chapter that runs the group' });
    const [chapter] = await this.db.select({ id: chapters.id, status: chapters.status }).from(chapters).where(eq(chapters.id, input.chapterId)).limit(1);
    if (!chapter) throw Errors.validation({ chapterId: 'Choose an existing chapter' });
    if (!user.permissions.has('chapters.admin') && !(await isChapterTeam(this.db, chapter.id, user.id))) {
      throw Errors.forbidden('Only the chapter’s team can start a group for it');
    }
  }

  /**
   * PATCH /groups/{slug}: admins change the details and settings; only the owner archives or brings
   * back. Switching between public and private moves the group's existing posts along: a private
   * group's posts are for members only ('group'), a public group's are seen by members ('members').
   */
  async update(user: AuthUser, idOrSlug: string, input: GroupUpdateInput, ip?: string): Promise<GroupDetail> {
    const { row, access } = await this.visibleRow(user, idOrSlug);
    const { archived, ...fields } = input;
    if (Object.keys(fields).length && !access.abilities.manage) throw Errors.forbidden('Only the group’s admins can change it');
    if (archived !== undefined) {
      if (!access.abilities.own) throw Errors.forbidden('Only the group’s owner can archive it or bring it back');
      if (row.status === 'suspended') throw Errors.conflict('This group is suspended by Charter Mission.');
    }
    if (row.status === 'archived' && archived !== false && Object.keys(fields).length) {
      throw Errors.conflict('This group is archived. Bring it back before changing it.');
    }
    await this.assertFiles(user.id, fields, row);
    await this.assertCountry(fields.countryCode);
    const set: Partial<typeof groups.$inferInsert> = {};
    if (fields.name !== undefined) set.name = fields.name;
    if (fields.tagline !== undefined) set.tagline = fields.tagline || null;
    if (fields.about !== undefined) set.about = fields.about || null;
    if (fields.rules !== undefined) set.rules = fields.rules || null;
    if (fields.visibility !== undefined) set.visibility = fields.visibility;
    if (fields.postPermission !== undefined) set.postPermission = fields.postPermission;
    if (fields.postApproval !== undefined) set.postApproval = fields.postApproval;
    if (fields.joinQuestion !== undefined) set.joinQuestion = fields.joinQuestion || null;
    if (fields.countryCode !== undefined) set.countryCode = fields.countryCode || null;
    if (fields.hashtags !== undefined) set.hashtags = cleanHashtags(fields.hashtags);
    if (fields.logoFileId !== undefined) set.logoFileId = fields.logoFileId;
    if (fields.coverFileId !== undefined) set.coverFileId = fields.coverFileId;
    if (archived !== undefined) set.status = archived ? 'archived' : 'active';
    const switched = fields.visibility !== undefined && fields.visibility !== row.visibility ? fields.visibility : null;
    await this.db.transaction(async (tx) => {
      await tx
        .update(groups)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(groups.id, row.id));
      if (switched === 'public') {
        await tx.update(posts).set({ visibility: 'members' }).where(and(eq(posts.groupId, row.id), eq(posts.visibility, 'group')));
      } else if (switched === 'private') {
        await tx.update(posts).set({ visibility: 'group' }).where(and(eq(posts.groupId, row.id), sql`${posts.visibility} <> 'group'`));
      }
      if (switched) await syncGroupPostStats(tx, row.id);
    });
    await this.audit.record({
      actorId: user.id,
      action: archived === true ? 'group.archived' : archived === false ? 'group.restored' : 'group.updated',
      targetType: 'group',
      targetId: row.id,
      after: { fields: Object.keys(input), ...(switched ? { visibility: switched } : {}) },
      ip,
    });
    const fresh = await this.visibleRow(user, row.id);
    return this.toDetail(fresh.row, fresh.access, user);
  }

  /**
   * DELETE /groups/{slug}: the owner, or the page or chapter running it. The group is kept (deleted_at)
   * and so are its posts, but they no longer show anywhere (groupPostsVisibleSql).
   */
  async remove(user: AuthUser, idOrSlug: string, ip?: string): Promise<Ok> {
    const { row, access } = await this.visibleRow(user, idOrSlug);
    if (!access.abilities.own) throw Errors.forbidden('Only the group’s owner can delete it');
    await this.db.update(groups).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(groups.id, row.id));
    await this.audit.record({ actorId: user.id, action: 'group.deleted', targetType: 'group', targetId: row.id, before: { name: row.name, slug: row.slug }, ip });
    return { ok: true };
  }

  /** logoFileId / coverFileId must be the caller's own clean uploads of the right kind (unless unchanged). */
  private async assertFiles(userId: string, input: { logoFileId?: string | null; coverFileId?: string | null }, current: GroupRow | null) {
    const wanted = [
      { id: input.logoFileId, purpose: 'group_logo', field: 'logoFileId', now: current?.logoFileId },
      { id: input.coverFileId, purpose: 'group_cover', field: 'coverFileId', now: current?.coverFileId },
    ].filter((w): w is { id: string; purpose: string; field: string; now: string | null | undefined } => !!w.id && w.id !== w.now);
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
