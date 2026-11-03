import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  CreateAppealInput,
  CreateReportInput,
  CursorQuery,
  type AppealView,
  type CreateReportResponse,
  type MyModerationAction,
  type MyReport,
  type Page,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { ReportsService } from './reports.service.js';
import { AppealsService } from './appeals.service.js';

/** Member side of reporting and moderation (spec 4.15, 6.2 "Reports"). */
@Controller()
export class ModerationController {
  constructor(
    private readonly reports: ReportsService,
    private readonly appeals: AppealsService,
  ) {}

  /** Report a post, comment, member or topic. Verified members only; 20 per day. */
  @Post('reports')
  @HttpCode(201)
  @Access('verified', 'report.create')
  createReport(
    @Auth() ctx: AuthContext,
    @ZBody(CreateReportInput) input: CreateReportInput,
    @Req() req: AppRequest,
  ): Promise<CreateReportResponse> {
    return this.reports.create(ctx, input, clientIp(req));
  }

  @Get('me/reports')
  @Access('session')
  myReports(@Auth() ctx: AuthContext, @ZQuery(CursorQuery) q: CursorQuery): Promise<Page<MyReport>> {
    return this.reports.mine(ctx.user.id, q);
  }

  /** Suspended members can still see what happened and appeal ("session" access). */
  @Get('me/moderation-actions')
  @Access('session')
  myActions(@Auth() ctx: AuthContext): Promise<MyModerationAction[]> {
    return this.appeals.myActions(ctx.user.id);
  }

  @Post('appeals')
  @HttpCode(201)
  @Access('session', 'appeal.create')
  createAppeal(
    @Auth() ctx: AuthContext,
    @ZBody(CreateAppealInput) input: CreateAppealInput,
    @Req() req: AppRequest,
  ): Promise<AppealView> {
    return this.appeals.create(ctx, input, clientIp(req));
  }
}
