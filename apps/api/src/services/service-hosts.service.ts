import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { MemberRef, ServiceHost, ServiceHostInput } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { hostAvailability, memberProfiles, pageAdmins, pages, services, users } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { RelationsService } from '../core/relations.service.js';
import { Errors } from '../common/errors.js';
import { isUuid } from '../media/uuid-param.js';
import { zoneForCountry } from './time.js';

export type ServiceRow = typeof services.$inferSelect;
export type AvailabilityRow = typeof hostAvailability.$inferSelect;

/** Who hosts a service, booking or availability: a member, or a page run by its admins. */
export type HostKey = { type: 'member'; userId: string } | { type: 'page'; pageId: string };

/** Members whose services can't be shown or booked. */
export const HIDDEN_HOST = ['deleted', 'deletion_pending', 'deactivated', 'suspended'];

export const NONE = '00000000-0000-0000-0000-000000000000';

export const FALLBACK_MEMBER: MemberRef = {
  id: NONE,
  handle: 'deleted-member',
  name: 'Former member',
  headline: null,
  avatarUrl: null,
  tone: 'tint',
  verified: false,
  staff: false,
  official: false,
};

/** The viewer of services and bookings, worked out once per request. */
export interface ServiceViewer {
  user: AuthUser | undefined;
  /** Pages the viewer manages (any status). */
  pages: Set<string>;
}

export function hostOf(row: { hostUserId: string | null; hostPageId: string | null }): HostKey {
  return row.hostPageId ? { type: 'page', pageId: row.hostPageId } : { type: 'member', userId: row.hostUserId! };
}

export function hostColumns(host: HostKey) {
  return host.type === 'member' ? { hostUserId: host.userId, hostPageId: null } : { hostUserId: null, hostPageId: host.pageId };
}

/** One calendar per member (their own consultations and the ones they booked) and one per page. */
export function calendarKey(host: HostKey): string {
  return host.type === 'member' ? `calendar:user:${host.userId}` : `calendar:page:${host.pageId}`;
}

/**
 * Shared lookups for services, availability and bookings: who the host is, whether the viewer runs
 * it, whether the viewer may see it at all (hidden or blocked hosts are a plain 404), and the host's
 * time zone.
 */
