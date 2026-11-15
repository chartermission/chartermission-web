import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { EnquiriesQuery, EnquiryInput, EnquiryReplyInput, EnquiryView, MemberRef, Page } from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { pageAdmins, pageEnquiries, pageProducts, services, users } from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService } from '../core/members.service.js';
import { RelationsService } from '../core/relations.service.js';
import { AuditService } from '../infra/audit.service.js';
import { QueueService } from '../infra/queue.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, paginate } from '../common/cursor.js';
import { tsKey } from '../moderation/util.js';
import { isUuid } from '../media/uuid-param.js';
import { assertNotRestricted } from '../posts/posts.service.js';
import { MessagesService } from '../messages/messages.service.js';
import { ACTIVE } from '../messages/message-views.js';
import { pageRef, PagesService, type PageRow } from './pages.service.js';

type EnquiryRow = typeof pageEnquiries.$inferSelect;

/** Enquiries one member can send in a day, across all pages. */
export const ENQUIRIES_PER_DAY = 10;
/** Unanswered enquiries one member can have with the same page. */
export const ENQUIRIES_OPEN_PER_PAGE = 3;
/** Job on the events queue that tells the page's admins (handled in PagesEvents). */
export const ENQUIRY_CREATED_JOB = 'page-enquiry-created';

