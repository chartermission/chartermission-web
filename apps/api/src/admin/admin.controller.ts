import { Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AdminActionInput,
  AdminAppealsQuery,
  AdminHiddenQuery,
  AdminQueueQuery,
  AdminTrendingQuery,
  AppealDecisionInput,
  AssignInput,
  AuditExportQuery,
  AuditQuery,
  DirectActionInput,
  RevokeOverrideInput,
  TrendingOverrideInput,
  TrendingRules,
  type AdminActionView,
  type AdminAppealRow,
  type AdminHiddenRow,
  type AdminReportDetail,
  type AdminReportRow,
  type AdminTrendingResponse,
  type AuditEntry,
  type Ok,
  type Page,
  type QueueStats,
  type ReportTargetType,
  type TrendingOverrideView,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { parseOrThrow, ZBody, ZQuery } from '../common/validation.js';
import { ModerationActionsService } from '../moderation/actions.service.js';
import { uuidOr404 } from '../moderation/util.js';
import { AdminQueueService } from './admin-queue.service.js';
import { AdminTrendingService } from './admin-trending.service.js';
import { AdminAuditService } from './admin-audit.service.js';

/**
 * Admin console: reports queue, moderation actions, hidden content and appeals
 * (CM-ADM-02/04/05/06). Every route needs an admin-audience session with MFA verified.
 */
@Controller('admin')
export class AdminModerationController {
  constructor(
    private readonly queue: AdminQueueService,
    private readonly actions: ModerationActionsService,
  ) {}

  @Get('queue/stats')
  @Access('admin', 'moderation.view')
  stats(): Promise<QueueStats> {
    return this.queue.stats();
  }

  @Get('reports')
  @Access('admin', 'moderation.view')
  reports(@Auth() ctx: AuthContext, @ZQuery(AdminQueueQuery) q: AdminQueueQuery): Promise<Page<AdminReportRow>> {
    return this.queue.list(ctx, q);
  }

  @Get('reports/:id')
  @Access('admin', 'moderation.view')
  report(@Param('id') id: string): Promise<AdminReportDetail> {
    return this.queue.detail(id);
  }

  @Post('reports/:id/assign')
  @HttpCode(200)
  @Access('admin', 'moderation.act')
  assign(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AssignInput) input: { assignee: 'me' | 'none' },
    @Req() req: AppRequest,
  ): Promise<AdminReportRow> {
    return this.queue.assign(ctx, id, input.assignee, clientIp(req));
  }

  /** Act on a report's target. Reason always required (CM-ADM-05). */
  @Post('reports/:id/actions')
  @HttpCode(201)
  @Access('admin', 'moderation.act')
  async actOnReport(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AdminActionInput) input: AdminActionInput,
    @Req() req: AppRequest,
  ): Promise<AdminActionView> {
    const rep = await this.queue.openReportTarget(id);
    return this.actions.act(ctx, { type: rep.targetType as ReportTargetType, id: rep.targetId }, input, {
      reportId: rep.id,
      ip: clientIp(req),
    });
  }

  /** Act without a report (e.g. from a member record or the hidden-content list). */
  @Post('moderation-actions')
  @HttpCode(201)
  @Access('admin', 'moderation.act')
  actDirect(
    @Auth() ctx: AuthContext,
    @ZBody(DirectActionInput) input: DirectActionInput,
    @Req() req: AppRequest,
  ): Promise<AdminActionView> {
    const { targetType, targetId, ...action } = input;
    return this.actions.act(ctx, { type: targetType, id: targetId }, action, { ip: clientIp(req) });
  }

  @Get('hidden')
  @Access('admin', 'moderation.view')
  hidden(@ZQuery(AdminHiddenQuery) q: AdminHiddenQuery): Promise<Page<AdminHiddenRow>> {
    return this.queue.hidden(q);
  }

  @Get('appeals')
  @Access('admin', 'moderation.view')
  appeals(@Auth() ctx: AuthContext, @ZQuery(AdminAppealsQuery) q: AdminAppealsQuery): Promise<Page<AdminAppealRow>> {
    return this.queue.appeals(ctx, q);
  }

  /** A different moderator from the one who took the action decides (CM-ADM-06). */
  @Post('appeals/:id/decide')
  @HttpCode(200)
  @Access('admin', 'appeal.decide')
  async decide(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(AppealDecisionInput) input: AppealDecisionInput,
    @Req() req: AppRequest,
  ): Promise<AdminAppealRow> {
    const appealId = uuidOr404(id, 'That appeal');
    await this.actions.decideAppeal(ctx, appealId, input, clientIp(req));
    return this.queue.appealRow(ctx, appealId);
  }
}

/** Trending controls: live ranking, pin / suppress overrides and rules. */
@Controller('admin/trending')
export class AdminTrendingController {
  constructor(private readonly trending: AdminTrendingService) {}

  @Get()
  @Access('admin', 'moderation.view')
  view(@ZQuery(AdminTrendingQuery) q: AdminTrendingQuery): Promise<AdminTrendingResponse> {
    return this.trending.view(q);
  }

  @Post('overrides')
  @HttpCode(201)
  @Access('admin', 'trending.manage')
  create(
    @Auth() ctx: AuthContext,
    @ZBody(TrendingOverrideInput) input: TrendingOverrideInput,
    @Req() req: AppRequest,
  ): Promise<TrendingOverrideView> {
    return this.trending.createOverride(ctx, input, clientIp(req));
  }

  @Delete('overrides/:id')
  @Access('admin', 'trending.manage')
  revoke(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @ZBody(RevokeOverrideInput) input: { reason: string },
    @Req() req: AppRequest,
  ): Promise<Ok> {
    return this.trending.revokeOverride(ctx, id, input.reason, clientIp(req));
  }

  @Put('rules')
  @Access('admin', 'trending.manage')
  rules(
    @Auth() ctx: AuthContext,
    @ZBody(TrendingRules) input: TrendingRules,
    @Req() req: AppRequest,
  ): Promise<TrendingRules> {
    return this.trending.updateRules(ctx, input, clientIp(req));
  }
}

/** Append-only audit log viewer and CSV export (CM-ADM-09). */
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  @Get()
  @Access('admin', 'audit.view')
  list(@ZQuery(AuditQuery) q: AuditQuery): Promise<Page<AuditEntry>> {
    return this.audit.list(q);
  }

  /** Platform Admins only (audit.export). Streamed; never includes before/after payloads. */
  @Get('export.csv')
  @Access('admin', 'audit.export')
  async export(
    @Auth() ctx: AuthContext,
    @Query() query: unknown,
    @Req() req: AppRequest,
    @Res() res: Response,
  ): Promise<void> {
    const q = parseOrThrow(AuditExportQuery, query);
    await this.audit.exportCsv(ctx, q, res, clientIp(req));
  }
}
