import { and, eq, inArray, sql } from 'drizzle-orm';
import { AMBASSADOR_AGREEMENT_VERSION, AMBASSADOR_STEPS, LEAD_RUBRIC, type AmbassadorStepKey } from '@chartermission/contracts';
import type { Db } from './client.js';
import * as s from './schema.js';
import type { SeedContext } from './seed-data.js';

/*
 * Ambassador programme demo data: the Ambassador Manager's countries and leads at every stage of the
 * pipeline, so the admin console's Ambassadors pages have something to work on.
 *  - amb-manager@chartermission.com covers Nigeria, Ghana and Kenya; the Senegal lead is visible only to
 *    Platform Admins and above, which shows the country scoping.
 *  - Amara Okafor is the certified Founding Ambassador for Nigeria (badge on her profile).
 *  - Kofi Asante is onboarding (Ghana): he can sign the agreement on /ambassadors.
 *  - Zainab Abdi has applied (Kenya); the other leads have no member account.
 * Idempotent: leads are matched by email and left alone if they already exist.
 */

type Scores = Partial<Record<(typeof LEAD_RUBRIC)[number]['key'], number>>;

type SeedLead = {
  name: string;
  email: string;
  country: string;
  city: string;
  source: 'application' | 'nomination' | 'referral' | 'outreach' | 'event' | 'other';
  stage: string;
  owner: 'ambManager' | 'platformAdmin' | null;
  /** Member key from seed-data MEMBERS, when the lead has an account. */
  member?: string;
  organisation?: string;
  jobTitle?: string;
  hoursPerWeek?: number;
  motivation?: string;
  referredBy?: string;
  scores?: Scores;
  daysAgo: number;
  /** Onboarding steps already done (onboarding and ambassador stages). */
  done?: AmbassadorStepKey[];
  founding?: boolean;
};

