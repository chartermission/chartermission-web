import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module.js';
import { OAuthModule } from '../oauth/oauth.module.js';
import { AdminAuditController, AdminModerationController, AdminSettingsController, AdminTrendingController } from './admin.controller.js';
import { AdminQueueService } from './admin-queue.service.js';
import { AdminTrendingService } from './admin-trending.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminBadgesController, AdminChaptersController, AdminMembersController, AdminTopicsController } from './admin-catalogue.controller.js';
import { AdminChaptersService } from './admin-chapters.service.js';
import { AdminTopicsService } from './admin-topics.service.js';
import { AdminMembersService } from './admin-members.service.js';
import { AdminProfileOptionsController } from './admin-profile-options.controller.js';
import { AdminProfileOptionsService } from './admin-profile-options.service.js';

/** Admin console APIs for moderation, trending controls and the audit log (spec 4.15). */
@Module({
  imports: [ModerationModule, OAuthModule],
  controllers: [
    AdminModerationController,
    AdminTrendingController,
    AdminAuditController,
    AdminSettingsController,
    AdminChaptersController,
    AdminTopicsController,
    AdminBadgesController,
    AdminMembersController,
    AdminProfileOptionsController,
  ],
  providers: [AdminQueueService, AdminTrendingService, AdminAuditService, AdminChaptersService, AdminTopicsService, AdminMembersService, AdminProfileOptionsService],
})
export class AdminModule {}
