import { NextResponse } from "next/server";
import { generateForecast, getLatestForecast } from "@/lib/forecast";
import { requireSession } from "@/lib/auth";
import { rateLimited } from "@/lib/llm";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (rateLimited(session.user.id, 30)) return NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 });
  try {
    const body = await req.json().catch(() => ({}));
    const horizon = Math.min(90, Math.max(7, Number(body?.horizon) || 14));
    const result = await generateForecast(session.business.id, horizon);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("forecast failed", e);
    return NextResponse.json({ error: "Forecast could not be generated right now." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const url = new URL(req.url);
  const horizon = Number(url.searchParams.get("horizon") ?? "14") || 14;
  const row = await getLatestForecast(session.business.id, horizon);
  if (!row) return NextResponse.json({ found: false });
  return NextResponse.json({
    found: true,
    id: row.id,
    createdAt: row.createdAt,
    modelName: row.modelName,
    horizonDays: row.horizonDays,
    metrics: row.metricsJson ? JSON.parse(row.metricsJson) : null,
    series: row.seriesJson ? JSON.parse(row.seriesJson) : null,
  });
}
