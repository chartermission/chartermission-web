import { z } from "zod";

/*
 * Exams: multiple-choice exams members take on Charter Mission (for example a Charter Center
 * practice or final exam). Staff build them in the admin console; the API marks them, so the
 * correct answers never reach the browser before an attempt is submitted.
 *
 * Exams are by invitation: an exam's link (/exams/{slug}/join) gives whoever opens it while signed
 * in (or signs up from it) that exam for good. It then shows on their Learning page, even while
 * e-learning itself is still locked. Nobody else sees it. Every exam awards a Charter Center
 * certificate to those who pass.
 *
 * An exam can be written in two languages side by side (English with Arabic, say): every text has
 * an optional second-language version, and the member chooses which to read.
 *
 * Member API (/api/v1):
 *  GET  /exams                       ExamSummary[] — the exams the viewer was invited to, with their own
 *                                    progress. Staff with exam.manage see every exam, drafts included.
 *  POST /exams/:slug/access          ExamSummary. The invitation link: gives the viewer this published
 *                                    exam (once; later calls change nothing). NOT_FOUND otherwise.
 *  GET  /exams/:slug                 ExamDetail. Only for members the exam was given to (and staff with
 *                                    exam.manage, who can also preview drafts); NOT_FOUND for others.
 *  POST /exams/:id/attempts          201 ExamAttemptView. Starts an attempt, or returns the one in
 *                                    progress. CONFLICT when no attempts are left.
 *  GET  /exam-attempts/:id           ExamAttemptView (own attempts only). An attempt whose time has
 *                                    run out is marked here with the answers saved so far.
 *  PUT  /exam-attempts/:id/answers   SaveExamAnswerInput → ExamAnswerSaved. Saves one answer and/or
 *                                    its "review later" flag as the member goes.
 *  POST /exam-attempts/:id/submit    ExamAttemptView with the result.
 *
 * Admin API (admin audience, needs exam.manage):
 *  GET    /admin/exams                          AdminExamSummary[]
 *  POST   /admin/exams                          ExamSettingsInput → AdminExamDetail (a draft)
 *  POST   /admin/exams/import                   ExamImportInput → AdminExamDetail (a draft with its questions)
 *  GET    /admin/exams/:id                      AdminExamDetail
 *  PATCH  /admin/exams/:id                      UpdateExamInput → AdminExamDetail (settings, publish, archive)
 *  DELETE /admin/exams/:id                      Ok. Only exams nobody has taken; archive the others.
 *  PUT    /admin/exams/:id/sections             ExamSectionsInput → AdminExamDetail
 *  POST   /admin/exams/:id/questions            ExamQuestionInput → AdminExamDetail
 *  POST   /admin/exams/:id/questions/import     ExamQuestionsImportInput → AdminExamDetail (adds to the end)
 *  PUT    /admin/exams/:id/questions/order      ExamQuestionOrderInput → AdminExamDetail
 *  PATCH  /admin/exams/:id/questions/:qid       ExamQuestionInput → AdminExamDetail
 *  DELETE /admin/exams/:id/questions/:qid       AdminExamDetail
 *  GET    /admin/exams/:id/attempts             Page<AdminExamAttempt>; AdminExamAttemptsQuery
 *  GET    /admin/exams/:id/invites              ExamInviteRow[]
 *  POST   /admin/exams/:id/invites              SendExamInvitesInput → SendExamInvitesResult
 *  POST   /admin/exam-certificates/:id/retry    Ok. Ask Charter Center again now.
 *  GET    /admin/exams-settings                 ExamsAdminSettings
 *  PUT    /admin/exams-settings                 UpdateExamsSettingsInput → ExamsAdminSettings
 *
 * Public (no session):
 *  GET  /exam-join/:slug            ExamJoinInfo — what the invitation page shows before signing in.
 *
 *  GET  /exams/:id/certificate      ExamCertificateView | null (member: their own)
 */

/** Permission strings used by Exams (apps/api/src/core/permissions.ts). */
export const EXAM_PERMISSIONS = {
  /** Build, publish and remove exams; see members' results. platform_admin, super_admin. */
  manage: "exam.manage",
} as const;

export const EXAM_MAX_QUESTIONS = 300;
export const EXAM_MAX_SECTIONS = 30;
export const EXAM_MIN_OPTIONS = 2;
export const EXAM_MAX_OPTIONS = 6;
/** Answers that arrive this long after the time limit are still accepted (slow connections). */
export const EXAM_GRACE_SECONDS = 20;

