import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate: member-only areas need a session cookie. The API still checks every request;
 * this only saves a round trip and sends visitors to sign in with a return path.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has("cm_session")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/signin";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/feed/:path*",
    "/network/:path*",
    "/notifications/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/bookmarks/:path*",
    "/appeals/:path*",
    "/opportunities/:path*",
    "/events/:path*",
    "/learning/:path*",
    "/initiatives/:path*",
    "/chapters/:path*",
  ],
};
