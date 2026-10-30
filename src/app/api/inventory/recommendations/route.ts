import { NextResponse } from "next/server";
import { loadProducts, loadSales } from "@/lib/analytics";
import { requireSession } from "@/lib/auth";
import { addDays, todayISO } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const today = todayISO();
    const [products, sales] = await Promise.all([loadProducts(session.business.id), loadSales(session.business.id, addDays(today, -27))]);

    const qty = new Map<string, { last14: number; prev14: number; total: number }>();
    for (const s of sales) {
      const a = qty.get(s.productName) ?? { last14: 0, prev14: 0, total: 0 };
      a.total += s.quantity;
      if (s.saleDate >= addDays(today, -13)) a.last14 += s.quantity;
      else a.prev14 += s.quantity;
      qty.set(s.productName, a);
    }

    const recs = products.map((p) => {
      const q = qty.get(p.name) ?? { last14: 0, prev14: 0, total: 0 };
      const last14Rate = q.last14 / 14;
      const prev14Rate = q.prev14 / 14;
      const rate = last14Rate >= prev14Rate ? last14Rate * 1.05 : Math.max(0, last14Rate * 0.9); // mild trend
      const predictedWeekly = rate * 7;
      const status: "out" | "low" | "ok" | "over" =
        p.stockQty <= 0 ? "out" : p.stockQty <= Math.max(p.minStock, 1) ? "low" : rate > 0 && p.stockQty > rate * 42 ? "over" : "ok";
      // Cover 2 weeks of predicted demand, rounded up
      const target = Math.ceil(predictedWeekly * 2);
      const suggested = Math.max(0, target - p.stockQty);
      const daysCover = rate > 0 ? Math.floor(p.stockQty / rate) : null;
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        stockQty: p.stockQty,
        minStock: p.minStock,
        unitCost: p.unitCost,
        sellingPrice: p.sellingPrice,
        lastRestockedAt: p.lastRestockedAt,
        dailyRate: Math.round(rate * 100) / 100,
        predictedWeekly: Math.round(predictedWeekly * 10) / 10,
        suggested,
        daysCover,
        status,
        slowMoving: status === "ok" && q.total < 4 && p.stockQty > p.minStock,
        trendUp: prev14Rate > 0 && last14Rate > prev14Rate * 1.2,
        trendDown: last14Rate < prev14Rate * 0.7,
      };
    });

    const needsReorder = recs.filter((r) => r.suggested > 0);
    const slow = recs.filter((r) => r.slowMoving);
    const over = recs.filter((r) => r.status === "over");
    return NextResponse.json({
      recommendations: recs,
      summary: {
        outOfStock: recs.filter((r) => r.status === "out").length,
        low: recs.filter((r) => r.status === "low").length,
        overstocked: over.length,
        slowMoving: slow.length,
        reorderValue: needsReorder.reduce((a, r) => a + r.suggested * r.unitCost, 0),
      },
    });
  } catch (e) {
    console.error("recommendations failed", e);
    return NextResponse.json({ error: "Could not compute recommendations." }, { status: 500 });
  }
}
