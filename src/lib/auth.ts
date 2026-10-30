import "server-only";
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { businesses, users } from "@/db/schema";
import { eq } from "drizzle-orm";

const TOKEN_COOKIE = "bizcopilot_token";
const SESSION_DAYS = 7;

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be configured in production.");
  }
  return "bizcopilot-dev-secret-change-me-in-production";
}

/* ---------------------------- passwords ---------------------------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newResetToken(): { token: string; hash: string } {
  const token = randomUUID().replace(/-/g, "").slice(0, 12);
  return { token, hash: sha256(token) };
}

/* ------------------------------ tokens ----------------------------- */

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signToken(payload: { sub: string; email: string }): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
    })
  );
  const sig = createHmac("sha256", getSecret()).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): { sub: string; email: string } | null {
  try {
    const [header, body, sig] = token.split(".");
    if (!header || !body || !sig) return null;
    const expected = createHmac("sha256", getSecret()).update(`${header}.${body}`).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

/* ------------------------------ session ---------------------------- */

export type SessionUser = {
  user: { id: string; name: string; email: string };
  business: {
    id: string;
    name: string;
    category: string;
    location: string | null;
    size: string | null;
    employees: number | null;
    isDemo: boolean;
  } | null;
};

const TOKEN_COOKIE_NAME = "bizcopilot_token";

/** Cookie + Authorization bearer. Bearer lets the app recover when a browser
 *  drops Set-Cookie (embedded preview, third-party cookie blocking). */
async function readToken(): Promise<string | null> {
  const store = await cookies();
  const fromCookie = store.get(TOKEN_COOKIE)?.value;
  if (fromCookie) return fromCookie;
  try {
    const h = await headers();
    const raw = h.get("authorization") || h.get("x-bc-token") || "";
    const m = raw.match(/Bearer\s+(\S+)/i);
    if (m?.[1]) return m[1];
    if (raw.split(".").length === 3) return raw.trim();
  } catch {
    return null;
  }
  return null;
}

export async function getSession(): Promise<SessionUser | null> {
  const token = await readToken();
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const rows = await db
    .select({
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      bizId: businesses.id,
      bizName: businesses.name,
      bizCategory: businesses.category,
      bizLocation: businesses.location,
      bizSize: businesses.size,
      bizEmployees: businesses.employees,
      bizIsDemo: businesses.isDemo,
    })
    .from(users)
    .leftJoin(businesses, eq(businesses.userId, users.id))
    .where(eq(users.id, payload.sub));
  const row = rows[0];
  if (!row) return null;
  return {
    user: { id: row.userId, name: row.userName ?? "", email: row.userEmail ?? "" },
    business: row.bizId
      ? {
          id: row.bizId,
          name: row.bizName ?? "",
          category: row.bizCategory ?? "Other",
          location: row.bizLocation,
          size: row.bizSize,
          employees: row.bizEmployees,
          isDemo: row.bizIsDemo ?? false,
        }
      : null,
  };
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true as const,
    path: "/",
    maxAge: SESSION_DAYS * 86400,
    sameSite: (secure ? "none" : "lax") as "none" | "lax",
    secure,
    partitioned: secure,
  };
}

export function requestIsSecure(req?: Request): boolean {
  if (!req) return process.env.NODE_ENV === "production";
  const proto = req.headers.get("x-forwarded-proto") || "";
  if (proto.includes("https")) return true;
  if (req.url.startsWith("https")) return true;
  return process.env.NODE_ENV === "production";
}

/** Prefer setting the cookie on the outgoing NextResponse (see withSession). */
export async function setSession(userId: string, email: string): Promise<void> {
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";
  store.set(TOKEN_COOKIE, signToken({ sub: userId, email }), sessionCookieOptions(secure));
}

export { TOKEN_COOKIE_NAME };

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(TOKEN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** API-route helper: resolves the current session or returns null (caller responds 401). */
export async function requireSession(): Promise<SessionUser | null> {
  return getSession();
}
