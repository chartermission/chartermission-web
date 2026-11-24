import type { GroupAbilities, GroupMembership, GroupRole } from '@chartermission/contracts';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { AuthUser } from '../core/auth-context.js';
import type { Db } from '../db/db.module.js';
import { groupMembers, groups, pageAdmins, posts, roles, userRoles } from '../db/schema.js';

/*
 * Who may see and do what in a group. The single place these rules live: the groups API, the post
 * pipeline (canViewPost, listablePostsSql) and the admin console all use it.
 *
 *  - Staff with moderation.view see every group's content (read only through the member site; they act
 *    through the admin console).
 *  - Page groups: the page's admins run the group as admins ("via owner"). Chapter groups: the
 *    chapter's team (chapter lead, ambassadors) likewise.
 *  - Private group content (its posts, the member list) needs an active membership or one of the above;
 *    lists follow the GROUP's visibility, not the post's. Leaving, removal and bans end access: a former
 *    member can still open their own post alone, read-only (to delete it), and nothing else.
 *  - A ban row wins over everything else: banned people never run, see or join the group.
 *  - Banned people in a public group still read its posts but can't take part.
 *  - Suspended groups: their page opens for their admins (to read the team's note) and staff, but
 *    their posts are seen by staff only; archived groups are read-only.
 */

export type GroupRow = typeof groups.$inferSelect;

const RANK: Record<GroupRole, number> = { owner: 3, admin: 2, moderator: 1, member: 0 };

/** At least this role. */
export const roleAtLeast = (role: GroupRole | null, min: GroupRole) => role !== null && RANK[role] >= RANK[min];

/** Chapter team roles that run a chapter's groups. */
export const CHAPTER_TEAM_ROLE_KEYS = ['chapter_lead', 'ambassador'] as const;

export type GroupAccess = {
  membership: GroupMembership;
  /** Effective role: the membership role, or 'admin' via the owning page/chapter (whichever is higher). */
  role: GroupRole | null;
  /** Staff who may look at any group (moderation.view). */
  staff: boolean;
  abilities: GroupAbilities;
};

/** Is the member on the chapter's team (chapter lead or ambassador scoped to it)? */
export async function isChapterTeam(db: Db, chapterId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(userRoles.userId, userId),
        inArray(roles.key, [...CHAPTER_TEAM_ROLE_KEYS]),
        eq(userRoles.scopeType, 'chapter'),
        eq(userRoles.scopeId, chapterId),
        isNull(userRoles.revokedAt),
      ),
    )
    .limit(1);
  return !!row;
}

/** Does the viewer run this group through the page or chapter that owns it? (Ignores bans.) */
export async function runsViaOwner(db: Db, group: GroupRow, userId: string): Promise<boolean> {
  if (group.ownerType === 'page' && group.pageId) {
    const [row] = await db
      .select({ userId: pageAdmins.userId })
      .from(pageAdmins)
      .where(and(eq(pageAdmins.pageId, group.pageId), eq(pageAdmins.userId, userId)))
      .limit(1);
    return !!row;
  }
  if (group.ownerType === 'chapter' && group.chapterId) return isChapterTeam(db, group.chapterId, userId);
  return false;
}

/** The viewer's access to one group (viewer undefined = signed out). */
export async function groupAccess(db: Db, group: GroupRow, viewer: AuthUser | undefined): Promise<GroupAccess> {
  let status: GroupMembership['status'] = 'none';
  let memberRole: GroupRole | null = null;
  let viaOwner = false;
  if (viewer) {
    const [row] = await db
      .select({ role: groupMembers.role, status: groupMembers.status })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, viewer.id)))
      .limit(1);
    if (row) {
      status = row.status as GroupMembership['status'];
      if (row.status === 'active') memberRole = row.role as GroupRole;
    }
    viaOwner = status !== 'banned' && (await runsViaOwner(db, group, viewer.id));
  }
  return accessFrom(group, viewer, { status, memberRole, viaOwner });
}

/**
 * The same rules as groupAccess, from what the caller already loaded (lists of groups load the
 * viewer's memberships and page/chapter roles in bulk). `memberRole` is the role of an active
 * membership only; `viaOwner` is ignored for banned members.
 */