export const ExamStatus = z.enum(["draft", "published", "archived"]);
export type ExamStatus = z.infer<typeof ExamStatus>;

/** After submitting — full: score, the correct answers and explanations · score_only: the score and nothing else. */
export const ExamReview = z.enum(["full", "score_only"]);
export type ExamReview = z.infer<typeof ExamReview>;

export const ExamLanguage = z.enum(["en", "ar", "fr"]);
export type ExamLanguage = z.infer<typeof ExamLanguage>;

export const EXAM_LANGUAGE_NAMES: Record<ExamLanguage, string> = { en: "English", ar: "العربية", fr: "Français" };

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .nullish()
    .transform((v) => (v ? v : null));

/* ---------------- Admin inputs ---------------- */

const settingsShape = {
  title: z.string().trim().min(3, "Give the exam a title").max(160, "At most 160 characters"),
  /** The title in the second language. */
  titleAlt: optionalText(160),
  /** Shown on the exam's page before starting. Plain text or simple Markdown. */
  description: z.string().trim().max(4000, "At most 4,000 characters").default(""),
  descriptionAlt: optionalText(4000),
  language: ExamLanguage.default("en"),
  /** Second language the questions are also written in; null for a one-language exam. */
  secondLanguage: ExamLanguage.nullish().transform((v) => v ?? null),
  /** Minutes allowed per attempt; null = no time limit. */
  timeLimitMinutes: z.number().int().min(1, "At least 1 minute").max(600, "At most 600 minutes").nullish().transform((v) => v ?? null),
  /** Share of questions needed to pass. */
  passPercent: z.number().int().min(1, "Between 1 and 100").max(100, "Between 1 and 100").default(70),
  /** Attempts each member may make; null = no limit. */
  maxAttempts: z.number().int().min(1, "At least 1").max(50, "At most 50").nullish().transform((v) => v ?? null),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  review: ExamReview.default("full"),
  /** Who wrote the questions, or a disclaimer, shown under the exam. */
  credit: optionalText(300),
  /** Post the certificate on the member's behalf, shown in everyone's feed. */
  shareCertificates: z.boolean().default(true),
};

const differentLanguages = (v: { language?: string; secondLanguage?: string | null }) => !v.secondLanguage || v.secondLanguage !== v.language;
const LANGUAGE_MESSAGE = { message: "Choose a second language different from the first", path: ["secondLanguage"] };

/** POST /admin/exams */
export const ExamSettingsInput = z.object(settingsShape).refine(differentLanguages, LANGUAGE_MESSAGE);
export type ExamSettingsInput = z.infer<typeof ExamSettingsInput>;

