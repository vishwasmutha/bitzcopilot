import { NextResponse } from "next/server";
import { requestIsSecure, sessionCookieOptions, signToken } from "./auth";

export const TOKEN_COOKIE = "bizcopilot_token";

export function withSession(data: Record<string, unknown>, userId: string, email: string, req: Request, status = 200) {
  const token = signToken({ sub: userId, email });
  const res = NextResponse.json({ ...data, ok: true, token }, { status });
  res.cookies.set(TOKEN_COOKIE, token, sessionCookieOptions(requestIsSecure(req)));
  return res;
}

export function clearSessionResponse() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(TOKEN_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
