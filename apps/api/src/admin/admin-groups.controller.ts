import { Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AdminGroupAction,
  AdminGroupMembersQuery,
  AdminGroupsBulkInput,
  AdminGroupsQuery,
  GroupsSettings,
  type AdminGroupDetail,
  type AdminGroupMember,
  type AdminGroupRow,
  type AdminGroupsPage,
  type BulkResult,
  type Page,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { parseOrThrow, ZBody, ZQuery } from '../common/validation.js';
import { AdminGroupsService } from './admin-groups.service.js';

/**
 * Admin console → Groups (contracts/groups.ts). Moderators look (moderation.view, private groups'
 * posts included); Platform Admins act (groups.manage). Settings need settings.manage.
 */
@Controller('admin')
export class AdminGroupsController {
  constructor(private readonly groups: AdminGroupsService) {}

  @Get('groups')
  @Access('admin', 'moderation.view')
  list(@ZQuery(AdminGroupsQuery) q: AdminGroupsQuery): Promise<AdminGroupsPage> {
    return this.groups.list(q);
  }

  /** Suspend (with a note), restore, feature, unfeature or delete several groups: { ids, action, note? }. */
  @Post('groups/bulk')
  @HttpCode(200)
  @Access('admin', 'groups.manage')
  bulk(@Auth() ctx: AuthContext, @ZBody(AdminGroupsBulkInput) input: AdminGroupsBulkInput, @Req() req: AppRequest): Promise<BulkResult> {
    return this.groups.bulk(ctx, input, clientIp(req));
  }

  @Get('groups/:id')
  @Access('admin', 'moderation.view')
  detail(@Param('id') id: string): Promise<AdminGroupDetail> {
    return this.groups.detail(id);
  }

  @Post('groups/:id')
  @HttpCode(200)
  @Access('admin', 'groups.manage')
  act(@Auth() ctx: AuthContext, @Param('id') id: string, @ZBody(AdminGroupAction) input: AdminGroupAction, @Req() req: AppRequest): Promise<AdminGroupRow> {
    return this.groups.act(ctx, id, input, clientIp(req));
  }

  @Get('groups/:id/members')
  @Access('admin', 'moderation.view')
  members(@Param('id') id: string, @ZQuery(AdminGroupMembersQuery) q: AdminGroupMembersQuery): Promise<Page<AdminGroupMember>> {
    return this.groups.membersOf(id, q);
  }

  /** The group's members (the members list's filters) as a CSV download. members.manage or groups.manage; audited. */
  @Get('groups/:id/members/export.csv')
  @Access('admin')
  async exportMembers(@Auth() ctx: AuthContext, @Param('id') id: string, @Query() query: unknown, @Req() req: AppRequest, @Res() res: Response): Promise<void> {
    const q = parseOrThrow(AdminGroupMembersQuery, query);
    await this.groups.exportMembers(ctx, id, q, res, clientIp(req));
  }

  @Get('settings/groups')
  @Access('admin', 'settings.manage')
  getSettings(): Promise<GroupsSettings> {
    return this.groups.getSettings();
  }

  @Put('settings/groups')
  @Access('admin', 'settings.manage')
  setSettings(@Auth() ctx: AuthContext, @ZBody(GroupsSettings) input: GroupsSettings, @Req() req: AppRequest): Promise<GroupsSettings> {
    return this.groups.setSettings(ctx, input, clientIp(req));
  }
}
