import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { ReportTargetType } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { comments, conversationMembers, hashtags, memberProfiles, messages, opportunities, posts, stories, trendingOverrides, userRoles, roles, users } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from '../core/auth-context.js';
import { PRIVILEGED_ROLES } from '../core/permissions.js';
import { isUuid, truncate } from './util.js';

export type ContentState = 'visible' | 'hidden' | 'removed' | 'deleted';

/** A reported or actioned thing, normalised across the four target types. */
export interface ResolvedTarget {
  type: ReportTargetType;
  /** Canonical id: post/comment/user UUID, or the lower-cased hashtag. */
  id: string;
  /** Content author or the member themself; null for hashtags. */
  userId: string | null;
  /** Content state; for members the account state is used instead (null); hashtags: hidden while suppressed. */
  state: ContentState | null;
  /** Post or comment is published and visible to members (not deleted, hidden or removed). */
  visibleToMembers: boolean;
  hashtagId: string | null;
  /** For comments: the post they belong to. */
  postId: string | null;
  body: string | null;
  createdAt: Date | null;
  preview: string;
  href: string;
  /** For messages: the two members of the conversation (only they can report it). */
  participants?: string[];
}

export const targetKey = (type: string, id: string) => `${type}:${id}`;

export function hrefFor(
  type: ReportTargetType,
  id: string,
  extra: { postId?: string | null; handle?: string | null; tag?: string | null; slug?: string | null },
) {
  switch (type) {
    case 'post':
      return `/posts/${id}`;
    case 'comment':
      return `/posts/${extra.postId}#comment-${id}`;
    case 'member':
      return `/${extra.handle ?? id}`;
    case 'hashtag':
      return `/topics/${extra.tag ?? id}`;
    case 'story':
      return `/stories/${id}`;
    case 'opportunity':
      return `/opportunities/${extra.slug ?? id}`;
    case 'message':
      // Conversations are private; the console links to the sender instead.
      return `/${extra.handle ?? id}`;
  }
}

/** Privilege rank: 0 member, 1 moderator, 2 platform admin, 3 super admin (spec 4.17). */
export function rankOf(roleKeys: Iterable<string>): number {
  let rank = 0;
  for (const k of roleKeys) rank = Math.max(rank, PRIVILEGED_ROLES.indexOf(k) + 1);
  return rank;
}

/**
 * Looks up report and moderation targets and builds their previews and links.
 * Shared by the member (reports, appeals) and admin (queue, actions) sides.
 */
