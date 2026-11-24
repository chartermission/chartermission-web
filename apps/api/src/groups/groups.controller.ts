import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import {
  CursorQuery,
  GroupInput,
  GroupInviteInput,
  GroupJoinInput,
  GroupMemberAction,
  GroupMembersBulkInput,
  GroupMembersQuery,
  GroupPostAction,
  GroupsQuery,
  GroupUpdateInput,
  type BulkResult,
  type GroupDetail,
  type GroupMemberView,
  type GroupSummary,
  type Ok,
  type Page,
  type PostView,
} from '@chartermission/contracts';
import { Access, Auth, OptionalAuth, checkAccess } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { GroupsService } from './groups.service.js';
import { GroupMembersService } from './group-members.service.js';
import { GroupPostsService } from './group-posts.service.js';

/** Groups in the member app (contracts/groups.ts). */
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly memberships: GroupMembersService,
    private readonly groupPosts: GroupPostsService,
  ) {}

  @Get()
  @Access('member')
  list(@Auth() ctx: AuthContext, @ZQuery(GroupsQuery) q: GroupsQuery): Promise<Page<GroupSummary>> {
    return this.groups.list(ctx.user, q);
  }

  @Post()
  @HttpCode(201)
  @Access('verified')
  create(@Auth() ctx: AuthContext, @ZBody(GroupInput) input: GroupInput, @Req() req: AppRequest): Promise<GroupDetail> {
    return this.groups.create(ctx.user, input, clientIp(req));
  }

  /** Members open any listed group; visitors open public ones (like a public post). */
  @Get(':slug')
  detail(@OptionalAuth() auth: AuthContext | undefined, @Param('slug') slug: string): Promise<GroupDetail> {
    if (auth) checkAccess(auth, 'member');
    return this.groups.detail(auth?.user, slug);
  }

  @Patch(':slug')
  @Access('verified')
  update(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(GroupUpdateInput) input: GroupUpdateInput, @Req() req: AppRequest): Promise<GroupDetail> {
    return this.groups.update(ctx.user, slug, input, clientIp(req));
  }

  @Delete(':slug')
  @Access('verified')
  remove(@Auth() ctx: AuthContext, @Param('slug') slug: string, @Req() req: AppRequest): Promise<Ok> {
    return this.groups.remove(ctx.user, slug, clientIp(req));
  }

  /* Membership */

  @Post(':slug/join')
  @HttpCode(200)
  @Access('verified')
  join(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(GroupJoinInput) input: GroupJoinInput): Promise<GroupDetail> {
    return this.memberships.join(ctx.user, slug, input);
  }

  @Post(':slug/leave')
  @HttpCode(200)
  @Access('member')
  leave(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<GroupDetail> {
    return this.memberships.leave(ctx.user, slug);
  }

  /** Invite members: { memberIds } → which were invited and why the others weren't. */
  @Post(':slug/invitations')
  @HttpCode(200)
  @Access('verified')
  invite(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(GroupInviteInput) input: GroupInviteInput): Promise<BulkResult> {
    return this.memberships.invite(ctx.user, slug, input);
  }

  @Get(':slug/members')
  @Access('member')
  members(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZQuery(GroupMembersQuery) q: GroupMembersQuery): Promise<Page<GroupMemberView>> {
    return this.memberships.list(ctx.user, slug, q);
  }

  /** Approve, decline, remove, ban or cancel invitations for several people: { ids, action }. */
  @Post(':slug/members/bulk')
  @HttpCode(200)
  @Access('verified')
  bulk(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZBody(GroupMembersBulkInput) input: GroupMembersBulkInput, @Req() req: AppRequest): Promise<BulkResult> {
    return this.memberships.bulk(ctx.user, slug, input, clientIp(req));
  }

  /** Returns the member as they now stand (member: null when they are no longer in the group). */
  @Post(':slug/members/:memberId')
  @HttpCode(200)
  @Access('verified')
  act(
    @Auth() ctx: AuthContext,
    @Param('slug') slug: string,
    @UuidParam('memberId') memberId: string,
    @ZBody(GroupMemberAction) input: GroupMemberAction,
    @Req() req: AppRequest,
  ): Promise<Ok & { member: GroupMemberView | null }> {
    return this.memberships.act(ctx.user, slug, memberId, input, clientIp(req));
  }

  /* Posts */

  @Get(':slug/posts/pending')
  @Access('member')
  pending(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZQuery(CursorQuery) q: CursorQuery): Promise<Page<PostView>> {
    return this.groupPosts.pending(ctx.user, slug, q);
  }

  @Post(':slug/posts/:postId')
  @HttpCode(200)
  @Access('verified')
  postAction(
    @Auth() ctx: AuthContext,
    @Param('slug') slug: string,
    @UuidParam('postId') postId: string,
    @ZBody(GroupPostAction) input: GroupPostAction,
    @Req() req: AppRequest,
  ): Promise<Ok> {
    return this.groupPosts.act(ctx.user, slug, postId, input, clientIp(req));
  }
}
