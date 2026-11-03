import { Controller, Delete, Get, HttpCode, Patch, Post, Put, Req } from '@nestjs/common';
import {
  BookmarkInput,
  CommentsQuery,
  CreateCommentInput,
  CreatePostInput,
  CursorQuery,
  PollVoteInput,
  ReactionInput,
  UpdateCommentInput,
  UpdatePostInput,
  type CommentView,
  type Ok,
  type Page,
  type PostView,
  type ReactionState,
} from '@chartermission/contracts';
import { Access, Auth, OptionalAuth, checkAccess } from '../core/guards.js';
import { clientIp, type AppRequest, type AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { PostsService } from './posts.service.js';
import { CommentsService } from './comments.service.js';
import { ReactionsService } from './reactions.service.js';

@Controller()
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly commentsService: CommentsService,
    private readonly reactionsService: ReactionsService,
  ) {}

  /* ---------- Posts ---------- */

  @Post('posts')
  @Access('verified', 'post.create')
  create(@Auth() ctx: AuthContext, @ZBody(CreatePostInput) input: CreatePostInput): Promise<PostView> {
    return this.postsService.create(ctx.user, input);
  }

  /** Members see what the visibility rules allow; visitors only see public posts. */
  @Get('posts/:id')
  get(@OptionalAuth() auth: AuthContext | undefined, @UuidParam('id') id: string): Promise<PostView> {
    if (auth) checkAccess(auth, 'member');
    return this.postsService.get(auth?.user, id);
  }

  @Patch('posts/:id')
  @Access('verified')
  update(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(UpdatePostInput) input: UpdatePostInput): Promise<PostView> {
    return this.postsService.update(ctx.user, id, input);
  }

  @Delete('posts/:id')
  @Access('member')
  async remove(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    await this.postsService.remove(ctx.user, id, clientIp(req));
    return { ok: true };
  }

  @Post('posts/:id/poll/vote')
  @HttpCode(200)
  @Access('verified')
  vote(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(PollVoteInput) input: PollVoteInput): Promise<PostView> {
    return this.postsService.vote(ctx.user, id, input.optionId);
  }

  /* ---------- Comments (one level of replies) ---------- */

  @Get('posts/:id/comments')
  @Access('member')
  comments(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZQuery(CommentsQuery) q: CommentsQuery): Promise<Page<CommentView>> {
    return this.commentsService.list(ctx.user, id, q);
  }

  @Get('comments/:id/replies')
  @Access('member')
  replies(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZQuery(CursorQuery) q: CursorQuery): Promise<Page<CommentView>> {
    return this.commentsService.replies(ctx.user, id, q);
  }

  @Post('posts/:id/comments')
  @Access('verified', 'comment.create')
  comment(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(CreateCommentInput) input: CreateCommentInput): Promise<CommentView> {
    return this.commentsService.create(ctx.user, id, input);
  }

  @Patch('comments/:id')
  @Access('verified')
  updateComment(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @ZBody(UpdateCommentInput) input: UpdateCommentInput,
  ): Promise<CommentView> {
    return this.commentsService.update(ctx.user, id, input);
  }

  @Delete('comments/:id')
  @Access('member')
  async removeComment(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @Req() req: AppRequest): Promise<Ok> {
    await this.commentsService.remove(ctx.user, id, clientIp(req));
    return { ok: true };
  }

  /* ---------- Reactions and bookmarks ---------- */

  @Put('reactions')
  @Access('verified', 'reaction.create')
  react(@Auth() ctx: AuthContext, @ZBody(ReactionInput) input: ReactionInput): Promise<ReactionState> {
    return this.reactionsService.set(ctx.user, input);
  }

  @Delete('reactions')
  @Access('verified')
  unreact(@Auth() ctx: AuthContext, @ZBody(ReactionInput) input: ReactionInput): Promise<ReactionState> {
    return this.reactionsService.remove(ctx.user, input);
  }

  @Put('bookmarks')
  @Access('verified')
  async bookmark(@Auth() ctx: AuthContext, @ZBody(BookmarkInput) input: BookmarkInput): Promise<Ok> {
    await this.reactionsService.bookmark(ctx.user, input);
    return { ok: true };
  }

  @Delete('bookmarks')
  @Access('verified')
  async unbookmark(@Auth() ctx: AuthContext, @ZBody(BookmarkInput) input: BookmarkInput): Promise<Ok> {
    await this.reactionsService.unbookmark(ctx.user, input);
    return { ok: true };
  }

  @Get('me/bookmarks')
  @Access('member')
  bookmarks(@Auth() ctx: AuthContext, @ZQuery(CursorQuery) q: CursorQuery): Promise<Page<PostView>> {
    return this.reactionsService.listBookmarks(ctx.user, q);
  }
}
