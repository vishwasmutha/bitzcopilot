import { NextResponse } from "next/server";
import { db } from "@/db";
import { aiConversations, aiMessages } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function owned(sessionUserId: string, businessId: string, id: string) {
  const rows = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, id), eq(aiConversations.businessId, businessId), eq(aiConversations.userId, sessionUserId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const conv = await owned(session.user.id, session.business.id, id);
  if (!conv) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const msgs = await db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.conversationId, id), eq(aiMessages.businessId, session.business.id)))
    .orderBy(asc(aiMessages.createdAt))
    .limit(200);
  return NextResponse.json({ conversation: conv, messages: msgs.map((m) => ({ ...m, meta: m.metaJson ? JSON.parse(m.metaJson) : null })) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const conv = await owned(session.user.id, session.business.id, id);
  if (!conv) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  await db.delete(aiMessages).where(eq(aiMessages.conversationId, id));
  await db.delete(aiConversations).where(eq(aiConversations.id, id));
  return NextResponse.json({ ok: true });
}
