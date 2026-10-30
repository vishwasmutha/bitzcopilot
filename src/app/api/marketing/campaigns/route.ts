import { NextResponse } from "next/server";
import { db } from "@/db";
import { marketingCampaigns } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const rows = await db
    .select()
    .from(marketingCampaigns)
    .where(eq(marketingCampaigns.businessId, session.business.id))
    .orderBy(desc(marketingCampaigns.createdAt))
    .limit(40);
  return NextResponse.json({
    campaigns: rows.map((c) => ({ ...c, inputs: c.inputsJson ? JSON.parse(c.inputsJson) : null })),
  });
}

/** Save a new campaign, or update an existing one when id is provided. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const b = await req.json().catch(() => null);
    const content = String(b?.content ?? "").trim();
    const title = String(b?.title ?? "Untitled campaign").trim();
    if (content.length < 5) return NextResponse.json({ error: "Content is required." }, { status: 400 });

    if (b?.id) {
      const rows = await db
        .select({ id: marketingCampaigns.id })
        .from(marketingCampaigns)
        .where(eq(marketingCampaigns.id, String(b.id)))
        .limit(1);
      if (!rows.length) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
      const [row] = await db
        .update(marketingCampaigns)
        .set({ title: title || "Untitled campaign", content })
        .where(eq(marketingCampaigns.id, String(b.id)))
        .returning();
      return NextResponse.json({ ok: true, campaign: row });
    }

    const [row] = await db
      .insert(marketingCampaigns)
      .values({
        businessId: session.business.id,
        type: String(b?.type ?? "instagram"),
        title: title || "Untitled campaign",
        content,
        inputsJson: b?.inputs ? JSON.stringify(b.inputs) : null,
        engine: String(b?.engine ?? "builtin"),
      })
      .returning();
    return NextResponse.json({ ok: true, campaign: row });
  } catch (e) {
    console.error("campaign save failed", e);
    return NextResponse.json({ error: "Could not save the campaign." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const rows = await db
    .delete(marketingCampaigns)
    .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.businessId, session.business.id)))
    .returning({ id: marketingCampaigns.id });
  if (!rows.length) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
