import { Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AvailabilityInput,
  BookingInput,
  BookingsQuery,
  CancelBookingInput,
  ServiceHostQuery,
  ServiceInput,
  ServiceUpdateInput,
  SlotsQuery,
  type AvailabilityView,
  type BookingView,
  type Ok,
  type Page,
  type ServiceView,
  type SlotsView,
} from '@chartermission/contracts';
import { Access, Auth, OptionalAuth, checkAccess } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { ServicesService } from './services.service.js';
import { AvailabilityService } from './availability.service.js';
import { BookingsService } from './bookings.service.js';

/** Signed-in visitors must still be allowed to use the app (not suspended or deactivated). */
const optional = (auth: AuthContext | undefined) => (auth ? checkAccess(auth, 'member').user : undefined);

/**
 * Services and free consultations (contracts/services.ts). Member services can be read by visitors
 * when the member's profile is public; page services and everything else need a signed-in member;
 * creating services and booking need a verified email.
 */
@Controller()
export class ServicesController {
  constructor(
    private readonly services: ServicesService,
    private readonly availability: AvailabilityService,
    private readonly bookings: BookingsService,
  ) {}

  /* ------------------------------ Services ------------------------------ */

  @Get('members/:handle/services')
  forMember(@OptionalAuth() auth: AuthContext | undefined, @Param('handle') handle: string): Promise<ServiceView[]> {
    return this.services.forMember(optional(auth), handle);
  }

  @Get('pages/:slug/services')
  @Access('member')
  forPage(@Auth() ctx: AuthContext, @Param('slug') slug: string): Promise<ServiceView[]> {
    return this.services.forPage(ctx.user, slug);
  }

  @Post('services')
  @HttpCode(201)
  @Access('verified')
  create(@Auth() ctx: AuthContext, @ZBody(ServiceInput) input: ServiceInput, @Req() req: AppRequest): Promise<ServiceView> {
    return this.services.create(ctx.user, input, clientIp(req));
  }

  @Get('services/:id')
  detail(@OptionalAuth() auth: AuthContext | undefined, @UuidParam('id') id: string): Promise<ServiceView> {
    return this.services.detail(optional(auth), id);
  }

  @Patch('services/:id')
  @Access('verified')
  update(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(ServiceUpdateInput) input: ServiceUpdateInput, @Req() req: AppRequest): Promise<ServiceView> {
    return this.services.update(ctx.user, id, input, clientIp(req));
  }

  @Delete('services/:id')
  @Access('verified')
  remove(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    return this.services.remove(ctx.user, id, clientIp(req));
  }

  @Get('services/:id/slots')
  slots(@OptionalAuth() auth: AuthContext | undefined, @UuidParam('id') id: string, @ZQuery(SlotsQuery) q: SlotsQuery): Promise<SlotsView> {
    return this.bookings.slots(optional(auth), id, q);
  }

  @Post('services/:id/bookings')
  @HttpCode(201)
  @Access('verified')
  book(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(BookingInput) input: BookingInput): Promise<BookingView> {
    return this.bookings.book(ctx.user, id, input);
  }

  /* ------------------------------ Availability ------------------------------ */

  @Get('availability')
  @Access('member')
  getAvailability(@Auth() ctx: AuthContext, @ZQuery(ServiceHostQuery) q: ServiceHostQuery): Promise<AvailabilityView> {
    return this.availability.get(ctx.user, q);
  }

  @Put('availability')
  @Access('verified')
  putAvailability(
    @Auth() ctx: AuthContext,
    @ZQuery(ServiceHostQuery) q: ServiceHostQuery,
    @ZBody(AvailabilityInput) input: AvailabilityInput,
  ): Promise<AvailabilityView> {
    return this.availability.put(ctx.user, q, input);
  }

  /* ------------------------------ Bookings ------------------------------ */

  @Get('bookings')
  @Access('member')
  list(@Auth() ctx: AuthContext, @ZQuery(BookingsQuery) q: BookingsQuery): Promise<Page<BookingView>> {
    return this.bookings.list(ctx.user, q);
  }

  @Get('bookings/:id/calendar.ics')
  @Access('member')
  @Header('Cache-Control', 'private, no-cache')
  async ics(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Res() res: Response): Promise<void> {
    const { filename, body } = await this.bookings.ics(ctx.user, id);
    res
      .status(200)
      .set('Content-Type', 'text/calendar; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${filename}"`)
      .send(body);
  }

  @Get('bookings/:id')
  @Access('member')
  booking(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<BookingView> {
    return this.bookings.detail(ctx.user, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  @Access('member')
  cancel(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(CancelBookingInput) input: CancelBookingInput): Promise<BookingView> {
    return this.bookings.cancel(ctx.user, id, input);
  }
}
