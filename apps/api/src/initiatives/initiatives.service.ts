import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  InitiativeInput,
  type ChapterRef,
  type DecideJoinRequestInput,
  type InitiativeDetail,
  type InitiativeHost,
  type InitiativeHostOptions,
  type InitiativeInputParsed,
  type InitiativeJoinRequestView,
  type InitiativeMilestoneView,
  type InitiativeStatus,
  type InitiativeSummary,
  type InitiativeTeamMember,
  type InitiativesQuery,
  type JoinInitiativeInput,
  type MemberRef,
  type Ok,
  type Page,
  type UpdateInitiativeInput,
  type UpdateTeamMemberInput,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import {
  chapters,
  countries,
  files,
  follows,
  initiativeJoinRequests,
  initiativeMembers,
  initiativeMilestones,
  initiativeRoles,
  initiatives,
  memberProfiles,
  opportunities,
  pages,
  posts,
  sectors,
  users,
} from '../db/schema.js';
import type { AuthUser } from '../core/auth-context.js';
import { MembersService, mediaUrl } from '../core/members.service.js';
import { PageRefsService } from '../core/page-refs.service.js';
import { RelationsService } from '../core/relations.service.js';
import { AuditService } from '../infra/audit.service.js';
import { EventsService } from '../infra/events.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { Errors } from '../common/errors.js';
import { decodeCursor, encodeCursor } from '../common/cursor.js';
import { isUuid } from '../media/uuid-param.js';
import { escapeLike, slugify } from '../events/event-util.js';
import { EventAccess } from '../events/event-access.js';
import { assertNotRestricted } from '../posts/posts.service.js';
import { InitiativeAccess, type InitiativeRow, type InitiativeViewer } from './initiative-access.service.js';

/** Leads who can't be shown (their initiatives drop out of lists). */
const HIDDEN_LEAD = ['deleted', 'deletion_pending', 'deactivated', 'suspended'];
const CREATES_PER_DAY = 5;
const JOIN_REQUESTS_PER_DAY = 20;
const TEAM_LIMIT = 300;
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

type MilestoneRow = typeof initiativeMilestones.$inferSelect;

/** Milestone states: done ones, then the first not done is current, the rest upcoming. */
export function milestoneViews(rows: MilestoneRow[]): InitiativeMilestoneView[] {
  let currentSeen = false;
  return rows.map((m) => {
    let state: InitiativeMilestoneView['state'] = 'done';
    if (!m.doneAt) {
      state = currentSeen ? 'upcoming' : 'current';
      currentSeen = true;
    }
    return { id: m.id, title: m.title, note: m.note, targetDate: m.targetDate, doneAt: m.doneAt?.toISOString() ?? null, state };
  });
}

/**
 * Initiatives (contracts/initiatives.ts): projects hosted by a member, an organisation page or a
 * chapter. Live when created; members ask to join (organisers accept or decline), follow them and
 * read their updates (posts with initiative_id). Moderators hide or remove them from reports.
 */
