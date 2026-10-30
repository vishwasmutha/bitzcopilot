import "server-only";
import { db } from "@/db";
import { businesses, products as productsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadSales } from "./analytics";
import type { Receipt } from "./trust";
import { addDays, fmtCurrency, todayISO } from "./utils";

export type Festival = {
  id: string;
  name: string;
  date: string | null;
  daysAway: number | null;
  lift: number;
  appliesTo: string[];
  note: string;
};

const DATED: { id: string; name: string; date: string; lead: number; lift: number; appliesTo: string[]; note: string }[] = [
  {
    id: "diwali",
    name: "Diwali",
    date: "2026-11-08",
    lead: 21,
    lift: 1.35,
    appliesTo: ["Staples", "Packaged", "Household"],
    note: "Labeled seasonal prior, not measured from this shop. There is no previous Diwali in the sales file, so 35% is not a fitted effect.",
  },
  {
    id: "eid-fitr",
    name: "Eid al-Fitr",
    date: "2026-03-20",
    lead: 12,
    lift: 1.2,
    appliesTo: ["Staples", "Packaged"],
    note: "Labeled seasonal prior. Not estimated from this shop's history.",
  },
  {
    id: "eid-adha",
    name: "Eid al-Adha",
    date: "2026-05-27",
    lead: 12,
    lift: 1.15,
    appliesTo: ["Staples"],
    note: "Labeled seasonal prior. Not estimated from this shop's history.",
  },
];

export function activeFestivals(today = todayISO()): Festival[] {
  const out: Festival[] = [];
  const t = Date.parse(`${today}T00:00:00`);
  for (const f of DATED) {
    const d = Date.parse(`${f.date}T00:00:00`);
    const daysAway = Math.round((d - t) / 86400000);
    if (daysAway >= -2 && daysAway <= f.lead) {
      out.push({ id: f.id, name: f.name, date: f.date, daysAway, lift: f.lift, appliesTo: f.appliesTo, note: f.note });
    }
  }
  const month = Number(today.slice(5, 7));
  if ([10, 11, 12, 1, 2].includes(month)) {
    out.push({
      id: "wedding",
      name: "Wedding season (Bengaluru)",
      date: null,
      daysAway: null,
      lift: 1.1,
      appliesTo: ["Staples", "Produce"],
      note: "South Indian wedding-season prior (Oct–Feb). Not estimated from this shop. It is not stacked on top of a festival lift.",
    });
  }
  return out;
}

function gstFor(name: string, category: string | null, stored: number): number {
  if (stored > 0) return stored;
  const s = `${name} ${category ?? ""}`.toLowerCase();
  if (/milk|banana|onion|tomato|produce|egg/.test(s)) return 0;
  if (/maggi|parle|colgate|surf|packaged|household|colour|bridal/.test(s)) return 18;
  return 5;
}

function moqFor(name: string, stored: number): number {
  if (stored > 1) return stored;
  const s = name.toLowerCase();
  if (/rice/.test(s)) return 10;
  if (/oil/.test(s)) return 6;
  if (/atta/.test(s)) return 5;
  if (/milk/.test(s)) return 12;
  return Math.max(1, stored || 4);
}

export type PlanLine = {
  id: string;
  name: string;
  category: string | null;
  stock: number;
  daily: number;
  daysCover: number | null;
  measuredNeed: number;
  festivalLift: number | null;
  festivalName: string | null;
  orderQty: number;
  moq: number;
  unitCost: number;
  gstRate: number;
  exGst: number;
  gst: number;
  cashOut: number;
  funded: boolean;
  reason: string;
};

