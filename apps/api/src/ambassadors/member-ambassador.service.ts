import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import {
  AMBASSADOR_AGREEMENT_VERSION,
  AMBASSADOR_STEPS,
  type AmbassadorApplicationInput,
  type AmbassadorNominationInput,
  type AmbassadorStepKey,
  type LeadStage,
  type MyAmbassadorStatus,
  type MyAmbassadorView,
  type SignAgreementInput,
} from '@chartermission/contracts';
import type { z } from 'zod';
import type {
  AmbassadorApplicationInput as ApplicationSchema,
  AmbassadorNominationInput as NominationSchema,
  SignAgreementInput as SignSchema,
} from '@chartermission/contracts';
import { InjectDb, type Db } from '../db/db.module.js';
import { ambassadorLeadActivities, ambassadorLeads, ambassadorOnboardingSteps, memberProfiles } from '../db/schema.js';
import { Errors } from '../common/errors.js';
import type { AuthContext, AuthUser } from '../core/auth-context.js';
import { AuditService } from '../infra/audit.service.js';
import { RateLimitService } from '../infra/rate-limit.service.js';
import { isUniqueViolation } from '../moderation/util.js';
import { AmbassadorMailer } from './ambassador-mail.js';
import { LeadsService, scoreTotal } from './leads.service.js';

type LeadRow = typeof ambassadorLeads.$inferSelect;
type Application = z.output<typeof ApplicationSchema>;
type Nomination = z.output<typeof NominationSchema>;
type Sign = z.output<typeof SignSchema>;

/** Closed applications (declined, talent pool) can be made again after this long. */
const REAPPLY_AFTER_DAYS = 180;
const APPLICATIONS_PER_DAY = 3;
const NOMINATIONS_PER_DAY = 5;
/** Steps the member completes themselves, here or through their own account. */
const SELF_SERVE: AmbassadorStepKey[] = ['agreement', 'account', 'profile'];
/** The profile step ticks itself once the profile has a photo and a bio of at least this length. */
const PROFILE_BIO_MIN = 40;

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const STATUS: Record<LeadStage, MyAmbassadorStatus> = {
  new: 'in_review',
  screening: 'in_review',
  review: 'in_review',
  interview: 'in_review',
  references: 'in_review',
  decision: 'in_review',
  onboarding: 'onboarding',
  ambassador: 'ambassador',
  alumni: 'alumni',
  talent_pool: 'closed',
  declined: 'closed',
  withdrawn: 'closed',
};

/**
 * The Ambassador programme from a member's side: applying, nominating someone, and the onboarding
 * checklist with the in-app agreement. Leads are matched to the viewer by account, or by email
 * when the team added them before the account existed.
 */
