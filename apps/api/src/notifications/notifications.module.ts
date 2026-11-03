import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationHandlers } from './notification-handlers.js';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationHandlers],
  exports: [NotificationsService],
})
export class NotificationsModule {}
