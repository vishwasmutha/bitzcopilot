import { NextResponse } from "next/server";
import { db } from "@/db";
import { cashItems, customers, inventoryTransactions, products, sales } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { loadProducts, refreshCustomerAggregates } from "@/lib/analytics";
import { cashChanged } from "@/lib/cash";
import { parseQuickSale } from "@/lib/engine-math";
import { addDays, todayISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
}

/**
 * "Sold 3 rice, 2 oil" typed or spoken. Send { commit: false } to preview what was understood,
 * then { commit: true, choices } to record it. Credit sales also create a receivable.
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const b = await req.json().catch(() => null);
    const text = String(b?.text ?? "").trim();
    const commit = b?.commit === true;
    if (text.length < 3) return NextResponse.json({ error: "Type or say what you sold, for example: sold 3 rice, 2 oil." }, { status: 400 });
    if (text.length > 600) return NextResponse.json({ error: "That is too long. Enter one sale at a time." }, { status: 400 });

    const prods = await loadProducts(session.business.id);
    if (!prods.length) return NextResponse.json({ error: "Add your products first (Inventory or Data & Import) so sales can be matched." }, { status: 422 });
    const parsed = parseQuickSale(text, prods.map((p) => ({ name: p.name, price: p.sellingPrice })));
    const choices: Record<string, string> = b?.choices && typeof b.choices === "object" ? b.choices : {};
    const priceOf = new Map(prods.map((p) => [p.name, p.sellingPrice]));
    parsed.items.forEach((it, i) => {
      const pick = choices[String(i)];
      if (it.status === "ambiguous" && pick && it.candidates.includes(pick)) {
        it.status = "matched";
        it.product = pick;
        it.unitPrice = priceOf.get(pick) ?? 0;
        it.total = Math.round(it.qty * (priceOf.get(pick) ?? 0) * 100) / 100;
      }
    });
    const customer = typeof b?.customer === "string" && b.customer.trim() ? b.customer.trim().slice(0, 60) : parsed.customer;
    const onCredit = typeof b?.onCredit === "boolean" ? b.onCredit : parsed.onCredit;
    const matched = parsed.items.filter((i) => i.status === "matched");
    const total = Math.round(matched.reduce((a, i) => a + (i.total ?? 0), 0) * 100) / 100;
    const unresolved = parsed.items.length - matched.length;
    const preview = { items: parsed.items, customer, onCredit, total, unresolved, ignored: parsed.ignored };
    if (!commit) return NextResponse.json({ ok: true, committed: false, ...preview });

    if (!parsed.items.length) return NextResponse.json({ error: "I could not find any items in that. Try: sold 3 rice, 2 oil.", ...preview }, { status: 422 });
    if (unresolved > 0) return NextResponse.json({ error: "Some items were not matched to a product. Fix them or remove them first.", ...preview }, { status: 422 });
    if (matched.some((i) => !Number.isInteger(i.qty))) return NextResponse.json({ error: "Use whole units, for example 3, not 2.5.", ...preview }, { status: 422 });
    if (onCredit && !customer) return NextResponse.json({ error: "Who bought on credit? Add a name, for example: sold 2 atta to Ramesh on credit.", ...preview }, { status: 422 });

    const businessId = session.business.id;
    const today = todayISO();
    let customerId: string | null = null;
    if (customer) {
      const existing = (await db.select().from(customers).where(eq(customers.businessId, businessId))).find((c) => (c.name ?? "").toLowerCase() === customer.toLowerCase());
      if (existing) customerId = existing.refId;
      else {
        customerId = `Q-${slug(customer) || "customer"}`;
        await db.insert(customers).values({ businessId, refId: customerId, name: customer }).onConflictDoNothing();
      }
    }
    await db.transaction(async (tx) => {
      for (const it of matched) {
        await tx.insert(sales).values({ businessId, saleDate: today, productName: it.product!, quantity: it.qty, unitPrice: it.unitPrice ?? 0, totalAmount: it.total ?? 0, customerId, demo: false });
        const [p] = await tx.select().from(products).where(and(eq(products.businessId, businessId), eq(products.name, it.product!))).limit(1);
        if (p) {
          const take = Math.min(p.stockQty, it.qty);
          if (take > 0) {
            await tx.update(products).set({ stockQty: sql`${products.stockQty} - ${take}`, updatedAt: new Date() }).where(eq(products.id, p.id));
            await tx.insert(inventoryTransactions).values({ businessId, productId: p.id, type: "sale", qtyChange: -take, note: "Quick sale entry" });
          }
        }
      }
      if (onCredit && customer) {
        await tx.insert(cashItems).values({ businessId, kind: "receivable", party: customer, amount: total, issuedOn: today, dueDate: addDays(today, 15), recurrence: "none", note: "Credit sale: " + matched.map((i) => `${i.qty} ${i.product}`).join(", ").slice(0, 150) });
      }
    });
    if (customerId) await refreshCustomerAggregates(businessId);
    if (onCredit) cashChanged(businessId);
    return NextResponse.json({ ok: true, committed: true, ...preview });
  } catch (e) {
    console.error("quick sale failed", e);
    return NextResponse.json({ error: "Could not record that sale. Please try again." }, { status: 500 });
  }
}