const LEADS: SeedLead[] = [
  {
    name: 'Amara Okafor', email: 'amara@example.com', member: 'amara', country: 'NG', city: 'Lagos', source: 'outreach', stage: 'ambassador',
    owner: 'ambManager', organisation: 'Lagos AgriHub', jobTitle: 'Founder', hoursPerWeek: 6, daysAgo: 60, founding: true,
    motivation: 'Run monthly founder meetups in Lagos and connect agri-tech builders with diaspora investors.',
    scores: { standing: 14, reach: 13, leadership: 18, motivation: 14, availability: 5, values: 10, interview: 18 },
    done: ['agreement', 'account', 'profile', 'training', 'orientation', 'first_event'],
  },
  {
    name: 'Kofi Asante', email: 'kofi@example.com', member: 'kofi', country: 'GH', city: 'Kumasi', source: 'application', stage: 'onboarding',
    owner: 'ambManager', jobTitle: 'Solar mini-grid developer', hoursPerWeek: 5, daysAgo: 20,
    motivation: 'Build the Ghana chapter around energy and market-town entrepreneurs in Kumasi and Accra.',
    scores: { standing: 12, reach: 11, leadership: 15, motivation: 13, availability: 5, values: 9, interview: 16 },
    done: ['account'],
  },
  {
    name: 'Zainab Abdi', email: 'zainab@example.com', member: 'zainab', country: 'KE', city: 'Nairobi', source: 'application', stage: 'new',
    owner: null, jobTitle: 'Health data scientist', hoursPerWeek: 4, daysAgo: 2,
    motivation: 'I want to grow the Kenya chapter with health and data professionals, starting with a quarterly meetup in Nairobi.',
    scores: { availability: 3 },
  },
  {
    name: 'Ifeoma Nwosu', email: 'ifeoma.nwosu@example.com', country: 'NG', city: 'Abuja', source: 'referral', stage: 'screening',
    owner: 'ambManager', organisation: 'Abuja Women in Tech', jobTitle: 'Programme Director', hoursPerWeek: 5, daysAgo: 9, referredBy: 'Aisha Mohammed',
  },
  {
    name: 'Kwesi Boateng', email: 'kwesi.boateng@example.com', country: 'GH', city: 'Accra', source: 'event', stage: 'interview',
    owner: 'ambManager', organisation: 'Accra Startup Week', jobTitle: 'Co-organiser', hoursPerWeek: 6, daysAgo: 14,
    scores: { standing: 13, reach: 14, leadership: 17, motivation: 12, availability: 5, values: 9 },
  },
  {
    name: 'Efua Mensah', email: 'efua.mensah@example.com', country: 'GH', city: 'Takoradi', source: 'nomination', stage: 'new',
    owner: null, organisation: 'Western Region Exporters Network', daysAgo: 3, referredBy: 'Kwame Mensah',
  },
  {
    name: 'Samuel Okoro', email: 'samuel.okoro@example.com', country: 'NG', city: 'Port Harcourt', source: 'application', stage: 'declined',
    owner: 'ambManager', hoursPerWeek: 1, daysAgo: 40, scores: { standing: 6, reach: 5, leadership: 8, motivation: 7, availability: 1, values: 8, interview: 9 },
  },
  {
    name: 'Achieng Otieno', email: 'achieng.otieno@example.com', country: 'KE', city: 'Kisumu', source: 'outreach', stage: 'review',
    owner: 'ambManager', organisation: 'Lake Basin Innovation Hub', jobTitle: 'Community Lead', hoursPerWeek: 5, daysAgo: 11,
    scores: { standing: 12, reach: 10, leadership: 14, motivation: 12, availability: 5 },
  },
  {
    name: 'Grace Wanjiku', email: 'grace.wanjiku@example.com', country: 'KE', city: 'Mombasa', source: 'application', stage: 'talent_pool',
    owner: 'ambManager', hoursPerWeek: 3, daysAgo: 35, scores: { standing: 10, reach: 9, leadership: 11, motivation: 12, availability: 3, values: 9, interview: 12 },
  },
  {
    name: 'Moussa Sow', email: 'moussa.sow@example.com', country: 'SN', city: 'Dakar', source: 'referral', stage: 'decision',
    owner: 'platformAdmin', organisation: 'Dakar Fintech Collective', jobTitle: 'Founder', hoursPerWeek: 6, daysAgo: 25, referredBy: 'Fatou Diallo',
    scores: { standing: 13, reach: 12, leadership: 17, motivation: 14, availability: 5, values: 10, interview: 17 },
  },
];

/** Managers and the countries they cover (scoped ambassador_manager role rows). */
const MANAGERS: { key: string; countries: string[] }[] = [{ key: 'ambManager', countries: ['NG', 'GH', 'KE'] }];

const sum = (scores: Scores) => {
  const values = Object.values(scores).filter((v): v is number => typeof v === 'number');
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};

