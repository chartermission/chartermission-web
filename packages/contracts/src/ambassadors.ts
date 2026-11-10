import { z } from "zod";

/*
 * Ambassador programme (admin side): leads, the qualification pipeline, onboarding and the
 * managers who run it. One Ambassador per country chapter (African country or diaspora host
 * country); Ambassadors keep a normal member profile and get an "ambassador" role for the badge.
 *
 *  GET    /admin/ambassadors/leads                    AdminLeadsPage; AdminLeadsQuery.
 *  POST   /admin/ambassadors/leads                    CreateLeadInput → AdminLeadDetail.
 *  GET    /admin/ambassadors/leads/:id                AdminLeadDetail.
 *  PATCH  /admin/ambassadors/leads/:id                UpdateLeadInput → AdminLeadDetail.
 *  POST   /admin/ambassadors/leads/:id/stage          MoveLeadStageInput → AdminLeadDetail. Entering
 *                                                     "onboarding" creates the checklist and emails the lead.
 *  POST   /admin/ambassadors/leads/:id/notes          LeadNoteInput → AdminLeadDetail.
 *  PATCH  /admin/ambassadors/leads/:id/onboarding/:step   UpdateOnboardingStepInput → AdminLeadDetail.
 *  PUT    /admin/ambassadors/leads/:id/training/:courseId TrainingProgressInput → AdminLeadDetail.
 *  POST   /admin/ambassadors/leads/:id/invite         Resend the onboarding email → AdminLeadDetail.
 *  POST   /admin/ambassadors/leads/:id/certify        CertifyLeadInput → AdminLeadDetail. Grants the
 *                                                     "ambassador" role (badge) for the country's chapter.
 *  POST   /admin/ambassadors/leads/:id/end-term       EndTermInput → AdminLeadDetail. Revokes the role;
 *                                                     "alumni" keeps a grey Alumni Ambassador badge.
 *  GET    /admin/ambassadors/team                     TeamMember[]: who can own leads (for the owner picker).
 *  GET    /admin/ambassadors/managers                 ManagerView[]                 (ambassador.managers)
 *  POST   /admin/ambassadors/managers                 CreateManagerInput → ManagerView
 *  PATCH  /admin/ambassadors/managers/:userId         UpdateManagerInput → ManagerView
 *  DELETE /admin/ambassadors/managers/:userId         Revoke the manager role → 204
 *  POST   /admin/ambassadors/managers/:userId/invite  Resend the set-password email → ManagerView
 *  GET    /admin/ambassadors/training                 AmbassadorTrainingView
 *  PUT    /admin/ambassadors/training                 AmbassadorTrainingInput → AmbassadorTrainingView
 *
 * Managers ("ambassador_manager" role) see and edit only the leads in their countries; a manager
 * with no country rows, and anyone with ambassador.managers, covers every country.
 */

export const AMBASSADOR_PERMISSIONS = {
  /** Work the pipeline: create and edit leads, move stages, run onboarding, certify. */
  manage: "ambassador.manage",
  /** Create and revoke manager sub-accounts and choose the required training courses. */
  managers: "ambassador.managers",
} as const;

/* ----------------------------- Pipeline ----------------------------- */

export const LeadStage = z.enum([
  "new",
  "screening",
  "review",
  "interview",
  "references",
  "decision",
  "onboarding",
  "ambassador",
  "alumni",
  "talent_pool",
  "declined",
  "withdrawn",
]);
export type LeadStage = z.infer<typeof LeadStage>;

/** Open stages, in pipeline order (the board's columns). */
export const LEAD_OPEN_STAGES = ["new", "screening", "review", "interview", "references", "decision", "onboarding"] as const satisfies readonly LeadStage[];
/** Where a lead ends up. "ambassador" is reached only by certifying, "alumni" only by ending a term. */
export const LEAD_CLOSED_STAGES = ["ambassador", "alumni", "talent_pool", "declined", "withdrawn"] as const satisfies readonly LeadStage[];

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: "New lead",
  screening: "Screening",
  review: "Scored review",
  interview: "Interview",
  references: "References",
  decision: "Panel decision",
  onboarding: "Onboarding",
  ambassador: "Ambassador",
  alumni: "Alumni Ambassador",
  talent_pool: "Talent pool",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export const LEAD_STAGE_HINTS: Record<LeadStage, string> = {
  new: "Captured; nobody has looked at it yet.",
  screening: "Check the basics: account age, complete profile, no moderation strikes, 4+ hours a week.",
  review: "Two reviewers score the rubric. 70 or more goes to interview; 55–69 to the talent pool.",
  interview: "20-minute video call. Score the interview line of the rubric.",
  references: "Two references and a look at their public posts.",
  decision: "The weekly panel confirms one Ambassador per country.",
  onboarding: "Agreement, training and orientation before certification.",
  ambassador: "Certified. The badge is live on their profile.",
  alumni: "Term ended. They keep a grey Alumni Ambassador badge.",
  talent_pool: "Strong but not now; first in line when a seat opens.",
  declined: "Not taken forward.",
  withdrawn: "The lead stepped back.",
};

