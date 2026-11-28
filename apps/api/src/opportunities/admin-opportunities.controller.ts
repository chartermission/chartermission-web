import { Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AdminApplicationsExportQuery,
  AdminApplicationsQuery,
  AdminOrganisationInput,
  DecideApplicationInput,
  type AdminApplicationsPage,
  type AdminApplicationView,
  type AdminNewApplicationsCount,
  type PageRef,
  AdminOpportunitiesBulkInput,
  AdminOpportunitiesQuery,
  AdminOpportunityAction,
  OpportunityImportInput,
  type AdminOpportunitiesPage,
  type AdminOpportunityPages,
  type AdminOpportunityRow,
  type BulkResult,
  type OpportunityImportResult,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery, parseOrThrow } from '../common/validation.js';
import { AdminOpportunitiesService } from './admin-opportunities.service.js';

/**
 * Admin console → Opportunities (contracts/opportunity-import.ts): every listing with staff actions,
 * and the import of opportunities pasted from WhatsApp groups and forums (via a CSV Claude writes).
 * Staff also review the applications to imported listings that take applications in Charter
 * Mission, and export them. All of it needs opportunity.manage (Platform Admins and up).
 */
@Controller('admin/opportunities')
export class AdminOpportunitiesController {
  constructor(private readonly admin: AdminOpportunitiesService) {}

  @Get()
  @Access('admin', 'opportunity.manage')
  list(@ZQuery(AdminOpportunitiesQuery) q: AdminOpportunitiesQuery): Promise<AdminOpportunitiesPage> {
    return this.admin.list(q);
  }

  /** The pages imported listings can be posted as: official ones first, then organisation pages staff run. */
  @Get('pages')
  @Access('admin', 'opportunity.manage')
  pages(): Promise<AdminOpportunityPages> {
    return this.admin.postAsPages();
  }

  /** "Create organisation" in the import: a live page run by staff, to post listings as. */
  @Post('organisations')
  @HttpCode(201)
  @Access('admin', 'opportunity.manage')
  createOrganisation(@Auth() ctx: AuthContext, @ZBody(AdminOrganisationInput) input: AdminOrganisationInput, @Req() req: AppRequest): Promise<PageRef> {
    return this.admin.createOrganisation(ctx, input, clientIp(req));
  }

  /** Undecided applications to imported listings (the sidebar badge). */
  @Get('applications/new-count')
  @Access('admin', 'opportunity.manage')
  newApplications(): Promise<AdminNewApplicationsCount> {
    return this.admin.newApplicationsCount();
  }

  /** { dryRun, pageId?, shareToFeed, rows: [{ row, values }] }: check the rows, or post them as the page. */
  @Post('import')
  @HttpCode(200)
  @Access('admin', 'opportunity.manage')
  import(@Auth() ctx: AuthContext, @ZBody(OpportunityImportInput) input: OpportunityImportInput, @Req() req: AppRequest): Promise<OpportunityImportResult> {
    return this.admin.import(ctx, input, clientIp(req));
  }

  /** Close, reopen, remove or restore several listings: { ids, action }. */
  @Post('bulk')
  @HttpCode(200)
  @Access('admin', 'opportunity.manage')
  bulk(@Auth() ctx: AuthContext, @ZBody(AdminOpportunitiesBulkInput) input: AdminOpportunitiesBulkInput, @Req() req: AppRequest): Promise<BulkResult> {
    return this.admin.bulk(ctx, input, clientIp(req));
  }

  @Get(':id')
  @Access('admin', 'opportunity.manage')
  one(@Param('id') id: string): Promise<AdminOpportunityRow> {
    return this.admin.one(id);
  }

  /** Applications to an imported listing (404 for members' listings: their poster reviews those). */
  @Get(':id/applications')
  @Access('admin', 'opportunity.manage')
  applications(@Param('id') id: string, @ZQuery(AdminApplicationsQuery) q: AdminApplicationsQuery): Promise<AdminApplicationsPage> {
    return this.admin.applications(id, q);
  }

  /** The applications as a CSV download (UTF-8 with a BOM); audited. */
  @Get(':id/applications/export')
  @Access('admin', 'opportunity.manage')
  async exportApplications(@Auth() ctx: AuthContext, @Param('id') id: string, @Query() query: unknown, @Req() req: AppRequest, @Res() res: Response): Promise<void> {
    const q = parseOrThrow(AdminApplicationsExportQuery, query);
    await this.admin.exportApplications(ctx, id, q, res, clientIp(req));
  }

  /** Shortlist, accept or decline: { status, message? }. The applicant is notified. */
  @Patch(':id/applications/:applicationId')
  @Access('admin', 'opportunity.manage')
  decide(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Param('applicationId') applicationId: string,
    @ZBody(DecideApplicationInput) input: DecideApplicationInput,
    @Req() req: AppRequest,
  ): Promise<AdminApplicationView> {
    return this.admin.decide(ctx, id, applicationId, input, clientIp(req));
  }

  @Post(':id')
  @HttpCode(200)
  @Access('admin', 'opportunity.manage')
  act(@Auth() ctx: AuthContext, @Param('id') id: string, @ZBody(AdminOpportunityAction) input: AdminOpportunityAction, @Req() req: AppRequest): Promise<AdminOpportunityRow> {
    return this.admin.act(ctx, id, input.action, clientIp(req));
  }
}
