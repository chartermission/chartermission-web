import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import {
  AdminPageCreateInput,
  AdminPagesQuery,
  AdminPageStatusInput,
  AdminPageUpdateInput,
  AdminVerificationDecisionInput,
  AdminVerificationQuery,
  PageAdminInput,
  PageInput,
  PagesQuery,
  PagesSettings,
  PageUpdateInput,
  Uuid,
  VerificationApplyInput,
  type AdminPageRow,
  type AdminQueueCounts,
  type AdminVerificationRow,
  type ManagedPage,
  type Ok,
  type Page,
  type PageAdminView,
  type PageDetail,
  type PageSummary,
  type VerificationStatus,
} from '@chartermission/contracts';
import { z } from 'zod';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { AdminPagesService } from './admin-pages.service.js';
import { PagesService } from './pages.service.js';
import { VerificationService } from './verification.service.js';

const TransferInput = z.object({ userId: Uuid });
type TransferInput = z.infer<typeof TransferInput>;

/** Pages in the member app (contracts/pages.ts). */
@Controller()
export class PagesController {
  constructor(
    private readonly pages: PagesService,
    private readonly verification: VerificationService,
  ) {}

  @Get('pages')
  @Access('member')
  list(@Auth() ctx: AuthContext, @ZQuery(PagesQuery) q: PagesQuery): Promise<Page<PageSummary>> {
    return this.pages.list(ctx.user, q);
  }

  @Get('pages/settings')
  @Access('member')
  settings(): Promise<PagesSettings> {
    return this.pages.policy();
  }

  @Get('me/pages')
  @Access('member')
  mine(@Auth() ctx: AuthContext): Promise<ManagedPage[]> {
    return this.pages.managed(ctx.user.id);
  }

  @Post('pages')
  @HttpCode(201)
  @Access('verified')
  create(@Auth() ctx: AuthContext, @ZBody(PageInput) input: PageInput, @Req() req: AppRequest): Promise<PageDetail> {
    return this.pages.create(ctx.user, input, clientIp(req));
  }

