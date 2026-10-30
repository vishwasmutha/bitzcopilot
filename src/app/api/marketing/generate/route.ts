import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { generateMarketing, rateLimited } from "@/lib/llm";

export const runtime = "nodejs";

const TYPES = ["instagram", "whatsapp", "email", "discount", "description", "festival", "retention"];

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (rateLimited(session.user.id, 15)) return NextResponse.json({ error: "Generation limit reached — take a brief pause." }, { status: 429 });
  try {
    const body = await req.json().catch(() => null);
    const type = String(body?.type ?? "instagram");
    if (!TYPES.includes(type)) return NextResponse.json({ error: "Unknown content type." }, { status: 400 });
    const result = await generateMarketing(session.business.id, session.business.name, session.business.category, {
      type,
      product: String(body?.product ?? "auto"),
      segment: String(body?.segment ?? ""),
      objective: String(body?.objective ?? ""),
      tone: String(body?.tone ?? "friendly"),
      discount: body?.discount ? Math.min(90, Math.max(1, Number(body.discount) || 0)) : null,
      festival: body?.festival ? String(body.festival) : undefined,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("marketing generate failed", e);
    return NextResponse.json({ error: "Content generation failed. Please try again." }, { status: 500 });
  }
}
