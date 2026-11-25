import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  PROFILE_VIEWS_KEEP_DAYS,
  type AnonymousViewers,
  type ProfileViewer,
  type ProfileViewsPage,
  type ProfileViewsQuery,
  type ProfileViewsSummary,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapters, connections, follows, memberProfiles, profileViews, searchAppearances, users } from '../db/schema.js';
import type { AuthContext } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { NotifyService } from '../core/notify.service.js';
import { RelationsService } from '../core/relations.service.js';
import { checkCursor, decodeCursor, paginate } from '../common/cursor.js';
import { EventsService } from '../infra/events.service.js';
import { QueueService } from '../infra/queue.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { effectiveVisibility } from './visibility.js';

const DAY_MS = 86_400_000;
export const PROFILE_VIEWS_CLEANUP_JOB = 'profile-views-cleanup';
/** Accounts whose views (and profiles) no longer count. */
const GONE = ['deleted', 'deletion_pending', 'deactivated', 'suspended'];

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
/** The UTC day `n` days before today. */
const daysAgo = (n: number, now = new Date()) => dayKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - n * DAY_MS));

/**
 * Who viewed your profile (LinkedIn-style). The member site reports a profile opened by a signed-in member
 * (POST /members/{handle}/views); one row per viewer, profile and day, kept 90 days. Self-views, staff in the admin
 * console, official accounts and blocked pairs are never recorded. Viewers in private mode are stored with only what
 * may be said about them ("Someone at PayBridge"), and members in private mode see counts but not names.
 */
