import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getLastOperatorRun, runDailyOperator } from "@/lib/operator";
import { LANG_OPTIONS } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The most recent daily run for this shop, if any. */
export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, run: await getLastOperatorRun(session.business.id) });
  } catch (e) {
    console.error("operator read failed", e);
    return NextResponse.json({ error: "Could not load the daily check." }, { status: 500 });
  }
}

/** "Run now": check the shop, rebuild today's brief and deliver it. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const lang = LANG_OPTIONS.find((l) => l.id === body?.lang)?.id;
  try {
    const run = await runDailyOperator(session.business.id, { force: body?.force !== false, lang });
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    console.error("operator run failed", e);
    return NextResponse.json({ error: "The daily check could not run. Please try again." }, { status: 500 });
  }
}
