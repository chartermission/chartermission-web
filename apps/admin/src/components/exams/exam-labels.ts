import type { AdminExamSummary, ExamAttemptSummary, ExamLanguage, ExamStatus } from "@chartermission/contracts";
import type { ChipTone } from "@chartermission/ui";
import type { Translate } from "@/i18n/translate";

export const STATUS_CHIP: Record<ExamStatus, { label: string; tone: ChipTone }> = {
  draft: { label: "Draft", tone: "warning" },
  published: { label: "Published", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

export const dirOf = (language: ExamLanguage | null | undefined): "rtl" | "ltr" => (language === "ar" ? "rtl" : "ltr");

/** "50 questions · 60 min · Pass mark 70%" */
export function examFacts(t: Translate, exam: Pick<AdminExamSummary, "questionCount" | "timeLimitMinutes" | "passPercent">): string {
  return [
    t("{count} questions", { count: exam.questionCount }),
    exam.timeLimitMinutes ? t("{minutes} min", { minutes: exam.timeLimitMinutes }) : t("No time limit"),
    t("Pass mark {percent}%", { percent: exam.passPercent }),
  ].join(" · ");
}

/** "12:05" or "1:02:45" */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

export function attemptOutcome(a: Pick<ExamAttemptSummary, "status" | "passed">): { label: string; tone: ChipTone } {
  if (a.status === "in_progress") return { label: "In progress", tone: "info" };
  return a.passed ? { label: "Passed", tone: "success" } : { label: "Failed", tone: "error" };
}
