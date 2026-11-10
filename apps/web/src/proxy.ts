import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, localeFromHeader, type Locale } from "@/i18n/config";

/** Member-only areas: without a session cookie the visitor is sent to sign in with a return path. */
const MEMBER_AREAS = [
  "/feed",
  "/network",
  "/notifications",
  "/settings",
  "/onboarding",
  "/bookmarks",
  "/appeals",
  "/opportunities",
  "/events",
  "/learning",
  "/initiatives",
  "/chapters",
  "/ambassadors",
  "/stories",
  "/pages",
  "/analytics",
];

const needsSession = (pathname: string) =>
  pathname === "/articles/new" || MEMBER_AREAS.some((area) => pathname === area || pathname.startsWith(`${area}/`));

/**
 * Two jobs on every page request:
 *  1. Language. Pages live under /{language}/… but the address never shows it: the language comes
 *     from the visitor's saved choice (cookie), else their browser, else English, and the request
 *     is rewritten to that language's pages. An address that does carry a language (/fr/feed, a
 *     shared link or the language menu) saves the choice and redirects to the plain address.
 *  2. Optimistic gate for member-only areas. The API still checks every request; this only saves
 *     a round trip.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const [, first, ...rest] = pathname.split("/");

  if (isLocale(first)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${rest.join("/")}`;
    const response = NextResponse.redirect(url);
    response.cookies.set(LOCALE_COOKIE, first, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return response;
  }

  if (needsSession(pathname) && !request.cookies.has("cm_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(saved) ? saved : (localeFromHeader(request.headers.get("accept-language")) ?? DEFAULT_LOCALE);
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Pages only: not the API proxy, Next's own files, or anything with a file extension.
  matcher: ["/((?!api/|_next/|brand/|.*\\.[a-zA-Z0-9]+$).*)"],
};
