import { Injectable, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, posts } from '../db/schema.js';
import { ChapterRules } from '../core/chapter-rules.service.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';

const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Notifications for chapter moderation (from domain events, never inline). */
@Injectable()
export class ChapterModerationEvents implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly notify: NotifyService,
    private readonly rules: ChapterRules,
  ) {}

  onModuleInit() {
    // A post is waiting: tell the chapter's team (not the author, should they be on it).
    this.events.on('chapter.post_pending', async (e) => {
      const [chapter] = await this.db.select({ id: chapters.id, slug: chapters.slug, name: chapters.name }).from(chapters).where(eq(chapters.id, e.chapterId)).limit(1);
      if (!chapter) return;
      const team = (await this.rules.teamIds(chapter.id)).filter((id) => id !== e.authorId);
      for (const userId of team) {
        await this.notify.notify({
          userId,
          type: 'chapter_post_pending',
          actorId: e.authorId,
          objectType: 'post',
          objectId: e.postId,
          segments: [
            { text: ' posted in ', strong: false },
            { text: chapter.name, strong: true },
            { text: '. It is waiting for your approval.', strong: false },
          ],
          href: `/chapters/${chapter.slug}#review`,
          icon: 'shield',
          dedupeKey: `chapter-post-pending:${e.postId}:${userId}`,
        });
      }
    });

    // A decision was made: tell the author.
    this.events.on('chapter.post_reviewed', async (e) => {
      const [post] = await this.db.select().from(posts).where(eq(posts.id, e.postId)).limit(1);
      if (!post || post.authorId === e.actorId) return;
      const [chapter] = await this.db.select({ slug: chapters.slug, name: chapters.name }).from(chapters).where(eq(chapters.id, e.chapterId)).limit(1);
      if (!chapter) return;
      const note = post.chapterReviewNote?.trim();
      const copy = {
        approve: { lead: 'Your post was approved and is now live in ', tail: '', subject: `Your post is live in ${chapter.name}` },
        decline: { lead: 'Your post wasn’t approved for ', tail: '', subject: `Your post wasn’t approved for ${chapter.name}` },
        hold: { lead: 'Your post in ', tail: ' was taken back for review by the chapter team', subject: `Your post in ${chapter.name} is being reviewed` },
        remove: { lead: 'Your post was removed from ', tail: ' by the chapter team', subject: `Your post was removed from ${chapter.name}` },
      }[e.action];
      const good = e.action === 'approve';
      await this.notify.notify({
        userId: post.authorId,
        type: 'chapter_post_reviewed',
        objectType: 'post',
        objectId: post.id,
        segments: [
          { text: copy.lead, strong: false },
          { text: chapter.name, strong: true },
          { text: copy.tail + (!good && note ? `: “${clip(note)}”` : ''), strong: false },
        ],
        href: `/posts/${post.id}`,
        icon: good ? 'check' : 'alert',
        dedupeKey: `chapter-post-reviewed:${post.id}:${e.action}:${post.chapterReviewAt?.getTime() ?? 0}`,
        email: {
          subject: copy.subject,
          heading: copy.subject,
          paragraphs: [
            good
              ? `The ${chapter.name} team approved your post. Members of the chapter can now see it.`
              : e.action === 'hold'
                ? `The ${chapter.name} team has taken your post back for review. It is hidden from the chapter until they decide.`
                : `The ${chapter.name} team decided your post doesn’t belong in the chapter. Only you can still see it.`,
            ...(!good && note ? [`Their note: “${note}”`] : []),
          ],
          buttonLabel: 'Open your post',
        },
      });
    });

    this.events.on('chapter.banned', async (e) => {
      const [chapter] = await this.db.select({ slug: chapters.slug, name: chapters.name }).from(chapters).where(eq(chapters.id, e.chapterId)).limit(1);
      if (!chapter) return;
      await this.notify.notify({
        userId: e.userId,
        type: 'chapter_ban',
        objectType: 'chapter',
        objectId: e.chapterId,
        segments: [
          { text: 'You were removed from ', strong: false },
          { text: chapter.name, strong: true },
          { text: ' by its team. You can still read the chapter, but not join or post in it.', strong: false },
        ],
        href: `/chapters/${chapter.slug}`,
        icon: 'alert',
        dedupeKey: `chapter-ban:${e.chapterId}:${e.userId}:${Date.now()}`,
      });
    });
  }
}
