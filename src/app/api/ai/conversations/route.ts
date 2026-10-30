import { NextResponse } from "next/server";
import { db } from "@/db";
import { aiConversations } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const rows = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.businessId, session.business.id), eq(aiConversations.userId, session.user.id)))
    .orderBy(desc(aiConversations.createdAt))
    .limit(30);
  return NextResponse.json({ conversations: rows });
}

export async function POST() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const [conv] = await db
    .insert(aiConversations)
    .values({ businessId: session.business.id, userId: session.user.id, title: "New conversation" })
    .returning();
  return NextResponse.json({ ok: true, conversation: conv });
}