const NONE = '00000000-0000-0000-0000-000000000000';
const FALLBACK_MEMBER: MemberRef = {
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

/**
 * Enquiries (contracts/services.ts): verified members write to a live page, optionally about one of
 * its products or services. The page's admins are told, see them under the page's enquiries and
 * reply in Messages (a direct chat from the admin, open straight away since the member asked).
 */
@Injectable()
export class PageEnquiriesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly pages: PagesService,
    private readonly members: MembersService,
    private readonly relations: RelationsService,
    private readonly messages: MessagesService,
    private readonly limits: RateLimitService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  /** POST /pages/{slug}/enquiries */
  async create(user: AuthUser, slug: string, input: EnquiryInput): Promise<EnquiryView> {
    assertNotRestricted(user);
    const { row, role } = await this.pages.visibleRow(user, slug);
    if (role) throw Errors.forbidden('You manage this page, so you can’t send it an enquiry.');
    if (row.status !== 'active') throw Errors.conflict('This page isn’t taking enquiries right now.');
    const adminIds = await this.adminIds(row.id);
    for (const adminId of adminIds) {
      if (await this.relations.isBlockedEitherWay(user.id, adminId)) throw Errors.forbidden('You can’t send this page an enquiry.');
    }
    if (input.about) {
      const title = await this.aboutTitle(row.id, input.about.type, input.about.id, true);
      if (!title) throw Errors.validation({ about: 'Choose a product or service from this page' });
    }
    const [open] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(pageEnquiries)
      .where(and(eq(pageEnquiries.pageId, row.id), eq(pageEnquiries.fromId, user.id), eq(pageEnquiries.status, 'new')));
    if ((open?.n ?? 0) >= ENQUIRIES_OPEN_PER_PAGE) {
      throw Errors.conflict(`You have ${ENQUIRIES_OPEN_PER_PAGE} enquiries waiting for this page to reply. Wait for an answer before sending another.`);
    }
    await this.limits.consume(`page-enquiries:${user.id}`, ENQUIRIES_PER_DAY, 24 * 3600, `You can send ${ENQUIRIES_PER_DAY} enquiries a day. Try again tomorrow.`);
    const [created] = await this.db
      .insert(pageEnquiries)
      .values({ pageId: row.id, fromId: user.id, aboutType: input.about?.type ?? null, aboutId: input.about?.id ?? null, message: input.message })
      .returning();
    await this.queue.add('events', ENQUIRY_CREATED_JOB, { enquiryId: created!.id });
    return (await this.views(row, [created!]))[0]!;
  }

  /** GET /pages/{slug}/enquiries: newest first. */
  async list(user: AuthUser, slug: string, q: EnquiriesQuery): Promise<Page<EnquiryView>> {
    const row = await this.managedPage(user, slug);
    const cursor = decodeCursor<{ t: string; id: string }>(q.cursor);
    const conds: (SQL | undefined)[] = [eq(pageEnquiries.pageId, row.id)];
    if (q.status !== 'all') conds.push(eq(pageEnquiries.status, q.status));
    if (cursor) conds.push(sql`(${pageEnquiries.createdAt}, ${pageEnquiries.id}) < (${String(cursor.t)}::timestamptz, ${String(cursor.id)}::uuid)`);
    const rows = await this.db
      .select({ e: pageEnquiries, t: tsKey(pageEnquiries.createdAt) })
      .from(pageEnquiries)
      .where(and(...conds))
      .orderBy(desc(pageEnquiries.createdAt), desc(pageEnquiries.id))
      .limit(q.limit + 1);
    const page = paginate(rows, q.limit, (last) => ({ t: last.t, id: last.e.id }));
    return { items: await this.views(row, page.items.map((r) => r.e)), nextCursor: page.nextCursor };
  }

  /** POST /pages/{slug}/enquiries/{id}/reply: a direct message from the admin to the member who asked. */
  async reply(user: AuthUser, slug: string, enquiryId: string, input: EnquiryReplyInput, ip?: string): Promise<EnquiryView> {
    const row = await this.managedPage(user, slug);
    const enquiry = await this.enquiry(row.id, enquiryId);
    if (enquiry.status === 'closed') throw Errors.conflict('This enquiry is closed.');
    const [from] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, enquiry.fromId)).limit(1);
    if (!from || !ACTIVE.includes(from.status)) throw Errors.conflict('This account is no longer active.');
    const { conversationId } = await this.messages.replyToEnquiry(user, enquiry.fromId, input.message);
    const [updated] = await this.db
      .update(pageEnquiries)
      .set({ status: 'replied', repliedBy: user.id, repliedAt: new Date(), conversationId, updatedAt: new Date() })
      .where(eq(pageEnquiries.id, enquiry.id))
      .returning();
    await this.audit.record({ actorId: user.id, action: 'page.enquiry_replied', targetType: 'page', targetId: row.id, after: { enquiryId: enquiry.id, conversationId }, ip });
    return (await this.views(row, [updated!]))[0]!;
  }

  /** POST /pages/{slug}/enquiries/{id}/close */
  async close(user: AuthUser, slug: string, enquiryId: string, ip?: string): Promise<EnquiryView> {
    const row = await this.managedPage(user, slug);
    const enquiry = await this.enquiry(row.id, enquiryId);
    const [updated] = await this.db
      .update(pageEnquiries)
      .set({ status: 'closed', updatedAt: new Date() })
      .where(and(eq(pageEnquiries.id, enquiry.id), inArray(pageEnquiries.status, ['new', 'replied'])))
      .returning();
    if (!updated) throw Errors.conflict('This enquiry is already closed.');
    await this.audit.record({ actorId: user.id, action: 'page.enquiry_closed', targetType: 'page', targetId: row.id, after: { enquiryId: enquiry.id }, ip });
    return (await this.views(row, [updated]))[0]!;
  }

  /** The title of a product or service of this page, or null if it isn't one (or, with `activeOnly`, is hidden). */
  async aboutTitle(pageId: string, type: string, id: string, activeOnly: boolean): Promise<string | null> {
    if (!isUuid(id)) return null;
    if (type === 'product') {
      const [p] = await this.db
        .select({ name: pageProducts.name })
        .from(pageProducts)
        .where(and(eq(pageProducts.id, id), eq(pageProducts.pageId, pageId), activeOnly ? eq(pageProducts.active, true) : undefined))
        .limit(1);
      return p?.name ?? null;
    }
    if (type === 'service') {
      const [sv] = await this.db
        .select({ title: services.title })
        .from(services)
        .where(and(eq(services.id, id), eq(services.hostPageId, pageId), isNull(services.deletedAt), activeOnly ? eq(services.active, true) : undefined))
        .limit(1);
      return sv?.title ?? null;
    }
    return null;
  }

  async adminIds(pageId: string): Promise<string[]> {
    const rows = await this.db.select({ userId: pageAdmins.userId }).from(pageAdmins).where(eq(pageAdmins.pageId, pageId));
    return rows.map((r) => r.userId);
  }

  /** Enquiries are private to the page's own admins (staff without a role on the page don't see them). */
  private async managedPage(user: AuthUser, slug: string): Promise<PageRow> {
    const { row, role } = await this.pages.visibleRow(user, slug);
    if (!role) throw Errors.forbidden('Only the page’s admins can do that');
    return row;
  }

  private async enquiry(pageId: string, enquiryId: string): Promise<EnquiryRow> {
    if (!isUuid(enquiryId)) throw Errors.notFound('That enquiry');
    const [found] = await this.db
      .select()
      .from(pageEnquiries)
      .where(and(eq(pageEnquiries.id, enquiryId), eq(pageEnquiries.pageId, pageId)))
      .limit(1);
    if (!found) throw Errors.notFound('That enquiry');
    return found;
  }

  private async views(page: PageRow, rows: EnquiryRow[]): Promise<EnquiryView[]> {
    if (!rows.length) return [];
    const productIds = rows.filter((r) => r.aboutType === 'product' && r.aboutId).map((r) => r.aboutId!);
    const serviceIds = rows.filter((r) => r.aboutType === 'service' && r.aboutId).map((r) => r.aboutId!);
    const [refs, productRows, serviceRows] = await Promise.all([
      this.members.refs(rows.flatMap((r) => [r.fromId, ...(r.repliedBy ? [r.repliedBy] : [])])),
      productIds.length ? this.db.select({ id: pageProducts.id, title: pageProducts.name }).from(pageProducts).where(inArray(pageProducts.id, productIds)) : [],
      serviceIds.length ? this.db.select({ id: services.id, title: services.title }).from(services).where(inArray(services.id, serviceIds)) : [],
    ]);
    const titles = new Map([...productRows, ...serviceRows].map((x) => [x.id, x.title]));
    const ref = pageRef(page);
    return rows.map((r) => {
      const title = r.aboutId ? titles.get(r.aboutId) : undefined;
      return {
        id: r.id,
        page: ref,
        from: refs.get(r.fromId) ?? FALLBACK_MEMBER,
        // A product or service removed since is left out.
        about: r.aboutType && r.aboutId && title !== undefined ? { type: r.aboutType as 'product' | 'service', id: r.aboutId, title } : null,
        message: r.message,
        status: r.status as EnquiryView['status'],
        conversationId: r.conversationId,
        repliedBy: r.repliedBy ? (refs.get(r.repliedBy) ?? FALLBACK_MEMBER) : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}
