import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service.js';
import { BookingRemindersService } from './booking-reminders.service.js';
import { BookingsService } from './bookings.service.js';
import { ServiceHosts } from './service-hosts.service.js';
import { ServicesController } from './services.controller.js';
import { ServicesEvents } from './services.events.js';
import { ServicesService } from './services.service.js';

/**
 * Services and free consultations: what members and pages offer, the host's weekly availability,
 * open slots, bookings (with a lock against double booking), notifications, emails, calendar files
 * and reminders.
 */
@Module({
  controllers: [ServicesController],
  providers: [ServiceHosts, ServicesService, AvailabilityService, BookingsService, ServicesEvents, BookingRemindersService],
  exports: [ServicesService, BookingsService],
})
export class ServicesModule {}
