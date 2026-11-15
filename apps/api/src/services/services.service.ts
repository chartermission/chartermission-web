import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { SERVICES_MAX_PER_HOST, type Ok, type ServiceInput, type ServiceUpdateInput, type ServiceView } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { bookings, hostAvailability, services } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { Errors } from '../common/errors.js';
import { assertNotRestricted } from '../posts/posts.service.js';
import { calendarKey, hostColumns, hostOf, ServiceHosts, type HostKey, type ServiceRow, type ServiceViewer } from './service-hosts.service.js';

const hostWhere = (host: HostKey) => (host.type === 'member' ? eq(services.hostUserId, host.userId) : eq(services.hostPageId, host.pageId));

/** Skills without duplicates (case-insensitive), in the order given. */
function cleanSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  return skills.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Services (contracts/services.ts): what a member or a page offers, listed on their profile or page.
 * Bookable services are free consultations booked in open slots (see BookingsService). The meeting
 * details are private to the host and to members holding a booking.
 */
@Injectable()
export class ServicesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly hosts: ServiceHosts,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /* ------------------------------ Read ------------------------------ */

  /** GET /members/:handle/services */
  async forMember(user: AuthUser | undefined, handle: string): Promise<ServiceView[]> {
    const v = await this.hosts.viewer(user);
    return this.forHost(await this.hosts.memberHost(handle, v), v);
  }

  /** GET /pages/:slug/services */
  async forPage(user: AuthUser | undefined, slug: string): Promise<ServiceView[]> {
    const v = await this.hosts.viewer(user);
    return this.forHost(await this.hosts.pageHost(slug, v), v);
  }

  private async forHost(host: HostKey, v: ServiceViewer): Promise<ServiceView[]> {
    const own = this.hosts.isHost(host, v);
    const rows = await this.db
      .select()
      .from(services)
      .where(and(hostWhere(host), isNull(services.deletedAt), own ? undefined : eq(services.active, true)))
      .orderBy(asc(services.position), asc(services.createdAt));
    return this.views(rows, v);
  }

  /** GET /services/:id */
  async detail(user: AuthUser | undefined, id: string): Promise<ServiceView> {
    const v = await this.hosts.viewer(user);
    const row = await this.hosts.visibleService(id, v);
    return (await this.views([row], v))[0]!;
  }

  /* ------------------------------ Write ------------------------------ */

  /** POST /services — for the member themself, or for a live page they manage. */
  async create(user: AuthUser, input: ServiceInput, ip?: string): Promise<ServiceView> {
    assertNotRestricted(user);
    const host = await this.hosts.actingHost(user, input.host, { live: true });
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`services:${calendarKey(host)}`}))`);
      const [stats] = await tx
        .select({ n: count(), max: sql<number | null>`max(${services.position})` })
        .from(services)
        .where(and(hostWhere(host), isNull(services.deletedAt)));
      if ((stats?.n ?? 0) >= SERVICES_MAX_PER_HOST) throw Errors.conflict(`You can list up to ${SERVICES_MAX_PER_HOST} services.`);
      const position = input.position ?? (stats?.max == null ? 0 : Number(stats.max) + 1);
      const [created] = await tx
        .insert(services)
        .values({ ...hostColumns(host), ...this.fields(input), position, createdBy: user.id })
        .returning();
      return created!;
    });
    await this.audit.record({ actorId: user.id, action: 'service.create', targetType: 'service', targetId: row.id, ip });
    return (await this.views([row], await this.hosts.viewer(user)))[0]!;
  }

  /** PATCH /services/:id — the host (the member, or any admin of the page). The host can't change. */
  async update(user: AuthUser, id: string, input: ServiceUpdateInput, ip?: string): Promise<ServiceView> {
    assertNotRestricted(user);
    const v = await this.hosts.viewer(user);
    const row = await this.hosts.managedService(id, v);
    const [updated] = await this.db
      .update(services)
      .set({ ...this.fields(input), ...(input.position !== undefined ? { position: input.position } : {}), updatedAt: new Date() })
      .where(eq(services.id, row.id))
      .returning();
    await this.audit.record({ actorId: user.id, action: 'service.update', targetType: 'service', targetId: row.id, ip });
    return (await this.views([updated!], v))[0]!;
  }

  /** DELETE /services/:id — soft delete; upcoming bookings are cancelled by the host and bookers told. */
  async remove(user: AuthUser, id: string, ip?: string): Promise<Ok> {
    const v = await this.hosts.viewer(user);
    const row = await this.hosts.managedService(id, v);
    const now = new Date();
    const cancelled = await this.db.transaction(async (tx) => {
      // Same lock as booking, so no booking lands on the service while it is being removed.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${calendarKey(hostOf(row))}))`);
      await tx.update(services).set({ deletedAt: now, active: false, updatedAt: now }).where(eq(services.id, row.id));
      return tx
        .update(bookings)
        .set({ status: 'cancelled', cancelledBy: 'host', cancelledAt: now, updatedAt: now })
        .where(and(eq(bookings.serviceId, row.id), eq(bookings.status, 'confirmed'), gt(bookings.startsAt, now)))
        .returning({ id: bookings.id });
    });
    await this.audit.record({ actorId: user.id, action: 'service.delete', targetType: 'service', targetId: row.id, ip });
    for (const b of cancelled) await this.events.emit({ type: 'booking.cancelled', bookingId: b.id, actorId: user.id });
    return { ok: true };
  }

  private fields(input: ServiceInput) {
    return {
      title: input.title,
      description: input.description,
      skills: cleanSkills(input.skills),
      rateNote: input.rateNote || null,
      bookable: input.bookable,
      durationMinutes: input.durationMinutes,
      mode: input.mode,
      locationHint: input.locationHint || null,
      meetingDetails: input.meetingDetails || null,
      noticeHours: input.noticeHours,
      windowDays: input.windowDays,
      active: input.active,
    };
  }

  /* ------------------------------ Views ------------------------------ */

  /** Why the viewer can't book this service, or null when they can. */
  cantBookReason(row: ServiceRow, v: ServiceViewer, configured: boolean): string | null {
    const host = hostOf(row);
    if (!v.user) return 'Sign in to book a consultation';
    if (this.hosts.isHost(host, v)) return host.type === 'member' ? 'You can’t book your own service' : 'You can’t book a service of a page you manage';
    if (!row.bookable || !row.active || row.deletedAt || !row.durationMinutes || !row.mode) return 'This service can’t be booked online';
    if (!configured) return 'Not taking bookings right now';
    if (!v.user.emailVerified) return 'Verify your email address to book';
    return null;
  }

  /** Views in bulk: one query per related table. */
  async views(rows: ServiceRow[], v: ServiceViewer): Promise<ServiceView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const hostKeys = rows.map(hostOf);
    const userIds = [...new Set(hostKeys.flatMap((h) => (h.type === 'member' ? [h.userId] : [])))];
    const pageIds = [...new Set(hostKeys.flatMap((h) => (h.type === 'page' ? [h.pageId] : [])))];
    const managed = rows.filter((r) => this.hosts.isHost(hostOf(r), v)).map((r) => r.id);
    const now = new Date();
    const [hostView, configuredRows, heldRows, upcomingRows] = await Promise.all([
      this.hosts.hostViews(hostKeys),
      this.db
        .select({ userId: hostAvailability.hostUserId, pageId: hostAvailability.hostPageId })
        .from(hostAvailability)
        .where(
          sql`${userIds.length ? inArray(hostAvailability.hostUserId, userIds) : sql`false`} or ${pageIds.length ? inArray(hostAvailability.hostPageId, pageIds) : sql`false`}`,
        ),
      v.user
        ? this.db
            .selectDistinct({ id: bookings.serviceId })
            .from(bookings)
            .where(and(inArray(bookings.serviceId, ids), eq(bookings.bookerId, v.user.id), eq(bookings.status, 'confirmed'), gt(bookings.endsAt, now)))
        : [],
      managed.length
        ? this.db
            .select({ id: bookings.serviceId, n: count() })
            .from(bookings)
            .where(and(inArray(bookings.serviceId, managed), eq(bookings.status, 'confirmed'), gt(bookings.startsAt, now)))
            .groupBy(bookings.serviceId)
        : [],
    ]);
    const configured = new Set(configuredRows.map((r) => r.userId ?? r.pageId));
    const held = new Set(heldRows.map((r) => r.id));
    const upcoming = new Map(upcomingRows.map((r) => [r.id, Number(r.n)]));
    return rows.map((row) => {
      const host = hostOf(row);
      const canManage = this.hosts.isHost(host, v);
      const reason = this.cantBookReason(row, v, configured.has(host.type === 'member' ? host.userId : host.pageId));
      return {
        id: row.id,
        host: hostView(host),
        title: row.title,
        description: row.description,
        skills: row.skills,
        rateNote: row.rateNote,
        bookable: row.bookable,
        durationMinutes: row.durationMinutes,
        mode: (row.mode as ServiceView['mode']) ?? null,
        locationHint: row.locationHint,
        meetingDetails: canManage || held.has(row.id) ? row.meetingDetails : null,
        noticeHours: row.noticeHours,
        windowDays: row.windowDays,
        active: row.active,
        position: row.position,
        ...(canManage ? { upcomingBookings: upcoming.get(row.id) ?? 0 } : {}),
        viewer: { canManage, canBook: reason === null, cantBookReason: reason },
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }
}
