import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "el_session";

/**
 * Cheap edge guard: only checks for the cookie's presence. The real session lookup happens in
 * server components (requireUser). Keeps unauthenticated hits off the dashboard without a DB call.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith("/dashboard") && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if ((pathname === "/login" || pathname === "/register") && hasSession) {
    // requireUser sends a browser here with ?stale=1 when its cookie no longer matches a session
    // (deleted account, expired row): drop the cookie instead of bouncing it back to /dashboard.
    if (req.nextUrl.searchParams.has("stale")) {
      const res = NextResponse.next();
      res.cookies.delete(SESSION_COOKIE);
      res.cookies.delete("el_admin_session");
      return res;
    }
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/register"],
};
