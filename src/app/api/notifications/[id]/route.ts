import { NextResponse } from "next/server";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(_req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const rows = await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), eq(notifications.businessId, session.business.id)))
    .returning({ id: notifications.id });
  if (!rows.length) return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
