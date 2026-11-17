import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Query, Req } from '@nestjs/common';
import {
  AdminInboxQuery,
  AdminInboxReplyInput,
  AdminInboxStartInput,
  AnnouncementAudienceInput,
  AnnouncementInput,
  AnnouncementsQuery,
  MessagingSettings,
  type AdminInboxMessage,
  type AdminInboxPage,
  type AdminInboxThread,
  type AnnouncementAudienceCount,
  type AnnouncementSendResult,
  type AnnouncementsPage,
  type AnnouncementView,
  type MessagingSettingsView,
  type UnreadCount,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { Errors } from '../common/errors.js';
import { UuidParam } from '../media/uuid-param.js';
import { AnnouncementsService } from './announcements.service.js';
import { InboxService } from './inbox.service.js';
import { MessagingSettingsService } from './messaging-settings.service.js';

/** Bulk messages from Charter Mission (contracts announcements.ts). */
@Controller('admin/announcements')
export class AdminAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @Access('admin', 'members.message')
  list(@ZQuery(AnnouncementsQuery) q: AnnouncementsQuery): Promise<AnnouncementsPage> {
    return this.announcements.list(q);
  }

  @Post()
  @HttpCode(201)
  @Access('admin', 'members.message')
  create(@Auth() ctx: AuthContext, @ZBody(AnnouncementInput) input: AnnouncementInput, @Req() req: AppRequest): Promise<AnnouncementView> {
    return this.announcements.create(ctx, input, clientIp(req));
  }

  /** Live audience size while composing. */
  @Post('audience')
  @HttpCode(200)
  @Access('admin', 'members.message')
  audience(@ZBody(AnnouncementAudienceInput) input: AnnouncementAudienceInput): Promise<AnnouncementAudienceCount> {
    return this.announcements.audienceCount(input);
  }

  @Get(':id')
  @Access('admin', 'members.message')
  view(@UuidParam('id') id: string): Promise<AnnouncementView> {
    return this.announcements.view(id);
  }

  @Patch(':id')
  @Access('admin', 'members.message')
  update(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(AnnouncementInput) input: AnnouncementInput, @Req() req: AppRequest): Promise<AnnouncementView> {
    return this.announcements.update(ctx, id, input, clientIp(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @Access('admin', 'members.message')
  remove(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<void> {
    return this.announcements.remove(ctx, id, clientIp(req));
  }

  @Post(':id/send')
  @HttpCode(200)
  @Access('admin', 'members.message')
  async send(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<AnnouncementSendResult> {
    return { announcement: await this.announcements.send(ctx, id, clientIp(req)) };
  }

  @Post(':id/test')
  @HttpCode(200)
  @Access('admin', 'members.message')
  async test(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<AnnouncementSendResult> {
    return { announcement: await this.announcements.test(ctx, id, clientIp(req)) };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Access('admin', 'members.message')
  async cancel(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<AnnouncementSendResult> {
    return { announcement: await this.announcements.cancel(ctx, id, clientIp(req)) };
  }
}

/** The Charter Mission inbox: members' replies to Charter Mission, answered by the team. */
@Controller('admin/inbox')
export class AdminInboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @Access('admin', 'members.message')
  list(@ZQuery(AdminInboxQuery) q: AdminInboxQuery): Promise<AdminInboxPage> {
    return this.inbox.list(q);
  }

  /** For the console sidebar's badge: conversations waiting for the team. */
  @Get('unread-count')
  @Access('admin', 'members.message')
  async unread(): Promise<UnreadCount> {
    return { unread: await this.inbox.unreadCount() };
  }

  @Post('start')
  @HttpCode(200)
  @Access('admin', 'members.message')
  start(@Auth() ctx: AuthContext, @ZBody(AdminInboxStartInput) input: AdminInboxStartInput, @Req() req: AppRequest): Promise<AdminInboxThread> {
    return this.inbox.start(ctx, input, clientIp(req));
  }

  @Get(':id')
  @Access('admin', 'members.message')
  thread(@UuidParam('id') id: string, @Query('cursor') cursor?: string): Promise<AdminInboxThread> {
    return this.inbox.thread(id, typeof cursor === 'string' && cursor ? cursor.slice(0, 200) : undefined);
  }

  @Post(':id/messages')
  @HttpCode(201)
  @Access('admin', 'members.message')
  reply(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(AdminInboxReplyInput) input: AdminInboxReplyInput, @Req() req: AppRequest): Promise<AdminInboxMessage> {
    return this.inbox.reply(ctx, id, input, clientIp(req));
  }
}

/** The account bulk messages and inbox replies are sent from. */
@Controller('admin/settings')
export class AdminMessagingSettingsController {
  constructor(private readonly settings: MessagingSettingsService) {}

  /** Readable by whoever sends messages (members.message) or manages settings. */
  @Get('messaging')
  @Access('admin')
  messaging(@Auth() ctx: AuthContext): Promise<MessagingSettingsView> {
    if (!ctx.user.permissions.has('members.message') && !ctx.user.permissions.has('settings.manage')) throw Errors.forbidden();
    return this.settings.view();
  }

  @Put('messaging')
  @Access('admin', 'settings.manage')
  update(@Auth() ctx: AuthContext, @ZBody(MessagingSettings) input: MessagingSettings, @Req() req: AppRequest): Promise<MessagingSettingsView> {
    return this.settings.update(ctx.user.id, input, clientIp(req));
  }
}