export async function buildPurchasePlan(businessId: string, includeFestival: boolean) {
  const today = todayISO();
  const [bizRows, products, sales] = await Promise.all([
    db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1),
    db.select().from(productsTable).where(eq(productsTable.businessId, businessId)),
    loadSales(businessId, addDays(today, -13), today),
  ]);
  const biz = bizRows[0];
  const festivals = activeFestivals(today);
  const dates = new Set(sales.map((s) => s.saleDate));
  if (dates.size < 7) {
    return {
      status: "insufficient" as const,
      receipt: {
        title: "Reorder plan",
        status: "insufficient" as const,
        headline: "Not enough history",
        steps: [{ label: "Days with sales", detail: `${dates.size} distinct days in the last 14. A reorder quantity needs at least 7.` }],
        caveat: "No order quantity was invented.",
      } satisfies Receipt,
      lines: [] as PlanLine[],
      festivals,
      budget: biz?.cashBudget ?? null,
      upiId: biz?.upiId ?? null,
      gstin: biz?.gstin ?? null,
      fundedCash: 0,
      deferredCash: 0,
      gstOnFunded: 0,
    };
  }

  const qty = new Map<string, number>();
  for (const s of sales) qty.set(s.productName, (qty.get(s.productName) ?? 0) + s.quantity);
  const strongest = festivals.reduce<Festival | null>((a, f) => (!a || f.lift > a.lift ? f : a), null);

  const lines: PlanLine[] = products.map((p) => {
    const daily = (qty.get(p.name) ?? 0) / 14;
    const daysCover = daily > 0.15 ? p.stockQty / daily : null;
    const moq = moqFor(p.name, p.moq);
    const gstRate = gstFor(p.name, p.category, p.gstRate);
    const fest = includeFestival && strongest && strongest.appliesTo.includes(p.category ?? "") ? strongest : null;
    const lift = fest ? fest.lift : 1;
    const target = Math.ceil(daily * 14 * lift);
    const measuredNeed = Math.max(0, Math.ceil(daily * 14) - p.stockQty);
    const rawNeed = Math.max(0, target - p.stockQty);
    const orderQty = rawNeed === 0 ? 0 : Math.max(moq, Math.ceil(rawNeed / moq) * moq);
    const exGst = Math.round(orderQty * p.unitCost);
    const gst = Math.round(exGst * (gstRate / 100));
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      stock: p.stockQty,
      daily: Math.round(daily * 10) / 10,
      daysCover: daysCover == null ? null : Math.round(daysCover * 10) / 10,
      measuredNeed,
      festivalLift: fest ? fest.lift : null,
      festivalName: fest?.name ?? null,
      orderQty,
      moq,
      unitCost: p.unitCost,
      gstRate,
      exGst,
      gst,
      cashOut: exGst + gst,
      funded: false,
      reason:
        orderQty === 0
          ? "14-day measured demand is already covered."
          : fest
            ? `Measured need ${measuredNeed}. Festival prior ×${fest.lift} (${fest.name}) is labeled and not from your history. Rounded up to supplier MOQ ${moq}.`
            : `Cover 14 days of measured demand (${daily.toFixed(1)}/day). Rounded up to supplier MOQ ${moq}.`,
    };
  });

  lines.sort((a, b) => (a.daysCover ?? 999) - (b.daysCover ?? 999));
  const budget = biz?.cashBudget ?? null;
  let spent = 0;
  for (const line of lines) {
    if (line.orderQty <= 0) continue;
    if (budget == null || spent + line.cashOut <= budget) {
      line.funded = true;
      spent += line.cashOut;
    }
  }
  const funded = lines.filter((l) => l.funded && l.orderQty > 0);
  const deferred = lines.filter((l) => !l.funded && l.orderQty > 0);
  const gstOnFunded = funded.reduce((a, l) => a + l.gst, 0);
  const deferredCash = deferred.reduce((a, l) => a + l.cashOut, 0);

  const receipt: Receipt = {
    title: "Purchase plan",
    status: "computed",
    headline: budget == null ? "No cash budget set — nothing was trimmed" : `${fmtCurrency(spent)} of ${fmtCurrency(budget)} weekly cash used`,
    steps: [
      { label: "Demand", detail: "Daily rate = units sold in the last 14 days ÷ 14. Target = 14 × daily rate." },
      { label: "MOQ", detail: "Order quantity is rounded up to the supplier minimum. That extra stock is visible, not hidden in the total." },
      { label: "GST", detail: `Cash out includes GST. ${biz?.gstin ? `GSTIN ${biz.gstin} on file — GST on funded lines (${fmtCurrency(gstOnFunded)}) is input tax credit, but the UPI debit is still the GST-inclusive amount today.` : "No GSTIN saved — GST is treated as a cash cost, not credit."}` },
      { label: "Festival", detail: includeFestival && strongest ? `${strongest.name} prior ×${strongest.lift} on ${strongest.appliesTo.join(", ")}. ${strongest.note}` : "Festival prior is off. Only measured demand is used." },
      { label: "Cash", detail: budget == null ? "Set a weekly cash budget to see what the supplier bill can actually fit." : `Funded in urgency order (fewest days of cover first) until ₹${budget} is used. Deferred lines are not silently dropped.` },
    ],
    caveat: "Festival lifts are priors. They are never mixed into the measured rate without a label.",
  };

  return {
    status: "computed" as const,
    receipt,
    lines,
    festivals,
    budget,
    upiId: biz?.upiId ?? null,
    gstin: biz?.gstin ?? null,
    fundedCash: spent,
    deferredCash,
    gstOnFunded,
  };
}
