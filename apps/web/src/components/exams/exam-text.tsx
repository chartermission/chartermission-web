import type { ExamLanguage } from "@chartermission/contracts";
import { cn } from "@chartermission/ui";
import { NoTranslate } from "@/i18n/auto";
import { dirOf, type ReadMode } from "./format";

/**
 * A piece of exam content (question, answer, explanation, title) in the language or languages the
 * member is reading: the first language, the second beside or under it, or both. Never passed
 * through the interface translation, and each language keeps its own direction, so Arabic reads
 * right to left on an English page.
 */
export function ExamText({
  text,
  alt,
  language,
  secondLanguage,
  mode = "both",
  className,
  altClassName,
  layout = "stack",
  align = "own",
}: {
  text: string;
  alt?: string | null;
  language: ExamLanguage;
  secondLanguage: ExamLanguage | null;
  mode?: ReadMode;
  className?: string;
  altClassName?: string;
  /** stack: one under the other · split: side by side, each at its own edge (answers). */
  layout?: "stack" | "split";
  /** own: each language starts at its own edge (Arabic on the right), as on a printed bilingual paper · page: both line up with the page (titles, short labels). */
  align?: "own" | "page";
}) {
  const hasAlt = !!alt && !!secondLanguage;
  const showFirst = mode !== "second" || !hasAlt;
  const showSecond = hasAlt && mode !== "first";
  const piece = (value: string, lang: ExamLanguage, classes?: string) =>
    align === "page" ? (
      // The block follows the page's direction; only the words inside follow their own.
      <span className={cn("block min-w-0 whitespace-pre-line", classes)}>
        <span dir={dirOf(lang)} lang={lang}>
          {value}
        </span>
      </span>
    ) : (
      <span dir={dirOf(lang)} lang={lang} className={cn("min-w-0 whitespace-pre-line", classes)}>
        {value}
      </span>
    );
  return (
    <NoTranslate>
      <span className={cn("flex min-w-0", layout === "split" ? "flex-wrap justify-between gap-x-6 gap-y-0.5" : "flex-col gap-1")}>
        {showFirst && piece(text, language, className)}
        {showSecond &&
          secondLanguage &&
          piece(
            alt ?? "",
            secondLanguage,
            // Beside the first language, the second keeps to the far edge, also when it wraps to its own line.
            cn(showFirst ? altClassName : className, layout === "split" && showFirst && align === "own" && (dirOf(language) === "rtl" ? "grow text-left" : "grow text-right")),
          )}
      </span>
    </NoTranslate>
  );
}
