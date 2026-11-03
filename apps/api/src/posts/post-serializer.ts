import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { AttachmentView, ChapterRef, MemberRef, PollView, PostKind, PostView, ReactionKind } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import {
  bookmarks,
  chapters,
  files,
  hashtags,
  mentions,
  pollOptions,
  pollVotes,
  polls,
  postAttachments,
  postHashtags,
  posts,
  reactions,
  users,
} from '../db/schema.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { can } from '../core/policy.js';
import type { AuthUser } from '../core/auth-context.js';
import { canViewPost, isModerator, type AuthorState, type PostRow } from './visibility.js';

const FALLBACK_AUTHOR: MemberRef = {
  id: '00000000-0000-0000-0000-000000000000',
  handle: 'deleted-member',
  name: 'Former member',
  headline: null,
  avatarUrl: null,
  tone: 'tint',
  verified: false,
  staff: false,
};

/**
 * Builds PostView for a viewer, in bulk (one query per related table), keeping
 * the order of the ids given. Callers decide which ids the viewer may list;
 * embedded reposts are re-checked here (null when the original is not visible).
 */
@Injectable()
export class PostSerializer {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
  ) {}

  async one(id: string, viewer: AuthUser | undefined): Promise<PostView> {
    const [view] = await this.posts([id], viewer);
    return view!;
  }

  async posts(ids: string[], viewer: AuthUser | undefined, blocked?: Set<string>, depth = 0): Promise<PostView[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(posts).where(inArray(posts.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const blockedSet = blocked ?? (viewer ? await this.relations.blockedSet(viewer.id) : new Set<string>());

    // Reposts embed the original one level deep.
    const originals = new Map<string, PostView | null>();
    if (depth === 0) {
      const originalIds = [...new Set(rows.map((r) => r.repostOfId).filter((x): x is string => !!x))];
      if (originalIds.length) {
        const originalRows = await this.db.select().from(posts).where(inArray(posts.id, originalIds));
        const states = await this.authorStates(originalRows.map((r) => r.authorId));
        const visible = originalRows.filter(
          (r) => canViewPost(r, states.get(r.authorId), viewer, blockedSet) && r.moderationState === 'visible',
        );
        const views = await this.posts(
          visible.map((r) => r.id),
          viewer,
          blockedSet,
          1,
        );
        for (const id of originalIds) originals.set(id, views.find((v) => v.id === id) ?? null);
      }
    }

    const postIds = rows.map((r) => r.id);
    const [authorRefs, chapterMap, tagMap, mentionMap, attachmentMap, pollMap, viewerState] = await Promise.all([
      this.members.refs(rows.map((r) => r.authorId)),
      this.chapters(rows),
      this.hashtags(postIds),
      this.mentions(postIds, blockedSet),
      this.attachments(postIds),
      this.polls(postIds, viewer),
      this.viewerState(postIds, viewer),
    ]);

    const out: PostView[] = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue;
      const own = viewer?.id === r.authorId;
      const view: PostView = {
        id: r.id,
        author: authorRefs.get(r.authorId) ?? FALLBACK_AUTHOR,
        body: r.body,
        kind: r.kind as PostKind,
        pinned: !!r.pinnedAt,
        chapter: (r.chapterId && chapterMap.get(r.chapterId)) || null,
        hashtags: tagMap.get(r.id) ?? [],
        mentions: mentionMap.get(r.id) ?? [],
        attachments: attachmentMap.get(r.id) ?? [],
        poll: pollMap.get(r.id) ?? null,
        linkPreview: r.linkPreview ?? null,
        repostOf: depth === 0 && r.repostOfId ? (originals.get(r.repostOfId) ?? null) : null,
        isRepost: !!r.repostOfId,
        status: r.status as PostView['status'],
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt?.toISOString() ?? null,
        counts: { reactions: r.reactionCount, comments: r.commentCount, reposts: r.repostCount },
        reactionBreakdown: { like: r.likeCount, insightful: r.insightfulCount, support: r.supportCount },
        viewer: {
          reaction: viewerState.reactions.get(r.id) ?? null,
          bookmarked: viewerState.bookmarks.has(r.id),
          reposted: viewerState.reposts.has(r.id),
          canEdit: can(viewer, 'post.edit', { authorId: r.authorId }) && !r.deletedAt,
          canDelete: can(viewer, 'post.delete', { authorId: r.authorId }) && !r.deletedAt,
          canReport: !!viewer && !own && can(viewer, 'report.create'),
        },
      };
      if (r.moderationState !== 'visible' && (own || isModerator(viewer))) {
        view.moderationState = r.moderationState as NonNullable<PostView['moderationState']>;
      }
      out.push(view);
    }
    return out;
  }

  async authorStates(ids: string[]): Promise<Map<string, AuthorState>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.db
      .select({ id: users.id, status: users.status, suspendedUntil: users.suspendedUntil })
      .from(users)
      .where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async chapters(rows: PostRow[]): Promise<Map<string, ChapterRef>> {
    const ids = [...new Set(rows.map((r) => r.chapterId).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    const found = await this.db
      .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
      .from(chapters)
      .where(inArray(chapters.id, ids));
    return new Map(found.map((c) => [c.id, c]));
  }

  private async hashtags(postIds: string[]): Promise<Map<string, string[]>> {
    const rows = await this.db
      .select({ postId: postHashtags.postId, display: hashtags.display })
      .from(postHashtags)
      .innerJoin(hashtags, eq(hashtags.id, postHashtags.hashtagId))
      .where(inArray(postHashtags.postId, postIds))
      .orderBy(asc(postHashtags.createdAt), asc(hashtags.display));
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.postId, [...(map.get(r.postId) ?? []), r.display]);
    return map;
  }

  private async mentions(postIds: string[], blocked: Set<string>): Promise<Map<string, MemberRef[]>> {
    const rows = await this.db
      .select({ sourceId: mentions.sourceId, userId: mentions.userId })
      .from(mentions)
      .where(and(eq(mentions.sourceType, 'post'), inArray(mentions.sourceId, postIds)));
    const refs = await this.members.refs(rows.map((r) => r.userId));
    const map = new Map<string, MemberRef[]>();
    for (const r of rows) {
      const ref = refs.get(r.userId);
      if (!ref || blocked.has(r.userId)) continue;
      map.set(r.sourceId, [...(map.get(r.sourceId) ?? []), ref]);
    }
    return map;
  }

  private async attachments(postIds: string[]): Promise<Map<string, AttachmentView[]>> {
    const rows = await this.db
      .select({
        postId: postAttachments.postId,
        kind: postAttachments.kind,
        file: {
          id: files.id,
          name: files.originalName,
          mime: files.mime,
          sizeBytes: files.sizeBytes,
          width: files.width,
          height: files.height,
        },
      })
      .from(postAttachments)
      .innerJoin(files, eq(files.id, postAttachments.fileId))
      .where(and(inArray(postAttachments.postId, postIds), inArray(files.scanStatus, ['pending', 'clean'])))
      .orderBy(asc(postAttachments.position));
    const map = new Map<string, AttachmentView[]>();
    for (const r of rows) {
      const view: AttachmentView = {
        id: r.file.id,
        kind: r.kind as AttachmentView['kind'],
        url: mediaUrl(r.file.id)!,
        name: r.file.name,
        mime: r.file.mime,
        sizeBytes: r.file.sizeBytes,
        width: r.file.width,
        height: r.file.height,
      };
      map.set(r.postId, [...(map.get(r.postId) ?? []), view]);
    }
    return map;
  }

  private async polls(postIds: string[], viewer: AuthUser | undefined): Promise<Map<string, PollView>> {
    const pollRows = await this.db.select().from(polls).where(inArray(polls.postId, postIds));
    if (!pollRows.length) return new Map();
    const pollIds = pollRows.map((p) => p.id);
    const [options, votes] = await Promise.all([
      this.db.select().from(pollOptions).where(inArray(pollOptions.pollId, pollIds)).orderBy(asc(pollOptions.position)),
      viewer
        ? this.db
            .select({ pollId: pollVotes.pollId, optionId: pollVotes.optionId })
            .from(pollVotes)
            .where(and(inArray(pollVotes.pollId, pollIds), eq(pollVotes.userId, viewer.id)))
        : Promise.resolve([] as { pollId: string; optionId: string }[]),
    ]);
    const now = Date.now();
    const map = new Map<string, PollView>();
    for (const p of pollRows) {
      const opts = options.filter((o) => o.pollId === p.id);
      map.set(p.postId, {
        id: p.id,
        question: p.question,
        closesAt: p.closesAt.toISOString(),
        closed: p.closesAt.getTime() <= now,
        totalVotes: p.totalVotes,
        options: opts.map((o) => ({
          id: o.id,
          label: o.label,
          votes: o.voteCount,
          percent: p.totalVotes ? Math.round((o.voteCount / p.totalVotes) * 100) : 0,
        })),
        myVoteOptionId: votes.find((v) => v.pollId === p.id)?.optionId ?? null,
      });
    }
    return map;
  }

  private async viewerState(postIds: string[], viewer: AuthUser | undefined) {
    const state = { reactions: new Map<string, ReactionKind>(), bookmarks: new Set<string>(), reposts: new Set<string>() };
    if (!viewer) return state;
    const [rx, bm, rp] = await Promise.all([
      this.db
        .select({ targetId: reactions.targetId, kind: reactions.kind })
        .from(reactions)
        .where(and(eq(reactions.userId, viewer.id), eq(reactions.targetType, 'post'), inArray(reactions.targetId, postIds))),
      this.db
        .select({ targetId: bookmarks.targetId })
        .from(bookmarks)
        .where(and(eq(bookmarks.userId, viewer.id), eq(bookmarks.targetType, 'post'), inArray(bookmarks.targetId, postIds))),
      this.db
        .select({ repostOfId: posts.repostOfId })
        .from(posts)
        .where(and(eq(posts.authorId, viewer.id), inArray(posts.repostOfId, postIds), isNull(posts.deletedAt))),
    ]);
    for (const r of rx) state.reactions.set(r.targetId, r.kind as ReactionKind);
    for (const b of bm) state.bookmarks.add(b.targetId);
    for (const r of rp) if (r.repostOfId) state.reposts.add(r.repostOfId);
    return state;
  }
}
