import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
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
import { ZBody, ZQuery } from '../common/validation.js';
import { AdminOpportunitiesService } from './admin-opportunities.service.js';

/**
 * Admin console → Opportunities (contracts/opportunity-import.ts): every listing with staff actions,
 * and the import of opportunities pasted from WhatsApp groups and forums (via a CSV Claude writes).
 * All of it needs opportunity.manage (Platform Admins and up).
 */
@Controller('admin/opportunities')
export class AdminOpportunitiesController {
  constructor(private readonly admin: AdminOpportunitiesService) {}

  @Get()
  @Access('admin', 'opportunity.manage')
  list(@ZQuery(AdminOpportunitiesQuery) q: AdminOpportunitiesQuery): Promise<AdminOpportunitiesPage> {
    return this.admin.list(q);
  }

  /** The official pages imported listings can be posted as. */
  @Get('pages')
  @Access('admin', 'opportunity.manage')
  pages(): Promise<AdminOpportunityPages> {
    return this.admin.officialPages();
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

  @Post(':id')
  @HttpCode(200)
  @Access('admin', 'opportunity.manage')
  act(@Auth() ctx: AuthContext, @Param('id') id: string, @ZBody(AdminOpportunityAction) input: AdminOpportunityAction, @Req() req: AppRequest): Promise<AdminOpportunityRow> {
    return this.admin.act(ctx, id, input.action, clientIp(req));
  }
}