@Injectable()
export class ProfileViewsService implements OnModuleInit {
  private readonly logger = new Logger('ProfileViews');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly notify: NotifyService,
    private readonly events: EventsService,
    private readonly queue: QueueService,
    private readonly limits: RateLimitService,
  ) {}

  onModuleInit() {
    this.events.on('profile.viewed', (e) => this.notifyOwner(e.profileId, e.day));
    this.queue.process('maintenance', async (name) => {
      if (name === PROFILE_VIEWS_CLEANUP_JOB) await this.cleanup();
    });
    this.queue.every('maintenance', PROFILE_VIEWS_CLEANUP_JOB, DAY_MS).catch((err: unknown) => {
      this.logger.warn(`Could not schedule ${PROFILE_VIEWS_CLEANUP_JOB}: ${String(err)}`);
    });
  }

  /** POST /members/{handle}/views. Quiet: whatever happens, the member's page carries on. */
  async record(ctx: AuthContext, handleOrId: string): Promise<void> {
    // Staff looking at members from the admin console, and Claude reading profiles, are not profile views.
    if (ctx.session.audience !== 'member' || ctx.via || ctx.user.isOfficial) return;
    const viewerId = ctx.user.id;
    await this.limits.consume(`profile-views:${viewerId}`, 600, 3600);
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(handleOrId);
    const [target] = await this.db
      .select({ userId: memberProfiles.userId, status: users.status, isOfficial: users.isOfficial })
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(isId ? eq(memberProfiles.userId, handleOrId) : sql`lower(${memberProfiles.handle}) = ${handleOrId.toLowerCase()}`)
      .limit(1);
    if (!target || target.userId === viewerId || GONE.includes(target.status) || target.isOfficial) return;
    if (await this.relations.isBlockedEitherWay(viewerId, target.userId)) return;

    const [viewer] = await this.db
      .select({ viewing: memberProfiles.profileViewing, organisation: memberProfiles.organisation, fieldVisibility: memberProfiles.fieldVisibility, countryCode: memberProfiles.countryCode })
      .from(memberProfiles)
      .where(eq(memberProfiles.userId, viewerId))
      .limit(1);
    if (!viewer) return;
    const isPrivate = viewer.viewing === 'private';
    const anon = isPrivate ? await this.anonymousLabel(viewerId, viewer) : { kind: null, name: null };
    const day = dayKey(new Date());
    // A day's view made in private mode stays private even if the viewer opens the profile again by name.
    const result = await this.db.execute<{ is_new: boolean }>(sql`
      insert into ${profileViews} (profile_id, viewer_id, day, viewed_at, private, anon_kind, anon_name)
      values (${target.userId}, ${viewerId}, ${day}::date, now(), ${isPrivate}, ${anon.kind}, ${anon.name})
      on conflict (profile_id, viewer_id, day) do update
        set viewed_at = now(),
            private = ${profileViews.private} or excluded.private,
            anon_kind = coalesce(${profileViews.anonKind}, excluded.anon_kind),
            anon_name = coalesce(${profileViews.anonName}, excluded.anon_name)
      returning (xmax = 0) as is_new`);
    if (result.rows[0]?.is_new) await this.events.emit({ type: 'profile.viewed', profileId: target.userId, day });
  }

  /**
   * What may be said about a viewer in private mode: their organisation when members may see it, else a chapter they
   * belong to (the one for their country first), else just "a Charter Mission member".
   */
  private async anonymousLabel(
    viewerId: string,
    viewer: { organisation: string | null; fieldVisibility: Record<string, string>; countryCode: string | null },
  ): Promise<{ kind: 'company' | 'chapter' | 'member'; name: string | null }> {
    const orgVisibility = effectiveVisibility(viewer.fieldVisibility).organisation;
    if (viewer.organisation?.trim() && (orgVisibility === 'members' || orgVisibility === 'public')) {
      return { kind: 'company', name: viewer.organisation.trim() };
    }
    const own = await this.db
      .select({ name: chapters.name, countryCode: chapters.countryCode })
      .from(follows)
      .innerJoin(chapters, sql`${chapters.id}::text = ${follows.targetId}`)
      .where(and(eq(follows.followerId, viewerId), eq(follows.targetType, 'chapter')))
      .orderBy(chapters.name);
    const chapter = own.find((c) => c.countryCode && c.countryCode === viewer.countryCode) ?? own[0];
    if (chapter) return { kind: 'chapter', name: chapter.name };
    return { kind: 'member', name: null };
  }

  /**
   * The day's grouped notification: "Amara Okafor and 3 others viewed your profile". Recomputed from the table on each
   * new viewer, so private viewers only add to the count; it alerts once a day (an update keeps it read if it was).
   * Members in private mode are told how many, never who.
   */
  async notifyOwner(profileId: string, day: string): Promise<void> {
    const viewing = await this.viewingOf(profileId);
    const rows = await this.db
      .select({ viewerId: profileViews.viewerId, private: profileViews.private })
      .from(profileViews)
      .innerJoin(users, eq(users.id, profileViews.viewerId))
      .where(
        and(
          eq(profileViews.profileId, profileId),
          eq(profileViews.day, day),
          sql`${users.status} not in ('deleted','deletion_pending','deactivated','suspended')`,
          this.relations.notBlockedSql(profileId, profileViews.viewerId),
        ),
      )
      .orderBy(sql`${profileViews.viewedAt} desc`);
    if (!rows.length) return;
    const named = viewing === 'private' ? [] : rows.filter((r) => !r.private).map((r) => r.viewerId);
    const count = rows.length;
    const first = named.length ? await this.members.ref(named[0]!) : null;
    const segments = first
      ? [{ text: ' viewed your profile', strong: false }]
      : count === 1
        ? [{ text: 'Someone viewed your profile', strong: false }]
        : [
            { text: String(count), strong: true },
            { text: ' people viewed your profile', strong: false },
          ];
    const who = first ? (count === 1 ? first.name : `${first.name} and ${count - 1} ${count === 2 ? 'other' : 'others'}`) : count === 1 ? 'Someone' : `${count} people`;
    await this.notify.notify({
      userId: profileId,
      type: 'profile_viewed',
      actors: { ids: first ? named : [], count: first ? count : 0 },
      objectType: 'member',
      objectId: profileId,
      segments,
      href: '/profile-views',
      icon: 'eye',
      dedupeKey: `profile_viewed:${day}`,
      windowMinutes: 24 * 60,
      keepRead: true,
      emailWhenNew: true,
      email: {
        subject: `${who} viewed your profile`,
        heading: 'Who viewed your profile',
        paragraphs: [`${who} viewed your profile on Charter Mission today.`, 'See who has been looking at your profile over the last 90 days.'],
        buttonLabel: 'See who viewed your profile',
      },
    });
  }

  /** GET /me/profile-views/summary */
  async summary(userId: string): Promise<ProfileViewsSummary> {
    const viewing = await this.viewingOf(userId);
    const since = daysAgo(PROFILE_VIEWS_KEEP_DAYS - 1);
    const [perDay, searches] = await Promise.all([
      this.db
        .select({ day: profileViews.day, n: sql<number>`count(*)::int` })
        .from(profileViews)
        .innerJoin(users, eq(users.id, profileViews.viewerId))
        .where(
          and(
            eq(profileViews.profileId, userId),
            sql`${profileViews.day} >= ${since}::date`,
            sql`${users.status} not in ('deleted','deletion_pending','deactivated','suspended')`,
            this.relations.notBlockedSql(userId, profileViews.viewerId),
          ),
        )
        .groupBy(profileViews.day),
      this.db
        .select({ day: searchAppearances.day, n: searchAppearances.count })
        .from(searchAppearances)
        .where(and(eq(searchAppearances.userId, userId), sql`${searchAppearances.day} >= ${daysAgo(13)}::date`)),
    ]);
    const byDay = new Map(perDay.map((r) => [String(r.day), r.n]));
    const sum = (from: number, to: number, map: Map<string, number>) => {
      let total = 0;
      for (let i = from; i <= to; i++) total += map.get(daysAgo(i)) ?? 0;
      return total;
    };
    const searchByDay = new Map(searches.map((r) => [String(r.day), r.n]));
    return {
      total: [...byDay.values()].reduce((a, b) => a + b, 0),
      last7: sum(0, 6, byDay),
      last30: sum(0, 29, byDay),
      previous30: sum(30, 59, byDay),
      daily: Array.from({ length: 30 }, (_, i) => {
        const day = daysAgo(29 - i);
        return { day, views: byDay.get(day) ?? 0 };
      }),
      searchAppearances: { last7: sum(0, 6, searchByDay), previous7: sum(7, 13, searchByDay) },
      canSeeViewers: viewing === 'named',
      viewing: viewing as ProfileViewsSummary['viewing'],
    };
  }

  /** GET /me/profile-views: the summary (first page), named viewers (paged) and private viewers collapsed. */
  async list(userId: string, q: ProfileViewsQuery): Promise<ProfileViewsPage> {
    const cursor = decodeCursor<{ t: string; id: string }>(q.cursor);
    checkCursor(cursor, { t: 'date', id: 'uuid' });
    const summary = cursor ? null : await this.summary(userId);
    const canSee = summary ? summary.canSeeViewers : (await this.viewingOf(userId)) === 'named';
    if (!canSee) return { summary, items: [], nextCursor: null, anonymous: [] };

    const since = daysAgo(PROFILE_VIEWS_KEEP_DAYS - 1);
    const scope = and(
      eq(profileViews.profileId, userId),
      sql`${profileViews.day} >= ${since}::date`,
      sql`${users.status} not in ('deleted','deletion_pending','deactivated','suspended')`,
      this.relations.notBlockedSql(userId, profileViews.viewerId),
    );
    const last = sql<string>`to_char(max(${profileViews.viewedAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const rows = await this.db
      .select({ viewerId: profileViews.viewerId, last, days: sql<number>`count(*)::int` })
      .from(profileViews)
      .innerJoin(users, eq(users.id, profileViews.viewerId))
      .where(and(scope, eq(profileViews.private, false)))
      .groupBy(profileViews.viewerId)
      .having(cursor ? sql`(max(${profileViews.viewedAt}), ${profileViews.viewerId}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : undefined)
      .orderBy(sql`max(${profileViews.viewedAt}) desc`, sql`${profileViews.viewerId} desc`)
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (r) => ({ t: r.last, id: r.viewerId }));
    const ids = page.items.map((r) => r.viewerId);
    const [refs, connected] = await Promise.all([this.members.refs(ids), this.connectedTo(userId, ids)]);
    const items: ProfileViewer[] = [];
    for (const r of page.items) {
      const member = refs.get(r.viewerId);
      if (member) items.push({ member, viewedAt: r.last, days: r.days, connection: connected.has(r.viewerId) });
    }

    let anonymous: AnonymousViewers[] = [];
    if (!cursor) {
      const groups = await this.db
        .select({
          kind: profileViews.anonKind,
          name: profileViews.anonName,
          count: sql<number>`count(distinct ${profileViews.viewerId})::int`,
          last,
        })
        .from(profileViews)
        .innerJoin(users, eq(users.id, profileViews.viewerId))
        .where(and(scope, eq(profileViews.private, true)))
        .groupBy(profileViews.anonKind, profileViews.anonName)
        .orderBy(sql`max(${profileViews.viewedAt}) desc`)
        .limit(20);
      anonymous = groups.map((g) => ({
        kind: (g.kind ?? 'member') as AnonymousViewers['kind'],
        name: g.kind === 'member' ? null : g.name,
        count: g.count,
        lastViewedAt: g.last,
      }));
    }
    return { summary, items, nextCursor: page.nextCursor, anonymous };
  }

  private async viewingOf(userId: string): Promise<string> {
    const [row] = await this.db.select({ viewing: memberProfiles.profileViewing }).from(memberProfiles).where(eq(memberProfiles.userId, userId)).limit(1);
    return row?.viewing ?? 'named';
  }

  private async connectedTo(userId: string, ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.db
      .select({ a: connections.requesterId, b: connections.addresseeId })
      .from(connections)
      .where(
        and(
          eq(connections.status, 'accepted'),
          or(
            and(eq(connections.requesterId, userId), inArray(connections.addresseeId, ids)),
            and(eq(connections.addresseeId, userId), inArray(connections.requesterId, ids)),
          ),
        ),
      );
    return new Set(rows.map((r) => (r.a === userId ? r.b : r.a)));
  }

  /** People search showed these members (one more appearance each, today). Never fails the search. */
  async recordSearchAppearances(userIds: string[]): Promise<void> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    const day = dayKey(new Date());
    const values = sql.join(
      ids.map((id) => sql`(${id}::uuid, ${day}::date, 1)`),
      sql`, `,
    );
    await this.db
      .execute(sql`
        insert into ${searchAppearances} (user_id, day, count) values ${values}
        on conflict (user_id, day) do update set count = ${searchAppearances.count} + 1`)
      .catch((err: unknown) => this.logger.warn(`search appearances not recorded: ${String(err)}`));
  }

  /** Daily: views and search appearances older than 90 days are deleted. */
  async cleanup(): Promise<{ views: number; searches: number }> {
    const before = daysAgo(PROFILE_VIEWS_KEEP_DAYS);
    const views = await this.db.delete(profileViews).where(sql`${profileViews.day} < ${before}::date`).returning({ id: profileViews.viewerId });
    const searches = await this.db.delete(searchAppearances).where(sql`${searchAppearances.day} < ${before}::date`).returning({ id: searchAppearances.userId });
    return { views: views.length, searches: searches.length };
  }
}
