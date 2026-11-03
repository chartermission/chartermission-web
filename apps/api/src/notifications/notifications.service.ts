import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  NotificationCategory,
  NotificationChannel,
  type MarkReadInput,
  type MemberRef,
  type NotificationPreferences,
  type NotificationView,
  type NotificationsQuery,
  type Page,
  type UnreadCount,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { notificationPreferences, notifications } from '../db/schema.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { MembersService } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { DEFAULT_PREFERENCES } from '../core/notify.service.js';

type Segment = NotificationView['segments'][number];
type StoredData = { segments?: Segment[]; href?: string; icon?: NotificationView['icon'] };

/** "Amina", "Amina and Kwame", or "Amina and 4 others" (CM-NTF-05). */
export function actorPrefix(names: string[], count: number): Segment[] {
  if (!names.length || count < 1) return [];
  const first: Segment = { text: names[0]!, strong: true };
  if (count === 1) return [first];
  if (count === 2 && names[1]) return [first, { text: ' and ', strong: false }, { text: names[1], strong: true }];
  const others = count - 1;
  return [first, { text: ` and ${others} ${others === 1 ? 'other' : 'others'}`, strong: false }];
}

/** In-app notification list, read state and per-category preferences (CM-NTF-01, -03). */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
  ) {}

  async list(userId: string, q: NotificationsQuery): Promise<Page<NotificationView>> {
    const c = decodeCursor<{ t: string; id: string }>(q.cursor);
    const ts = sql<string>`to_char(${notifications.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const rows = await this.db
      .select({ row: notifications, ts })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          q.filter === 'unread' ? isNull(notifications.readAt) : undefined,
          q.filter === 'mentions' ? inArray(notifications.type, ['mention', 'reply_to_comment']) : undefined,
          c ? sql`(${notifications.updatedAt}, ${notifications.id}) < (${c.t}::timestamptz, ${c.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(notifications.updatedAt), desc(notifications.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.ts, id: last.row.id }));
    const [refs, blocked] = await Promise.all([
      this.members.refs(page.items.flatMap((i) => i.row.actorIds)),
      this.relations.blockedSet(userId),
    ]);
    const items = page.items.map(({ row }) => {
      const data = row.data as StoredData;
      const actors = row.actorIds
        .filter((id) => !blocked.has(id))
        .map((id) => refs.get(id))
        .filter((r): r is MemberRef => !!r);
      const segments = [...actorPrefix(actors.map((a) => a.name), actors.length ? row.actorCount : 0), ...(data.segments ?? [])];
      return {
        id: row.id,
        type: row.type as NotificationView['type'],
        actors,
        actorCount: row.actorCount,
        segments: segments.map((s) => ({ text: s.text, strong: !!s.strong })),
        href: data.href ?? '/notifications',
        icon: data.icon ?? 'avatar',
        createdAt: row.updatedAt.toISOString(),
        read: !!row.readAt,
      } satisfies NotificationView;
    });
    return { items, nextCursor: page.nextCursor };
  }

  async unreadCount(userId: string): Promise<UnreadCount> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { unread: row?.n ?? 0 };
  }

  async markRead(userId: string, input: MarkReadInput): Promise<UnreadCount> {
    const scope = input.all ? undefined : input.ids?.length ? inArray(notifications.id, input.ids) : sql`false`;
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), scope));
    return this.unreadCount(userId);
  }

  /**
   * Every category × channel, stored value or default. Security and account
   * notifications are not categories here: they are always sent (CM-NTF-02).
   */
  async preferences(userId: string): Promise<NotificationPreferences> {
    const rows = await this.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    const stored = new Map(rows.map((r) => [`${r.category}:${r.channel}`, r.enabled]));
    const preferences: NotificationPreferences['preferences'] = [];
    for (const category of NotificationCategory.options) {
      for (const channel of NotificationChannel.options) {
        preferences.push({ category, channel, enabled: stored.get(`${category}:${channel}`) ?? DEFAULT_PREFERENCES[category][channel] });
      }
    }
    return { preferences };
  }

  async updatePreferences(userId: string, input: NotificationPreferences): Promise<NotificationPreferences> {
    for (const p of input.preferences) {
      await this.db
        .insert(notificationPreferences)
        .values({ userId, category: p.category, channel: p.channel, enabled: p.enabled })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.category, notificationPreferences.channel],
          set: { enabled: p.enabled },
        });
    }
    return this.preferences(userId);
  }
}
