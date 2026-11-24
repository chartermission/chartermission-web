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
  if (group.ownerType === 'chapter' && group.chapterId) {
    const [row] = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(userRoles.userId, userId),
          inArray(roles.key, [...CHAPTER_TEAM_ROLE_KEYS]),
          eq(userRoles.scopeType, 'chapter'),
          eq(userRoles.scopeId, group.chapterId),
          isNull(userRoles.revokedAt),
        ),
      )
      .limit(1);
    return !!row;
  }
  return false;
}

/** The viewer's access to one group (viewer undefined = signed out). */
export async function groupAccess(db: Db, group: GroupRow, viewer: AuthUser | undefined): Promise<GroupAccess> {
  const staff = !!viewer?.permissions.has('moderation.view');
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
 * SQL: the post isn't in a group, or its group is open (active or archived) and — for a private
 * group's posts (visibility 'group') — the viewer is an active member, runs it through its page or
 * chapter, or wrote the post. Signed-out viewers never see 'group' posts (callers already require
 * visibility 'public' for them). Used by listablePostsSql for every list of posts.
 */
export function groupPostsVisibleSql(viewerId: string | null): SQL {
  if (!viewerId) {
    return sql`(${posts.groupId} is null or exists (select 1 from ${groups} vg where vg.id = ${posts.groupId} and vg.status in ('active','archived') and vg.deleted_at is null and vg.visibility = 'public'))`;
  }
  return sql`(${posts.groupId} is null or exists (select 1 from ${groups} vg where vg.id = ${posts.groupId} and vg.deleted_at is null and vg.status in ('active','archived') and (${posts.visibility} <> 'group' or ${posts.authorId} = ${viewerId} or ${groupMemberSql(viewerId, sql`vg.id`)})))`;
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
  if (viewer?.id === post.authorId && !group.deletedAt) return true;
  const access = await groupAccess(db, group, viewer);
  if (!access.abilities.seeContent) return false;
  // A public group's post marked members-only still needs a signed-in viewer (canViewPost checks that).
  return post.visibility !== 'group' || access.role !== null || access.staff;
}
