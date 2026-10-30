import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { decideReminder, getCollections, type Decision } from "@/lib/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECISIONS: Decision[] = ["sent", "dismiss", "collected"];

/** "I sent it", "Skip it" or "They paid". */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Reminder not found." }, { status: 404 });
  const body = await req.json().catch(() => null);
  const decision = body?.decision as Decision;
  if (!DECISIONS.includes(decision)) return NextResponse.json({ error: "Choose sent, dismiss or collected." }, { status: 400 });
  try {
    const r = await decideReminder(session.business.id, id, decision);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code ?? 400 });
    return NextResponse.json({ ok: true, view: await getCollections(session.business.id) });
  } catch (e) {
    console.error("collections decision failed", e);
    return NextResponse.json({ error: "Could not save that. Please try again." }, { status: 500 });
  }
}