@Injectable()
export class MemberAmbassadorService {
  private readonly log = new Logger('Ambassadors');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    private readonly mail: AmbassadorMailer,
    private readonly leads: LeadsService,
  ) {}

  /** GET /ambassadors/me */
  async me(ctx: AuthContext): Promise<MyAmbassadorView> {
    let lead = await this.findMine(ctx.user);
    if (lead?.stage === 'onboarding') lead = await this.syncProfileStep(lead);
    return this.view(lead);
  }

  /** POST /ambassadors/me/agreement */
  async signAgreement(ctx: AuthContext, rawInput: SignAgreementInput, ip?: string): Promise<MyAmbassadorView> {
    const input = rawInput as Sign;
    const lead = await this.findMine(ctx.user);
    if (!lead || lead.stage !== 'onboarding') throw Errors.conflict('The agreement opens once your onboarding has started.');
    if (input.version !== AMBASSADOR_AGREEMENT_VERSION) {
      throw Errors.conflict('The agreement has been updated since you opened it. Reload the page and read the current version.');
    }
    if (lead.agreementSignedAt && lead.agreementVersion === AMBASSADOR_AGREEMENT_VERSION) return this.view(lead);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(ambassadorLeads)
        .set({ agreementSignedAt: now, agreementSignedName: input.fullName, agreementVersion: AMBASSADOR_AGREEMENT_VERSION })
        .where(eq(ambassadorLeads.id, lead.id));
      await tx
        .update(ambassadorOnboardingSteps)
        .set({ status: 'done', completedAt: now, completedBy: ctx.user.id, note: `Signed in the app as “${input.fullName}” (version ${AMBASSADOR_AGREEMENT_VERSION})` })
        .where(and(eq(ambassadorOnboardingSteps.leadId, lead.id), eq(ambassadorOnboardingSteps.step, 'agreement')));
      await tx.insert(ambassadorLeadActivities).values({
        leadId: lead.id,
        actorId: ctx.user.id,
        kind: 'onboarding',
        body: `Signed the Ambassador Agreement as “${input.fullName}”`,
        data: { version: AMBASSADOR_AGREEMENT_VERSION },
      });
    });
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.agreement.sign', targetType: 'ambassador_lead', targetId: lead.id, after: { version: AMBASSADOR_AGREEMENT_VERSION }, ip });
    return this.view(await this.reload(lead.id));
  }

  /** POST /ambassadors/applications */
  async apply(ctx: AuthContext, rawInput: AmbassadorApplicationInput, ip?: string): Promise<MyAmbassadorView> {
    const input = rawInput as Application;
    await this.leads.assertCountry(input.countryCode);
    const existing = await this.findMine(ctx.user);
    if (existing) {
      const gate = this.applyGate(existing);
      if (!gate.canApply) throw Errors.conflict(this.blockedMessage(existing, gate.reapplyFrom));
    }
    await this.limits.consume(`ambassador-apply:${ctx.user.id}`, APPLICATIONS_PER_DAY, 24 * 3600);

    const profile = await this.profile(ctx.user.id);
    const scores = { availability: availabilityScore(input.hoursPerWeek) };
    const screening = this.screeningNote(input, profile);
    const fields = {
      countryCode: input.countryCode,
      city: input.city ?? profile?.city ?? null,
      phone: input.phone ?? null,
      organisation: input.organisation ?? profile?.organisation ?? null,
      jobTitle: input.jobTitle ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      hoursPerWeek: input.hoursPerWeek,
      motivation: input.motivation,
      source: 'application',
      userId: ctx.user.id,
      scores,
      scoreTotal: scoreTotal(scores),
    };

    let leadId: string;
    try {
      leadId = await this.db.transaction(async (tx) => {
        if (existing) {
          // Reopen: back to "new" with a clean checklist and scores. Training already done stays done.
          await tx
            .update(ambassadorLeads)
            .set({
              ...fields,
              stage: 'new',
              stageChangedAt: new Date(),
              onboardingStartedAt: null,
              invitedAt: null,
              agreementSignedAt: null,
              agreementSignedName: null,
              agreementVersion: null,
            })
            .where(eq(ambassadorLeads.id, existing.id));
          await tx.delete(ambassadorOnboardingSteps).where(eq(ambassadorOnboardingSteps.leadId, existing.id));
          await tx.insert(ambassadorLeadActivities).values({ leadId: existing.id, actorId: ctx.user.id, kind: 'applied', body: `Applied again (was ${existing.stage.replace('_', ' ')}). ${screening}` });
          return existing.id;
        }
        const [created] = await tx
          .insert(ambassadorLeads)
          .values({ ...fields, fullName: profile?.displayName ?? ctx.user.email.split('@')[0]!, email: ctx.user.email.toLowerCase(), createdBy: ctx.user.id })
          .returning({ id: ambassadorLeads.id });
        await tx.insert(ambassadorLeadActivities).values({ leadId: created!.id, actorId: ctx.user.id, kind: 'applied', body: `Applied through the member app. ${screening}` });
        return created!.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('An application with your email is already with the team.');
      throw err;
    }
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.apply', targetType: 'ambassador_lead', targetId: leadId, after: { country: input.countryCode, reopened: !!existing }, ip });
    return this.view(await this.reload(leadId));
  }

  /** POST /ambassadors/nominations. Never reveals whether the nominee is already a lead. */
  async nominate(ctx: AuthContext, rawInput: AmbassadorNominationInput, ip?: string): Promise<{ ok: true }> {
    const input = rawInput as Nomination;
    if (input.email === ctx.user.email.toLowerCase()) {
      throw Errors.validation({ email: 'To put yourself forward, use the application form instead' });
    }
    await this.leads.assertCountry(input.countryCode);
    await this.limits.consume(`ambassador-nominate:${ctx.user.id}`, NOMINATIONS_PER_DAY, 24 * 3600);

    const nominator = await this.profile(ctx.user.id);
    const nominatorName = nominator?.displayName ?? ctx.user.email;
    const nominatorRef = nominator ? `${nominator.displayName} (@${nominator.handle})` : ctx.user.email;
    const [existing] = await this.db
      .select({ id: ambassadorLeads.id })
      .from(ambassadorLeads)
      .where(sql`lower(${ambassadorLeads.email}) = ${input.email}`)
      .limit(1);

    if (existing) {
      await this.db.insert(ambassadorLeadActivities).values({ leadId: existing.id, actorId: ctx.user.id, kind: 'note', body: `Also nominated by ${nominatorRef}: ${input.reason}` });
      await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.nominate', targetType: 'ambassador_lead', targetId: existing.id, after: { existing: true }, ip });
      return { ok: true };
    }

    const userId = await this.leads.accountFor(input.email);
    let leadId: string | null = null;
    try {
      leadId = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(ambassadorLeads)
          .values({
            fullName: input.fullName,
            email: input.email,
            countryCode: input.countryCode,
            organisation: input.organisation ?? null,
            linkedinUrl: input.linkedinUrl ?? null,
            source: 'nomination',
            referredBy: nominatorName.slice(0, 120),
            notes: `Nominated by ${nominatorRef}: ${input.reason}`,
            userId,
            createdBy: ctx.user.id,
          })
          .returning({ id: ambassadorLeads.id });
        await tx.insert(ambassadorLeadActivities).values({ leadId: created!.id, actorId: ctx.user.id, kind: 'created', body: `Nominated by ${nominatorRef}` });
        return created!.id;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    if (!leadId) return { ok: true };

    const country = await this.leads.countryName(input.countryCode);
    try {
      await this.mail.nominated({ email: input.email, userId }, { name: input.fullName, nominator: nominatorName, country, hasAccount: !!userId });
    } catch (err) {
      this.log.warn(`Nomination email for lead ${leadId} failed: ${String(err)}`);
    }
    await this.audit.record({ actorId: ctx.user.id, action: 'ambassador.nominate', targetType: 'ambassador_lead', targetId: leadId, after: { country: input.countryCode }, ip });
    return { ok: true };
  }

  /* ----------------------------- Helpers ----------------------------- */

  /** The viewer's lead: linked to their account, or added with their email before they joined. */
  private async findMine(user: AuthUser): Promise<LeadRow | null> {
    const email = user.email.toLowerCase();
    const [lead] = await this.db
      .select()
      .from(ambassadorLeads)
      .where(or(eq(ambassadorLeads.userId, user.id), sql`lower(${ambassadorLeads.email}) = ${email}`))
      .orderBy(sql`case when ${ambassadorLeads.userId} = ${user.id} then 0 else 1 end`, desc(ambassadorLeads.updatedAt))
      .limit(1);
    if (!lead) return null;
    return lead.userId ? lead : this.leads.relinkAccount(lead);
  }

  private async reload(id: string): Promise<LeadRow> {
    const [lead] = await this.db.select().from(ambassadorLeads).where(eq(ambassadorLeads.id, id)).limit(1);
    if (!lead) throw Errors.notFound('Your application');
    return lead;
  }

  private async profile(userId: string) {
    const [p] = await this.db
      .select({ displayName: memberProfiles.displayName, handle: memberProfiles.handle, city: memberProfiles.city, organisation: memberProfiles.organisation, bio: memberProfiles.bio, avatarFileId: memberProfiles.avatarFileId, createdAt: memberProfiles.createdAt })
      .from(memberProfiles)
      .where(eq(memberProfiles.userId, userId))
      .limit(1);
    return p ?? null;
  }

  /** Ticks the profile step once the member's profile has a photo and a short bio. */
  private async syncProfileStep(lead: LeadRow): Promise<LeadRow> {
    if (!lead.userId) return lead;
    const [step] = await this.db
      .select({ status: ambassadorOnboardingSteps.status })
      .from(ambassadorOnboardingSteps)
      .where(and(eq(ambassadorOnboardingSteps.leadId, lead.id), eq(ambassadorOnboardingSteps.step, 'profile')))
      .limit(1);
    if (step?.status !== 'pending') return lead;
    const profile = await this.profile(lead.userId);
    if (!profile?.avatarFileId || (profile.bio ?? '').trim().length < PROFILE_BIO_MIN) return lead;
    await this.db.transaction(async (tx) => {
      await tx
        .update(ambassadorOnboardingSteps)
        .set({ status: 'done', completedAt: new Date(), completedBy: null, note: 'Ticked automatically: profile has a photo and bio' })
        .where(and(eq(ambassadorOnboardingSteps.leadId, lead.id), eq(ambassadorOnboardingSteps.step, 'profile'), eq(ambassadorOnboardingSteps.status, 'pending')));
      await tx.insert(ambassadorLeadActivities).values({ leadId: lead.id, actorId: null, kind: 'onboarding', body: 'Profile step ticked automatically (photo and bio added)' });
    });
    return lead;
  }

  private applyGate(lead: LeadRow | null): { canApply: boolean; reapplyFrom: string | null } {
    if (!lead || lead.stage === 'withdrawn') return { canApply: true, reapplyFrom: null };
    if (lead.stage === 'declined' || lead.stage === 'talent_pool') {
      const from = new Date(lead.stageChangedAt.getTime() + REAPPLY_AFTER_DAYS * 86_400_000);
      return from <= new Date() ? { canApply: true, reapplyFrom: null } : { canApply: false, reapplyFrom: iso(from) };
    }
    return { canApply: false, reapplyFrom: null };
  }

  private blockedMessage(lead: LeadRow, reapplyFrom: string | null): string {
    switch (STATUS[lead.stage as LeadStage]) {
      case 'in_review':
        return 'Your application is already with the community team.';
      case 'onboarding':
      case 'ambassador':
        return 'You are already in the Ambassador programme.';
      case 'alumni':
        return 'You have served as an Ambassador. Talk to the community team about another term.';
      default:
        return reapplyFrom
          ? `You can apply again from ${new Date(reapplyFrom).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`
          : 'You cannot apply right now.';
    }
  }

  /** One-line automatic screening summary for the team's timeline. */
  private screeningNote(input: Application, profile: Awaited<ReturnType<MemberAmbassadorService['profile']>>): string {
    const notes = [
      `${input.hoursPerWeek} h/week (availability ${availabilityScore(input.hoursPerWeek)}/5)`,
      input.linkedinUrl ? 'LinkedIn given' : 'no LinkedIn',
      profile?.avatarFileId ? 'profile photo set' : 'no profile photo',
      (profile?.bio ?? '').trim().length >= PROFILE_BIO_MIN ? 'bio written' : 'no bio',
      profile ? `member since ${profile.createdAt.toISOString().slice(0, 10)}` : null,
    ].filter(Boolean);
    const flags = input.hoursPerWeek < 3 ? ' Below the 3 hours a week the role needs.' : '';
    return `Screening: ${notes.join(', ')}.${flags}`;
  }

  private async view(lead: LeadRow | null): Promise<MyAmbassadorView> {
    const gate = this.applyGate(lead);
    if (!lead) {
      return { status: 'none', country: null, chapter: null, appliedAt: null, canApply: true, reapplyFrom: null, onboarding: null, agreement: null, certifiedAt: null, founding: false };
    }
    const status = STATUS[lead.stage as LeadStage];
    const [countryName, chapter, applied] = await Promise.all([
      this.leads.countryName(lead.countryCode),
      this.leads.chapterFor(lead.countryCode),
      this.db
        .select({ at: ambassadorLeadActivities.createdAt })
        .from(ambassadorLeadActivities)
        .where(and(eq(ambassadorLeadActivities.leadId, lead.id), eq(ambassadorLeadActivities.kind, 'applied')))
        .orderBy(desc(ambassadorLeadActivities.createdAt))
        .limit(1),
    ]);
    let onboarding: MyAmbassadorView['onboarding'] = null;
    if (status === 'onboarding' && lead.onboardingStartedAt) {
      const checklist = await this.leads.checklistView(lead);
      const steps = checklist.steps.map((s) => ({
        key: s.key,
        label: s.label,
        description: AMBASSADOR_STEPS.find((d) => d.key === s.key)?.description ?? s.description,
        status: s.status,
        completedAt: s.completedAt,
        selfServe: SELF_SERVE.includes(s.key),
      }));
      onboarding = {
        steps,
        training: checklist.training,
        done: steps.filter((s) => s.status !== 'pending').length,
        total: steps.length,
      };
    }
    return {
      status,
      country: { code: lead.countryCode, name: countryName },
      chapter: chapter ? { slug: chapter.slug, name: chapter.name } : null,
      appliedAt: isoOrNull(applied[0]?.at),
      canApply: gate.canApply,
      reapplyFrom: gate.reapplyFrom,
      onboarding,
      agreement:
        lead.agreementSignedAt && lead.agreementVersion && lead.agreementSignedName
          ? { version: lead.agreementVersion, signedAt: iso(lead.agreementSignedAt), signedName: lead.agreementSignedName }
          : null,
      certifiedAt: isoOrNull(lead.certifiedAt),
      founding: lead.founding,
    };
  }
}

/** Availability line of the rubric (max 5) from the hours a week offered. */
function availabilityScore(hours: number): number {
  if (hours >= 5) return 5;
  if (hours >= 3) return 3;
  return 1;
}