@Injectable()
export class TargetsService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Resolve a target or throw 404. Members can be given by id or handle; hashtags by tag (with or without #). */
  async resolve(type: ReportTargetType, rawId: string): Promise<ResolvedTarget> {
    switch (type) {
      case 'post': {
        if (!isUuid(rawId)) throw Errors.notFound('That post');
        const [p] = await this.db.select().from(posts).where(eq(posts.id, rawId)).limit(1);
        if (!p) throw Errors.notFound('That post');
        const state: ContentState = p.deletedAt ? 'deleted' : (p.moderationState as ContentState);
        return {
          type,
          id: p.id,
          userId: p.authorId,
          state,
          visibleToMembers: state === 'visible' && p.status === 'published',
          hashtagId: null,
          postId: p.id,
          body: p.body,
          createdAt: p.createdAt,
          preview: truncate(p.body) || 'Post',
          href: hrefFor('post', p.id, {}),
        };
      }
      case 'comment': {
        if (!isUuid(rawId)) throw Errors.notFound('That comment');
        const [row] = await this.db
          .select({
            c: comments,
            postDeleted: posts.deletedAt,
            postState: posts.moderationState,
            postStatus: posts.status,
          })
          .from(comments)
          .innerJoin(posts, eq(posts.id, comments.postId))
          .where(eq(comments.id, rawId))
          .limit(1);
        if (!row) throw Errors.notFound('That comment');
        const c = row.c;
        const state: ContentState = c.deletedAt ? 'deleted' : (c.moderationState as ContentState);
        const postVisible = !row.postDeleted && row.postState === 'visible' && row.postStatus === 'published';
        return {
          type,
          id: c.id,
          userId: c.authorId,
          state,
          visibleToMembers: state === 'visible' && postVisible,
          hashtagId: null,
          postId: c.postId,
          body: c.body,
          createdAt: c.createdAt,
          preview: truncate(c.body) || 'Comment',
          href: hrefFor('comment', c.id, { postId: c.postId }),
        };
      }
      case 'member': {
        const handle = rawId.replace(/^@/, '');
        const cond = isUuid(rawId)
          ? eq(users.id, rawId)
          : eq(sql`lower(${memberProfiles.handle})`, handle.toLowerCase());
        const [m] = await this.db
          .select({
            id: users.id,
            status: users.status,
            createdAt: users.createdAt,
            handle: memberProfiles.handle,
            name: memberProfiles.displayName,
            headline: memberProfiles.headline,
            bio: memberProfiles.bio,
          })
          .from(users)
          .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
          .where(cond)
          .limit(1);
        if (!m || m.status === 'deleted') throw Errors.notFound('That member');
        return {
          type,
          id: m.id,
          userId: m.id,
          state: null,
          visibleToMembers: m.status !== 'deletion_pending',
          hashtagId: null,
          postId: null,
          body: m.bio ?? m.headline ?? null,
          createdAt: m.createdAt,
          preview: m.name,
          href: hrefFor('member', m.id, { handle: m.handle }),
        };
      }
      case 'story': {
        if (!isUuid(rawId)) throw Errors.notFound('That story');
        const [st] = await this.db.select().from(stories).where(eq(stories.id, rawId)).limit(1);
        if (!st) throw Errors.notFound('That story');
        const state: ContentState = st.deletedAt ? 'deleted' : (st.moderationState as ContentState);
        return {
          type,
          id: st.id,
          userId: st.authorId,
          state,
          visibleToMembers: state === 'visible',
          hashtagId: null,
          postId: null,
          body: st.caption,
          createdAt: st.createdAt,
          preview: truncate(st.caption ?? '') || 'Story',
          href: hrefFor('story', st.id, {}),
        };
      }
      case 'opportunity': {
        if (!isUuid(rawId)) throw Errors.notFound('That opportunity');
        const [o] = await this.db.select().from(opportunities).where(eq(opportunities.id, rawId)).limit(1);
        if (!o) throw Errors.notFound('That opportunity');
        const state: ContentState = o.deletedAt ? 'deleted' : (o.moderationState as ContentState);
        return {
          type,
          id: o.id,
          userId: o.posterId,
          state,
          visibleToMembers: state === 'visible',
          hashtagId: null,
          postId: null,
          body: `${o.title} · ${o.organisation}\n\n${o.summary}\n\n${o.description}`,
          createdAt: o.createdAt,
          preview: truncate(`${o.title} · ${o.organisation}`),
          href: hrefFor('opportunity', o.id, { slug: o.slug }),
        };
      }
      case 'message': {
        if (!isUuid(rawId)) throw Errors.notFound('That message');
        const [row] = await this.db
          .select({ m: messages, handle: memberProfiles.handle })
          .from(messages)
          .leftJoin(memberProfiles, eq(memberProfiles.userId, messages.senderId))
          .where(eq(messages.id, rawId))
          .limit(1);
        if (!row) throw Errors.notFound('That message');
        // Anyone who was in the conversation may report a message in it.
        const people = await this.db
          .select({ userId: conversationMembers.userId })
          .from(conversationMembers)
          .where(eq(conversationMembers.conversationId, row.m.conversationId));
        const m = row.m;
        const state: ContentState = m.deletedAt ? 'deleted' : (m.moderationState as ContentState);
        return {
          type,
          id: m.id,
          userId: m.senderId,
          state,
          visibleToMembers: state === 'visible',
          hashtagId: null,
          postId: null,
          body: m.body,
          createdAt: m.createdAt,
          preview: truncate(m.body) || 'Message',
          href: hrefFor('message', m.id, { handle: row.handle }),
          participants: people.map((p) => p.userId),
        };
      }
      case 'hashtag': {
        const tag = rawId.replace(/^#/, '').toLowerCase();
        const [h] = await this.db.select().from(hashtags).where(eq(hashtags.tag, tag)).limit(1);
        if (!h) throw Errors.notFound('That topic');
        const suppressed = await this.activeSuppression(h.id);
        return {
          type,
          id: h.tag,
          userId: null,
          state: suppressed ? 'hidden' : 'visible',
          visibleToMembers: true,
          hashtagId: h.id,
          postId: null,
          body: h.description,
          createdAt: h.createdAt,
          preview: `#${h.display}`,
          href: hrefFor('hashtag', h.tag, { tag: h.tag }),
        };
      }
    }
  }

  /** The active global suppression of a hashtag, if any. */
  async activeSuppression(hashtagId: string) {
    const [row] = await this.db
      .select()
      .from(trendingOverrides)
      .where(
        and(
          eq(trendingOverrides.hashtagId, hashtagId),
          eq(trendingOverrides.action, 'suppress'),
          eq(trendingOverrides.scopeType, 'global'),
          isNull(trendingOverrides.revokedAt),
          or(isNull(trendingOverrides.expiresAt), gt(trendingOverrides.expiresAt, new Date())),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Previews, owners and links for many targets at once (queue, hidden list, appeals). */
  async previews(targets: { type: string; id: string }[]) {
    const out = new Map<string, { preview: string; userId: string | null; href: string; postId: string | null }>();
    const ids = (t: string) => [...new Set(targets.filter((x) => x.type === t).map((x) => x.id))];
    const postIds = ids('post').filter(isUuid);
    const commentIds = ids('comment').filter(isUuid);
    const memberIds = ids('member').filter(isUuid);
    const tags = ids('hashtag');
    const opportunityIds = ids('opportunity').filter(isUuid);
    if (opportunityIds.length) {
      const rows = await this.db
        .select({ id: opportunities.id, title: opportunities.title, organisation: opportunities.organisation, posterId: opportunities.posterId, slug: opportunities.slug })
        .from(opportunities)
        .where(inArray(opportunities.id, opportunityIds));
      for (const r of rows)
        out.set(targetKey('opportunity', r.id), {
          preview: truncate(`${r.title} · ${r.organisation}`),
          userId: r.posterId,
          href: hrefFor('opportunity', r.id, { slug: r.slug }),
          postId: null,
        });
    }
    const messageIds = ids('message').filter(isUuid);
    if (messageIds.length) {
      const rows = await this.db
        .select({ id: messages.id, body: messages.body, senderId: messages.senderId, handle: memberProfiles.handle })
        .from(messages)
        .leftJoin(memberProfiles, eq(memberProfiles.userId, messages.senderId))
        .where(inArray(messages.id, messageIds));
      for (const r of rows)
        out.set(targetKey('message', r.id), {
          preview: truncate(r.body) || 'Message',
          userId: r.senderId,
          href: hrefFor('message', r.id, { handle: r.handle }),
          postId: null,
        });
    }
    const storyIds = ids('story').filter(isUuid);
    if (storyIds.length) {
      const rows = await this.db
        .select({ id: stories.id, caption: stories.caption, authorId: stories.authorId })
        .from(stories)
        .where(inArray(stories.id, storyIds));
      for (const r of rows)
        out.set(targetKey('story', r.id), {
          preview: truncate(r.caption ?? '') || 'Story',
          userId: r.authorId,
          href: hrefFor('story', r.id, {}),
          postId: null,
        });
    }
    if (postIds.length) {
      const rows = await this.db
        .select({ id: posts.id, body: posts.body, authorId: posts.authorId })
        .from(posts)
        .where(inArray(posts.id, postIds));
      for (const r of rows)
        out.set(targetKey('post', r.id), {
          preview: truncate(r.body) || 'Post',
          userId: r.authorId,
          href: hrefFor('post', r.id, {}),
          postId: r.id,
        });
    }
    if (commentIds.length) {
      const rows = await this.db
        .select({ id: comments.id, body: comments.body, authorId: comments.authorId, postId: comments.postId })
        .from(comments)
        .where(inArray(comments.id, commentIds));
      for (const r of rows)
        out.set(targetKey('comment', r.id), {
          preview: truncate(r.body) || 'Comment',
          userId: r.authorId,
          href: hrefFor('comment', r.id, { postId: r.postId }),
          postId: r.postId,
        });
    }
    if (memberIds.length) {
      const rows = await this.db
        .select({ id: memberProfiles.userId, name: memberProfiles.displayName, handle: memberProfiles.handle })
        .from(memberProfiles)
        .where(inArray(memberProfiles.userId, memberIds));
      for (const r of rows)
        out.set(targetKey('member', r.id), {
          preview: r.name,
          userId: r.id,
          href: hrefFor('member', r.id, { handle: r.handle }),
          postId: null,
        });
    }
    if (tags.length) {
      const rows = await this.db
        .select({ tag: hashtags.tag, display: hashtags.display })
        .from(hashtags)
        .where(inArray(hashtags.tag, tags));
      for (const r of rows)
        out.set(targetKey('hashtag', r.tag), {
          preview: `#${r.display}`,
          userId: null,
          href: hrefFor('hashtag', r.tag, { tag: r.tag }),
          postId: null,
        });
    }
    return out;
  }

  /**
   * Moderators cannot act on staff, and nobody acts on a member holding an equal or
   * higher privileged role, or on themselves (spec 4.17: least privilege, roles additive).
   */
  async assertCanActOn(actor: AuthUser, targetUserId: string) {
    if (actor.id === targetUserId)
      throw Errors.forbidden('You can’t take moderation action on your own account or content');
    const [target] = await this.db
      .select({ isStaff: users.isStaff })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    if (!target) return;
    const roleRows = await this.db
      .select({ key: roles.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, targetUserId), isNull(userRoles.revokedAt)));
    const targetRank = rankOf(roleRows.map((r) => r.key));
    const actorRank = rankOf(actor.roles);
    if (targetRank > 0 && targetRank >= actorRank) {
      throw Errors.forbidden('This account holds an equal or higher role. Escalate to a Platform Admin.');
    }
    if (target.isStaff && actorRank < 2)
      throw Errors.forbidden('Staff accounts can only be actioned by a Platform Admin');
  }
}