export const LeadSource = z.enum(["application", "nomination", "referral", "outreach", "event", "other"]);
export type LeadSource = z.infer<typeof LeadSource>;

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  application: "Applied",
  nomination: "Nominated by a member",
  referral: "Referral",
  outreach: "Our outreach",
  event: "Met at an event",
  other: "Other",
};

/** The 100-point rubric. */
export const LEAD_RUBRIC = [
  { key: "standing", label: "Community standing", max: 15 },
  { key: "reach", label: "Reach across the country", max: 15 },
  { key: "leadership", label: "Leadership experience", max: 20 },
  { key: "motivation", label: "Motivation and 90-day vision", max: 15 },
  { key: "availability", label: "Availability", max: 5 },
  { key: "values", label: "Values and conduct", max: 10 },
  { key: "interview", label: "Interview", max: 20 },
] as const;
export type RubricKey = (typeof LEAD_RUBRIC)[number]["key"];
export const LEAD_INTERVIEW_THRESHOLD = 70;
export const LEAD_TALENT_POOL_THRESHOLD = 55;

const score = (max: number) => z.number().int().min(0).max(max).nullable().optional();
export const LeadScores = z.object({
  standing: score(15),
  reach: score(15),
  leadership: score(20),
  motivation: score(15),
  availability: score(5),
  values: score(10),
  interview: score(20),
});
export type LeadScores = z.infer<typeof LeadScores>;

/* ----------------------------- Onboarding ----------------------------- */

export const AmbassadorStepKey = z.enum(["agreement", "account", "profile", "training", "orientation", "first_event"]);
export type AmbassadorStepKey = z.infer<typeof AmbassadorStepKey>;

export const AMBASSADOR_STEPS: { key: AmbassadorStepKey; label: string; description: string }[] = [
  { key: "agreement", label: "Agreement signed", description: "Ambassador Agreement and Code of Conduct, including the non-partisan pledge." },
  { key: "account", label: "Member account", description: "Has a Charter Mission account with this email. Ticks itself when the account exists." },
  { key: "profile", label: "Ambassador profile", description: "Photo, short bio, a chapter vision and languages on their member profile." },
  { key: "training", label: "Training courses", description: "The required Charter Center courses. Ticks itself when every course is marked done." },
  { key: "orientation", label: "Orientation call", description: "30 minutes with the community team." },
  { key: "first_event", label: "First chapter event", description: "Date set for their first chapter event and a welcome post drafted." },
];

export const AmbassadorStepStatus = z.enum(["pending", "done", "waived"]);
export type AmbassadorStepStatus = z.infer<typeof AmbassadorStepStatus>;

/* ----------------------------- Inputs ----------------------------- */

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
const CountryCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "Choose a country")
  .transform((v) => v.toUpperCase());

export const CreateLeadInput = z.object({
  fullName: z.string().trim().min(2, "Enter their full name").max(120),
  email: z
    .email("Enter a valid email")
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  phone: optText(40),
  countryCode: CountryCode,
  city: optText(80),
  organisation: optText(120),
  jobTitle: optText(120),
  linkedinUrl: z
    .url("Enter a full link, starting with https://")
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  source: LeadSource.default("outreach"),
  referredBy: optText(120),
  hoursPerWeek: z.number().int().min(0).max(80).optional(),
  motivation: optText(3000),
  notes: optText(3000),
  /** Manager responsible; defaults to whoever creates the lead. */
  ownerId: z.uuid().optional(),
});
export type CreateLeadInput = z.input<typeof CreateLeadInput>;

