import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  CreatorAnalyticsQuery,
  PostAnalyticsQuery,
  PostViewsInput,
  type CreatorAnalytics,
  type Ok,
  type PostAnalytics,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { PostAnalyticsService } from './post-analytics.service.js';

/** Post analytics: the view beacon and the author's numbers (contracts/pages.ts). */
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: PostAnalyticsService) {}

  @Post('posts/views')
  @HttpCode(200)
  @Access('member')
  async views(@Auth() ctx: AuthContext, @ZBody(PostViewsInput) input: PostViewsInput): Promise<Ok> {
    await this.analytics.recordViewsQuietly(ctx.user, input.postIds);
    return { ok: true };
  }

  @Get('posts/:id/analytics')
  @Access('member')
  post(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZQuery(PostAnalyticsQuery) q: PostAnalyticsQuery): Promise<PostAnalytics> {
    return this.analytics.forPost(ctx.user, id, q);
  }

  @Get('me/analytics')
  @Access('member')
  creator(@Auth() ctx: AuthContext, @ZQuery(CreatorAnalyticsQuery) q: CreatorAnalyticsQuery): Promise<CreatorAnalytics> {
    return this.analytics.forCreator(ctx.user, q);
  }
}
