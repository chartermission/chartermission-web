import { Module } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { ClaudeContentSettingsController, ContentCalendarController } from './content-calendar.controller.js';
import { ContentCalendarService } from './content-calendar.service.js';
import { ContentCalendarEvents } from './content-calendar.events.js';

/** Admin console: the content calendar of posts written with Claude, and its review setting. */
@Module({
  imports: [ModerationModule, PostsModule],
  controllers: [ContentCalendarController, ClaudeContentSettingsController],
  providers: [ContentCalendarService, ContentCalendarEvents],
})
export class ContentCalendarModule {}