/** Optional text that can be cleared: "" or null → null (cleared), absent → unchanged. */
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const UpdateLeadInput = z.object({
  fullName: z.string().trim().min(2, "Enter their full name").max(120).optional(),
  email: z
    .email("Enter a valid email")
    .max(254)
    .transform((v) => v.trim().toLowerCase())
    .optional(),
  countryCode: CountryCode.optional(),
  source: LeadSource.optional(),
  phone: clearable(40),
  city: clearable(80),
  organisation: clearable(120),
  jobTitle: clearable(120),
  linkedinUrl: z
    .union([z.literal(""), z.null(), z.url("Enter a full link, starting with https://").max(500)])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null)),
  referredBy: clearable(120),
  hoursPerWeek: z.number().int().min(0).max(80).nullable().optional(),
  motivation: clearable(3000),
  notes: clearable(3000),
  ownerId: z.uuid().nullable().optional(),
  scores: LeadScores.optional(),
});
export type UpdateLeadInput = z.input<typeof UpdateLeadInput>;

export const MoveLeadStageInput = z.object({
  stage: LeadStage.exclude(["ambassador", "alumni"]),
  note: optText(1000),
  /**
   * Moving forward: record the current stage as waived (not needed for this lead) instead of
   * completed. Stages jumped over are always recorded as waived.
   */
  waive: z.boolean().default(false),
});
export type MoveLeadStageInput = z.input<typeof MoveLeadStageInput>;

export const LeadNoteInput = z.object({ body: z.string().trim().min(1, "Write a note").max(3000) });
export type LeadNoteInput = z.input<typeof LeadNoteInput>;

export const UpdateOnboardingStepInput = z.object({ status: AmbassadorStepStatus, note: optText(500) });
export type UpdateOnboardingStepInput = z.input<typeof UpdateOnboardingStepInput>;

export const TrainingProgressInput = z.object({ completed: z.boolean() });
export type TrainingProgressInput = z.input<typeof TrainingProgressInput>;

export const CertifyLeadInput = z.object({
  /** First intake: the badge shows "Founding Ambassador". */
  founding: z.boolean().default(false),
  note: optText(1000),
});
export type CertifyLeadInput = z.input<typeof CertifyLeadInput>;

/**
 * End a serving Ambassador's term. "alumni": in good standing, they keep a grey Alumni badge.
 * "removed": for conduct or other reasons, no badge (the lead becomes Withdrawn).
 */
export const EndTermInput = z.object({
  outcome: z.enum(["alumni", "removed"]).default("alumni"),
  note: optText(1000),
});
export type EndTermInput = z.input<typeof EndTermInput>;

export const AdminLeadsQuery = z.object({
  /** A stage, or a group: open (default), closed or all. */
  stage: z.union([LeadStage, z.enum(["open", "closed", "all"])]).default("open"),
  country: CountryCode.optional(),
  q: z.string().trim().max(100).optional(),
  /** A user id, or "me". */
  owner: z.union([z.uuid(), z.literal("me")]).optional(),
});
export type AdminLeadsQuery = z.input<typeof AdminLeadsQuery>;

export const CreateManagerInput = z.object({
  name: z.string().trim().min(2, "Enter their name").max(80),
  email: z
    .email("Enter a valid email")
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  /** Countries they cover; empty = every country. */
  countryCodes: z.array(CountryCode).max(60).default([]),
});
export type CreateManagerInput = z.input<typeof CreateManagerInput>;

export const UpdateManagerInput = z.object({ countryCodes: z.array(CountryCode).max(60) });
export type UpdateManagerInput = z.input<typeof UpdateManagerInput>;

export const AmbassadorTrainingInput = z.object({ courseIds: z.array(z.uuid()).max(20) });
export type AmbassadorTrainingInput = z.input<typeof AmbassadorTrainingInput>;

/* ----------------------------- Views ----------------------------- */

export type PersonRef = { id: string; name: string };
export type CountryRef = { code: string; name: string };

