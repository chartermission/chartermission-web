import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';
import { CommentsService } from './comments.service.js';
import { ReactionsService } from './reactions.service.js';
import { PostSerializer } from './post-serializer.js';
import { LinkPreviewService } from './link-preview.js';

@Module({
  imports: [MediaModule],
  controllers: [PostsController],
  providers: [PostsService, CommentsService, ReactionsService, PostSerializer, LinkPreviewService],
  exports: [PostsService, CommentsService, PostSerializer, LinkPreviewService],
})
export class PostsModule {}
