import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getAutopilot, LEVELS, listActionLog, runAutopilot, setAutopilot } from "@/lib/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const [state, log] = await Promise.all([getAutopilot(session.business.id), listActionLog(session.business.id, 40)]);
    return NextResponse.json({ ok: true, state, levels: LEVELS, log });
  } catch (e) {
    console.error("autopilot read failed", e);
    return NextResponse.json({ error: "Could not load autopilot." }, { status: 500 });
  }
}

/** Let the system look at the shop and log what it would do at the chosen level. Safe to call repeatedly. */
export async function POST() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const created = await runAutopilot(session.business.id);
    const [state, log] = await Promise.all([getAutopilot(session.business.id), listActionLog(session.business.id, 40)]);
    return NextResponse.json({ ok: true, created, state, log });
  } catch (e) {
    console.error("autopilot run failed", e);
    return NextResponse.json({ error: "Autopilot could not run. Please try again." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const b = await req.json().catch(() => null);
  const level = Number(b?.level);
  const budget = Number(b?.budget ?? 0);
  if (![1, 2, 3].includes(level)) return NextResponse.json({ error: "Choose suggest only, draft and wait, or act within a budget." }, { status: 400 });
  if (!Number.isFinite(budget) || budget < 0) return NextResponse.json({ error: "Enter a weekly budget of zero or more." }, { status: 400 });
  if (level === 3 && budget <= 0) return NextResponse.json({ error: "Acting on its own needs a weekly budget above zero." }, { status: 400 });
  await setAutopilot(session.business.id, level, budget);
  return NextResponse.json({ ok: true, state: await getAutopilot(session.business.id) });
}
