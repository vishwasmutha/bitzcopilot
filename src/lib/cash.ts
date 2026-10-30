import "server-only";
import { db } from "@/db";
import { businesses, cashItems } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { loadProducts, loadSales } from "./analytics";
import { generateForecast } from "./forecast";
import { projectCash, type CashItemIn, type CashProjection } from "./engine-math";
import { forget, memo } from "./memo";
import { addDays, fmtCurrency, todayISO } from "./utils";

export type CashItemRow = {
  id: string;
  kind: "receivable" | "payable" | "recurring";
  party: string;
  amount: number;
  issuedOn: string;
  dueDate: string;
  recurrence: "none" | "weekly" | "monthly";
  status: "open" | "settled";
  note: string | null;
};

export async function listCashItems(businessId: string): Promise<CashItemRow[]> {
  const rows = await db.select().from(cashItems).where(eq(cashItems.businessId, businessId)).orderBy(desc(cashItems.dueDate));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as CashItemRow["kind"],
    party: r.party,
    amount: r.amount,
    issuedOn: r.issuedOn,
    dueDate: r.dueDate,
    recurrence: r.recurrence as CashItemRow["recurrence"],
    status: r.status as CashItemRow["status"],
    note: r.note,
  }));
}

export function cashChanged(businessId: string): void {
  forget(`cash:${businessId}`);
}

export type CashOutlook = {
  openingCash: number | null;
  openingCashOn: string | null;
  stale: boolean;
  horizonDays: number;
  projection: CashProjection;
  params: { creditSharePct: number; cogsPct: number; cogsAssumed: boolean; bandPct: number };
  openReceivables: number;
  openPayables: number;
};

/** Forward cash view: opening cash, expected sales, credit owed to the shop, supplier dues and rent. */
export function getCashOutlook(businessId: string): Promise<CashOutlook> {
  return memo(`cash:${businessId}`, 5 * 60_000, () => computeOutlook(businessId));
}

async function computeOutlook(businessId: string): Promise<CashOutlook> {
  const today = todayISO();
  const horizonDays = 56;
  const [bizRows, items] = await Promise.all([db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1), listCashItems(businessId)]);
  const biz = bizRows[0];
  const openReceivables = items.filter((i) => i.kind === "receivable" && i.status === "open").reduce((a, i) => a + i.amount, 0);
  const openPayables = items.filter((i) => i.kind !== "receivable" && i.status === "open").reduce((a, i) => a + i.amount, 0);
  const base = {
    openingCash: biz?.openingCash ?? null,
    openingCashOn: biz?.openingCashOn ?? null,
    stale: !!biz?.openingCashOn && biz.openingCashOn < addDays(today, -3),
    horizonDays,
    openReceivables,
    openPayables,
  };
  const none = { creditSharePct: 0, cogsPct: 0, cogsAssumed: true, bandPct: 0 };
  if (biz?.openingCash == null) {
    return { ...base, projection: { status: "insufficient", why: "Enter how much cash you have today. Without a starting balance, any warning would be a guess." }, params: none };
  }
  const fc = await generateForecast(businessId, horizonDays);
  if (fc.status === "insufficient" || fc.forecast.length < 14) {
    return { ...base, projection: { status: "insufficient", why: fc.message ?? "Not enough sales history to forecast cash." }, params: none };
  }

  // Share of recent sales given on credit, from receivables the owner recorded
  const [sales56, sales28, products] = await Promise.all([loadSales(businessId, addDays(today, -55), today), loadSales(businessId, addDays(today, -27), today), loadProducts(businessId)]);
  const rev56 = sales56.reduce((a, s) => a + s.totalAmount, 0);
  const issued56 = items.filter((i) => i.kind === "receivable" && i.issuedOn >= addDays(today, -55)).reduce((a, i) => a + i.amount, 0);
  const creditShare = rev56 > 0 ? Math.min(0.8, issued56 / rev56) : 0;

  // Restocking cost per rupee of sales, from product costs
  const cost = new Map(products.map((p) => [p.name, p.unitCost]));
  let matchedRev = 0;
  let matchedCost = 0;
  let totalRev = 0;
  for (const s of sales28) {
    totalRev += s.totalAmount;
    const c = cost.get(s.productName);
    if (c != null && c > 0) {
      matchedRev += s.totalAmount;
      matchedCost += c * s.quantity;
    }
  }
  const known = totalRev > 0 && matchedRev / totalRev >= 0.5 && matchedCost / matchedRev >= 0.05;
  const cogsRatio = known ? Math.min(0.95, matchedCost / matchedRev) : 0.7;

  const level = Math.max(1, fc.recentDaily);
  const band = Math.min(0.3, Math.max(0.08, (1.28 * fc.sigma) / level / Math.sqrt(7)));
  const salesForecast = fc.forecast.map((f) => ({ date: f.date, low: f.predicted * (1 - band), mid: f.predicted, high: f.predicted * (1 + band) }));
  const projection = projectCash({
    today,
    openingCash: biz.openingCash,
    horizonDays,
    salesForecast,
    creditShare,
    cogsRatio,
    items: items.map<CashItemIn>((i) => ({ kind: i.kind, party: i.party, amount: i.amount, dueDate: i.dueDate, recurrence: i.recurrence, status: i.status })),
  });
  if (projection.status === "ok") {
    projection.assumptions.push({
      label: "Forecast model",
      detail: `${fc.model}. Confidence ${fc.confidence.level}: ${fc.confidence.reason} Low and high cases use an 80% band of ±${Math.round(band * 100)}% on weekly sales, sized from the model's own error.`,
    });
    if (!known) projection.assumptions.push({ label: "Stock cost assumed", detail: "Product costs are missing for most sales, so restocking is assumed at 70 paise per rupee. Add unit costs for a sharper view." });
  }
  return { ...base, projection, params: { creditSharePct: Math.round(creditShare * 100), cogsPct: Math.round(cogsRatio * 100), cogsAssumed: !known, bandPct: Math.round(band * 100) } };
}

export function describeCrunch(o: CashOutlook): string | null {
  if (o.projection.status !== "ok" || !o.projection.crunch) return null;
  const c = o.projection.crunch;
  return `${c.likelihood === "likely" ? "Expected" : "Possible"} shortfall of ${fmtCurrency(c.shortfall)} around ${c.date}, about ${c.weeksAhead} week${c.weeksAhead === 1 ? "" : "s"} ahead.`;
}

export async function settleCashItem(businessId: string, id: string): Promise<boolean> {
  const rows = await db.update(cashItems).set({ status: "settled" }).where(and(eq(cashItems.id, id), eq(cashItems.businessId, businessId))).returning({ id: cashItems.id });
  cashChanged(businessId);
  return rows.length > 0;
}
