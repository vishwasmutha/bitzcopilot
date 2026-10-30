import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { answerWhatIfQuestion, rateLimited } from "@/lib/llm";
import { simulateWhatIf } from "@/lib/whatif";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (rateLimited(session.user.id, 30)) return NextResponse.json({ error: "Slow down a little." }, { status: 429 });
  const body = await req.json().catch(() => null);
  const question = String(body?.question ?? "").trim();
  const history = Array.isArray(body?.history)
    ? body.history
        .filter((message: unknown): message is { role: "user" | "assistant"; content: string } => {
          if (!message || typeof message !== "object") return false;
          const item = message as { role?: unknown; content?: unknown };
          return (item.role === "user" || item.role === "assistant") && typeof item.content === "string";
        })
        .slice(-8)
        .map((message: { role: "user" | "assistant"; content: string }) => ({
          role: message.role,
          content: message.content.slice(0, 1000),
        }))
    : [];
  const lang = ["hi", "kn", "en"].includes(body?.lang) ? body.lang : "en";
  if (question.length < 4) return NextResponse.json({ error: "Type a what-if first." }, { status: 400 });
  if (question.length > 2000) return NextResponse.json({ error: "Question is too long." }, { status: 400 });
  const result = await simulateWhatIf(session.business.id, question, lang);
  if (result.status === "unknown") {
    try {
      const guidance = await answerWhatIfQuestion(
        session.business.id,
        session.business.name,
        session.business.category,
        question,
        history
      );
      return NextResponse.json({
        ok: true,
        status: "conversation",
        summary: guidance.reply,
        low: null,
        high: null,
        point: null,
        unit: `Guidance · ${guidance.engine}`,
        receipt: {
          title: "Scenario discussion",
          status: "insufficient",
          headline: "No unsupported estimate shown",
          steps: [{ label: "Scenario", detail: question }, { label: "Answer source", detail: guidance.engine }],
          caveat: "This question was answered conversationally. Any unmeasured impact is left unquantified.",
        },
      });
    } catch (e) {
      console.error("what-if guidance failed", e);
      return NextResponse.json({ error: "Could not analyze that scenario. Please try again." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, ...result });
}
