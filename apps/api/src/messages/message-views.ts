import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type {
  ConversationView,
  LinkPreview,
  MeetingView,
  MemberRef,
  MessageAttachment,
  MessageKind,
  MessageShare,
  MessageView,
  ReactionSummary,
  ShareType,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, connections, conversationMembers, conversations, files, messageAttachments, messageReactions, messages, users } from '../db/schema.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { env } from '../config/env.js';
import { PreviewService } from '../preview/preview.service.js';

export type ConversationRow = typeof conversations.$inferSelect;
export type MemberRow = typeof conversationMembers.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

export const ACTIVE = ['active', 'unverified'];
const preview = (text: string) => (text.length > 140 ? `${text.slice(0, 139)}…` : text);
export const visible = (m: Pick<MessageRow, 'deletedAt' | 'moderationState'>) => !m.deletedAt && m.moderationState === 'visible';
const apiBase = () => new URL(env().API_PUBLIC_URL).pathname.replace(/\/$/, '');

/** The page path for a shared item. */
export function sharePath(type: ShareType, key: string): string {
  switch (type) {
    case 'post':
      return `/posts/${key}`;
    case 'article':
      return `/articles/${key}`;
    case 'event':
      return `/events/${key}`;
    case 'opportunity':
      return `/opportunities/${key}`;
    case 'member':
      return `/${key}`;
    case 'page':
      return `/pages/${key}`;
    case 'chapter':
      return `/chapters/${key}`;
  }
}

/** A short line for lists, notifications and quotes. */
export function summary(m: Pick<MessageRow, 'kind' | 'body' | 'deletedAt' | 'moderationState' | 'shareType'>, attachments = 0): string {
  if (!visible(m)) return '';
  if (m.kind === 'voice') return '🎤 Voice message';
  if (m.kind === 'meeting') return `📅 ${m.body}`;
  if (m.kind === 'share' && !m.body) return '🔗 Shared a link';
  if (!m.body && attachments) return attachments === 1 ? '📎 Attachment' : `📎 ${attachments} attachments`;
  return preview(m.body);
}

