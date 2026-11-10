import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { PreviewController } from './preview.controller.js';
import { PreviewService } from './preview.service.js';

@Module({
  imports: [PostsModule, MediaModule],
  controllers: [PreviewController],
  providers: [PreviewService],
})
export class PreviewModule {}
