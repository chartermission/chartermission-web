import { NextResponse, type NextRequest } from "next/server";

/** Optimistic gate: the console needs an admin session cookie. The API checks every request. */
export function proxy(request: NextRequest) {
  if (request.cookies.has("cm_admin_session")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/signin";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!signin|api/|_next/|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp|css|js)$).*)"],
};
