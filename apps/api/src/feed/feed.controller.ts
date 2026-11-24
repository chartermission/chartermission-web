import { Controller, Get } from '@nestjs/common';
import { FeedNewQuery, FeedQuery, type FeedNewResponse, type Page, type PostView } from '@chartermission/contracts';
import { Access, Auth, OptionalAuth, checkAccess } from '../core/guards.js';
import { Errors } from '../common/errors.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZQuery } from '../common/validation.js';
import { FeedService } from './feed.service.js';

@Controller()
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  /**
   * Unverified members can read the feed (access "member"). Visitors may read one public group's
   * posts (?group=), as they may open the group itself; everything else needs a sign-in.
   */
  @Get('feed')
  feed(@OptionalAuth() auth: AuthContext | undefined, @ZQuery(FeedQuery) q: FeedQuery): Promise<Page<PostView>> {
    if (!auth) {
      if (!q.group) throw Errors.unauthenticated();
      return this.feedService.groupFeed(undefined, q);
    }
    checkAccess(auth, 'member');
    return this.feedService.feed(auth.user, q);
  }

  /** Count of newer posts for the "See N new posts" pill (polled by the web feed). */
  @Get('feed/new')
  @Access('member')
  newPosts(@Auth() ctx: AuthContext, @ZQuery(FeedNewQuery) q: FeedNewQuery): Promise<FeedNewResponse> {
    return this.feedService.newSince(ctx.user, q);
  }
}
