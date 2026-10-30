import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { cleanSpec, TARGETABLE } from "@/lib/audience";
import { createExperiment, deleteExperiment, getExperiments } from "@/lib/experiments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, experiments: await getExperiments(session.business.id, 12) });
  } catch (e) {
    console.error("experiments failed", e);
    return NextResponse.json({ error: "Could not load experiments." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const ok = await deleteExperiment(session.business.id, id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Test not found." }, { status: 404 });
}

/** Start a tracked send. Returns only the people to message. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const b = await req.json().catch(() => null);
    const segment = String(b?.segment ?? "");
    if (!(TARGETABLE as readonly string[]).includes(segment)) {
      return NextResponse.json({ error: "Pick a customer segment. A public post has no customer list to test." }, { status: 400 });
    }
    const result = await createExperiment(session.business.id, {
      campaignId: b?.campaignId ? String(b.campaignId) : null,
      title: String(b?.title ?? "Promotion").trim() || "Promotion",
      segment,
      spec: segment === "Custom segment" ? cleanSpec(b?.spec) : undefined,
      productName: b?.product ? String(b.product) : null,
      holdoutPct: Number(b?.holdoutPct) || 20,
      windowDays: Number(b?.windowDays) || 14,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json(result);
  } catch (e) {
    console.error("experiment create failed", e);
    return NextResponse.json({ error: "Could not start the test. Please try again." }, { status: 500 });
  }
}
