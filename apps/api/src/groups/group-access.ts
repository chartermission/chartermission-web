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
 *  - Private group content (posts with visibility 'group', the member list) needs an active membership
 *    or one of the above.
 *  - Suspended groups: only their admins and staff open them; archived groups are read-only.
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

/** Does the viewer run this group through the page or chapter that owns it? */
async function runsViaOwner(db: Db, group: GroupRow, userId: string): Promise<boolean> {
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
  const seeContent = !group.deletedAt && (staff || (open && (group.visibility === 'public' || role !== null)) || (group.status === 'suspended' && runs));
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
 * SQL: the post isn't in a group, or its group is open (active or archived) and — for a private
 * group's posts (visibility 'group') — the viewer is an active member, runs it through its page or
 * chapter, or wrote the post. Signed-out viewers never see 'group' posts (callers already require
 * visibility 'public' for them). Used by listablePostsSql for every list of posts.
 */
export function groupPostsVisibleSql(viewerId: string | null): SQL {
  return groupPostsVisibleForSql(viewerId, { groupId: sql`${posts.groupId}`, visibility: sql`${posts.visibility}`, authorId: sql`${posts.authorId}` });
}

/** groupPostsVisibleSql for a posts row under another alias (raw SQL such as `posts p`). */
export function groupPostsVisibleForSql(viewerId: string | null, p: { groupId: SQL; visibility: SQL; authorId: SQL }): SQL {
  if (!viewerId) return openPublicGroupSql(p.groupId);
  return sql`(${p.groupId} is null or exists (select 1 from ${groups} vg where vg.id = ${p.groupId} and vg.deleted_at is null and vg.status in ('active','archived') and (${p.visibility} <> 'group' or ${p.authorId} = ${viewerId} or ${groupMemberSql(viewerId, sql`vg.id`)})))`;
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

/** SQL: the viewer is an active member of the group in `groupIdCol`, or runs it through its page or chapter. */
export function groupMemberSql(viewerId: string, groupIdCol: SQL): SQL {
  return sql`(exists (select 1 from ${groupMembers} vgm where vgm.group_id = ${groupIdCol} and vgm.user_id = ${viewerId} and vgm.status = 'active')
    or exists (select 1 from ${groups} og join ${pageAdmins} opa on opa.page_id = og.page_id where og.id = ${groupIdCol} and og.owner_type = 'page' and opa.user_id = ${viewerId})
    or exists (select 1 from ${groups} oc join ${userRoles} our on our.scope_type = 'chapter' and our.scope_id = oc.chapter_id::text and our.user_id = ${viewerId} and our.revoked_at is null join ${roles} orl on orl.id = our.role_id and orl.key in ('chapter_lead','ambassador') where oc.id = ${groupIdCol} and oc.owner_type = 'chapter'))`;
}

/**
 * For canViewPost: may this viewer see posts of the post's group? Looks the group up; null group = true.
 * Staff with moderation.view always may.
 */
export async function canSeeGroupPost(db: Db, post: { groupId: string | null; visibility: string; authorId: string }, viewer: AuthUser | undefined): Promise<boolean> {
  if (!post.groupId) return true;
  const [group] = await db.select().from(groups).where(eq(groups.id, post.groupId)).limit(1);
  if (!group) return false;
  // Authors always see their own posts in an open group (even after leaving it); nobody but staff sees
  // posts of a suspended group, as in groupPostsVisibleSql.
  if (viewer?.id === post.authorId && !group.deletedAt && group.status !== 'suspended') return true;
  const access = await groupAccess(db, group, viewer);
  return seesGroupPost(post, access);
}

function seesGroupPost(post: { visibility: string }, access: GroupAccess): boolean {
  if (!access.abilities.seeContent) return false;
  // A public group's post marked members-only still needs a signed-in viewer (canViewPost checks that).
  return post.visibility !== 'group' || access.role !== null || access.staff;
}

/**
 * canSeeGroupPost for many posts at once (feeds of embeds, single checks in a loop): the ids of the
 * posts whose group the viewer may see. Posts outside groups are always in the set.
 */
export async function groupVisiblePostIds(
  db: Db,
  rows: { id: string; groupId: string | null; visibility: string; authorId: string }[],
  viewer: AuthUser | undefined,
): Promise<Set<string>> {
  const out = new Set(rows.filter((r) => !r.groupId).map((r) => r.id));
  const groupIds = [...new Set(rows.map((r) => r.groupId).filter((x): x is string => !!x))];
  if (!groupIds.length) return out;
  const groupRows = await db.select().from(groups).where(inArray(groups.id, groupIds));
  const facts = await membershipsFor(db, groupRows, viewer?.id);
  const byId = new Map(groupRows.map((g) => [g.id, g]));
  for (const r of rows) {
    if (!r.groupId) continue;
    const group = byId.get(r.groupId);
    if (!group) continue;
    if (viewer?.id === r.authorId && !group.deletedAt && group.status !== 'suspended') {
      out.add(r.id);
      continue;
    }
    if (seesGroupPost(r, accessFrom(group, viewer, facts.get(group.id)!))) out.add(r.id);
  }
  return out;
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
 * everyone for an open public group's posts; for a private group's posts ('group'), its active members
 * and the people running it. Nobody for posts of suspended or deleted groups.
 */
export async function groupPostAudience(
  db: Db,
  post: { groupId: string | null; visibility: string },
  userIds: string[],
): Promise<Set<string>> {
  if (!post.groupId) return new Set(userIds);
  const [group] = await db.select().from(groups).where(eq(groups.id, post.groupId)).limit(1);
  if (!group || group.deletedAt || (group.status !== 'active' && group.status !== 'archived')) return new Set();
  if (post.visibility !== 'group' || !userIds.length) return new Set(userIds);
  const facts = await Promise.all(
    userIds.map(async (id) => {
      const [hit] = await db.execute<{ ok: boolean }>(sql`select ${groupMemberSql(id, sql`${group.id}::uuid`)} as ok`).then((r) => r.rows);
      return hit?.ok ? id : null;
    }),
  );
  return new Set(facts.filter((x): x is string => !!x));
}
