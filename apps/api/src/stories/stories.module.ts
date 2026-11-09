import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { StoriesController } from './stories.controller.js';
import { StoriesService } from './stories.service.js';

/** Stories (24 hours in the feed strip) and profile highlights. */
@Module({
  imports: [MediaModule],
  controllers: [StoriesController],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
