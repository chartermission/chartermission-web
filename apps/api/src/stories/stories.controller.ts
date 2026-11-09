import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  AddToHighlightInput,
  CreateHighlightInput,
  CreateStoryInput,
  HighlightsQuery,
  UpdateHighlightInput,
  type HighlightView,
  type StoryTray,
  type StoryView,
  type StoryViewer,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { StoriesService } from './stories.service.js';

/** Stories in the feed strip and highlights on profiles (contracts/stories.ts). */
@Controller()
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get('stories/tray')
  @Access('member')
  tray(@Auth() ctx: AuthContext): Promise<StoryTray> {
    return this.stories.tray(ctx.user);
  }

  @Get('stories/archive')
  @Access('member')
  archive(@Auth() ctx: AuthContext): Promise<StoryView[]> {
    return this.stories.archive(ctx.user);
  }

  @Post('stories')
  @Access('verified')
  create(@Auth() ctx: AuthContext, @ZBody(CreateStoryInput) input: CreateStoryInput): Promise<StoryView> {
    return this.stories.create(ctx.user, input);
  }

  @Get('stories/:id')
  @Access('member')
  get(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<StoryView> {
    return this.stories.get(ctx.user, id);
  }

  @Post('stories/:id/view')
  @HttpCode(204)
  @Access('member')
  async view(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<void> {
    await this.stories.markViewed(ctx.user, id);
  }

  @Get('stories/:id/viewers')
  @Access('member')
  viewers(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<StoryViewer[]> {
    return this.stories.viewers(ctx.user, id);
  }

  @Delete('stories/:id')
  @HttpCode(204)
  @Access('member')
  async remove(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<void> {
    await this.stories.remove(ctx.user, id);
  }

  @Get('highlights')
  @Access('member')
  highlights(@Auth() ctx: AuthContext, @ZQuery(HighlightsQuery) q: HighlightsQuery): Promise<HighlightView[]> {
    return this.stories.highlights(ctx.user, q.member);
  }

  @Post('highlights')
  @Access('verified')
  createHighlight(@Auth() ctx: AuthContext, @ZBody(CreateHighlightInput) input: CreateHighlightInput): Promise<HighlightView> {
    return this.stories.createHighlight(ctx.user, input);
  }

  @Patch('highlights/:id')
  @Access('member')
  updateHighlight(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(UpdateHighlightInput) input: UpdateHighlightInput): Promise<HighlightView> {
    return this.stories.updateHighlight(ctx.user, id, input);
  }

  @Post('highlights/:id/stories')
  @HttpCode(200)
  @Access('member')
  addToHighlight(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(AddToHighlightInput) input: AddToHighlightInput): Promise<HighlightView> {
    return this.stories.addToHighlight(ctx.user, id, input);
  }

  @Delete('highlights/:id/stories/:storyId')
  @Access('member')
  removeFromHighlight(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Param('storyId') storyId: string): Promise<HighlightView> {
    return this.stories.removeFromHighlight(ctx.user, id, storyId);
  }

  @Delete('highlights/:id')
  @HttpCode(204)
  @Access('member')
  async deleteHighlight(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<void> {
    await this.stories.deleteHighlight(ctx.user, id);
  }
}
