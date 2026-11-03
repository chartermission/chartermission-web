import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module.js';
import { FeedController } from './feed.controller.js';
import { FeedService } from './feed.service.js';

@Module({
  imports: [PostsModule],
  controllers: [FeedController],
  providers: [FeedService],
})
export class FeedModule {}
