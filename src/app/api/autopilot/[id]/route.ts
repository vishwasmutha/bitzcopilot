import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { decideAction } from "@/lib/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const b = await req.json().catch(() => null);
  const decision = String(b?.decision ?? "");
  if (!["approve", "dismiss", "received"].includes(decision)) return NextResponse.json({ error: "Choose approve, dismiss or received." }, { status: 400 });
  const r = await decideAction(session.business.id, id, decision as "approve" | "dismiss" | "received");
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error ?? "Could not update." }, { status: r.error === "Not found." ? 404 : 409 });
}
