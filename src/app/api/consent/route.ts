import { NextResponse } from "next/server";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { loadCustomers } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const rows = await loadCustomers(session.business.id);
  const list = rows
    .map((c) => ({
      refId: c.refId,
      name: c.name,
      phone: c.phone,
      consent: c.marketingConsent,
      consentAt: c.consentAt?.toISOString() ?? null,
      consentSource: c.consentSource,
      orders: c.orderCount,
      spent: c.totalSpent,
      lastPurchaseAt: c.lastPurchaseAt,
    }))
    .sort((a, b) => Number(b.consent) - Number(a.consent) || b.spent - a.spent);
  return NextResponse.json({ ok: true, customers: list, consented: list.filter((c) => c.consent).length, total: list.length });
}

/** Record or withdraw consent for one or more customers. The owner attests they hold the customer's opt-in. */
export async function PATCH(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const b = await req.json().catch(() => null);
  const refIds = Array.isArray(b?.refIds) ? b.refIds.map(String).slice(0, 5000) : [];
  if (!refIds.length || typeof b?.consent !== "boolean") return NextResponse.json({ error: "Choose customers and whether they consented." }, { status: 400 });
  const source = String(b?.source ?? "recorded by owner").slice(0, 80);
  const rows = await db
    .update(customers)
    .set(b.consent ? { marketingConsent: true, consentAt: new Date(), consentSource: source } : { marketingConsent: false, consentAt: null, consentSource: "withdrawn" })
    .where(and(eq(customers.businessId, session.business.id), inArray(customers.refId, refIds)))
    .returning({ id: customers.id });
  return NextResponse.json({ ok: true, updated: rows.length });
}
