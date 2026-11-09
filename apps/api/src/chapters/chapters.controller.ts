import { Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import {
  ChapterMembersQuery,
  PinChapterPostInput,
  UpdateChapterInput,
  type ChapterDetail,
  type ChapterSummary,
  type MemberRef,
  type Page,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { ChaptersService } from './chapters.service.js';

/** Chapter pages (contracts/chapters.ts). Joining a chapter is a follow (POST /follows). */
@Controller('chapters')
export class ChaptersController {
  constructor(private readonly chapters: ChaptersService) {}

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
}
