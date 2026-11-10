import { Module } from '@nestjs/common';
import { PostsModule } from '../posts/posts.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { PeopleController } from './people.controller.js';
import { PeopleService } from './people.service.js';

@Module({
  imports: [PostsModule, ProfilesModule],
  controllers: [PeopleController],
  providers: [PeopleService],
})
export class PeopleModule {}