@Injectable()
export class InitiativesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: InitiativeAccess,
    private readonly members: MembersService,
    private readonly pageRefs: PageRefsService,
    private readonly relations: RelationsService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
    private readonly events: EventsService,
    private readonly eventAccess: EventAccess,
  ) {}

  /* ------------------------------ Browse ------------------------------ */

  /** GET /initiatives — live initiatives, most recently updated first; offset cursor. */
  async list(user: AuthUser, q: InitiativesQuery): Promise<Page<InitiativeSummary>> {
    const blocked = await this.relations.blockedSet(user.id);
    const where: (SQL | undefined)[] = [
      isNull(initiatives.deletedAt),
      eq(initiatives.moderationState, 'visible'),
      ne(initiatives.status, 'archived'),
      notInArray(users.status, HIDDEN_LEAD),
      blocked.size ? notInArray(initiatives.leadId, [...blocked]) : undefined,
    ];
    if (q.status) where.push(eq(initiatives.status, q.status));
    if (q.country) where.push(eq(initiatives.countryCode, q.country));
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      where.push(or(ilike(initiatives.title, like), ilike(initiatives.summary, like)));
    }
    if (q.theme) {
      const [sector] = await this.db.select({ id: sectors.id }).from(sectors).where(isUuid(q.theme) ? eq(sectors.id, q.theme) : eq(sectors.slug, q.theme)).limit(1);
      if (!sector) return { items: [], nextCursor: null };
      where.push(eq(initiatives.sectorId, sector.id));
    }
    if (q.scope === 'mine') {
      where.push(
        or(
          sql`exists (select 1 from ${initiativeMembers} im where im.initiative_id = ${initiatives.id} and im.user_id = ${user.id})`,
          sql`exists (select 1 from ${follows} f where f.follower_id = ${user.id} and f.target_type = 'initiative' and f.target_id = ${initiatives.id}::text)`,
        ),
      );
    }
    if (q.page) {
      const ref = await this.pageId(q.page);
      if (!ref) return { items: [], nextCursor: null };
      where.push(eq(initiatives.hostPageId, ref));
    }
    if (q.chapter) {
      const [chapter] = await this.db
        .select({ id: chapters.id })
        .from(chapters)
        .where(isUuid(q.chapter) ? eq(chapters.id, q.chapter) : eq(chapters.slug, q.chapter.toLowerCase()))
        .limit(1);
      if (!chapter) return { items: [], nextCursor: null };
      where.push(eq(initiatives.hostChapterId, chapter.id));
    }
    const offset = Number(decodeCursor<{ o: number }>(q.cursor)?.o ?? 0) || 0;
    const rows = await this.db
      .select({ i: initiatives })
      .from(initiatives)
      .innerJoin(users, eq(users.id, initiatives.leadId))
      .where(and(...where))
      .orderBy(desc(initiatives.updatedAt), desc(initiatives.id))
      .limit(q.limit + 1)
      .offset(offset);
    const more = rows.length > q.limit;
    const page = rows.slice(0, q.limit).map((r) => r.i);
    const v = await this.access.viewer(user, page.map((r) => r.id));
    return { items: await this.summaries(v, page), nextCursor: more ? encodeCursor({ o: offset + q.limit }) : null };
  }

  /** GET /initiatives/host-options */
  async hostOptions(user: AuthUser): Promise<InitiativeHostOptions> {
    const [pageIds, chapterIds] = await Promise.all([this.pageRefs.managedIds(user.id), this.eventAccess.ledChapters(user.id)]);
    const pageMap = await this.pageRefs.refs(pageIds);
    const chapterRows = chapterIds.size
      ? await this.db
          .select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode })
          .from(chapters)
          .where(inArray(chapters.id, [...chapterIds]))
          .orderBy(asc(chapters.name))
      : [];
    return {
      pages: [...pageMap.values()].filter((p) => p.status === 'active').map((p) => PageRefsService.toRef(p)).sort((a, b) => a.name.localeCompare(b.name)),
      chapters: chapterRows,
    };
  }

  /** GET /initiatives/:idOrSlug */
  async detail(user: AuthUser, idOrSlug: string): Promise<InitiativeDetail> {
    const { row, v } = await this.visibleRow(user, idOrSlug);
    return this.toDetail(v, row);
  }

  /* ------------------------------ Write ------------------------------ */

  /** POST /initiatives — live straight away, with the creator as its lead and first organiser. */
  async create(user: AuthUser, raw: InitiativeInput, ip?: string): Promise<InitiativeDetail> {
    assertNotRestricted(user);
    const input = InitiativeInput.parse(raw);
    await this.checkCommon(user.id, input);
    const host = input.host;
    if (host.type === 'page') {
      const [page] = [...(await this.pageRefs.refs([host.pageId])).values()];
      if (!page || page.status !== 'active' || !(await this.pageRefs.role(user.id, host.pageId))) {
        throw Errors.validation({ host: 'Choose a live page you manage' });
      }
    }
    if (host.type === 'chapter' && !(await this.eventAccess.ledChapters(user.id)).has(host.chapterId)) {
      throw Errors.validation({ host: 'Choose a chapter you lead' });
    }
    await this.limits.consume(`initiatives:${user.id}`, CREATES_PER_DAY, 24 * 3600, `You can start ${CREATES_PER_DAY} initiatives a day.`);
    const slug = await this.freeSlug(input.title);
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(initiatives)
        .values({
          slug,
          title: input.title,
          summary: input.summary,
          description: input.description,
          sectorId: input.themeId,
          countryCode: input.countryCode,
          status: input.status,
          hostType: host.type,
          hostPageId: host.type === 'page' ? host.pageId : null,
          hostChapterId: host.type === 'chapter' ? host.chapterId : null,
          leadId: user.id,
          coverFileId: input.coverFileId,
        })
        .returning();
      await tx.insert(initiativeMembers).values({ initiativeId: created!.id, userId: user.id, role: 'Initiative lead', organiser: true });
      await this.writeRoles(tx, created!.id, input.roles);
      await this.writeMilestones(tx, created!.id, input.milestones);
      return created!;
    });
    await this.audit.record({ actorId: user.id, action: 'initiative.create', targetType: 'initiative', targetId: row.id, ip });
    return this.toDetail(await this.access.viewer(user, [row.id]), row);
  }

  /** PATCH /initiatives/:id — organisers. Roles and milestones replace the lists (ids keep existing ones). */
  async update(user: AuthUser, id: string, input: UpdateInitiativeInput, ip?: string): Promise<InitiativeDetail> {
    const { row, v } = await this.managedRow(user, id);
    if (row.status === 'archived') throw Errors.conflict('This initiative is archived');
    await this.checkCommon(user.id, input, row);
    await this.db.transaction(async (tx) => {
      await tx
        .update(initiatives)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.themeId !== undefined ? { sectorId: input.themeId } : {}),
          ...(input.countryCode !== undefined ? { countryCode: input.countryCode } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.coverFileId !== undefined ? { coverFileId: input.coverFileId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(initiatives.id, row.id));
      if (input.roles) await this.writeRoles(tx, row.id, input.roles);
      if (input.milestones) await this.writeMilestones(tx, row.id, input.milestones);
    });
    await this.audit.record({ actorId: user.id, action: 'initiative.update', targetType: 'initiative', targetId: row.id, ip });
    const [fresh] = await this.db.select().from(initiatives).where(eq(initiatives.id, row.id));
    return this.toDetail(v, fresh!);
  }

  /** DELETE /initiatives/:id — the lead or the host's admins. Archived: gone from lists and pages, updates stay posts. */
  async remove(user: AuthUser, id: string, ip?: string): Promise<Ok> {
    const { row, v } = await this.managedRow(user, id);
    if (!this.access.canDelete(row, v)) throw Errors.forbidden('Only the lead or the host can delete this initiative');
    await this.db.update(initiatives).set({ deletedAt: new Date(), status: 'archived', updatedAt: new Date() }).where(eq(initiatives.id, row.id));
    await this.db
      .update(initiativeJoinRequests)
      .set({ status: 'withdrawn', updatedAt: new Date() })
      .where(and(eq(initiativeJoinRequests.initiativeId, row.id), eq(initiativeJoinRequests.status, 'pending')));
    await this.audit.record({ actorId: user.id, action: 'initiative.delete', targetType: 'initiative', targetId: row.id, ip });
    return { ok: true };
  }

  /** PUT / DELETE /initiatives/:id/follow */
  async follow(user: AuthUser, id: string, on: boolean): Promise<Ok> {
    const { row } = await this.visibleRow(user, id);
    if (on) {
      const added = await this.db
        .insert(follows)
        .values({ followerId: user.id, targetType: 'initiative', targetId: row.id })
        .onConflictDoNothing()
        .returning({ id: follows.targetId });
      if (added.length) await this.db.update(initiatives).set({ followerCount: sql`${initiatives.followerCount} + 1` }).where(eq(initiatives.id, row.id));
    } else {
      const gone = await this.db
        .delete(follows)
        .where(and(eq(follows.followerId, user.id), eq(follows.targetType, 'initiative'), eq(follows.targetId, row.id)))
        .returning({ id: follows.targetId });
      if (gone.length) {
        await this.db.update(initiatives).set({ followerCount: sql`greatest(${initiatives.followerCount} - 1, 0)` }).where(eq(initiatives.id, row.id));
      }
    }
    return { ok: true };
  }

  /* ------------------------------ Joining ------------------------------ */

  /** POST /initiatives/:id/join-requests — while it is recruiting; one pending request at a time. */
  async join(user: AuthUser, id: string, input: JoinInitiativeInput): Promise<InitiativeDetail> {
    assertNotRestricted(user);
    const { row, v } = await this.visibleRow(user, id);
    if (row.moderationState !== 'visible') throw Errors.conflict('This initiative isn’t taking requests right now');
    if (row.status !== 'recruiting') throw Errors.conflict('This initiative isn’t taking requests right now');
    if (await this.isMember(row.id, user.id)) throw Errors.conflict('You’re already on this team');
    if (input.roleId) {
      const [role] = await this.db
        .select({ id: initiativeRoles.id })
        .from(initiativeRoles)
        .where(and(eq(initiativeRoles.id, input.roleId), eq(initiativeRoles.initiativeId, row.id), eq(initiativeRoles.open, true)))
        .limit(1);
      if (!role) throw Errors.validation({ roleId: 'Choose one of the open roles' });
    }
    await this.limits.consume(`initiative-join:${user.id}`, JOIN_REQUESTS_PER_DAY, 24 * 3600);
    let requestId: string;
    try {
      const [created] = await this.db
        .insert(initiativeJoinRequests)
        .values({ initiativeId: row.id, userId: user.id, roleId: input.roleId, skills: input.skills, note: input.note })
        .returning({ id: initiativeJoinRequests.id });
      requestId = created!.id;
    } catch (err) {
      if ((err as { code?: string; cause?: { code?: string } })?.code === '23505' || (err as { cause?: { code?: string } })?.cause?.code === '23505') {
        throw Errors.conflict('You’ve already asked to join. The organisers will reply soon.');
      }
      throw err;
    }
    await this.events.emit({ type: 'initiative.join_requested', requestId });
    return this.toDetail(v, row);
  }

  /** DELETE /initiatives/:id/join-requests/me */
  async withdraw(user: AuthUser, id: string): Promise<InitiativeDetail> {
    const { row, v } = await this.visibleRow(user, id);
    const done = await this.db
      .update(initiativeJoinRequests)
      .set({ status: 'withdrawn', updatedAt: new Date() })
      .where(and(eq(initiativeJoinRequests.initiativeId, row.id), eq(initiativeJoinRequests.userId, user.id), eq(initiativeJoinRequests.status, 'pending')))
      .returning({ id: initiativeJoinRequests.id });
    if (!done.length) throw Errors.conflict('There is no request to withdraw');
    return this.toDetail(v, row);
  }

  /** GET /initiatives/:id/join-requests — organisers: pending first, then the latest answered. */
  async requests(user: AuthUser, id: string): Promise<InitiativeJoinRequestView[]> {
    const { row } = await this.managedRow(user, id);
    const rows = await this.db
      .select({ r: initiativeJoinRequests, roleTitle: initiativeRoles.title })
      .from(initiativeJoinRequests)
      .leftJoin(initiativeRoles, eq(initiativeRoles.id, initiativeJoinRequests.roleId))
      .where(and(eq(initiativeJoinRequests.initiativeId, row.id), ne(initiativeJoinRequests.status, 'withdrawn')))
      .orderBy(sql`(${initiativeJoinRequests.status} = 'pending') desc`, desc(initiativeJoinRequests.createdAt))
      .limit(200);
    const refs = await this.members.refs(rows.map((r) => r.r.userId));
    return rows
      .filter((r) => refs.has(r.r.userId))
      .map((r) => this.requestView(r.r, refs.get(r.r.userId)!, r.roleTitle));
  }

  /** POST /initiatives/:id/join-requests/:rid/decision — accepting adds the member to the team. */
  async decide(user: AuthUser, id: string, requestId: string, input: DecideJoinRequestInput): Promise<InitiativeJoinRequestView> {
    const { row } = await this.managedRow(user, id);
    if (!isUuid(requestId)) throw Errors.notFound('That request');
    const [found] = await this.db
      .select({ r: initiativeJoinRequests, roleTitle: initiativeRoles.title })
      .from(initiativeJoinRequests)
      .leftJoin(initiativeRoles, eq(initiativeRoles.id, initiativeJoinRequests.roleId))
      .where(and(eq(initiativeJoinRequests.id, requestId), eq(initiativeJoinRequests.initiativeId, row.id)))
      .limit(1);
    if (!found) throw Errors.notFound('That request');
    if (found.r.status !== 'pending') throw Errors.conflict('This request has already been answered');
    const status = input.decision === 'accept' ? 'accepted' : 'declined';
    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      const [r] = await tx
        .update(initiativeJoinRequests)
        .set({ status, message: input.message, decidedBy: user.id, decidedAt: now, updatedAt: now })
        .where(and(eq(initiativeJoinRequests.id, found.r.id), eq(initiativeJoinRequests.status, 'pending')))
        .returning();
      if (!r) throw Errors.conflict('This request has already been answered');
      if (status === 'accepted') {
        await tx
          .insert(initiativeMembers)
          .values({ initiativeId: row.id, userId: r.userId, role: found.roleTitle ?? null })
          .onConflictDoNothing();
        await tx.update(initiatives).set({ updatedAt: now }).where(eq(initiatives.id, row.id));
      }
      return r;
    });
    await this.events.emit({ type: 'initiative.join_decided', requestId: updated.id });
    const ref = (await this.members.ref(updated.userId)) ?? FALLBACK_MEMBER;
    return this.requestView(updated, ref, found.roleTitle);
  }

  /* ------------------------------ Team ------------------------------ */

  /** PATCH /initiatives/:id/team/:userId — organisers set what someone does, and who organises. */
  async updateMember(user: AuthUser, id: string, userId: string, input: UpdateTeamMemberInput): Promise<InitiativeDetail> {
    const { row, v } = await this.managedRow(user, id);
    if (!isUuid(userId) || !(await this.isMember(row.id, userId))) throw Errors.notFound('That team member');
    if (input.organiser === false && userId === row.leadId) throw Errors.conflict('The lead always organises the initiative');
    await this.db
      .update(initiativeMembers)
      .set({
        ...(input.role !== undefined ? { role: input.role?.trim() || null } : {}),
        ...(input.organiser !== undefined ? { organiser: input.organiser } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(initiativeMembers.initiativeId, row.id), eq(initiativeMembers.userId, userId)));
    return this.toDetail(await this.access.viewer(user, [row.id]), row);
  }

  /** DELETE /initiatives/:id/team/:userId — organisers remove someone; members leave. The lead stays. */
  async removeMember(user: AuthUser, id: string, userId: string): Promise<InitiativeDetail> {
    const leaving = userId === user.id;
    const { row } = leaving ? await this.visibleRow(user, id) : await this.managedRow(user, id);
    if (!isUuid(userId) || !(await this.isMember(row.id, userId))) throw Errors.notFound('That team member');
    if (userId === row.leadId) throw Errors.conflict(leaving ? 'The lead can’t leave. Delete the initiative instead.' : 'The lead can’t be removed');
    await this.db.delete(initiativeMembers).where(and(eq(initiativeMembers.initiativeId, row.id), eq(initiativeMembers.userId, userId)));
    return this.toDetail(await this.access.viewer(user, [row.id]), row);
  }

  /* ------------------------------ Internals ------------------------------ */

  private async pageId(idOrSlug: string): Promise<string | null> {
    const [page] = await this.db
      .select({ id: pages.id })
      .from(pages)
      .where(isUuid(idOrSlug) ? eq(pages.id, idOrSlug.toLowerCase()) : sql`lower(${pages.slug}) = ${idOrSlug.toLowerCase()}`)
      .limit(1);
    return page?.id ?? null;
  }

  private async findRow(idOrSlug: string): Promise<InitiativeRow | undefined> {
    const key = idOrSlug.toLowerCase();
    if (!isUuid(key) && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(key)) return undefined;
    const [row] = await this.db
      .select()
      .from(initiatives)
      .where(isUuid(key) ? eq(initiatives.id, key) : eq(initiatives.slug, key))
      .limit(1);
    return row;
  }

  /** The initiative if the viewer may see it, else NOT_FOUND (blocked leads and hidden leads too). */
  private async visibleRow(user: AuthUser, idOrSlug: string): Promise<{ row: InitiativeRow; v: InitiativeViewer }> {
    const row = await this.findRow(idOrSlug);
    if (!row) throw Errors.notFound('That initiative');
    const v = await this.access.viewer(user, [row.id]);
    if (!this.access.canSee(row, v)) throw Errors.notFound('That initiative');
    if (!this.access.canManage(row, v) && !v.moderator) {
      const [lead] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, row.leadId)).limit(1);
      if (!lead || HIDDEN_LEAD.includes(lead.status)) throw Errors.notFound('That initiative');
      if (await this.relations.isBlockedEitherWay(user.id, row.leadId)) throw Errors.notFound('That initiative');
    }
    return { row, v };
  }

  /** The initiative if the viewer organises it; NOT_FOUND if they can't see it, FORBIDDEN otherwise. */
  private async managedRow(user: AuthUser, idOrSlug: string): Promise<{ row: InitiativeRow; v: InitiativeViewer }> {
    const found = await this.visibleRow(user, idOrSlug);
    if (!this.access.canManage(found.row, found.v)) throw Errors.forbidden('Only the initiative’s organisers can do that');
    return found;
  }

  private async isMember(initiativeId: string, userId: string): Promise<boolean> {
    const [m] = await this.db
      .select({ id: initiativeMembers.userId })
      .from(initiativeMembers)
      .where(and(eq(initiativeMembers.initiativeId, initiativeId), eq(initiativeMembers.userId, userId)))
      .limit(1);
    return !!m;
  }

  /** "farm-to-port-lagos", or "farm-to-port-lagos-2" when taken. */
  private async freeSlug(title: string): Promise<string> {
    const base = slugify(title).slice(0, 80).replace(/-$/, '') || 'initiative';
    const taken = new Set(
      (
        await this.db
          .select({ slug: initiatives.slug })
          .from(initiatives)
          .where(or(eq(initiatives.slug, base), ilike(initiatives.slug, `${escapeLike(base)}-%`)))
      ).map((r) => r.slug),
    );
    if (!taken.has(base)) return base;
    for (let n = 2; n < 50; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
    return `${base}-${randomBytes(3).toString('hex')}`;
  }

  /** Theme, country and cover checks shared by create and update. */
  private async checkCommon(userId: string, input: Partial<Pick<InitiativeInputParsed, 'themeId' | 'countryCode' | 'coverFileId'>>, existing?: InitiativeRow) {
    if (input.themeId) {
      const [sector] = await this.db.select({ id: sectors.id }).from(sectors).where(eq(sectors.id, input.themeId)).limit(1);
      if (!sector) throw Errors.validation({ themeId: 'Choose a theme from the list' });
    }
    if (input.countryCode) {
      const [country] = await this.db.select({ code: countries.code }).from(countries).where(eq(countries.code, input.countryCode)).limit(1);
      if (!country) throw Errors.validation({ countryCode: 'Choose a country from the list' });
    }
    if (input.coverFileId && input.coverFileId !== existing?.coverFileId) {
      const [file] = await this.db
        .select({ ownerId: files.ownerId, purpose: files.purpose, scanStatus: files.scanStatus })
        .from(files)
        .where(eq(files.id, input.coverFileId))
        .limit(1);
      if (!file || file.ownerId !== userId || file.purpose !== 'initiative_cover' || file.scanStatus !== 'clean') {
        throw Errors.validation({ coverFileId: 'Upload the cover picture again' });
      }
    }
  }

  private async writeRoles(tx: Tx, initiativeId: string, roles: InitiativeInputParsed['roles']) {
    const existing = await tx.select({ id: initiativeRoles.id }).from(initiativeRoles).where(eq(initiativeRoles.initiativeId, initiativeId));
    const known = new Set(existing.map((r) => r.id));
    const kept = new Set<string>();
    for (const [position, role] of roles.entries()) {
      const values = { title: role.title, description: role.description, skills: role.skills, open: role.open, position, updatedAt: new Date() };
      if (role.id && known.has(role.id)) {
        kept.add(role.id);
        await tx.update(initiativeRoles).set(values).where(eq(initiativeRoles.id, role.id));
      } else {
        await tx.insert(initiativeRoles).values({ ...values, initiativeId });
      }
    }
    const gone = [...known].filter((id) => !kept.has(id));
    if (gone.length) await tx.delete(initiativeRoles).where(inArray(initiativeRoles.id, gone));
  }

  private async writeMilestones(tx: Tx, initiativeId: string, milestones: InitiativeInputParsed['milestones']) {
    const existing = await tx
      .select({ id: initiativeMilestones.id, doneAt: initiativeMilestones.doneAt })
      .from(initiativeMilestones)
      .where(eq(initiativeMilestones.initiativeId, initiativeId));
    const known = new Map(existing.map((m) => [m.id, m]));
    const kept = new Set<string>();
    for (const [position, m] of milestones.entries()) {
      const prior = m.id ? known.get(m.id) : undefined;
      const values = {
        title: m.title,
        note: m.note,
        targetDate: m.targetDate,
        doneAt: m.done ? (prior?.doneAt ?? new Date()) : null,
        position,
        updatedAt: new Date(),
      };
      if (prior) {
        kept.add(prior.id);
        await tx.update(initiativeMilestones).set(values).where(eq(initiativeMilestones.id, prior.id));
      } else {
        await tx.insert(initiativeMilestones).values({ ...values, initiativeId });
      }
    }
    const gone = [...known.keys()].filter((id) => !kept.has(id));
    if (gone.length) await tx.delete(initiativeMilestones).where(inArray(initiativeMilestones.id, gone));
  }

  private requestView(r: typeof initiativeJoinRequests.$inferSelect, member: MemberRef, roleTitle: string | null): InitiativeJoinRequestView {
    return {
      id: r.id,
      member,
      role: r.roleId && roleTitle ? { id: r.roleId, title: roleTitle } : null,
      skills: r.skills,
      note: r.note,
      status: r.status as InitiativeJoinRequestView['status'],
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    };
  }

  /** Cards in bulk: one query per related table. */
  async summaries(v: InitiativeViewer, rows: InitiativeRow[]): Promise<InitiativeSummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const sectorIds = [...new Set(rows.map((r) => r.sectorId).filter((x): x is string => !!x))];
    const codes = [...new Set(rows.map((r) => r.countryCode).filter((x): x is string => !!x))];
    const chapterIds = [...new Set(rows.map((r) => r.hostChapterId).filter((x): x is string => !!x))];
    const coverIds = [...new Set(rows.map((r) => r.coverFileId).filter((x): x is string => !!x))];
    const [sectorRows, countryRows, leads, pageMap, chapterRows, milestoneRows, teamCounts, openRoles, followRows, memberRows, requestRows, covers] =
      await Promise.all([
        sectorIds.length ? this.db.select({ id: sectors.id, slug: sectors.slug, name: sectors.name }).from(sectors).where(inArray(sectors.id, sectorIds)) : [],
        codes.length ? this.db.select({ code: countries.code, name: countries.name }).from(countries).where(inArray(countries.code, codes)) : [],
        this.members.refs(rows.map((r) => r.leadId)),
        this.pageRefs.refs(rows.map((r) => r.hostPageId).filter((x): x is string => !!x)),
        chapterIds.length
          ? this.db.select({ id: chapters.id, slug: chapters.slug, name: chapters.name, countryCode: chapters.countryCode }).from(chapters).where(inArray(chapters.id, chapterIds))
          : ([] as ChapterRef[]),
        this.db
          .select()
          .from(initiativeMilestones)
          .where(inArray(initiativeMilestones.initiativeId, ids))
          .orderBy(asc(initiativeMilestones.position), asc(initiativeMilestones.createdAt)),
        this.db
          .select({ id: initiativeMembers.initiativeId, n: count() })
          .from(initiativeMembers)
          .where(inArray(initiativeMembers.initiativeId, ids))
          .groupBy(initiativeMembers.initiativeId),
        this.db
          .select({ id: initiativeRoles.id, initiativeId: initiativeRoles.initiativeId, title: initiativeRoles.title })
          .from(initiativeRoles)
          .where(and(inArray(initiativeRoles.initiativeId, ids), eq(initiativeRoles.open, true)))
          .orderBy(asc(initiativeRoles.position)),
        this.db
          .select({ id: follows.targetId })
          .from(follows)
          .where(and(eq(follows.followerId, v.user.id), eq(follows.targetType, 'initiative'), inArray(follows.targetId, ids))),
        this.db
          .select({ id: initiativeMembers.initiativeId })
          .from(initiativeMembers)
          .where(and(eq(initiativeMembers.userId, v.user.id), inArray(initiativeMembers.initiativeId, ids))),
        this.db
          .select({ id: initiativeJoinRequests.id, initiativeId: initiativeJoinRequests.initiativeId, status: initiativeJoinRequests.status, roleId: initiativeJoinRequests.roleId })
          .from(initiativeJoinRequests)
          .where(and(eq(initiativeJoinRequests.userId, v.user.id), inArray(initiativeJoinRequests.initiativeId, ids)))
          .orderBy(desc(initiativeJoinRequests.createdAt)),
        coverIds.length ? this.db.select({ id: files.id }).from(files).where(and(inArray(files.id, coverIds), eq(files.scanStatus, 'clean'))) : [],
      ]);
    const sectorMap = new Map(sectorRows.map((s) => [s.id, s]));
    const countryMap = new Map(countryRows.map((c) => [c.code, c.name]));
    const chapterMap = new Map(chapterRows.map((c) => [c.id, c]));
    const teamMap = new Map(teamCounts.map((t) => [t.id, t.n]));
    const followed = new Set(followRows.map((f) => f.id));
    const memberOf = new Set(memberRows.map((m) => m.id));
    const cleanCovers = new Set(covers.map((c) => c.id));
    const latestRequest = new Map<string, (typeof requestRows)[number]>();
    for (const r of requestRows) if (!latestRequest.has(r.initiativeId)) latestRequest.set(r.initiativeId, r);

    return rows.map((row) => {
      const lead = leads.get(row.leadId) ?? FALLBACK_MEMBER;
      const ms = milestoneViews(milestoneRows.filter((m) => m.initiativeId === row.id));
      const done = ms.filter((m) => m.state === 'done').length;
      const request = latestRequest.get(row.id);
      const canManage = this.access.canManage(row, v);
      const summary: InitiativeSummary = {
        id: row.id,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        theme: row.sectorId ? (sectorMap.get(row.sectorId) ?? null) : null,
        status: row.status as InitiativeStatus,
        country: row.countryCode ? { code: row.countryCode, name: countryMap.get(row.countryCode) ?? row.countryCode } : null,
        host: this.host(row, lead, pageMap, chapterMap),
        lead,
        coverUrl: row.coverFileId && cleanCovers.has(row.coverFileId) ? mediaUrl(row.coverFileId) : null,
        milestones: { done, total: ms.length, current: ms.find((m) => m.state === 'current')?.title ?? null },
        percent: ms.length ? Math.round((done / ms.length) * 100) : 0,
        teamCount: teamMap.get(row.id) ?? 0,
        followerCount: row.followerCount,
        openRoles: openRoles.filter((r) => r.initiativeId === row.id).map((r) => ({ id: r.id, title: r.title })),
        viewer: {
          following: followed.has(row.id),
          member: memberOf.has(row.id),
          canManage,
          canDelete: this.access.canDelete(row, v),
          request: request ? { id: request.id, status: request.status as 'pending', roleId: request.roleId } : null,
        },
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
      if (row.moderationState !== 'visible' && (canManage || v.moderator)) summary.moderationState = row.moderationState as 'hidden' | 'removed';
      return summary;
    });
  }

  private host(
    row: InitiativeRow,
    lead: MemberRef,
    pageMap: Map<string, Parameters<typeof PageRefsService.toRef>[0]>,
    chapterMap: Map<string, ChapterRef>,
  ): InitiativeHost {
    if (row.hostType === 'page' && row.hostPageId) {
      const page = pageMap.get(row.hostPageId);
      if (page) return { type: 'page', page: PageRefsService.toRef(page) };
    }
    if (row.hostType === 'chapter' && row.hostChapterId) {
      const chapter = chapterMap.get(row.hostChapterId);
      if (chapter) return { type: 'chapter', chapter };
    }
    return { type: 'member', member: lead };
  }

  private async toDetail(v: InitiativeViewer, row: InitiativeRow): Promise<InitiativeDetail> {
    const [summary] = await this.summaries(v, [row]);
    const canManage = summary!.viewer.canManage;
    const [roleRows, milestoneRows, teamRows, updates, pending] = await Promise.all([
      this.db
        .select()
        .from(initiativeRoles)
        .where(and(eq(initiativeRoles.initiativeId, row.id), canManage ? undefined : eq(initiativeRoles.open, true)))
        .orderBy(asc(initiativeRoles.position), asc(initiativeRoles.createdAt)),
      this.db
        .select()
        .from(initiativeMilestones)
        .where(eq(initiativeMilestones.initiativeId, row.id))
        .orderBy(asc(initiativeMilestones.position), asc(initiativeMilestones.createdAt)),
      this.db
        .select({ m: initiativeMembers, country: memberProfiles.countryCode })
        .from(initiativeMembers)
        .leftJoin(memberProfiles, eq(memberProfiles.userId, initiativeMembers.userId))
        .where(eq(initiativeMembers.initiativeId, row.id))
        .orderBy(asc(initiativeMembers.createdAt))
        .limit(TEAM_LIMIT),
      this.db
        .select({ n: count() })
        .from(posts)
        .where(and(eq(posts.initiativeId, row.id), isNull(posts.deletedAt), eq(posts.status, 'published'), eq(posts.moderationState, 'visible'))),
      canManage
        ? this.db
            .select({ n: count() })
            .from(initiativeJoinRequests)
            .where(and(eq(initiativeJoinRequests.initiativeId, row.id), eq(initiativeJoinRequests.status, 'pending')))
        : Promise.resolve([{ n: 0 }]),
    ]);
    const refs = await this.members.refs(teamRows.map((t) => t.m.userId));
    const team: InitiativeTeamMember[] = teamRows
      .filter((t) => refs.has(t.m.userId))
      .map((t) => ({
        member: refs.get(t.m.userId)!,
        role: t.m.role,
        organiser: t.m.organiser || t.m.userId === row.leadId,
        lead: t.m.userId === row.leadId,
        joinedAt: t.m.createdAt.toISOString(),
      }))
      .sort((a, b) => Number(b.lead) - Number(a.lead) || Number(b.organiser) - Number(a.organiser) || a.joinedAt.localeCompare(b.joinedAt));
    const organiserIds = team.filter((t) => t.organiser).map((t) => t.member.id);
    const related = organiserIds.length
      ? await this.db
          .select({ slug: opportunities.slug, title: opportunities.title, organisation: opportunities.organisation, type: opportunities.type })
          .from(opportunities)
          .where(
            and(
              inArray(opportunities.posterId, organiserIds),
              eq(opportunities.status, 'open'),
              eq(opportunities.moderationState, 'visible'),
              isNull(opportunities.deletedAt),
            ),
          )
          .orderBy(desc(opportunities.createdAt))
          .limit(3)
      : [];
    return {
      ...summary!,
      description: row.description,
      roles: roleRows.map((r) => ({ id: r.id, title: r.title, description: r.description, skills: r.skills, open: r.open })),
      milestoneList: milestoneViews(milestoneRows),
      team,
      countryCount: new Set(teamRows.map((t) => t.country).filter(Boolean)).size,
      updatesCount: updates[0]?.n ?? 0,
      pendingRequests: pending[0]?.n ?? 0,
      related,
    };
  }
}
