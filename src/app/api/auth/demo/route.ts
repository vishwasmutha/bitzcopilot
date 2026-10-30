import { NextResponse } from "next/server";
import { db } from "@/db";
import { businesses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureDemoAccount } from "@/lib/demo";
import { withSession } from "@/lib/session-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One-click demo: provisions (or reuses) a demo bakery account with a
 *  pre-loaded, clearly-labelled demo dataset. */
export async function POST(req: Request) {
  try {
    const { userId, email } = await ensureDemoAccount();
    const biz = await db.select().from(businesses).where(eq(businesses.userId, userId)).limit(1);
    return withSession({ business: biz[0] ?? null }, userId, email, req);
  } catch (e) {
    console.error("demo login failed", e);
    return NextResponse.json({ error: "Could not start the demo session." }, { status: 500 });
  }
}
