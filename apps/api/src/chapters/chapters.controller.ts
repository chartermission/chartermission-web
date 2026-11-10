import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import {
  ChapterBanInput,
  ChapterFraudReportInput,
  ChapterMembersQuery,
  ChapterPostReviewInput,
  PinChapterPostInput,
  UpdateChapterInput,
  type ChapterBan,
  type ChapterDetail,
  type ChapterReviewQueue,
  type ChapterSummary,
  type CreateReportResponse,
  type MemberRef,
  type Page,
  type PostView,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { ChaptersService } from './chapters.service.js';
import { ChapterModerationService } from './chapter-moderation.service.js';

/** Chapter pages (contracts/chapters.ts). Joining a chapter is a follow (POST /follows). */
@Controller('chapters')
export class ChaptersController {
  constructor(
    private readonly chapters: ChaptersService,
    private readonly moderation: ChapterModerationService,
  ) {}

  @Get()
  @Access('member')
  list(@Auth() ctx: AuthContext): Promise<ChapterSummary[]> {
    return this.chapters.list(ctx.user);
  }

  @Get(':slug')
  @Access('member')
  detail(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<ChapterDetail> {
    return this.chapters.detail(ctx.user, slug);
  }

  @Get(':slug/members')
  @Access('member')
  members(@Param('slug') slug: string, @ZQuery(ChapterMembersQuery) q: ChapterMembersQuery): Promise<Page<MemberRef>> {
    return this.chapters.membersPage(slug, q);
  }

  @Patch(':slug')
  @Access('verified')
  update(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(UpdateChapterInput) input: UpdateChapterInput, @Req() req: AppRequest): Promise<ChapterDetail> {
    return this.chapters.update(ctx.user, slug, input, clientIp(req));
  }

  @Post(':slug/pins')
  @Access('verified')
  pin(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(PinChapterPostInput) input: PinChapterPostInput, @Req() req: AppRequest): Promise<ChapterDetail> {
    return this.chapters.pin(ctx.user, slug, input, clientIp(req));
  }

  @Delete(':slug/pins/:postId')
  @Access('verified')
  unpin(@Auth() ctx: AuthContext, @Param('slug') slug: string, @UuidParam('postId') postId: string, @Req() req: AppRequest): Promise<ChapterDetail> {
    return this.chapters.unpin(ctx.user, slug, postId, clientIp(req));
  }

  /* ------------------------- The chapter team's moderation tools ------------------------- */

  @Get(':slug/review')
  @Access('verified')
  reviewQueue(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<ChapterReviewQueue> {
    return this.moderation.queue(ctx.user, slug);
  }

  @Post(':slug/posts/:postId/review')
  @HttpCode(200)
  @Access('verified')
  review(
    @Auth() ctx: AuthContext,
    @Param('slug') slug: string,
    @UuidParam('postId') postId: string,
    @ZBody(ChapterPostReviewInput) input: ChapterPostReviewInput,
    @Req() req: AppRequest,
  ): Promise<{ status: PostView['status'] }> {
    return this.moderation.review(ctx.user, slug, postId, input, clientIp(req));
  }

  @Get(':slug/bans')
  @Access('verified')
  bans(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<ChapterBan[]> {
    return this.moderation.bans(ctx.user, slug);
  }

  @Post(':slug/bans')
  @HttpCode(200)
  @Access('verified')
  ban(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(ChapterBanInput) input: ChapterBanInput, @Req() req: AppRequest): Promise<ChapterBan[]> {
    return this.moderation.ban(ctx.user, slug, input, clientIp(req));
  }

  @Delete(':slug/bans/:userId')
  @Access('verified')
  unban(@Auth() ctx: AuthContext, @Param('slug') slug: string, @UuidParam('userId') userId: string, @Req() req: AppRequest): Promise<ChapterBan[]> {
    return this.moderation.unban(ctx.user, slug, userId, clientIp(req));
  }

  @Post(':slug/fraud-reports')
  @Access('verified')
  reportFraud(
    @Auth() ctx: AuthContext,
    @Param('slug') slug: string,
    @ZBody(ChapterFraudReportInput) input: ChapterFraudReportInput,
    @Req() req: AppRequest,
  ): Promise<CreateReportResponse> {
    return this.moderation.reportFraud(ctx, slug, input, clientIp(req));
  }
}