/** Builds what the app shows from rows, in batches (conversation lists, message pages). */
@Injectable()
export class MessageViews {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly previews: PreviewService,
  ) {}

  /** Each member's own row in these conversations, plus everyone else who is still in them. */
  async conversations(viewerId: string, rows: ConversationRow[], canManageBroadcast: (chapterId: string) => Promise<boolean>): Promise<ConversationView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const memberRows = await this.db.select().from(conversationMembers).where(inArray(conversationMembers.conversationId, ids));
    const byConversation = new Map<string, MemberRow[]>();
    for (const m of memberRows) {
      const list = byConversation.get(m.conversationId) ?? [];
      list.push(m);
      byConversation.set(m.conversationId, list);
    }
    // Everyone shown (direct and group members); announcements keep their readers private.
    const shownIds = new Set<string>();
    for (const r of rows) {
      if (r.kind === 'broadcast') continue;
      for (const m of byConversation.get(r.id) ?? []) if (m.userId !== viewerId && (!m.leftAt || r.kind === 'direct')) shownIds.add(m.userId);
    }
    const chapterIds = [...new Set(rows.map((r) => r.chapterId).filter((x): x is string => !!x))];
    const [refs, blocked, states, last, chapterRows, connected] = await Promise.all([
      this.members.refs([...shownIds]),
      this.relations.blockedSet(viewerId),
      shownIds.size ? this.db.select({ id: users.id, status: users.status }).from(users).where(inArray(users.id, [...shownIds])) : Promise.resolve([]),
      this.db
        .selectDistinctOn([messages.conversationId])
        .from(messages)
        .where(inArray(messages.conversationId, ids))
        .orderBy(messages.conversationId, desc(messages.createdAt)),
      chapterIds.length
        ? this.db
            .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode, imageFileId: chapters.imageFileId })
            .from(chapters)
            .where(inArray(chapters.id, chapterIds))
        : Promise.resolve([]),
      this.connectedSet(viewerId, [...shownIds]),
    ]);
    const unread = await this.unreadCounts(viewerId, rows, byConversation);
    const lastSenders = await this.members.refs(last.map((m) => m.senderId));
    const attachmentCounts = await this.attachmentCounts(last.map((m) => m.id));
    const active = new Set(states.filter((u) => ACTIVE.includes(u.status)).map((u) => u.id));
    const lastBy = new Map(last.map((m) => [m.conversationId, m]));
    const chapterBy = new Map(chapterRows.map((c) => [c.id, c]));
    const viewerMessages = await this.viewerHasWritten(viewerId, rows.filter((r) => r.kind === 'direct').map((r) => r.id));

    const out: ConversationView[] = [];
    for (const r of rows) {
      const people = byConversation.get(r.id) ?? [];
      const mine = people.find((m) => m.userId === viewerId);
      if (!mine && r.kind !== 'broadcast') continue;
      const others = people.filter((m) => m.userId !== viewerId);
      const current = others.filter((m) => !m.leftAt);
      const chapter = r.chapterId ? chapterBy.get(r.chapterId) : undefined;
      const chapterRef = chapter ? { slug: chapter.slug, name: chapter.name, countryCode: chapter.countryCode, imageUrl: mediaUrl(chapter.imageFileId) } : null;
      const member = r.kind === 'direct' ? (refs.get(others[0]?.userId ?? '') ?? null) : null;
      if (r.kind === 'direct' && !member) continue;
      const m = lastBy.get(r.id);
      const now = Date.now();
      const muted = !!mine?.mutedUntil && mine.mutedUntil.getTime() > now;
      const isManager =
        r.kind === 'group' ? mine?.role === 'admin' && !mine.leftAt : r.kind === 'broadcast' && !!r.chapterId ? await canManageBroadcast(r.chapterId) : false;
      const request = r.status === 'request' ? (r.requestedBy === viewerId ? 'outgoing' : 'incoming') : null;

      let cantSendReason: string | null = null;
      if (r.kind === 'direct') {
        const otherId = others[0]!.userId;
        if (blocked.has(otherId)) cantSendReason = 'You can’t message this member.';
        else if (!active.has(otherId)) cantSendReason = 'This account is no longer active.';
        else if (r.status === 'declined') cantSendReason = r.requestedBy === viewerId ? `${member!.name} didn’t accept your message request.` : 'You declined this message request.';
        else if (request === 'outgoing' && viewerMessages.has(r.id)) cantSendReason = `You can send more once ${member!.name} accepts your message request.`;
      } else if (r.kind === 'group') {
        if (!mine || mine.leftAt) cantSendReason = 'You’re no longer in this group.';
      } else if (!isManager) {
        cantSendReason = 'Only the chapter team posts announcements. Reply privately instead.';
      }

      const title =
        r.kind === 'direct' ? member!.name : r.kind === 'group' ? (r.title ?? 'Group') : `${chapter?.name ?? 'Chapter'} announcements`;
      out.push({
        id: r.id,
        kind: r.kind as ConversationView['kind'],
        status: r.status as ConversationView['status'],
        title,
        member,
        members: r.kind === 'broadcast' ? [] : current.map((o) => refs.get(o.userId)).filter((x): x is MemberRef => !!x),
        memberCount: people.filter((p) => !p.leftAt).length,
        admins: r.kind === 'group' ? people.filter((p) => p.role === 'admin' && !p.leftAt).map((p) => p.userId) : [],
        chapter: chapterRef,
        lastMessage: m
          ? {
              kind: m.kind as MessageKind,
              body: summary(m, attachmentCounts.get(m.id) ?? 0),
              mine: m.senderId === viewerId,
              senderName: lastSenders.get(m.senderId)?.name ?? '',
              deleted: !!m.deletedAt,
              removed: m.moderationState !== 'visible',
              createdAt: m.createdAt.toISOString(),
            }
          : null,
        unread: unread.get(r.id) ?? 0,
        canSend: !cantSendReason,
        cantSendReason,
        canManage: isManager,
        seenAt: r.kind === 'direct' ? (others[0]?.readAt?.toISOString() ?? null) : null,
        readBy: r.kind === 'group' ? current.filter((o) => o.readAt).map((o) => ({ memberId: o.userId, readAt: o.readAt!.toISOString() })) : [],
        muted,
        mutedUntil: muted ? mine!.mutedUntil!.toISOString() : null,
        pinned: !!mine?.pinnedAt,
        archived: !!mine?.archivedAt,
        markedUnread: !!mine?.markedUnread,
        request,
        // Until the viewer has written back, a chat with someone they aren't connected with carries a safety note.
        firstContact: r.kind === 'direct' && !!member && !connected.has(member.id) && !blocked.has(member.id) && !viewerMessages.has(r.id),
        joined: !!mine && !mine.leftAt,
      });
    }
    return out;
  }

  /** Unread messages from others since the viewer last read (or joined) each conversation. */
  async unreadCounts(viewerId: string, rows: ConversationRow[], byConversation?: Map<string, MemberRow[]>): Promise<Map<string, number>> {
    if (!rows.length) return new Map();
    const result = await this.db
      .select({ conversationId: messages.conversationId, n: sql<number>`count(*)::int` })
      .from(messages)
      .innerJoin(
        conversationMembers,
        and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, viewerId)),
      )
      .where(
        and(
          inArray(
            messages.conversationId,
            rows.map((r) => r.id),
          ),
          sql`${messages.senderId} <> ${viewerId}`,
          isNull(messages.deletedAt),
          sql`${messages.kind} <> 'system'`,
          sql`${messages.createdAt} > greatest(coalesce(${conversationMembers.readAt}, 'epoch'::timestamptz), ${conversationMembers.joinedAt} - interval '1 second')`,
          sql`(${conversationMembers.leftAt} is null or ${messages.createdAt} < ${conversationMembers.leftAt})`,
        ),
      )
      .groupBy(messages.conversationId);
    return new Map(result.map((r) => [r.conversationId, r.n]));
  }

  /** Messages as the app shows them. Reactions mark `mine` for this viewer (null: nobody, for live events). */
  async messages(viewerId: string | null, rows: MessageRow[]): Promise<MessageView[]> {
    if (!rows.length) return [];
    const ids = rows.map((m) => m.id);
    const replyIds = [...new Set(rows.map((m) => m.replyToId).filter((x): x is string => !!x))];
    const [attachmentRows, reactionRows, replies] = await Promise.all([
      this.db
        .select({ messageId: messageAttachments.messageId, position: messageAttachments.position, file: files })
        .from(messageAttachments)
        .innerJoin(files, eq(files.id, messageAttachments.fileId))
        .where(inArray(messageAttachments.messageId, ids))
        .orderBy(messageAttachments.position),
      this.db.select().from(messageReactions).where(inArray(messageReactions.messageId, ids)).orderBy(messageReactions.createdAt),
      replyIds.length ? this.db.select().from(messages).where(inArray(messages.id, replyIds)) : Promise.resolve([] as MessageRow[]),
    ]);
    const names = await this.members.refs([...new Set([...reactionRows.map((r) => r.userId), ...replies.map((r) => r.senderId)])]);
    const shares = await this.shares(rows);
    const attachmentsBy = new Map<string, MessageAttachment[]>();
    for (const a of attachmentRows) {
      if (a.file.scanStatus !== 'clean') continue;
      const list = attachmentsBy.get(a.messageId) ?? [];
      list.push(attachmentView(a.file));
      attachmentsBy.set(a.messageId, list);
    }
    const reactionsBy = new Map<string, Map<string, { ids: string[] }>>();
    for (const r of reactionRows) {
      const byEmoji = reactionsBy.get(r.messageId) ?? new Map<string, { ids: string[] }>();
      const entry = byEmoji.get(r.emoji) ?? { ids: [] };
      entry.ids.push(r.userId);
      byEmoji.set(r.emoji, entry);
      reactionsBy.set(r.messageId, byEmoji);
    }
    const replyBy = new Map(replies.map((r) => [r.id, r]));
    return rows.map((m) => {
      const shown = visible(m);
      const reply = m.replyToId ? replyBy.get(m.replyToId) : undefined;
      const reactions: ReactionSummary[] = [...(reactionsBy.get(m.id)?.entries() ?? [])]
        .map(([emoji, { ids: who }]) => ({
          emoji,
          count: who.length,
          mine: !!viewerId && who.includes(viewerId),
          names: who.slice(0, 5).map((id) => names.get(id)?.name ?? ''),
          memberIds: who.slice(0, 50),
        }))
        .sort((a, b) => b.count - a.count);
      return {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        kind: m.kind as MessageKind,
        body: shown ? m.body : '',
        deleted: !!m.deletedAt,
        removed: m.moderationState !== 'visible',
        editedAt: m.editedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
        clientId: m.clientId,
        replyTo:
          reply && shown
            ? {
                id: reply.id,
                senderId: reply.senderId,
                senderName: names.get(reply.senderId)?.name ?? '',
                kind: reply.kind as MessageKind,
                body: visible(reply) ? summary(reply) : '',
                gone: !visible(reply),
              }
            : null,
        attachments: shown ? (attachmentsBy.get(m.id) ?? []) : [],
        share: shown && m.shareType && m.shareId ? (shares.get(`${m.shareType}:${m.shareId}`) ?? null) : null,
        meeting: shown && m.meeting ? (m.meeting as MeetingView) : null,
        linkPreview: shown ? ((m.linkPreview as LinkPreview | null) ?? null) : null,
        reactions: shown ? reactions : [],
      };
    });
  }

  /** Shared cards, looked up now so a hidden or deleted item shows as unavailable. */
  private async shares(rows: MessageRow[]): Promise<Map<string, MessageShare>> {
    const out = new Map<string, MessageShare>();
    for (const m of rows) {
      if (!m.shareType || !m.shareId || !visible(m)) continue;
      const key = `${m.shareType}:${m.shareId}`;
      if (out.has(key)) continue;
      out.set(key, await this.share(m.shareType as ShareType, m.shareId));
    }
    return out;
  }

  async share(type: ShareType, key: string): Promise<MessageShare> {
    const path = sharePath(type, key);
    const info = await this.previews.forPath(path).catch(() => null);
    if (!info) return { type, path, title: 'No longer available', description: null, imageUrl: null, available: false };
    return {
      type,
      path,
      title: info.title.replace(/ · Charter Mission$/, ''),
      description: info.description || null,
      imageUrl: info.image ? (/^https?:\/\//.test(info.image) ? info.image : `${apiBase()}${info.image}`) : null,
      available: true,
    };
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

  private async viewerHasWritten(viewerId: string, conversationIds: string[]): Promise<Set<string>> {
    if (!conversationIds.length) return new Set();
    const rows = await this.db
      .selectDistinct({ id: messages.conversationId })
      .from(messages)
      .where(and(inArray(messages.conversationId, conversationIds), eq(messages.senderId, viewerId)));
    return new Set(rows.map((r) => r.id));
  }

  async connectedSet(viewerId: string, others: string[]): Promise<Set<string>> {
    if (!others.length) return new Set();
    const rows = await this.db
      .select({ a: connections.requesterId, b: connections.addresseeId })
      .from(connections)
      .where(
        and(
          eq(connections.status, 'accepted'),
          or(
            and(eq(connections.requesterId, viewerId), inArray(connections.addresseeId, others)),
            and(eq(connections.addresseeId, viewerId), inArray(connections.requesterId, others)),
          ),
        ),
      );
    return new Set(rows.map((r) => (r.a === viewerId ? r.b : r.a)));
  }
}

function attachmentView(file: typeof files.$inferSelect): MessageAttachment {
  const kind = file.purpose === 'voice_note' ? 'voice' : file.mime.startsWith('image/') ? 'image' : 'document';
  return {
    id: file.id,
    kind,
    url: mediaUrl(file.id)!,
    mime: file.mime,
    name: file.originalName ?? (kind === 'voice' ? 'Voice message' : 'File'),
    sizeBytes: file.sizeBytes,
    width: file.width,
    height: file.height,
    durationSeconds: file.durationMs !== null ? file.durationMs / 1000 : null,
  };
}
