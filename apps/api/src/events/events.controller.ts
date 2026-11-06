import { Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AdminEventsQuery,
  CancelEventInput,
  CreateEventInput,
  EventsCalendarQuery,
  EventsQuery,
  FeatureEventInput,
  HostRegistrationsQuery,
  MarkAttendanceInput,
  MyEventsQuery,
  RegisterInput,
  ReviewDecisionInput,
  SubmitForReviewInput,
  UnpublishEventInput,
  UpdateEventInput,
  type AdminEventRow,
  type EventCategory,
  type EventDetail,
  type EventHostOptions,
  type EventsCalendar,
  type EventSummary,
  type Page,
  type RegistrationResult,
  type RegistrationView,
} from '@chartermission/contracts';
import { Access, Auth, OptionalAuth, checkAccess } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { EventCatalogService } from './event-catalog.service.js';
import { EventEditorService } from './event-editor.service.js';
import { RegistrationsService } from './registrations.service.js';
import { AdminEventsService } from './admin-events.service.js';

/**
 * Events (spec 4.9; contract packages/contracts/src/events.ts). Reading needs a signed-in member;
 * every write needs a verified email (EMAIL_NOT_VERIFIED otherwise). The .ics download is public
 * for public events. Static paths are declared before :idOrSlug.
 */
@Controller()
export class EventsController {
  constructor(
    private readonly catalog: EventCatalogService,
    private readonly editor: EventEditorService,
    private readonly registrations: RegistrationsService,
  ) {}

  @Get('events')
  @Access('member')
  list(@Auth() ctx: AuthContext, @ZQuery(EventsQuery) q: EventsQuery): Promise<Page<EventSummary>> {
    return this.catalog.list(ctx.user, q);
  }

  @Get('events/calendar')
  @Access('member')
  calendar(@Auth() ctx: AuthContext, @ZQuery(EventsCalendarQuery) q: EventsCalendarQuery): Promise<EventsCalendar> {
    return this.catalog.calendar(ctx.user, q);
  }

  @Get('events/categories')
  @Access('member')
  categories(): Promise<EventCategory[]> {
    return this.catalog.categories();
  }

  @Get('events/host-options')
  @Access('member')
  hostOptions(@Auth() ctx: AuthContext): Promise<EventHostOptions> {
    return this.catalog.hostOptions(ctx.user);
  }

  @Get('events/:id.ics')
  @Header('Cache-Control', 'private, no-cache')
  async ics(@OptionalAuth() auth: AuthContext | undefined, @Param('id') id: string, @Res() res: Response): Promise<void> {
    if (auth) checkAccess(auth, 'member');
    const { filename, body } = await this.catalog.ics(auth?.user, id);
    res
      .status(200)
      .set('Content-Type', 'text/calendar; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${filename}"`)
      .send(body);
  }

  @Get('events/:idOrSlug')
  @Access('member')
  detail(@Auth() ctx: AuthContext, @Param('idOrSlug') idOrSlug: string): Promise<EventDetail> {
    return this.catalog.detail(ctx.user, idOrSlug);
  }

  @Post('events')
  @Access('verified')
  create(@Auth() ctx: AuthContext, @ZBody(CreateEventInput) input: CreateEventInput): Promise<EventDetail> {
    return this.editor.create(ctx.user, input);
  }

  @Patch('events/:id')
  @Access('verified')
  update(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(UpdateEventInput) input: UpdateEventInput): Promise<EventDetail> {
    return this.editor.update(ctx.user, id, input);
  }

  @Post('events/:id/submit')
  @HttpCode(200)
  @Access('verified')
  submit(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(SubmitForReviewInput) input: SubmitForReviewInput): Promise<EventDetail> {
    return this.editor.submit(ctx.user, id, input);
  }

  @Post('events/:id/cancel')
  @HttpCode(200)
  @Access('verified')
  cancel(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(CancelEventInput) input: CancelEventInput): Promise<EventDetail> {
    return this.editor.cancel(ctx.user, id, input);
  }

  @Delete('events/:id')
  @HttpCode(204)
  @Access('verified')
  async remove(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<void> {
    await this.editor.remove(ctx.user, id);
  }

  /* ---------- Registrations ---------- */

  @Post('events/:id/registrations')
  @HttpCode(200)
  @Access('verified')
  register(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(RegisterInput) _input: RegisterInput): Promise<RegistrationResult> {
    return this.registrations.register(ctx.user, id);
  }

  @Delete('events/:id/registrations/me')
  @Access('verified')
  cancelRegistration(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<RegistrationResult> {
    return this.registrations.cancelMine(ctx.user, id);
  }

  @Get('events/:id/registrations')
  @Access('member')
  registrationsList(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @ZQuery(HostRegistrationsQuery) q: HostRegistrationsQuery,
  ): Promise<Page<RegistrationView>> {
    return this.registrations.list(ctx.user, id, q);
  }

  @Put('events/:id/registrations/:userId/attendance')
  @Access('verified')
  attendance(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @UuidParam('userId') userId: string,
    @ZBody(MarkAttendanceInput) input: MarkAttendanceInput,
  ): Promise<RegistrationView> {
    return this.registrations.markAttendance(ctx.user, id, userId, input.attended);
  }

  @Get('me/events')
  @Access('member')
  mine(@Auth() ctx: AuthContext, @ZQuery(MyEventsQuery) q: MyEventsQuery): Promise<Page<EventSummary>> {
    return this.catalog.mine(ctx.user, q);
  }
}

/** Admin Events section (admin audience, MFA verified). */
@Controller('admin/events')
export class AdminEventsController {
  constructor(private readonly admin: AdminEventsService) {}

  @Get()
  @Access('admin', 'event.review')
  list(@Auth() ctx: AuthContext, @ZQuery(AdminEventsQuery) q: AdminEventsQuery): Promise<Page<AdminEventRow>> {
    return this.admin.list(ctx.user, q);
  }

  @Post(':id/review')
  @HttpCode(200)
  @Access('admin', 'event.review')
  review(@Auth() ctx: AuthContext, @Param('id') id: string, @ZBody(ReviewDecisionInput) input: ReviewDecisionInput, @Req() req: AppRequest): Promise<AdminEventRow> {
    return this.admin.review(ctx.user, id, input, clientIp(req));
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  @Access('admin', 'event.review')
  unpublish(@Auth() ctx: AuthContext, @Param('id') id: string, @ZBody(UnpublishEventInput) input: UnpublishEventInput, @Req() req: AppRequest): Promise<AdminEventRow> {
    return this.admin.unpublish(ctx.user, id, input, clientIp(req));
  }

  @Put(':id/featured')
  @Access('admin', 'event.feature')
  feature(@Auth() ctx: AuthContext, @Param('id') id: string, @ZBody(FeatureEventInput) input: FeatureEventInput, @Req() req: AppRequest): Promise<AdminEventRow> {
    return this.admin.feature(ctx.user, id, input, clientIp(req));
  }
}
