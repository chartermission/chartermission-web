import { NextResponse, type NextRequest } from "next/server";

/** Optimistic gate: the console needs an admin session cookie. The API checks every request. */
export function proxy(request: NextRequest) {
  if (request.cookies.has("cm_admin_session")) return NextResponse.next();
  const url = request.nextUrl.clone();
  // No console session: try single sign-on from the member site first. The /sso page asks the
  // member site whether this browser is signed in there as a team member, and lands on the
  // sign-in form when it isn't.
  url.pathname = "/sso";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!signin|sso|api/|_next/|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp|css|js)$).*)"],
};
