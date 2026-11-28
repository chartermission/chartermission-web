import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { PostsModule } from '../posts/posts.module.js';
import { OpportunitiesController } from './opportunities.controller.js';
import { AdminOpportunitiesController } from './admin-opportunities.controller.js';
import { AdminOpportunitiesService } from './admin-opportunities.service.js';
import { OpportunityFeedService } from './opportunity-feed.service.js';
import { OpportunitiesService } from './opportunities.service.js';
import { OpportunitiesEvents } from './opportunities.events.js';

/** Opportunities: member listings (live on posting), in-app applications, and the admin console's list and import. */
@Module({
  imports: [PostsModule, MediaModule],
  controllers: [OpportunitiesController, AdminOpportunitiesController],
  providers: [OpportunitiesService, OpportunitiesEvents, OpportunityFeedService, AdminOpportunitiesService],
  exports: [OpportunitiesService, OpportunityFeedService],
})
export class OpportunitiesModule {}