/** PATCH /admin/exams/:id — any of the settings, and/or the status (publish, unpublish, archive). */
export const UpdateExamInput = z
  .object({
    title: settingsShape.title.optional(),
    titleAlt: z.string().trim().max(160).nullable().optional(),
    description: z.string().trim().max(4000).optional(),
    descriptionAlt: z.string().trim().max(4000).nullable().optional(),
    language: ExamLanguage.optional(),
    secondLanguage: ExamLanguage.nullable().optional(),
    timeLimitMinutes: z.number().int().min(1, "At least 1 minute").max(600, "At most 600 minutes").nullable().optional(),
    passPercent: z.number().int().min(1, "Between 1 and 100").max(100, "Between 1 and 100").optional(),
    maxAttempts: z.number().int().min(1, "At least 1").max(50, "At most 50").nullable().optional(),
    shuffleQuestions: z.boolean().optional(),
    shuffleOptions: z.boolean().optional(),
    review: ExamReview.optional(),
    credit: z.string().trim().max(300).nullable().optional(),
    shareCertificates: z.boolean().optional(),
    status: ExamStatus.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to change");
export type UpdateExamInput = z.infer<typeof UpdateExamInput>;

export const ExamSectionInput = z.object({
  /** Existing section to keep; leave out for a new one. */
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "Name the section").max(160, "At most 160 characters"),
  titleAlt: optionalText(160),
});
export type ExamSectionInput = z.infer<typeof ExamSectionInput>;

/** PUT /admin/exams/:id/sections — the whole list in order. Sections left out are removed (their questions stay, unsectioned). */
export const ExamSectionsInput = z.object({ sections: z.array(ExamSectionInput).max(EXAM_MAX_SECTIONS, `At most ${EXAM_MAX_SECTIONS} sections`) });
export type ExamSectionsInput = z.infer<typeof ExamSectionsInput>;

export const ExamOptionInput = z.object({
  /** Existing option to keep (so earlier answers still point at it); leave out for a new one. */
  id: z.string().max(20).optional(),
  text: z.string().trim().min(1, "Write the answer").max(500, "At most 500 characters"),
  textAlt: optionalText(500),
});
export type ExamOptionInput = z.infer<typeof ExamOptionInput>;

const questionShape = {
  /** Short reference shown beside the question number, e.g. "ECO 1.1". */
  reference: optionalText(60),
  /** Short label such as "Calculation". */
  tag: optionalText(40),
  prompt: z.string().trim().min(1, "Write the question").max(2000, "At most 2,000 characters"),
  promptAlt: optionalText(2000),
  options: z
    .array(ExamOptionInput)
    .min(EXAM_MIN_OPTIONS, `Add at least ${EXAM_MIN_OPTIONS} answers`)
    .max(EXAM_MAX_OPTIONS, `At most ${EXAM_MAX_OPTIONS} answers`),
  /** Position of the correct answer in `options` (0 = first). */
  correctIndex: z.number().int().min(0),
  /** Shown with the correct answer after the exam (review "full"). */
  explanation: z.string().trim().max(2000, "At most 2,000 characters").default(""),
  explanationAlt: optionalText(2000),
};

const correctInRange = (v: { options: unknown[]; correctIndex: number }) => v.correctIndex < v.options.length;
const CORRECT_MESSAGE = { message: "Mark one of the answers as correct", path: ["correctIndex"] };

/** POST /admin/exams/:id/questions and PATCH /admin/exams/:id/questions/:qid */
export const ExamQuestionInput = z
  .object({ ...questionShape, sectionId: z.string().uuid().nullish().transform((v) => v ?? null) })
  .refine(correctInRange, CORRECT_MESSAGE);
export type ExamQuestionInput = z.infer<typeof ExamQuestionInput>;

/** A question in an import: the section is given by its title (created when the exam doesn't have it yet). */
export const ExamImportQuestion = z
  .object({ ...questionShape, section: optionalText(160), sectionAlt: optionalText(160) })
  .refine(correctInRange, CORRECT_MESSAGE);
export type ExamImportQuestion = z.infer<typeof ExamImportQuestion>;

const importQuestions = z
  .array(ExamImportQuestion)
  .min(1, "Add at least one question")
  .max(EXAM_MAX_QUESTIONS, `At most ${EXAM_MAX_QUESTIONS} questions`);

/** POST /admin/exams/:id/questions/import */
export const ExamQuestionsImportInput = z.object({ questions: importQuestions });
export type ExamQuestionsImportInput = z.infer<typeof ExamQuestionsImportInput>;

/** POST /admin/exams/import — a whole exam in one go (always created as a draft). */
export const ExamImportInput = z
  .object({
    ...settingsShape,
    /** Link name; made from the title when left out. */
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,79}$/, "Lowercase letters, numbers and hyphens")
      .optional(),
    /** Sections in order. Sections named only on questions are added after these. */
    sections: z
      .array(z.object({ title: z.string().trim().min(1).max(160), titleAlt: optionalText(160) }))
      .max(EXAM_MAX_SECTIONS)
      .default([]),
    questions: importQuestions,
  })
  .refine(differentLanguages, LANGUAGE_MESSAGE);
export type ExamImportInput = z.infer<typeof ExamImportInput>;

/** PUT /admin/exams/:id/questions/order — every question id of the exam, in the new order. */
export const ExamQuestionOrderInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(EXAM_MAX_QUESTIONS) });
export type ExamQuestionOrderInput = z.infer<typeof ExamQuestionOrderInput>;

/* ---------------- Shared shapes ---------------- */

export const ExamOption = z.object({ id: z.string(), text: z.string(), textAlt: z.string().nullable() });
export type ExamOption = z.infer<typeof ExamOption>;

export const ExamSection = z.object({
  id: z.string().uuid(),
  title: z.string(),
  titleAlt: z.string().nullable(),
  questionCount: z.number().int(),
});
export type ExamSection = z.infer<typeof ExamSection>;

/* ---------------- Certificates ---------------- */

/**
 * pending: asked Charter Center, not there yet (we keep asking for about two days) ·
 * issued: received, stored and (when the exam shares certificates) posted · failed: gave up.
 */
