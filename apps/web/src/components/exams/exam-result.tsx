"use client";

import Link from "next/link";
import { useState } from "react";
import type { ExamAttemptQuestion, ExamAttemptView } from "@chartermission/contracts";
import { Icon, Panel, SegmentedControl, buttonClasses, cn } from "@chartermission/ui";
import { BrandPattern } from "@/components/illustrations";
import { NoTranslate } from "@/i18n/auto";
import { T, useIntlTag, useT } from "@/i18n/client";
import { ExamText } from "./exam-text";
import { clock, dirOf, examHref, letterOf, type ReadMode } from "./format";
import { ReadModeSwitch, useReadMode } from "./read-mode";
import { StartExamButton } from "./start-exam-button";

type Filter = "all" | "wrong" | "flagged";

/** Score ring: the percent in the middle of a circle filled to that share. */
function ScoreRing({ percent, passed }: { percent: number; passed: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative flex size-[132px] shrink-0 items-center justify-center">
      <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-inverse/20" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, percent) / 100)}
          className={passed ? "stroke-success" : "stroke-warning"}
        />
      </svg>
      <span className="text-[34px] font-semibold leading-none text-inverse tabular-nums">{percent}%</span>
    </span>
  );
}

function ReviewQuestion({ q, number, attempt, mode }: { q: ExamAttemptQuestion; number: number; attempt: ExamAttemptView; mode: ReadMode }) {
  const { exam } = attempt;
  const section = q.sectionId ? attempt.sections.find((s) => s.id === q.sectionId) : undefined;
  const skipped = q.selectedOptionId === null;
  const contentDir = dirOf(mode === "second" && exam.secondLanguage ? exam.secondLanguage : exam.language);
  return (
    <li>
      <Panel className={cn("flex flex-col gap-4 border-s-4 p-5 max-sm:p-4", q.correct ? "border-s-success" : "border-s-error")}>
        {/* The heading row follows the page; the question below follows the language being read. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="rounded-md bg-accent px-2.5 py-1 text-sm font-semibold text-inverse tabular-nums">Q{String(number).padStart(2, "0")}</span>
          <span className="min-w-0 flex-1 text-sm text-secondary">
            <NoTranslate>
              <bdi>{[section && (mode === "second" && section.titleAlt ? section.titleAlt : section.title), q.reference].filter(Boolean).join(" · ")}</bdi>
            </NoTranslate>
          </span>
          {q.tag && (
            <span className="rounded-full border border-accent/50 px-2.5 py-0.5 text-xs font-medium text-accent-hover">
              <NoTranslate>{q.tag}</NoTranslate>
            </span>
          )}
          {q.flagged && (
            <span className="flex items-center gap-1 text-xs font-medium text-warning">
              <Icon name="flag" size={14} />
              Marked for review
            </span>
          )}
          <span className={cn("flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", q.correct ? "bg-success-light text-success" : "bg-error-light text-error")}>
            <Icon name={q.correct ? "check" : "x"} size={14} />
            {q.correct ? "Correct" : skipped ? "Not answered" : "Incorrect"}
          </span>
        </div>
        <div dir={contentDir} className="flex flex-col gap-4">
          <h3 className="text-md font-semibold leading-7 text-ink">
            <ExamText text={q.prompt} alt={q.promptAlt} language={exam.language} secondLanguage={exam.secondLanguage} mode={mode} altClassName="font-normal text-body" />
          </h3>
          <ul className="flex flex-col gap-2">
            {q.options.map((o, i) => {
              const isCorrect = o.id === q.correctOptionId;
              const isChosen = o.id === q.selectedOptionId;
              return (
                <li
                  key={o.id}
                  className={cn(
                    "flex items-start gap-3 rounded-[10px] border px-4 py-2.5 text-sm",
                    isCorrect ? "border-success/60 bg-success-light text-ink" : isChosen ? "border-error/60 bg-error-light text-ink" : "border-line bg-surface text-body",
                  )}
                >
                  <span className={cn("w-4 shrink-0 font-semibold", isCorrect ? "text-success" : isChosen ? "text-error" : "text-primary")}>{letterOf(i)}</span>
                  <span className="min-w-0 flex-1">
                    <ExamText text={o.text} alt={o.textAlt} language={exam.language} secondLanguage={exam.secondLanguage} mode={mode} layout="split" />
                  </span>
                  {(isCorrect || isChosen) && (
                    <span className={cn("flex shrink-0 items-center gap-1 text-xs font-semibold", isCorrect ? "text-success" : "text-error")}>
                      <Icon name={isCorrect ? "check" : "x"} size={14} />
                      {isCorrect && isChosen ? "Your answer · correct" : isCorrect ? "Correct answer" : "Your answer"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {(q.explanation || q.explanationAlt) && (
            <div className="flex flex-col gap-1 border-s-2 border-primary ps-3.5">
              <span className="text-xs font-semibold text-primary">Explanation</span>
              <span className="text-sm text-ink">
                <ExamText text={q.explanation ?? ""} alt={q.explanationAlt} language={exam.language} secondLanguage={exam.secondLanguage} mode={mode} altClassName="text-body" />
              </span>
            </div>
          )}
        </div>
      </Panel>
    </li>
  );
}

/** The result of a finished attempt: the score, how each section went and, when the exam allows it, every question with the correct answer. */
export function ExamResultView({ attempt }: { attempt: ExamAttemptView }) {
  const t = useT();
  const intl = useIntlTag();
  const [mode, setMode] = useReadMode();
  const [filter, setFilter] = useState<Filter>("all");
  const { exam, questions } = attempt;
  const result = attempt.result!;
  const numbered = questions.map((q, i) => ({ q, number: i + 1 }));
  const wrong = numbered.filter(({ q }) => !q.correct);
  const flagged = numbered.filter(({ q }) => q.flagged);
  const shown = filter === "wrong" ? wrong : filter === "flagged" ? flagged : numbered;
  const finished = attempt.submittedAt ? new Intl.DateTimeFormat(intl, { dateStyle: "medium", timeStyle: "short" }).format(new Date(attempt.submittedAt)) : "";

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="exam-result-heading"
        className="relative isolate overflow-hidden rounded-2xl bg-linear-to-r from-primary-dark via-primary via-70% to-accent p-8 max-sm:p-5"
      >
        <BrandPattern tone="text-inverse" opacity={0.07} fade="left" className="-z-10" />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
          <ScoreRing percent={result.percent} passed={result.passed} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className={cn("flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", result.passed ? "bg-success text-inverse" : "bg-inverse/15 text-inverse")}>
              <Icon name={result.passed ? "check" : "repeat"} size={16} />
              {result.passed ? "Passed" : "Not passed yet"}
            </span>
            <h1 id="exam-result-heading" className="text-h1 text-inverse max-sm:text-h2">
              <T vars={{ correct: result.correct, total: result.total }}>{"{correct} of {total} correct"}</T>
            </h1>
            <p className="text-md text-primary-tint">
              <ExamText text={exam.title} alt={exam.titleAlt} language={exam.language} secondLanguage={exam.secondLanguage} mode={mode === "both" ? "first" : mode} align="page" />
            </p>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-sm text-primary-tint">
              <div className="flex gap-1.5">
                <dt>Pass mark</dt>
                <dd className="font-semibold text-inverse tabular-nums">{result.passPercent}%</dd>
              </div>
              <div className="flex gap-1.5">
                <dt>Time taken</dt>
                <dd className="font-semibold text-inverse tabular-nums">{clock(result.durationSeconds)}</dd>
              </div>
              <div className="flex gap-1.5">
                <dt>Attempt</dt>
                <dd className="font-semibold text-inverse tabular-nums">{attempt.number}</dd>
              </div>
              {finished && (
                <div className="flex gap-1.5">
                  <dt>Finished</dt>
                  <dd className="font-semibold text-inverse" suppressHydrationWarning>
                    {finished}
                  </dd>
                </div>
              )}
            </dl>
            {result.timedOut && <p className="text-sm text-primary-tint">The time ran out, so the exam was handed in with the answers you had given.</p>}
            {attempt.preview && <p className="text-sm text-primary-tint">This was a draft preview: it isn’t counted in the exam’s results.</p>}
          </div>
          <div className="flex flex-col gap-2 max-sm:w-full">
            {result.canRetake && (
              <StartExamButton examId={exam.id} slug={exam.slug} label={t("Take it again")} timeLimitMinutes={exam.timeLimitMinutes} variant="accent" block />
            )}
            <Link href={examHref(exam.slug)} className={buttonClasses({ variant: "secondary", block: true })}>
              Back to the exam
            </Link>
            {result.attemptsLeft !== null && (
              <p className="text-center text-xs text-primary-tint">
                <T vars={{ count: result.attemptsLeft }}>{"{count} attempts left"}</T>
              </p>
            )}
          </div>
        </div>
      </section>

      {result.sections.length > 0 && (
        <section aria-labelledby="exam-sections-heading" className="flex flex-col gap-3">
          <h2 id="exam-sections-heading" className="text-h2 text-ink max-sm:text-h3">
            Your score by section
          </h2>
          <Panel className="flex flex-col divide-y divide-line">
            {result.sections.map((s) => (
              <div key={s.id ?? "other"} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 max-sm:px-4">
                <span className="min-w-[200px] flex-1 text-sm font-medium text-ink">
                  {s.id === null ? "Other questions" : <ExamText text={s.title} alt={s.titleAlt} language={exam.language} secondLanguage={exam.secondLanguage} mode={mode} align="page" altClassName="font-normal text-secondary" />}
                </span>
                <span className="h-2 w-[220px] overflow-hidden rounded-full bg-muted max-sm:w-full" aria-hidden="true">
                  <span className={cn("block h-full rounded-full", s.percent >= result.passPercent ? "bg-success" : "bg-warning")} style={{ width: `${s.percent}%` }} />
                </span>
                <span className="w-[110px] text-end text-sm text-body tabular-nums">
                  <span className="font-semibold text-ink">{s.percent}%</span> ({s.correct}/{s.total})
                </span>
              </div>
            ))}
          </Panel>
        </section>
      )}

      {questions.length > 0 ? (
        <section aria-labelledby="exam-review-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <h2 id="exam-review-heading" className="text-h2 text-ink max-sm:text-h3">
                Review your answers
              </h2>
              <p className="text-sm text-secondary">Every question with the correct answer and a short explanation.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {exam.secondLanguage && <ReadModeSwitch language={exam.language} secondLanguage={exam.secondLanguage} mode={mode} onChange={setMode} />}
              <SegmentedControl<Filter>
                size="small"
                label={t("Questions to show")}
                value={filter}
                onChange={setFilter}
                items={[
                  { value: "all", label: `${t("All")} · ${numbered.length}` },
                  { value: "wrong", label: `${t("To revise")} · ${wrong.length}` },
                  ...(flagged.length ? [{ value: "flagged" as const, label: `${t("Marked for review")} · ${flagged.length}` }] : []),
                ]}
              />
            </div>
          </div>
          {shown.length === 0 ? (
            <Panel className="px-6 py-10 text-center text-sm text-secondary">{filter === "wrong" ? "Nothing to revise: you got every question right." : "No questions here."}</Panel>
          ) : (
            <ol className="flex flex-col gap-4">
              {shown.map(({ q, number }) => (
                <ReviewQuestion key={q.id} q={q} number={number} attempt={attempt} mode={mode} />
              ))}
            </ol>
          )}
        </section>
      ) : (
        <p className="flex items-start gap-2.5 rounded-[10px] bg-info-light p-3.5 text-sm text-body">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-info" />
          <span>This exam shows your score only. The questions and answers aren’t shown after the exam.</span>
        </p>
      )}

      {exam.credit && (
        <p className="text-xs text-secondary">
          <NoTranslate>
            <bdi>{exam.credit}</bdi>
          </NoTranslate>
        </p>
      )}
    </div>
  );
}