  @Get('pages/:slug')
  @Access('member')
  detail(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<PageDetail> {
    return this.pages.detail(ctx.user, slug);
  }

  @Patch('pages/:slug')
  @Access('verified')
  update(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(PageUpdateInput) input: PageUpdateInput, @Req() req: AppRequest): Promise<PageDetail> {
    return this.pages.update(ctx.user, slug, input, clientIp(req));
  }

  @Delete('pages/:slug')
  @Access('verified')
  remove(@Auth() ctx: AuthContext, @Param('slug') slug: string, @Req() req: AppRequest): Promise<Ok> {
    return this.pages.remove(ctx.user, slug, clientIp(req));
  }

  @Post('pages/:slug/admins')
  @HttpCode(200)
  @Access('verified')
  addAdmin(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(PageAdminInput) input: PageAdminInput, @Req() req: AppRequest): Promise<PageAdminView[]> {
    return this.pages.addAdmin(ctx.user, slug, input.handle, clientIp(req));
  }

  @Delete('pages/:slug/admins/:userId')
  @Access('verified')
  removeAdmin(@Auth() ctx: AuthContext, @Param('slug') slug: string, @UuidParam('userId') userId: string, @Req() req: AppRequest): Promise<PageAdminView[]> {
    return this.pages.removeAdmin(ctx.user, slug, userId, clientIp(req));
  }

  @Post('pages/:slug/owner')
  @HttpCode(200)
  @Access('verified')
  transfer(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(TransferInput) input: TransferInput, @Req() req: AppRequest): Promise<PageAdminView[]> {
    return this.pages.transfer(ctx.user, slug, input.userId, clientIp(req));
  }

  /* Verification requests: for a page, and for the member themselves. */

  @Get('pages/:slug/verification')
  @Access('member')
  pageVerification(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<VerificationStatus> {
    return this.verification.pageStatus(ctx.user, slug);
  }

  @Post('pages/:slug/verification')
  @HttpCode(200)
  @Access('verified')
  applyForPage(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(VerificationApplyInput) input: VerificationApplyInput): Promise<VerificationStatus> {
    return this.verification.applyAsPage(ctx.user, slug, input);
  }

  @Delete('pages/:slug/verification')
  @Access('verified')
  withdrawForPage(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<Ok> {
    return this.verification.withdraw(ctx.user, slug);
  }

  @Get('me/verification')
  @Access('member')
  myVerification(@Auth() ctx: AuthContext): Promise<VerificationStatus> {
    return this.verification.memberStatus(ctx.user);
  }

  @Post('me/verification')
  @HttpCode(200)
  @Access('verified')
  apply(@Auth() ctx: AuthContext, @ZBody(VerificationApplyInput) input: VerificationApplyInput): Promise<VerificationStatus> {
    return this.verification.applyAsMember(ctx.user, input);
  }

  @Delete('me/verification')
  @Access('verified')
  withdraw(@Auth() ctx: AuthContext): Promise<Ok> {
    return this.verification.withdraw(ctx.user);
  }
}

/** Admin console: pages, the verification queue and their settings. */
@Controller('admin')
export class AdminPagesController {
  constructor(
    private readonly pages: AdminPagesService,
    private readonly verification: VerificationService,
  ) {}

  @Get('queues')
  @Access('admin')
  queues(): Promise<AdminQueueCounts> {
    return this.pages.queueCounts();
  }

  @Get('pages')
  @Access('admin', 'pages.manage')
  list(@ZQuery(AdminPagesQuery) q: AdminPagesQuery): Promise<Page<AdminPageRow>> {
    return this.pages.list(q);
  }

  @Post('pages')
  @HttpCode(201)
  @Access('admin', 'pages.manage')
  create(@Auth() ctx: AuthContext, @ZBody(AdminPageCreateInput) input: AdminPageCreateInput, @Req() req: AppRequest): Promise<AdminPageRow> {
    return this.pages.create(ctx, input, clientIp(req));
  }

  @Patch('pages/:id')
  @Access('admin', 'pages.manage')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @ZBody(AdminPageUpdateInput) input: AdminPageUpdateInput, @Req() req: AppRequest): Promise<AdminPageRow> {
    return this.pages.update(ctx, id, input, clientIp(req));
  }

  @Post('pages/:id/status')
  @HttpCode(200)
  @Access('admin', 'pages.manage')
  setStatus(@Auth() ctx: AuthContext, @Param('id') id: string, @ZBody(AdminPageStatusInput) input: AdminPageStatusInput, @Req() req: AppRequest): Promise<AdminPageRow> {
    return this.pages.setStatus(ctx, id, input, clientIp(req));
  }

  @Delete('pages/:id')
  @Access('admin', 'pages.manage')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    return this.pages.remove(ctx, id, clientIp(req));
  }

  @Get('settings/pages')
  @Access('admin', 'pages.manage')
  getSettings(): Promise<PagesSettings> {
    return this.pages.getSettings();
  }

  @Put('settings/pages')
  @Access('admin', 'settings.manage')
  setSettings(@Auth() ctx: AuthContext, @ZBody(PagesSettings) input: PagesSettings, @Req() req: AppRequest): Promise<PagesSettings> {
    return this.pages.setSettings(ctx, input, clientIp(req));
  }

  @Get('verification')
  @Access('admin', 'members.manage')
  verificationQueue(@ZQuery(AdminVerificationQuery) q: AdminVerificationQuery): Promise<Page<AdminVerificationRow>> {
    return this.verification.adminList(q);
  }

  @Post('verification/:id/decision')
  @HttpCode(200)
  @Access('admin', 'members.manage')
  decide(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AdminVerificationDecisionInput) input: AdminVerificationDecisionInput,
    @Req() req: AppRequest,
  ): Promise<AdminVerificationRow> {
    return this.verification.decide(ctx, id, input, clientIp(req));
  }
}