export const ExamCertificateStatus = z.enum(["pending", "issued", "failed"]);
export type ExamCertificateStatus = z.infer<typeof ExamCertificateStatus>;

/** A member's Charter Center certificate for an exam they passed. */
export const ExamCertificateView = z.object({
  id: z.string().uuid(),
  status: ExamCertificateStatus,
  /** Charter Center's reference, printed on the certificate. */
  certificateId: z.string().nullable(),
  /** The certificate as a picture (also the image of the feed post). */
  imageUrl: z.string().nullable(),
  /** The PDF, downloaded as a file. */
  downloadUrl: z.string().nullable(),
  /** The post that shared it, while it exists. */
  postId: z.string().uuid().nullable(),
  issuedAt: z.string().nullable(),
});
export type ExamCertificateView = z.infer<typeof ExamCertificateView>;

/* ---------------- Member views ---------------- */

/** The viewer's own progress on an exam. */
export const ExamViewerProgress = z.object({
  /** Finished attempts. */
  attempts: z.number().int(),
  /** Attempts still allowed; null = no limit. */
  attemptsLeft: z.number().int().nullable(),
  bestPercent: z.number().int().nullable(),
  passed: z.boolean(),
  /** An attempt that was started and not yet submitted. */
  inProgressAttemptId: z.string().uuid().nullable(),
  /** The most recent finished attempt, to open its result. */
  lastAttemptId: z.string().uuid().nullable(),
});
export type ExamViewerProgress = z.infer<typeof ExamViewerProgress>;

/** Exam card / list row. */
export const ExamSummary = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  titleAlt: z.string().nullable(),
  description: z.string(),
  descriptionAlt: z.string().nullable(),
  language: ExamLanguage,
  secondLanguage: ExamLanguage.nullable(),
  status: ExamStatus,
  questionCount: z.number().int(),
  timeLimitMinutes: z.number().int().nullable(),
  passPercent: z.number().int(),
  maxAttempts: z.number().int().nullable(),
  viewer: ExamViewerProgress,
});
export type ExamSummary = z.infer<typeof ExamSummary>;

export const ExamAttemptSummary = z.object({
  id: z.string().uuid(),
  /** 1 for the member's first attempt at this exam, 2 for the second… */
  number: z.number().int(),
  status: z.enum(["in_progress", "submitted"]),
  startedAt: z.string(),
  submittedAt: z.string().nullable(),
  correct: z.number().int(),
  total: z.number().int(),
  percent: z.number().int(),
  passed: z.boolean(),
  /** Submitted automatically when the time ran out. */
  timedOut: z.boolean(),
  durationSeconds: z.number().int().nullable(),
});
export type ExamAttemptSummary = z.infer<typeof ExamAttemptSummary>;

/** GET /exams/:slug */
export const ExamDetail = ExamSummary.extend({
  review: ExamReview,
  shuffleQuestions: z.boolean(),
  credit: z.string().nullable(),
  sections: z.array(ExamSection),
  /** The viewer's attempts, newest first. */
  attempts: z.array(ExamAttemptSummary),
  /** The viewer's certificate, once they have passed. */
  certificate: ExamCertificateView.nullable(),
});
export type ExamDetail = z.infer<typeof ExamDetail>;

/** A question as the member sees it. The answer key fields are only present after submitting an exam with review "full". */
export const ExamAttemptQuestion = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid().nullable(),
  reference: z.string().nullable(),
  tag: z.string().nullable(),
  prompt: z.string(),
  promptAlt: z.string().nullable(),
  /** In the order this attempt shows them. */
  options: z.array(ExamOption),
  selectedOptionId: z.string().nullable(),
  /** Marked "review later" by the member. */
  flagged: z.boolean(),
  correctOptionId: z.string().optional(),
  correct: z.boolean().optional(),
  explanation: z.string().optional(),
  explanationAlt: z.string().nullable().optional(),
});
export type ExamAttemptQuestion = z.infer<typeof ExamAttemptQuestion>;

export const ExamSectionScore = z.object({
  /** Null for questions outside any section. */
  id: z.string().uuid().nullable(),
  title: z.string(),
  titleAlt: z.string().nullable(),
  correct: z.number().int(),
  total: z.number().int(),
  percent: z.number().int(),
});
export type ExamSectionScore = z.infer<typeof ExamSectionScore>;

