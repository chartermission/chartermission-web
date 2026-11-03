import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import {
  ConnectionsQuery,
  CreateConnectionInput,
  DirectoryQuery,
  FollowInput,
  FollowsQuery,
  MuteInput,
  PrivacySettingsInput,
  ProfilePreviewQuery,
  UpdateProfileInput,
  type BlockView,
  type ConnectionView,
  type DirectoryMember,
  type FollowView,
  type MemberProfile,
  type MuteView,
  type Ok,
  type OwnProfile,
  type Page,
  type SuggestedMember,
} from '@chartermission/contracts';
import { Access, Auth, OptionalAuth } from '../core/guards.js';
import { type AppRequest, type AuthContext, clientIp } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { Errors } from '../common/errors.js';
import { ProfilesService } from './profiles.service.js';
import { DirectoryService } from './directory.service.js';
import { SuggestionsService } from './suggestions.service.js';
import { ConnectionsService } from './connections.service.js';
import { FollowsService } from './follows.service.js';
import { BlocksService } from './blocks.service.js';
import { isUuid } from './taxonomy.service.js';

const OK: Ok = { ok: true };

function uuidParam(id: string, what: string): string {
  if (!isUuid(id)) throw Errors.notFound(what);
  return id;
}

/** Profiles, directory and suggestions (spec 4.3, 4.4 CM-DSH-03, 4.6). */
@Controller()
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly directory: DirectoryService,
    private readonly suggestions: SuggestionsService,
  ) {}

  @Get('members')
  @Access('member')
  search(@Auth() ctx: AuthContext, @ZQuery(DirectoryQuery) query: DirectoryQuery): Promise<Page<DirectoryMember>> {
    return this.directory.search(ctx, query);
  }

  /** Declared before members/:handle so "suggestions" is never read as a handle (it is also reserved). */
  @Get('members/suggestions')
  @Access('member')
  suggest(@Auth() ctx: AuthContext): Promise<SuggestedMember[]> {
    return this.suggestions.suggest(ctx.user.id, {
      reasons: ['sector', 'skill', 'chapter', 'country'],
      limit: 10,
      excludeConnected: true,
    });
  }

  @Get('members/:handle')
  member(@Param('handle') handle: string, @OptionalAuth() ctx: AuthContext | undefined): Promise<MemberProfile> {
    if (handle.length > 60) throw Errors.notFound('Member');
    return this.profiles.getMember(handle, ctx);
  }

  @Get('me/profile')
  @Access('session')
  own(@Auth() ctx: AuthContext): Promise<OwnProfile> {
    return this.profiles.own(ctx.user.id);
  }

  @Patch('me/profile')
  @Access('member')
  update(@Auth() ctx: AuthContext, @ZBody(UpdateProfileInput) input: UpdateProfileInput): Promise<OwnProfile> {
    return this.profiles.update(ctx.user.id, input);
  }

  @Put('me/privacy')
  @Access('session')
  privacy(@Auth() ctx: AuthContext, @ZBody(PrivacySettingsInput) input: PrivacySettingsInput): Promise<OwnProfile> {
    return this.profiles.updatePrivacy(ctx.user.id, input);
  }

  @Get('me/profile/preview')
  @Access('session')
  preview(@Auth() ctx: AuthContext, @ZQuery(ProfilePreviewQuery) query: ProfilePreviewQuery): Promise<MemberProfile> {
    return this.profiles.preview(ctx.user.id, query.as);
  }
}

/** Connection requests (CM-NET-03). Sending and accepting need a verified email (spec 4.2 rules). */
@Controller()
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Post('connections')
  @Access('verified')
  create(@Auth() ctx: AuthContext, @ZBody(CreateConnectionInput) input: CreateConnectionInput): Promise<ConnectionView> {
    return this.connections.request(ctx, input);
  }

  @Post('connections/:id/accept')
  @HttpCode(200)
  @Access('verified')
  accept(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<ConnectionView> {
    return this.connections.accept(ctx, uuidParam(id, 'Connection'));
  }

  @Post('connections/:id/decline')
  @HttpCode(200)
  @Access('member')
  decline(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<ConnectionView> {
    return this.connections.decline(ctx.user.id, uuidParam(id, 'Connection'));
  }

  @Post('connections/:id/withdraw')
  @HttpCode(200)
  @Access('member')
  withdraw(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<ConnectionView> {
    return this.connections.withdraw(ctx.user.id, uuidParam(id, 'Connection'));
  }

  @Delete('connections/:id')
  @Access('member')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<ConnectionView> {
    return this.connections.remove(ctx.user.id, uuidParam(id, 'Connection'));
  }

  @Get('me/connections')
  @Access('session')
  list(@Auth() ctx: AuthContext, @ZQuery(ConnectionsQuery) query: ConnectionsQuery): Promise<Page<ConnectionView>> {
    return this.connections.list(ctx.user.id, query);
  }
}

/**
 * Follows (CM-NET-04), blocks (CM-NET-06) and mutes. Following needs a verified email
 * (spec 6.2); blocking and muting are protective and open to every signed-in account.
 */
@Controller()
export class RelationshipsController {
  constructor(
    private readonly follows: FollowsService,
    private readonly blocks: BlocksService,
  ) {}

  @Post('follows')
  @Access('verified')
  async follow(@Auth() ctx: AuthContext, @ZBody(FollowInput) input: FollowInput): Promise<Ok> {
    await this.follows.follow(ctx.user.id, input);
    return OK;
  }

  @Delete('follows')
  @Access('member')
  async unfollow(@Auth() ctx: AuthContext, @ZBody(FollowInput) input: FollowInput): Promise<Ok> {
    await this.follows.unfollow(ctx.user.id, input);
    return OK;
  }

  @Get('me/follows')
  @Access('session')
  listFollows(@Auth() ctx: AuthContext, @ZQuery(FollowsQuery) query: FollowsQuery): Promise<Page<FollowView>> {
    return this.follows.list(ctx.user.id, query);
  }

  @Post('blocks/:memberId')
  @Access('session')
  async block(@Auth() ctx: AuthContext, @Param('memberId') memberId: string, @Req() req: AppRequest): Promise<Ok> {
    await this.blocks.block(ctx.user.id, memberId, clientIp(req));
    return OK;
  }

  @Delete('blocks/:memberId')
  @Access('session')
  async unblock(@Auth() ctx: AuthContext, @Param('memberId') memberId: string, @Req() req: AppRequest): Promise<Ok> {
    await this.blocks.unblock(ctx.user.id, memberId, clientIp(req));
    return OK;
  }

  @Get('me/blocks')
  @Access('session')
  listBlocks(@Auth() ctx: AuthContext): Promise<BlockView[]> {
    return this.blocks.list(ctx.user.id);
  }

  @Post('mutes')
  @Access('session')
  async mute(@Auth() ctx: AuthContext, @ZBody(MuteInput) input: MuteInput): Promise<Ok> {
    await this.blocks.mute(ctx.user.id, input);
    return OK;
  }

  @Delete('mutes')
  @Access('session')
  async unmute(@Auth() ctx: AuthContext, @ZBody(MuteInput) input: MuteInput): Promise<Ok> {
    await this.blocks.unmute(ctx.user.id, input);
    return OK;
  }

  @Get('me/mutes')
  @Access('session')
  listMutes(@Auth() ctx: AuthContext): Promise<MuteView[]> {
    return this.blocks.listMutes(ctx.user.id);
  }
}