export function accessFrom(
  group: GroupRow,
  viewer: AuthUser | undefined,
  m: { status: GroupMembership['status']; memberRole: GroupRole | null; viaOwner: boolean },
): GroupAccess {
  const staff = !!viewer?.permissions.has('moderation.view');
  const status = viewer ? m.status : 'none';
  const memberRole = viewer && status === 'active' ? m.memberRole : null;
  const viaOwner = !!viewer && status !== 'banned' && m.viaOwner;
  const role: GroupRole | null = viaOwner && !roleAtLeast(memberRole, 'admin') ? 'admin' : memberRole;
  const active = group.status === 'active' && !group.deletedAt;
  const open = active || group.status === 'archived';
  const runs = roleAtLeast(role, 'admin');
  // Suspended groups: the page opens for its admins (visibleRow), but the content is for staff only.
  const seeContent = !group.deletedAt && (staff || (open && (group.visibility === 'public' || role !== null)));
  const joinable = active && !!viewer && status !== 'banned' && role === null;
  const abilities: GroupAbilities = {
    seeContent,
    post: active && role !== null && (group.postPermission === 'members' || roleAtLeast(role, 'moderator')),
    join: !joinable ? 'none' : status === 'invited' ? 'accept' : status === 'pending' ? 'none' : group.visibility === 'public' ? 'join' : 'ask',
    leave: memberRole !== null && memberRole !== 'owner',
    invite: active && role !== null && (group.visibility === 'public' || roleAtLeast(role, 'moderator')),
    moderate: active && roleAtLeast(role, 'moderator'),
    manage: !group.deletedAt && group.status !== 'suspended' && runs,
    own: !group.deletedAt && (memberRole === 'owner' || (viaOwner && group.ownerType !== 'member')),
  };
  return { membership: { status, role, viaOwner }, role, staff, abilities };
}

/**
 * The viewer's membership facts for many groups at once (for accessFrom): their group_members rows,
 * and which of these groups they run through the owning page or chapter.
 */
export async function membershipsFor(
  db: Db,
  rows: GroupRow[],
  viewerId: string | undefined,
): Promise<Map<string, { status: GroupMembership['status']; memberRole: GroupRole | null; viaOwner: boolean }>> {
  const out = new Map<string, { status: GroupMembership['status']; memberRole: GroupRole | null; viaOwner: boolean }>();
  for (const g of rows) out.set(g.id, { status: 'none', memberRole: null, viaOwner: false });
  if (!viewerId || !rows.length) return out;
  const pageIds = [...new Set(rows.map((g) => g.pageId).filter((x): x is string => !!x))];
  const chapterIds = [...new Set(rows.map((g) => g.chapterId).filter((x): x is string => !!x))];
  const [members, pageRows, chapterRows] = await Promise.all([
    db
      .select({ groupId: groupMembers.groupId, role: groupMembers.role, status: groupMembers.status })
      .from(groupMembers)
      .where(and(eq(groupMembers.userId, viewerId), inArray(groupMembers.groupId, rows.map((g) => g.id)))),
    pageIds.length
      ? db
          .select({ pageId: pageAdmins.pageId })
          .from(pageAdmins)
          .where(and(eq(pageAdmins.userId, viewerId), inArray(pageAdmins.pageId, pageIds)))
      : Promise.resolve([] as { pageId: string }[]),
    chapterIds.length
      ? db
          .select({ chapterId: userRoles.scopeId })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(
            and(
              eq(userRoles.userId, viewerId),
              inArray(roles.key, [...CHAPTER_TEAM_ROLE_KEYS]),
              eq(userRoles.scopeType, 'chapter'),
              inArray(userRoles.scopeId, chapterIds),
              isNull(userRoles.revokedAt),
            ),
          )
      : Promise.resolve([] as { chapterId: string | null }[]),
  ]);
  const pagesRun = new Set(pageRows.map((r) => r.pageId));
  const chaptersRun = new Set(chapterRows.map((r) => r.chapterId));
  for (const g of rows) {
    const m = members.find((r) => r.groupId === g.id);
    const status = (m?.status ?? 'none') as GroupMembership['status'];
    out.set(g.id, {
      status,
      memberRole: m && m.status === 'active' ? (m.role as GroupRole) : null,
      viaOwner: (g.ownerType === 'page' && !!g.pageId && pagesRun.has(g.pageId)) || (g.ownerType === 'chapter' && !!g.chapterId && chaptersRun.has(g.chapterId)),
    });
  }
  return out;
}

/**
 * SQL: the post isn't in a group, or its group is open (active or archived) and the viewer may see
 * its posts. The GROUP's visibility decides, not the post's: a public group's posts follow their own
 * visibility (callers check it); a private group's posts are for its active members and the people
 * running it (not banned) only. Authors who left get nothing here: lists never show them a private
 * group's posts. Signed-out viewers see open public groups only (and callers require visibility
 * 'public' for them). Used by listablePostsSql for every list of posts.
 */
export function groupPostsVisibleSql(viewerId: string | null): SQL {
  return groupPostsVisibleForSql(viewerId, { groupId: sql`${posts.groupId}`, visibility: sql`${posts.visibility}` });
}

