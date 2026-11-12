import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  ARTICLE_MAX_CHARS,
  ARTICLE_MIN_CHARS,
  POST_MAX_CHARS,
  parseVideoEmbed,
  type CreatePostInput,
  type LinkPreview,
  type HelpOfferView,
  type PostView,
  type UpdatePostInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import {
  chapters,
  comments,
  files,
  hashtags,
  mentions,
  pollOptions,
  pollVotes,
  polls,
  postAttachments,
  postHashtags,
  postHelpOffers,
  posts,
} from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from '../core/auth-context.js';
import { can, isActiveUntil } from '../core/policy.js';
import { MembersService } from '../core/members.service.js';
import { ChapterRules } from '../core/chapter-rules.service.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { RelationsService } from '../core/relations.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { EventsService } from '../infra/events.service.js';
import { QueueService } from '../infra/queue.service.js';
import { AnalyticsService } from '../infra/analytics.service.js';
import { AuditService } from '../infra/audit.service.js';
import { MediaService, type FileRow } from '../media/media.service.js';
import { PostSerializer } from './post-serializer.js';
import { LinkPreviewService, embedPreview } from './link-preview.js';
import { attachHashtags, syncHashtags } from './hashtags.js';
import { replaceMentions, resolveMentions } from './mentions.js';
import { firstHttpsUrl, parseHashtags } from './text-parse.js';
import { canViewPost, isInteractive, type PostRow } from './visibility.js';

/** Spec 8.2 (proposed): posts per member per day. */
export const POSTS_PER_DAY = 20;

/** Help offers per member per day (spec 8.2 style limit for abuse-prone actions). */
export const HELP_OFFERS_PER_DAY = 30;

/** Type-specific details stored in posts.details. */
function detailsFor(input: Pick<CreatePostInput, 'type' | 'celebration' | 'request' | 'article'>): Record<string, unknown> | null {
  if (input.type === 'celebration') return input.celebration ?? null;
  if (input.type === 'request') return input.request ?? null;
  if (input.type === 'article') return input.article ?? null;
  return null;
}

