import type { ExamLanguage } from "@chartermission/contracts";
import type { Translate } from "@/i18n/translate";

/** Canonical in-app paths for Exams. */
export const examHref = (slug: string) => `/exams/${encodeURIComponent(slug)}`;
export const attemptHref = (slug: string, attemptId: string) => `${examHref(slug)}/attempts/${attemptId}`;

export const dirOf = (language: ExamLanguage | null | undefined): "rtl" | "ltr" => (language === "ar" ? "rtl" : "ltr");

/** Answer letters by position: A, B, C… */
export const letterOf = (index: number) => "ABCDEF"[index] ?? String(index + 1);

/** A countdown or a time taken: "59:07", "1:02:45". */
export function clock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** "60 minutes", "No time limit" */
export function timeLimitText(t: Translate, minutes: number | null): string {
  return minutes ? t("{count} minutes", { count: minutes }) : t("No time limit");
}

/** "Unlimited", "2 attempts" */
export function attemptsText(t: Translate, max: number | null): string {
  return max === null ? t("Unlimited attempts") : t("{count} attempts", { count: max });
}

/** How a member chose to read a two-language exam. */
export type ReadMode = "both" | "first" | "second";
export const READ_MODE_KEY = "cm_exam_read";
