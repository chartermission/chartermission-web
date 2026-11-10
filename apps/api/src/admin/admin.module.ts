import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module.js';
import { AdminAuditController, AdminModerationController, AdminSettingsController, AdminTrendingController } from './admin.controller.js';
import { AdminQueueService } from './admin-queue.service.js';
import { AdminTrendingService } from './admin-trending.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminBadgesController, AdminChaptersController, AdminMembersController, AdminTopicsController } from './admin-catalogue.controller.js';
import { AdminChaptersService } from './admin-chapters.service.js';
import { AdminTopicsService } from './admin-topics.service.js';
import { AdminMembersService } from './admin-members.service.js';

/** Admin console APIs for moderation, trending controls and the audit log (spec 4.15). */
@Module({
  imports: [ModerationModule],
  controllers: [
    AdminModerationController,
    AdminTrendingController,
    AdminAuditController,
    AdminSettingsController,
    AdminChaptersController,
    AdminTopicsController,
    AdminBadgesController,
    AdminMembersController,
  ],
  providers: [AdminQueueService, AdminTrendingService, AdminAuditService, AdminChaptersService, AdminTopicsService, AdminMembersService],
})
export class AdminModule {}
