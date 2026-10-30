import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { rateLimited } from "@/lib/llm";
import { simulateWhatIf } from "@/lib/whatif";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (rateLimited(session.user.id, 30)) return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  const body = await req.json().catch(() => null);
  const question = String(body?.question ?? "").trim();
  const lang = ["hi", "kn", "en"].includes(body?.lang) ? body.lang : "en";
  if (question.length < 4) return NextResponse.json({ error: "Type a what-if first." }, { status: 400 });
  const result = await simulateWhatIf(session.business.id, question, lang);
  return NextResponse.json({ ok: true, ...result });
}
