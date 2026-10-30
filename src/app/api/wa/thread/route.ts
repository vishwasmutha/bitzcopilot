import { NextResponse } from "next/server";
import { db } from "@/db";
import { businesses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { ensureMorningBrief, listThread } from "@/lib/wa";
import type { Lang } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!session.business) return NextResponse.json({ needsOnboarding: true }, { status: 200 });
  const url = new URL(req.url);
  const lang = (url.searchParams.get("lang") || "kn") as Lang;
  const biz = await db.select().from(businesses).where(eq(businesses.id, session.business.id)).limit(1);
  const useLang = (url.searchParams.get("lang") ? lang : (biz[0]?.language as Lang) || "kn") as Lang;
  await ensureMorningBrief(session.business.id, useLang === "hi" || useLang === "en" || useLang === "kn" ? useLang : "kn");
  const messages = await listThread(session.business.id);
  return NextResponse.json({
    business: biz[0]
      ? { id: biz[0].id, name: biz[0].name, category: biz[0].category, location: biz[0].location, language: biz[0].language, phone: biz[0].phone, isDemo: biz[0].isDemo }
      : session.business,
    messages,
  });
}
