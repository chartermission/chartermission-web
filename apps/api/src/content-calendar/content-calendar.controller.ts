import { Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import {
  ClaudeContentSettings,
  ContentCalendarActionInput,
  ContentCalendarBulkInput,
  ContentCalendarCountsQuery,
  ContentCalendarKind,
  ContentCalendarQuery,
  type BulkResult,
  type ContentCalendarActionResult,
  type ContentCalendarCounts,
  type ContentCalendarDetail,
  type ContentCalendarPage,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { Errors } from '../common/errors.js';
import { UuidParam } from '../media/uuid-param.js';
import { AuditService } from '../infra/audit.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { ContentCalendarService } from './content-calendar.service.js';

function kindOr404(kind: string): ContentCalendarKind {
  const parsed = ContentCalendarKind.safeParse(kind);
  if (!parsed.success) throw Errors.notFound();
  return parsed.data;
}

/** Content calendar: posts members write and schedule with Claude, for moderators to review. */
@Controller('admin/content-calendar')
export class ContentCalendarController {
  constructor(private readonly calendar: ContentCalendarService) {}

  @Get('items')
  @Access('admin', 'moderation.view')
  items(@ZQuery(ContentCalendarQuery) q: ContentCalendarQuery): Promise<ContentCalendarPage> {
    return this.calendar.list(q);
  }

  @Get('counts')
  @Access('admin', 'moderation.view')
  counts(@ZQuery(ContentCalendarCountsQuery) q: ContentCalendarCountsQuery): Promise<ContentCalendarCounts> {
    return this.calendar.counts(q);
  }

  /** Items waiting for approval (the console's sidebar badge). */
  @Get('awaiting-count')
  @Access('admin', 'moderation.view')
  async awaiting(): Promise<{ count: number }> {
    return { count: await this.calendar.awaitingApproval() };
  }

  @Post('bulk')
  @HttpCode(200)
  @Access('admin', 'moderation.act')
  bulk(@Auth() ctx: AuthContext, @ZBody(ContentCalendarBulkInput) input: ContentCalendarBulkInput, @Req() req: AppRequest): Promise<BulkResult> {
    return this.calendar.bulk(ctx, input, clientIp(req));
  }

  @Get(':kind/:id')
  @Access('admin', 'moderation.view')
  detail(@Param('kind') kind: string, @UuidParam('id') id: string): Promise<ContentCalendarDetail> {
    return this.calendar.detail(kindOr404(kind), id);
  }

  @Post(':kind/:id/actions')
  @HttpCode(200)
  @Access('admin', 'moderation.act')
  act(
    @Auth() ctx: AuthContext,
    @Param('kind') kind: string,
    @UuidParam('id') id: string,
    @ZBody(ContentCalendarActionInput) input: ContentCalendarActionInput,
    @Req() req: AppRequest,
  ): Promise<ContentCalendarActionResult> {
    return this.calendar.act(ctx, kindOr404(kind), id, input, clientIp(req));
  }
}

/** When posts written with Claude are reviewed: after publishing (default) or before. */
@Controller('admin/settings/claude-content')
export class ClaudeContentSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** Everyone who reviews the calendar sees the mode; only settings managers change it. */
  @Get()
  @Access('admin', 'moderation.view')
  get(): Promise<ClaudeContentSettings> {
    return this.settings.get('claude_content');
  }

  /** Applies from now on: posts already waiting keep waiting until someone approves or declines them. */
  @Put()
  @Access('admin', 'settings.manage')
  async update(@Auth() ctx: AuthContext, @ZBody(ClaudeContentSettings) input: ClaudeContentSettings, @Req() req: AppRequest): Promise<ClaudeContentSettings> {
    const before = await this.settings.get('claude_content');
    await this.settings.set('claude_content', { approval: input.approval }, ctx.user.id);
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'settings.claude_content.updated',
      targetType: 'setting',
      targetId: 'claude_content',
      before,
      after: input,
      ip: clientIp(req),
    });
    return this.settings.get('claude_content');
  }
}
