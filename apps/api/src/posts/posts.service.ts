import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { CreatePostInput, PostView, UpdatePostInput } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, files, hashtags, mentions, pollOptions, pollVotes, polls, postAttachments, postHashtags, posts } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from '../core/auth-context.js';
import { can, isActiveUntil } from '../core/policy.js';
import { MembersService } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { EventsService } from '../infra/events.service.js';
import { QueueService } from '../infra/queue.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { AuditService } from '../infra/audit.service.js';
import { MediaService, type FileRow } from '../media/media.service.js';
import { PostSerializer } from './post-serializer.js';
import { LinkPreviewService } from './link-preview.js';
import { attachHashtags, syncHashtags } from './hashtags.js';
import { replaceMentions, resolveMentions } from './mentions.js';
import { firstHttpsUrl, parseHashtags } from './text-parse.js';
import { canViewPost, isInteractive, type PostRow } from './visibility.js';

/** Spec 8.2 (proposed): posts per member per day. */
export const POSTS_PER_DAY = 20;

/** Posting, commenting and reacting are blocked while a time-boxed restriction runs (CM-ADM-04). */
export function assertNotRestricted(user: AuthUser) {
  if (isActiveUntil(user.restrictedPostingUntil)) throw Errors.restricted('posting', user.restrictedPostingUntil);
}

/**
 * Posts (CM-FED-01, -03, -06): create with attachments, poll, link preview,
 * hashtags and mentions; repost; author edit and delete; poll votes.
 */
