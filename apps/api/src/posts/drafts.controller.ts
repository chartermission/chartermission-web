import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { DraftsQuery, SaveDraftInput, type DraftView, type Ok, type Page, type PostView } from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { DraftsService } from './drafts.service.js';

/** Composer drafts and scheduled posts (the member's own only). */
@Controller('me/drafts')
export class DraftsController {
  constructor(private readonly drafts: DraftsService) {}

  @Get()
  @Access('member')
  list(@Auth() ctx: AuthContext, @ZQuery(DraftsQuery) q: DraftsQuery): Promise<Page<DraftView>> {
    return this.drafts.list(ctx.user, q);
  }

  @Get(':id')
  @Access('member')
  get(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<DraftView> {
    return this.drafts.get(ctx.user, id);
  }

  @Post()
  @Access('verified', 'post.create')
  create(@Auth() ctx: AuthContext, @ZBody(SaveDraftInput) input: SaveDraftInput): Promise<DraftView> {
    return this.drafts.create(ctx.user, input);
  }

  @Patch(':id')
  @Access('verified', 'post.create')
  update(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(SaveDraftInput) input: SaveDraftInput): Promise<DraftView> {
    return this.drafts.update(ctx.user, id, input);
  }

  @Delete(':id')
  @Access('member')
  async remove(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<Ok> {
    await this.drafts.remove(ctx.user, id);
    return { ok: true };
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Access('verified', 'post.create')
  publish(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<PostView> {
    return this.drafts.publish(ctx.user, id);
  }
}
