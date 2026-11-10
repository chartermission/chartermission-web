import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { ConversationView, MessagesPage, MessagesQuery, MessageView, SendMessageInput, StartConversationInput } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { connections, conversations, messages, users } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';
import { RelationsService } from '../core/relations.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { assertNotRestricted } from '../posts/posts.service.js';

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

const MESSAGES_PER_HOUR = 300;
const NEW_CONVERSATIONS_PER_DAY = 40;
const ACTIVE = ['active', 'unverified'];
const preview = (text: string) => (text.length > 140 ? `${text.slice(0, 139)}…` : text);

/**
 * Private messages between two members. Starting a conversation needs an accepted connection;
 * writing in one that exists needs only that neither has blocked the other and both accounts are
 * active. Nobody but the two members can read a conversation.
 */
@Injectable()
export class MessagesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly limits: RateLimitService,
    private readonly notify: NotifyService,
  ) {}

  /** GET /messages/conversations — the viewer's conversations that have messages, latest first. */
  async list(user: AuthUser): Promise<ConversationView[]> {
    const rows = await this.db
      .select()
      .from(conversations)
      .where(and(or(eq(conversations.memberA, user.id), eq(conversations.memberB, user.id)), sql`${conversations.lastMessageAt} is not null`))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(200);
    return this.views(user.id, rows);
  }

  /** GET /messages/unread — how many conversations hold something the viewer hasn't read. */
  async unread(user: AuthUser): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(conversations)
      .where(
        sql`((${conversations.memberA} = ${user.id} and exists (select 1 from ${messages} m where m.conversation_id = ${conversations.id} and m.sender_id <> ${user.id} and m.deleted_at is null and (${conversations.aReadAt} is null or m.created_at > ${conversations.aReadAt})))
          or (${conversations.memberB} = ${user.id} and exists (select 1 from ${messages} m where m.conversation_id = ${conversations.id} and m.sender_id <> ${user.id} and m.deleted_at is null and (${conversations.bReadAt} is null or m.created_at > ${conversations.bReadAt}))))`,
      );
    return row?.n ?? 0;
  }

  /** POST /messages/conversations — the conversation with a connection, created on first use. */
  async start(user: AuthUser, input: StartConversationInput): Promise<ConversationView> {
    assertNotRestricted(user);
    if (input.memberId === user.id) throw Errors.badRequest('You can’t message yourself');
    const [a, b] = input.memberId < user.id ? [input.memberId, user.id] : [user.id, input.memberId];
    let [row] = await this.db.select().from(conversations).where(and(eq(conversations.memberA, a), eq(conversations.memberB, b))).limit(1);
    if (!row) {
      const [other] = await this.db.select({ id: users.id, status: users.status, isOfficial: users.isOfficial }).from(users).where(eq(users.id, input.memberId)).limit(1);
      if (!other || !ACTIVE.includes(other.status) || (await this.relations.isBlockedEitherWay(user.id, input.memberId))) throw Errors.notFound('That member');
      if (other.isOfficial || user.isOfficial) throw Errors.forbidden('Official Charter Mission accounts don’t take private messages');
      if (!(await this.connected(user.id, input.memberId))) throw Errors.forbidden('You can message members you’re connected with. Send a connection request first.');
      await this.limits.consume(`conversations:${user.id}`, NEW_CONVERSATIONS_PER_DAY, 24 * 3600);
      await this.db.insert(conversations).values({ memberA: a, memberB: b }).onConflictDoNothing();
      [row] = await this.db.select().from(conversations).where(and(eq(conversations.memberA, a), eq(conversations.memberB, b))).limit(1);
    }
    const [view] = await this.views(user.id, [row!]);
    if (!view) throw Errors.notFound('That member');
    return view;
  }

  /** GET /messages/conversations/{id}/messages */
  async page(user: AuthUser, conversationId: string, q: MessagesQuery): Promise<MessagesPage> {
    const row = await this.mine(user.id, conversationId);
    const [conversation] = await this.views(user.id, [row]);
    if (!conversation) throw Errors.notFound('That conversation');
    if (q.after) {
      const fresh = await this.db
        .select()
        .from(messages)
        .where(and(eq(messages.conversationId, row.id), gt(messages.createdAt, new Date(q.after))))
        .orderBy(messages.createdAt)
        .limit(q.limit);
      return { conversation, items: fresh.map(toView), olderCursor: null };
    }
    const c = decodeCursor<{ t: string; id: string }>(q.before);
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, row.id), c ? sql`(${messages.createdAt}, ${messages.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(q.limit + 1);
    const more = rows.length > q.limit;
    const items = (more ? rows.slice(0, q.limit) : rows).reverse();
    const oldest = items[0];
    return { conversation, items: items.map(toView), olderCursor: more && oldest ? encodeCursor({ t: oldest.createdAt.toISOString(), id: oldest.id }) : null };
  }

  /** POST /messages/conversations/{id}/messages */
  async send(user: AuthUser, conversationId: string, input: SendMessageInput): Promise<MessageView> {
    assertNotRestricted(user);
    const row = await this.mine(user.id, conversationId);
    const otherId = row.memberA === user.id ? row.memberB : row.memberA;
    if (!(await this.canSend(user.id, otherId))) throw Errors.forbidden('You can’t send messages in this conversation');
    await this.limits.consume(`messages:${user.id}`, MESSAGES_PER_HOUR, 3600);
    const now = new Date();
    const message = await this.db.transaction(async (tx) => {
      const [created] = await tx.insert(messages).values({ conversationId: row.id, senderId: user.id, body: input.body, createdAt: now }).returning();
      // Sending counts as having read everything so far.
      await tx
        .update(conversations)
        .set(row.memberA === user.id ? { lastMessageAt: now, aReadAt: now } : { lastMessageAt: now, bReadAt: now })
        .where(eq(conversations.id, row.id));
      return created!;
    });
    // One notification (and email) per conversation per day at most; the Messages badge carries the rest.
    const sender = (await this.members.ref(user.id))?.name ?? 'A member';
    await this.notify
      .notify({
        userId: otherId,
        type: 'message_received',
        actorId: user.id,
        objectType: 'conversation',
        objectId: row.id,
        segments: [{ text: ' sent you a message', strong: false }],
        href: `/messages/${row.id}`,
        icon: 'avatar',
        dedupeKey: `message:${row.id}:${otherId}:${now.toISOString().slice(0, 10)}`,
        email: {
          subject: `${sender} sent you a message`,
          heading: `New message from ${sender}`,
          paragraphs: [`“${preview(input.body)}”`],
          buttonLabel: 'Reply',
        },
      })
      .catch(() => undefined);
    return toView(message);
  }

  /** POST /messages/conversations/{id}/read */
  async markRead(user: AuthUser, conversationId: string): Promise<void> {
    const row = await this.mine(user.id, conversationId);
    await this.db
      .update(conversations)
      .set(row.memberA === user.id ? { aReadAt: new Date() } : { bReadAt: new Date() })
      .where(eq(conversations.id, row.id));
  }

  /** DELETE /messages/{messageId} — the sender takes a message back; its text is erased. */
  async remove(user: AuthUser, messageId: string): Promise<MessageView> {
    const [message] = await this.db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    if (!message || message.senderId !== user.id) throw Errors.notFound('That message');
    if (message.deletedAt) return toView(message);
    const [updated] = await this.db.update(messages).set({ body: '', deletedAt: new Date() }).where(eq(messages.id, message.id)).returning();
    return toView(updated!);
  }

  /* ----------------------------- Helpers ----------------------------- */

  private async mine(userId: string, conversationId: string): Promise<ConversationRow> {
    const [row] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!row || (row.memberA !== userId && row.memberB !== userId)) throw Errors.notFound('That conversation');
    return row;
  }

  private async connected(a: string, b: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: connections.id })
      .from(connections)
      .where(
        and(
          eq(connections.status, 'accepted'),
          or(and(eq(connections.requesterId, a), eq(connections.addresseeId, b)), and(eq(connections.requesterId, b), eq(connections.addresseeId, a))),
        ),
      )
      .limit(1);
    return !!row;
  }

  private async canSend(userId: string, otherId: string): Promise<boolean> {
    const [other] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, otherId)).limit(1);
    if (!other || !ACTIVE.includes(other.status)) return false;
    return !(await this.relations.isBlockedEitherWay(userId, otherId));
  }

  private async views(userId: string, rows: ConversationRow[]): Promise<ConversationView[]> {
    if (!rows.length) return [];
    const otherOf = (r: ConversationRow) => (r.memberA === userId ? r.memberB : r.memberA);
    const ids = rows.map((r) => r.id);
    const [refs, blocked, states, last, unread] = await Promise.all([
      this.members.refs(rows.map(otherOf)),
      this.relations.blockedSet(userId),
      this.db.select({ id: users.id, status: users.status }).from(users).where(inArray(users.id, rows.map(otherOf))),
      this.db
        .selectDistinctOn([messages.conversationId])
        .from(messages)
        .where(inArray(messages.conversationId, ids))
        .orderBy(messages.conversationId, desc(messages.createdAt)),
      this.db
        .select({ conversationId: messages.conversationId, n: sql<number>`count(*)::int` })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(
          and(
            inArray(messages.conversationId, ids),
            sql`${messages.senderId} <> ${userId}`,
            isNull(messages.deletedAt),
            sql`${messages.createdAt} > coalesce(case when ${conversations.memberA} = ${userId} then ${conversations.aReadAt} else ${conversations.bReadAt} end, 'epoch'::timestamptz)`,
          ),
        )
        .groupBy(messages.conversationId),
    ]);
    const active = new Set(states.filter((u) => ACTIVE.includes(u.status)).map((u) => u.id));
    const lastBy = new Map<string, MessageRow>(last.map((m) => [m.conversationId, m]));
    const unreadBy = new Map(unread.map((u) => [u.conversationId, u.n]));
    const out: ConversationView[] = [];
    for (const r of rows) {
      const member = refs.get(otherOf(r));
      if (!member) continue;
      const m = lastBy.get(r.id);
      const seen = r.memberA === userId ? r.bReadAt : r.aReadAt;
      out.push({
        id: r.id,
        member,
        lastMessage: m ? { body: visible(m) ? preview(m.body) : '', mine: m.senderId === userId, deleted: !!m.deletedAt, removed: m.moderationState !== 'visible', createdAt: m.createdAt.toISOString() } : null,
        unread: unreadBy.get(r.id) ?? 0,
        canSend: active.has(member.id) && !blocked.has(member.id),
        seenAt: seen?.toISOString() ?? null,
      });
    }
    return out;
  }
}

const visible = (m: Pick<MessageRow, 'deletedAt' | 'moderationState'>) => !m.deletedAt && m.moderationState === 'visible';

function toView(m: MessageRow): MessageView {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: visible(m) ? m.body : '',
    deleted: !!m.deletedAt,
    removed: m.moderationState !== 'visible',
    createdAt: m.createdAt.toISOString(),
  };
}
