import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Login hands the browser a session token and navigates to /wa?sid=...
 * Setting the cookie on that navigation (not only on the XHR) is what makes
 * Option B survive embedded previews that drop Set-Cookie on fetch.
 */
export function proxy(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid");
  if (!sid || sid.split(".").length !== 3 || sid.length > 4000) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.searchParams.delete("sid");
  const secure = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
  const res = NextResponse.redirect(url);
  res.cookies.set("bizcopilot_token", sid, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    sameSite: secure ? "none" : "lax",
    secure,
    partitioned: secure,
  });
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images/).*)"],
};