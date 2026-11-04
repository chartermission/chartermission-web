import { Controller, Get } from '@nestjs/common';
import { FeedNewQuery, FeedQuery, type FeedNewResponse, type Page, type PostView } from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZQuery } from '../common/validation.js';
import { FeedService } from './feed.service.js';

@Controller()
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  /** Unverified members can read the feed (access "member"). */
  @Get('feed')
  @Access('member')
  feed(@Auth() ctx: AuthContext, @ZQuery(FeedQuery) q: FeedQuery): Promise<Page<PostView>> {
    return this.feedService.feed(ctx.user, q);
  }

  /** Count of newer posts for the "See N new posts" pill (polled by the web feed). */
  @Get('feed/new')
  @Access('member')
  newPosts(@Auth() ctx: AuthContext, @ZQuery(FeedNewQuery) q: FeedNewQuery): Promise<FeedNewResponse> {
    return this.feedService.newSince(ctx.user, q);
  }
}
