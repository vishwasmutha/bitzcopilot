import { NextResponse } from "next/server";
import { db } from "@/db";
import { inventoryTransactions, products } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const url = new URL(req.url);
  const historyFor = url.searchParams.get("history");
  if (historyFor) {
    const rows = await db
      .select({ id: inventoryTransactions.id, type: inventoryTransactions.type, qtyChange: inventoryTransactions.qtyChange, note: inventoryTransactions.note, createdAt: inventoryTransactions.createdAt, productName: products.name })
      .from(inventoryTransactions)
      .innerJoin(products, eq(products.id, inventoryTransactions.productId))
      .where(and(eq(inventoryTransactions.businessId, session.business.id), eq(inventoryTransactions.productId, historyFor)))
      .orderBy(asc(inventoryTransactions.createdAt))
      .limit(50);
    return NextResponse.json({ history: rows });
  }
  const rows = await db.select().from(products).where(eq(products.businessId, session.business.id)).orderBy(asc(products.name));
  return NextResponse.json({ products: rows });
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const b = await req.json().catch(() => null);
    const name = String(b?.name ?? "").trim();
    if (name.length < 2) return NextResponse.json({ error: "Product name is required." }, { status: 400 });
    const sellingPrice = Number(b?.sellingPrice ?? 0);
    if (!(sellingPrice > 0)) return NextResponse.json({ error: "Selling price must be a positive number." }, { status: 400 });

    const existing = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.businessId, session.business.id), eq(products.name, name)))
      .limit(1);
    if (existing.length) return NextResponse.json({ error: "A product with this name already exists. Edit it instead." }, { status: 409 });

    const [row] = await db
      .insert(products)
      .values({
        businessId: session.business.id,
        name,
        category: String(b?.category ?? "Other").trim() || "Other",
        unitCost: Math.max(0, Number(b?.unitCost ?? 0) || 0),
        sellingPrice,
        stockQty: Math.max(0, Math.round(Number(b?.stockQty ?? 0) || 0)),
        minStock: Math.max(0, Math.round(Number(b?.minStock ?? 0) || 0)),
      })
      .returning();
    return NextResponse.json({ ok: true, product: row });
  } catch (e) {
    console.error("product create failed", e);
    return NextResponse.json({ error: "Could not add the product." }, { status: 500 });
  }
}
