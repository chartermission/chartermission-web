"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ExamAnswerSaved, ExamAttemptView } from "@chartermission/contracts";
import { Button, Chip, Icon, Panel, cn } from "@chartermission/ui";
import { ConfirmDialog } from "@/components/social/confirm-dialog";
import { errorMessage } from "@/components/social/error-message";
import { ApiError, api } from "@/lib/api/client";
import { NoTranslate } from "@/i18n/auto";
import { T, useT } from "@/i18n/client";
import { ExamText } from "./exam-text";
import { clock, dirOf, letterOf } from "./format";
import { ReadModeSwitch, useReadMode } from "./read-mode";

type Change = { questionId: string; optionId?: string | null; flagged?: boolean };

const WARN_SECONDS = 300;
const URGENT_SECONDS = 60;

/**
 * Taking an exam: one question at a time, every answer saved to the API as it is chosen, and the
 * countdown taken from the server's clock. The correct answers are not in the page: marking
 * happens on the server when the member finishes or the time runs out.
 */
export function ExamRunner({ attempt, onSubmitted }: { attempt: ExamAttemptView; onSubmitted: (result: ExamAttemptView) => void }) {
  const t = useT();
  const ids = useId();
  const { exam, questions } = attempt;
  const total = questions.length;
  const [mode, setMode] = useReadMode();
  const [index, setIndex] = useState(() => Math.max(0, questions.findIndex((q) => q.selectedOptionId === null)));
  const [answers, setAnswers] = useState<Record<string, string | null>>(() => Object.fromEntries(questions.map((q) => [q.id, q.selectedOptionId])));
  const [flags, setFlags] = useState<Record<string, boolean>>(() => Object.fromEntries(questions.map((q) => [q.id, q.flagged])));
  const [unsaved, setUnsaved] = useState<Record<string, Change>>({});
  const [saving, setSaving] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  /** Server time minus this device's time, so a wrong device clock doesn't change the countdown. Set by sync(). */
  const offset = useRef(0);
  const [clockReady, setClockReady] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef<Record<string, Change>>({});
  const done = useRef(false);
  const lastTry = useRef(0);
  const expiresAt = attempt.expiresAt ? Date.parse(attempt.expiresAt) : null;

  const finish = useCallback(
    async (timedOut: boolean) => {
      if (done.current) return;
      done.current = true;
      setFinishing(true);
      setProblem(null);
      try {
        // Let answers still on their way arrive first (they can't once the attempt is marked).
        await queue.current.catch(() => undefined);
        onSubmitted(await api<ExamAttemptView>(`/exam-attempts/${attempt.id}/submit`, { method: "POST" }));
      } catch (e) {
        done.current = false;
        setFinishing(false);
        setProblem(timedOut ? t("Time is up, but your exam couldn’t be handed in: {error} We’ll keep trying.", { error: errorMessage(e) }) : errorMessage(e));
        if (!timedOut) throw e;
      }
    },
    [attempt.id, onSubmitted, t],
  );

  /** Reads the attempt again: sets the clock from the server, and shows the result if it was already marked. */
  const sync = useCallback(async () => {
    if (done.current) return;
    try {
      const sent = Date.now();
      const fresh = await api<ExamAttemptView>(`/exam-attempts/${attempt.id}`);
      offset.current = Date.parse(fresh.serverNow) - (sent + Date.now()) / 2;
      if (fresh.status === "submitted") {
        done.current = true;
        onSubmitted(fresh);
      }
    } catch {
      /* offline for a moment: the countdown carries on from the last known clock */
    } finally {
      setClockReady(true);
    }
  }, [attempt.id, onSubmitted]);

  useEffect(() => {
    void sync();
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [sync]);

  // Countdown. At zero the exam is handed in; if that fails (offline) it is tried again every few seconds.
  useEffect(() => {
    if (expiresAt === null || !clockReady) return;
    let last = Number.POSITIVE_INFINITY;
    const tick = () => {
      const left = Math.max(0, Math.ceil((expiresAt - (Date.now() + offset.current)) / 1000));
      setRemaining(left);
      if (left <= WARN_SECONDS && last > WARN_SECONDS) setAnnouncement(t("5 minutes left"));
      if (left <= URGENT_SECONDS && last > URGENT_SECONDS) setAnnouncement(t("1 minute left"));
      last = left;
      if (left === 0 && !done.current && Date.now() - lastTry.current > 5000) {
        lastTry.current = Date.now();
        void finish(true).catch(() => undefined);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, clockReady, finish, t]);

  /** Sends changes one after another, in the order they were made. A failed one stays in `unsaved` for another try. */
  const send = useCallback(
    (change: Change) => {
      pending.current[change.questionId] = { ...pending.current[change.questionId], ...change };
      setSaving((n) => n + 1);
      queue.current = queue.current
        .catch(() => undefined)
        .then(async () => {
          const next = pending.current[change.questionId];
          if (!next) return;
          delete pending.current[change.questionId];
          try {
            await api<ExamAnswerSaved>(`/exam-attempts/${attempt.id}/answers`, { method: "PUT", body: next });
            setUnsaved((u) => {
              if (!(change.questionId in u)) return u;
              const rest = { ...u };
              delete rest[change.questionId];
              return rest;
            });
          } catch (e) {
            // Already marked (time ran out, or finished in another tab): show the result.
            if (e instanceof ApiError && e.status === 409) return void sync();
            setUnsaved((u) => ({ ...u, [change.questionId]: { ...u[change.questionId], ...next } }));
          }
        })
        .finally(() => setSaving((n) => n - 1));
    },
    [attempt.id, sync],
  );

  const question = questions[index]!;
  const answered = questions.filter((q) => answers[q.id]).length;
  const flagged = questions.filter((q) => flags[q.id]).length;
  const unsavedCount = Object.keys(unsaved).length;
  const sections = new Map(attempt.sections.map((s) => [s.id, s]));
  const section = question.sectionId ? sections.get(question.sectionId) : undefined;
  // Reading only the second language: the question lays out in that language's direction (answers from the right for Arabic).
  const contentDir = dirOf(mode === "second" && exam.secondLanguage ? exam.secondLanguage : exam.language);
  const timeUp = remaining === 0;
  const locked = finishing || timeUp;

  function choose(optionId: string) {
    if (locked) return;
    setAnswers((a) => ({ ...a, [question.id]: optionId }));
    send({ questionId: question.id, optionId });
  }
  function toggleFlag() {
    if (locked) return;
    const next = !flags[question.id];
    setFlags((f) => ({ ...f, [question.id]: next }));
    send({ questionId: question.id, flagged: next });
  }
  const go = (to: number) => setIndex(Math.min(total - 1, Math.max(0, to)));
  const retryUnsaved = () => Object.values(unsaved).forEach(send);

  const timerTone = remaining === null ? "" : remaining <= URGENT_SECONDS ? "bg-error-light text-error" : remaining <= WARN_SECONDS ? "bg-warning-light text-warning" : "bg-primary-tint-2 text-primary";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-h2 text-ink max-sm:text-h3">
            <ExamText text={exam.title} alt={exam.titleAlt} language={exam.language} secondLanguage={exam.secondLanguage} mode={mode} align="page" altClassName="text-md font-normal text-secondary" />
          </h1>
          {attempt.preview && (
            <Chip tone="warning" className="self-start">
              Draft preview · not counted in the results
            </Chip>
          )}
        </div>
        {exam.secondLanguage && <ReadModeSwitch language={exam.language} secondLanguage={exam.secondLanguage} mode={mode} onChange={setMode} />}
      </header>

      {/* Stays in view while the member scrolls a long question. */}
      <div className="sticky top-[72px] z-10 -mx-1 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-card px-4 py-2.5 shadow-[0px_4px_12px_-6px_rgba(25,37,80,0.18)]">
        <span className="text-sm font-medium text-ink">
          <T vars={{ number: index + 1, total }}>{"Question {number} of {total}"}</T>
        </span>
        <span
          role="progressbar"
          aria-label="Questions answered"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={answered}
          aria-valuetext={t("{answered} of {total} answered", { answered, total })}
          className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-muted"
        >
          <span className="block h-full rounded-full bg-primary-light transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
        </span>
        <span className="text-xs text-secondary tabular-nums">
          <T vars={{ answered, total }}>{"{answered} of {total} answered"}</T>
        </span>
        {expiresAt !== null && (
          <span className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums", timerTone)} aria-label={remaining === null ? undefined : t("Time left: {time}", { time: clock(remaining) })}>
            <Icon name="clock" size={16} />
            <span aria-hidden="true">{remaining === null ? "–:––" : clock(remaining)}</span>
          </span>
        )}
      </div>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {(unsavedCount > 0 || problem) && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] bg-warning-light p-3.5 text-sm text-ink">
          <Icon name="alert" size={18} className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1">{problem ?? t("{count} answers aren’t saved yet. Check your connection; we’ll keep them on this page meanwhile.", { count: unsavedCount })}</span>
          {unsavedCount > 0 && (
            <Button variant="secondary" size="small" onClick={retryUnsaved}>
              Save again
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-5 max-lg:grid-cols-1">
        <Panel className="flex flex-col gap-5 p-6 max-sm:p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="rounded-md bg-accent px-2.5 py-1 text-sm font-semibold text-inverse tabular-nums">Q{String(index + 1).padStart(2, "0")}</span>
            <span className="min-w-0 flex-1 text-sm text-secondary max-sm:order-last max-sm:basis-full">
              <NoTranslate>
                <bdi>{[section && (mode === "second" && section.titleAlt ? section.titleAlt : section.title), question.reference].filter(Boolean).join(" · ")}</bdi>
              </NoTranslate>
            </span>
            {question.tag && (
              <span className="rounded-full border border-accent/50 px-2.5 py-0.5 text-xs font-medium text-accent-hover max-sm:me-auto">
                <NoTranslate>{question.tag}</NoTranslate>
              </span>
            )}
            <button
              type="button"
              onClick={toggleFlag}
              disabled={locked}
              aria-pressed={!!flags[question.id]}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors disabled:opacity-50",
                "max-sm:ms-auto",
                flags[question.id] ? "border-warning bg-warning-light text-warning" : "border-line text-secondary hover:border-line-strong hover:text-ink",
              )}
            >
              <Icon name="flag" size={15} />
              {flags[question.id] ? "Marked for review" : "Review later"}
            </button>
          </div>

          <fieldset disabled={locked} dir={contentDir} className="flex flex-col gap-4">
            <legend className="float-start mb-4 w-full text-h3 leading-7 text-ink max-sm:text-lg">
              <ExamText
                text={question.prompt}
                alt={question.promptAlt}
                language={exam.language}
                secondLanguage={exam.secondLanguage}
                mode={mode}
                altClassName="text-lg font-normal leading-8 text-body max-sm:text-md"
              />
            </legend>
            <div className="flex w-full flex-col gap-2.5">
              {question.options.map((option, i) => {
                const selected = answers[question.id] === option.id;
                return (
                  <label
                    key={option.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-[10px] border px-4 py-3 text-md transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-light",
                      selected ? "border-primary bg-primary-tint-2 text-ink" : "border-line bg-surface text-body hover:border-line-strong",
                      locked && "cursor-default opacity-70",
                    )}
                  >
                    <input type="radio" name={`${ids}-${question.id}`} value={option.id} checked={selected} onChange={() => choose(option.id)} className="sr-only" />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                        selected ? "border-primary bg-primary text-inverse" : "border-line-strong bg-card text-primary",
                      )}
                    >
                      {letterOf(i)}
                    </span>
                    <span className="min-w-0 flex-1 pt-0.5">
                      <ExamText text={option.text} alt={option.textAlt} language={exam.language} secondLanguage={exam.secondLanguage} mode={mode} layout="split" />
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <Button variant="secondary" disabled={index === 0} onClick={() => go(index - 1)}>
              <Icon name="chevron-left" size={18} className="rtl:rotate-180" />
              Previous
            </Button>
            <span className="text-xs text-secondary max-sm:order-last max-sm:w-full max-sm:text-center" aria-live="polite">
              {saving > 0 ? "Saving…" : unsavedCount > 0 ? "" : answers[question.id] ? "Answer saved" : ""}
            </span>
            {index < total - 1 ? (
              <Button onClick={() => go(index + 1)}>
                Next
                <Icon name="chevron-right" size={18} className="rtl:rotate-180" />
              </Button>
            ) : (
              <Button variant="accent" disabled={finishing} onClick={() => setConfirming(true)}>
                Finish exam
              </Button>
            )}
          </div>
        </Panel>

        <aside aria-label="All questions" className="flex flex-col gap-4 lg:sticky lg:top-[140px]">
          <Panel className="flex flex-col gap-4 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">Questions</h2>
              <span className="text-xs text-secondary">
                {flagged > 0 && <T vars={{ count: flagged }}>{"{count} marked for review"}</T>}
              </span>
            </div>
            <ol className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-1.5">
              {questions.map((q, i) => {
                const isAnswered = !!answers[q.id];
                const isFlagged = !!flags[q.id];
                const current = i === index;
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => go(i)}
                      aria-current={current ? "step" : undefined}
                      aria-label={`${t("Question {number}", { number: i + 1 })}, ${isAnswered ? t("answered") : t("not answered")}${isFlagged ? `, ${t("marked for review")}` : ""}`}
                      className={cn(
                        "relative flex h-9 w-full items-center justify-center rounded-lg border text-sm font-medium tabular-nums transition-colors",
                        isAnswered ? "border-primary bg-primary text-inverse" : "border-line bg-card text-body hover:border-line-strong",
                        current && "ring-2 ring-accent ring-offset-1",
                      )}
                    >
                      {i + 1}
                      {isFlagged && <span aria-hidden="true" className="absolute -end-1 -top-1 size-2.5 rounded-full border border-card bg-warning" />}
                    </button>
                  </li>
                );
              })}
            </ol>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-3 rounded-sm bg-primary" />
                Answered
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-3 rounded-sm border border-line-strong bg-card" />
                Not answered
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2.5 rounded-full bg-warning" />
                Review later
              </li>
            </ul>
            <Button variant="accent" block disabled={finishing} aria-busy={finishing} onClick={() => setConfirming(true)}>
              {finishing ? "Handing in…" : "Finish exam"}
            </Button>
          </Panel>
          <p className="flex items-start gap-2 px-1 text-xs text-secondary">
            <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
            <span>{expiresAt !== null ? "Your answers are saved as you go. The clock keeps running if you leave this page." : "Your answers are saved as you go. You can leave and come back to finish."}</span>
          </p>
        </aside>
      </div>

      {confirming && (
        <ConfirmDialog title={t("Finish the exam?")} confirmLabel={t("Finish and see my result")} onClose={() => setConfirming(false)} onConfirm={() => finish(false)}>
          <span className="flex flex-col gap-2">
            <span>
              {answered === total
                ? t("You have answered all {total} questions.", { total })
                : t("You have answered {answered} of {total} questions. The {count} you left blank will be marked wrong.", { answered, total, count: total - answered })}
            </span>
            {flagged > 0 && <span>{t("{count} questions are still marked for review.", { count: flagged })}</span>}
            <span>You can’t change your answers after finishing.</span>
          </span>
        </ConfirmDialog>
      )}
    </div>
  );
}
