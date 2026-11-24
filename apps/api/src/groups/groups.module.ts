import { ProfilesModule } from '../profiles/profiles.module.js';
import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module.js';
import { GroupsController } from './groups.controller.js';
import { GroupsService } from './groups.service.js';
import { GroupMembersService } from './group-members.service.js';
import { GroupPostsService } from './group-posts.service.js';
import { GroupsEvents } from './groups.events.js';

/**
 * Groups: communities members join around a shared interest, run by a member, a page or a chapter.
 * Who may see and do what lives in group-access.ts, which the post pipeline uses too.
 */
@Module({
  imports: [PostsModule, ProfilesModule],
  controllers: [GroupsController],
  providers: [GroupsService, GroupMembersService, GroupPostsService, GroupsEvents],
  exports: [GroupsService],
})
export class GroupsModule {}
