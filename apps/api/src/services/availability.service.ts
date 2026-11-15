import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AvailabilityInput, AvailabilityView, ServiceHostQuery } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { hostAvailability } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { Errors } from '../common/errors.js';
import { ServiceHosts, type AvailabilityRow, type HostKey } from './service-hosts.service.js';

/** Shown before the host saves availability: weekdays 09:00 to 17:00, nothing bookable yet. */
const DEFAULT_WINDOWS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '17:00' }));

/** Weekly hours, days off, buffer and daily limit for one host (contracts AvailabilityView). */
@Injectable()
export class AvailabilityService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly hosts: ServiceHosts,
  ) {}

  private async host(user: AuthUser, q: ServiceHostQuery): Promise<HostKey> {
    if (q.host === 'page') {
      if (!q.pageId) throw Errors.validation({ pageId: 'Choose a page' });
      return this.hosts.actingHost(user, { type: 'page', pageId: q.pageId });
    }
    return this.hosts.actingHost(user, { type: 'member' });
  }

  /** GET /availability?host=member | host=page&pageId=… (the host). */
  async get(user: AuthUser, q: ServiceHostQuery): Promise<AvailabilityView> {
    const host = await this.host(user, q);
    const row = await this.hosts.availability(host);
    return row ? this.view(row) : this.defaults(host);
  }

  /** PUT /availability?host=… — saves (creates or replaces) the host's availability. */
  async put(user: AuthUser, q: ServiceHostQuery, input: AvailabilityInput): Promise<AvailabilityView> {
    const host = await this.host(user, q);
    const values = {
      timezone: input.timezone,
      windows: [...input.windows].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)),
      daysOff: [...new Set(input.daysOff)].sort(),
      bufferMinutes: input.bufferMinutes,
      maxPerDay: input.maxPerDay,
      updatedBy: user.id,
      updatedAt: new Date(),
    };
    const [row] = await this.db
      .insert(hostAvailability)
      .values({ ...(host.type === 'member' ? { hostUserId: host.userId } : { hostPageId: host.pageId }), ...values })
      .onConflictDoUpdate(
        host.type === 'member'
          ? { target: hostAvailability.hostUserId, targetWhere: sqlNotNull('host_user_id'), set: values }
          : { target: hostAvailability.hostPageId, targetWhere: sqlNotNull('host_page_id'), set: values },
      )
      .returning();
    return this.view(row!);
  }

  view(row: AvailabilityRow): AvailabilityView {
    return {
      timezone: row.timezone,
      windows: row.windows,
      daysOff: row.daysOff,
      bufferMinutes: row.bufferMinutes,
      maxPerDay: row.maxPerDay,
      configured: true,
    };
  }

  private async defaults(host: HostKey): Promise<AvailabilityView> {
    return { timezone: await this.hosts.defaultTimezone(host), windows: DEFAULT_WINDOWS, daysOff: [], bufferMinutes: 0, maxPerDay: null, configured: false };
  }
}

/** Partial unique indexes need their predicate repeated in ON CONFLICT. */
function sqlNotNull(column: 'host_user_id' | 'host_page_id') {
  return sql`${sql.identifier(column)} is not null`;
}
