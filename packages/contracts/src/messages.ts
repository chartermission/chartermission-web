import { z } from "zod";
import { MemberRef } from "./common.js";

/*
 * Private messages between two members. A member can start a conversation with any of their
 * connections; once a conversation exists either of them can write in it, unless one has blocked
 * the other. Official Charter Mission accounts, which have no connections, can't be messaged.
 */

export const MESSAGE_MAX_CHARS = 4000;

export const MessageView = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderId: z.string().uuid(),
  /** Empty when the sender deleted the message, or a moderator removed it. */
  body: z.string(),
  deleted: z.boolean(),
  /** Hidden or removed by a moderator after a report. */
  removed: z.boolean(),
  createdAt: z.string(),
});
export type MessageView = z.infer<typeof MessageView>;

export const ConversationView = z.object({
  id: z.string().uuid(),
  /** The other member. */
  member: MemberRef,
  lastMessage: z.object({ body: z.string(), mine: z.boolean(), deleted: z.boolean(), removed: z.boolean(), createdAt: z.string() }).nullable(),
  /** Messages from the other member since the viewer last opened the conversation. */
  unread: z.number().int(),
  /** False when either has blocked the other, or the other member's account is no longer active. */
  canSend: z.boolean(),
  /** When the other member last opened the conversation: the viewer's messages up to then are "Seen". */
  seenAt: z.string().nullable(),
});
export type ConversationView = z.infer<typeof ConversationView>;

/** POST /messages/conversations — open (or find) the conversation with a connection. */
export const StartConversationInput = z.object({ memberId: z.string().uuid() });
export type StartConversationInput = z.infer<typeof StartConversationInput>;

/** POST /messages/conversations/{id}/messages */
export const SendMessageInput = z.object({
  body: z.string().trim().min(1, "Write a message first").max(MESSAGE_MAX_CHARS, `Keep it under ${MESSAGE_MAX_CHARS} characters`),
});
export type SendMessageInput = z.infer<typeof SendMessageInput>;

/**
 * GET /messages/conversations/{id}/messages — newest page first; `before` pages back through
 * older messages, `after` (a message's createdAt) returns only what arrived since.
 */
export const MessagesQuery = z.object({
  before: z.string().max(200).optional(),
  after: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type MessagesQuery = z.infer<typeof MessagesQuery>;

/** Oldest first within the page. `olderCursor` is null when there is nothing earlier. */
export type MessagesPage = { conversation: ConversationView; items: MessageView[]; olderCursor: string | null };

/** GET /messages/unread — conversations with something unread, for the badge. */
export const MessagesUnread = z.object({ unread: z.number().int() });
export type MessagesUnread = z.infer<typeof MessagesUnread>;