/** groupPostsVisibleSql for a posts row under another alias (raw SQL such as `posts p`). */
export function groupPostsVisibleForSql(viewerId: string | null, p: { groupId: SQL; visibility: SQL }): SQL {
  if (!viewerId) return openPublicGroupSql(p.groupId);
  return sql`(${p.groupId} is null or exists (select 1 from ${groups} vg where vg.id = ${p.groupId} and vg.deleted_at is null and vg.status in ('active','archived')
    and ((vg.visibility = 'public' and ${p.visibility} <> 'group') or ${groupMemberSql(viewerId, sql`vg.id`)})))`;
}

/**
 * SQL: the post (its group id in `groupIdCol`) isn't in a group, or its group is a public one that is
 * open (active or archived, not deleted). For what anyone may learn without being a member: link
 * previews, guest media, counts and topic lists shown to every member, trending.
 */
export function openPublicGroupSql(groupIdCol: SQL): SQL {
  return sql`(${groupIdCol} is null or exists (select 1 from ${groups} vg where vg.id = ${groupIdCol} and vg.status in ('active','archived') and vg.deleted_at is null and vg.visibility = 'public'))`;
}

/**
 * Home feed rule: a group's posts reach the home feed (tabs, new-post counts) only of the group's
 * active members and the people running it — public groups included. Everyone else still meets public
 * group posts on the author's profile, topic pages and search.
 */
export function homeFeedGroupSql(viewerId: string): SQL {
  return sql`(${posts.groupId} is null or ${groupMemberSql(viewerId, sql`${posts.groupId}`)})`;
}

/**
 * SQL: the viewer is an active member of the group in `groupIdCol`, or runs it through its page or
 * chapter and isn't banned from it (a ban row wins, whoever they are).
 */
export function groupMemberSql(viewerId: string, groupIdCol: SQL): SQL {
  return sql`(exists (select 1 from ${groupMembers} vgm where vgm.group_id = ${groupIdCol} and vgm.user_id = ${viewerId} and vgm.status = 'active')
    or (not exists (select 1 from ${groupMembers} vgb where vgb.group_id = ${groupIdCol} and vgb.user_id = ${viewerId} and vgb.status = 'banned')
      and (exists (select 1 from ${groups} og join ${pageAdmins} opa on opa.page_id = og.page_id where og.id = ${groupIdCol} and og.owner_type = 'page' and opa.user_id = ${viewerId})
        or exists (select 1 from ${groups} oc join ${userRoles} our on our.scope_type = 'chapter' and our.scope_id = oc.chapter_id::text and our.user_id = ${viewerId} and our.revoked_at is null join ${roles} orl on orl.id = our.role_id and orl.key in ('chapter_lead','ambassador') where oc.id = ${groupIdCol} and oc.owner_type = 'chapter'))))`;
}

/**
 * How far the viewer may go with one group post:
 *  - 'full': read it and its conversation, comment, react, vote, repost, offer help (archived groups
 *    are still read-only: PostsService.findVisible checks that);
 *  - 'banned': banned from the (public) group: read the post and its conversation, take no part;
 *  - 'staff': staff with moderation.view who aren't in it: read only (they act in the admin console);
 *  - 'own': the author's own post in a private group they are no longer in (left, removed, banned):
 *    the post alone, read-only, so they can delete it — no conversation, reactions or counts;
 *  - 'none': nothing (404).
 * Suspended and deleted groups' posts are for staff only, whoever wrote them.
 */
export type GroupPostLevel = 'full' | 'banned' | 'staff' | 'own' | 'none';

type GroupPostFacts = { groupId: string | null; visibility: string; authorId: string };

function levelFrom(post: GroupPostFacts, group: GroupRow | undefined, viewer: AuthUser | undefined, access: GroupAccess | null): GroupPostLevel {
  const staff = !!viewer?.permissions.has('moderation.view');
  if (!group || group.deletedAt || (group.status !== 'active' && group.status !== 'archived') || !access) return staff ? 'staff' : 'none';
  const banned = access.membership.status === 'banned';
  if (group.visibility === 'public' && post.visibility !== 'group') {
    if (banned) return 'banned';
    return 'full';
  }
  // A private group (or a members-only post of a public one).
  if (access.role !== null) return 'full';
  if (staff) return 'staff';
  if (viewer && viewer.id === post.authorId) return 'own';
  return 'none';
}

/** The viewer's level for one group post (posts outside groups are 'full'). */
export async function groupPostLevel(db: Db, post: GroupPostFacts, viewer: AuthUser | undefined): Promise<GroupPostLevel> {
  if (!post.groupId) return 'full';
  const [group] = await db.select().from(groups).where(eq(groups.id, post.groupId)).limit(1);
  const open = group && !group.deletedAt && (group.status === 'active' || group.status === 'archived');
  const access = open ? await groupAccess(db, group, viewer) : null;
  return levelFrom(post, group, viewer, access);
}

