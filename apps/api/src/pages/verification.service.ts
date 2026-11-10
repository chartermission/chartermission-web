import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  VERIFICATION_REAPPLY_DAYS,
  type AdminVerificationDecisionInput,
  type AdminVerificationQuery,
  type AdminVerificationRow,
  type Ok,
  type Page,
  type VerificationApplyInput,
  type VerificationCategory,
  type VerificationRequestStatus,
  type VerificationRequestView,
  type VerificationStatus,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { connections, contentReports, follows, memberProfiles, pages, posts, users, verificationRequests } from '../db/schema.js';
import type { AuthContext, AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { DAY_MS, isUniqueViolation, tsKey, uuidOr404 } from '../moderation/util.js';
import { PagesService, type PageRow } from './pages.service.js';

type RequestRow = typeof verificationRequests.$inferSelect;
type Requirement = VerificationStatus['requirements'][number];

function view(r: RequestRow): VerificationRequestView {
  return {
    id: r.id,
    subjectType: r.subjectType as 'member' | 'page',
    status: r.status as VerificationRequestStatus,
    category: r.category as VerificationCategory,
    legalName: r.legalName,
    statement: r.statement,
    links: r.links,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

/**
 * Applications for the verified tick. Members apply for themselves (Settings → Verification) and
 * page admins for a page; staff decide in the admin console. Approval sets verified_at; a decline
 * comes with a note, and the applicant can apply again after VERIFICATION_REAPPLY_DAYS.
 */
@Injectable()
export class VerificationService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly pagesService: PagesService,
    private readonly members: MembersService,
    private readonly pageRefs: PageRefsService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
  ) {}

  /* ------------------------------ Members and page admins ------------------------------ */

  /** GET /me/verification */
  async memberStatus(user: AuthUser): Promise<VerificationStatus> {
    const [row] = await this.db
      .select({
        verifiedAt: users.verifiedAt,
        isStaff: users.isStaff,
        avatarFileId: memberProfiles.avatarFileId,
        headline: memberProfiles.headline,
        bio: memberProfiles.bio,
        countryCode: memberProfiles.countryCode,
      })
      .from(users)
      .innerJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(eq(users.id, user.id))
      .limit(1);
    if (!row) throw Errors.notFound('Profile');
    const requirements: Requirement[] = [
      { key: 'email', label: 'Confirm your email address', met: user.emailVerified, href: null },
      { key: 'photo', label: 'Add a profile photo', met: !!row.avatarFileId, href: '/settings/profile' },
      { key: 'headline', label: 'Write your headline and About', met: !!row.headline?.trim() && !!row.bio?.trim(), href: '/settings/profile' },
      { key: 'country', label: 'Set your country', met: !!row.countryCode, href: '/settings/profile' },
    ];
    return this.status(!!row.verifiedAt || row.isStaff, requirements, await this.latest(and(eq(verificationRequests.subjectType, 'member'), eq(verificationRequests.userId, user.id))!));
  }

  /** GET /pages/{slug}/verification (page admins) */
  async pageStatus(user: AuthUser, slug: string): Promise<VerificationStatus> {
    const { row } = await this.pagesService.editableRow(user, slug);
    return this.status(!!row.verifiedAt, this.pageRequirements(row), await this.latest(eq(verificationRequests.pageId, row.id)));
  }

  private pageRequirements(row: PageRow): Requirement[] {
    const edit = `/pages/${row.slug}/edit`;
    return [
      { key: 'live', label: 'The page is live', met: row.status === 'active', href: null },
      { key: 'logo', label: 'Add the page’s logo', met: !!row.logoFileId, href: edit },
      { key: 'about', label: 'Write the About section', met: !!row.about?.trim(), href: edit },
      { key: 'website', label: 'Add the official website', met: !!row.website, href: edit },
    ];
  }

  private status(verified: boolean, requirements: Requirement[], request: RequestRow | null): VerificationStatus {
    const declinedAt = request?.status === 'declined' ? request.decidedAt : null;
    const canApplyAt = declinedAt ? new Date(declinedAt.getTime() + VERIFICATION_REAPPLY_DAYS * DAY_MS) : null;
    return {
      verified,
      requirements,
      eligible: requirements.every((r) => r.met),
      request: request ? view(request) : null,
      canApplyAt: canApplyAt && canApplyAt.getTime() > Date.now() ? canApplyAt.toISOString() : null,
    };
  }

  private async latest(where: SQL): Promise<RequestRow | null> {
    const [row] = await this.db.select().from(verificationRequests).where(where).orderBy(desc(verificationRequests.createdAt)).limit(1);
    return row ?? null;
  }

  /** POST /me/verification */
  async applyAsMember(user: AuthUser, input: VerificationApplyInput): Promise<VerificationStatus> {
    this.assertCanApply(await this.memberStatus(user));
    await this.insert({ subjectType: 'member', userId: user.id, pageId: null, ...input });
    return this.memberStatus(user);
  }

  /** POST /pages/{slug}/verification */
  async applyAsPage(user: AuthUser, slug: string, input: VerificationApplyInput): Promise<VerificationStatus> {
    const { row } = await this.pagesService.editableRow(user, slug);
    this.assertCanApply(await this.pageStatus(user, slug));
    await this.insert({ subjectType: 'page', userId: user.id, pageId: row.id, ...input });
    return this.pageStatus(user, slug);
  }

  private assertCanApply(status: VerificationStatus) {
    if (status.verified) throw Errors.conflict('Already verified');
    if (status.request?.status === 'pending') throw Errors.conflict('Your request is already being reviewed');
    if (status.canApplyAt) throw Errors.conflict(`You can apply again from ${status.canApplyAt.slice(0, 10)}`);
    if (!status.eligible) throw Errors.conflict('Finish the checklist first, then apply');
  }

  private async insert(values: typeof verificationRequests.$inferInsert) {
    try {
      await this.db.insert(verificationRequests).values({ ...values, links: [...new Set(values.links ?? [])] });
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('Your request is already being reviewed');
      throw err;
    }
  }

  /** DELETE /me/verification and DELETE /pages/{slug}/verification: withdraw a request that is still waiting. */
  async withdraw(user: AuthUser, slug?: string): Promise<Ok> {
    const subject = slug
      ? eq(verificationRequests.pageId, (await this.pagesService.editableRow(user, slug)).row.id)
      : and(eq(verificationRequests.subjectType, 'member'), eq(verificationRequests.userId, user.id));
    const removed = await this.db
      .delete(verificationRequests)
      .where(and(subject, eq(verificationRequests.status, 'pending')))
      .returning({ id: verificationRequests.id });
    if (!removed.length) throw Errors.notFound('A request waiting for review');
    return { ok: true };
  }

  /* ------------------------------------ Admin console ------------------------------------ */

  /** GET /admin/verification: oldest first while pending (first in, first reviewed), newest first otherwise. */
  async adminList(q: AdminVerificationQuery): Promise<Page<AdminVerificationRow>> {
    const cursor = decodeCursor<{ t: string; id: string }>(q.cursor);
    const pending = q.status === 'pending';
    const conds: (SQL | undefined)[] = [q.status === 'all' ? undefined : eq(verificationRequests.status, q.status)];
    if (cursor) {
      conds.push(
        pending
          ? sql`(${verificationRequests.createdAt}, ${verificationRequests.id}) > (${String(cursor.t)}::timestamptz, ${String(cursor.id)}::uuid)`
          : sql`(${verificationRequests.createdAt}, ${verificationRequests.id}) < (${String(cursor.t)}::timestamptz, ${String(cursor.id)}::uuid)`,
      );
    }
    const rows = await this.db
      .select({ r: verificationRequests, t: tsKey(verificationRequests.createdAt) })
      .from(verificationRequests)
      .where(and(...conds))
      .orderBy(...(pending ? [verificationRequests.createdAt, verificationRequests.id] : [desc(verificationRequests.createdAt), desc(verificationRequests.id)]))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.t, id: last.r.id }));
    return { items: await this.adminRows(page.items.map((x) => x.r)), nextCursor: page.nextCursor };
  }

  private async adminRows(list: RequestRow[]): Promise<AdminVerificationRow[]> {
    if (!list.length) return [];
    const userIds = [...new Set(list.map((r) => r.userId))];
    const deciderIds = [...new Set(list.map((r) => r.decidedBy).filter((x): x is string => !!x))];
    const pageIds = [...new Set(list.map((r) => r.pageId).filter((x): x is string => !!x))];
    const count = (q: SQL) => sql<number>`(${q})::int`;
    const [refs, pageMap, accounts, pageFacts] = await Promise.all([
      this.members.refs([...userIds, ...deciderIds]),
      this.pageRefs.refs(pageIds),
      this.db
        .select({
          id: users.id,
          email: users.email,
          joinedAt: users.createdAt,
          twoStep: users.mfaEnabledAt,
          followers: count(sql`select count(*) from ${follows} f where f.target_type = 'member' and f.target_id = ${users.id}::text`),
          connections: count(
            sql`select count(*) from ${connections} c where c.status = 'accepted' and (c.requester_id = ${users.id} or c.addressee_id = ${users.id})`,
          ),
          posts: count(sql`select count(*) from ${posts} p where p.author_id = ${users.id} and p.page_id is null and p.deleted_at is null`),
          openReports: count(
            sql`select count(*) from ${contentReports} cr where cr.status = 'open' and cr.target_user_id = ${users.id}`,
          ),
        })
        .from(users)
        .where(inArray(users.id, userIds)),
      pageIds.length
        ? this.db
            .select({
              id: pages.id,
              createdAt: pages.createdAt,
              followers: count(sql`select count(*) from ${follows} f where f.target_type = 'page' and f.target_id = ${pages.id}::text`),
              posts: count(sql`select count(*) from ${posts} p where p.page_id = ${pages.id} and p.deleted_at is null`),
            })
            .from(pages)
            .where(inArray(pages.id, pageIds))
        : [],
    ]);
    const accountOf = new Map(accounts.map((a) => [a.id, a]));
    const factsOf = new Map(pageFacts.map((p) => [p.id, p]));
    return list.flatMap((r) => {
      const applicant = refs.get(r.userId);
      const account = accountOf.get(r.userId);
      if (!applicant || !account) return [];
      const page = r.pageId ? pageMap.get(r.pageId) : undefined;
      const pf = r.pageId ? factsOf.get(r.pageId) : undefined;
      return [
        {
          ...view(r),
          applicant: { ...applicant, email: account.email },
          page: page ? PageRefsService.toRef(page) : null,
          facts: {
            joinedAt: (pf?.createdAt ?? account.joinedAt).toISOString(),
            followers: pf?.followers ?? account.followers,
            connections: account.connections,
            posts: pf?.posts ?? account.posts,
            twoStep: !!account.twoStep,
            openReports: account.openReports,
          },
          decidedBy: r.decidedBy ? (refs.get(r.decidedBy)?.name ?? null) : null,
        },
      ];
    });
  }

  /** POST /admin/verification/{id}/decision */
  async decide(ctx: AuthContext, rawId: string, input: AdminVerificationDecisionInput, ip?: string): Promise<AdminVerificationRow> {
    const id = uuidOr404(rawId, 'That request');
    const approved = input.decision === 'approve';
    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(verificationRequests)
        .set({ status: approved ? 'approved' : 'declined', decisionNote: input.note ?? null, decidedBy: ctx.user.id, decidedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(verificationRequests.id, id), eq(verificationRequests.status, 'pending')))
        .returning();
      if (!updated) return null;
      if (approved) {
        if (updated.pageId) await tx.update(pages).set({ verifiedAt: new Date(), updatedAt: new Date() }).where(eq(pages.id, updated.pageId));
        else await tx.update(users).set({ verifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, updated.userId));
      }
      return updated;
    });
    if (!row) {
      const [exists] = await this.db.select({ id: verificationRequests.id }).from(verificationRequests).where(eq(verificationRequests.id, id)).limit(1);
      if (!exists) throw Errors.notFound('That request');
      throw Errors.conflict('This request was already decided. Reload to see the outcome.');
    }
    await this.audit.record({
      actorId: ctx.user.id,
      action: approved ? 'verification.approved' : 'verification.declined',
      targetType: row.pageId ? 'page' : 'member',
      targetId: row.pageId ?? row.userId,
      after: { requestId: row.id, note: input.note ?? null },
      ip,
    });
    await this.events.emit({ type: 'verification.decided', requestId: row.id });
    return (await this.adminRows([row]))[0]!;
  }
}

