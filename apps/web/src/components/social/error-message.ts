import { ApiError, isApiError } from "@/lib/api/errors";

type Lang = "en" | "fr" | "ar";
const pageLang = (): Lang => {
  const lang = typeof document === "undefined" ? "en" : document.documentElement.lang.slice(0, 2);
  return lang === "fr" || lang === "ar" ? lang : "en";
};

/** "Try again in 3 hours", in the page's language (this runs outside React, so it reads <html lang>). */
function retryIn(seconds: number | undefined, lang: Lang) {
  const minutes = !seconds || seconds < 60 ? 1 : Math.ceil(seconds / 60);
  const hours = Math.ceil(minutes / 60);
  const useHours = minutes >= 60;
  const n = useHours ? hours : minutes;
  if (lang === "fr") return `Réessayez dans ${n} ${useHours ? (n === 1 ? "heure" : "heures") : n === 1 ? "minute" : "minutes"}.`;
  if (lang === "ar") return `حاول مجددًا بعد ${n} ${useHours ? (n === 1 ? "ساعة" : "ساعات") : n === 1 ? "دقيقة" : "دقائق"}.`;
  return `Try again in ${n} ${useHours ? (n === 1 ? "hour" : "hours") : n === 1 ? "minute" : "minutes"}.`;
}

const TOO_MANY: Record<Lang, string> = { en: "Too many attempts.", fr: "Trop de tentatives.", ar: "محاولات كثيرة جدًا." };

/** Member-facing text for an API error (server or client). 429 → "Try again in N minutes". */
/** The API's plain rate-limit sentence, in each language: replaced by one that says when to try again. */
const GENERIC_LIMIT = new Set(["Too many attempts. Try again later.", "Trop de tentatives. Réessayez plus tard.", "محاولات كثيرة جدًا. حاول لاحقًا."]);

export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Please try again.";
  if (error.code === "RATE_LIMITED") {
    // The API names the limit when it's one a member can plan around ("You can send 2 message requests a day.").
    const lang = pageLang();
    const generic = !error.message || GENERIC_LIMIT.has(error.message);
    return `${generic ? TOO_MANY[lang] : error.message} ${retryIn(error.retryAfter, lang)}`;
  }
  return error.message;
}

/** Errors that get their own treatment rather than a plain message. */
export const isVerifyError = (e: unknown) => isApiError(e, "EMAIL_NOT_VERIFIED");
export const isStandingError = (e: unknown) => isApiError(e, "ACCOUNT_RESTRICTED") || isApiError(e, "ACCOUNT_SUSPENDED");
