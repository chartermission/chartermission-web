import { Module } from '@nestjs/common';
import { ConnectionsController, ProfilesController, RelationshipsController } from './profiles.controller.js';
import { ProfilesService } from './profiles.service.js';
import { TaxonomyService } from './taxonomy.service.js';
import { HandleService } from './handles.js';
import { RelationshipService } from './relationship.service.js';
import { DirectoryService } from './directory.service.js';
import { SuggestionsService } from './suggestions.service.js';
import { ConnectionsService } from './connections.service.js';
import { FollowsService } from './follows.service.js';
import { BlocksService } from './blocks.service.js';
import { ProfilesEvents } from './profiles.events.js';

const exported = [ProfilesService, TaxonomyService, HandleService, RelationshipService, SuggestionsService, FollowsService];

/** Member profiles, directory, suggestions, connections, follows, blocks and mutes (spec 4.3, 4.4, 4.6). */
@Module({
  controllers: [ProfilesController, ConnectionsController, RelationshipsController],
  providers: [...exported, DirectoryService, ConnectionsService, BlocksService, ProfilesEvents],
  exports: exported,
})
export class ProfilesModule {}
