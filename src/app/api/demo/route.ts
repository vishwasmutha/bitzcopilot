import { NextResponse } from "next/server";
import { clearDemoData, hasDemoData, loadDemoData } from "@/lib/demo";
import { requireSession } from "@/lib/auth";
import { syncNotifications } from "@/lib/analytics";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (action === "load") {
      const category = String(body?.category ?? session.business.category);
      const counts = await loadDemoData(session.business.id, category);
      await syncNotifications(session.business.id);
      return NextResponse.json({ ok: true, counts, message: "Demo dataset loaded (clearly labelled). Reset it any time from Settings." });
    }
    if (action === "clear") {
      await clearDemoData(session.business.id);
      return NextResponse.json({ ok: true, message: "Demo data removed. Your real data is untouched." });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    console.error("demo action failed", e);
    return NextResponse.json({ error: "That did not work. Please try again." }, { status: 500 });
  }
}

export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const has = await hasDemoData(session.business.id);
  return NextResponse.json({ hasDemoData: has });
}
