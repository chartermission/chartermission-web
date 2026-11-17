import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module.js';
import { AdminAnnouncementsController, AdminInboxController, AdminMessagingSettingsController } from './announcements.controller.js';
import { AnnouncementsService } from './announcements.service.js';
import { InboxService } from './inbox.service.js';
import { MessagingSettingsService } from './messaging-settings.service.js';

/** Messages from Charter Mission: bulk messages, the Charter Mission inbox and the sender setting (admin console → Messages). */
@Module({
  imports: [MessagesModule],
  controllers: [AdminAnnouncementsController, AdminInboxController, AdminMessagingSettingsController],
  providers: [AnnouncementsService, InboxService, MessagingSettingsService],
})
export class AnnouncementsModule {}
