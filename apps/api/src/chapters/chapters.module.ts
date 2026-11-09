import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module.js';
import { EventsModule } from '../events/events.module.js';
import { ChaptersController } from './chapters.controller.js';
import { ChaptersService } from './chapters.service.js';

/** Chapter pages: list, detail, members and the Ambassador tools (pins, About). */
@Module({
  imports: [PostsModule, EventsModule],
  controllers: [ChaptersController],
  providers: [ChaptersService],
  exports: [ChaptersService],
})
export class ChaptersModule {}
