import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module.js';
import { EventsModule } from '../events/events.module.js';
import { ChaptersController } from './chapters.controller.js';
import { ChaptersService } from './chapters.service.js';
import { ChapterModerationService } from './chapter-moderation.service.js';
import { ChapterModerationEvents } from './chapter-moderation.events.js';
import { ModerationModule } from '../moderation/moderation.module.js';

/** Chapter pages: list, detail, members and the chapter team's tools (pins, About, moderation). */
@Module({
  imports: [PostsModule, EventsModule, ModerationModule],
  controllers: [ChaptersController],
  providers: [ChaptersService, ChapterModerationService, ChapterModerationEvents],
  exports: [ChaptersService],
})
export class ChaptersModule {}