/** For canViewPost: may this viewer open the post at all (any level but 'none')? */
export async function canSeeGroupPost(db: Db, post: GroupPostFacts, viewer: AuthUser | undefined): Promise<boolean> {
  return (await groupPostLevel(db, post, viewer)) !== 'none';
}

/**
 * For many posts at once (embedded reposts, media checks): the ids of the posts whose group lets the
 * viewer see them in a list or embed. Posts outside groups are always in the set; an author's own post
 * in a group they left is not (lists never show it).
 */
export async function groupVisiblePostIds(db: Db, rows: (GroupPostFacts & { id: string })[], viewer: AuthUser | undefined): Promise<Set<string>> {
  const out = new Set(rows.filter((r) => !r.groupId).map((r) => r.id));
  const groupIds = [...new Set(rows.map((r) => r.groupId).filter((x): x is string => !!x))];
  if (!groupIds.length) return out;
  const groupRows = await db.select().from(groups).where(inArray(groups.id, groupIds));
  const facts = await membershipsFor(db, groupRows, viewer?.id);
  const byId = new Map(groupRows.map((g) => [g.id, g]));
  for (const r of rows) {
    if (!r.groupId) continue;
    const group = byId.get(r.groupId);
    const access = group ? accessFrom(group, viewer, facts.get(group.id)!) : null;
    const level = levelFrom(r, group, viewer, access);
    if (level !== 'none' && level !== 'own') out.add(r.id);
  }
  return out;
}

/**
 * Rank of a person in a group, for "only people of lower rank" rules: the owner and the people running
 * it through its page or chapter 3, admins 2, moderators 1, members 0; anyone else (left, banned) -1.
 */
export async function rankInGroup(db: Db, group: GroupRow, userId: string): Promise<number> {
  const [row] = await db
    .select({ role: groupMembers.role, status: groupMembers.status })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, userId)))
    .limit(1);
  if (row?.status === 'banned') return -1;
  if (await runsViaOwner(db, group, userId)) return RANK.owner;
  return row?.status === 'active' ? RANK[row.role as GroupRole] : -1;
}

/**
 * Keeps groups.post_count and last_post_at right: published, visible, not deleted posts in the group.
 * Recounted rather than incremented, so publishing, approving, deleting and removing can never drift.
 */
export async function syncGroupPostStats(db: Pick<Db, 'execute'>, groupId: string | null | undefined): Promise<void> {
  if (!groupId) return;
  await db.execute(sql`update ${groups} set
      post_count = (select count(*)::int from ${posts} gp where gp.group_id = ${groupId} and gp.deleted_at is null and gp.status = 'published' and gp.moderation_state = 'visible'),
      last_post_at = (select max(gp.created_at) from ${posts} gp where gp.group_id = ${groupId} and gp.deleted_at is null and gp.status = 'published' and gp.moderation_state = 'visible'),
      updated_at = now()
    where id = ${groupId}`);
}

/** Keeps groups.member_count right (active members only). Call inside the transaction that changed memberships. */
export async function syncGroupMemberCount(db: Pick<Db, 'execute'>, groupId: string): Promise<void> {
  await db.execute(
    sql`update ${groups} set member_count = (select count(*)::int from ${groupMembers} cm where cm.group_id = ${groupId} and cm.status = 'active'), updated_at = now() where id = ${groupId}`,
  );
}

/**
 * Of these members, the ones who may see a group post (for notifications about it, such as mentions):
 * everyone for an open public group's posts; for a private group's posts, its active members and the
 * people running it (not banned). Nobody for posts of suspended or deleted groups.
 */
export async function groupPostAudience(
  db: Db,
  post: { groupId: string | null; visibility: string },
  userIds: string[],
): Promise<Set<string>> {
  if (!post.groupId) return new Set(userIds);
  const [group] = await db.select().from(groups).where(eq(groups.id, post.groupId)).limit(1);
  if (!group || group.deletedAt || (group.status !== 'active' && group.status !== 'archived')) return new Set();
  if (!userIds.length) return new Set();
  // A private group's posts (whatever the post row says): its members and the people running it only.
  if (group.visibility === 'public' && post.visibility !== 'group') return new Set(userIds);
  const facts = await Promise.all(
    userIds.map(async (id) => {
      const [hit] = await db.execute<{ ok: boolean }>(sql`select ${groupMemberSql(id, sql`${group.id}::uuid`)} as ok`).then((r) => r.rows);
      return hit?.ok ? id : null;
    }),
  );
  return new Set(facts.filter((x): x is string => !!x));
}
