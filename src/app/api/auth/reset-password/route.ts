import { NextResponse } from "next/server";
import { db } from "@/db";
import { passwordResets, users } from "@/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { hashPassword, sha256 } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    const token = String(body?.token ?? "").trim();
    const password = String(body?.password ?? "");
    if (!email || !token || password.length < 8)
      return NextResponse.json({ error: "Email, reset code and a password of 8+ characters are required." }, { status: 400 });

    const rows = await db
      .select()
      .from(passwordResets)
      .where(and(eq(passwordResets.email, email), eq(passwordResets.tokenHash, sha256(token)), eq(passwordResets.used, false), gt(passwordResets.expiresAt, new Date())))
      .limit(1);
    const reset = rows[0];
    if (!reset) return NextResponse.json({ error: "That reset code is invalid or has expired. Request a new one." }, { status: 400 });

    await db.update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, reset.userId));
    await db.update(passwordResets).set({ used: true }).where(eq(passwordResets.id, reset.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("reset-password failed", e);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
