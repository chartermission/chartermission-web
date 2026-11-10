import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module.js';
import { ArticlesController } from './articles.controller.js';
import { ArticlesService } from './articles.service.js';
import { HomeController } from './home.controller.js';
import { HomeQueries } from './home-queries.js';
import { HomeService } from './home.service.js';
import { MomentsService } from './moments.service.js';
import { PublicController, PublicOverviewService } from './public.controller.js';

/** Home feed character (welcome strip, moment cards) and the Articles section. Read-only apart from visit tracking. */
@Module({
  imports: [PostsModule],
  controllers: [HomeController, ArticlesController, PublicController],
  providers: [HomeQueries, HomeService, MomentsService, ArticlesService, PublicOverviewService],
})
export class HomeModule {}
