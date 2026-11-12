import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { PreviewModule } from '../preview/preview.module.js';
import { MessageViews } from './message-views.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { RealtimeService } from './realtime.service.js';
import { TranslateService } from './translate.service.js';

/** Messages: direct chats, requests, groups, chapter announcements, live delivery. */
@Module({
  imports: [EventsModule, PostsModule, PreviewModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessageViews, RealtimeService, TranslateService],
  exports: [MessagesService],
})
export class MessagesModule {}
