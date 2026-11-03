import { Controller, Get } from '@nestjs/common';
import { FeedQuery, type Page, type PostView } from '@chartermission/contracts';
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
}
