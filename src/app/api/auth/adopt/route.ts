import { NextResponse } from "next/server";
import { getSession, requestIsSecure, sessionCookieOptions, verifyToken } from "@/lib/auth";
import { TOKEN_COOKIE } from "@/lib/session-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-issue the session cookie from a bearer token the browser already stored. */
export async function POST(req: Request) {
  const raw = req.headers.get("authorization") || "";
  const token = raw.replace(/^Bearer\s+/i, "").trim();
  const payload = token ? verifyToken(token) : null;
  if (!payload) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const res = NextResponse.json({ ok: true, user: session.user, business: session.business });
  res.cookies.set(TOKEN_COOKIE, token, sessionCookieOptions(requestIsSecure(req)));
  return res;
}
