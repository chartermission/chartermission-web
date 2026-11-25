import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { milestonesReached, postViewDays, posts } from '../db/schema.js';
import { NotifyService } from '../core/notify.service.js';
import { EventsService } from '../infra/events.service.js';
import { QueueService } from '../infra/queue.service.js';

/** Impressions milestones, each announced once per post (LinkedIn-style "Your post is doing well"). */
export const IMPRESSION_MILESTONES = [100, 500, 1000, 5000, 10000, 50000, 100000];
/** Reactions milestones, each announced once per post. */
export const REACTION_MILESTONES = [10, 50, 100, 500, 1000, 5000];
/**
 * "Doing better than your usual": in its first 48 hours a post has at least TRENDING_FACTOR times the median
 * impressions of the author's last 10 posts (first 48 hours of each), with at least TRENDING_MIN_IMPRESSIONS and at
 * least TRENDING_MIN_HISTORY earlier posts to compare with. At most once per post.
 */
export const TRENDING_FACTOR = 2;
export const TRENDING_MIN_IMPRESSIONS = 50;
export const TRENDING_MIN_HISTORY = 3;
export const POST_TRENDING_JOB = 'post-trending';
const HOUR_MS = 3_600_000;

function excerpt(body: string, max = 80): string {
  const text = body.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * Post performance notifications for authors. Milestones are checked where the counters change (a view beacon, a
 * reaction) against the post's own totals, never by scanning; "doing better than usual" runs hourly over posts from
 * the last 48 hours, because it compares with the author's earlier posts.
 */
@Injectable()
export class PostMilestonesService implements OnModuleInit {
  private readonly logger = new Logger('PostMilestones');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly events: EventsService,
    private readonly queue: QueueService,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit() {
    this.events.on('post.milestone', (e) => this.announce(e.postId, e.metric, e.threshold));
    this.events.on('reaction.created', async (e) => {
      if (e.targetType === 'post') await this.checkReactions(e.targetId);
    });
    this.queue.process('maintenance', async (name) => {
      if (name === POST_TRENDING_JOB) await this.trending();
    });
    this.queue.every('maintenance', POST_TRENDING_JOB, HOUR_MS).catch((err: unknown) => {
      this.logger.warn(`Could not schedule ${POST_TRENDING_JOB}: ${String(err)}`);
    });
  }

  /**
   * After views were recorded: one read of these posts' totals and the highest milestone already announced; a claim
   * (and an event for the worker) only when a post passed a new one.
   */
  async checkImpressions(postIds: string[]): Promise<void> {
    if (!postIds.length) return;
    const ids = sql.join(
      postIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const rows = await this.db.execute<{ post_id: string; total: number; claimed: number }>(sql`
      select d.post_id, d.total, coalesce(max(m.threshold), 0)::int as claimed
      from (
        select post_id, sum(impressions)::int as total from ${postViewDays}
        where post_id in (${ids}) group by post_id having sum(impressions) >= ${IMPRESSION_MILESTONES[0]!}
      ) d
      left join ${milestonesReached} m on m.subject_type = 'post' and m.subject_id = d.post_id and m.metric = 'impressions'
      group by d.post_id, d.total`);
    for (const r of rows.rows) {
      const due = IMPRESSION_MILESTONES.filter((m) => m <= r.total && m > r.claimed);
      if (due.length) await this.claim(r.post_id, 'impressions', due, true);
    }
  }

  /** On a reaction (in the worker): the post's reaction counter against the milestones. */
  async checkReactions(postId: string): Promise<void> {
    const [post] = await this.db.select({ n: posts.reactionCount }).from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post) return;
    const due = REACTION_MILESTONES.filter((m) => m <= post.n);
    if (due.length) await this.claim(postId, 'reactions', due, false);
  }

  /** Claims the milestones (once each, whoever gets there first) and announces the highest newly claimed one. */
  private async claim(postId: string, metric: 'impressions' | 'reactions', thresholds: number[], viaEvent: boolean) {
    const claimed = await this.db
      .insert(milestonesReached)
      .values(thresholds.map((threshold) => ({ subjectType: 'post', subjectId: postId, metric, threshold })))
      .onConflictDoNothing()
      .returning({ threshold: milestonesReached.threshold });
    if (!claimed.length) return;
    const top = Math.max(...claimed.map((c) => c.threshold));
    if (viaEvent) await this.events.emit({ type: 'post.milestone', postId, metric, threshold: top });
    else await this.announce(postId, metric, top);
  }

  private async announce(postId: string, metric: 'impressions' | 'reactions', threshold: number) {
    const [post] = await this.db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post || post.deletedAt || post.repostOfId) return;
    const text = excerpt(typeof post.details?.title === 'string' ? post.details.title : post.body);
    await this.notify.notify({
      userId: post.authorId,
      type: 'post_milestone',
      objectType: 'post',
      objectId: postId,
      segments: [
        { text: 'Your post is doing well: ', strong: false },
        { text: threshold.toLocaleString('en-US'), strong: true },
        { text: metric === 'impressions' ? ' impressions' : ' reactions', strong: false },
        ...(text ? [{ text: ` “${text}”`, strong: false }] : []),
      ],
      href: `/posts/${postId}/analytics`,
      icon: 'chart',
      dedupeKey: `post_milestone:${postId}:${metric}:${threshold}`,
    });
  }

  /** Hourly: posts from the last 48 hours doing at least twice as well as the author's usual. */
  async trending(): Promise<number> {
    const rows = await this.db.execute<{ id: string; author_id: string; impressions: number }>(sql`
      with recent as (
        select p.id, p.author_id, p.created_at, coalesce(sum(d.impressions), 0)::int as impressions
        from ${posts} p
        left join ${postViewDays} d on d.post_id = p.id
        where p.created_at > now() - interval '48 hours'
          and p.status = 'published' and p.moderation_state = 'visible' and p.deleted_at is null
          and p.repost_of_id is null and p.page_id is null
          and not exists (
            select 1 from ${milestonesReached} m
            where m.subject_type = 'post' and m.subject_id = p.id and m.metric = 'trending'
          )
        group by p.id
        having coalesce(sum(d.impressions), 0) >= ${TRENDING_MIN_IMPRESSIONS}
      )
      select r.id, r.author_id, r.impressions
      from recent r
      cross join lateral (
        select count(*)::int as n, coalesce(percentile_cont(0.5) within group (order by h.impressions), 0) as median
        from (
          select (
            select coalesce(sum(d2.impressions), 0) from ${postViewDays} d2
            where d2.post_id = p2.id and d2.day <= (p2.created_at at time zone 'utc')::date + 2
          ) as impressions
          from ${posts} p2
          where p2.author_id = r.author_id and p2.created_at < r.created_at
            and p2.status = 'published' and p2.deleted_at is null and p2.repost_of_id is null and p2.page_id is null
          order by p2.created_at desc
          limit 10
        ) h
      ) usual
      where usual.n >= ${TRENDING_MIN_HISTORY} and r.impressions >= ${TRENDING_FACTOR} * usual.median`);
    let sent = 0;
    for (const r of rows.rows) {
      const claimed = await this.db
        .insert(milestonesReached)
        .values({ subjectType: 'post', subjectId: r.id, metric: 'trending', threshold: 0 })
        .onConflictDoNothing()
        .returning({ id: milestonesReached.subjectId });
      if (!claimed.length) continue;
      const [post] = await this.db.select({ body: posts.body, details: posts.details }).from(posts).where(eq(posts.id, r.id)).limit(1);
      const text = post ? excerpt(typeof post.details?.title === 'string' ? post.details.title : post.body) : '';
      await this.notify.notify({
        userId: r.author_id,
        type: 'post_trending',
        objectType: 'post',
        objectId: r.id,
        segments: [
          { text: 'Your post is doing better than usual', strong: false },
          ...(text ? [{ text: ` “${text}”`, strong: false }] : []),
        ],
        href: `/posts/${r.id}/analytics`,
        icon: 'trending',
        dedupeKey: `post_trending:${r.id}`,
      });
      sent++;
    }
    return sent;
  }
}
