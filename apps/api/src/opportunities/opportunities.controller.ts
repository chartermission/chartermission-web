import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import {
  ApplicationsQuery,
  ApplyInput,
  DecideApplicationInput,
  MyOpportunitiesQuery,
  OpportunitiesQuery,
  OpportunityInput,
  type ApplicationsPage,
  type OpportunityDetail,
  type OpportunitySummary,
  type Page,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { OpportunitiesService } from './opportunities.service.js';

/** Opportunities and in-app applications (contracts/opportunities.ts). */
@Controller()
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  @Get('opportunities')
  @Access('member')
  list(@Auth() ctx: AuthContext, @ZQuery(OpportunitiesQuery) q: OpportunitiesQuery): Promise<Page<OpportunitySummary>> {
    return this.opportunities.list(ctx.user, q);
  }

  @Get('me/opportunities')
  @Access('member')
  mine(@Auth() ctx: AuthContext, @ZQuery(MyOpportunitiesQuery) q: MyOpportunitiesQuery): Promise<Page<OpportunitySummary>> {
    return this.opportunities.mine(ctx.user, q);
  }

  @Post('opportunities')
  @Access('verified')
  create(@Auth() ctx: AuthContext, @ZBody(OpportunityInput) input: OpportunityInput, @Req() req: AppRequest): Promise<OpportunityDetail> {
    return this.opportunities.create(ctx.user, input, clientIp(req));
  }

  @Get('opportunities/:id')
  @Access('member')
  detail(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<OpportunityDetail> {
    return this.opportunities.detail(ctx.user, id);
  }

  @Patch('opportunities/:id')
  @Access('verified')
  update(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(OpportunityInput) input: OpportunityInput): Promise<OpportunityDetail> {
    return this.opportunities.update(ctx.user, id, input);
  }

  @Post('opportunities/:id/close')
  @HttpCode(200)
  @Access('verified')
  close(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<OpportunityDetail> {
    return this.opportunities.setOpen(ctx.user, id, false);
  }

  @Post('opportunities/:id/reopen')
  @HttpCode(200)
  @Access('verified')
  reopen(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<OpportunityDetail> {
    return this.opportunities.setOpen(ctx.user, id, true);
  }

  @Delete('opportunities/:id')
  @HttpCode(204)
  @Access('verified')
  async remove(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<void> {
    await this.opportunities.remove(ctx.user, id, clientIp(req));
  }

  @Post('opportunities/:id/applications')
  @Access('verified')
  apply(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(ApplyInput) input: ApplyInput): Promise<OpportunityDetail> {
    return this.opportunities.apply(ctx.user, id, input);
  }

  @Delete('opportunities/:id/applications/mine')
  @Access('verified')
  withdraw(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<OpportunityDetail> {
    return this.opportunities.withdraw(ctx.user, id);
  }

  @Get('opportunities/:id/applications')
  @Access('verified')
  applications(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZQuery(ApplicationsQuery) q: ApplicationsQuery): Promise<ApplicationsPage> {
    return this.opportunities.applications(ctx.user, id, q);
  }

  @Patch('opportunities/:id/applications/:applicationId')
  @Access('verified')
  decide(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @UuidParam('applicationId') applicationId: string,
    @ZBody(DecideApplicationInput) input: DecideApplicationInput,
  ) {
    return this.opportunities.decide(ctx.user, id, applicationId, input);
  }
}
