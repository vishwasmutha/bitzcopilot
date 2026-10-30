import { NextResponse } from "next/server";
import { runOperatorForAll } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled entry point (see vercel.json: 09:00 IST). Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 * With no CRON_SECRET configured the endpoint stays closed.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await runOperatorForAll()) });
  } catch (e) {
    console.error("daily cron failed", e);
    return NextResponse.json({ error: "Daily run failed." }, { status: 500 });
  }
}
