import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { InjectDb, type Db } from '../db/db.module.js';
import { initiativeMembers, initiatives } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { EventAccess } from '../events/event-access.js';

export type InitiativeRow = typeof initiatives.$inferSelect;

/** What a member may do with initiatives, worked out once per request for many rows. */
export interface InitiativeViewer {
  user: AuthUser;
  /** Pages the viewer manages (any status). */
  pages: Set<string>;
  /** Chapters the viewer leads (chapter lead or ambassador). */
  chapters: Set<string>;
  /** Initiatives the viewer organises (team members marked organiser). */
  organises: Set<string>;
  moderator: boolean;
}

/**
 * Who organises an initiative: its lead, team members marked organiser, the admins of the host page
 * and the leads of the host chapter. Organisers edit it, answer join requests, manage the team and
 * post updates. The lead and the host's admins or leads can also delete it.
 */
@Injectable()
export class InitiativeAccess {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly pageRefs: PageRefsService,
    private readonly events: EventAccess,
  ) {}

  async viewer(user: AuthUser, initiativeIds?: string[]): Promise<InitiativeViewer> {
    const [pages, chapters, organises] = await Promise.all([
      this.pageRefs.managedIds(user.id),
      this.events.ledChapters(user.id),
      this.db
        .select({ id: initiativeMembers.initiativeId })
        .from(initiativeMembers)
        .where(
          and(
            eq(initiativeMembers.userId, user.id),
            eq(initiativeMembers.organiser, true),
            initiativeIds ? inArray(initiativeMembers.initiativeId, initiativeIds.length ? initiativeIds : ['00000000-0000-0000-0000-000000000000']) : undefined,
          ),
        ),
    ]);
    return { user, pages, chapters, organises: new Set(organises.map((r) => r.id)), moderator: user.permissions.has('moderation.view') };
  }

  /** Runs it on the host's behalf: the host page's admins or the host chapter's leads. */
  hostAdmin(row: InitiativeRow, v: InitiativeViewer): boolean {
    if (row.hostType === 'page' && row.hostPageId) return v.pages.has(row.hostPageId);
    if (row.hostType === 'chapter' && row.hostChapterId) return v.chapters.has(row.hostChapterId);
    return false;
  }

  canManage(row: InitiativeRow, v: InitiativeViewer): boolean {
    return row.leadId === v.user.id || v.organises.has(row.id) || this.hostAdmin(row, v);
  }

  canDelete(row: InitiativeRow, v: InitiativeViewer): boolean {
    return row.leadId === v.user.id || this.hostAdmin(row, v);
  }

  /** Members see it while it is live; organisers and moderators also see it hidden or removed. */
  canSee(row: InitiativeRow, v: InitiativeViewer): boolean {
    if (row.deletedAt) return false;
    if (row.moderationState === 'visible') return true;
    return v.moderator || this.canManage(row, v);
  }

  /** For posting an update: the initiative if the member may post on it, else an error message. */
  async forUpdate(user: AuthUser, initiativeId: string): Promise<InitiativeRow | string> {
    const [row] = await this.db.select().from(initiatives).where(eq(initiatives.id, initiativeId)).limit(1);
    if (!row || row.deletedAt) return 'That initiative was not found';
    const v = await this.viewer(user, [row.id]);
    if (!this.canManage(row, v)) return 'Only the initiative’s organisers can post updates on it';
    if (row.moderationState !== 'visible') return 'This initiative is hidden, so updates can’t be posted on it';
    return row;
  }
}
