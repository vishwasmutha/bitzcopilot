import { NextResponse } from "next/server";
import { db } from "@/db";
import { waMessages } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { rateLimited } from "@/lib/llm";
import { answerWa, type WaLang } from "@/lib/wa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (rateLimited(session.user.id, 20)) return NextResponse.json({ error: "Slow down — 20 questions a minute." }, { status: 429 });
  try {
    const body = await req.json().catch(() => null);
    const text = String(body?.text ?? "").trim();
    const lang = (["kn", "hi", "en"].includes(body?.lang) ? body.lang : "kn") as WaLang;
    const voice = body?.voice && Number(body.voice.durationSec) > 0 ? { durationSec: Math.min(120, Math.round(Number(body.voice.durationSec))) } : null;
    if (text.length < 2) return NextResponse.json({ error: "Say or type a question first." }, { status: 400 });

    await db.insert(waMessages).values({
      businessId: session.business.id,
      direction: "in",
      kind: voice ? "voice" : "text",
      body: text,
      lang,
      transcript: voice ? text : null,
      durationSec: voice?.durationSec ?? null,
    });

    const answer = await answerWa(session.business.id, session.business.name, text, lang);
    const [out] = await db
      .insert(waMessages)
      .values({
        businessId: session.business.id,
        direction: "out",
        kind: answer.promo ? "promo" : "text",
        body: answer.text,
        lang,
        metaJson: JSON.stringify({
          ...(answer.promo ? { promo: { ...answer.promo, status: "draft" } } : {}),
          ...(answer.receipt ? { receipt: answer.receipt } : {}),
        }),
      })
      .returning();
    return NextResponse.json({
      ok: true,
      message: { ...out, meta: out.metaJson ? JSON.parse(out.metaJson) : null },
    });
  } catch (e) {
    console.error("wa ask failed", e);
    return NextResponse.json({ error: "Could not answer that. Try again." }, { status: 500 });
  }
}
