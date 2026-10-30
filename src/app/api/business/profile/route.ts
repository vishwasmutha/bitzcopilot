import { NextResponse } from "next/server";
import { db } from "@/db";
import { businesses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { BUSINESS_SIZES, CATEGORY_OPTIONS } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!session.business) return NextResponse.json({ business: null });
  return NextResponse.json({ business: session.business });
}

/** Creates (onboarding) or updates the business profile. */
export async function PUT(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await req.json().catch(() => null);
    const name = String(body?.name ?? "").trim();
    const category = String(body?.category ?? "").trim();
    const location = String(body?.location ?? "").trim() || null;
    const size = String(body?.size ?? "").trim() || null;
    const employees = body?.employees === "" || body?.employees == null ? null : Math.max(0, Math.min(10000, Number(body.employees) || 0));
    const language = ["en", "hi", "kn"].includes(body?.language) ? String(body.language) : undefined;
    const phone = body?.phone != null ? String(body.phone).replace(/\D/g, "").slice(-10) || null : undefined;

    if (name.length < 2) return NextResponse.json({ error: "Business name is required." }, { status: 400 });
    if (!(CATEGORY_OPTIONS as readonly string[]).includes(category)) return NextResponse.json({ error: "Choose a valid business category." }, { status: 400 });
    if (size && !(BUSINESS_SIZES as readonly string[]).includes(size)) return NextResponse.json({ error: "Choose a valid business size." }, { status: 400 });

    const existing = session.business;
    if (existing) {
      await db
        .update(businesses)
        .set({ name, category, location, size, employees, ...(language ? { language } : {}), ...(phone !== undefined ? { phone } : {}), updatedAt: new Date() })
        .where(eq(businesses.id, existing.id));
      return NextResponse.json({
        ok: true,
        business: { ...existing, name, category, location, size, employees },
      });
    }

    const [biz] = await db
      .insert(businesses)
      .values({ userId: session.user.id, name, category, location, size, employees, language: language ?? "kn", phone: phone ?? null })
      .returning();
    return NextResponse.json({ ok: true, business: biz });
  } catch (e) {
    console.error("profile update failed", e);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
