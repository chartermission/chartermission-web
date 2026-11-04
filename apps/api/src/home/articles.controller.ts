import { Controller, Get, Param } from '@nestjs/common';
import { ArticlesQuery, type ArticlesHub, type Page, type PostView, type RelatedArticles } from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZQuery } from '../common/validation.js';
import { ArticlesService } from './articles.service.js';

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  @Access('member')
  list(@Auth() ctx: AuthContext, @ZQuery(ArticlesQuery) q: ArticlesQuery): Promise<Page<PostView>> {
    return this.articles.list(ctx.user, q);
  }

  @Get('hub')
  @Access('member')
  hub(@Auth() ctx: AuthContext): Promise<ArticlesHub> {
    return this.articles.hub(ctx.user);
  }

  @Get(':id/related')
  @Access('member')
  related(@Auth() ctx: AuthContext, @Param('id') id: string): Promise<RelatedArticles> {
    return this.articles.related(ctx.user, id);
  }
}
