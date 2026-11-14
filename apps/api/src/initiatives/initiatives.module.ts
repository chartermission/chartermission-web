import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module.js';
import { InitiativeAccess } from './initiative-access.service.js';
import { InitiativesController } from './initiatives.controller.js';
import { InitiativesEvents } from './initiatives.events.js';
import { InitiativesService } from './initiatives.service.js';

/**
 * Initiatives: projects hosted by members, pages or chapters, with roles, milestones, a team, join
 * requests, followers and updates (posts). InitiativeAccess is exported for posting updates.
 */
@Module({
  imports: [EventsModule],
  controllers: [InitiativesController],
  providers: [InitiativeAccess, InitiativesService, InitiativesEvents],
  exports: [InitiativeAccess, InitiativesService],
})
export class InitiativesModule {}
