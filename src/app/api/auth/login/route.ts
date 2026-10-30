import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@/lib/auth";
import { withSession } from "@/lib/session-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    if (!email || !password) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });

    if (email === "demo@bizcopilot.app") {
      const { ensureDemoAccount } = await import("@/lib/demo");
      await ensureDemoAccount();
    }
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.passwordHash))
      return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });

    return withSession({ user: { id: user.id, name: user.name, email: user.email } }, user.id, user.email, req);
  } catch (e) {
    console.error("login failed", e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
