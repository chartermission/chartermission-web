import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { ChapterPostApproval } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapterBans, chapters, roles, userRoles, users } from '../db/schema.js';
import { SettingsService } from '../infra/settings.service.js';
import { Errors } from '../common/errors.js';
import type { AuthUser } from './auth-context.js';

/**
 * The rules of a chapter that other features need to ask about: who its team is, whether a member
 * is barred from it, and whether members' posts wait for approval before they appear in it.
 */
@Injectable()
export class ChapterRules {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /** Serving Ambassadors and Chapter Leads of the chapter. */
  async teamIds(chapterId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          inArray(roles.key, ['ambassador', 'chapter_lead']),
          eq(userRoles.scopeType, 'chapter'),
          eq(userRoles.scopeId, chapterId),
          isNull(userRoles.revokedAt),
          notInArray(users.status, ['deleted', 'deletion_pending', 'deactivated']),
        ),
      );
    return [...new Set(rows.map((r) => r.userId))];
  }

  /** The chapter's team, or staff who manage chapters. They moderate the chapter and post without approval. */
  async canModerate(user: AuthUser, chapterId: string): Promise<boolean> {
    if (user.permissions.has('chapter.manage')) return true;
    return (await this.teamIds(chapterId)).includes(user.id);
  }

  async isBanned(userId: string, chapterId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: chapterBans.userId })
      .from(chapterBans)
      .where(and(eq(chapterBans.chapterId, chapterId), eq(chapterBans.userId, userId)))
      .limit(1);
    return !!row;
  }

  /** The chapter's own rule when it has one, else the platform setting. */
  async approval(chapterId: string): Promise<ChapterPostApproval> {
    const [row] = await this.db.select({ postApproval: chapters.postApproval }).from(chapters).where(eq(chapters.id, chapterId)).limit(1);
    if (row?.postApproval === 'direct' || row?.postApproval === 'review') return row.postApproval;
    return (await this.settings.get('chapter_posts')).approval;
  }

  /**
   * Called before a member posts into a chapter. Refuses barred members; says whether the post
   * must wait for approval (never for the chapter's own team or for staff).
   */
  async posting(user: AuthUser, chapterId: string): Promise<{ review: boolean }> {
    if (await this.isBanned(user.id, chapterId)) throw Errors.forbidden('You can’t post in this chapter. Its team has removed you from it.');
    if ((await this.approval(chapterId)) !== 'review') return { review: false };
    if (user.isStaff || (await this.canModerate(user, chapterId))) return { review: false };
    return { review: true };
  }

  /** Called before a member joins (follows) a chapter. */
  async assertCanJoin(userId: string, chapterId: string): Promise<void> {
    if (await this.isBanned(userId, chapterId)) throw Errors.forbidden('You can’t join this chapter. Its team has removed you from it.');
  }
}
