import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import {
  AdminAwardBadgeInput,
  AdminBadgeInput,
  AdminBadgeUpdateInput,
  AdminChapterCreateInput,
  AdminChaptersQuery,
  AdminChapterUpdateInput,
  AdminMembersQuery,
  AdminSetFeaturedInput,
  AdminSetOfficialInput,
  AdminSetVerifiedInput,
  AdminTopicCreateInput,
  AdminTopicsQuery,
  AdminTopicUpdateInput,
  type AdminBadge,
  type AdminChapterRow,
  type AdminMemberRow,
  type AdminTopicRow,
  type Ok,
  type Page,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { AdminChaptersService } from './admin-chapters.service.js';
import { AdminTopicsService } from './admin-topics.service.js';
import { AdminMembersService } from './admin-members.service.js';

/** Chapter catalogue: create, rename, activate / deactivate, pictures and covers, remove unused. */
@Controller('admin/chapters')
export class AdminChaptersController {
  constructor(private readonly chapters: AdminChaptersService) {}

  @Get()
  @Access('admin', 'chapters.admin')
  list(@ZQuery(AdminChaptersQuery) q: AdminChaptersQuery): Promise<AdminChapterRow[]> {
    return this.chapters.list(q);
  }

  @Post()
  @HttpCode(201)
  @Access('admin', 'chapters.admin')
  create(@Auth() ctx: AuthContext, @ZBody(AdminChapterCreateInput) input: AdminChapterCreateInput, @Req() req: AppRequest): Promise<AdminChapterRow> {
    return this.chapters.create(ctx, input, clientIp(req));
  }

  @Patch(':id')
  @Access('admin', 'chapters.admin')
  update(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AdminChapterUpdateInput) input: AdminChapterUpdateInput,
    @Req() req: AppRequest,
  ): Promise<AdminChapterRow> {
    return this.chapters.update(ctx, id, input, clientIp(req));
  }

  @Delete(':id')
  @Access('admin', 'chapters.admin')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    return this.chapters.remove(ctx, id, clientIp(req));
  }
}

/** Topic (hashtag) catalogue: add, feature, activate / deactivate, remove unused. */
@Controller('admin/topics')
export class AdminTopicsController {
  constructor(private readonly topics: AdminTopicsService) {}

  @Get()
  @Access('admin', 'trending.manage')
  list(@ZQuery(AdminTopicsQuery) q: AdminTopicsQuery): Promise<AdminTopicRow[]> {
    return this.topics.list(q);
  }

  @Post()
  @HttpCode(201)
  @Access('admin', 'trending.manage')
  create(@Auth() ctx: AuthContext, @ZBody(AdminTopicCreateInput) input: AdminTopicCreateInput, @Req() req: AppRequest): Promise<AdminTopicRow> {
    return this.topics.create(ctx, input, clientIp(req));
  }

  @Patch(':id')
  @Access('admin', 'trending.manage')
  update(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AdminTopicUpdateInput) input: AdminTopicUpdateInput,
    @Req() req: AppRequest,
  ): Promise<AdminTopicRow> {
    return this.topics.update(ctx, id, input, clientIp(req));
  }

  @Delete(':id')
  @Access('admin', 'trending.manage')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    return this.topics.remove(ctx, id, clientIp(req));
  }
}

/** Profile badge catalogue. */
@Controller('admin/badges')
export class AdminBadgesController {
  constructor(private readonly members: AdminMembersService) {}

  /** Members managers read the catalogue to award badges. */
  @Get()
  @Access('admin', 'members.manage')
  list(): Promise<AdminBadge[]> {
    return this.members.badges();
  }

  @Post()
  @HttpCode(201)
  @Access('admin', 'badges.manage')
  create(@Auth() ctx: AuthContext, @ZBody(AdminBadgeInput) input: AdminBadgeInput, @Req() req: AppRequest): Promise<AdminBadge> {
    return this.members.createBadge(ctx, input, clientIp(req));
  }

  @Patch(':id')
  @Access('admin', 'badges.manage')
  update(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AdminBadgeUpdateInput) input: AdminBadgeUpdateInput,
    @Req() req: AppRequest,
  ): Promise<AdminBadge> {
    return this.members.updateBadge(ctx, id, input, clientIp(req));
  }

  @Delete(':id')
  @Access('admin', 'badges.manage')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    return this.members.removeBadge(ctx, id, clientIp(req));
  }
}

/** Member controls: verified tick, badges and featured sign-up suggestions. */
@Controller('admin/members')
export class AdminMembersController {
  constructor(private readonly members: AdminMembersService) {}

  @Get()
  @Access('admin', 'members.manage')
  list(@ZQuery(AdminMembersQuery) q: AdminMembersQuery): Promise<Page<AdminMemberRow>> {
    return this.members.list(q);
  }

  @Get(':id')
  @Access('admin', 'members.manage')
  get(@Param('id') id: string): Promise<AdminMemberRow> {
    return this.members.row(id);
  }

  @Put(':id/verified')
  @Access('admin', 'members.manage')
  verified(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AdminSetVerifiedInput) input: AdminSetVerifiedInput,
    @Req() req: AppRequest,
  ): Promise<AdminMemberRow> {
    return this.members.setVerified(ctx, id, input.verified, clientIp(req));
  }

  @Put(':id/official')
  @Access('admin', 'members.manage')
  official(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AdminSetOfficialInput) input: AdminSetOfficialInput,
    @Req() req: AppRequest,
  ): Promise<AdminMemberRow> {
    return this.members.setOfficial(ctx, id, input.official, clientIp(req));
  }

  @Put(':id/featured')
  @Access('admin', 'members.manage')
  featured(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AdminSetFeaturedInput) input: AdminSetFeaturedInput,
    @Req() req: AppRequest,
  ): Promise<AdminMemberRow> {
    return this.members.setFeatured(ctx, id, input.featured, clientIp(req));
  }

  @Post(':id/badges')
  @HttpCode(201)
  @Access('admin', 'members.manage')
  award(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AdminAwardBadgeInput) input: AdminAwardBadgeInput,
    @Req() req: AppRequest,
  ): Promise<AdminMemberRow> {
    return this.members.award(ctx, id, input, clientIp(req));
  }

  @Delete(':id/badges/:badgeId')
  @Access('admin', 'members.manage')
  revoke(@Auth() ctx: AuthContext, @Param('id') id: string, @Param('badgeId') badgeId: string, @Req() req: AppRequest): Promise<AdminMemberRow> {
    return this.members.revoke(ctx, id, badgeId, clientIp(req));
  }
}
