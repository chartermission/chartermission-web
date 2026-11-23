import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AdminAwardBadgeInput,
  AdminBadgeInput,
  AdminBadgeUpdateInput,
  AdminChapterCreateInput,
  AdminChaptersBulkInput,
  AdminChaptersQuery,
  AdminChapterUpdateInput,
  AdminMembersBulkInput,
  AdminMembersExportInput,
  AdminMembersExportQuery,
  AdminMembersQuery,
  AdminSetFeaturedInput,
  AdminSetMcpAccessInput,
  AdminSetOfficialInput,
  AdminSetRoleInput,
  AdminSetVerifiedInput,
  AdminTopicCreateInput,
  AdminTopicsBulkInput,
  AdminTopicsImportInput,
  AdminTopicsQuery,
  AdminTopicUpdateInput,
  McpActivityQuery,
  type AdminBadge,
  type AdminChapterRow,
  type AdminMemberRow,
  type AdminMemberOverview,
  type AdminMembersPage,
  type BulkResult,
  type Page,
  type AdminTopicRow,
  type CsvImportResult,
  type McpActivityView,
  type Ok,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery, parseOrThrow } from '../common/validation.js';
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

  /** Activate, deactivate, set the posting rule of, or remove several chapters; each is audited on its own. */
  @Post('bulk')
  @HttpCode(200)
  @Access('admin', 'chapters.admin')
  bulk(@Auth() ctx: AuthContext, @ZBody(AdminChaptersBulkInput) input: AdminChaptersBulkInput, @Req() req: AppRequest): Promise<BulkResult> {
    return this.chapters.bulk(ctx, input, clientIp(req));
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

  /** Feature, unfeature, activate, deactivate or remove several topics; each is audited on its own. */
  @Post('bulk')
  @HttpCode(200)
  @Access('admin', 'trending.manage')
  bulk(@Auth() ctx: AuthContext, @ZBody(AdminTopicsBulkInput) input: AdminTopicsBulkInput, @Req() req: AppRequest): Promise<BulkResult> {
    return this.topics.bulk(ctx, input, clientIp(req));
  }

  /** Add or update topics from a CSV file (rows parsed by the console). dryRun previews without writing. */
  @Post('import')
  @HttpCode(200)
  @Access('admin', 'trending.manage')
  import(@Auth() ctx: AuthContext, @ZBody(AdminTopicsImportInput) input: AdminTopicsImportInput, @Req() req: AppRequest): Promise<CsvImportResult> {
    return this.topics.importCsv(ctx, input, clientIp(req));
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
  list(@ZQuery(AdminMembersQuery) q: AdminMembersQuery): Promise<AdminMembersPage> {
    return this.members.list(q);
  }

  /** The list's filters (or ?ids=a,b,c for picked members) as a CSV download. Streamed; audited. */
  @Get('export.csv')
  @Access('admin', 'members.manage')
  async export(@Auth() ctx: AuthContext, @Query() query: unknown, @Req() req: AppRequest, @Res() res: Response): Promise<void> {
    const q = parseOrThrow(AdminMembersExportQuery, query);
    await this.members.exportCsv(ctx, q, res, clientIp(req));
  }

  /** The picked members as a CSV download, ids in the body (a long pick doesn't fit in a link). Audited. */
  @Post('export.csv')
  @HttpCode(200)
  @Access('admin', 'members.manage')
  async exportPicked(
    @Auth() ctx: AuthContext,
    @ZBody(AdminMembersExportInput) input: AdminMembersExportInput,
    @Req() req: AppRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.members.exportPickedCsv(ctx, input, res, clientIp(req));
  }

  /** One change to many members: verified tick, sign-up suggestions, badges, Claude access. */
  @Post('bulk')
  @HttpCode(200)
  @Access('admin', 'members.manage')
  bulk(@Auth() ctx: AuthContext, @ZBody(AdminMembersBulkInput) input: AdminMembersBulkInput, @Req() req: AppRequest): Promise<BulkResult> {
    return this.members.bulk(ctx, input, clientIp(req));
  }

  @Get(':id')
  @Access('admin', 'members.manage')
  get(@Param('id') id: string): Promise<AdminMemberRow> {
    return this.members.row(id);
  }

  /** Everything the member detail panel shows. */
  @Get(':id/overview')
  @Access('admin', 'members.manage')
  overview(@Param('id') id: string): Promise<AdminMemberOverview> {
    return this.members.overview(id);
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

  /** Claude (MCP) access. Turning it off disconnects Claude from the account. */
  @Put(':id/mcp-access')
  @Access('admin', 'members.manage')
  mcpAccess(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AdminSetMcpAccessInput) input: AdminSetMcpAccessInput,
    @Req() req: AppRequest,
  ): Promise<AdminMemberRow> {
    return this.members.setMcpAccess(ctx, id, input.enabled, clientIp(req));
  }

  /** What Claude did for this member, newest first. */
  @Get(':id/mcp-activity')
  @Access('admin', 'members.manage')
  mcpActivity(@Param('id') id: string, @ZQuery(McpActivityQuery) q: McpActivityQuery): Promise<Page<McpActivityView>> {
    return this.members.mcpActivityPage(id, q);
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

  @Post(':id/two-step/reset')
  @HttpCode(200)
  @Access('admin', 'mfa.reset')
  resetTwoStep(@Auth() ctx: AuthContext, @Param('id') id: string, @Req() req: AppRequest): Promise<AdminMemberRow> {
    return this.members.resetTwoStep(ctx, id, clientIp(req));
  }

  @Put(':id/roles')
  @Access('admin', 'roles.manage')
  role(@Auth() ctx: AuthContext, @Param('id') id: string, @ZBody(AdminSetRoleInput) input: AdminSetRoleInput, @Req() req: AppRequest): Promise<AdminMemberRow> {
    return this.members.setRole(ctx, id, input, clientIp(req));
  }

  @Delete(':id/badges/:badgeId')
  @Access('admin', 'members.manage')
  revoke(@Auth() ctx: AuthContext, @Param('id') id: string, @Param('badgeId') badgeId: string, @Req() req: AppRequest): Promise<AdminMemberRow> {
    return this.members.revoke(ctx, id, badgeId, clientIp(req));
  }
}
