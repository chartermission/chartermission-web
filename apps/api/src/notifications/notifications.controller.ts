import { Body, Controller, Get, HttpCode, Post, Put, Query, Req } from '@nestjs/common';
import {
  MarkReadInput,
  NotificationPreferences,
  NotificationsQuery,
  UnsubscribeInput,
  type NotificationView,
  type UnsubscribeResult,
  type Page,
  type UnreadCount,
} from '@chartermission/contracts';
import { Access, Auth, SkipCsrf } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { parseOrThrow, ZBody, ZQuery } from '../common/validation.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Notifications are readable at "session" level so suspended members still see
 * moderation outcomes and can appeal (spec 4.15).
 */
@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly limits: RateLimitService,
  ) {}

  /**
   * POST /notifications/unsubscribe — no sign-in. The member site's /unsubscribe page posts {token}; mail apps'
   * one-click unsubscribe (List-Unsubscribe-Post) posts a form to ?t={token} without the CSRF header, which is why
   * the check is skipped: the signed token is the only thing that authorises it, and all it can do is turn an email off.
   */
  @Post('notifications/unsubscribe')
  @HttpCode(200)
  @SkipCsrf()
  async unsubscribe(@Body() body: unknown, @Query('t') t: unknown, @Req() req: AppRequest): Promise<UnsubscribeResult> {
    await this.limits.consume(`unsubscribe:ip:${clientIp(req) ?? 'unknown'}`, 300, 3600);
    const fromBody = body && typeof body === 'object' && 'token' in body ? (body as { token: unknown }).token : undefined;
    const input = parseOrThrow(UnsubscribeInput, { token: fromBody ?? t });
    return this.notifications.unsubscribe(input.token);
  }

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