export const ExamResult = z.object({
  correct: z.number().int(),
  total: z.number().int(),
  answered: z.number().int(),
  percent: z.number().int(),
  passPercent: z.number().int(),
  passed: z.boolean(),
  timedOut: z.boolean(),
  durationSeconds: z.number().int(),
  /** Score per section, in exam order (empty when the exam has no sections). */
  sections: z.array(ExamSectionScore),
  /** Attempts the member still has; null = no limit. */
  attemptsLeft: z.number().int().nullable(),
  canRetake: z.boolean(),
});
export type ExamResult = z.infer<typeof ExamResult>;

/** GET /exam-attempts/:id */
export const ExamAttemptView = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  status: z.enum(["in_progress", "submitted"]),
  /** A staff member trying out a draft: not counted in the exam's results. */
  preview: z.boolean(),
  exam: z.object({
    id: z.string().uuid(),
    slug: z.string(),
    title: z.string(),
    titleAlt: z.string().nullable(),
    language: ExamLanguage,
    secondLanguage: ExamLanguage.nullable(),
    timeLimitMinutes: z.number().int().nullable(),
    passPercent: z.number().int(),
    review: ExamReview,
    credit: z.string().nullable(),
  }),
  startedAt: z.string(),
  /** When the time runs out; null for an exam with no time limit. */
  expiresAt: z.string().nullable(),
  /** The API's clock when this was sent, so the countdown doesn't depend on the device's clock. */
  serverNow: z.string(),
  submittedAt: z.string().nullable(),
  sections: z.array(ExamSection),
  /** In attempt order. Empty after submitting an exam with review "score_only". */
  questions: z.array(ExamAttemptQuestion),
  /** Present once submitted. */
  result: ExamResult.nullable(),
  /** Passing earns a Charter Center certificate (every exam does; a staff preview of a draft doesn't). */
  awardsCertificate: z.boolean(),
  /** The member's certificate for this exam, once a submitted attempt passed. */
  certificate: ExamCertificateView.nullable(),
});
export type ExamAttemptView = z.infer<typeof ExamAttemptView>;

/** PUT /exam-attempts/:id/answers */
export const SaveExamAnswerInput = z
  .object({
    questionId: z.string().uuid(),
    /** The chosen answer; null clears it. Leave out to change only the flag. */
    optionId: z.string().max(20).nullable().optional(),
    flagged: z.boolean().optional(),
  })
  .refine((v) => v.optionId !== undefined || v.flagged !== undefined, "Nothing to save");
export type SaveExamAnswerInput = z.infer<typeof SaveExamAnswerInput>;

export const ExamAnswerSaved = z.object({ answered: z.number().int(), serverNow: z.string(), expiresAt: z.string().nullable() });
export type ExamAnswerSaved = z.infer<typeof ExamAnswerSaved>;

/* ---------------- Admin views ---------------- */

export const AdminExamStats = z.object({
  /** Finished attempts (staff previews of a draft are not counted). */
  attempts: z.number().int(),
  /** Members with at least one finished attempt. */
  participants: z.number().int(),
  /** Members who passed at least once. */
  passedMembers: z.number().int(),
  /** Mean score of finished attempts; null when there are none. */
  averagePercent: z.number().int().nullable(),
  inProgress: z.number().int(),
});
export type AdminExamStats = z.infer<typeof AdminExamStats>;

export const AdminExamSummary = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  titleAlt: z.string().nullable(),
  status: ExamStatus,
  language: ExamLanguage,
  secondLanguage: ExamLanguage.nullable(),
  questionCount: z.number().int(),
  timeLimitMinutes: z.number().int().nullable(),
  passPercent: z.number().int(),
  maxAttempts: z.number().int().nullable(),
  stats: AdminExamStats,
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type AdminExamSummary = z.infer<typeof AdminExamSummary>;

export const AdminExamQuestion = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid().nullable(),
  reference: z.string().nullable(),
  tag: z.string().nullable(),
  prompt: z.string(),
  promptAlt: z.string().nullable(),
  options: z.array(ExamOption),
  correctOptionId: z.string(),
  explanation: z.string(),
  explanationAlt: z.string().nullable(),
});
export type AdminExamQuestion = z.infer<typeof AdminExamQuestion>;

/** GET /admin/exams/:id — the whole exam with its answer key. */
export const AdminExamDetail = AdminExamSummary.extend({
  description: z.string(),
  descriptionAlt: z.string().nullable(),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean(),
  review: ExamReview,
  credit: z.string().nullable(),
  shareCertificates: z.boolean(),
  sections: z.array(ExamSection),
  /** In exam order. */
  questions: z.array(AdminExamQuestion),
});
export type AdminExamDetail = z.infer<typeof AdminExamDetail>;

