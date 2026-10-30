import { NextResponse } from "next/server";
import { db } from "@/db";
import { marketingCampaigns } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The owner confirms they sent this campaign. That moment starts the lift measurement. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = String(body?.campaignId ?? "");
  if (!id) return NextResponse.json({ error: "Missing campaign." }, { status: 400 });
  const rows = await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.businessId, session.business.id)))
    .limit(1);
  const c = rows[0];
  if (!c) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  let product: string | null = null;
  try {
    const p = c.inputsJson ? JSON.parse(c.inputsJson)?.product : null;
    product = p && p !== "auto" ? String(p) : null;
  } catch {
    product = null;
  }
  if (!product) {
    return NextResponse.json({ error: "Pick a specific product (not Auto) so the lift can be measured against that product's sales." }, { status: 400 });
  }
  if (c.approvedAt) return NextResponse.json({ ok: true, alreadyTracking: true });
  await db.update(marketingCampaigns).set({ status: "sent", approvedAt: new Date() }).where(eq(marketingCampaigns.id, id));
  return NextResponse.json({ ok: true });
}
