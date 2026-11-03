import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module.js';
import { TopicsController } from './topics.controller.js';
import { TopicsService } from './topics.service.js';
import { TrendingService } from './trending.service.js';

@Module({
  imports: [PostsModule],
  controllers: [TopicsController],
  providers: [TopicsService, TrendingService],
  exports: [TopicsService, TrendingService],
})
export class TopicsModule {}
