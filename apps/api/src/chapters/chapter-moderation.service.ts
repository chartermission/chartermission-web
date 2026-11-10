import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type {
  ChapterBan,
  ChapterBanInput,
  ChapterFraudReportInput,
  ChapterPostReviewInput,
  ChapterReviewQueue,
  CreateReportResponse,
  PostView,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { chapterBans, chapterPins, chapters, contentReports, follows, posts, roles, userRoles, users } from '../db/schema.js';
import type { AuthContext, AuthUser } from '../core/auth-context.js';
import { ChapterRules } from '../core/chapter-rules.service.js';
import { MembersService } from '../core/members.service.js';
import { ADMIN_SIGNIN_ROLES } from '../core/permissions.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { Errors } from '../common/errors.js';
import { isUuid } from '../media/uuid-param.js';
import { PostSerializer } from '../posts/post-serializer.js';
import { PostsService } from '../posts/posts.service.js';
import { ReportsService } from '../moderation/reports.service.js';

type Chapter = { id: string; slug: string; name: string };

/**
 * What a chapter's team (its Ambassadors and Chapter Leads, and staff who manage chapters) can do
 * to keep the chapter in order: approve or decline posts waiting for review, take a live post back
 * for review or out of the chapter, bar a member from the chapter, and flag suspected fraud to the
 * platform's moderators. Everything is scoped to the one chapter and written to the audit log.
 */
@Injectable()
export class ChapterModerationService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly rules: ChapterRules,
    private readonly members: MembersService,
    private readonly serializer: PostSerializer,
    private readonly postsService: PostsService,
    private readonly reports: ReportsService,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  /** GET /chapters/{slug}/review — posts waiting for approval, oldest first. */
  async queue(user: AuthUser, slugOrId: string): Promise<ChapterReviewQueue> {
    const chapter = await this.team(user, slugOrId);
    const rows = await this.db
      .select()
      .from(posts)
      .where(and(eq(posts.chapterId, chapter.id), eq(posts.status, 'in_review'), isNull(posts.deletedAt)))
      .orderBy(asc(posts.createdAt))
      .limit(100);
    const views = await this.serializer.posts(rows.map((r) => r.id), user);
    const byId = new Map(views.map((v) => [v.id, v]));
    const reviewers = await this.members.refs(rows.map((r) => r.chapterReviewBy).filter((x): x is string => !!x));
    const items: PostView[] = [];
    for (const r of rows) {
      const view = byId.get(r.id);
      if (!view) continue;
      items.push({
        ...view,
        chapterReview: {
          state: 'pending',
          note: r.chapterReviewNote,
          by: (r.chapterReviewBy && reviewers.get(r.chapterReviewBy)) || null,
          at: r.chapterReviewAt?.toISOString() ?? null,
        },
      });
    }
    return { items };
  }

  /** POST /chapters/{slug}/posts/{postId}/review */
  async review(user: AuthUser, slugOrId: string, postId: string, input: ChapterPostReviewInput, ip?: string): Promise<{ status: PostView['status'] }> {
    const chapter = await this.team(user, slugOrId);
    const [post] = await this.db.select().from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post || post.deletedAt || post.chapterId !== chapter.id) throw Errors.notFound('That post');
    const note = input.note?.trim() || null;
    const waiting = post.status === 'in_review';
    const live = post.status === 'published';

    let status: PostView['status'];
    if (input.action === 'approve') {
      if (!waiting) throw Errors.conflict('This post isn’t waiting for approval');
      if (!(await this.postsService.publishApproved(post.id, user.id))) throw Errors.conflict('This post isn’t waiting for approval');
      status = 'published';
    } else if (input.action === 'decline') {
      if (!waiting) throw Errors.conflict('This post isn’t waiting for approval');
      await this.settle(post.id, 'in_review', { status: 'declined', chapterReview: 'declined' }, user.id, note);
      status = 'declined';
    } else {
      if (!live) throw Errors.conflict(waiting ? 'This post is already waiting for review' : 'This post isn’t live in the chapter');
      if (post.authorId === user.id) throw Errors.conflict('This is your own post. Delete it from its menu instead.');
      if (post.kind === 'announcement') throw Errors.forbidden('Announcements from the platform team can’t be moderated by a chapter');
      const next = input.action === 'hold' ? ({ status: 'in_review', chapterReview: 'pending' } as const) : ({ status: 'declined', chapterReview: 'declined' } as const);
      await this.settle(post.id, 'published', next, user.id, note);
      // A post that is no longer live can't stay pinned.
      await this.db.delete(chapterPins).where(eq(chapterPins.postId, post.id));
      status = next.status;
    }
    await this.audit.record({
      actorId: user.id,
      action: `chapter.post.${input.action}`,
      targetType: 'post',
      targetId: post.id,
      before: { status: post.status },
      after: { status, chapterId: chapter.id, note },
      ip,
    });
    await this.events.emit({ type: 'chapter.post_reviewed', postId: post.id, chapterId: chapter.id, action: input.action, actorId: user.id });
    return { status };
  }

  /** GET /chapters/{slug}/bans */
  async bans(user: AuthUser, slugOrId: string): Promise<ChapterBan[]> {
    const chapter = await this.team(user, slugOrId);
    const rows = await this.db.select().from(chapterBans).where(eq(chapterBans.chapterId, chapter.id)).orderBy(desc(chapterBans.createdAt));
    const refs = await this.members.refs([...rows.map((r) => r.userId), ...rows.map((r) => r.bannedBy).filter((x): x is string => !!x)]);
    const out: ChapterBan[] = [];
    for (const r of rows) {
      const member = refs.get(r.userId);
      if (!member) continue;
      out.push({ member, bannedBy: (r.bannedBy && refs.get(r.bannedBy)) || null, reason: r.reason, createdAt: r.createdAt.toISOString() });
    }
    return out;
  }

  /** POST /chapters/{slug}/bans — bar a member: they leave the chapter and can't rejoin or post in it. */
  async ban(user: AuthUser, slugOrId: string, input: ChapterBanInput, ip?: string): Promise<ChapterBan[]> {
    const chapter = await this.team(user, slugOrId);
    if (input.userId === user.id) throw Errors.badRequest('You can’t remove yourself from the chapter this way');
    const [target] = await this.db.select({ id: users.id, isStaff: users.isStaff }).from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target) throw Errors.notFound('That member');
    const [privileged] = await this.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, target.id), isNull(userRoles.revokedAt), inArray(roles.key, ADMIN_SIGNIN_ROLES)))
      .limit(1);
    if (target.isStaff || privileged) throw Errors.forbidden('Members of the Charter Mission team can’t be removed from a chapter');
    if ((await this.rules.teamIds(chapter.id)).includes(target.id)) {
      throw Errors.forbidden('This member is on the chapter’s team. Ask the Charter Mission team to change the chapter’s team first.');
    }
    const reason = input.reason?.trim() || null;
    const created = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(chapterBans)
        .values({ chapterId: chapter.id, userId: target.id, bannedBy: user.id, reason })
        .onConflictDoNothing()
        .returning({ userId: chapterBans.userId });
      await tx.delete(follows).where(and(eq(follows.followerId, target.id), eq(follows.targetType, 'chapter'), eq(follows.targetId, chapter.id)));
      return rows.length > 0;
    });
    if (created) {
      await this.audit.record({ actorId: user.id, action: 'chapter.ban', targetType: 'user', targetId: target.id, after: { chapterId: chapter.id, reason }, ip });
      await this.events.emit({ type: 'chapter.banned', chapterId: chapter.id, userId: target.id, actorId: user.id });
    }
    return this.bans(user, chapter.id);
  }

  /** DELETE /chapters/{slug}/bans/{userId} — the member may join and post again. */
  async unban(user: AuthUser, slugOrId: string, userId: string, ip?: string): Promise<ChapterBan[]> {
    const chapter = await this.team(user, slugOrId);
    const removed = await this.db
      .delete(chapterBans)
      .where(and(eq(chapterBans.chapterId, chapter.id), eq(chapterBans.userId, userId)))
      .returning({ userId: chapterBans.userId });
    if (removed.length) {
      await this.audit.record({ actorId: user.id, action: 'chapter.unban', targetType: 'user', targetId: userId, after: { chapterId: chapter.id }, ip });
    }
    return this.bans(user, chapter.id);
  }

  /** POST /chapters/{slug}/fraud-reports — into the platform moderation queue, at high priority. */
  async reportFraud(ctx: AuthContext, slugOrId: string, input: ChapterFraudReportInput, ip?: string): Promise<CreateReportResponse> {
    const chapter = await this.team(ctx.user, slugOrId);
    if (input.targetType === 'post') {
      const [post] = await this.db.select({ chapterId: posts.chapterId }).from(posts).where(eq(posts.id, input.targetId)).limit(1);
      if (!post || post.chapterId !== chapter.id) throw Errors.notFound('That post');
    }
    const detail = `Reported by the ${chapter.name} team as suspected fraud. ${input.detail}`.slice(0, 1000);
    const report = await this.reports.create(ctx, { targetType: input.targetType, targetId: input.targetId, reason: 'scam', detail }, ip);
    // A chapter team's fraud report is looked at first, whatever the queue's usual order.
    await this.db.update(contentReports).set({ priority: 'high' }).where(eq(contentReports.id, report.id));
    await this.audit.record({
      actorId: ctx.user.id,
      action: 'chapter.fraud_report',
      targetType: input.targetType === 'post' ? 'post' : 'user',
      targetId: input.targetId,
      after: { chapterId: chapter.id, reportId: report.id },
      ip,
    });
    return report;
  }

  /* ----------------------------- Helpers ----------------------------- */

  /** The chapter, when the viewer is on its team; otherwise 404 or 403. */
  private async team(user: AuthUser, slugOrId: string): Promise<Chapter> {
    const key = slugOrId.toLowerCase();
    const [chapter] = await this.db
      .select({ id: chapters.id, slug: chapters.slug, name: chapters.name })
      .from(chapters)
      .where(isUuid(key) ? eq(chapters.id, key) : eq(chapters.slug, key))
      .limit(1);
    if (!chapter) throw Errors.notFound('That chapter');
    if (!(await this.rules.canModerate(user, chapter.id))) throw Errors.forbidden('Only this chapter’s team can moderate it');
    return chapter;
  }

  /** Moves a post from one status to another, recording who decided; refuses when someone else got there first. */
  private async settle(
    postId: string,
    from: 'in_review' | 'published',
    to: { status: 'in_review' | 'declined'; chapterReview: 'pending' | 'declined' },
    reviewerId: string,
    note: string | null,
  ) {
    const rows = await this.db
      .update(posts)
      .set({ ...to, chapterReviewBy: reviewerId, chapterReviewAt: new Date(), chapterReviewNote: note })
      .where(and(eq(posts.id, postId), eq(posts.status, from), isNull(posts.deletedAt)))
      .returning({ id: posts.id });
    if (!rows.length) throw Errors.conflict('Someone else has just dealt with this post. Refresh to see where it stands.');
  }
}
