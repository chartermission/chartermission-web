import { ApiError, isApiError } from "@/lib/api/errors";

function retryText(seconds?: number) {
  if (!seconds || seconds < 60) return "a minute";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Member-facing text for an API error (server or client). 429 → "Try again in N minutes". */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Something went wrong. Please try again.";
  if (error.code === "RATE_LIMITED") return `Too many attempts. Try again in ${retryText(error.retryAfter)}.`;
  return error.message;
}

/** Errors that get their own treatment rather than a plain message. */
export const isVerifyError = (e: unknown) => isApiError(e, "EMAIL_NOT_VERIFIED");
export const isStandingError = (e: unknown) => isApiError(e, "ACCOUNT_RESTRICTED") || isApiError(e, "ACCOUNT_SUSPENDED");
