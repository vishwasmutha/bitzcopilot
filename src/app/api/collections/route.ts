import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getCollections, runCollections } from "@/lib/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, view: await getCollections(session.business.id) });
  } catch (e) {
    console.error("collections read failed", e);
    return NextResponse.json({ error: "Could not load collections." }, { status: 500 });
  }
}

/** Draft today's reminders now. Safe to repeat: the same customer and stage is never drafted twice. */
export async function POST() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const result = await runCollections(session.business.id);
    return NextResponse.json({ ok: true, ...result, view: await getCollections(session.business.id) });
  } catch (e) {
    console.error("collections run failed", e);
    return NextResponse.json({ error: "Could not draft reminders. Please try again." }, { status: 500 });
  }
}
