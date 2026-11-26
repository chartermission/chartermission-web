import { Injectable } from '@nestjs/common';
import type { OpportunityRow } from './opportunities.service.js';

/**
 * Shares a new opportunity to the feed: one post carrying the listing's card (posts.opportunity_id),
 * by the poster, or as the listing's page when it has one (page listings from Charter Mission's
 * official pages reach every member, like every official-page post).
 *
 * TODO(ws/OF): implement. Until then listings are created without a feed post.
 */
@Injectable()
export class OpportunityFeedService {
  async share(_row: OpportunityRow): Promise<void> {}
}
