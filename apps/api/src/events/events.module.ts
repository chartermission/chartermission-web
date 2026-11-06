import { Module } from '@nestjs/common';
import { AdminEventsController, EventsController } from './events.controller.js';
import { EventAccess } from './event-access.js';
import { EventSerializer } from './event-serializer.js';
import { EventMessages } from './event-messages.service.js';
import { EventCatalogService } from './event-catalog.service.js';
import { EventEditorService } from './event-editor.service.js';
import { RegistrationsService } from './registrations.service.js';
import { EventRemindersService } from './event-reminders.service.js';
import { AdminEventsService } from './admin-events.service.js';

/** Events (spec 4.9): listings, calendar, hosting and review, registration, waitlist, reminders, .ics. */
@Module({
  controllers: [EventsController, AdminEventsController],
  providers: [
    EventAccess,
    EventSerializer,
    EventMessages,
    EventCatalogService,
    EventEditorService,
    RegistrationsService,
    EventRemindersService,
    AdminEventsService,
  ],
  exports: [EventAccess, EventSerializer, EventCatalogService],
})
export class EventsModule {}