/** Body length rules by type, for edits (creation runs contracts compositionIssues). */
function checkBody(type: string, body: string) {
  const max = type === 'article' ? ARTICLE_MAX_CHARS : POST_MAX_CHARS;
  if (body.length > max) throw Errors.validation({ body: `Posts can be up to ${max.toLocaleString('en')} characters` });
  if (type === 'article' && body.length < ARTICLE_MIN_CHARS) {
    throw Errors.validation({ body: `Articles need at least ${ARTICLE_MIN_CHARS} characters` });
  }
  if (type === 'question' && body.length < 10) throw Errors.validation({ body: 'Write your question (at least 10 characters)' });
}

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
    private readonly pageRefs: PageRefsService,
    private readonly chapterRules: ChapterRules,
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
    // A page post is visible while its page is live, and always to the people who manage the page.
    let pageIsLive = true;
    if (post.pageId) {
      pageIsLive = (await this.pageRefs.refs([post.pageId])).get(post.pageId)?.status === 'active';
      if (!pageIsLive && (await this.pageRefs.role(viewer?.id, post.pageId))) pageIsLive = true;
    }
    if (!canViewPost(post, states.get(post.authorId), viewer, blocked, pageIsLive)) throw Errors.notFound('Post');
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
    if (input.pageId) await this.assertCanPostAs(user, input);
    await this.limits.consume(`posts:${user.id}`, POSTS_PER_DAY, 24 * 3600);

    const attachments = await this.validateAttachments(user.id, input.attachmentIds);
    if (input.type === 'article' && attachments.some((f) => f.purpose !== 'post_image')) {
      throw Errors.validation({ attachmentIds: 'An article’s cover must be an image' });
    }
    if (input.poll && attachments.some((f) => f.purpose === 'post_video')) {
      throw Errors.validation({ poll: 'A post can have a video or a poll, not both' });
    }
    const original = input.repostOfId ? await this.repostTarget(user, input.repostOfId) : null;
    if (input.chapterId) {
      const [chapter] = await this.db.select({ id: chapters.id }).from(chapters).where(eq(chapters.id, input.chapterId)).limit(1);
      if (!chapter) throw Errors.validation({ chapterId: 'Choose an existing chapter' });
    }
    // Chapter rules: barred members can't post here, and posts may wait for the chapter team's approval.
    const review = input.chapterId && input.kind !== 'announcement' ? (await this.chapterRules.posting(user, input.chapterId)).review : false;
    const tags = parseHashtags(input.body);
    const mentionIds = await resolveMentions(this.members, this.relations, user.id, input.body);
    const linkUrl = input.linkUrl ?? firstHttpsUrl(input.body);
    // CM-FED rule: a post is visible only after its attachments pass scanning.
    const status = !attachments.every((f) => f.scanStatus === 'clean') ? 'pending_media' : review ? 'in_review' : 'published';
    const now = new Date();

    const post = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(posts)
        .values({
          authorId: user.id,
          body: input.body,
          kind: input.kind,
          type: input.type,
          details: detailsFor(input),
          visibility: input.visibility,
          chapterId: input.chapterId ?? null,
          countryCode: user.countryCode,
          repostOfId: original?.id ?? null,
          pageId: input.pageId ?? null,
          linkUrl,
          // Video links get their player straight away; the title and description follow from the preview job.
          linkPreview: linkUrl ? embedPreview(linkUrl) : null,
          status,
          chapterReview: review ? 'pending' : null,
          pinnedAt: input.kind === 'announcement' ? now : null,
        })
        .returning();
      if (attachments.length) {
        await tx.insert(postAttachments).values(
          attachments.map((f, position) => ({
            postId: p!.id,
            fileId: f.id,
            kind: f.purpose === 'post_document' ? 'document' : f.purpose === 'post_video' ? 'video' : 'image',
            position,
            alt: f.purpose === 'post_image' ? input.altTexts?.[f.id]?.trim() || null : null,
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
    else if (status === 'in_review') await this.events.emit({ type: 'chapter.post_pending', postId: post.id, chapterId: post.chapterId!, authorId: post.authorId });
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
    if (!(await this.owns(user, post))) {
      await this.findVisible(user, id);
      throw Errors.forbidden(post.pageId ? 'Only the page’s admins can edit this post' : 'Only the author can edit this post');
    }
    assertNotRestricted(user);
    checkBody(post.type, input.body);
    const details = this.editedDetails(post, input);
    const tags = parseHashtags(input.body);
    const mentionIds = await resolveMentions(this.members, this.relations, user.id, input.body);
    const newLink = !post.linkUrl ? firstHttpsUrl(input.body) : null;
    const added = await this.db.transaction(async (tx) => {
      await tx
        .update(posts)
        .set({
          body: input.body,
          editedAt: new Date(),
          ...(newLink ? { linkUrl: newLink, linkPreview: embedPreview(newLink) } : {}),
          ...(details ? { details } : {}),
        })
        .where(eq(posts.id, id));
      for (const [fileId, alt] of Object.entries(input.altTexts ?? {})) {
        await tx
          .update(postAttachments)
          .set({ alt: alt.trim() || null })
          .where(and(eq(postAttachments.postId, id), eq(postAttachments.fileId, fileId), eq(postAttachments.kind, 'image')));
      }
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
    const owner = await this.owns(user, post);
    if (!owner && !can(user, 'post.delete', {})) {
      await this.findVisible(user, id);
      throw Errors.forbidden(post.pageId ? 'Only the page’s admins can delete this post' : 'Only the author can delete this post');
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
    if (!owner) {
      await this.audit.record({ actorId: user.id, action: 'post.delete', targetType: 'post', targetId: id, before: { authorId: post.authorId }, ip });
    }
  }

  /** The post's author, or for a page post anyone who manages the page. */
  private async owns(user: AuthUser, post: PostRow): Promise<boolean> {
    if (post.pageId) return !!(await this.pageRefs.role(user.id, post.pageId));
    return post.authorId === user.id;
  }

  /** Publishing as a page: the member must manage it, and it must be live. */
  private async assertCanPostAs(user: AuthUser, input: CreatePostInput) {
    const pageId = input.pageId!;
    const [page, role] = await Promise.all([this.pageRefs.refs([pageId]).then((m) => m.get(pageId)), this.pageRefs.role(user.id, pageId)]);
    if (!page || !role) throw Errors.forbidden('You can only post as a page you manage');
    if (page.status !== 'active') {
      throw Errors.forbidden(page.status === 'pending' ? 'This page is still being reviewed. You can post once it’s live.' : 'This page isn’t live, so it can’t post.');
    }
    if (input.kind === 'announcement') throw Errors.validation({ kind: 'Announcements are published from a team account, not a page' });
    if (input.chapterId) throw Errors.validation({ chapterId: 'Page posts go to the page’s followers, not a chapter' });
    if (input.repostOfId) throw Errors.validation({ repostOfId: 'Reposts are made from your own profile' });
    if (input.type === 'request') throw Errors.validation({ type: 'Requests are posted from your own profile' });
  }

  /** Details sent with an edit must match the post's type. */
  private editedDetails(post: PostRow, input: UpdatePostInput): Record<string, unknown> | null {
    const sent = { celebration: input.celebration, request: input.request, article: input.article };
    for (const [key, value] of Object.entries(sent)) {
      if (value && key !== post.type) throw Errors.validation({ [key]: 'These details don’t match this kind of post' });
    }
    return detailsFor({ type: post.type as CreatePostInput['type'], ...sent });
  }

  /** PUT /posts/{id}/accepted-answer: the question's author marks a top-level answer as the best one. */
  async acceptAnswer(user: AuthUser, postId: string, commentId: string): Promise<PostView> {
    const post = await this.findVisible(user, postId, { interactive: true });
    if (post.type !== 'question') throw Errors.conflict('Only questions have answers to accept');
    if (post.authorId !== user.id) throw Errors.forbidden('Only the person who asked can choose the best answer');
    const [answer] = await this.db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
    if (!answer || answer.postId !== postId || answer.deletedAt || answer.moderationState !== 'visible') throw Errors.notFound('Comment');
    if (answer.parentId) throw Errors.validation({ commentId: 'Choose an answer, not a reply' });
    if (await this.relations.isBlockedEitherWay(user.id, answer.authorId)) throw Errors.notFound('Comment');
    if (post.acceptedCommentId !== commentId) {
      await this.db.update(posts).set({ acceptedCommentId: commentId }).where(eq(posts.id, postId));
      await this.events.emit({ type: 'answer.accepted', postId, commentId, commentAuthorId: answer.authorId, actorId: user.id });
    }
    return this.serializer.one(postId, user);
  }

  /** DELETE /posts/{id}/accepted-answer */
  async clearAnswer(user: AuthUser, postId: string): Promise<PostView> {
    const post = await this.findVisible(user, postId);
    if (post.type !== 'question') throw Errors.conflict('Only questions have answers to accept');
    if (post.authorId !== user.id) throw Errors.forbidden('Only the person who asked can choose the best answer');
    await this.db.update(posts).set({ acceptedCommentId: null }).where(eq(posts.id, postId));
    return this.serializer.one(postId, user);
  }

  /** PUT /posts/{id}/closed: the author closes or reopens a "Looking for" request. */
  async setClosed(user: AuthUser, postId: string, closed: boolean): Promise<PostView> {
    const post = await this.findVisible(user, postId);
    if (post.type !== 'request') throw Errors.conflict('Only “Looking for” posts can be closed');
    if (post.authorId !== user.id) throw Errors.forbidden('Only the author can close this request');
    await this.db.update(posts).set({ closedAt: closed ? new Date() : null }).where(eq(posts.id, postId));
    return this.serializer.one(postId, user);
  }

  /** PUT /posts/{id}/help: "I can help" on an open request; the note is only shown to the author. */
  async offerHelp(user: AuthUser, postId: string, note: string): Promise<PostView> {
    assertNotRestricted(user);
    const post = await this.findVisible(user, postId, { interactive: true });
    if (post.type !== 'request') throw Errors.conflict('Only “Looking for” posts take offers of help');
    if (post.authorId === user.id) throw Errors.validation({ postId: 'You can’t offer help on your own request' });
    const view = await this.serializer.one(postId, user);
    if (view.request?.closed) throw Errors.conflict('This request is closed');
    const [existing] = await this.db
      .select({ postId: postHelpOffers.postId })
      .from(postHelpOffers)
      .where(and(eq(postHelpOffers.postId, postId), eq(postHelpOffers.userId, user.id)))
      .limit(1);
    if (existing) {
      await this.db
        .update(postHelpOffers)
        .set({ note })
        .where(and(eq(postHelpOffers.postId, postId), eq(postHelpOffers.userId, user.id)));
    } else {
      await this.limits.consume(`help:${user.id}`, HELP_OFFERS_PER_DAY, 24 * 3600);
      await this.db.insert(postHelpOffers).values({ postId, userId: user.id, note }).onConflictDoNothing();
      await this.events.emit({ type: 'help.offered', postId, authorId: post.authorId, helperId: user.id });
    }
    return this.serializer.one(postId, user);
  }

  /** DELETE /posts/{id}/help */
  async withdrawHelp(user: AuthUser, postId: string): Promise<PostView> {
    await this.findVisible(user, postId);
    await this.db.delete(postHelpOffers).where(and(eq(postHelpOffers.postId, postId), eq(postHelpOffers.userId, user.id)));
    return this.serializer.one(postId, user);
  }

  /** GET /posts/{id}/help: the request's author (or a moderator) sees who offered and their notes. */
  async helpOffers(user: AuthUser, postId: string): Promise<HelpOfferView[]> {
    const post = await this.findVisible(user, postId);
    if (post.type !== 'request') throw Errors.conflict('Only “Looking for” posts take offers of help');
    if (post.authorId !== user.id && !can(user, 'moderation.view')) throw Errors.forbidden('Only the author can see who offered to help');
    const blocked = await this.relations.blockedSet(user.id);
    const rows = await this.db
      .select()
      .from(postHelpOffers)
      .where(eq(postHelpOffers.postId, postId))
      .orderBy(desc(postHelpOffers.createdAt))
      .limit(200);
    const refs = await this.members.refs(rows.map((r) => r.userId));
    return rows
      .filter((r) => !blocked.has(r.userId) && refs.has(r.userId))
      .map((r) => ({ member: refs.get(r.userId)!, note: r.note, createdAt: r.createdAt.toISOString() }));
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
      if (f.purpose !== 'post_image' && f.purpose !== 'post_document' && f.purpose !== 'post_video') {
        throw Errors.validation({ attachmentIds: 'This file can’t be attached to a post' });
      }
      if (f.scanStatus === 'rejected' || f.scanStatus === 'infected') {
        throw Errors.validation({ attachmentIds: f.rejectionReason ?? 'This file was rejected' });
      }
      if (f.scanStatus === 'awaiting_upload') throw Errors.validation({ attachmentIds: 'Finish uploading the file first' });
    }
    const files_ = ordered as FileRow[];
    const docs = files_.filter((f) => f.purpose === 'post_document').length;
    const videos = files_.filter((f) => f.purpose === 'post_video').length;
    const images = files_.length - docs - videos;
    if (docs + videos > 1 || ((docs > 0 || videos > 0) && images > 0) || images > 4) {
      throw Errors.validation({ attachmentIds: 'Attach up to 4 images, 1 video or 1 document' });
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
    // A post that still needs the chapter team's approval waits for it once its files are clean.
    const next = post.chapterReview === 'pending' && post.chapterId ? 'in_review' : 'published';
    const [settled] = await this.db
      .update(posts)
      .set({ status: next })
      .where(and(eq(posts.id, postId), eq(posts.status, 'pending_media')))
      .returning();
    if (!settled) return;
    if (next === 'published') await this.announce(settled);
    else await this.events.emit({ type: 'chapter.post_pending', postId: settled.id, chapterId: settled.chapterId!, authorId: settled.authorId });
  }

  /**
   * The chapter team approved a waiting post: publish it and tell followers and mentioned members,
   * exactly as if it had just been posted. Returns false when it was no longer waiting.
   */
  async publishApproved(postId: string, reviewerId: string): Promise<boolean> {
    const [published] = await this.db
      .update(posts)
      .set({ status: 'published', chapterReview: 'approved', chapterReviewBy: reviewerId, chapterReviewAt: new Date(), chapterReviewNote: null })
      .where(and(eq(posts.id, postId), eq(posts.status, 'in_review'), isNull(posts.deletedAt)))
      .returning();
    if (!published) return false;
    await this.announce(published);
    return true;
  }

  private async refreshLinkPreview(postId: string) {
    const post = await this.find(postId);
    if (!post?.linkUrl || post.deletedAt) return;
    const preview = await this.previews.safePreview(post.linkUrl);
    const embed = parseVideoEmbed(post.linkUrl);
    const merged: LinkPreview | null = preview
      ? { ...preview, imageUrl: preview.imageUrl ?? embed?.thumbnailUrl ?? null, embed }
      : embedPreview(post.linkUrl);
    if (merged) await this.db.update(posts).set({ linkPreview: merged }).where(eq(posts.id, postId));
  }
}

