import { NextResponse, type NextRequest } from "next/server";
import { INVITE_COOKIE } from "@/lib/invite";
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
  "/messages",
];

/** Bots that fetch a page to draw a link preview (they are never signed in). */
const PREVIEW_BOT = /WhatsApp|facebookexternalhit|facebookcatalog|Facebot|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot|SkypeUriPreview|Pinterestbot|redditbot|Embedly|vkShare|Viber|Snapchat|Mastodon|Iframely|Bluesky|Google-PageRenderer|Applebot/i;
/** Pages whose preview depends on what they show (a member, chapter, event, page, opportunity or post). */
const PREVIEW_PATH = /^\/(?:[a-z0-9][a-z0-9-]{1,59}|(?:chapters|events|pages|opportunities|posts|articles)\/[^/]+)\/?$/i;

/** Public pages keep their own previews. */
const PUBLIC_PAGES = new Set(["check-email", "forgot-password", "guidelines", "policies", "privacy", "reset-password", "sign-in", "signin", "signup", "terms", "verify-email"]);

const needsSession = (pathname: string) =>
  pathname === "/articles/new" || MEMBER_AREAS.some((area) => pathname === area || pathname.startsWith(`${area}/`));

/**
 * Three jobs on every page request (after sending www. to the bare domain):
 *  1. Language. Pages live under /{language}/… but the address never shows it: the language comes
 *     from the visitor's saved choice (cookie), else their browser, else English, and the request
 *     is rewritten to that language's pages. An address that does carry a language (/fr/feed, a
 *     shared link or the language menu) saves the choice and redirects to the plain address.
 *  2. Optimistic gate for member-only areas. The API still checks every request; this only saves
 *     a round trip.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // One address for the site: www.chartermission.com → chartermission.com. Sign-in cookies belong to
  // the bare domain, so on www members looked signed out (and private profiles "not found").
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  if (host.startsWith("www.")) {
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host.slice(4));
    const proto = local ? (request.headers.get("x-forwarded-proto") ?? "http") : "https";
    return NextResponse.redirect(`${proto}://${host.slice(4)}${pathname}${search}`, 308);
  }

  const [, first, ...rest] = pathname.split("/");

  if (isLocale(first)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${rest.join("/")}`;
    const response = NextResponse.redirect(url);
    response.cookies.set(LOCALE_COOKIE, first, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    return response;
  }

  // Profiles moved from /members/{username} to /{username}; old links and bookmarks still arrive.
  if (/^\/members\/?$/.test(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/network";
    return NextResponse.redirect(url, 308);
  }
  const oldProfile = /^\/members\/([^/]+)\/?$/.exec(pathname);
  if (oldProfile) {
    const url = request.nextUrl.clone();
    url.pathname = `/${oldProfile[1]}`;
    return NextResponse.redirect(url, 308);
  }

  // Invitation links (/invite?chapter={slug}&from={handle}).
  if (pathname === "/invite") {
    const chapter = request.nextUrl.searchParams.get("chapter");
    const slug = chapter && /^[a-z0-9-]{1,80}$/.test(chapter) ? chapter : null;
    const url = request.nextUrl.clone();
    url.search = "";
    if (PREVIEW_BOT.test(request.headers.get("user-agent") ?? "")) {
      // The preview is the chapter's own (cover photo), or the landing page's.
      const saved = request.cookies.get(LOCALE_COOKIE)?.value;
      if (!slug) return NextResponse.redirect(new URL("/", request.url));
      url.pathname = `/${isLocale(saved) ? saved : DEFAULT_LOCALE}/link-preview`;
      url.search = `?path=${encodeURIComponent(`/chapters/${slug}`)}`;
      return NextResponse.rewrite(url);
    }
    if (request.cookies.has("cm_session")) {
      url.pathname = slug ? `/chapters/${slug}` : "/feed";
      return NextResponse.redirect(url);
    }
    // Someone new: sign up, with the chapter already picked in "Find your people".
    url.pathname = "/signup";
    const response = NextResponse.redirect(url);
    if (slug) response.cookies.set(INVITE_COOKIE, slug, { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
    return response;
  }

  // Link-preview bots get a page with that link's title, summary and picture (app/[locale]/link-preview).
  if (PREVIEW_BOT.test(request.headers.get("user-agent") ?? "") && PREVIEW_PATH.test(pathname) && !PUBLIC_PAGES.has(first) && !request.cookies.has("cm_session")) {
    const saved = request.cookies.get(LOCALE_COOKIE)?.value;
    const url = request.nextUrl.clone();
    url.pathname = `/${isLocale(saved) ? saved : DEFAULT_LOCALE}/link-preview`;
    url.search = `?path=${encodeURIComponent(pathname)}`;
    return NextResponse.rewrite(url);
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
