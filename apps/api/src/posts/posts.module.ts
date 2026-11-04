import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { PostsController } from './posts.controller.js';
import { PostsService } from './posts.service.js';
import { CommentsService } from './comments.service.js';
import { ReactionsService } from './reactions.service.js';
import { PostSerializer } from './post-serializer.js';
import { LinkPreviewService } from './link-preview.js';
import { DraftsController } from './drafts.controller.js';
import { DraftsService } from './drafts.service.js';

@Module({
  imports: [MediaModule],
  controllers: [PostsController, DraftsController],
  providers: [PostsService, CommentsService, ReactionsService, PostSerializer, LinkPreviewService, DraftsService],
  exports: [PostsService, CommentsService, PostSerializer, LinkPreviewService, DraftsService],
})
export class PostsModule {}
