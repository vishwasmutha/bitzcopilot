import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { cleanSpec, consentSummary, describeSpec, resolveAudience, TARGETABLE } from "@/lib/audience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many people are in a segment, and how many agreed to be messaged. */
export async function GET(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const url = new URL(req.url);
  const segment = url.searchParams.get("segment") ?? "All customers";
  if (!(TARGETABLE as readonly string[]).includes(segment)) return NextResponse.json({ ok: true, targetable: false });
  let spec = {};
  try {
    spec = cleanSpec(JSON.parse(url.searchParams.get("spec") ?? "{}"));
  } catch {
    return NextResponse.json({ error: "That segment rule could not be read." }, { status: 400 });
  }
  try {
    const members = await resolveAudience(session.business.id, segment, segment === "Custom segment" ? spec : undefined);
    const sum = consentSummary(members);
    return NextResponse.json({
      ok: true,
      targetable: true,
      ...sum,
      rule: segment === "Custom segment" ? describeSpec(spec) : segment,
      sample: members.slice(0, 5).map((m) => ({ refId: m.refId, name: m.name, consent: m.consent, orders: m.orders, spent: m.spent, recencyDays: m.recencyDays })),
    });
  } catch (e) {
    console.error("audience failed", e);
    return NextResponse.json({ error: "Could not size that segment." }, { status: 500 });
  }
}
