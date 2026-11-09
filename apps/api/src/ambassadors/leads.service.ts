import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  type AmbassadorStepKey,
  LEAD_CLOSED_STAGES,
  LEAD_OPEN_STAGES,
  LEAD_RUBRIC,
  LEAD_STAGE_LABELS,
  LeadStage,
  AMBASSADOR_STEPS,
  type AdminLeadDetail,
  type AdminLeadSummary,
  type AdminLeadsPage,
  type AdminLeadsQuery,
  type CertifyLeadInput,
  type EndTermInput,
  type CountryRef,
  type CreateLeadInput,
  type LeadActivity,
  type LeadActivityKind,
  type LeadNoteInput,
  type LeadScores,
  type MoveLeadStageInput,
  type AmbassadorChecklist,
  type PersonRef,
  type TrainingProgressInput,
  type UpdateLeadInput,
  type UpdateOnboardingStepInput,
} from '@chartermission/contracts';
import type { z } from 'zod';
import type {
  EndTermInput as EndTermSchema,
  CertifyLeadInput as CertifyLeadSchema,
  CreateLeadInput as CreateLeadSchema,
  MoveLeadStageInput as MoveLeadStageSchema,
  UpdateLeadInput as UpdateLeadSchema,
  UpdateOnboardingStepInput as UpdateOnboardingStepSchema,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import type { Tx } from '../db/client.js';
import {
  ambassadorLeadActivities,
  ambassadorLeads,
  ambassadorOnboardingSteps,
  ambassadorTrainingProgress,
  chapters,
  countries,
  courses,
  memberProfiles,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthContext } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { SettingsService } from '../infra/settings.service.js';
import { isUniqueViolation } from '../moderation/util.js';
import { AmbassadorMailer } from './ambassador-mail.js';
import { assertCovers, scopeFor, type AmbassadorScope } from './ambassador-scope.js';

type LeadRow = typeof ambassadorLeads.$inferSelect;
type CreateLead = z.output<typeof CreateLeadSchema>;
type UpdateLead = z.output<typeof UpdateLeadSchema>;
type MoveStage = z.output<typeof MoveLeadStageSchema>;
type Certify = z.output<typeof CertifyLeadSchema>;
type StepUpdate = z.output<typeof UpdateOnboardingStepSchema>;
type EndTerm = z.output<typeof EndTermSchema>;

const MAX_LIST = 500;
const ACTIVITY_LIMIT = 100;
const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const DONE = ['done', 'waived'];

/** Fields a manager can edit, with the label used in the activity timeline. */
const FIELD_LABELS: Partial<Record<keyof UpdateLead, string>> = {
  fullName: 'name',
  email: 'email',
  phone: 'phone',
  countryCode: 'country',
  city: 'city',
  organisation: 'organisation',
  jobTitle: 'job title',
  linkedinUrl: 'LinkedIn',
  source: 'source',
  referredBy: 'referred by',
  hoursPerWeek: 'hours per week',
  motivation: 'motivation',
  notes: 'notes',
  ownerId: 'owner',
};

export function scoreTotal(scores: LeadScores): number | null {
  const values = LEAD_RUBRIC.map((r) => scores[r.key]).filter((v): v is number => typeof v === 'number');
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

/**
 * Ambassador leads (admin console): capture, the qualification pipeline, onboarding and
 * certification. Every read and write is limited to the viewer's countries (ambassador-scope.ts).
 */
@Injectable()
export class LeadsService {
  private readonly log = new Logger('Ambassadors');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly mail: AmbassadorMailer,
  ) {}

  /* ----------------------------- Reads ----------------------------- */

  /** GET /admin/ambassadors/leads */
  async list(ctx: AuthContext, rawQ: AdminLeadsQuery): Promise<AdminLeadsPage> {
    const q = rawQ as { stage: LeadStage | 'open' | 'closed' | 'all'; country?: string; q?: string; owner?: string };
    const scope = await scopeFor(this.db, ctx.user);
    const countryList = await this.countriesFor(scope);
    const base: (SQL | undefined)[] = [];
    if (!scope.all) {
      if (scope.countries.length === 0) return { items: [], counts: emptyCounts(), countries: countryList, truncated: false };
      base.push(inArray(ambassadorLeads.countryCode, scope.countries));
    }
    if (q.country) base.push(eq(ambassadorLeads.countryCode, q.country));
    if (q.q) {
      const pat = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      base.push(
        or(
          ilike(ambassadorLeads.fullName, pat),
          ilike(ambassadorLeads.email, pat),
          ilike(ambassadorLeads.organisation, pat),
          ilike(ambassadorLeads.city, pat),
        ),
      );
    }
    if (q.owner) base.push(eq(ambassadorLeads.ownerId, q.owner === 'me' ? ctx.user.id : q.owner));

    const stageFilter =
      q.stage === 'open'
        ? inArray(ambassadorLeads.stage, [...LEAD_OPEN_STAGES])
        : q.stage === 'closed'
          ? inArray(ambassadorLeads.stage, [...LEAD_CLOSED_STAGES])
          : q.stage === 'all'
            ? undefined
            : eq(ambassadorLeads.stage, q.stage);

    const [rows, countRows] = await Promise.all([
      this.db
        .select()
        .from(ambassadorLeads)
        .where(and(...base, stageFilter))
        .orderBy(desc(ambassadorLeads.updatedAt), desc(ambassadorLeads.id))
        .limit(MAX_LIST + 1),
      this.db
        .select({ stage: ambassadorLeads.stage, n: sql<number>`count(*)::int` })
        .from(ambassadorLeads)
        .where(and(...base))
        .groupBy(ambassadorLeads.stage),
    ]);
    const counts = emptyCounts();
    for (const r of countRows) if (r.stage in counts) counts[r.stage as LeadStage] = r.n;
    const truncated = rows.length > MAX_LIST;
    return { items: await this.summaries(rows.slice(0, MAX_LIST)), counts, countries: countryList, truncated };
  }

  /** GET /admin/ambassadors/leads/:id */
  async detail(ctx: AuthContext, id: string): Promise<AdminLeadDetail> {
    const scope = await scopeFor(this.db, ctx.user);
    const lead = await this.load(id, scope);
    return this.toDetail(await this.relinkAccount(lead));
  }

  /* ----------------------------- Writes ----------------------------- */

  /** POST /admin/ambassadors/leads */
  async create(ctx: AuthContext, rawInput: CreateLeadInput, ip?: string): Promise<AdminLeadDetail> {
    const input = rawInput as CreateLead;
    const scope = await scopeFor(this.db, ctx.user);
    assertCovers(scope, input.countryCode, 'country');
    await this.assertCountry(input.countryCode);
    const ownerId = input.ownerId ?? ctx.user.id;
    if (input.ownerId) await this.assertTeamMember(input.ownerId);
    const userId = await this.accountFor(input.email);
    let row: LeadRow;
    try {
      row = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(ambassadorLeads)
          .values({
            fullName: input.fullName,
            email: input.email,
            phone: input.phone ?? null,
            countryCode: input.countryCode,
            city: input.city ?? null,
            organisation: input.organisation ?? null,
            jobTitle: input.jobTitle ?? null,
            linkedinUrl: input.linkedinUrl ?? null,
            source: input.source,
            referredBy: input.referredBy ?? null,
            hoursPerWeek: input.hoursPerWeek ?? null,
            motivation: input.motivation ?? null,
            notes: input.notes ?? null,
            ownerId,
            userId,
            createdBy: ctx.user.id,
          })
          .returning();
        await this.activity(tx, created!.id, ctx.user.id, 'created', `Lead added (${sourceLabel(input.source)})`);
        return created!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const [existing] = await this.db
          .select({ id: ambassadorLeads.id, countryCode: ambassadorLeads.countryCode })
          .from(ambassadorLeads)
          .where(sql`lower(${ambassadorLeads.email}) = ${input.email}`)
          .limit(1);
        throw Errors.conflict(
          existing && (scope.all || scope.countries.includes(existing.countryCode))
            ? `A lead with this email already exists (id ${existing.id}). Open it and move it back into the pipeline instead.`
            : 'A lead with this email already exists in another country. Ask a Platform Admin to move it.',
        );
      }
      throw err;
    }
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.lead.create', targetType: 'ambassador_lead', targetId: row.id, after: { country: row.countryCode, source: row.source }, ip });
    return this.toDetail(row);
  }

  /** PATCH /admin/ambassadors/leads/:id — details, owner and rubric scores. */
  async update(ctx: AuthContext, id: string, rawInput: UpdateLeadInput, ip?: string): Promise<AdminLeadDetail> {
    const input = rawInput as UpdateLead;
    const scope = await scopeFor(this.db, ctx.user);
    const lead = await this.load(id, scope);
    if (input.countryCode && input.countryCode !== lead.countryCode) {
      assertCovers(scope, input.countryCode, 'country');
      await this.assertCountry(input.countryCode);
    }
    if (input.ownerId) await this.assertTeamMember(input.ownerId);

    const patch: Partial<typeof ambassadorLeads.$inferInsert> = {};
    const changed: string[] = [];
    for (const key of Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]) {
      if (!(key in input) || input[key] === undefined) continue;
      const next = (input[key] ?? null) as never;
      if ((lead as Record<string, unknown>)[key] === next) continue;
      (patch as Record<string, unknown>)[key] = next;
      changed.push(FIELD_LABELS[key]!);
    }
    if (patch.email) patch.userId = await this.accountFor(patch.email);
    let scoreNote: string | null = null;
    if (input.scores) {
      const merged = { ...(lead.scores as LeadScores), ...input.scores } as LeadScores;
      const total = scoreTotal(merged);
      if (JSON.stringify(merged) !== JSON.stringify(lead.scores)) {
        patch.scores = merged as Record<string, number | null>;
        patch.scoreTotal = total;
        scoreNote = total === null ? 'Scores cleared' : `Scores updated: ${total}/100`;
      }
    }
    if (!changed.length && !scoreNote) return this.detail(ctx, id);

    try {
      await this.db.transaction(async (tx) => {
        await tx.update(ambassadorLeads).set(patch).where(eq(ambassadorLeads.id, id));
        if (changed.length) await this.activity(tx, id, ctx.user.id, 'updated', `Updated ${changed.join(', ')}`);
        if (scoreNote) await this.activity(tx, id, ctx.user.id, 'scores', scoreNote, { scores: patch.scores });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.validation({ email: 'Another lead already uses this email' });
      throw err;
    }
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.lead.update', targetType: 'ambassador_lead', targetId: id, after: { fields: changed, scoreTotal: patch.scoreTotal }, ip });
    return this.detail(ctx, id);
  }

  /** POST /admin/ambassadors/leads/:id/stage — entering "onboarding" starts the checklist and emails the lead. */
  async moveStage(ctx: AuthContext, id: string, rawInput: MoveLeadStageInput, ip?: string): Promise<AdminLeadDetail> {
    const input = rawInput as MoveStage;
    const scope = await scopeFor(this.db, ctx.user);
    const lead = await this.relinkAccount(await this.load(id, scope));
    if (lead.stage === input.stage) return this.toDetail(lead);
    if (lead.stage === 'ambassador') throw Errors.conflict('This lead is a certified Ambassador. End their term before moving them.');

    const startsOnboarding = input.stage === 'onboarding' && !lead.onboardingStartedAt;
    await this.db.transaction(async (tx) => {
      await tx
        .update(ambassadorLeads)
        .set({ stage: input.stage, stageChangedAt: new Date(), ...(startsOnboarding ? { onboardingStartedAt: new Date() } : {}) })
        .where(eq(ambassadorLeads.id, id));
      const body = `Moved from ${LEAD_STAGE_LABELS[lead.stage as LeadStage]} to ${LEAD_STAGE_LABELS[input.stage]}${input.note ? `: ${input.note}` : ''}`;
      await this.activity(tx, id, ctx.user.id, 'stage', body, { from: lead.stage, to: input.stage });
      if (startsOnboarding) await this.createSteps(tx, id, lead.userId, ctx.user.id);
    });
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.lead.stage', targetType: 'ambassador_lead', targetId: id, before: { stage: lead.stage }, after: { stage: input.stage }, ip });
    if (startsOnboarding) await this.sendInvite(ctx, id);
    return this.detail(ctx, id);
  }

  /** POST /admin/ambassadors/leads/:id/notes */
  async addNote(ctx: AuthContext, id: string, input: LeadNoteInput): Promise<AdminLeadDetail> {
    const scope = await scopeFor(this.db, ctx.user);
    await this.load(id, scope);
    await this.db.transaction(async (tx) => {
      await this.activity(tx, id, ctx.user.id, 'note', input.body.trim());
      await tx.update(ambassadorLeads).set({ updatedAt: new Date() }).where(eq(ambassadorLeads.id, id));
    });
    return this.detail(ctx, id);
  }

  /** PATCH /admin/ambassadors/leads/:id/onboarding/:step */
  async updateStep(ctx: AuthContext, id: string, step: AmbassadorStepKey, rawInput: UpdateOnboardingStepInput, ip?: string): Promise<AdminLeadDetail> {
    const input = rawInput as StepUpdate;
    const scope = await scopeFor(this.db, ctx.user);
    const lead = await this.relinkAccount(await this.load(id, scope));
    if (!lead.onboardingStartedAt) throw Errors.conflict('Move the lead to Onboarding first');
    if (lead.stage === 'ambassador') throw Errors.conflict('Onboarding is finished: this lead is already certified');
    if (step === 'account' && input.status === 'done' && !lead.userId) {
      throw Errors.badRequest('No member account uses this email yet. Ask them to sign up with it, or change the lead’s email.');
    }
    const label = AMBASSADOR_STEPS.find((s) => s.key === step)!.label;
    const done = input.status !== 'pending';
    await this.db.transaction(async (tx) => {
      await tx
        .insert(ambassadorOnboardingSteps)
        .values({ leadId: id, step, status: input.status, note: input.note ?? null, completedAt: done ? new Date() : null, completedBy: done ? ctx.user.id : null })
        .onConflictDoUpdate({
          target: [ambassadorOnboardingSteps.leadId, ambassadorOnboardingSteps.step],
          set: { status: input.status, note: input.note ?? null, completedAt: done ? new Date() : null, completedBy: done ? ctx.user.id : null, updatedAt: new Date() },
        });
      const verb = input.status === 'done' ? 'Ticked' : input.status === 'waived' ? 'Waived' : 'Reopened';
      await this.activity(tx, id, ctx.user.id, 'onboarding', `${verb} “${label}”${input.note ? `: ${input.note}` : ''}`);
      await tx.update(ambassadorLeads).set({ updatedAt: new Date() }).where(eq(ambassadorLeads.id, id));
    });
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.onboarding.step', targetType: 'ambassador_lead', targetId: id, after: { step, status: input.status }, ip });
    return this.detail(ctx, id);
  }

  /** PUT /admin/ambassadors/leads/:id/training/:courseId — tick or untick a required course. */
  async setTraining(ctx: AuthContext, id: string, courseId: string, input: TrainingProgressInput): Promise<AdminLeadDetail> {
    const scope = await scopeFor(this.db, ctx.user);
    const lead = await this.load(id, scope);
    if (!lead.onboardingStartedAt) throw Errors.conflict('Move the lead to Onboarding first');
    const required = (await this.settings.get('ambassador_training')).courseIds;
    if (!required.includes(courseId)) throw Errors.notFound('That required course');
    const [course] = await this.db.select({ title: courses.title }).from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!course) throw Errors.notFound('That course');

    await this.db.transaction(async (tx) => {
      if (input.completed) {
        await tx.insert(ambassadorTrainingProgress).values({ leadId: id, courseId, markedBy: ctx.user.id }).onConflictDoNothing();
      } else {
        await tx.delete(ambassadorTrainingProgress).where(and(eq(ambassadorTrainingProgress.leadId, id), eq(ambassadorTrainingProgress.courseId, courseId)));
      }
      await this.activity(tx, id, ctx.user.id, 'training', `${input.completed ? 'Completed' : 'Unmarked'} course “${course.title}”`);

      // The training step follows the courses unless a manager waived it.
      const doneRows = await tx
        .select({ courseId: ambassadorTrainingProgress.courseId })
        .from(ambassadorTrainingProgress)
        .where(and(eq(ambassadorTrainingProgress.leadId, id), inArray(ambassadorTrainingProgress.courseId, required)));
      const allDone = doneRows.length === required.length;
      const [stepRow] = await tx
        .select({ status: ambassadorOnboardingSteps.status })
        .from(ambassadorOnboardingSteps)
        .where(and(eq(ambassadorOnboardingSteps.leadId, id), eq(ambassadorOnboardingSteps.step, 'training')));
      if (stepRow?.status !== 'waived') {
        const status = allDone ? 'done' : 'pending';
        if (stepRow?.status !== status) {
          await tx
            .update(ambassadorOnboardingSteps)
            .set({ status, completedAt: allDone ? new Date() : null, completedBy: allDone ? ctx.user.id : null })
            .where(and(eq(ambassadorOnboardingSteps.leadId, id), eq(ambassadorOnboardingSteps.step, 'training')));
        }
      }
      await tx.update(ambassadorLeads).set({ updatedAt: new Date() }).where(eq(ambassadorLeads.id, id));
    });
    return this.detail(ctx, id);
  }

  /** POST /admin/ambassadors/leads/:id/invite — resend the onboarding email. */
  async resendInvite(ctx: AuthContext, id: string): Promise<AdminLeadDetail> {
    const scope = await scopeFor(this.db, ctx.user);
    const lead = await this.relinkAccount(await this.load(id, scope));
    if (!lead.onboardingStartedAt || lead.stage !== 'onboarding') throw Errors.conflict('Only leads in Onboarding get the onboarding email');
    await this.sendInvite(ctx, id);
    return this.detail(ctx, id);
  }

  /**
   * POST /admin/ambassadors/leads/:id/certify — every step done or waived and a linked member
   * account: grants the "ambassador" role for the country's chapter (the profile badge).
   */
  async certify(ctx: AuthContext, id: string, rawInput: CertifyLeadInput, ip?: string): Promise<AdminLeadDetail> {
    const input = rawInput as Certify;
    const scope = await scopeFor(this.db, ctx.user);
    const lead = await this.relinkAccount(await this.load(id, scope));
    if (lead.stage !== 'onboarding') throw Errors.conflict('Only leads in Onboarding can be certified');
    if (!lead.userId) throw Errors.conflict('This lead has no member account yet. They need to sign up with the same email first.');
    const steps = await this.db.select().from(ambassadorOnboardingSteps).where(eq(ambassadorOnboardingSteps.leadId, id));
    const open = AMBASSADOR_STEPS.filter((s) => !DONE.includes(steps.find((r) => r.step === s.key)?.status ?? 'pending'));
    if (open.length) throw Errors.conflict(`Finish or waive these onboarding steps first: ${open.map((s) => s.label).join(', ')}`);

    const chapter = await this.chapterFor(lead.countryCode);
    const [role] = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'ambassador')).limit(1);
    if (!role) throw new Error('The "ambassador" role is missing; run the database migrations');
    const scopeType = chapter ? 'chapter' : 'country';
    const scopeId = chapter ? chapter.id : lead.countryCode;
    const userId = lead.userId;

    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: userRoles.id })
        .from(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, role.id), eq(userRoles.scopeType, scopeType), eq(userRoles.scopeId, scopeId)))
        .limit(1);
      if (existing) {
        await tx.update(userRoles).set({ revokedAt: null, grantedBy: ctx.user.id, grantedAt: new Date() }).where(eq(userRoles.id, existing.id));
      } else {
        await tx.insert(userRoles).values({ userId, roleId: role.id, scopeType, scopeId, grantedBy: ctx.user.id });
      }
      await tx
        .update(ambassadorLeads)
        .set({ stage: 'ambassador', stageChangedAt: new Date(), certifiedAt: new Date(), founding: input.founding })
        .where(eq(ambassadorLeads.id, id));
      const title = input.founding ? 'Founding Ambassador' : 'Ambassador';
      await this.activity(tx, id, ctx.user.id, 'certified', `Certified as ${title}${chapter ? ` for ${chapter.name}` : ''}${input.note ? `: ${input.note}` : ''}`);
    });
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.certify', targetType: 'user', targetId: userId, after: { leadId: id, scopeType, scopeId, founding: input.founding }, ip });

    const country = await this.countryName(lead.countryCode);
    await this.mail
      .certified({ email: lead.email, userId }, { name: lead.fullName, country, founding: input.founding })
      .catch((err: unknown) => this.log.warn(`Certification email to lead ${id} failed: ${String(err)}`));
    return this.detail(ctx, id);
  }

  /**
   * POST /admin/ambassadors/leads/:id/end-term — revokes the "ambassador" role. In good standing
   * the lead becomes Alumni (grey badge); "removed" makes it Withdrawn with no badge.
   */
  async endTerm(ctx: AuthContext, id: string, rawInput: EndTermInput, ip?: string): Promise<AdminLeadDetail> {
    const input = rawInput as EndTerm;
    const scope = await scopeFor(this.db, ctx.user);
    const lead = await this.load(id, scope);
    if (lead.stage !== 'ambassador') throw Errors.conflict('Only a serving Ambassador’s term can be ended');
    const stage = input.outcome === 'alumni' ? 'alumni' : 'withdrawn';
    const [role] = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.key, 'ambassador')).limit(1);
    await this.db.transaction(async (tx) => {
      if (role && lead.userId) {
        await tx
          .update(userRoles)
          .set({ revokedAt: new Date() })
          .where(and(eq(userRoles.userId, lead.userId), eq(userRoles.roleId, role.id), isNull(userRoles.revokedAt)));
      }
      await tx.update(ambassadorLeads).set({ stage, stageChangedAt: new Date() }).where(eq(ambassadorLeads.id, id));
      const body = input.outcome === 'alumni' ? 'Term ended in good standing: now an Alumni Ambassador' : 'Removed as Ambassador; the badge was taken off their profile';
      await this.activity(tx, id, ctx.user.id, 'term_ended', `${body}${input.note ? `: ${input.note}` : ''}`, { outcome: input.outcome });
    });
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.end_term', targetType: 'user', targetId: lead.userId ?? undefined, after: { leadId: id, outcome: input.outcome }, ip });
    return this.detail(ctx, id);
  }

  /* ----------------------------- Helpers ----------------------------- */

  private async load(id: string, scope: AmbassadorScope): Promise<LeadRow> {
    const [lead] = await this.db.select().from(ambassadorLeads).where(eq(ambassadorLeads.id, id)).limit(1);
    if (!lead) throw Errors.notFound('That lead');
    assertCovers(scope, lead.countryCode);
    return lead;
  }

  /** Links the member account with the lead's email (and ticks the "account" step) once it exists. */
  async relinkAccount(lead: LeadRow): Promise<LeadRow> {
    if (lead.userId) return lead;
    const userId = await this.accountFor(lead.email);
    if (!userId) return lead;
    await this.db.transaction(async (tx) => {
      await tx.update(ambassadorLeads).set({ userId }).where(eq(ambassadorLeads.id, lead.id));
      if (lead.onboardingStartedAt) {
        await tx
          .update(ambassadorOnboardingSteps)
          .set({ status: 'done', completedAt: new Date(), completedBy: null })
          .where(and(eq(ambassadorOnboardingSteps.leadId, lead.id), eq(ambassadorOnboardingSteps.step, 'account'), eq(ambassadorOnboardingSteps.status, 'pending')));
      }
    });
    return { ...lead, userId };
  }

  async accountFor(email: string): Promise<string | null> {
    const [u] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = ${email.toLowerCase()}`, ne(users.status, 'deleted')))
      .limit(1);
    return u?.id ?? null;
  }

  private async createSteps(tx: Tx, leadId: string, userId: string | null, actorId: string) {
    const required = (await this.settings.get('ambassador_training')).courseIds;
    await tx
      .insert(ambassadorOnboardingSteps)
      .values(
        AMBASSADOR_STEPS.map((s) => {
          const auto = (s.key === 'account' && !!userId) || (s.key === 'training' && required.length === 0);
          return {
            leadId,
            step: s.key,
            status: auto ? (s.key === 'training' ? 'waived' : 'done') : 'pending',
            note: s.key === 'training' && required.length === 0 ? 'No required courses were set when onboarding started' : null,
            completedAt: auto ? new Date() : null,
            completedBy: auto ? actorId : null,
          };
        }),
      )
      .onConflictDoNothing();
  }

  private async sendInvite(ctx: AuthContext, id: string) {
    const [lead] = await this.db.select().from(ambassadorLeads).where(eq(ambassadorLeads.id, id)).limit(1);
    if (!lead) return;
    const country = await this.countryName(lead.countryCode);
    const training = await this.requiredCourses();
    try {
      await this.mail.onboardingInvite(
        { email: lead.email, userId: lead.userId },
        { name: lead.fullName, country, hasAccount: !!lead.userId, courses: training.map((c) => ({ title: c.title, url: c.startUrl })) },
      );
    } catch (err) {
      this.log.warn(`Onboarding email to lead ${id} failed: ${String(err)}`);
      throw Errors.conflict('The onboarding email could not be sent. Try “Resend invitation” in a minute.');
    }
    await this.db.transaction(async (tx) => {
      await tx.update(ambassadorLeads).set({ invitedAt: new Date() }).where(eq(ambassadorLeads.id, id));
      await this.activity(tx, id, ctx.user.id, 'invite', `Onboarding email sent to ${lead.email}`);
    });
  }

  private async activity(tx: Tx, leadId: string, actorId: string | null, kind: LeadActivityKind, body: string, data?: unknown) {
    await tx.insert(ambassadorLeadActivities).values({ leadId, actorId, kind, body, data: data ?? null });
  }

  async assertCountry(code: string) {
    const [c] = await this.db.select({ code: countries.code }).from(countries).where(eq(countries.code, code)).limit(1);
    if (!c) throw Errors.validation({ countryCode: 'Choose a country from the list' });
  }

  /** Owners must be able to work leads (ambassador.manage through any active role). */
  private async assertTeamMember(userId: string) {
    const [hit] = await this.db
      .select({ id: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt), eq(rolePermissions.permissionKey, 'ambassador.manage')))
      .limit(1);
    if (!hit) throw Errors.validation({ ownerId: 'Choose someone on the ambassador team' });
  }

  async chapterFor(countryCode: string) {
    const [c] = await this.db
      .select({ id: chapters.id, slug: chapters.slug, name: chapters.name })
      .from(chapters)
      .where(and(eq(chapters.countryCode, countryCode), inArray(chapters.status, ['active', 'proposed'])))
      .orderBy(sql`case when ${chapters.status} = 'active' then 0 else 1 end`, asc(chapters.name))
      .limit(1);
    return c ?? null;
  }

  async countryName(code: string) {
    const [c] = await this.db.select({ name: countries.name }).from(countries).where(eq(countries.code, code)).limit(1);
    return c?.name ?? code;
  }

  private async countriesFor(scope: AmbassadorScope): Promise<CountryRef[]> {
    const rows = await this.db
      .select({ code: countries.code, name: countries.name })
      .from(countries)
      .where(scope.all ? undefined : scope.countries.length ? inArray(countries.code, scope.countries) : sql`false`)
      .orderBy(asc(countries.name));
    return rows;
  }

  private async requiredCourses() {
    const ids = (await this.settings.get('ambassador_training')).courseIds;
    if (!ids.length) return [];
    const rows = await this.db.select({ id: courses.id, title: courses.title, startUrl: courses.startUrl }).from(courses).where(inArray(courses.id, ids));
    return ids.map((cid) => rows.find((r) => r.id === cid)).filter((r): r is NonNullable<typeof r> => !!r);
  }

  private async names(ids: (string | null | undefined)[]): Promise<Map<string, PersonRef>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    const rows = await this.db
      .select({ id: users.id, email: users.email, name: memberProfiles.displayName })
      .from(users)
      .leftJoin(memberProfiles, eq(memberProfiles.userId, users.id))
      .where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name ?? r.email }]));
  }

  private async summaries(rows: LeadRow[]): Promise<AdminLeadSummary[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [countryRows, people, stepRows] = await Promise.all([
      this.db.select({ code: countries.code, name: countries.name }).from(countries).where(inArray(countries.code, [...new Set(rows.map((r) => r.countryCode))])),
      this.names(rows.map((r) => r.ownerId)),
      this.db
        .select({
          leadId: ambassadorOnboardingSteps.leadId,
          total: sql<number>`count(*)::int`,
          done: sql<number>`count(*) filter (where ${ambassadorOnboardingSteps.status} in ('done','waived'))::int`,
        })
        .from(ambassadorOnboardingSteps)
        .where(inArray(ambassadorOnboardingSteps.leadId, ids))
        .groupBy(ambassadorOnboardingSteps.leadId),
    ]);
    const countryName = new Map(countryRows.map((c) => [c.code, c.name]));
    const steps = new Map(stepRows.map((s) => [s.leadId, { done: s.done, total: s.total }]));
    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      country: { code: r.countryCode, name: countryName.get(r.countryCode) ?? r.countryCode },
      city: r.city,
      organisation: r.organisation,
      jobTitle: r.jobTitle,
      source: r.source as AdminLeadSummary['source'],
      stage: r.stage as LeadStage,
      stageChangedAt: iso(r.stageChangedAt),
      scoreTotal: r.scoreTotal,
      owner: r.ownerId ? (people.get(r.ownerId) ?? null) : null,
      hasAccount: !!r.userId,
      onboarding: r.onboardingStartedAt ? (steps.get(r.id) ?? { done: 0, total: AMBASSADOR_STEPS.length }) : null,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    }));
  }

  private async toDetail(lead: LeadRow): Promise<AdminLeadDetail> {
    const [summary] = await this.summaries([lead]);
    const [member, chapter, activityRows, checklist] = await Promise.all([
      lead.userId
        ? this.db
            .select({ id: memberProfiles.userId, handle: memberProfiles.handle, name: memberProfiles.displayName })
            .from(memberProfiles)
            .where(eq(memberProfiles.userId, lead.userId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : null,
      this.chapterFor(lead.countryCode),
      this.db
        .select()
        .from(ambassadorLeadActivities)
        .where(eq(ambassadorLeadActivities.leadId, lead.id))
        .orderBy(desc(ambassadorLeadActivities.createdAt), desc(ambassadorLeadActivities.id))
        .limit(ACTIVITY_LIMIT),
      lead.onboardingStartedAt ? this.checklistView(lead) : null,
    ]);
    const people = await this.names([lead.createdBy, ...activityRows.map((a) => a.actorId)]);
    const activity: LeadActivity[] = activityRows.map((a) => ({
      id: a.id,
      kind: a.kind as LeadActivityKind,
      body: a.body,
      actor: a.actorId ? (people.get(a.actorId) ?? null) : null,
      createdAt: iso(a.createdAt),
    }));
    return {
      ...summary!,
      phone: lead.phone,
      linkedinUrl: lead.linkedinUrl,
      referredBy: lead.referredBy,
      hoursPerWeek: lead.hoursPerWeek,
      motivation: lead.motivation,
      notes: lead.notes,
      scores: lead.scores as LeadScores,
      member,
      createdBy: lead.createdBy ? (people.get(lead.createdBy) ?? null) : null,
      chapter,
      checklist,
      certifiedAt: isoOrNull(lead.certifiedAt),
      founding: lead.founding,
      activity,
    };
  }

  async checklistView(lead: LeadRow): Promise<AmbassadorChecklist> {
    const [stepRows, required, progress] = await Promise.all([
      this.db.select().from(ambassadorOnboardingSteps).where(eq(ambassadorOnboardingSteps.leadId, lead.id)),
      this.requiredCourses(),
      this.db.select().from(ambassadorTrainingProgress).where(eq(ambassadorTrainingProgress.leadId, lead.id)),
    ]);
    const people = await this.names(stepRows.map((s) => s.completedBy));
    const steps = AMBASSADOR_STEPS.map((s) => {
      const row = stepRows.find((r) => r.step === s.key);
      return {
        key: s.key,
        label: s.label,
        description: s.description,
        status: (row?.status ?? 'pending') as AmbassadorChecklist['steps'][number]['status'],
        completedAt: isoOrNull(row?.completedAt),
        completedBy: row?.completedBy ? (people.get(row.completedBy) ?? null) : null,
        note: row?.note ?? null,
      };
    });
    return {
      startedAt: iso(lead.onboardingStartedAt!),
      invitedAt: isoOrNull(lead.invitedAt),
      steps,
      training: required.map((c) => ({
        courseId: c.id,
        title: c.title,
        startUrl: c.startUrl,
        completedAt: isoOrNull(progress.find((p) => p.courseId === c.id)?.completedAt),
      })),
      readyToCertify: !!lead.userId && steps.every((s) => DONE.includes(s.status)),
    };
  }
}

function emptyCounts(): Record<LeadStage, number> {
  return Object.fromEntries(LeadStage.options.map((s) => [s, 0])) as Record<LeadStage, number>;
}

const sourceLabel = (s: string) =>
  ({ application: 'applied', nomination: 'nominated', referral: 'referral', outreach: 'outreach', event: 'met at an event', other: 'other' })[s] ?? s;
