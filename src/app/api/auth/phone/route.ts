import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { withSession } from "@/lib/session-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function normalizePhone(raw: string): string | null {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return d.slice(2);
  if (d.length === 11 && d.startsWith("0")) return d.slice(1);
  if (d.length === 10 && /^[6-9]/.test(d)) return d;
  return null;
}

/** Option B — sign in with the WhatsApp number the owner already uses. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const phone = normalizePhone(String(body?.phone ?? ""));
    const password = String(body?.password ?? "");
    if (!phone) return NextResponse.json({ error: "Enter a 10-digit Indian WhatsApp number." }, { status: 400 });
    if (password.length < 4) return NextResponse.json({ error: "PIN must be at least 4 characters." }, { status: 400 });

    if (phone === "9845012345") {
      const { ensureDemoAccount } = await import("@/lib/demo");
      await ensureDemoAccount();
    }
    const rows = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
    const user = rows[0];
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return NextResponse.json(
        { error: "That WhatsApp number and PIN don't match. Demo shop: 98450 12345 · PIN demo1234." },
        { status: 401 }
      );
    }
    return withSession({ user: { id: user.id, name: user.name, email: user.email, phone } }, user.id, user.email, req);
  } catch (e) {
    console.error("phone login failed", e);
    return NextResponse.json({ error: "Could not sign in with WhatsApp. Please try again." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const phone = normalizePhone(String(body?.phone ?? ""));
    const password = String(body?.password ?? "");
    const name = String(body?.name ?? "").trim();
    if (!phone) return NextResponse.json({ error: "Enter a 10-digit Indian WhatsApp number." }, { status: 400 });
    if (name.length < 2) return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
    if (password.length < 4) return NextResponse.json({ error: "PIN must be at least 4 characters." }, { status: 400 });
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
    if (existing.length) return NextResponse.json({ error: "This WhatsApp number already has a shop. Sign in instead." }, { status: 409 });
    const email = `${phone}@wa.bizcopilot.app`;
    const [user] = await db
      .insert(users)
      .values({ name, email, phone, passwordHash: hashPassword(password) })
      .returning({ id: users.id });
    return withSession({ user: { id: user.id, name, email, phone } }, user.id, email, req);
  } catch (e) {
    console.error("phone register failed", e);
    return NextResponse.json({ error: "Could not create the WhatsApp login." }, { status: 500 });
  }
}
