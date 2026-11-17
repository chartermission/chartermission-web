import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  AdminInboxItem,
  AdminInboxMessage,
  AdminInboxPage,
  AdminInboxQuery,
  AdminInboxReplyInput,
  AdminInboxStartInput,
  AdminInboxThread,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { announcements, conversationMembers, conversations, files, memberProfiles, messageAttachments, messages, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { AuditService } from '../infra/audit.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { MessagesService } from '../messages/messages.service.js';
import { summary, visible, type ConversationRow, type MessageRow } from '../messages/message-views.js';
import { MessagingSettingsService } from './messaging-settings.service.js';

const THREAD_PAGE = 50;

/**
 * The Charter Mission inbox (admin console, members.message): every member's official conversation. The team answers
 * as the sender account; the sender account's read state is the team's ("read" for one is read for all).
 */
@Injectable()
export class InboxService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly messages: MessagesService,
    private readonly settings: MessagingSettingsService,
    private readonly audit: AuditService,
  ) {}

  /** GET /admin/inbox — latest activity first. Unread: the member wrote last, after the team last read it. */
  async list(q: AdminInboxQuery): Promise<AdminInboxPage> {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const like = q.q ? `%${q.q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const rows = await this.db.execute<{ id: string; member_id: string; email: string; ts: string; unread: boolean }>(sql`
      select c.id, mm.user_id as member_id, u.email,
        to_char(c.last_message_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ts,
        ${UNREAD} as unread
      from ${conversations} c
      join ${conversationMembers} tm on tm.conversation_id = c.id and tm.user_id = c.created_by
      join ${conversationMembers} mm on mm.conversation_id = c.id and mm.user_id <> c.created_by
      join ${users} u on u.id = mm.user_id
      join ${memberProfiles} p on p.user_id = u.id
      left join lateral (
        select m.sender_id, m.created_at from ${messages} m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1
      ) lm on true
      where c.kind = 'official' and c.last_message_at is not null
        ${like ? sql`and (p.display_name ilike ${like} or p.handle ilike ${like} or u.email ilike ${like})` : sql``}
        ${q.filter === 'unread' ? sql`and ${UNREAD}` : sql``}
        ${c ? sql`and (c.last_message_at, c.id) < (${c.t}::timestamptz, ${c.id}::uuid)` : sql``}
      order by c.last_message_at desc, c.id desc
      limit ${q.limit + 1}`);
    const more = rows.rows.length > q.limit;
    const page = more ? rows.rows.slice(0, q.limit) : rows.rows;
    const ids = page.map((r) => r.id);
    const [refs, last] = await Promise.all([
      this.members.refs(page.map((r) => r.member_id)),
      ids.length
        ? this.db.selectDistinctOn([messages.conversationId]).from(messages).where(inArray(messages.conversationId, ids)).orderBy(messages.conversationId, desc(messages.createdAt), desc(messages.id))
        : Promise.resolve([] as MessageRow[]),
    ]);
    const attachments = await this.attachmentCounts(last.map((m) => m.id));
    const lastBy = new Map(last.map((m) => [m.conversationId, m]));
    const items: AdminInboxItem[] = [];
    for (const r of page) {
      const member = refs.get(r.member_id);
      if (!member) continue;
      const m = lastBy.get(r.id);
      items.push({
        conversationId: r.id,
        member: { ...member, email: r.email },
        lastMessage: m ? { body: summary(m, attachments.get(m.id) ?? 0), at: m.createdAt.toISOString(), fromMember: m.senderId === r.member_id } : null,
        unread: r.unread,
      });
    }
    const lastRow = page[page.length - 1];
    return { items, nextCursor: more && lastRow ? encodeCursor({ t: lastRow.ts, id: lastRow.id }) : null, unreadCount: await this.unreadCount() };
  }

  /** Conversations waiting for the team (the console sidebar's badge). */
  async unreadCount(): Promise<number> {
    const result = await this.db.execute<{ n: number }>(sql`
      select count(*)::int as n
      from ${conversations} c
      join ${conversationMembers} tm on tm.conversation_id = c.id and tm.user_id = c.created_by
      join ${conversationMembers} mm on mm.conversation_id = c.id and mm.user_id <> c.created_by
      join lateral (
        select m.sender_id, m.created_at from ${messages} m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1
      ) lm on true
      where c.kind = 'official' and ${UNREAD}`);
    return result.rows[0]?.n ?? 0;
  }

  /** GET /admin/inbox/{id} — a page of the thread, oldest first; opening it marks it read for the team. */
  async thread(conversationId: string, cursor?: string): Promise<AdminInboxThread> {
    const { row, memberId } = await this.official(conversationId);
    const c = decodeCursor<{ t: string; id: string }>(cursor);
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, row.id),
          sql`${messages.kind} <> 'system'`,
          c ? sql`(${messages.createdAt}, ${messages.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(THREAD_PAGE + 1);
    const more = rows.length > THREAD_PAGE;
    const items = (more ? rows.slice(0, THREAD_PAGE) : rows).reverse();
    if (!c) {
      await this.db
        .update(conversationMembers)
        .set({ readAt: new Date(), markedUnread: false })
        .where(and(eq(conversationMembers.conversationId, row.id), eq(conversationMembers.userId, row.createdBy!)));
    }
    const [refs, email] = await Promise.all([this.members.refs([memberId]), this.memberEmail(memberId)]);
    const member = refs.get(memberId);
    if (!member) throw Errors.notFound('That conversation');
    const oldest = items[0];
    return {
      conversationId: row.id,
      member: { ...member, email },
      messages: await this.messageViews(items, memberId),
      olderCursor: more && oldest ? encodeCursor({ t: oldest.createdAt.toISOString(), id: oldest.id }) : null,
    };
  }

  /** POST /admin/inbox/{id}/messages — a reply as Charter Mission. */
  async reply(ctx: AuthContext, conversationId: string, input: AdminInboxReplyInput, ip?: string): Promise<AdminInboxMessage> {
    await this.settings.requireSender();
    const { row, memberId } = await this.official(conversationId);
    await this.assertReachable(memberId);
    const message = await this.messages.sendOfficial(row, { body: input.body, staffId: ctx.user.id });
    await this.audit.record({ actorId: ctx.user.id, action: 'inbox.replied', targetType: 'conversation', targetId: row.id, after: { memberId, messageId: message.id }, ip });
    return (await this.messageViews([message], memberId))[0]!;
  }

  /** POST /admin/inbox/start — write to one member (their official conversation is opened if it doesn't exist yet). */
  async start(ctx: AuthContext, input: AdminInboxStartInput, ip?: string): Promise<AdminInboxThread> {
    const senderId = await this.settings.requireSender();
    const [member] = await this.db.select({ id: users.id, isOfficial: users.isOfficial }).from(users).where(eq(users.id, input.memberId)).limit(1);
    if (!member) throw Errors.notFound('That member');
    if (member.isOfficial) throw Errors.badRequest('Official accounts can’t be messaged from the Charter Mission inbox');
    await this.assertReachable(member.id);
    const row = await this.messages.officialConversation(senderId, member.id);
    const message = await this.messages.sendOfficial(row, { body: input.body, staffId: ctx.user.id });
    await this.audit.record({ actorId: ctx.user.id, action: 'inbox.started', targetType: 'conversation', targetId: row.id, after: { memberId: member.id, messageId: message.id }, ip });
    return this.thread(row.id);
  }

  private async official(conversationId: string): Promise<{ row: ConversationRow; memberId: string }> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.kind, 'official')))
      .limit(1);
    if (!row?.createdBy) throw Errors.notFound('That conversation');
    const memberId = row.memberA === row.createdBy ? row.memberB : row.memberA;
    if (!memberId) throw Errors.notFound('That conversation');
    return { row, memberId };
  }

  private async assertReachable(memberId: string) {
    const [u] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, memberId)).limit(1);
    if (!u || !['active', 'unverified', 'suspended'].includes(u.status)) throw Errors.conflict('This member’s account is closed, so they can’t get messages');
  }

  private async memberEmail(memberId: string): Promise<string> {
    const [u] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, memberId)).limit(1);
    return u?.email ?? '';
  }

  private async messageViews(rows: MessageRow[], memberId: string): Promise<AdminInboxMessage[]> {
    if (!rows.length) return [];
    const ids = rows.map((m) => m.id);
    const announcementIds = [...new Set(rows.map((m) => m.announcementId).filter((x): x is string => !!x))];
    const [attachmentRows, subjects, staff] = await Promise.all([
      this.db
        .select({ messageId: messageAttachments.messageId, file: files })
        .from(messageAttachments)
        .innerJoin(files, eq(files.id, messageAttachments.fileId))
        .where(inArray(messageAttachments.messageId, ids))
        .orderBy(messageAttachments.position),
      announcementIds.length
        ? this.db.select({ id: announcements.id, subject: announcements.subject }).from(announcements).where(inArray(announcements.id, announcementIds))
        : Promise.resolve([]),
      this.members.refs(rows.map((m) => m.sentByStaffId).filter((x): x is string => !!x)),
    ]);
    const subjectBy = new Map(subjects.map((a) => [a.id, a.subject]));
    const attachmentsBy = new Map<string, AdminInboxMessage['attachments']>();
    for (const a of attachmentRows) {
      if (a.file.scanStatus !== 'clean') continue;
      const kind = a.file.purpose === 'voice_note' ? 'voice' : a.file.mime.startsWith('image/') ? 'image' : 'document';
      const list = attachmentsBy.get(a.messageId) ?? [];
      list.push({ url: mediaUrl(a.file.id)!, name: a.file.originalName ?? (kind === 'voice' ? 'Voice message' : 'File'), kind });
      attachmentsBy.set(a.messageId, list);
    }
    return rows.map((m) => {
      const shown = visible(m);
      const fromMember = m.senderId === memberId;
      const author = m.sentByStaffId ? staff.get(m.sentByStaffId) : undefined;
      return {
        id: m.id,
        body: shown ? (m.kind === 'text' ? m.body : summary(m, attachmentsBy.get(m.id)?.length ?? 0)) : '',
        at: m.createdAt.toISOString(),
        from: fromMember ? 'member' : 'team',
        staff: !fromMember && author ? { id: author.id, name: author.name } : null,
        announcement: m.announcementId ? { id: m.announcementId, subject: subjectBy.get(m.announcementId) ?? '' } : null,
        attachments: shown ? (attachmentsBy.get(m.id) ?? []) : [],
        deleted: !!m.deletedAt || m.moderationState !== 'visible',
      };
    });
  }

  private async attachmentCounts(messageIds: string[]): Promise<Map<string, number>> {
    if (!messageIds.length) return new Map();
    const rows = await this.db
      .select({ messageId: messageAttachments.messageId, n: sql<number>`count(*)::int` })
      .from(messageAttachments)
      .where(inArray(messageAttachments.messageId, messageIds))
      .groupBy(messageAttachments.messageId);
    return new Map(rows.map((r) => [r.messageId, r.n]));
  }
}

/** Over aliases c / tm (team's membership) / mm (member's) / lm (latest message). */
const UNREAD = sql`(lm.sender_id = mm.user_id and lm.created_at > coalesce(tm.read_at, 'epoch'::timestamptz))`;
