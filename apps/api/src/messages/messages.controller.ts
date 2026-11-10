import { Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import {
  MessagesQuery,
  SendMessageInput,
  StartConversationInput,
  type ConversationView,
  type MessagesPage,
  type MessagesUnread,
  type MessageView,
} from '@chartermission/contracts';
import { Access, Auth } from '../core/guards.js';
import type { AuthContext } from '../core/auth-context.js';
import { ZBody, ZQuery } from '../common/validation.js';
import { UuidParam } from '../media/uuid-param.js';
import { MessagesService } from './messages.service.js';

/** Private messages between two members (contracts/messages.ts). */
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('conversations')
  @Access('member')
  list(@Auth() ctx: AuthContext): Promise<ConversationView[]> {
    return this.messages.list(ctx.user);
  }

  @Get('unread')
  @Access('member')
  async unread(@Auth() ctx: AuthContext): Promise<MessagesUnread> {
    return { unread: await this.messages.unread(ctx.user) };
  }

  @Post('conversations')
  @HttpCode(200)
  @Access('verified')
  start(@Auth() ctx: AuthContext, @ZBody(StartConversationInput) input: StartConversationInput): Promise<ConversationView> {
    return this.messages.start(ctx.user, input);
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

  @Delete(':messageId')
  @Access('member')
  remove(@Auth() ctx: AuthContext, @UuidParam('messageId') messageId: string): Promise<MessageView> {
    return this.messages.remove(ctx.user, messageId);
  }
}
