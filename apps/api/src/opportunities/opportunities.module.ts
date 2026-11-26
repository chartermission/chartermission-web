import { Module } from '@nestjs/common';
import { OpportunitiesController } from './opportunities.controller.js';
import { OpportunityFeedService } from './opportunity-feed.service.js';
import { OpportunitiesService } from './opportunities.service.js';
import { OpportunitiesEvents } from './opportunities.events.js';

/** Opportunities: member listings (live on posting) and in-app applications. */
@Module({
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService, OpportunitiesEvents, OpportunityFeedService],
  exports: [OpportunitiesService, OpportunityFeedService],
})
export class OpportunitiesModule {}
