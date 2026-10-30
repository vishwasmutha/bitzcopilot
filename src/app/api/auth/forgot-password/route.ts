import { NextResponse } from "next/server";
import { db } from "@/db";
import { passwordResets, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newResetToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });

    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    if (!user) return NextResponse.json({ ok: true, token: null, message: "If that email is registered, a reset code was generated." });

    const { token, hash } = newResetToken();
    await db.insert(passwordResets).values({
      userId: user.id,
      email,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    return NextResponse.json({
      ok: true,
      token,
      message:
        "Reset code generated. In production this would be emailed — no mail provider is configured in this environment, so the code is shown to you directly.",
    });
  } catch (e) {
    console.error("forgot-password failed", e);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
