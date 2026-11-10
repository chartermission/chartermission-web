import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

/** Private messages between connected members. */
@Module({ controllers: [MessagesController], providers: [MessagesService] })
export class MessagesModule {}
