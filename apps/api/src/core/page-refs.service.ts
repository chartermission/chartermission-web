import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { PageAdminRole, PageRef, PageStatus } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { pageAdmins, pages } from '../db/schema.js';
import { mediaUrl } from './members.service.js';

export type PageRefRow = PageRef & { status: PageStatus };

/**
 * Builds PageRef (the compact page shape) and answers "does this member manage this page?".
 * Lives in core so posts, feeds and follows can show pages without importing the pages module.
 */
@Injectable()
export class PageRefsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async refs(ids: Iterable<string>): Promise<Map<string, PageRefRow>> {
    const unique = [...new Set(ids)].filter(Boolean);
    const map = new Map<string, PageRefRow>();
    if (!unique.length) return map;
    const rows = await this.db
      .select({
        id: pages.id,
        slug: pages.slug,
        name: pages.name,
        tagline: pages.tagline,
        logoFileId: pages.logoFileId,
        verifiedAt: pages.verifiedAt,
        official: pages.official,
        status: pages.status,
      })
      .from(pages)
      .where(inArray(pages.id, unique));
    for (const r of rows) {
      map.set(r.id, {
        id: r.id,
        slug: r.slug,
        name: r.name,
        tagline: r.tagline,
        logoUrl: mediaUrl(r.logoFileId),
        verified: !!r.verifiedAt,
        official: r.official,
        status: r.status as PageStatus,
      });
    }
    return map;
  }

  /** The public shape, without the status. */
  static toRef({ status: _status, ...ref }: PageRefRow): PageRef {
    return ref;
  }

  /** Ids of the pages this member manages (owner or admin), whatever their status. */
  async managedIds(userId: string | undefined): Promise<Set<string>> {
    if (!userId) return new Set();
    const rows = await this.db.select({ pageId: pageAdmins.pageId }).from(pageAdmins).where(eq(pageAdmins.userId, userId));
    return new Set(rows.map((r) => r.pageId));
  }

  async role(userId: string | undefined, pageId: string): Promise<PageAdminRole | null> {
    if (!userId) return null;
    const [row] = await this.db
      .select({ role: pageAdmins.role })
      .from(pageAdmins)
      .where(and(eq(pageAdmins.pageId, pageId), eq(pageAdmins.userId, userId)))
      .limit(1);
    return (row?.role as PageAdminRole | undefined) ?? null;
  }
}
