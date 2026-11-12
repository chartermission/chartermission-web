import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  AddGroupMembersInput,
  ConversationsQuery,
  CreateGroupInput,
  EditMessageInput,
  GroupRoleInput,
  MeetingResponseInput,
  MessageSearchQuery,
  MessagesQuery,
  ReactInput,
  SendMessageInput,
  ShareToMessagesInput,
  StartConversationInput,
  UpdateConversationInput,
  UpdateGroupInput,
  type ConversationView,
  type MessageRecipient,
  type MessageSearchHit,
  type MessagesConfig,
  type MessagesPage,
  type MessagesUnread,
  type MessageView,
  type TranslationView,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext, AppRequest } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { MessagesService } from './messages.service.js';
import { RealtimeService } from './realtime.service.js';

const Subscription = z.object({ on: z.boolean() });
const Recipients = z.object({ q: z.string().trim().max(100).optional() });

/** Messages: direct chats, requests, groups and chapter announcements (contracts/messages.ts). */
@Controller('messages')
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('config')
  @Access('member')
  config(): MessagesConfig {
    return this.messages.config();
  }

  /**
   * Live updates (Server-Sent Events): new and changed messages, typing, read receipts. A comment
   * line every 20 seconds keeps proxies from closing the connection and marks the member online.
   */
  @Get('stream')
  @Access('member')
  async stream(@Auth() ctx: AuthContext, @Req() req: AppRequest, @Res() res: Response): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('retry: 3000\n\n');
    const userId = ctx.user.id;
    await this.realtime.touch(userId);
    const stop = this.realtime.listen(userId, (event) => {
      res.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      res.write(': keep-alive\n\n');
      void this.realtime.touch(userId);
    }, 20_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      stop();
    });
  }

  @Get('conversations')
  @Access('member')
  list(@Auth() ctx: AuthContext, @ZQuery(ConversationsQuery) q: ConversationsQuery): Promise<ConversationView[]> {
    return this.messages.list(ctx.user, q);
  }

  @Get('unread')
  @Access('member')
  unread(@Auth() ctx: AuthContext): Promise<MessagesUnread> {
    return this.messages.unread(ctx.user);
  }

  @Get('search')
  @Access('member')
  search(@Auth() ctx: AuthContext, @ZQuery(MessageSearchQuery) q: MessageSearchQuery): Promise<MessageSearchHit[]> {
    return this.messages.search(ctx.user, q.q);
  }

  @Get('recipients')
  @Access('member')
  recipients(@Auth() ctx: AuthContext, @ZQuery(Recipients) q: z.infer<typeof Recipients>): Promise<MessageRecipient[]> {
    return this.messages.recipients(ctx.user, q.q);
  }

  @Post('share')
  @HttpCode(200)
  @Access('verified')
  share(@Auth() ctx: AuthContext, @ZBody(ShareToMessagesInput) input: ShareToMessagesInput): Promise<{ sent: number }> {
    return this.messages.shareTo(ctx.user, input);
  }

  @Post('conversations')
  @HttpCode(200)
  @Access('verified')
  start(@Auth() ctx: AuthContext, @ZBody(StartConversationInput) input: StartConversationInput): Promise<ConversationView> {
    return this.messages.start(ctx.user, input);
  }

  @Get('conversations/:id')
  @Access('member')
  view(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<ConversationView> {
    return this.messages.view(ctx.user, id);
  }

  @Patch('conversations/:id')
  @Access('member')
  organise(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(UpdateConversationInput) input: UpdateConversationInput): Promise<ConversationView> {
    return this.messages.organise(ctx.user, id, input);
  }

  @Post('conversations/:id/accept')
  @HttpCode(200)
  @Access('member')
  accept(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<ConversationView> {
    return this.messages.accept(ctx.user, id);
  }

  @Post('conversations/:id/decline')
  @HttpCode(204)
  @Access('member')
  decline(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<void> {
    return this.messages.decline(ctx.user, id);
  }

  @Get('conversations/:id/messages')
  @Access('member')
  page(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZQuery(MessagesQuery) q: MessagesQuery): Promise<MessagesPage> {
    return this.messages.page(ctx.user, id, q);
  }

  @Post('conversations/:id/messages')
  @Access('verified')
  send(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(SendMessageInput) input: SendMessageInput): Promise<MessageView> {
    return this.messages.send(ctx.user, id, input);
  }

  @Post('conversations/:id/read')
  @HttpCode(204)
  @Access('member')
  read(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<void> {
    return this.messages.markRead(ctx.user, id);
  }

  @Post('conversations/:id/typing')
  @HttpCode(204)
  @Access('member')
  typing(@Auth() ctx: AuthContext, @UuidParam('id') id: string): Promise<void> {
    return this.messages.typing(ctx.user, id);
  }

  @Post('groups')
  @Access('verified')
  createGroup(@Auth() ctx: AuthContext, @ZBody(CreateGroupInput) input: CreateGroupInput): Promise<ConversationView> {
    return this.messages.createGroup(ctx.user, input);
  }

  @Patch('groups/:id')
  @Access('verified')
  renameGroup(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(UpdateGroupInput) input: UpdateGroupInput): Promise<ConversationView> {
    return this.messages.renameGroup(ctx.user, id, input);
  }

  @Post('groups/:id/members')
  @HttpCode(200)
  @Access('verified')
  addMembers(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @ZBody(AddGroupMembersInput) input: AddGroupMembersInput): Promise<ConversationView> {
    return this.messages.addMembers(ctx.user, id, input);
  }

  @Delete('groups/:id/members/:memberId')
  @HttpCode(204)
  @Access('member')
  removeMember(@Auth() ctx: AuthContext, @UuidParam('id') id: string, @UuidParam('memberId') memberId: string): Promise<void> {
    return this.messages.removeMember(ctx.user, id, memberId);
  }

  @Put('groups/:id/members/:memberId/role')
  @Access('verified')
  setRole(
    @Auth() ctx: AuthContext,
    @UuidParam('id') id: string,
    @UuidParam('memberId') memberId: string,
    @ZBody(GroupRoleInput) input: GroupRoleInput,
  ): Promise<ConversationView> {
    return this.messages.setRole(ctx.user, id, memberId, input.role);
  }

  @Get('announcements/:chapterSlug')
  @Access('member')
  announcements(@Auth() ctx: AuthContext, @Param('chapterSlug') slug: string): Promise<ConversationView> {
    return this.messages.announcements(ctx.user, slug);
  }

  @Put('announcements/:chapterSlug/subscription')
  @Access('member')
  setAnnouncements(@Auth() ctx: AuthContext, @Param('chapterSlug') slug: string, @ZBody(Subscription) input: z.infer<typeof Subscription>): Promise<ConversationView> {
    return this.messages.setAnnouncements(ctx.user, slug, input.on);
  }

  @Patch(':messageId')
  @Access('verified')
  edit(@Auth() ctx: AuthContext, @UuidParam('messageId') messageId: string, @ZBody(EditMessageInput) input: EditMessageInput): Promise<MessageView> {
    return this.messages.edit(ctx.user, messageId, input);
  }

  @Delete(':messageId')
  @Access('member')
  remove(@Auth() ctx: AuthContext, @UuidParam('messageId') messageId: string): Promise<MessageView> {
    return this.messages.remove(ctx.user, messageId);
  }

  @Put(':messageId/reaction')
  @Access('verified')
  react(@Auth() ctx: AuthContext, @UuidParam('messageId') messageId: string, @ZBody(ReactInput) input: ReactInput): Promise<MessageView> {
    return this.messages.react(ctx.user, messageId, input);
  }

  @Delete(':messageId/reaction')
  @Access('member')
  unreact(@Auth() ctx: AuthContext, @UuidParam('messageId') messageId: string): Promise<MessageView> {
    return this.messages.unreact(ctx.user, messageId);
  }

  @Post(':messageId/translate')
  @HttpCode(200)
  @Access('member')
  translate(@Auth() ctx: AuthContext, @UuidParam('messageId') messageId: string): Promise<TranslationView> {
    return this.messages.translate(ctx.user, messageId);
  }

  @Post(':messageId/meeting')
  @HttpCode(200)
  @Access('verified')
  meeting(@Auth() ctx: AuthContext, @UuidParam('messageId') messageId: string, @ZBody(MeetingResponseInput) input: MeetingResponseInput): Promise<MessageView> {
    return this.messages.respondToMeeting(ctx.user, messageId, input);
  }

  @Get(':messageId/meeting.ics')
  @Access('member')
  async meetingIcs(@Auth() ctx: AuthContext, @UuidParam('messageId') messageId: string, @Res() res: Response): Promise<void> {
    const body = await this.messages.meetingIcs(ctx.user, messageId);
    res
      .status(200)
      .set('Content-Type', 'text/calendar; charset=utf-8')
      .set('Content-Disposition', 'attachment; filename="meeting.ics"')
      .set('Cache-Control', 'private, no-store')
      .send(body);
  }
}

