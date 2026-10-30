import { NextResponse } from "next/server";
import { db } from "@/db";
import { businesses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { buildPurchasePlan } from "@/lib/reorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const includeFestival = new URL(req.url).searchParams.get("festival") !== "0";
  const plan = await buildPurchasePlan(session.business.id, includeFestival);
  return NextResponse.json(plan);
}

export async function PUT(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const cashBudget = body?.cashBudget === "" || body?.cashBudget == null ? null : Math.max(0, Number(body.cashBudget) || 0);
  const upiId = body?.upiId != null ? String(body.upiId).trim().slice(0, 80) || null : undefined;
  const gstin = body?.gstin != null ? String(body.gstin).trim().toUpperCase().slice(0, 15) || null : undefined;
  await db
    .update(businesses)
    .set({
      cashBudget,
      ...(upiId !== undefined ? { upiId } : {}),
      ...(gstin !== undefined ? { gstin } : {}),
      updatedAt: new Date(),
    })
    .where(eq(businesses.id, session.business.id));
  return NextResponse.json({ ok: true });
}
