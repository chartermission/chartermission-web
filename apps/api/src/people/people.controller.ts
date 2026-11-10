import { Controller, Get, Param } from '@nestjs/common';
import { PeopleQuery, type PeoplePage } from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZQuery } from '../common/validation.js';
import { Errors } from '../common/errors.js';
import { isUuid } from '../profiles/taxonomy.service.js';
import { PeopleService } from './people.service.js';

const idOr404 = (id: string, what: string) => {
  if (!isUuid(id)) throw Errors.notFound(what);
  return id;
};

/** Member lists behind the counts (see PeoplePage in the contracts). Signed-in members only. */
@Controller()
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  @Get('posts/:id/reactions')
  @Access('session')
  postReactions(@Auth() ctx: AuthContext, @Param('id') id: string, @ZQuery(PeopleQuery) q: PeopleQuery): Promise<PeoplePage> {
    return this.people.reactions(ctx, 'post', idOr404(id, 'Post'), q);
  }

  @Get('comments/:id/reactions')
  @Access('session')
  commentReactions(@Auth() ctx: AuthContext, @Param('id') id: string, @ZQuery(PeopleQuery) q: PeopleQuery): Promise<PeoplePage> {
    return this.people.reactions(ctx, 'comment', idOr404(id, 'Comment'), q);
  }

  @Get('posts/:id/commenters')
  @Access('session')
  commenters(@Auth() ctx: AuthContext, @Param('id') id: string, @ZQuery(PeopleQuery) q: PeopleQuery): Promise<PeoplePage> {
    return this.people.commenters(ctx, idOr404(id, 'Post'), q);
  }

  @Get('posts/:id/reposts')
  @Access('session')
  reposters(@Auth() ctx: AuthContext, @Param('id') id: string, @ZQuery(PeopleQuery) q: PeopleQuery): Promise<PeoplePage> {
    return this.people.reposters(ctx, idOr404(id, 'Post'), q);
  }

  @Get('members/:handle/followers')
  @Access('session')
  followers(@Auth() ctx: AuthContext, @Param('handle') handle: string, @ZQuery(PeopleQuery) q: PeopleQuery): Promise<PeoplePage> {
    return this.people.followers(ctx, handle.slice(0, 60), q);
  }

  @Get('members/:handle/following')
  @Access('session')
  following(@Auth() ctx: AuthContext, @Param('handle') handle: string, @ZQuery(PeopleQuery) q: PeopleQuery): Promise<PeoplePage> {
    return this.people.following(ctx, handle.slice(0, 60), q);
  }

  @Get('members/:handle/connections')
  @Access('session')
  connections(@Auth() ctx: AuthContext, @Param('handle') handle: string, @ZQuery(PeopleQuery) q: PeopleQuery): Promise<PeoplePage> {
    return this.people.connectionsOf(ctx, handle.slice(0, 60), q);
  }

  @Get('pages/:slug/followers')
  @Access('session')
  pageFollowers(@Auth() ctx: AuthContext, @Param('slug') slug: string, @ZQuery(PeopleQuery) q: PeopleQuery): Promise<PeoplePage> {
    return this.people.pageFollowers(ctx, slug.slice(0, 80), q);
  }
}
