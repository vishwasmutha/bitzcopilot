import { NextResponse } from "next/server";
import { db } from "@/db";
import { aiConversations, aiMessages } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { answerQuestion, rateLimited } from "@/lib/llm";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (rateLimited(session.user.id, 20)) return NextResponse.json({ error: "You're asking a lot of questions quickly — take a short pause (20 per minute)." }, { status: 429 });

  try {
    const body = await req.json().catch(() => null);
    const question = String(body?.question ?? "").trim();
    if (question.length < 3) return NextResponse.json({ error: "Type a question first." }, { status: 400 });
    if (question.length > 2000) return NextResponse.json({ error: "Question is too long." }, { status: 400 });

    let conversationId = body?.conversationId ? String(body.conversationId) : null;
    if (conversationId) {
      const conv = await db
        .select({ id: aiConversations.id })
        .from(aiConversations)
        .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.businessId, session.business.id), eq(aiConversations.userId, session.user.id)))
        .limit(1);
      if (!conv.length) conversationId = null;
    }

    if (!conversationId) {
      const [conv] = await db
        .insert(aiConversations)
        .values({ businessId: session.business.id, userId: session.user.id, title: question.length > 48 ? question.slice(0, 48) + "…" : question })
        .returning({ id: aiConversations.id });
      conversationId = conv.id;
    }

    await db.insert(aiMessages).values({
      conversationId,
      businessId: session.business.id,
      role: "user",
      content: question,
    });

    const result = await answerQuestion(session.business.id, session.user.id, question, session.business.name, session.business.category);

    await db.insert(aiMessages).values({
      conversationId,
      businessId: session.business.id,
      role: "assistant",
      content: result.reply,
      metaJson: JSON.stringify({ charts: result.charts }),
      engine: result.engine,
    });

    return NextResponse.json({ ok: true, conversationId, ...result });
  } catch (e) {
    console.error("chat failed", e);
    return NextResponse.json({ error: "The assistant hit a snag. Please try again." }, { status: 500 });
  }
}
