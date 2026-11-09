import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { events, roles, userRoles } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { Errors } from '../common/errors.js';
import { isUuid } from '../media/uuid-param.js';
import { isPublicStatus } from './event-util.js';

export type EventRow = typeof events.$inferSelect;

/** The signed-in viewer plus the chapters they lead (chapter-scoped chapter_lead or ambassador roles; the session ignores scope). */
export interface EventViewer {
  user: AuthUser;
  ledChapters: Set<string>;
}

export function canManage(row: EventRow, viewer: EventViewer | undefined): boolean {
  if (!viewer) return false;
  const u = viewer.user;
  if (u.permissions.has('event.manage')) return true;
  if (row.createdBy === u.id) return true;
  if (row.hostType === 'member' && row.hostMemberId === u.id) return true;
  return row.hostType === 'chapter' && !!row.hostChapterId && viewer.ledChapters.has(row.hostChapterId);
}

/** Drafts and other non-public states: hosts/creators, event.manage and reviewers (event.review). */
export function canSee(row: EventRow, viewer: EventViewer | undefined): boolean {
  if (isPublicStatus(row.status)) return true;
  return canManage(row, viewer) || !!viewer?.user.permissions.has('event.review');
}

@Injectable()
export class EventAccess {
  constructor(@InjectDb() private readonly db: Db) {}

  async viewer(user: AuthUser): Promise<EventViewer> {
    return { user, ledChapters: await this.ledChapters(user.id) };
  }

  async optionalViewer(user: AuthUser | undefined): Promise<EventViewer | undefined> {
    return user ? this.viewer(user) : undefined;
  }

  async ledChapters(userId: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ scopeId: userRoles.scopeId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), inArray(roles.key, ['chapter_lead', 'ambassador']), eq(userRoles.scopeType, 'chapter'), isNull(userRoles.revokedAt)));
    return new Set(rows.map((r) => r.scopeId).filter((x): x is string => !!x));
  }

  async findRow(idOrSlug: string): Promise<EventRow | undefined> {
    const where = isUuid(idOrSlug) ? eq(events.id, idOrSlug.toLowerCase()) : eq(events.slug, idOrSlug.toLowerCase());
    const [row] = await this.db.select().from(events).where(where).limit(1);
    return row;
  }

  /** The event if the viewer may see it, else NOT_FOUND. */
  async visible(idOrSlug: string, viewer: EventViewer | undefined): Promise<EventRow> {
    const row = await this.findRow(idOrSlug);
    if (!row || !canSee(row, viewer)) throw Errors.notFound('Event');
    return row;
  }

  /** The event if the viewer may manage it; NOT_FOUND if they cannot see it, FORBIDDEN otherwise. */
  async managed(id: string, viewer: EventViewer): Promise<EventRow> {
    const row = await this.visible(id, viewer);
    if (!canManage(row, viewer)) throw Errors.forbidden('Only the event’s hosts can do that');
    return row;
  }
}
