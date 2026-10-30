import { NextResponse } from "next/server";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getNotifications, syncNotifications } from "@/lib/analytics";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  await syncNotifications(session.business.id);
  const rows = await getNotifications(session.business.id);
  return NextResponse.json({ notifications: rows, unread: rows.filter((n) => !n.read).length });
}

/** POST — mark all as read */
export async function POST() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const rows = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.businessId, session.business.id));
  for (const r of rows) await db.update(notifications).set({ read: true }).where(eq(notifications.id, r.id));
  return NextResponse.json({ ok: true });
}
