import { randomBytes } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  GROUP_MAX_MEMBERS,
  MESSAGE_EDIT_WINDOW_MINUTES,
  SendMessageInput as SendMessageSchema,
  type AddGroupMembersInput,
  type ConversationView,
  type ConversationsQuery,
  type CreateGroupInput,
  type EditMessageInput,
  type MeetingInput,
  type MeetingResponseInput,
  type MeetingView,
  type MessageRecipient,
  type MessageSearchHit,
  type MessagesConfig,
  type MessagesPage,
  type MessagesQuery,
  type MessageStreamEvent,
  type MessageView,
  type ReactInput,
  type SendMessageInput,
  type ShareToMessagesInput,
  type ShareType,
  type StartConversationInput,
  type TranslationView,
  type UpdateConversationInput,
  type UpdateGroupInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import {
  chapters,
  connections,
  conversationMembers,
  conversations,
  eventRegistrations,
  files,
  follows,
  memberProfiles,
  messageAttachments,
  messageReactions,
  messageTranslations,
  messages,
  users,
} from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';
import { RelationsService } from '../core/relations.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { QueueService } from '../infra/queue.service.js';
import { MailService } from '../infra/mail.service.js';
import { webUrl } from '../infra/mail-layout.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { assertNotRestricted } from '../posts/posts.service.js';
import { LinkPreviewService, embedPreview } from '../posts/link-preview.js';
import { firstHttpsUrl } from '../posts/text-parse.js';
import { EventAccess, canManage as canManageEvent } from '../events/event-access.js';
import { icsDate, icsEscape, icsFold } from '../events/ics.js';
import { PushService } from '../push/push.service.js';
import { MessageViews, ACTIVE, summary, visible, type ConversationRow, type MemberRow, type MessageRow } from './message-views.js';
import { RealtimeService } from './realtime.service.js';
import { TranslateService } from './translate.service.js';

/** An unread conversation is emailed about after this long, once per window. */
const UNREAD_EMAIL_DELAY_MS = 3 * 3600_000;
const MUTE_FOREVER = new Date('2999-01-01T00:00:00Z');

/**
 * Messages (contracts/messages.ts): direct chats, message requests, groups and chapter
 * announcements. Only a conversation's members can read it. Every change is pushed live to the
 * members' open apps (RealtimeService); members who are away get a notification, a browser push and,
 * if it stays unread for a few hours, an email in their language.
 */
