import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller.js';
import { ReportsService } from './reports.service.js';
import { AppealsService } from './appeals.service.js';
import { TargetsService } from './targets.service.js';
import { ModerationActionsService } from './actions.service.js';
import { ModerationEventsService } from './moderation-events.service.js';
import { ExpiryService } from './expiry.js';

/**
 * Reporting, moderation actions, appeals and their notifications (spec 4.15 ADM).
 * The admin console (AdminModule) reuses TargetsService and ModerationActionsService.
 */
@Module({
  controllers: [ModerationController],
  providers: [
    ReportsService,
    AppealsService,
    TargetsService,
    ModerationActionsService,
    ModerationEventsService,
    ExpiryService,
  ],
  exports: [TargetsService, ModerationActionsService, ExpiryService, ReportsService],
})
export class ModerationModule {}
