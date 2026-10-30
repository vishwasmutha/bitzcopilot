import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getExperiments } from "@/lib/experiments";
import { getBenchmarks, getDropReport, getLiftReports, getScorecard, getTodayActions } from "@/lib/impact";
import type { Lang } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const id = session.business.id;
    const url = new URL(req.url);
    const lang = (["en", "hi", "kn"].includes(url.searchParams.get("lang") ?? "") ? url.searchParams.get("lang") : "en") as Lang;
    const limit = Number(url.searchParams.get("limit")) || 3;
    const [drop, lifts, experiments] = await Promise.all([getDropReport(id), getLiftReports(id), getExperiments(id)]);
    const [actions, benchmarks, scorecard] = await Promise.all([
      getTodayActions(id, { drop, lifts, lang, limit }),
      getBenchmarks(id, session.business.category),
      getScorecard(id, experiments),
    ]);
    return NextResponse.json({ ok: true, actions, drop, lifts, experiments, benchmarks, scorecard });
  } catch (e) {
    console.error("impact failed", e);
    return NextResponse.json({ error: "Could not work out your impact numbers. Please try again." }, { status: 500 });
  }
}
