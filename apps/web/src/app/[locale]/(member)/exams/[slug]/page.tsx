import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache, type ReactNode } from "react";
import { EXAM_LANGUAGE_NAMES, type ExamAttemptSummary, type ExamDetail } from "@chartermission/contracts";
import { Icon, Panel, cn, type IconName } from "@chartermission/ui";
import { PageShell } from "@/components/discover/page-shell";
import { ExamStatusChip } from "@/components/exams/exam-card";
import { ExamText } from "@/components/exams/exam-text";
import { attemptHref, attemptsText, clock, timeLimitText } from "@/components/exams/format";
import { StartExamButton } from "@/components/exams/start-exam-button";
import { CertificateCard } from "@/components/exams/certificate-card";
import { absoluteDateTime } from "@/components/social/format";
import { Bone, LoadingStatus } from "@/components/social/skeletons";
import { Toaster } from "@/components/social/toast";
import { apiGetOrNull, requireViewer } from "@/lib/api/server";
import { NoTranslate } from "@/i18n/auto";
import { T } from "@/i18n/client";
import { getIntlTag, getT } from "@/i18n/server";

type Props = PageProps<"/[locale]/exams/[slug]">;

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/i;

/** The exam, if this member may see it. Deduplicated per request. */
const getExam = cache(async (slug: string): Promise<ExamDetail | null> => {
  if (!SLUG.test(slug)) return null;
  return apiGetOrNull<ExamDetail>(`/exams/${encodeURIComponent(slug)}`);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const exam = await getExam(slug).catch(() => null);
  if (!exam) return { title: "Exam" };
  return { title: exam.title, description: exam.description.replace(/\s+/g, " ").trim().slice(0, 160) };
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-h3 text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon name={icon} size={18} className="mt-0.5 shrink-0 text-secondary" />
      <dt className="w-28 shrink-0 text-sm text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

function Rule({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm text-body">
      <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
      <span>{children}</span>
    </li>
  );
}

/** Start, continue or retake, or why the member can't right now; then the exam's facts. */
async function ExamActions({ exam }: { exam: ExamDetail }) {
  const t = await getT();
  const { viewer } = exam;
  const closed = exam.status === "archived";
  const outOfAttempts = viewer.attemptsLeft === 0 && !viewer.inProgressAttemptId;
  const empty = exam.questionCount === 0;
  return (
    <Panel className="flex flex-col gap-4 p-5">
      {closed ? (
        <p role="status" className="rounded-[10px] bg-muted p-3.5 text-sm text-body">
          This exam is closed. Your results are still here.
        </p>
      ) : empty ? (
        <p role="status" className="rounded-[10px] bg-muted p-3.5 text-sm text-body">
          This exam has no questions yet.
        </p>
      ) : outOfAttempts ? (
        <p role="status" className="rounded-[10px] bg-muted p-3.5 text-sm text-body">
          You’ve used all your attempts for this exam.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <StartExamButton
            examId={exam.id}
            slug={exam.slug}
            block
            timeLimitMinutes={exam.timeLimitMinutes}
            resumeAttemptId={viewer.inProgressAttemptId}
            label={viewer.inProgressAttemptId ? t("Continue the exam") : viewer.attempts > 0 ? t("Take it again") : t("Start the exam")}
          />
          <p className="text-center text-xs text-secondary">
            {viewer.inProgressAttemptId
              ? "You have an attempt in progress."
              : viewer.attemptsLeft !== null
                ? t("{count} attempts left", { count: viewer.attemptsLeft })
                : "You can take it as many times as you like."}
          </p>
        </div>
      )}
      <dl className="flex flex-col divide-y divide-line border-y border-line">
        <Fact icon="clipboard" label="Questions">
          {exam.questionCount}
        </Fact>
        <Fact icon="clock" label="Time limit">
          {timeLimitText(t, exam.timeLimitMinutes)}
        </Fact>
        <Fact icon="target" label="Pass mark">
          {exam.passPercent}%
        </Fact>
        <Fact icon="repeat" label="Attempts">
          {attemptsText(t, exam.maxAttempts)}
        </Fact>
        <Fact icon="globe" label="Language">
          <NoTranslate>{[exam.language, exam.secondLanguage].filter((l) => l !== null).map((l) => EXAM_LANGUAGE_NAMES[l]).join(" · ")}</NoTranslate>
        </Fact>
        {viewer.bestPercent !== null && (
          <Fact icon="chart" label="Your best">
            {viewer.bestPercent}%
          </Fact>
        )}
      </dl>
    </Panel>
  );
}

async function Attempts({ exam, attempts }: { exam: ExamDetail; attempts: ExamAttemptSummary[] }) {
  const intl = await getIntlTag();
  return (
    <Panel className="flex flex-col divide-y divide-line">
      {attempts.map((a) => {
        const done = a.status === "submitted";
        return (
          <div key={a.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 max-sm:px-4">
            <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium text-ink">
                <T vars={{ number: a.number }}>{"Attempt {number}"}</T>
              </span>
              <time dateTime={a.submittedAt ?? a.startedAt} className="text-xs text-secondary" suppressHydrationWarning>
                {absoluteDateTime(intl, a.submittedAt ?? a.startedAt)}
                {done && a.durationSeconds !== null && ` · ${clock(a.durationSeconds)}`}
              </time>
            </div>
            {done ? (
              <>
                <span className="text-sm text-body tabular-nums">
                  <span className="font-semibold text-ink">{a.percent}%</span> ({a.correct}/{a.total})
                </span>
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", a.passed ? "bg-success-light text-success" : "bg-muted text-body")}>{a.passed ? "Passed" : "Not passed"}</span>
              </>
            ) : (
              <span className="rounded-full bg-info-light px-2.5 py-0.5 text-xs font-semibold text-info">In progress</span>
            )}
            <Link href={attemptHref(exam.slug, a.id)} className="flex items-center gap-1 rounded-sm text-sm font-medium text-primary-light hover:underline">
              {done ? "View result" : "Continue"}
              <Icon name="chevron-right" size={16} className="rtl:rotate-180" />
            </Link>
          </div>
        );
      })}
    </Panel>
  );
}

async function ExamMain({ params }: { params: Props["params"] }) {
  const { slug } = await params;
  const viewer = await requireViewer(`/exams/${slug}`);
  const exam = await getExam(slug);
  if (!exam) notFound();
  const t = await getT();
  const text = { language: exam.language, secondLanguage: exam.secondLanguage };

  return (
    <>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary-tint-2 text-primary-light">
            <Icon name="clipboard" size={18} />
          </span>
          <span className="text-sm font-medium text-secondary">Exam</span>
          <ExamStatusChip exam={exam} />
        </div>
        <h1 className="text-h1 text-ink max-sm:text-h2">
          <ExamText text={exam.title} alt={exam.titleAlt} {...text} align="page" altClassName="text-h3 font-normal text-body" />
        </h1>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_360px] items-start gap-8 max-lg:grid-cols-1 max-lg:gap-6">
        <aside aria-label="Take this exam" className="lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1">
          <ExamActions exam={exam} />
        </aside>

        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-1">
          {exam.certificate && <CertificateCard examId={exam.id} initial={exam.certificate} finishProfile={!viewer.onboarding.completed} />}

          {!exam.certificate && exam.status !== "draft" && (
            <p className="flex items-start gap-2.5 rounded-[10px] bg-primary-tint-2 p-3.5 text-sm text-ink">
              <Icon name="clipboard" size={18} className="mt-0.5 shrink-0 text-primary-light" />
              <span>
                <span className="font-medium">Pass to earn your Charter Center certificate.</span> It arrives here to download, and is shared on the feed so the community can congratulate you.
              </span>
            </p>
          )}

          {exam.status === "draft" && (
            <p role="status" className="flex items-start gap-2.5 rounded-[10px] bg-warning-light p-3.5 text-sm text-ink">
              <Icon name="eye-off" size={18} className="mt-0.5 shrink-0 text-warning" />
              <span>
                <span className="font-medium">This exam is a draft.</span> Only the Charter Mission team can see it. You can take it to check it; your tries aren’t counted in the results.
              </span>
            </p>
          )}

          {(exam.description || exam.descriptionAlt) && (
            <Section id="about-exam" title="About this exam">
              <div className="text-md leading-7 text-body">
                <ExamText text={exam.description} alt={exam.descriptionAlt} {...text} />
              </div>
            </Section>
          )}

          {exam.sections.length > 0 && (
            <Section id="exam-sections" title="What it covers">
              <Panel className="flex flex-col divide-y divide-line">
                {exam.sections.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 py-3 max-sm:px-4">
                    <span className="min-w-[200px] flex-1 text-sm font-medium text-ink">
                      <ExamText text={s.title} alt={s.titleAlt} {...text} align="page" altClassName="font-normal text-secondary" />
                    </span>
                    <span className="text-sm text-secondary tabular-nums">
                      {t("{count} questions", { count: s.questionCount })} · {exam.questionCount ? Math.round((s.questionCount * 100) / exam.questionCount) : 0}%
                    </span>
                  </div>
                ))}
              </Panel>
            </Section>
          )}

          <Section id="exam-rules" title="How it works">
            <Panel className="p-5">
              <ul className="flex flex-col gap-3">
                <Rule>One question at a time. You can go back and change an answer until you finish.</Rule>
                <Rule>
                  {exam.timeLimitMinutes
                    ? t("You have {count} minutes. The clock starts when you begin and keeps running if you leave the page.", { count: exam.timeLimitMinutes })
                    : "There is no time limit. You can leave and come back to finish."}
                </Rule>
                <Rule>Your answers are saved as you go, so a dropped connection doesn’t lose them.</Rule>
                <Rule>{t("You pass with {percent}% or more.", { percent: exam.passPercent })}</Rule>
                <Rule>
                  {exam.review === "full"
                    ? "When you finish, you see your score, the correct answer to every question and a short explanation."
                    : "When you finish, you see your score."}
                </Rule>
              </ul>
            </Panel>
          </Section>

          {exam.attempts.length > 0 && (
            <Section id="exam-attempts" title="Your attempts">
              <Attempts exam={exam} attempts={exam.attempts} />
            </Section>
          )}

          {exam.credit && (
            <p className="text-xs text-secondary">
              <NoTranslate>
                <bdi>{exam.credit}</bdi>
              </NoTranslate>
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function ExamSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Bone className="h-9 w-40 rounded-full" />
        <Bone className="h-10 w-[60%]" />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-8 max-lg:grid-cols-1">
        <div className="flex flex-col gap-3">
          {[92, 86, 60].map((w, i) => (
            <Bone key={i} className="h-4" style={{ width: `${w}%` }} />
          ))}
          <Bone className="mt-4 h-48 w-full rounded-card" />
        </div>
        <Bone className="h-[380px] w-full rounded-card max-lg:order-first max-lg:h-[260px]" />
      </div>
    </div>
  );
}

/** An exam's page: what it covers, the rules, the member's attempts and the button that starts it. */
export default function ExamPage({ params }: Props) {
  return (
    <PageShell className="gap-6 max-sm:px-4 max-sm:pt-4">
      <Link href="/learning" className="flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-primary-light hover:underline">
        <Icon name="chevron-left" size={18} className="rtl:rotate-180" />
        Learning
      </Link>
      <Suspense
        fallback={
          <>
            <LoadingStatus label="Loading the exam" />
            <ExamSkeleton />
          </>
        }
      >
        <ExamMain params={params} />
      </Suspense>
      <Toaster />
    </PageShell>
  );
}