export const AdminExamAttempt = ExamAttemptSummary.extend({
  member: z.object({
    id: z.string().uuid(),
    name: z.string(),
    handle: z.string(),
    email: z.string(),
    avatarUrl: z.string().nullable(),
    countryCode: z.string().nullable(),
  }),
  answered: z.number().int(),
  /** The member's certificate for this exam (on their passing attempts). */
  certificate: z.object({ id: z.string().uuid(), status: ExamCertificateStatus, lastError: z.string().nullable() }).nullable(),
});
export type AdminExamAttempt = z.infer<typeof AdminExamAttempt>;

/** GET /admin/exams/:id/attempts — newest first. */
export const AdminExamAttemptsQuery = z.object({
  /** Member name, handle or email. */
  q: z.string().trim().max(100).optional(),
  result: z.enum(["all", "passed", "failed", "in_progress"]).default("all"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminExamAttemptsQuery = z.infer<typeof AdminExamAttemptsQuery>;

/* ---------------- The invitation link ---------------- */

/*
 * An exam's invitation link is /exams/{slug}/join. Someone signed in gets the exam at once
 * (POST /exams/:slug/access) and lands on it. Someone signed out sees the exam and is asked to
 * sign in or create a free account; the link is remembered through sign-up, and the exam is theirs
 * as soon as they are in.
 */

/** The exam as the public join page shows it (GET /exam-join/:slug). */
export const ExamJoinInfo = z.object({
  slug: z.string(),
  title: z.string(),
  titleAlt: z.string().nullable(),
  language: ExamLanguage,
  secondLanguage: ExamLanguage.nullable(),
  questionCount: z.number().int(),
  timeLimitMinutes: z.number().int().nullable(),
  passPercent: z.number().int(),
});
export type ExamJoinInfo = z.infer<typeof ExamJoinInfo>;

/* ---------------- Invitations (admin) ---------------- */

export const EXAM_INVITES_PER_REQUEST = 500;

/** POST /admin/exams/:id/invites — emails the exam's join link to each address. */
export const SendExamInvitesInput = z.object({
  emails: z
    .array(z.string().trim().toLowerCase().max(254))
    .min(1, "Add at least one email address")
    .max(EXAM_INVITES_PER_REQUEST, `Up to ${EXAM_INVITES_PER_REQUEST} addresses at a time`),
  /** A line from the team, added to the email. */
  message: z.string().trim().max(500, "At most 500 characters").nullish().transform((v) => v || null),
});
export type SendExamInvitesInput = z.infer<typeof SendExamInvitesInput>;

export const SendExamInvitesResult = z.object({
  sent: z.number().int(),
  /** Invited in the last 10 minutes already. */
  skipped: z.number().int(),
  /** Not email addresses. */
  invalid: z.array(z.string()),
});
export type SendExamInvitesResult = z.infer<typeof SendExamInvitesResult>;

/** invited: hasn't opened the link signed in yet · joined: has the exam · took: finished an attempt · passed. */
export const ExamInviteStatus = z.enum(["invited", "joined", "took", "passed"]);
export type ExamInviteStatus = z.infer<typeof ExamInviteStatus>;

export const ExamInviteRow = z.object({
  email: z.string(),
  status: ExamInviteStatus,
  sends: z.number().int(),
  firstSentAt: z.string(),
  lastSentAt: z.string(),
});
export type ExamInviteRow = z.infer<typeof ExamInviteRow>;

/* ---------------- Charter Center connection (admin) ---------------- */

export const ExamsAdminSettings = z.object({
  /** mock: sample certificates for testing (not issued on the live site) · live: Charter Center's certificate API. */
  charterCenterMode: z.enum(["mock", "live"]),
  /** The page certificate posts name and appear on (Charter Center's page on Charter Mission). */
  certificatePage: z.object({ id: z.string().uuid(), slug: z.string(), name: z.string() }).nullable(),
});
export type ExamsAdminSettings = z.infer<typeof ExamsAdminSettings>;

/** PUT /admin/exams-settings — the page by its link name (chartermission.com/pages/{slug}); null finds a page named Charter Center. */
export const UpdateExamsSettingsInput = z.object({
  certificatePageSlug: z.string().trim().toLowerCase().max(100).nullable(),
});
export type UpdateExamsSettingsInput = z.infer<typeof UpdateExamsSettingsInput>;