@Injectable()
export class MessagesService implements OnModuleInit {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly limits: RateLimitService,
    private readonly notify: NotifyService,
    private readonly queue: QueueService,
    private readonly mail: MailService,
    private readonly views: MessageViews,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly translator: TranslateService,
    private readonly linkPreviews: LinkPreviewService,
    private readonly eventAccess: EventAccess,
  ) {}

  onModuleInit() {
    this.queue.process('events', async (name, data: { conversationId: string; userId: string; messageId?: string }) => {
      if (name === 'message-unread-email') await this.unreadEmail(data.conversationId, data.userId);
      if (name === 'message-link-preview' && data.messageId) await this.refreshLinkPreview(data.messageId);
    });
  }

  config(): MessagesConfig {
    return { translation: this.translator.enabled(), pushPublicKey: this.push.publicKey() };
  }

  /* ======================= Conversations ======================= */

  /** GET /messages/conversations?box= — pinned first, then latest activity. */
  async list(user: AuthUser, q: ConversationsQuery): Promise<ConversationView[]> {
    const boxCondition =
      q.box === 'requests'
        ? and(eq(conversations.status, 'request'), ne(conversations.requestedBy, user.id), isNull(conversationMembers.archivedAt))
        : q.box === 'archived'
          ? isNotNull(conversationMembers.archivedAt)
          : and(
              isNull(conversationMembers.archivedAt),
              or(ne(conversations.status, 'request'), eq(conversations.requestedBy, user.id)),
              or(ne(conversations.status, 'declined'), eq(conversations.requestedBy, user.id)),
            );
    const rows = await this.db
      .select({ c: conversations })
      .from(conversations)
      .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, user.id)))
      .where(and(isNull(conversationMembers.leftAt), isNotNull(conversations.lastMessageAt), boxCondition))
      .orderBy(sql`${conversationMembers.pinnedAt} desc nulls last`, desc(conversations.lastMessageAt))
      .limit(300);
    await this.promoteConnectedRequests(
      user.id,
      rows.map((r) => r.c),
    );
    return this.views.conversations(
      user.id,
      rows.map((r) => r.c),
      (chapterId) => this.isChapterTeam(user, chapterId),
    );
  }

  /** GET /messages/unread — conversations with something unread (not muted), and waiting requests. */
  async unread(user: AuthUser): Promise<{ unread: number; requests: number }> {
    const rows = await this.db
      .select({ c: conversations, m: conversationMembers })
      .from(conversations)
      .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, user.id)))
      .where(and(isNull(conversationMembers.leftAt), isNotNull(conversations.lastMessageAt), ne(conversations.status, 'declined')))
      .limit(1000);
    const now = Date.now();
    const counts = await this.views.unreadCounts(
      user.id,
      rows.map((r) => r.c),
    );
    let unread = 0;
    let requests = 0;
    for (const { c, m } of rows) {
      const has = (counts.get(c.id) ?? 0) > 0 || m.markedUnread;
      if (!has) continue;
      if (c.status === 'request' && c.requestedBy !== user.id) requests++;
      else if (!(m.mutedUntil && m.mutedUntil.getTime() > now) && !m.archivedAt) unread++;
    }
    return { unread, requests };
  }

  /** POST /messages/conversations — the direct chat with a member, created on first use. Non-connections get a message request. */
  async start(user: AuthUser, input: StartConversationInput): Promise<ConversationView> {
    assertNotRestricted(user);
    if (input.memberId === user.id) throw Errors.badRequest('You can’t message yourself');
    const [a, b] = input.memberId < user.id ? [input.memberId, user.id] : [user.id, input.memberId];
    let [row] = await this.db.select().from(conversations).where(and(eq(conversations.memberA, a), eq(conversations.memberB, b))).limit(1);
    if (!row) {
      const [other] = await this.db.select({ id: users.id, status: users.status, isOfficial: users.isOfficial }).from(users).where(eq(users.id, input.memberId)).limit(1);
      if (!other || !ACTIVE.includes(other.status) || (await this.relations.isBlockedEitherWay(user.id, input.memberId))) throw Errors.notFound('That member');
      if (other.isOfficial || user.isOfficial) throw Errors.forbidden('Official Charter Mission accounts don’t take private messages');
      const connected = await this.connected(user.id, input.memberId);
      await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(conversations)
          .values({ kind: 'direct', memberA: a, memberB: b, status: connected ? 'active' : 'request', requestedBy: connected ? null : user.id, createdBy: user.id })
          .onConflictDoNothing()
          .returning();
        if (created) {
          await tx.insert(conversationMembers).values([
            { conversationId: created.id, userId: user.id },
            { conversationId: created.id, userId: input.memberId },
          ]);
        }
      });
      [row] = await this.db.select().from(conversations).where(and(eq(conversations.memberA, a), eq(conversations.memberB, b))).limit(1);
    }
    return this.view(user, row!.id);
  }

  /** GET /messages/conversations/{id} */
  async view(user: AuthUser, conversationId: string): Promise<ConversationView> {
    const { conversation } = await this.access(user, conversationId);
    await this.promoteConnectedRequests(user.id, [conversation]);
    const [fresh] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    const [view] = await this.views.conversations(user.id, [fresh!], (chapterId) => this.isChapterTeam(user, chapterId));
    if (!view) throw Errors.notFound('That conversation');
    return view;
  }

  /** PATCH /messages/conversations/{id} — pin, archive, mute, mark unread. */
  async organise(user: AuthUser, conversationId: string, input: UpdateConversationInput): Promise<ConversationView> {
    const { member } = await this.access(user, conversationId);
    if (!member) throw Errors.notFound('That conversation');
    const now = new Date();
    const set: Partial<MemberRow> = {};
    if (input.pinned !== undefined) set.pinnedAt = input.pinned ? now : null;
    if (input.archived !== undefined) set.archivedAt = input.archived ? now : null;
    if (input.mute) {
      set.mutedUntil =
        input.mute === 'off' ? null : input.mute === '8h' ? new Date(now.getTime() + 8 * 3600_000) : input.mute === '1w' ? new Date(now.getTime() + 7 * 86400_000) : MUTE_FOREVER;
    }
    if (input.unread !== undefined) set.markedUnread = input.unread;
    if (Object.keys(set).length) {
      await this.db
        .update(conversationMembers)
        .set(set)
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id)));
    }
    await this.realtime.publish([user.id], { type: 'conversation', conversationId });
    return this.view(user, conversationId);
  }

  /** POST /messages/conversations/{id}/accept — the recipient takes a message request. */
  async accept(user: AuthUser, conversationId: string): Promise<ConversationView> {
    const { conversation } = await this.access(user, conversationId);
    if (conversation.status !== 'request' || conversation.requestedBy === user.id) throw Errors.conflict('There is no message request to accept here');
    await this.db.update(conversations).set({ status: 'active' }).where(eq(conversations.id, conversationId));
    await this.realtime.publish(await this.memberIds(conversationId), { type: 'conversation', conversationId });
    return this.view(user, conversationId);
  }

  /** POST /messages/conversations/{id}/decline — the sender can't write again; the recipient no longer sees it. */
  async decline(user: AuthUser, conversationId: string): Promise<void> {
    const { conversation } = await this.access(user, conversationId);
    if (conversation.status !== 'request' || conversation.requestedBy === user.id) throw Errors.conflict('There is no message request to decline here');
    await this.db.update(conversations).set({ status: 'declined' }).where(eq(conversations.id, conversationId));
    await this.realtime.publish(await this.memberIds(conversationId), { type: 'conversation', conversationId });
  }

  /* ======================= Messages ======================= */

  /** GET /messages/conversations/{id}/messages */
  async page(user: AuthUser, conversationId: string, q: MessagesQuery): Promise<MessagesPage> {
    const { conversation: row, member } = await this.access(user, conversationId);
    const conversation = await this.view(user, conversationId);
    // A member who joined a group later sees it from when they joined; one who left, up to then.
    const window = and(
      eq(messages.conversationId, row.id),
      member && row.kind !== 'direct' ? sql`${messages.createdAt} >= ${member.joinedAt.toISOString()}::timestamptz - interval '1 second'` : undefined,
      member?.leftAt ? lte(messages.createdAt, member.leftAt) : undefined,
    );
    if (q.after) {
      const fresh = await this.db
        .select()
        .from(messages)
        .where(and(window, gt(messages.createdAt, new Date(q.after))))
        .orderBy(messages.createdAt)
        .limit(q.limit);
      return { conversation, items: await this.views.messages(user.id, fresh), olderCursor: null };
    }
    if (q.around) {
      const [target] = await this.db
        .select()
        .from(messages)
        .where(and(window, eq(messages.id, q.around)))
        .limit(1);
      if (target) {
        const half = Math.ceil(q.limit / 2);
        const before = await this.db
          .select()
          .from(messages)
          .where(and(window, sql`(${messages.createdAt}, ${messages.id}) <= (${target.createdAt.toISOString()}::timestamptz, ${target.id}::uuid)`))
          .orderBy(desc(messages.createdAt), desc(messages.id))
          .limit(half + 1);
        const after = await this.db
          .select()
          .from(messages)
          .where(and(window, sql`(${messages.createdAt}, ${messages.id}) > (${target.createdAt.toISOString()}::timestamptz, ${target.id}::uuid)`))
          .orderBy(asc(messages.createdAt), asc(messages.id))
          .limit(half);
        const more = before.length > half;
        const older = (more ? before.slice(0, half) : before).reverse();
        const oldest = older[0];
        return {
          conversation,
          items: await this.views.messages(user.id, [...older, ...after]),
          olderCursor: more && oldest ? encodeCursor({ t: oldest.createdAt.toISOString(), id: oldest.id }) : null,
        };
      }
    }
    const c = decodeCursor<{ t: string; id: string }>(q.before);
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(window, c ? sql`(${messages.createdAt}, ${messages.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(q.limit + 1);
    const more = rows.length > q.limit;
    const items = (more ? rows.slice(0, q.limit) : rows).reverse();
    const oldest = items[0];
    return {
      conversation,
      items: await this.views.messages(user.id, items),
      olderCursor: more && oldest ? encodeCursor({ t: oldest.createdAt.toISOString(), id: oldest.id }) : null,
    };
  }

  /** POST /messages/conversations/{id}/messages */
  async send(user: AuthUser, conversationId: string, raw: SendMessageInput): Promise<MessageView> {
    const input = SendMessageSchema.parse(raw);
    assertNotRestricted(user);
    const { conversation: row } = await this.access(user, conversationId);

    // A retried send (same clientId) returns the first copy.
    if (input.clientId) {
      const [existing] = await this.db
        .select()
        .from(messages)
        .where(and(eq(messages.senderId, user.id), eq(messages.clientId, input.clientId)))
        .limit(1);
      if (existing) {
        if (existing.conversationId !== row.id) throw Errors.conflict('That message was sent elsewhere');
        return (await this.views.messages(user.id, [existing]))[0]!;
      }
    }

    if (row.kind === 'broadcast') await this.syncBroadcast(row);
    const [current] = await this.views.conversations(user.id, [row], (chapterId) => this.isChapterTeam(user, chapterId));
    if (!current) throw Errors.notFound('That conversation');
    if (!current.canSend) throw Errors.forbidden(current.cantSendReason ?? 'You can’t send messages in this conversation');


    // Attachments must be the sender's own clean uploads of the right kind.
    const attachmentIds = [...new Set(input.attachmentIds ?? [])];
    if (attachmentIds.length) await this.assertOwnFiles(user.id, attachmentIds, ['message_image', 'message_file']);
    if (input.voiceNoteId) await this.assertOwnFiles(user.id, [input.voiceNoteId], ['voice_note']);
    if (input.replyToId) {
      const [quoted] = await this.db.select({ c: messages.conversationId }).from(messages).where(eq(messages.id, input.replyToId)).limit(1);
      if (!quoted || quoted.c !== row.id) throw Errors.badRequest('You can only reply to a message in this conversation');
    }
    if (input.share) {
      const card = await this.views.share(input.share.type, input.share.key);
      if (!card.available) throw Errors.notFound('That item');
    }

    const kind = input.voiceNoteId ? 'voice' : input.meeting ? 'meeting' : input.share ? 'share' : 'text';
    const meeting = input.meeting ? meetingFrom(input.meeting) : null;
    const body = input.meeting ? input.meeting.title : (input.body ?? '');
    const link = kind === 'text' || kind === 'share' ? firstHttpsUrl(body) : null;
    const now = new Date();
    const message = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(messages)
        .values({
          conversationId: row.id,
          senderId: user.id,
          kind,
          body,
          clientId: input.clientId ?? null,
          replyToId: input.replyToId ?? null,
          shareType: input.share?.type ?? null,
          shareId: input.share?.key ?? null,
          meeting,
          linkPreview: link ? embedPreview(link) : null,
          createdAt: now,
        })
        .returning();
      const files = input.voiceNoteId ? [input.voiceNoteId] : attachmentIds;
      if (files.length) await tx.insert(messageAttachments).values(files.map((fileId, position) => ({ messageId: created!.id, fileId, position })));
      await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, row.id));
      // Sending counts as having read everything so far.
      await tx
        .update(conversationMembers)
        .set({ readAt: now, markedUnread: false })
        .where(and(eq(conversationMembers.conversationId, row.id), eq(conversationMembers.userId, user.id)));
      // New messages bring archived conversations back to the inbox (unless muted).
      await tx
        .update(conversationMembers)
        .set({ archivedAt: null })
        .where(
          and(
            eq(conversationMembers.conversationId, row.id),
            ne(conversationMembers.userId, user.id),
            isNotNull(conversationMembers.archivedAt),
            sql`(${conversationMembers.mutedUntil} is null or ${conversationMembers.mutedUntil} < now())`,
          ),
        );
      // Replying to a message request accepts it.
      if (row.status === 'request' && row.requestedBy !== user.id) await tx.update(conversations).set({ status: 'active' }).where(eq(conversations.id, row.id));
      return created!;
    });

    const [view] = await this.views.messages(null, [message]);
    await this.deliver(user, row, current.title, message, view!);
    if (link && !parseableEmbed(link)) await this.queue.add('events', 'message-link-preview', { conversationId: row.id, userId: user.id, messageId: message.id });
    return (await this.views.messages(user.id, [message]))[0]!;
  }

  /** PATCH /messages/{id} — the sender corrects a text message within the edit window. */
  async edit(user: AuthUser, messageId: string, input: EditMessageInput): Promise<MessageView> {
    const message = await this.ownMessage(user, messageId);
    if (message.kind !== 'text') throw Errors.conflict('Only text messages can be edited');
    if (!visible(message)) throw Errors.conflict('This message can’t be edited');
    if (Date.now() - message.createdAt.getTime() > MESSAGE_EDIT_WINDOW_MINUTES * 60_000) {
      throw Errors.conflict(`Messages can be edited for ${MESSAGE_EDIT_WINDOW_MINUTES} minutes after sending`);
    }
    const link = firstHttpsUrl(input.body);
    const before = firstHttpsUrl(message.body);
    const [updated] = await this.db
      .update(messages)
      .set({ body: input.body, editedAt: new Date(), ...(link !== before ? { linkPreview: link ? embedPreview(link) : null } : {}) })
      .where(eq(messages.id, message.id))
      .returning();
    if (link && link !== before && !parseableEmbed(link)) {
      await this.queue.add('events', 'message-link-preview', { conversationId: message.conversationId, userId: user.id, messageId: message.id });
    }
    return this.updated(user.id, updated!);
  }

  /** DELETE /messages/{id} — the sender takes a message back; its text and attachments are withdrawn. */
  async remove(user: AuthUser, messageId: string): Promise<MessageView> {
    const message = await this.ownMessage(user, messageId);
    if (message.deletedAt) return (await this.views.messages(user.id, [message]))[0]!;
    const [updated] = await this.db
      .update(messages)
      .set({ body: '', deletedAt: new Date(), linkPreview: null, meeting: null, shareType: null, shareId: null })
      .where(eq(messages.id, message.id))
      .returning();
    return this.updated(user.id, updated!);
  }

  /** PUT /messages/{id}/reaction — one reaction per member; a new one replaces the old. */
  async react(user: AuthUser, messageId: string, input: ReactInput): Promise<MessageView> {
    const message = await this.memberMessage(user, messageId);
    if (!visible(message) || message.kind === 'system') throw Errors.conflict('You can’t react to this message');
    await this.limits.consume(`message-reactions:${user.id}`, 600, 3600);
    await this.db
      .insert(messageReactions)
      .values({ messageId: message.id, userId: user.id, emoji: input.emoji })
      .onConflictDoUpdate({ target: [messageReactions.messageId, messageReactions.userId], set: { emoji: input.emoji, createdAt: new Date() } });
    return this.updated(user.id, message);
  }

  /** DELETE /messages/{id}/reaction */
  async unreact(user: AuthUser, messageId: string): Promise<MessageView> {
    const message = await this.memberMessage(user, messageId);
    await this.db.delete(messageReactions).where(and(eq(messageReactions.messageId, message.id), eq(messageReactions.userId, user.id)));
    return this.updated(user.id, message);
  }

  /** POST /messages/conversations/{id}/read */
  async markRead(user: AuthUser, conversationId: string): Promise<void> {
    const { member } = await this.access(user, conversationId);
    if (!member) return;
    const now = new Date();
    await this.db
      .update(conversationMembers)
      .set({ readAt: now, markedUnread: false })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id)));
    const others = (await this.memberIds(conversationId)).filter((id) => id !== user.id);
    await this.realtime.publish(others, { type: 'read', conversationId, memberId: user.id, readAt: now.toISOString() });
    await this.realtime.publish([user.id], { type: 'conversation', conversationId });
  }

  /** POST /messages/conversations/{id}/typing — "… is typing" for the others, for a few seconds. */
  async typing(user: AuthUser, conversationId: string): Promise<void> {
    const { conversation, member } = await this.access(user, conversationId);
    if (!member || member.leftAt || conversation.kind === 'broadcast') return;
    await this.limits.consume(`typing:${user.id}`, 60, 60);
    const name = (await this.members.ref(user.id))?.name ?? '';
    const others = (await this.memberIds(conversationId)).filter((id) => id !== user.id);
    await this.realtime.publish(others, { type: 'typing', conversationId, memberId: user.id, name });
  }

  /** POST /messages/{id}/translate — into the viewer's language; each translation is kept. */
  async translate(user: AuthUser, messageId: string): Promise<TranslationView> {
    if (!this.translator.enabled()) throw Errors.notFound('Translation');
    const message = await this.memberMessage(user, messageId);
    if (!visible(message) || !message.body.trim()) throw Errors.conflict('There is nothing to translate');
    const lang = ['en', 'fr', 'ar'].includes(user.locale ?? '') ? user.locale! : 'en';
    const [cached] = await this.db
      .select()
      .from(messageTranslations)
      .where(and(eq(messageTranslations.messageId, message.id), eq(messageTranslations.lang, lang)))
      .limit(1);
    if (cached && !message.editedAt) return { text: cached.text, lang };
    await this.limits.consume(`translate:${user.id}`, 120, 3600);
    let text: string;
    try {
      text = await this.translator.translate(message.body, lang);
    } catch (err) {
      this.translator.warn(err);
      throw Errors.unavailable('Translation isn’t available right now. Try again in a moment.');
    }
    await this.db
      .insert(messageTranslations)
      .values({ messageId: message.id, lang, text })
      .onConflictDoUpdate({ target: [messageTranslations.messageId, messageTranslations.lang], set: { text, createdAt: new Date() } });
    return { text, lang };
  }

  /** POST /messages/{id}/meeting — accept or decline (the other member), or cancel (the sender). */
  async respondToMeeting(user: AuthUser, messageId: string, input: MeetingResponseInput): Promise<MessageView> {
    const message = await this.memberMessage(user, messageId);
    if (message.kind !== 'meeting' || !message.meeting || !visible(message)) throw Errors.notFound('That meeting');
    const meeting = message.meeting as MeetingView;
    if (meeting.status === 'cancelled') throw Errors.conflict('This meeting was cancelled');
    if (input.response === 'cancel') {
      if (message.senderId !== user.id) throw Errors.forbidden('Only the person who proposed the meeting can cancel it');
    } else if (message.senderId === user.id) {
      throw Errors.forbidden('The other person accepts or declines the meeting');
    }
    const status = input.response === 'accept' ? 'accepted' : input.response === 'decline' ? 'declined' : 'cancelled';
    const next: MeetingView = { ...meeting, status, respondedBy: user.id, respondedAt: new Date().toISOString() };
    const [updated] = await this.db.update(messages).set({ meeting: next }).where(eq(messages.id, message.id)).returning();
    return this.updated(user.id, updated!);
  }

  /** GET /messages/{id}/meeting.ics */
  async meetingIcs(user: AuthUser, messageId: string): Promise<string> {
    const message = await this.memberMessage(user, messageId);
    if (message.kind !== 'meeting' || !message.meeting || !visible(message)) throw Errors.notFound('That meeting');
    const m = message.meeting as MeetingView;
    const start = new Date(m.startsAt);
    const end = new Date(start.getTime() + m.durationMinutes * 60_000);
    const description = [m.note, m.link ? `Join: ${m.link}` : null, `Arranged on Charter Mission: ${webUrl(`/messages/${message.conversationId}`)}`].filter(Boolean).join('\n\n');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Charter Mission//Messages//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:meeting-${message.id}@chartermission.com`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(m.title)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      ...(m.link ? [`LOCATION:${icsEscape(m.link)}`, `URL:${icsEscape(m.link)}`] : []),
      `STATUS:${m.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  /** GET /messages/search?q= — the viewer's messages containing the words. */
  async search(user: AuthUser, q: string): Promise<MessageSearchHit[]> {
    await this.limits.consume(`message-search:${user.id}`, 60, 60);
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await this.db
      .select({ m: messages })
      .from(messages)
      .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, user.id)))
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(
        and(
          isNull(conversationMembers.leftAt),
          ne(conversations.status, 'declined'),
          isNull(messages.deletedAt),
          eq(messages.moderationState, 'visible'),
          ne(messages.kind, 'system'),
          ilike(messages.body, like),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(40);
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((r) => r.m.conversationId))];
    const convRows = await this.db.select().from(conversations).where(inArray(conversations.id, ids));
    const convViews = new Map(
      (await this.views.conversations(user.id, convRows, (chapterId) => this.isChapterTeam(user, chapterId))).map((c) => [c.id, c]),
    );
    const views = await this.views.messages(
      user.id,
      rows.map((r) => r.m),
    );
    const hits: MessageSearchHit[] = [];
    for (const v of views) {
      const c = convViews.get(v.conversationId);
      if (c) hits.push({ conversation: { id: c.id, kind: c.kind, title: c.title, member: c.member, chapter: c.chapter }, message: v });
    }
    return hits;
  }

  /** GET /messages/recipients?q= — where a card can be sent: recent conversations, then connections. */
  async recipients(user: AuthUser, q?: string): Promise<MessageRecipient[]> {
    const conversationsList = (await this.list(user, { box: 'inbox' })).filter((c) => c.canSend && c.kind !== 'broadcast');
    const term = q?.trim().toLowerCase() ?? '';
    const out: MessageRecipient[] = conversationsList
      .filter((c) => !term || c.title.toLowerCase().includes(term))
      .slice(0, 12)
      .map((c) => ({ type: 'conversation', conversationId: c.id, title: c.title, member: c.member, kind: c.kind }));
    const inDirect = new Set(conversationsList.map((c) => c.member?.id).filter(Boolean));
    const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    const conn = await this.db
      .select({ id: users.id })
      .from(connections)
      .innerJoin(users, sql`${users.id} = case when ${connections.requesterId} = ${user.id} then ${connections.addresseeId} else ${connections.requesterId} end`)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(
        and(
          eq(connections.status, 'accepted'),
          or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id)),
          inArray(users.status, ACTIVE),
          term ? ilike(memberProfiles.displayName, like) : undefined,
        ),
      )
      .orderBy(memberProfiles.displayName)
      .limit(20);
    const refs = await this.members.refs(conn.map((c) => c.id).filter((id) => !inDirect.has(id)));
    for (const ref of refs.values()) out.push({ type: 'member', member: ref });
    return out.slice(0, 24);
  }

  /** POST /messages/share — the same card (and note) to several people at once. */
  async shareTo(user: AuthUser, input: ShareToMessagesInput): Promise<{ sent: number }> {
    const conversationIds = new Set(input.conversationIds ?? []);
    // Check everyone first, so a refusal sends nothing rather than some.
    for (const memberId of input.memberIds ?? []) {
      if (!(await this.connected(user.id, memberId))) throw Errors.forbidden('You can send this to your connections and your existing conversations');
    }
    for (const memberId of input.memberIds ?? []) conversationIds.add((await this.start(user, { memberId })).id);
    if (!conversationIds.size) throw Errors.badRequest('Choose who to send it to');
    let sent = 0;
    for (const id of conversationIds) {
      await this.send(user, id, { body: input.body ?? '', share: input.share });
      sent++;
    }
    return { sent };
  }

  /* ======================= Groups ======================= */

  /** POST /messages/groups — connections, a chapter's members (its team), or an event's attendees (its hosts). */
  async createGroup(user: AuthUser, input: CreateGroupInput): Promise<ConversationView> {
    assertNotRestricted(user);
    let chapterId: string | null = null;
    let eventId: string | null = null;
    const ids = new Set(input.memberIds ?? []);
    ids.delete(user.id);
    if (input.chapterSlug) {
      const chapter = await this.chapterBySlug(input.chapterSlug);
      if (!(await this.isChapterTeam(user, chapter.id))) throw Errors.forbidden('Only the chapter team can start a group for this chapter');
      chapterId = chapter.id;
    }
    if (input.eventSlug) {
      const viewer = await this.eventAccess.viewer(user);
      const event = await this.eventAccess.visible(input.eventSlug, viewer);
      if (!canManageEvent(event, viewer)) throw Errors.forbidden('Only the event’s hosts can start a group for its attendees');
      eventId = event.id;
      const attendees = await this.db
        .select({ userId: eventRegistrations.userId })
        .from(eventRegistrations)
        .where(and(eq(eventRegistrations.eventId, event.id), inArray(eventRegistrations.status, ['registered', 'attended'])));
      for (const a of attendees) if (a.userId !== user.id) ids.add(a.userId);
    }
    const title = input.title.trim();
    // A chapter's or event's group the viewer already runs, under the same name: open it (with any newcomers added) instead of starting another.
    if (chapterId || eventId) {
      const [existing] = await this.db
        .select({ id: conversations.id })
        .from(conversations)
        .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, user.id)))
        .where(
          and(
            eq(conversations.kind, 'group'),
            eventId ? eq(conversations.eventId, eventId) : eq(conversations.chapterId, chapterId!),
            eq(conversations.title, title),
            isNull(conversationMembers.leftAt),
            eq(conversationMembers.role, 'admin'),
          ),
        )
        .limit(1);
      if (existing) {
        const present = await this.db
          .select({ userId: conversationMembers.userId })
          .from(conversationMembers)
          .where(and(eq(conversationMembers.conversationId, existing.id), isNull(conversationMembers.leftAt)));
        const have = new Set(present.map((p) => p.userId));
        const newcomers = await this.eligible(user, [...ids].filter((id) => !have.has(id)), { chapterId, eventId });
        if (newcomers.length && have.size + newcomers.length <= GROUP_MAX_MEMBERS) return this.addMembers(user, existing.id, { memberIds: newcomers });
        return this.view(user, existing.id);
      }
    }
    if (ids.size + 1 > GROUP_MAX_MEMBERS) throw Errors.badRequest(`Groups can have up to ${GROUP_MAX_MEMBERS} members`);
    const eligible = await this.eligible(user, [...ids], { chapterId, eventId });
    if (!eligible.length) throw Errors.badRequest('Add at least one member');
    const now = new Date();
    const conversation = await this.db.transaction(async (tx) => {
      const [created] = await tx.insert(conversations).values({ kind: 'group', title, chapterId, eventId, createdBy: user.id, lastMessageAt: now }).returning();
      await tx.insert(conversationMembers).values([
        { conversationId: created!.id, userId: user.id, role: 'admin', readAt: now },
        ...eligible.map((userId) => ({ conversationId: created!.id, userId })),
      ]);
      return created!;
    });
    const name = (await this.members.ref(user.id))?.name ?? 'A member';
    await this.system(user, conversation, `${name} created the group “${title}”`);
    return this.view(user, conversation.id);
  }

  /** PATCH /messages/groups/{id} — admins rename it. */
  async renameGroup(user: AuthUser, conversationId: string, input: UpdateGroupInput): Promise<ConversationView> {
    const { conversation } = await this.groupAdmin(user, conversationId);
    await this.db.update(conversations).set({ title: input.title }).where(eq(conversations.id, conversationId));
    const name = (await this.members.ref(user.id))?.name ?? 'A member';
    await this.system(user, conversation, `${name} renamed the group “${input.title}”`);
    return this.view(user, conversationId);
  }

  /** POST /messages/groups/{id}/members — admins add people (their connections, or the chapter's members / event's attendees). */
  async addMembers(user: AuthUser, conversationId: string, input: AddGroupMembersInput): Promise<ConversationView> {
    const { conversation } = await this.groupAdmin(user, conversationId);
    const present = await this.db
      .select({ userId: conversationMembers.userId, leftAt: conversationMembers.leftAt })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversationId));
    const current = new Set(present.filter((p) => !p.leftAt).map((p) => p.userId));
    const wanted = input.memberIds.filter((id) => !current.has(id) && id !== user.id);
    if (current.size + wanted.length > GROUP_MAX_MEMBERS) throw Errors.badRequest(`Groups can have up to ${GROUP_MAX_MEMBERS} members`);
    const eligible = await this.eligible(user, wanted, { chapterId: conversation.chapterId, eventId: conversation.eventId });
    if (!eligible.length) throw Errors.badRequest('These members can’t be added');
    const now = new Date();
    for (const userId of eligible) {
      await this.db
        .insert(conversationMembers)
        .values({ conversationId, userId, joinedAt: now })
        .onConflictDoUpdate({
          target: [conversationMembers.conversationId, conversationMembers.userId],
          set: { leftAt: null, joinedAt: now, role: 'member', readAt: null, archivedAt: null },
        });
    }
    const refs = await this.members.refs(eligible);
    const name = (await this.members.ref(user.id))?.name ?? 'A member';
    const added = [...refs.values()].map((r) => r.name);
    await this.system(user, conversation, `${name} added ${added.length > 3 ? `${added.slice(0, 3).join(', ')} and ${added.length - 3} more` : added.join(', ')}`);
    return this.view(user, conversationId);
  }

  /** DELETE /messages/groups/{id}/members/{memberId} — an admin removes someone, or a member leaves (memberId = their own). */
  async removeMember(user: AuthUser, conversationId: string, memberId: string): Promise<void> {
    const { conversation, member } = await this.access(user, conversationId);
    if (conversation.kind === 'direct') throw Errors.conflict('You can’t leave a private conversation; archive or block instead');
    const self = memberId === user.id;
    if (conversation.kind === 'broadcast') {
      if (!self) throw Errors.forbidden('Members turn announcements off themselves');
      await this.db
        .update(conversationMembers)
        .set({ leftAt: new Date() })
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id)));
      return;
    }
    if (!self && member?.role !== 'admin') throw Errors.forbidden('Only the group’s admins can remove people');
    const [target] = await this.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, memberId)))
      .limit(1);
    if (!target || target.leftAt) throw Errors.notFound('That member');
    await this.db
      .update(conversationMembers)
      .set({ leftAt: new Date(), role: 'member' })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, memberId)));
    // A group always keeps an admin: the longest-standing member takes over.
    const [admin] = await this.db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.role, 'admin'), isNull(conversationMembers.leftAt)))
      .limit(1);
    if (!admin) {
      const [next] = await this.db
        .select({ userId: conversationMembers.userId })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)))
        .orderBy(asc(conversationMembers.joinedAt))
        .limit(1);
      if (next) {
        await this.db
          .update(conversationMembers)
          .set({ role: 'admin' })
          .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, next.userId)));
      }
    }
    const [actor, removed] = [(await this.members.ref(user.id))?.name ?? 'A member', (await this.members.ref(memberId))?.name ?? 'a member'];
    await this.system(user, conversation, self ? `${actor} left` : `${actor} removed ${removed}`, [memberId]);
  }

  /** PUT /messages/groups/{id}/members/{memberId}/role */
  async setRole(user: AuthUser, conversationId: string, memberId: string, role: 'admin' | 'member'): Promise<ConversationView> {
    await this.groupAdmin(user, conversationId);
    const [target] = await this.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, memberId)))
      .limit(1);
    if (!target || target.leftAt) throw Errors.notFound('That member');
    if (role === 'member') {
      const admins = await this.db
        .select({ userId: conversationMembers.userId })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.role, 'admin'), isNull(conversationMembers.leftAt)));
      if (admins.length <= 1 && admins[0]?.userId === memberId) throw Errors.conflict('A group needs at least one admin');
    }
    await this.db
      .update(conversationMembers)
      .set({ role })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, memberId)));
    await this.realtime.publish(await this.memberIds(conversationId), { type: 'conversation', conversationId });
    return this.view(user, conversationId);
  }

  /* ======================= Chapter announcements ======================= */

  /** GET /messages/announcements/{chapterSlug} — the chapter's channel (the team creates it on first open; members join it). */
  async announcements(user: AuthUser, chapterSlug: string): Promise<ConversationView> {
    const chapter = await this.chapterBySlug(chapterSlug);
    const team = await this.isChapterTeam(user, chapter.id);
    let [row] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.kind, 'broadcast'), eq(conversations.chapterId, chapter.id)))
      .limit(1);
    const following = await this.followsChapter(user.id, chapter.id);
    if (!row) {
      // Made on first visit by anyone in the chapter, so members can see (and turn off) announcements before the first one.
      if (!team && !following) throw Errors.forbidden(`Join ${chapter.name} to get its announcements`);
      await this.db.insert(conversations).values({ kind: 'broadcast', chapterId: chapter.id, createdBy: team ? user.id : null }).onConflictDoNothing();
      [row] = await this.db
        .select()
        .from(conversations)
        .where(and(eq(conversations.kind, 'broadcast'), eq(conversations.chapterId, chapter.id)))
        .limit(1);
    }
    if (team || following) {
      await this.db
        .insert(conversationMembers)
        .values({ conversationId: row!.id, userId: user.id, role: team ? 'admin' : 'member', readAt: new Date() })
        .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { role: team ? 'admin' : 'member' } });
    } else {
      throw Errors.forbidden(`Join ${chapter.name} to get its announcements`);
    }
    return this.view(user, row!.id);
  }

  /** PUT /messages/announcements/{chapterSlug}/subscription — turn a chapter's announcements on or off. */
  async setAnnouncements(user: AuthUser, chapterSlug: string, on: boolean): Promise<ConversationView> {
    const view = await this.announcements(user, chapterSlug);
    await this.db
      .update(conversationMembers)
      .set({ leftAt: on ? null : new Date() })
      .where(and(eq(conversationMembers.conversationId, view.id), eq(conversationMembers.userId, user.id)));
    return this.view(user, view.id);
  }

  /** Before the team posts: everyone who follows the chapter is in, unless they turned it off; those who left the chapter are out. */
  private async syncBroadcast(row: ConversationRow) {
    if (!row.chapterId) return;
    await this.db.execute(sql`
      insert into ${conversationMembers} (conversation_id, user_id, role)
      select ${row.id}, f.follower_id, 'member'
      from ${follows} f join ${users} u on u.id = f.follower_id
      where f.target_type = 'chapter' and f.target_id = ${row.chapterId} and u.status in ('active','unverified')
      on conflict do nothing`);
    await this.db.execute(sql`
      update ${conversationMembers} cm set left_at = now()
      where cm.conversation_id = ${row.id} and cm.left_at is null and cm.role = 'member'
        and not exists (select 1 from ${follows} f where f.target_type = 'chapter' and f.target_id = ${row.chapterId} and f.follower_id = cm.user_id)`);
  }

  /* ======================= Delivery ======================= */

  /** Live event to everyone in it; for the others (not muted): a notification, a push when away, and a delayed email if it stays unread. */
  private async deliver(sender: AuthUser, row: ConversationRow, title: string, message: MessageRow, view: MessageView) {
    const people = await this.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, row.id), isNull(conversationMembers.leftAt)));
    await this.realtime.publish(
      people.map((p) => p.userId),
      { type: 'message', conversationId: row.id, message: view } satisfies MessageStreamEvent,
    );
    if (message.kind === 'system') return;
    const senderName = (await this.members.ref(sender.id))?.name ?? 'A member';
    const now = Date.now();
    const text = summary(message, view.attachments.length) || 'New message';
    const recipients = people.filter((p) => p.userId !== sender.id && !(p.mutedUntil && p.mutedUntil.getTime() > now));
    const isRequest = row.status === 'request' && row.requestedBy === sender.id;
    for (const p of recipients) {
      const segments =
        row.kind === 'broadcast'
          ? [{ text: ` posted in ${title}`, strong: false }]
          : row.kind === 'group'
            ? [{ text: ` sent a message in ${title}`, strong: false }]
            : isRequest
              ? [{ text: ' sent you a message request', strong: false }]
              : [{ text: ' sent you a message', strong: false }];
      await this.notify
        .notify({
          userId: p.userId,
          type: 'message_received',
          actorId: sender.id,
          objectType: 'conversation',
          objectId: row.id,
          segments,
          href: `/messages/${row.id}`,
          icon: 'avatar',
          dedupeKey: `message:${row.id}:${p.userId}:${new Date().toISOString().slice(0, 10)}`,
        })
        .catch(() => undefined);
      if (!(await this.realtime.isOnline(p.userId))) {
        await this.push
          .send(p.userId, {
            title: row.kind === 'direct' ? (isRequest ? `${senderName} · message request` : senderName) : `${senderName} · ${title}`,
            body: text,
            href: `/messages/${row.id}`,
            tag: `conversation-${row.id}`,
          })
          .catch(() => undefined);
      }
      // Announcements stay in the app; direct and group messages get an email if still unread later.
      if (row.kind !== 'broadcast') {
        const bucket = Math.floor(now / UNREAD_EMAIL_DELAY_MS);
        await this.queue
          .add('events', 'message-unread-email', { conversationId: row.id, userId: p.userId }, { delayMs: UNREAD_EMAIL_DELAY_MS, jobId: `msg-unread-${row.id}-${p.userId}-${bucket}` })
          .catch(() => undefined);
      }
    }
  }

  /** The delayed email: only if the member still hasn't read, isn't muted, and wants message emails. */
  private async unreadEmail(conversationId: string, userId: string) {
    const [m] = await this.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
      .limit(1);
    if (!m || m.leftAt || (m.mutedUntil && m.mutedUntil.getTime() > Date.now())) return;
    const [row] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    const [recipient] = await this.db.select({ email: users.email, status: users.status }).from(users).where(eq(users.id, userId)).limit(1);
    if (!row || !recipient || !ACTIVE.includes(recipient.status) || row.status === 'declined') return;
    if (!(await this.notify.enabled(userId, 'connections', 'email'))) return;
    const unread = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          ne(messages.senderId, userId),
          isNull(messages.deletedAt),
          eq(messages.moderationState, 'visible'),
          ne(messages.kind, 'system'),
          m.readAt ? gt(messages.createdAt, m.readAt) : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(3);
    if (!unread.length) return;
    const senders = await this.members.refs(unread.map((u) => u.senderId));
    const first = senders.get(unread[0]!.senderId)?.name ?? 'A member';
    const groupTitle = row.kind === 'group' ? (row.title ?? 'a group') : null;
    await this.mail.compose({
      to: recipient.email,
      userId,
      template: 'notification.message_unread',
      subject: groupTitle ? `New messages in ${groupTitle}` : `${first} sent you a message`,
      heading: groupTitle ? `Unread messages in ${groupTitle}` : `You have an unread message from ${first}`,
      paragraphs: unread
        .reverse()
        .map((u) => `${groupTitle ? `${senders.get(u.senderId)?.name ?? ''}: ` : ''}“${summary(u)}”`),
      button: { label: 'Reply', url: webUrl(`/messages/${conversationId}`) },
      footer: 'You can change which emails you get in Settings → Notifications.',
      unsubscribeUrl: webUrl('/settings/notifications'),
    });
  }

  private async refreshLinkPreview(messageId: string) {
    const [m] = await this.db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!m || !visible(m)) return;
    const link = firstHttpsUrl(m.body);
    if (!link) return;
    const fetched = await this.linkPreviews.safePreview(link).catch(() => null);
    if (!fetched) return;
    const [updated] = await this.db.update(messages).set({ linkPreview: fetched }).where(eq(messages.id, messageId)).returning();
    const [view] = await this.views.messages(null, [updated!]);
    await this.realtime.publish(await this.memberIds(m.conversationId), { type: 'message_updated', conversationId: m.conversationId, message: view! });
  }

  /** "Amara added Kwame" lines in groups. */
  private async system(user: AuthUser, row: ConversationRow, body: string, alsoNotify: string[] = []) {
    const now = new Date();
    const [created] = await this.db.insert(messages).values({ conversationId: row.id, senderId: user.id, kind: 'system', body, createdAt: now }).returning();
    await this.db.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, row.id));
    const [view] = await this.views.messages(null, [created!]);
    await this.realtime.publish([...(await this.memberIds(row.id)), ...alsoNotify], { type: 'message', conversationId: row.id, message: view! });
  }

  private async updated(viewerId: string, row: MessageRow): Promise<MessageView> {
    const [fresh] = await this.db.select().from(messages).where(eq(messages.id, row.id)).limit(1);
    const [live] = await this.views.messages(null, [fresh!]);
    await this.realtime.publish(await this.memberIds(row.conversationId), { type: 'message_updated', conversationId: row.conversationId, message: live! });
    return (await this.views.messages(viewerId, [fresh!]))[0]!;
  }

  /* ======================= Access ======================= */

  /** The conversation and the viewer's membership, or NOT_FOUND. Broadcasts are readable by the chapter's members and team. */
  private async access(user: AuthUser, conversationId: string): Promise<{ conversation: ConversationRow; member: MemberRow | null }> {
    const [conversation] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!conversation) throw Errors.notFound('That conversation');
    const [member] = await this.db
      .select()
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id)))
      .limit(1);
    if (!member) throw Errors.notFound('That conversation');
    // Declined requests disappear for the member who declined them.
    if (conversation.status === 'declined' && conversation.requestedBy !== user.id) throw Errors.notFound('That conversation');
    return { conversation, member };
  }

  private async groupAdmin(user: AuthUser, conversationId: string) {
    const found = await this.access(user, conversationId);
    if (found.conversation.kind !== 'group') throw Errors.notFound('That group');
    if (found.member?.role !== 'admin' || found.member.leftAt) throw Errors.forbidden('Only the group’s admins can do that');
    return found;
  }

  private async ownMessage(user: AuthUser, messageId: string): Promise<MessageRow> {
    const [message] = await this.db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!message || message.senderId !== user.id || message.kind === 'system') throw Errors.notFound('That message');
    return message;
  }

  private async memberMessage(user: AuthUser, messageId: string): Promise<MessageRow> {
    const [message] = await this.db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!message) throw Errors.notFound('That message');
    await this.access(user, message.conversationId);
    return message;
  }

  private async memberIds(conversationId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));
    return rows.map((r) => r.userId);
  }

  /** Requests between members who have since connected become ordinary chats. */
  private async promoteConnectedRequests(viewerId: string, rows: ConversationRow[]) {
    for (const r of rows) {
      if (r.kind !== 'direct' || r.status !== 'request') continue;
      const other = r.memberA === viewerId ? r.memberB : r.memberA;
      if (other && (await this.connected(viewerId, other))) {
        await this.db.update(conversations).set({ status: 'active' }).where(eq(conversations.id, r.id));
        r.status = 'active';
      }
    }
  }

  private async assertOwnFiles(userId: string, ids: string[], purposes: string[]) {
    const rows = await this.db.select().from(files).where(inArray(files.id, ids));
    if (rows.length !== ids.length) throw Errors.notFound('That file');
    for (const f of rows) {
      if (f.ownerId !== userId || !purposes.includes(f.purpose)) throw Errors.badRequest('That file can’t be sent in a message');
      if (f.scanStatus !== 'clean') throw Errors.conflict('Wait for the file to finish uploading');
    }
  }

  /**
   * Who may be added: connections of the person adding them, plus the chapter's members (chapter
   * groups) or the event's attendees (event groups). Blocked and inactive members never are.
   */
  private async eligible(user: AuthUser, ids: string[], scope: { chapterId: string | null; eventId: string | null }): Promise<string[]> {
    if (!ids.length) return [];
    const [connected, active, blocked] = await Promise.all([
      this.views.connectedSet(user.id, ids),
      this.db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, ids), inArray(users.status, ACTIVE), eq(users.isOfficial, false))),
      this.relations.blockedSet(user.id),
    ]);
    let inScope = new Set<string>();
    if (scope.chapterId) {
      const rows = await this.db
        .select({ id: follows.followerId })
        .from(follows)
        .where(and(eq(follows.targetType, 'chapter'), eq(follows.targetId, scope.chapterId), inArray(follows.followerId, ids)));
      inScope = new Set(rows.map((r) => r.id));
    } else if (scope.eventId) {
      const rows = await this.db
        .select({ id: eventRegistrations.userId })
        .from(eventRegistrations)
        .where(and(eq(eventRegistrations.eventId, scope.eventId), inArray(eventRegistrations.status, ['registered', 'attended']), inArray(eventRegistrations.userId, ids)));
      inScope = new Set(rows.map((r) => r.id));
    }
    const activeSet = new Set(active.map((a) => a.id));
    return ids.filter((id) => activeSet.has(id) && !blocked.has(id) && (connected.has(id) || inScope.has(id)));
  }

  private async connected(a: string, b: string): Promise<boolean> {
    return (await this.views.connectedSet(a, [b])).has(b);
  }

  private async chapterBySlug(slug: string) {
    const [chapter] = await this.db
      .select({ id: chapters.id, name: chapters.name })
      .from(chapters)
      .where(and(eq(chapters.slug, slug.toLowerCase()), eq(chapters.status, 'active')))
      .limit(1);
    if (!chapter) throw Errors.notFound('That chapter');
    return chapter;
  }

  private async isChapterTeam(user: AuthUser, chapterId: string): Promise<boolean> {
    if (user.permissions.has('chapter.manage')) return true;
    return (await this.eventAccess.ledChapters(user.id)).has(chapterId);
  }

  private async followsChapter(userId: string, chapterId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: follows.followerId })
      .from(follows)
      .where(and(eq(follows.targetType, 'chapter'), eq(follows.targetId, chapterId), eq(follows.followerId, userId)))
      .limit(1);
    return !!row;
  }
}

/** A video link already has its player; other links are fetched for a title and picture. */
function parseableEmbed(url: string): boolean {
  return !!embedPreview(url);
}

function meetingFrom(input: MeetingInput): MeetingView {
  return {
    title: input.title,
    startsAt: new Date(input.startsAt).toISOString(),
    durationMinutes: input.durationMinutes,
    link: input.link || `https://meet.jit.si/CharterMission-${randomBytes(6).toString('hex')}`,
    note: input.note || null,
    status: 'proposed',
    respondedBy: null,
    respondedAt: null,
  };
}