@Injectable()
export class PostsService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly serializer: PostSerializer,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly limits: RateLimitService,
    private readonly events: EventsService,
    private readonly queue: QueueService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
    private readonly previews: LinkPreviewService,
  ) {}

  onModuleInit() {
    this.media.onSettled((file) => this.onFileSettled(file));
    this.queue.process('media', async (name, data: { postId: string }) => {
      if (name === 'link-preview') await this.refreshLinkPreview(data.postId);
    });
  }

  async find(id: string): Promise<PostRow | undefined> {
    const [row] = await this.db.select().from(posts).where(eq(posts.id, id)).limit(1);
    return row;
  }

  /** Loads a post the viewer may see, or 404 (blocked, hidden, pending and deleted look the same). */
  async findVisible(viewer: AuthUser | undefined, id: string, opts: { interactive?: boolean } = {}): Promise<PostRow> {
    const post = await this.find(id);
    if (!post) throw Errors.notFound('Post');
    const blocked = viewer ? await this.relations.blockedSet(viewer.id) : new Set<string>();
    const states = await this.serializer.authorStates([post.authorId]);
    if (!canViewPost(post, states.get(post.authorId), viewer, blocked)) throw Errors.notFound('Post');
    if (opts.interactive && !isInteractive(post)) throw Errors.notFound('Post');
    return post;
  }

  async get(viewer: AuthUser | undefined, id: string): Promise<PostView> {
    await this.findVisible(viewer, id);
    return this.serializer.one(id, viewer);
  }

  async create(user: AuthUser, input: CreatePostInput): Promise<PostView> {
    assertNotRestricted(user);
    if (!can(user, 'post.create')) throw Errors.forbidden();
    if (input.kind === 'announcement' && !can(user, 'post.announce')) {
      throw Errors.forbidden('Only the platform team can publish announcements');
    }
    await this.limits.consume(`posts:${user.id}`, POSTS_PER_DAY, 24 * 3600);

    const attachments = await this.validateAttachments(user.id, input.attachmentIds);
    const original = input.repostOfId ? await this.repostTarget(user, input.repostOfId) : null;
    if (input.chapterId) {
      const [chapter] = await this.db.select({ id: chapters.id }).from(chapters).where(eq(chapters.id, input.chapterId)).limit(1);
      if (!chapter) throw Errors.validation({ chapterId: 'Choose an existing chapter' });
    }
    const tags = parseHashtags(input.body);
    const mentionIds = await resolveMentions(this.members, this.relations, user.id, input.body);
    const linkUrl = input.linkUrl ?? firstHttpsUrl(input.body);
    // CM-FED rule: a post is visible only after its attachments pass scanning.
    const status = attachments.every((f) => f.scanStatus === 'clean') ? 'published' : 'pending_media';
    const now = new Date();

    const post = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(posts)
        .values({
          authorId: user.id,
          body: input.body,
          kind: input.kind,
          visibility: input.visibility,
          chapterId: input.chapterId ?? null,
          countryCode: user.countryCode,
          repostOfId: original?.id ?? null,
          linkUrl,
          status,
          pinnedAt: input.kind === 'announcement' ? now : null,
        })
        .returning();
      if (attachments.length) {
        await tx.insert(postAttachments).values(
          attachments.map((f, position) => ({
            postId: p!.id,
            fileId: f.id,
            kind: f.purpose === 'post_document' ? 'document' : 'image',
            position,
          })),
        );
        const claimed = await tx
          .update(files)
          .set({ attachedAt: now })
          .where(and(inArray(files.id, attachments.map((f) => f.id)), isNull(files.attachedAt)))
          .returning({ id: files.id });
        if (claimed.length !== attachments.length) throw Errors.conflict('An attachment is already used by another post');
      }
      if (input.poll) {
        const [poll] = await tx
          .insert(polls)
          .values({
            postId: p!.id,
            question: input.poll.question,
            closesAt: new Date(now.getTime() + input.poll.durationHours * 3600_000),
          })
          .returning({ id: polls.id });
        await tx
          .insert(pollOptions)
          .values(input.poll.options.map((label, position) => ({ pollId: poll!.id, label, position })));
      }
      await attachHashtags(tx, p!.id, tags);
      await replaceMentions(tx, 'post', p!.id, mentionIds);
      if (original) {
        await tx
          .update(posts)
          .set({ repostCount: sql`${posts.repostCount} + 1` })
          .where(eq(posts.id, original.id));
      }
      return p!;
    });

    if (linkUrl) await this.queue.add('media', 'link-preview', { postId: post.id });
    if (status === 'published') await this.announce(post);
    this.analytics.track('post_created', user.id, user.countryCode);
    if (input.kind === 'announcement') {
      await this.audit.record({ actorId: user.id, action: 'post.announce', targetType: 'post', targetId: post.id });
    }
    return this.serializer.one(post.id, user);
  }

  /** PATCH /posts/{id}: author only; marked edited; hashtags and mentions re-parsed (CM-FED-06). */
  async update(user: AuthUser, id: string, input: UpdatePostInput): Promise<PostView> {
    const post = await this.find(id);
    if (!post || post.deletedAt) throw Errors.notFound('Post');
    if (!can(user, 'post.edit', { authorId: post.authorId })) {
      await this.findVisible(user, id);
      throw Errors.forbidden('Only the author can edit this post');
    }
    assertNotRestricted(user);
    const tags = parseHashtags(input.body);
    const mentionIds = await resolveMentions(this.members, this.relations, user.id, input.body);
    const newLink = !post.linkUrl ? firstHttpsUrl(input.body) : null;
    const added = await this.db.transaction(async (tx) => {
      await tx
        .update(posts)
        .set({ body: input.body, editedAt: new Date(), ...(newLink ? { linkUrl: newLink } : {}) })
        .where(eq(posts.id, id));
      await syncHashtags(tx, id, tags);
      return replaceMentions(tx, 'post', id, mentionIds);
    });
    if (newLink) await this.queue.add('media', 'link-preview', { postId: id });
    if (added.length && isInteractive(post)) {
      await this.events.emit({ type: 'mention.created', sourceType: 'post', sourceId: id, postId: id, authorId: user.id, userIds: added });
    }
    return this.serializer.one(id, user);
  }

  /** DELETE /posts/{id}: author or moderator; soft delete (spec 5.2). */
  async remove(user: AuthUser, id: string, ip?: string): Promise<void> {
    const post = await this.find(id);
    if (!post || post.deletedAt) throw Errors.notFound('Post');
    if (!can(user, 'post.delete', { authorId: post.authorId })) {
      await this.findVisible(user, id);
      throw Errors.forbidden('Only the author can delete this post');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, id));
      await tx
        .update(hashtags)
        .set({ postCount: sql`greatest(${hashtags.postCount} - 1, 0)` })
        .where(inArray(hashtags.id, tx.select({ id: postHashtags.hashtagId }).from(postHashtags).where(eq(postHashtags.postId, id))));
      if (post.repostOfId) {
        await tx
          .update(posts)
          .set({ repostCount: sql`greatest(${posts.repostCount} - 1, 0)` })
          .where(eq(posts.id, post.repostOfId));
      }
    });
    if (post.authorId !== user.id) {
      await this.audit.record({ actorId: user.id, action: 'post.delete', targetType: 'post', targetId: id, before: { authorId: post.authorId }, ip });
    }
  }

  /** POST /posts/{id}/poll/vote: one vote per member; closed polls are 409. */
  async vote(user: AuthUser, postId: string, optionId: string): Promise<PostView> {
    await this.findVisible(user, postId, { interactive: true });
    const [poll] = await this.db.select().from(polls).where(eq(polls.postId, postId)).limit(1);
    if (!poll) throw Errors.notFound('Poll');
    if (poll.closesAt.getTime() <= Date.now()) throw Errors.conflict('This poll has closed');
    const [option] = await this.db
      .select({ id: pollOptions.id })
      .from(pollOptions)
      .where(and(eq(pollOptions.id, optionId), eq(pollOptions.pollId, poll.id)))
      .limit(1);
    if (!option) throw Errors.validation({ optionId: 'Choose one of the poll options' });
    await this.db.transaction(async (tx) => {
      const [vote] = await tx
        .insert(pollVotes)
        .values({ pollId: poll.id, userId: user.id, optionId })
        .onConflictDoNothing()
        .returning({ pollId: pollVotes.pollId });
      if (!vote) throw Errors.conflict('You already voted in this poll');
      await tx.update(pollOptions).set({ voteCount: sql`${pollOptions.voteCount} + 1` }).where(eq(pollOptions.id, optionId));
      await tx.update(polls).set({ totalVotes: sql`${polls.totalVotes} + 1` }).where(eq(polls.id, poll.id));
    });
    return this.serializer.one(postId, user);
  }

  /** Attachments: the author's own unattached files, pending or clean; up to 4 images or 1 document (CM-FED-01). */
  private async validateAttachments(userId: string, ids: string[]): Promise<FileRow[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const rows = await this.db.select().from(files).where(inArray(files.id, unique));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = unique.map((id) => byId.get(id));
    for (const f of ordered) {
      if (!f || f.ownerId !== userId) throw Errors.validation({ attachmentIds: 'Attachment not found' });
      if (f.attachedAt) throw Errors.validation({ attachmentIds: 'This file is already attached to a post' });
      if (f.purpose !== 'post_image' && f.purpose !== 'post_document') {
        throw Errors.validation({ attachmentIds: 'This file can’t be attached to a post' });
      }
      if (f.scanStatus === 'rejected' || f.scanStatus === 'infected') {
        throw Errors.validation({ attachmentIds: f.rejectionReason ?? 'This file was rejected' });
      }
      if (f.scanStatus === 'awaiting_upload') throw Errors.validation({ attachmentIds: 'Finish uploading the file first' });
    }
    const files_ = ordered as FileRow[];
    const docs = files_.filter((f) => f.purpose === 'post_document').length;
    const images = files_.length - docs;
    if (docs > 1 || (docs > 0 && images > 0) || images > 4) {
      throw Errors.validation({ attachmentIds: 'Attach up to 4 images or 1 document' });
    }
    return files_;
  }

  /** A repost of a repost points at the original. One repost per member per original. */
  private async repostTarget(user: AuthUser, id: string): Promise<PostRow> {
    let target = await this.findVisible(user, id, { interactive: true });
    if (target.repostOfId) target = await this.findVisible(user, target.repostOfId, { interactive: true });
    const [existing] = await this.db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.authorId, user.id), eq(posts.repostOfId, target.id), isNull(posts.deletedAt)))
      .limit(1);
    if (existing) throw Errors.conflict('You already reposted this');
    return target;
  }

  /** Domain events once a post is visible (at creation, or when its media becomes clean). */
  private async announce(post: PostRow) {
    await this.events.emit({ type: 'post.created', postId: post.id, authorId: post.authorId });
    const mentioned = await this.db
      .select({ userId: mentions.userId })
      .from(mentions)
      .where(and(eq(mentions.sourceType, 'post'), eq(mentions.sourceId, post.id)));
    if (mentioned.length) {
      await this.events.emit({
        type: 'mention.created',
        sourceType: 'post',
        sourceId: post.id,
        postId: post.id,
        authorId: post.authorId,
        userIds: mentioned.map((m) => m.userId),
      });
    }
    if (post.repostOfId) {
      await this.events.emit({ type: 'post.reposted', postId: post.id, originalId: post.repostOfId, authorId: post.authorId });
    }
  }

  /** Media scan finished: drop rejected attachments, publish posts whose attachments are all clean. */
  private async onFileSettled(file: FileRow) {
    const links = await this.db.select({ postId: postAttachments.postId }).from(postAttachments).where(eq(postAttachments.fileId, file.id));
    for (const { postId } of links) {
      if (file.scanStatus !== 'clean') {
        await this.db.delete(postAttachments).where(and(eq(postAttachments.postId, postId), eq(postAttachments.fileId, file.id)));
      }
      await this.publishIfReady(postId);
    }
  }

  private async publishIfReady(postId: string) {
    const post = await this.find(postId);
    if (!post || post.status !== 'pending_media' || post.deletedAt) return;
    const remaining = await this.db
      .select({ status: files.scanStatus })
      .from(postAttachments)
      .innerJoin(files, eq(files.id, postAttachments.fileId))
      .where(eq(postAttachments.postId, postId));
    if (remaining.some((r) => r.status !== 'clean')) return;
    if (!remaining.length && !post.body.trim() && !post.repostOfId) {
      const [poll] = await this.db.select({ id: polls.id }).from(polls).where(eq(polls.postId, postId)).limit(1);
      if (!poll) {
        // Nothing left to show once the only attachment was rejected.
        await this.db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId));
        return;
      }
    }
    const [published] = await this.db
      .update(posts)
      .set({ status: 'published' })
      .where(and(eq(posts.id, postId), eq(posts.status, 'pending_media')))
      .returning();
    if (published) await this.announce(published);
  }

  private async refreshLinkPreview(postId: string) {
    const post = await this.find(postId);
    if (!post?.linkUrl || post.deletedAt) return;
    const preview = await this.previews.safePreview(post.linkUrl);
    if (preview) await this.db.update(posts).set({ linkPreview: preview }).where(eq(posts.id, postId));
  }
}