export async function seedAmbassadors(db: Db, ctx: SeedContext) {
  const roleRows = await db.select({ id: s.roles.id, key: s.roles.key }).from(s.roles).where(inArray(s.roles.key, ['ambassador', 'ambassador_manager']));
  const roleId = (key: string) => roleRows.find((r) => r.key === key)?.id;
  const managerRole = roleId('ambassador_manager');
  const ambassadorRole = roleId('ambassador');
  if (!managerRole || !ambassadorRole) return;

  for (const m of MANAGERS) {
    const userId = ctx.ids[m.key];
    if (!userId) continue;
    await db
      .insert(s.userRoles)
      .values(m.countries.map((code) => ({ userId, roleId: managerRole, scopeType: 'country', scopeId: code, grantedBy: ctx.ids.superAdmin ?? null })))
      .onConflictDoNothing();
  }

  const now = Date.now();
  const day = 86_400_000;
  for (const l of LEADS) {
    const created = new Date(now - l.daysAgo * day);
    const changed = new Date(now - Math.max(0, l.daysAgo - 2) * day);
    const ownerId = l.owner ? (ctx.ids[l.owner] ?? null) : null;
    const userId = l.member ? (ctx.ids[l.member] ?? null) : null;
    const onboarding = l.stage === 'onboarding' || l.stage === 'ambassador';
    const certified = l.stage === 'ambassador';
    const scores = l.scores ?? {};
    const [lead] = await db
      .insert(s.ambassadorLeads)
      .values({
        fullName: l.name,
        email: l.email,
        countryCode: l.country,
        city: l.city,
        organisation: l.organisation ?? null,
        jobTitle: l.jobTitle ?? null,
        source: l.source,
        referredBy: l.referredBy ?? null,
        hoursPerWeek: l.hoursPerWeek ?? null,
        motivation: l.motivation ?? null,
        stage: l.stage,
        stageChangedAt: changed,
        scores,
        scoreTotal: sum(scores),
        ownerId,
        userId,
        onboardingStartedAt: onboarding ? changed : null,
        invitedAt: onboarding ? changed : null,
        certifiedAt: certified ? new Date(now - day) : null,
        founding: !!l.founding,
        agreementSignedAt: l.done?.includes('agreement') ? changed : null,
        agreementSignedName: l.done?.includes('agreement') ? l.name : null,
        agreementVersion: l.done?.includes('agreement') ? AMBASSADOR_AGREEMENT_VERSION : null,
        createdBy: l.source === 'application' || l.source === 'nomination' ? userId : ownerId,
        createdAt: created,
        updatedAt: changed,
      })
      .onConflictDoNothing()
      .returning();
    if (!lead) continue;

    const opening =
      l.source === 'application'
        ? { kind: 'applied', body: `Applied through the member app. Screening: ${l.hoursPerWeek ?? 0} h/week.` }
        : l.source === 'nomination'
          ? { kind: 'created', body: `Nominated by ${l.referredBy ?? 'a member'}` }
          : { kind: 'created', body: `Lead added (${l.source})` };
    await db.insert(s.ambassadorLeadActivities).values({ leadId: lead.id, actorId: lead.createdBy, kind: opening.kind, body: opening.body, createdAt: created });
    if (l.stage !== 'new') {
      await db.insert(s.ambassadorLeadActivities).values({
        leadId: lead.id,
        actorId: ownerId,
        kind: 'stage',
        body: `Moved to ${l.stage.replace('_', ' ')}`,
        data: { to: l.stage },
        createdAt: changed,
      });
    }

    if (onboarding) {
      await db
        .insert(s.ambassadorOnboardingSteps)
        .values(
          AMBASSADOR_STEPS.map((step) => {
            const done = l.done?.includes(step.key) ?? false;
            // No required training courses are set in a fresh database, so training is waived (as the app does).
            const waived = !done && step.key === 'training';
            return {
              leadId: lead.id,
              step: step.key,
              status: done ? 'done' : waived ? 'waived' : 'pending',
              note: waived ? 'No required courses were set when onboarding started' : null,
              completedAt: done || waived ? changed : null,
              completedBy: done ? (step.key === 'agreement' ? userId : ownerId) : null,
            };
          }),
        )
        .onConflictDoNothing();
    }

    if (certified && userId) {
      const [chapter] = await db
        .select({ id: s.chapters.id })
        .from(s.chapters)
        .where(eq(s.chapters.countryCode, l.country))
        .limit(1);
      await db
        .insert(s.userRoles)
        .values({ userId, roleId: ambassadorRole, scopeType: chapter ? 'chapter' : 'country', scopeId: chapter?.id ?? l.country, grantedBy: ownerId })
        .onConflictDoNothing();
      await db.insert(s.ambassadorLeadActivities).values({
        leadId: lead.id,
        actorId: ownerId,
        kind: 'certified',
        body: l.founding ? 'Certified as Founding Ambassador' : 'Certified as Ambassador',
        createdAt: new Date(now - day),
      });
    }
  }
}
