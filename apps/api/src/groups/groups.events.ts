import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { groupMembers, groups, pageAdmins, posts, roles, userRoles } from '../db/schema.js';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';
import { CHAPTER_TEAM_ROLE_KEYS } from './group-access.js';

const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
/** Join requests and waiting posts are gathered into one notification per group for a day. */
const GROUPED_MINUTES = 24 * 60;

/** Notifications for groups (from domain events, never inline). */
@Injectable()
export class GroupsEvents implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    private readonly members: MembersService,
  ) {}

  private async group(id: string) {
    const [row] = await this.db.select().from(groups).where(eq(groups.id, id)).limit(1);
    return row && !row.deletedAt ? row : null;
  }

  /** Owner, admins and moderators, and the people running it through its page or chapter. */
  private async moderators(group: typeof groups.$inferSelect): Promise<string[]> {
    const ids = new Set<string>();
    const rows = await this.db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.status, 'active'), inArray(groupMembers.role, ['owner', 'admin', 'moderator'])));
    for (const r of rows) ids.add(r.userId);
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
    // Banned people never hear from the group, whatever else they are.
    const banned = await this.db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.status, 'banned')));
    for (const b of banned) ids.delete(b.userId);
    return [...ids];
  }

  private async actorName(id: string) {
    return (await this.members.ref(id))?.name ?? 'A member';
  }

  onModuleInit() {
    // Someone asked to join a private group: its moderators, one notification per group a day.
    this.events.on('group.join_requested', async (e) => {
      const group = await this.group(e.groupId);
      if (!group || group.status !== 'active') return;
      const [request] = await this.db
        .select({ status: groupMembers.status })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, e.userId)))
        .limit(1);
      if (request?.status !== 'pending') return;
      const name = await this.actorName(e.userId);
      for (const userId of await this.moderators(group)) {
        await this.notify.notify({
          userId,
          type: 'group_join_request',
          actorId: e.userId,
          objectType: 'group',
          objectId: group.id,
          segments: [
            { text: ' asked to join ', strong: false },
            { text: group.name, strong: true },
          ],
          href: `/groups/${group.slug}`,
          icon: 'users',
          dedupeKey: `group_join_request:${group.id}`,
          windowMinutes: GROUPED_MINUTES,
          email: {
            subject: `${name} asked to join ${group.name}`,
            heading: `${name} asked to join ${group.name}`,
            paragraphs: [`${name} would like to join ${group.name} on Charter Mission. You can approve or decline the request from the group’s members list.`],
            buttonLabel: 'Review requests',
          },
        });
      }
    });

    this.events.on('group.invited', async (e) => {
      const group = await this.group(e.groupId);
      if (!group || group.status !== 'active') return;
      const name = await this.actorName(e.inviterId);
      const still = await this.db
        .select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, group.id), inArray(groupMembers.userId, e.userIds), eq(groupMembers.status, 'invited')));
      for (const { userId } of still) {
        await this.notify.notify({
          userId,
          type: 'group_invitation',
          actorId: e.inviterId,
          objectType: 'group',
          objectId: group.id,
          segments: [
            { text: ' invited you to join ', strong: false },
            { text: group.name, strong: true },
          ],
          href: `/groups/${group.slug}`,
          icon: 'users',
          dedupeKey: `group_invitation:${group.id}:${userId}`,
          email: {
            subject: `${name} invited you to join ${group.name}`,
            heading: `Join ${group.name}`,
            paragraphs: [
              `${name} invited you to join ${group.name} on Charter Mission.`,
              ...(group.tagline ? [group.tagline] : []),
              'Open the group to accept the invitation, or ignore it.',
            ],
            buttonLabel: 'Open the group',
          },
        });
      }
    });

    this.events.on('group.request_approved', async (e) => {
      const group = await this.group(e.groupId);
      if (!group) return;
      await this.notify.notify({
        userId: e.userId,
        type: 'group_request_approved',
        objectType: 'group',
        objectId: group.id,
        segments: [
          { text: 'You’re in. Your request to join ', strong: false },
          { text: group.name, strong: true },
          { text: ' was approved', strong: false },
        ],
        href: `/groups/${group.slug}`,
        icon: 'check',
        dedupeKey: `group_request_approved:${group.id}:${e.userId}`,
        email: {
          subject: `You’re in ${group.name}`,
          heading: `Welcome to ${group.name}`,
          paragraphs: [`Your request to join ${group.name} on Charter Mission was approved. Its posts now show in your feed.`],
          buttonLabel: 'Open the group',
        },
      });
    });

    // A member's post waits for approval: the group's moderators (not the author), one notification per group a day.
    this.events.on('group.post_pending', async (e) => {
      const group = await this.group(e.groupId);
      if (!group) return;
      const name = await this.actorName(e.authorId);
      for (const userId of (await this.moderators(group)).filter((id) => id !== e.authorId)) {
        await this.notify.notify({
          userId,
          type: 'group_post_pending',
          actorId: e.authorId,
          objectType: 'group',
          objectId: group.id,
          segments: [
            { text: ' posted in ', strong: false },
            { text: group.name, strong: true },
            { text: '. Waiting for your approval.', strong: false },
          ],
          href: `/groups/${group.slug}`,
          icon: 'clock',
          dedupeKey: `group_post_pending:${group.id}`,
          windowMinutes: GROUPED_MINUTES,
          email: {
            subject: `A post in ${group.name} is waiting for approval`,
            heading: `A post in ${group.name} is waiting`,
            paragraphs: [`${name} posted in ${group.name}. Members will see it once a moderator approves it.`],
            buttonLabel: 'Review posts',
          },
        });
      }
    });

    // A moderator approved, declined or removed a post: tell its author, with the note.
    this.events.on('group.post_reviewed', async (e) => {
      const [post] = await this.db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, e.postId)).limit(1);
      if (!post || post.authorId === e.actorId) return;
      const group = await this.group(e.groupId);
      if (!group) return;
      const note = e.note?.trim();
      const copy = {
        approve: { lead: 'Your post was approved and is now live in ', subject: `Your post is live in ${group.name}` },
        decline: { lead: 'Your post wasn’t approved for ', subject: `Your post wasn’t approved for ${group.name}` },
        remove: { lead: 'Your post was removed from ', subject: `Your post was removed from ${group.name}` },
      }[e.action];
      const good = e.action === 'approve';
      await this.notify.notify({
        userId: post.authorId,
        type: 'group_post_review',
        objectType: 'post',
        objectId: e.postId,
        segments: [
          { text: copy.lead, strong: false },
          { text: group.name, strong: true },
          { text: !good && note ? `: “${clip(note)}”` : '', strong: false },
        ],
        href: e.action === 'remove' ? `/groups/${group.slug}` : `/posts/${e.postId}`,
        icon: good ? 'check' : 'alert',
        dedupeKey: `group_post_review:${e.postId}:${e.action}`,
        email: {
          subject: copy.subject,
          heading: copy.subject,
          paragraphs: [
            good
              ? `A moderator of ${group.name} approved your post. Members of the group can now see it.`
              : e.action === 'decline'
                ? `A moderator of ${group.name} decided your post doesn’t belong in the group. Only you can still see it.`
                : `A moderator of ${group.name} removed your post from the group.`,
            ...(!good && note ? [`Their note: “${note}”`] : []),
          ],
          buttonLabel: e.action === 'remove' ? 'Open the group' : 'Open your post',
        },
      });
    });

    this.events.on('group.role_changed', async (e) => {
      const group = await this.group(e.groupId);
      if (!group) return;
      const what = e.role === 'owner' ? 'the owner' : e.role === 'admin' ? 'an admin' : 'a moderator';
      await this.notify.notify({
        userId: e.userId,
        type: 'group_role_changed',
        objectType: 'group',
        objectId: group.id,
        segments: [
          { text: `You are now ${what} of `, strong: false },
          { text: group.name, strong: true },
        ],
        href: `/groups/${group.slug}`,
        icon: 'shield',
        dedupeKey: `group_role_changed:${group.id}:${e.userId}:${e.role}`,
        email: {
          subject: `You are now ${what} of ${group.name}`,
          heading: `You are now ${what} of ${group.name}`,
          paragraphs: [
            e.role === 'moderator'
              ? `You can now approve join requests and posts in ${group.name}, and remove posts that break its rules.`
              : `You can now manage ${group.name}: its members, roles and settings.`,
          ],
          buttonLabel: 'Open the group',
        },
      });
    });
  }
}
