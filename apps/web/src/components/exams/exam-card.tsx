import Link from "next/link";
import type { ExamSummary } from "@chartermission/contracts";
import { Chip, Icon, cn } from "@chartermission/ui";
import { NoTranslate } from "@/i18n/auto";
import { getT } from "@/i18n/server";
import type { Translate } from "@/i18n/translate";
import { ExamText } from "./exam-text";
import { examHref, timeLimitText } from "./format";

/** "50 questions · 60 minutes · Pass mark 70%" */
export function examMeta(t: Translate, exam: Pick<ExamSummary, "questionCount" | "timeLimitMinutes" | "passPercent">): string {
  return [t("{count} questions", { count: exam.questionCount }), timeLimitText(t, exam.timeLimitMinutes), t("Pass mark {percent}%", { percent: exam.passPercent })].join(" · ");
}

/** Where the member stands with an exam, as a chip (or nothing before the first attempt). */
export function ExamStatusChip({ exam }: { exam: Pick<ExamSummary, "status" | "viewer"> }) {
  const chip = "px-2.5 py-0.5 text-xs";
  if (exam.status === "draft") return <Chip tone="warning" className={chip}>Draft · team only</Chip>;
  if (exam.status === "archived") return <Chip tone="neutral" className={chip}>No longer open</Chip>;
  if (exam.viewer.inProgressAttemptId) return <Chip tone="info" className={chip}>In progress</Chip>;
  if (exam.viewer.passed) return <Chip tone="success" className={chip}>Passed</Chip>;
  return null;
}

/** White card for an exam on the Learning page. The whole card opens the exam's page. */
export async function ExamCard({ exam, className }: { exam: ExamSummary; className?: string }) {
  const t = await getT();
  const { viewer } = exam;
  const action = viewer.inProgressAttemptId ? "Continue" : viewer.attempts > 0 ? "View your results" : "View exam";
  return (
    <article
      className={cn(
        "group relative flex w-full flex-col gap-3 rounded-card border border-line bg-card p-5 transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-[0px_8px_20px_-8px_rgba(25,37,80,0.25)] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-primary-light",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary-tint-2 text-primary-light">
          <Icon name="clipboard" size={18} />
        </span>
        <ExamStatusChip exam={exam} />
        {viewer.bestPercent !== null && <span className="ms-auto text-xs text-secondary">{t("Best score {percent}%", { percent: viewer.bestPercent })}</span>}
      </div>
      <h3 className="text-h3 text-ink">
        <Link href={examHref(exam.slug)} className="outline-none after:absolute after:inset-0 after:content-[''] group-hover:text-primary-light">
          <ExamText text={exam.title} alt={exam.titleAlt} language={exam.language} secondLanguage={exam.secondLanguage} align="page" altClassName="text-md font-normal text-secondary" />
        </Link>
      </h3>
      {exam.description && (
        <p className="line-clamp-2 text-sm text-body">
          <NoTranslate>
            <bdi>{exam.description}</bdi>
          </NoTranslate>
        </p>
      )}
      <p className="text-xs text-secondary">{examMeta(t, exam)}</p>
      <span aria-hidden="true" className="mt-auto flex items-center gap-1 pt-1 text-sm font-medium text-primary-light">
        {action}
        <Icon name="chevron-right" size={16} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none rtl:rotate-180" />
      </span>
    </article>
  );
}
