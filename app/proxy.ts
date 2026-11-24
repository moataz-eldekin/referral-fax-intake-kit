/**
 * Login gate for every page and API route except the login page.
 * This only checks that the staff session cookie is authentic. Pages and routes
 * then load the account and check its role (see lib/auth.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "@/lib/session";

// /api/inbound-fax checks its own shared secret (a fax service has no login).
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/inbound-fax"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (readSessionToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { title: "Please log in", message: "Your session has ended. Log in again." } }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  // Skip Next.js internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