@Injectable()
export class ServiceHosts {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly pageRefs: PageRefsService,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
  ) {}

  async viewer(user: AuthUser | undefined): Promise<ServiceViewer> {
    return { user, pages: await this.pageRefs.managedIds(user?.id) };
  }

  /** The member (themself) or any admin of the host page. */
  isHost(host: HostKey, v: ServiceViewer): boolean {
    if (!v.user) return false;
    return host.type === 'member' ? host.userId === v.user.id : v.pages.has(host.pageId);
  }

  /**
   * The host the viewer wants to act for: themself, or a page they manage. `live` also requires the
   * page to be active (creating services). NOT_FOUND for unknown pages, FORBIDDEN for others' pages.
   */
  async actingHost(user: AuthUser, input: ServiceHostInput, opts: { live?: boolean } = {}): Promise<HostKey> {
    if (input.type === 'member') return { type: 'member', userId: user.id };
    const [page] = [...(await this.pageRefs.refs([input.pageId])).values()];
    if (!page) throw Errors.notFound('Page');
    if (!(await this.pageRefs.role(user.id, page.id))) throw Errors.forbidden('Only the page’s admins can do that');
    if (opts.live && page.status !== 'active') throw Errors.validation({ host: 'Choose a live page you manage' });
    return { type: 'page', pageId: page.id };
  }

  /** The member behind a handle (or id), if their services can be shown to this viewer. */
  async memberHost(handle: string, v: ServiceViewer): Promise<HostKey> {
    const key = handle.trim().toLowerCase();
    if (!key || key.length > 60) throw Errors.notFound('Member');
    const [row] = await this.db
      .select({ userId: memberProfiles.userId, status: users.status, visibility: memberProfiles.profileVisibility })
      .from(memberProfiles)
      .innerJoin(users, eq(users.id, memberProfiles.userId))
      .where(isUuid(key) ? eq(memberProfiles.userId, key) : sql`lower(${memberProfiles.handle}) = ${key}`)
      .limit(1);
    if (!row) throw Errors.notFound('Member');
    await this.assertCanSee({ type: 'member', userId: row.userId }, v, { status: row.status, visibility: row.visibility });
    return { type: 'member', userId: row.userId };
  }

  /** The page behind a slug (or id), if its services can be shown to this viewer. */
  async pageHost(slug: string, v: ServiceViewer): Promise<HostKey> {
    const key = slug.trim().toLowerCase();
    if (!key || key.length > 100) throw Errors.notFound('Page');
    const [row] = await this.db
      .select({ id: pages.id, status: pages.status })
      .from(pages)
      .where(isUuid(key) ? eq(pages.id, key) : sql`lower(${pages.slug}) = ${key}`)
      .limit(1);
    if (!row) throw Errors.notFound('Page');
    await this.assertCanSee({ type: 'page', pageId: row.id }, v, { status: row.status });
    return { type: 'page', pageId: row.id };
  }

  /**
   * Hosts are hidden (404) when the member is suspended, deactivated or deleted, when the page isn't
   * live, or when the viewer and the member have blocked each other. The host always sees their own.
   * Signed-out visitors see members whose profile is public; pages need a signed-in member.
   */
  async assertCanSee(host: HostKey, v: ServiceViewer, known?: { status: string; visibility?: string }): Promise<void> {
    if (this.isHost(host, v)) return;
    if (host.type === 'member') {
      let info = known;
      if (!info) {
        const [row] = await this.db
          .select({ status: users.status, visibility: memberProfiles.profileVisibility })
          .from(users)
          .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
          .where(eq(users.id, host.userId))
          .limit(1);
        info = row;
      }
      if (!info || HIDDEN_HOST.includes(info.status)) throw Errors.notFound('Member');
      if (!v.user) {
        if (info.visibility !== 'public') throw Errors.unauthenticated();
        return;
      }
      if (await this.relations.isBlockedEitherWay(v.user.id, host.userId)) throw Errors.notFound('Member');
      return;
    }
    let status = known?.status;
    if (!status) {
      const [row] = await this.db.select({ status: pages.status }).from(pages).where(eq(pages.id, host.pageId)).limit(1);
      status = row?.status;
    }
    if (!status || status !== 'active') throw Errors.notFound('Page');
    if (!v.user) throw Errors.unauthenticated();
  }

  /** A service the viewer may see (hidden services only for the host), else NOT_FOUND. */
  async visibleService(id: string, v: ServiceViewer): Promise<ServiceRow> {
    if (!isUuid(id)) throw Errors.notFound('That service');
    const [row] = await this.db.select().from(services).where(eq(services.id, id.toLowerCase())).limit(1);
    if (!row || row.deletedAt) throw Errors.notFound('That service');
    const host = hostOf(row);
    if (!row.active && !this.isHost(host, v)) throw Errors.notFound('That service');
    try {
      await this.assertCanSee(host, v);
    } catch (err) {
      if ((err as { code?: string }).code === 'NOT_FOUND') throw Errors.notFound('That service');
      throw err;
    }
    return row;
  }

  /** A service the viewer runs, else NOT_FOUND (can't see it) or FORBIDDEN. */
  async managedService(id: string, v: ServiceViewer): Promise<ServiceRow> {
    const row = await this.visibleService(id, v);
    if (!this.isHost(hostOf(row), v)) throw Errors.forbidden('Only the service’s host can do that');
    return row;
  }

  async availability(host: HostKey): Promise<AvailabilityRow | undefined> {
    const [row] = await this.db
      .select()
      .from(hostAvailability)
      .where(host.type === 'member' ? eq(hostAvailability.hostUserId, host.userId) : eq(hostAvailability.hostPageId, host.pageId))
      .limit(1);
    return row;
  }

  /** Before availability is saved: from the member's or page's country, else Africa/Lagos. */
  async defaultTimezone(host: HostKey): Promise<string> {
    if (host.type === 'member') {
      const [row] = await this.db.select({ c: memberProfiles.countryCode }).from(memberProfiles).where(eq(memberProfiles.userId, host.userId)).limit(1);
      return zoneForCountry(row?.c);
    }
    const [row] = await this.db.select({ c: pages.countryCode }).from(pages).where(eq(pages.id, host.pageId)).limit(1);
    return zoneForCountry(row?.c);
  }

  async timezone(host: HostKey): Promise<string> {
    return (await this.availability(host))?.timezone ?? (await this.defaultTimezone(host));
  }

  /** A member's own zone, for emails: their saved availability, else their country's. */
  async memberTimezone(userId: string): Promise<string> {
    return this.timezone({ type: 'member', userId });
  }

  /** Who acts for the host: the member, or every admin of the page. */
  async hostUserIds(host: HostKey): Promise<string[]> {
    if (host.type === 'member') return [host.userId];
    const rows = await this.db.select({ userId: pageAdmins.userId }).from(pageAdmins).where(eq(pageAdmins.pageId, host.pageId));
    return rows.map((r) => r.userId);
  }

  async isPageAdmin(userId: string, pageId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ x: pageAdmins.userId })
      .from(pageAdmins)
      .where(and(eq(pageAdmins.pageId, pageId), eq(pageAdmins.userId, userId)))
      .limit(1);
    return !!row;
  }

  /** ServiceHost views in bulk. */
  async hostViews(hosts: HostKey[]): Promise<(host: HostKey) => ServiceHost> {
    const [memberMap, pageMap] = await Promise.all([
      this.members.refs(hosts.flatMap((h) => (h.type === 'member' ? [h.userId] : []))),
      this.pageRefs.refs(hosts.flatMap((h) => (h.type === 'page' ? [h.pageId] : []))),
    ]);
    return (host) => {
      if (host.type === 'member') return { type: 'member', member: memberMap.get(host.userId) ?? FALLBACK_MEMBER };
      const page = pageMap.get(host.pageId);
      return {
        type: 'page',
        page: page
          ? PageRefsService.toRef(page)
          : { id: host.pageId, slug: 'page', name: 'Page', tagline: null, logoUrl: null, verified: false, official: false },
      };
    };
  }

  /** Name for copy: the member's display name or the page's name. */
  async hostName(host: HostKey): Promise<string> {
    const view = (await this.hostViews([host]))(host);
    return view.type === 'member' ? view.member.name : view.page.name;
  }
}
