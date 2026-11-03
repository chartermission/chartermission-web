import { Controller, Get, Param } from '@nestjs/common';
import {
  HashtagSuggestQuery,
  TopicPostsQuery,
  TrendingQuery,
  type HashtagSuggestion,
  type Page,
  type PostView,
  type TopicView,
  type TrendingResponse,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZQuery } from '../common/validation.js';
import { TopicsService } from './topics.service.js';

@Controller()
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  @Get('topics/:tag')
  @Access('member')
  topic(@Auth() ctx: AuthContext, @Param('tag') tag: string): Promise<TopicView> {
    return this.topics.topic(ctx.user, tag);
  }

  @Get('topics/:tag/posts')
  @Access('member')
  posts(@Auth() ctx: AuthContext, @Param('tag') tag: string, @ZQuery(TopicPostsQuery) q: TopicPostsQuery): Promise<Page<PostView>> {
    return this.topics.topicPosts(ctx.user, tag, q);
  }

  @Get('hashtags/suggest')
  @Access('member')
  suggest(@ZQuery(HashtagSuggestQuery) q: HashtagSuggestQuery): Promise<HashtagSuggestion[]> {
    return this.topics.suggest(q.q);
  }

  /** Aggregate data only (suppressed and below-threshold tags never appear), so visitors may read it too. */
  @Get('trending')
  trending(@ZQuery(TrendingQuery) q: TrendingQuery): Promise<TrendingResponse> {
    return this.topics.trending(q);
  }
}
