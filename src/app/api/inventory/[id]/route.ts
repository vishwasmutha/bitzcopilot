import { NextResponse } from "next/server";
import { db } from "@/db";
import { inventoryTransactions, products } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function ownedProduct(businessId: string, id: string) {
  const rows = await db.select().from(products).where(and(eq(products.id, id), eq(products.businessId, businessId))).limit(1);
  return rows[0] ?? null;
}

export async function PUT(req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const p = await ownedProduct(session.business.id, id);
  if (!p) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  try {
    const b = await req.json().catch(() => null);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (b?.name != null) {
      const name = String(b.name).trim();
      if (name.length < 2) return NextResponse.json({ error: "Product name is too short." }, { status: 400 });
      updates.name = name;
    }
    if (b?.category != null) updates.category = String(b.category).trim() || "Other";
    if (b?.unitCost != null) updates.unitCost = Math.max(0, Number(b.unitCost) || 0);
    if (b?.sellingPrice != null) {
      const v = Number(b.sellingPrice);
      if (!(v > 0)) return NextResponse.json({ error: "Selling price must be positive." }, { status: 400 });
      updates.sellingPrice = v;
    }
    if (b?.stockQty != null) {
      const v = Math.max(0, Math.round(Number(b.stockQty) || 0));
      updates.stockQty = v;
      if (v !== p.stockQty)
        await db.insert(inventoryTransactions).values({ businessId: session.business.id, productId: id, type: "adjustment", qtyChange: v - p.stockQty, note: "Manual stock adjustment" });
    }
    if (b?.minStock != null) updates.minStock = Math.max(0, Math.round(Number(b.minStock) || 0));
    const [row] = await db.update(products).set(updates).where(eq(products.id, id)).returning();
    return NextResponse.json({ ok: true, product: row });
  } catch (e) {
    console.error("product update failed", e);
    return NextResponse.json({ error: "Could not update the product." }, { status: 500 });
  }
}

/** POST /api/inventory/:id — records a restock { qty } */
export async function POST(req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const p = await ownedProduct(session.business.id, id);
  if (!p) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  try {
    const b = await req.json().catch(() => null);
    const qty = Math.round(Number(b?.qty ?? 0));
    if (!(qty > 0)) return NextResponse.json({ error: "Restock quantity must be a positive number." }, { status: 400 });
    await db
      .update(products)
      .set({ stockQty: p.stockQty + qty, lastRestockedAt: new Date(), updatedAt: new Date() })
      .where(eq(products.id, id));
    await db.insert(inventoryTransactions).values({ businessId: session.business.id, productId: id, type: "restock", qtyChange: qty, note: b?.note ? String(b.note) : "Restock recorded" });
    return NextResponse.json({ ok: true, stockQty: p.stockQty + qty });
  } catch (e) {
    console.error("restock failed", e);
    return NextResponse.json({ error: "Could not record the restock." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const p = await ownedProduct(session.business.id, id);
  if (!p) return NextResponse.json({ error: "Product not found." }, { status: 404 });
  await db.delete(inventoryTransactions).where(eq(inventoryTransactions.productId, id));
  await db.delete(products).where(eq(products.id, id));
  return NextResponse.json({ ok: true });
}