export type AdminLeadSummary = {
  id: string;
  fullName: string;
  email: string;
  country: CountryRef;
  city: string | null;
  organisation: string | null;
  jobTitle: string | null;
  source: LeadSource;
  stage: LeadStage;
  stageChangedAt: string;
  /** Sum of the scored rubric lines; null until something is scored. */
  scoreTotal: number | null;
  owner: PersonRef | null;
  /** A member account exists for this email. */
  hasAccount: boolean;
  /** Steps done or waived, out of all steps; null before onboarding starts. */
  onboarding: { done: number; total: number } | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminLeadsPage = {
  items: AdminLeadSummary[];
  /** Leads per stage across the viewer's countries (ignores the stage filter). */
  counts: Record<LeadStage, number>;
  /** Countries the viewer covers, for filters and the new-lead form. */
  countries: CountryRef[];
  /** More than the 500 rows returned matched. */
  truncated: boolean;
};

export type LeadActivityKind = "created" | "updated" | "stage" | "note" | "scores" | "onboarding" | "training" | "invite" | "certified" | "term_ended" | "applied";

export type LeadActivity = {
  id: string;
  kind: LeadActivityKind;
  body: string;
  actor: PersonRef | null;
  createdAt: string;
};

/**
 * One stage of the lead's journey, in pipeline order, for the stage tracker:
 *  done      finished and moved on            waived    skipped on purpose (with who and why)
 *  current   where the lead is now            upcoming  not reached yet
 * Going back to a stage reopens it and every stage after it.
 */
export type LeadJourneyState = "done" | "waived" | "current" | "upcoming";
export type LeadJourneyStage = {
  stage: LeadStage;
  label: string;
  hint: string;
  state: LeadJourneyState;
  /** When it was completed or waived; null for stages finished before this was recorded. */
  at: string | null;
  by: PersonRef | null;
  note: string | null;
};

export type AmbassadorStepView = {
  key: AmbassadorStepKey;
  label: string;
  description: string;
  status: AmbassadorStepStatus;
  completedAt: string | null;
  completedBy: PersonRef | null;
  note: string | null;
};

export type TrainingCourseProgress = {
  courseId: string;
  title: string;
  startUrl: string;
  completedAt: string | null;
};

export type AmbassadorChecklist = {
  startedAt: string;
  invitedAt: string | null;
  steps: AmbassadorStepView[];
  training: TrainingCourseProgress[];
  /** Every step done or waived and a member account linked. */
  readyToCertify: boolean;
};

export type AdminLeadDetail = AdminLeadSummary & {
  phone: string | null;
  linkedinUrl: string | null;
  referredBy: string | null;
  hoursPerWeek: number | null;
  motivation: string | null;
  notes: string | null;
  scores: LeadScores;
  member: { id: string; handle: string; name: string } | null;
  createdBy: PersonRef | null;
  /** The chapter for the lead's country, if one exists. */
  chapter: { id: string; slug: string; name: string } | null;
  /** The seven pipeline stages and where the lead stands in each. */
  journey: LeadJourneyStage[];
  /** The onboarding checklist, once onboarding has started. */
  checklist: AmbassadorChecklist | null;
  certifiedAt: string | null;
  founding: boolean;
  activity: LeadActivity[];
};

export type TeamMember = PersonRef & { email: string };

export type ManagerView = {
  userId: string;
  name: string;
  email: string;
  /** Empty with allCountries = true: covers every country. */
  countries: CountryRef[];
  allCountries: boolean;
  /** "invited" until their first sign-in. */
  status: "invited" | "active";
  mfaEnabled: boolean;
  grantedAt: string;
  openLeads: number;
};

export type AmbassadorTrainingView = {
  courses: { id: string; title: string; startUrl: string; thumbnailUrl: string | null; available: boolean }[];
};

/* ===================== Member side: apply, nominate, onboarding ===================== */
/*
 *  GET  /ambassadors/me             MyAmbassadorView (member). Also ticks the "profile" step once the
 *                                   profile has a photo and bio.
 *  POST /ambassadors/me/agreement   SignAgreementInput → MyAmbassadorView. Onboarding only.
 *  POST /ambassadors/applications   AmbassadorApplicationInput → MyAmbassadorView (verified members).
 *  POST /ambassadors/nominations    AmbassadorNominationInput → 202 { ok: true } (verified members).
 *                                   Always 202, so it never reveals whether someone is already a lead.
 */

/**
 * DRAFT for legal review. Bump AMBASSADOR_AGREEMENT_VERSION whenever the text changes: signatures
 * record the version they were given.
 */
export const AMBASSADOR_AGREEMENT_VERSION = "2026-11-draft";

export const AMBASSADOR_AGREEMENT: { title: string; intro: string; clauses: { heading: string; body: string }[] } = {
  title: "Ambassador Agreement and Code of Conduct",
  intro:
    "Charter Mission Ambassadors lead a country chapter on behalf of the community. This agreement sets out what we ask of you and what you can expect from us. It is a volunteer role: it is not employment and carries no pay.",
  clauses: [
    {
      heading: "Your term",
      body: "Your term runs for 12 months from the day your badge goes live. Either side may end it earlier with notice. When it ends, your profile shows an Alumni Ambassador badge unless you were removed under this agreement.",
    },
    {
      heading: "What you will do",
      body: "Represent the chapter in good faith, welcome new members, host at least one chapter event each quarter and keep the community team informed of anything that affects the chapter.",
    },
    {
      heading: "Non-partisan pledge",
      body: "You will not use the Ambassador title, the chapter or Charter Mission channels to campaign for or against any political party, candidate or government, or to raise funds for one.",
    },
    {
      heading: "Conduct",
      body: "Follow the Community Guidelines in everything you post and host. Treat members with respect regardless of country, faith, ethnicity, gender or background. Report harassment and safety concerns to the community team straight away.",
    },
    {
      heading: "Name and brand",
      body: "Use the Charter Mission name and badge only for chapter activity. Do not sign contracts, accept sponsorship or speak to the press on behalf of Charter Mission without written approval from the community team.",
    },
    {
      heading: "Members' data",
      body: "Use member details you see only to run the chapter. Do not export, sell or share them, and do not add members to outside mailing lists without their consent.",
    },
    {
      heading: "Conflicts of interest",
      body: "Tell the community team about any business or role that could conflict with the chapter's interests, including paid work for organisations that sponsor or partner with chapter events.",
    },
    {
      heading: "Ending the role",
      body: "Charter Mission may end your term if you breach this agreement or the Community Guidelines. We will tell you why and give you a chance to respond, unless members' safety requires us to act at once.",
    },
  ],
};

export const SignAgreementInput = z.object({
  /** Typed full name, recorded as the signature. */
  fullName: z.string().trim().min(2, "Type your full name to sign").max(120),
  accept: z.literal(true, { error: "Tick the box to confirm you agree" }),
  /** The version shown to the member; refused if the text has changed since. */
  version: z.string().max(40),
});
export type SignAgreementInput = z.input<typeof SignAgreementInput>;

const optUrl = z
  .url("Enter a full link, starting with https://")
  .max(500)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const AmbassadorApplicationInput = z.object({
  countryCode: CountryCode,
  city: optText(80),
  phone: optText(40),
  organisation: optText(120),
  jobTitle: optText(120),
  linkedinUrl: optUrl,
  hoursPerWeek: z.number().int().min(1, "At least 1 hour a week").max(80),
  motivation: z.string().trim().min(80, "Tell us a little more (80 characters or more)").max(3000),
});
export type AmbassadorApplicationInput = z.input<typeof AmbassadorApplicationInput>;

export const AmbassadorNominationInput = z.object({
  fullName: z.string().trim().min(2, "Enter their full name").max(120),
  email: z
    .email("Enter a valid email")
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  countryCode: CountryCode,
  organisation: optText(120),
  linkedinUrl: optUrl,
  reason: z.string().trim().min(30, "Tell us why (30 characters or more)").max(1500),
});
export type AmbassadorNominationInput = z.input<typeof AmbassadorNominationInput>;

/** Where the viewer stands in the programme. "closed": declined, talent pool or withdrawn. */
export type MyAmbassadorStatus = "none" | "in_review" | "onboarding" | "ambassador" | "alumni" | "closed";

export type MyAmbassadorStep = {
  key: AmbassadorStepKey;
  label: string;
  description: string;
  status: AmbassadorStepStatus;
  completedAt: string | null;
  /** The member can complete it here (agreement) or it ticks itself from their own actions. */
  selfServe: boolean;
};

export type MyAmbassadorView = {
  status: MyAmbassadorStatus;
  country: CountryRef | null;
  chapter: { slug: string; name: string } | null;
  appliedAt: string | null;
  /** Applications are open: no lead yet, withdrawn, or closed six months or more ago. */
  canApply: boolean;
  /** When a closed application can be made again; null if it can be made now or never applies. */
  reapplyFrom: string | null;
  onboarding: {
    steps: MyAmbassadorStep[];
    training: { courseId: string; title: string; startUrl: string; completedAt: string | null }[];
    done: number;
    total: number;
  } | null;
  agreement: { version: string; signedAt: string; signedName: string } | null;
  certifiedAt: string | null;
  founding: boolean;
};
