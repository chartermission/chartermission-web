import { Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import {
  MarkReadInput,
  NotificationPreferences,
  NotificationsQuery,
  type NotificationView,
  type Page,
  type UnreadCount,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Notifications are readable at "session" level so suspended members still see
 * moderation outcomes and can appeal (spec 4.15).
 */
@Controller()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  @Access('session')
  list(@Auth() ctx: AuthContext, @ZQuery(NotificationsQuery) q: NotificationsQuery): Promise<Page<NotificationView>> {
    return this.notifications.list(ctx.user.id, q);
  }

  @Get('notifications/unread-count')
  @Access('session')
  unread(@Auth() ctx: AuthContext): Promise<UnreadCount> {
    return this.notifications.unreadCount(ctx.user.id);
  }

  @Post('notifications/read')
  @HttpCode(200)
  @Access('session')
  read(@Auth() ctx: AuthContext, @ZBody(MarkReadInput) input: MarkReadInput): Promise<UnreadCount> {
    return this.notifications.markRead(ctx.user.id, input);
  }

  @Get('me/notification-preferences')
  @Access('member')
  preferences(@Auth() ctx: AuthContext): Promise<NotificationPreferences> {
    return this.notifications.preferences(ctx.user.id);
  }

  @Put('me/notification-preferences')
  @Access('member')
  update(@Auth() ctx: AuthContext, @ZBody(NotificationPreferences) input: NotificationPreferences): Promise<NotificationPreferences> {
    return this.notifications.updatePreferences(ctx.user.id, input);
  }
}
