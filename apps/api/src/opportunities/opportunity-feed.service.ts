import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { CreatePostInput } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { posts } from '../db/schema.js';
import { SessionService } from '../core/session.service.js';
import { PostsService } from '../posts/posts.service.js';
import type { OpportunityRow } from './opportunities.service.js';

/**
 * Shares a new opportunity to the feed: one post carrying the listing's card (posts.opportunity_id),
 * by the poster, or as the listing's page when it has one (page listings from Charter Mission's
 * official pages reach every member, like every official-page post).
 *
 * The post goes through PostsService.create like any other (status, hashtags, the post.created event
 * that tells followers, group/chapter rules), as a trusted internal share: it doesn't count towards
 * the poster's daily posts, and staff who posted a listing as a page needn't manage that page.
 */
@Injectable()
export class OpportunityFeedService {
  private readonly log = new Logger(OpportunityFeedService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly posts: PostsService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Idempotent: a listing already shared by its poster (or as its page) is not shared again. Never
   * throws: the listing stands even when its post can't be made (the page was taken down, the
   * poster can't post right now); returns the post's id, or null.
   */
  async share(row: OpportunityRow): Promise<string | null> {
    const [existing] = await this.db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.opportunityId, row.id), eq(posts.authorId, row.posterId), row.pageId ? eq(posts.pageId, row.pageId) : isNull(posts.pageId)))
      .limit(1);
    if (existing) return existing.id;
    try {
      const author = await this.sessions.userById(row.posterId);
      if (!author || author.status !== 'active') return null;
      const input = CreatePostInput.parse({ body: '', opportunityId: row.id, ...(row.pageId ? { pageId: row.pageId } : {}) });
      const post = await this.posts.create(author, input, { internal: true });
      return post.id;
    } catch (err) {
      this.log.warn(`Opportunity ${row.id} was not shared to the feed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
