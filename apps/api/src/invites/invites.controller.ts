import { Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AdminReferralsExportQuery,
  AdminReferralsQuery,
  InvitePreviewQuery,
  SendInvitesInput,
  type AdminReferrals,
  type InvitePreview,
  type InviteRef,
  type MyReferrals,
  type SendInvitesResult,
} from '@chartermission/contracts';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { Access, Auth } from '../core/guards.js';
import { parseOrThrow, ZBody, ZQuery } from '../common/validation.js';
import { InvitesService } from './invites.service.js';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /** POST /invites: email an invitation to Charter Mission, a chapter or an event. */
  @Post()
  @HttpCode(200)
  @Access('member')
  send(@Auth() ctx: AuthContext, @ZBody(SendInvitesInput) input: SendInvitesInput): Promise<SendInvitesResult> {
    return this.invites.send(ctx.user, input);
  }

  /** GET /invites/preview: what an invitation link is for (no sign-in needed). */
  @Get('preview')
  preview(@ZQuery(InvitePreviewQuery) q: InviteRef): Promise<InvitePreview> {
    return this.invites.preview(q);
  }

  /** GET /invites/mine: the people who joined through the viewer's invitations. */
  @Get('mine')
  @Access('member')
  mine(@Auth() ctx: AuthContext): Promise<MyReferrals> {
    return this.invites.mine(ctx.user);
  }
}

/** GET /admin/referrals: who invited whom, with filters, paging and a CSV export. */
@Controller('admin/referrals')
export class AdminReferralsController {
  constructor(private readonly invites: InvitesService) {}

  @Get()
  @Access('admin', 'members.manage')
  report(@ZQuery(AdminReferralsQuery) q: AdminReferralsQuery): Promise<AdminReferrals> {
    return this.invites.adminReport(q);
  }

  /** The filtered sign-ups as CSV (streamed). Every export is audited. */
  @Get('export.csv')
  @Access('admin', 'members.manage')
  async export(@Auth() ctx: AuthContext, @Query() query: unknown, @Req() req: AppRequest, @Res() res: Response): Promise<void> {
    const q = parseOrThrow(AdminReferralsExportQuery, query);
    await this.invites.exportCsv(ctx, q, res, clientIp(req));
  }
}
