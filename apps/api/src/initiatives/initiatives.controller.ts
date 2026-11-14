import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import {
  DecideJoinRequestInput,
  InitiativeInput,
  InitiativesQuery,
  JoinInitiativeInput,
  UpdateInitiativeInput,
  UpdateTeamMemberInput,
  type InitiativeDetail,
  type InitiativeHostOptions,
  type InitiativeJoinRequestView,
  type InitiativeSummary,
  type Ok,
  type Page,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { InitiativesService } from './initiatives.service.js';

/** Initiatives (contracts/initiatives.ts): browse, start, join, follow and run them. */
@Controller('initiatives')
export class InitiativesController {
  constructor(private readonly initiatives: InitiativesService) {}

  @Get()
  @Access('member')
  list(@Auth() ctx: AuthContext, @ZQuery(InitiativesQuery) q: InitiativesQuery): Promise<Page<InitiativeSummary>> {
    return this.initiatives.list(ctx.user, q);
  }

  @Get('host-options')
  @Access('member')
  hostOptions(@Auth() ctx: AuthContext): Promise<InitiativeHostOptions> {
    return this.initiatives.hostOptions(ctx.user);
  }

  @Post()
  @HttpCode(201)
  @Access('verified')
  create(@Auth() ctx: AuthContext, @ZBody(InitiativeInput) input: InitiativeInput, @Req() req: AppRequest): Promise<InitiativeDetail> {
    return this.initiatives.create(ctx.user, input, clientIp(req));
  }

  @Get(':idOrSlug')
  @Access('member')
  detail(@Auth() ctx: AuthContext, @Param('idOrSlug') idOrSlug: string): Promise<InitiativeDetail> {
    return this.initiatives.detail(ctx.user, idOrSlug);
  }

  @Patch(':id')
  @Access('verified')
  update(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(UpdateInitiativeInput) input: UpdateInitiativeInput, @Req() req: AppRequest): Promise<InitiativeDetail> {
    return this.initiatives.update(ctx.user, id, input, clientIp(req));
  }

  @Delete(':id')
  @Access('verified')
  remove(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    return this.initiatives.remove(ctx.user, id, clientIp(req));
  }

  @Put(':id/follow')
  @Access('member')
  follow(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<Ok> {
    return this.initiatives.follow(ctx.user, id, true);
  }

  @Delete(':id/follow')
  @Access('member')
  unfollow(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<Ok> {
    return this.initiatives.follow(ctx.user, id, false);
  }

  @Post(':id/join-requests')
  @HttpCode(200)
  @Access('verified')
  join(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(JoinInitiativeInput) input: JoinInitiativeInput): Promise<InitiativeDetail> {
    return this.initiatives.join(ctx.user, id, input);
  }

  @Delete(':id/join-requests/me')
  @Access('member')
  withdraw(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<InitiativeDetail> {
    return this.initiatives.withdraw(ctx.user, id);
  }

  @Get(':id/join-requests')
  @Access('member')
  requests(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<InitiativeJoinRequestView[]> {
    return this.initiatives.requests(ctx.user, id);
  }

  @Post(':id/join-requests/:requestId/decision')
  @HttpCode(200)
  @Access('verified')
  decide(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @UuidParam('requestId') requestId: string,
    @ZBody(DecideJoinRequestInput) input: DecideJoinRequestInput,
  ): Promise<InitiativeJoinRequestView> {
    return this.initiatives.decide(ctx.user, id, requestId, input);
  }

  @Patch(':id/team/:userId')
  @Access('verified')
  updateMember(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @UuidParam('userId') userId: string,
    @ZBody(UpdateTeamMemberInput) input: UpdateTeamMemberInput,
  ): Promise<InitiativeDetail> {
    return this.initiatives.updateMember(ctx.user, id, userId, input);
  }

  @Delete(':id/team/:userId')
  @Access('member')
  removeMember(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @UuidParam('userId') userId: string): Promise<InitiativeDetail> {
    return this.initiatives.removeMember(ctx.user, id, userId);
  }
}
