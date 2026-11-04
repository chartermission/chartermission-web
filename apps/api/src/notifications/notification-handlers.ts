import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { comments, files, follows, hashtags, postAttachments, posts } from '../db/schema.js';
import { EventsService } from '../infra/events.service.js';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';

/**
 * Domain-event handlers that create notifications (spec 4.13: created by workers
 * from domain events, never inline in request handlers). NotifyService skips
 * self-notifications, blocked pairs, closed accounts and disabled categories.
 * Text segments here omit the actor names: the list endpoint prefixes them
 * ("Amina", "Amina and Kwame", "Amina and 4 others").
 */
@Injectable()
export class NotificationHandlers implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    private readonly members: MembersService,
  ) {}

  onModuleInit() {
    this.events.on('mention.created', (e) => this.onMention(e));
    this.events.on('comment.created', (e) => this.onComment(e));
    this.events.on('reaction.created', (e) => this.onReaction(e));
    this.events.on('post.reposted', (e) => this.onRepost(e));
    this.events.on('upload.rejected', (e) => this.onUploadRejected(e));
    this.events.on('trending.updated', (e) => this.onTrending(e));
    this.events.on('answer.accepted', (e) => this.onAnswerAccepted(e));
    this.events.on('help.offered', (e) => this.onHelpOffered(e));
    this.events.on('scheduled.published', (e) => this.onScheduledPublished(e));
    this.events.on('scheduled.failed', (e) => this.onScheduledFailed(e));
  }

  private async onAnswerAccepted(e: { postId: string; commentId: string; commentAuthorId: string; actorId: string }) {
    const name = await this.actorName(e.actorId);
    await this.notify.notify({
      userId: e.commentAuthorId,
      type: 'answer_accepted',
      actorId: e.actorId,
      objectType: 'comment',
      objectId: e.commentId,
      segments: [{ text: ' marked your answer as the best answer', strong: false }],
      href: `/posts/${e.postId}#comment-${e.commentId}`,
      icon: 'check',
      dedupeKey: `answer_accepted:${e.commentId}`,
      email: {
        subject: `${name} marked your answer as the best answer`,
        heading: 'Your answer helped',
        paragraphs: [`${name} marked your answer as the best answer to their question on Charter Mission.`],
        buttonLabel: 'View the question',
      },
    });
  }

  /** Offers of help are batched per request for an hour: "Amina and 2 others offered to help". */
  private async onHelpOffered(e: { postId: string; authorId: string; helperId: string }) {
    const [post] = await this.db.select({ details: posts.details }).from(posts).where(eq(posts.id, e.postId)).limit(1);
    const title = typeof post?.details?.title === 'string' ? post.details.title : 'your request';
    await this.notify.notify({
      userId: e.authorId,
      type: 'help_offered',
      actorId: e.helperId,
      objectType: 'post',
      objectId: e.postId,
      segments: [
        { text: ' offered to help with ', strong: false },
        { text: title, strong: true },
      ],
      href: `/posts/${e.postId}#offers`,
      icon: 'users',
      dedupeKey: `help_offered:${e.postId}`,
      windowMinutes: 60,
    });
  }

  private async onScheduledPublished(e: { draftId: string; postId: string; authorId: string }) {
    await this.notify.notify({
      userId: e.authorId,
      type: 'scheduled_post_published',
      objectType: 'post',
      objectId: e.postId,
      segments: [{ text: 'Your scheduled post is now live', strong: false }],
      href: `/posts/${e.postId}`,
      icon: 'clock',
      dedupeKey: `scheduled_published:${e.draftId}`,
    });
  }

  private async onScheduledFailed(e: { draftId: string; authorId: string; reason: string }) {
    await this.notify.notify({
      userId: e.authorId,
      type: 'scheduled_post_failed',
      objectType: 'draft',
      objectId: e.draftId,
      segments: [
        { text: 'Your scheduled post could not be published: ', strong: false },
        { text: e.reason, strong: true },
      ],
      href: '/drafts?tab=scheduled',
      icon: 'alert',
      dedupeKey: `scheduled_failed:${e.draftId}`,
      email: {
        subject: 'Your scheduled post was not published',
        heading: 'Your scheduled post was not published',
        paragraphs: [`We could not publish your scheduled post: ${e.reason}`, 'Open your scheduled posts to fix it and try again.'],
        buttonLabel: 'Open scheduled posts',
      },
    });
  }

  private async actorName(id: string) {
    return (await this.members.ref(id))?.name ?? 'A member';
  }

  private async onMention(e: { sourceType: 'post' | 'comment'; sourceId: string; postId: string; authorId: string; userIds: string[] }) {
    const name = await this.actorName(e.authorId);
    const where = e.sourceType === 'post' ? 'a post' : 'a comment';
    const href = e.sourceType === 'post' ? `/posts/${e.postId}` : `/posts/${e.postId}#comment-${e.sourceId}`;
    for (const userId of e.userIds) {
      await this.notify.notify({
        userId,
        type: 'mention',
        actorId: e.authorId,
        objectType: e.sourceType,
        objectId: e.sourceId,
        segments: [{ text: ` mentioned you in ${where}`, strong: false }],
        href,
        icon: 'avatar',
        dedupeKey: `mention:${e.sourceType}:${e.sourceId}`,
        email: {
          subject: `${name} mentioned you on Charter Mission`,
          heading: `${name} mentioned you`,
          paragraphs: [`${name} mentioned you in ${where} on Charter Mission.`],
          buttonLabel: 'View on Charter Mission',
        },
      });
    }
  }

  private async onComment(e: { commentId: string; postId: string; authorId: string; parentId: string | null }) {
    const [post] = await this.db.select().from(posts).where(eq(posts.id, e.postId)).limit(1);
    if (!post) return;
    const name = await this.actorName(e.authorId);
    const href = `/posts/${e.postId}#comment-${e.commentId}`;
    let parentAuthor: string | null = null;
    if (e.parentId) {
      const [parent] = await this.db.select().from(comments).where(eq(comments.id, e.parentId)).limit(1);
      if (parent && !parent.deletedAt) {
        parentAuthor = parent.authorId;
        await this.notify.notify({
          userId: parent.authorId,
          type: 'reply_to_comment',
          actorId: e.authorId,
          objectType: 'comment',
          objectId: parent.id,
          segments: [{ text: ' replied to your comment', strong: false }],
          href,
          icon: 'avatar',
          dedupeKey: `reply_to_comment:${parent.id}:${e.authorId}`,
          email: {
            subject: `${name} replied to your comment`,
            heading: `${name} replied to your comment`,
            paragraphs: [`${name} replied to your comment on Charter Mission.`],
            buttonLabel: 'View the reply',
          },
        });
      }
    }
    if (post.authorId !== parentAuthor) {
      await this.notify.notify({
        userId: post.authorId,
        type: 'comment_on_post',
        actorId: e.authorId,
        objectType: 'post',
        objectId: post.id,
        segments: [{ text: ' commented on your post', strong: false }],
        href,
        icon: 'avatar',
        // CM-NTF-05: one notification per actor, object and type within 15 minutes.
        dedupeKey: `comment_on_post:${post.id}:${e.authorId}`,
        email: {
          subject: `${name} commented on your post`,
          heading: `${name} commented on your post`,
          paragraphs: [`${name} commented on your post on Charter Mission.`],
          buttonLabel: 'View the comment',
        },
      });
    }
  }

  /** Reactions are batched per object for an hour: "Amina and 4 others reacted to your post". */
  private async onReaction(e: { targetType: 'post' | 'comment'; targetId: string; userId: string }) {
    let recipient: string;
    let href: string;
    if (e.targetType === 'post') {
      const [post] = await this.db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, e.targetId)).limit(1);
      if (!post) return;
      recipient = post.authorId;
      href = `/posts/${e.targetId}`;
    } else {
      const [comment] = await this.db
        .select({ authorId: comments.authorId, postId: comments.postId })
        .from(comments)
        .where(eq(comments.id, e.targetId))
        .limit(1);
      if (!comment) return;
      recipient = comment.authorId;
      href = `/posts/${comment.postId}#comment-${e.targetId}`;
    }
    await this.notify.notify({
      userId: recipient,
      type: 'reaction',
      actorId: e.userId,
      objectType: e.targetType,
      objectId: e.targetId,
      segments: [{ text: ` reacted to your ${e.targetType}`, strong: false }],
      href,
      icon: 'avatar',
      dedupeKey: `reaction:${e.targetType}:${e.targetId}`,
      windowMinutes: 60,
    });
  }

  private async onRepost(e: { postId: string; originalId: string; authorId: string }) {
    const [original] = await this.db.select({ authorId: posts.authorId }).from(posts).where(eq(posts.id, e.originalId)).limit(1);
    if (!original) return;
    await this.notify.notify({
      userId: original.authorId,
      type: 'repost',
      actorId: e.authorId,
      objectType: 'post',
      objectId: e.originalId,
      segments: [{ text: ' reposted your post', strong: false }],
      href: `/posts/${e.originalId}`,
      icon: 'avatar',
      dedupeKey: `repost:post:${e.originalId}`,
      windowMinutes: 60,
    });
  }

  /** CM-FED rule: a failed scan rejects the attachment and notifies the author. */
  private async onUploadRejected(e: { fileId: string; ownerId: string }) {
    const [file] = await this.db.select().from(files).where(eq(files.id, e.fileId)).limit(1);
    if (!file) return;
    const [attached] = await this.db
      .select({ postId: postAttachments.postId })
      .from(postAttachments)
      .where(eq(postAttachments.fileId, e.fileId))
      .limit(1);
    await this.notify.notify({
      userId: e.ownerId,
      type: 'upload_rejected',
      objectType: 'file',
      objectId: e.fileId,
      segments: [
        { text: 'Your file ', strong: false },
        { text: file.originalName ?? 'upload', strong: true },
        { text: ` was not accepted: ${file.rejectionReason ?? 'it failed our checks'}.`, strong: false },
      ],
      href: attached ? `/posts/${attached.postId}` : '/',
      icon: 'alert',
      dedupeKey: `upload_rejected:${e.fileId}`,
    });
  }

  /** Followers of a tag that newly entered the global top 5; at most one per tag per day. */
  private async onTrending(e: { tags: string[] }) {
    const day = new Date().toISOString().slice(0, 10);
    for (const tag of e.tags) {
      const [h] = await this.db.select().from(hashtags).where(eq(hashtags.tag, tag.toLowerCase())).limit(1);
      if (!h) continue;
      const followers = await this.db
        .select({ userId: follows.followerId })
        .from(follows)
        .where(and(eq(follows.targetType, 'hashtag'), eq(follows.targetId, h.tag)));
      for (const f of followers) {
        await this.notify.notify({
          userId: f.userId,
          type: 'trending_followed_topic',
          objectType: 'hashtag',
          objectId: h.tag,
          segments: [
            { text: `#${h.display}`, strong: true },
            { text: ' is trending in Africa', strong: false },
          ],
          href: `/topics/${h.tag}`,
          icon: 'trending',
          dedupeKey: `trending:${h.tag}:${day}`,
          windowMinutes: 24 * 60,
        });
      }
    }
  }
}
