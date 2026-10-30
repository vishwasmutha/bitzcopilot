import "server-only";
import { db } from "@/db";
import { actionLog, aiMessages, marketingCampaigns, waMessages } from "@/db/schema";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { getCustomerAnalytics, getProductPerformance, loadProducts, loadSales } from "./analytics";
import { describeCrunch, getCashOutlook } from "./cash";
import { computeLift, explainDrop, type DropReport, type LiftResult } from "./impact-math";
import { getExperiments, type ExperimentReport } from "./experiments";
import { getLatestForecast } from "./forecast";
import { activeFestivals } from "./reorder";
import { stockRunway } from "./wa";
import { addDays, fmtCurrency, isUntracked, todayISO, type Lang } from "./utils";

/* ------------------------------------------------------------------ */
/* Product promo lift (before and after). Holdout tests live in          */
/* experiments.ts and are the stronger evidence.                        */
/* ------------------------------------------------------------------ */

export type LiftReport = {
  campaignId: string;
  title: string;
  product: string | null;
  discount: number | null;
  startedOn: string;
  result: LiftResult | { status: "no-product" };
};

export async function getLiftReports(businessId: string): Promise<LiftReport[]> {
  const camps = await db
    .select()
    .from(marketingCampaigns)
    .where(and(eq(marketingCampaigns.businessId, businessId), isNotNull(marketingCampaigns.approvedAt)))
    .orderBy(desc(marketingCampaigns.approvedAt))
    .limit(6);
  if (!camps.length) return [];

  const sales = await loadSales(businessId);
  const dataStart = sales.reduce<string | null>((m, s) => (m == null || s.saleDate < m ? s.saleDate : m), null);
  const today = todayISO();

  return camps.map((c) => {
    let inputs: { product?: string; discount?: number | null } = {};
    try {
      inputs = c.inputsJson ? JSON.parse(c.inputsJson) : {};
    } catch {
      inputs = {};
    }
    const product = inputs.product && inputs.product !== "auto" ? inputs.product : null;
    const startedOn = (c.approvedAt ?? c.createdAt).toISOString().slice(0, 10);
    const base = {
      campaignId: c.id,
      title: c.title,
      product,
      discount: typeof inputs.discount === "number" ? inputs.discount : null,
      startedOn,
    };
    if (!product) return { ...base, result: { status: "no-product" as const } };
    const pm: Record<string, number> = {};
    const om: Record<string, number> = {};
    for (const s of sales) {
      const target = s.productName === product ? pm : om;
      target[s.saleDate] = (target[s.saleDate] ?? 0) + s.totalAmount;
    }
    return { ...base, result: computeLift({ product: pm, others: om, approvedDate: startedOn, today, dataStart, fmt: (n) => fmtCurrency(n) }) };
  });
}

/* ------------------------------------------------------------------ */
/* Why did sales move?                                                  */
/* ------------------------------------------------------------------ */

export async function getDropReport(businessId: string): Promise<DropReport> {
  const today = todayISO();
  const [sales, products] = await Promise.all([loadSales(businessId, addDays(today, -7 * 8 - 7)), loadProducts(businessId)]);
  const cat = new Map(products.map((p) => [p.name, p.category ?? "Other"]));
  return explainDrop(
    sales.map((s) => ({ date: s.saleDate, product: s.productName, category: cat.get(s.productName) ?? "Other", revenue: s.totalAmount })),
    today
  );
}

/* ------------------------------------------------------------------ */
/* Today's actions, ranked by rupees at stake                           */
/* ------------------------------------------------------------------ */

export type TodayAction = {
  id: string;
  kind: "drop" | "stock" | "winback" | "festival" | "repeat" | "cash" | "slow";
  title: string;
  detail: string;
  atStake: number | null;
  basis: "measured" | "prior";
  why: string;
  cta: { label: string; href: string };
};

const L = {
  drop: {
    en: (pct: number, p: string, share: number) => `Sales are down ${pct}% this week. ${p} explains ${share}% of it`,
    hi: (pct: number, p: string, share: number) => `इस हफ्ते बिक्री ${pct}% कम। ${p} की वजह से ${share}%`,
    kn: (pct: number, p: string, share: number) => `ಈ ವಾರ ಮಾರಾಟ ${pct}% ಕಡಿಮೆ. ${p} ಕಾರಣ ${share}%`,
  },
  stock: {
    en: (p: string, d: number) => `${p} runs out in ${d} day${d === 1 ? "" : "s"}`,
    hi: (p: string, d: number) => `${p} ${d} दिन में खत्म`,
    kn: (p: string, d: number) => `${p} ${d} ದಿನದಲ್ಲಿ ಮುಗಿಯುತ್ತದೆ`,
  },
  winback: {
    en: (n: number) => `${n} regular${n === 1 ? " has" : "s have"} gone quiet`,
    hi: (n: number) => `${n} नियमित ग्राहक कम आ रहे हैं`,
    kn: (n: number) => `${n} ನಿಯಮಿತ ಗ್ರಾಹಕರು ಬರುತ್ತಿಲ್ಲ`,
  },
  repeat: {
    en: (p: string) => `Repeat the ${p} promo`,
    hi: (p: string) => `${p} का ऑफर दोहराएँ`,
    kn: (p: string) => `${p} ಆಫರ್ ಮತ್ತೆ ಮಾಡಿ`,
  },
  festival: {
    en: (f: string, d: number) => `${f} is ${d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}`,
    hi: (f: string, d: number) => `${f} ${d === 0 ? "आज है" : `${d} दिन में`}`,
    kn: (f: string, d: number) => `${f} ${d === 0 ? "ಇಂದು" : `${d} ದಿನದಲ್ಲಿ`}`,
  },
  cash: {
    en: (date: string) => `Cash may run short around ${date}`,
    hi: (date: string) => `${date} के आसपास नकदी कम पड़ सकती है`,
    kn: (date: string) => `${date} ಸುಮಾರಿಗೆ ನಗದು ಕಡಿಮೆಯಾಗಬಹುದು`,
  },
  slow: {
    en: (amt: string) => `${amt} is stuck in slow-moving stock`,
    hi: (amt: string) => `${amt} धीमे बिकने वाले माल में फँसा है`,
    kn: (amt: string) => `${amt} ನಿಧಾನವಾಗಿ ಮಾರಾಟವಾಗುವ ಸರಕಿನಲ್ಲಿ ಸಿಲುಕಿದೆ`,
  },
};

export async function getTodayActions(
  businessId: string,
  opts: { lang?: Lang; limit?: number; drop?: DropReport; lifts?: LiftReport[] } = {}
): Promise<TodayAction[]> {
  const lang: Lang = opts.lang ?? "en";
  const limit = Math.min(5, Math.max(1, opts.limit ?? 3));
  const [drop, lifts, runway, products, cust, cash] = await Promise.all([
    opts.drop ?? getDropReport(businessId),
    opts.lifts ?? getLiftReports(businessId),
    stockRunway(businessId),
    loadProducts(businessId),
    getCustomerAnalytics(businessId),
    getCashOutlook(businessId),
  ]);
  const out: TodayAction[] = [];
  const enc = encodeURIComponent;

  if (drop.status === "ok" && drop.dropDetected && drop.drivers[0]) {
    const d = drop.drivers[0];
    out.push({
      id: "drop",
      kind: "drop",
      title: L.drop[lang](Math.abs(Math.round(drop.pct ?? 0)), d.product, Math.round(d.share)),
      detail: `${d.product} (${d.category}) sold ${fmtCurrency(Math.abs(d.delta))} less than a normal week${drop.worstDay ? `. ${drop.worstDay.weekday} was the weakest day` : ""}.`,
      atStake: Math.abs(drop.delta),
      basis: "measured",
      why: `This week ${fmtCurrency(drop.currentWeek)} against a normal week of ${fmtCurrency(drop.baseline)} (average of the last ${drop.baselineWeeks} same-weekday weeks). That is ${Math.abs(drop.zScore ?? 0).toFixed(1)} standard deviations under normal.`,
      cta: { label: `Draft a promo for ${d.product}`, href: `/marketing?type=whatsapp&product=${enc(d.product)}` },
    });
  }

  const cashOutlook = describeCrunch(cash);
  if (cash.projection.status === "ok" && cash.projection.crunch) {
    const c = cash.projection.crunch;
    out.push({
      id: "cash",
      kind: "cash",
      title: L.cash[lang](c.date),
      detail: cashOutlook ?? "",
      atStake: c.shortfall,
      basis: "measured",
      why: "Forecast sales, credit you are owed, supplier dues and rent were rolled forward day by day from today's cash. Open the cash outlook for the week-by-week table and every assumption.",
      cta: { label: "See the cash outlook", href: "/cash" },
    });
  }

  const price = new Map(products.map((p) => [p.name, p.sellingPrice]));
  const stockRisks = runway
    .filter((r) => r.days < 7)
    .map((r) => ({ ...r, risk: r.daily * (price.get(r.name) ?? 0) * (7 - Math.max(0, r.days)) }))
    .sort((a, b) => b.risk - a.risk);
  if (stockRisks[0] && stockRisks[0].risk > 0) {
    const r = stockRisks[0];
    const days = Math.max(1, Math.round(r.days));
    out.push({
      id: "stock",
      kind: "stock",
      title: L.stock[lang](r.name, days),
      detail: `Selling about ${r.daily} a day with ${r.stock} left. ${stockRisks.length > 1 ? `${stockRisks.length - 1} more item${stockRisks.length > 2 ? "s are" : " is"} also under a week.` : ""}`.trim(),
      atStake: r.risk,
      basis: "measured",
      why: `Daily rate is the last 14 days of sales divided by 14. Money at stake is the daily rate x selling price x the days you would be empty in the next week.`,
      cta: { label: "Open the purchase plan", href: "/inventory" },
    });
  }

  const atRisk = cust.segments.find((s) => s.name.startsWith("At-risk"));
  if (atRisk && atRisk.count > 0 && cust.avgSpent && cust.avgOrdersPerCustomer) {
    const ticket = cust.avgSpent / Math.max(1, cust.avgOrdersPerCustomer);
    out.push({
      id: "winback",
      kind: "winback",
      title: L.winback[lang](atRisk.count),
      detail: `A usual visit is worth about ${fmtCurrency(ticket)}. A short WhatsApp message to the ones who agreed to hear from you costs nothing.`,
      atStake: atRisk.count * ticket,
      basis: "measured",
      why: `At-risk means they used to buy often and have not lately. Money at stake is one more visit from each, at your average order value. It is not a promised gain.`,
      cta: { label: "Draft a win-back message", href: "/marketing?type=retention&segment=At-risk%20customers" },
    });
  }

  const best = lifts
    .filter((l): l is LiftReport & { result: Extract<LiftResult, { status: "measured" }> } => l.result.status === "measured" && l.result.verdict === "lift" && !!l.product)
    .sort((a, b) => b.result.incremental - a.result.incremental)[0];
  if (best) {
    out.push({
      id: `repeat-${best.campaignId}`,
      kind: "repeat",
      title: L.repeat[lang](best.product!),
      detail: `Last time it sold ${fmtCurrency(best.result.incremental)} more than you would have anyway (${Math.round(best.result.liftPct ?? 0)}% above normal).`,
      atStake: best.result.incremental,
      basis: "measured",
      why: "Measured against your own pre-promo baseline, adjusted for how the rest of the shop moved in the same days.",
      cta: { label: "Reuse this offer", href: `/marketing?type=whatsapp&product=${enc(best.product!)}${best.discount ? `&discount=${best.discount}` : ""}` },
    });
  }

  const slowTotal = products.reduce((a, p) => {
    const sold14 = runway.find((r) => r.name === p.name);
    return !sold14 && p.stockQty > 0 && !isUntracked(p.stockQty, p.minStock) ? a + p.stockQty * p.unitCost : a;
  }, 0);
  if (slowTotal >= 2000) {
    out.push({
      id: "slow",
      kind: "slow",
      title: L.slow[lang](fmtCurrency(slowTotal, true)),
      detail: "These items did not sell in the last 14 days. Skip reordering them and consider a bundle or a small discount.",
      atStake: slowTotal,
      basis: "measured",
      why: "Stock on hand x your unit cost for products with no sales in 14 days. That cash is tied up on the shelf.",
      cta: { label: "See slow movers", href: "/inventory" },
    });
  }

  for (const f of activeFestivals()) {
    if (f.daysAway == null || f.daysAway < 0) continue;
    out.push({
      id: `festival-${f.id}`,
      kind: "festival",
      title: L.festival[lang](f.name, f.daysAway),
      detail: `Stock up on ${f.appliesTo.join(", ")}. The usual bump is a labelled prior of x${f.lift}.`,
      atStake: null,
      basis: "prior",
      why: f.note,
      cta: { label: "See the festival plan", href: "/inventory" },
    });
    break;
  }

  return out
    .sort((a, b) => (a.basis === b.basis ? (b.atStake ?? 0) - (a.atStake ?? 0) : a.basis === "measured" ? -1 : 1))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Peer reference ranges                                                 */
/* ------------------------------------------------------------------ */

type Band = [number, number];
const REFERENCE: Record<string, { repeat: Band; margin: Band; lowStock: Band }> = {
  Kirana: { repeat: [55, 75], margin: [10, 18], lowStock: [0, 15] },
  Salon: { repeat: [45, 65], margin: [40, 65], lowStock: [0, 15] },
  Bakery: { repeat: [35, 55], margin: [45, 65], lowStock: [0, 15] },
  Restaurant: { repeat: [30, 50], margin: [55, 70], lowStock: [0, 15] },
  "Grocery Store": { repeat: [50, 70], margin: [12, 22], lowStock: [0, 15] },
  "Retail Store": { repeat: [25, 45], margin: [30, 50], lowStock: [0, 15] },
  "Clothing Store": { repeat: [20, 40], margin: [40, 55], lowStock: [0, 15] },
  Other: { repeat: [30, 60], margin: [15, 50], lowStock: [0, 15] },
};

export type BenchmarkRow = {
  key: string;
  label: string;
  value: number | null;
  band: Band;
  better: "higher" | "lower";
  position: "below" | "within" | "above" | "unknown";
  read: string;
};

export type BenchmarkReport = { category: string; rows: BenchmarkRow[]; source: string };

export async function getBenchmarks(businessId: string, category: string): Promise<BenchmarkReport> {
  const ref = REFERENCE[category] ?? REFERENCE.Other;
  const [cust, perf, products] = await Promise.all([getCustomerAnalytics(businessId), getProductPerformance(businessId, 30), loadProducts(businessId)]);

  const repeat = cust.total >= 10 ? (cust.repeat / cust.total) * 100 : null;
  const withMargin = perf.filter((p) => p.margin != null && p.revenue > 0);
  const revSum = withMargin.reduce((a, p) => a + p.revenue, 0);
  const margin = revSum > 0 ? withMargin.reduce((a, p) => a + p.revenue * (p.margin ?? 0), 0) / revSum : null;
  const tracked = products.filter((p) => p.minStock > 0);
  const low = tracked.length >= 5 ? (tracked.filter((p) => p.stockQty <= p.minStock).length / tracked.length) * 100 : null;

  const place = (v: number | null, band: Band): BenchmarkRow["position"] => (v == null ? "unknown" : v < band[0] ? "below" : v > band[1] ? "above" : "within");
  const rows: BenchmarkRow[] = [
    {
      key: "repeat",
      label: "Customers who came back",
      value: repeat,
      band: ref.repeat,
      better: "higher",
      position: place(repeat, ref.repeat),
      read: repeat == null ? "Needs at least 10 identified customers." : repeat < ref.repeat[0] ? "Below the usual range. A win-back message is the cheapest lever." : repeat > ref.repeat[1] ? "Above the usual range." : "Inside the usual range.",
    },
    {
      key: "margin",
      label: "Gross margin on what you sold",
      value: margin,
      band: ref.margin,
      better: "higher",
      position: place(margin, ref.margin),
      read: margin == null ? "Needs unit cost on your products." : margin < ref.margin[0] ? "Below the usual range. Check prices on the biggest sellers before discounting." : margin > ref.margin[1] ? "Above the usual range." : "Inside the usual range.",
    },
    {
      key: "lowStock",
      label: "Items at or under minimum stock",
      value: low,
      band: ref.lowStock,
      better: "lower",
      position: place(low, ref.lowStock),
      read: low == null ? "Needs minimum stock set on at least 5 products." : low > ref.lowStock[1] ? "Above the usual range. Empty shelves cost sales." : "Inside the usual range.",
    },
  ];
  return {
    category,
    rows,
    source: "These are rule-of-thumb ranges for this kind of shop, not measured from other shops. A neighbourhood comparison from anonymous shop data is on the roadmap and would need every shop's consent.",
  };
}

/* ------------------------------------------------------------------ */
/* Pilot scorecard: the measures the pilot will be judged on             */
/* ------------------------------------------------------------------ */

export type Scorecard = {
  activeDays: { days: number; of: number };
  actionsTaken: { acted: number; total: number; pct: number | null };
  stockout: { out: number; tracked: number; pct: number | null };
  repeatVsHoldout: { treatedPct: number; heldPct: number; messaged: number; heldBack: number; experiments: number } | null;
  forecast: { beatPct: number | null; modelMae: number | null; naiveMae: number | null; naiveName: string } | null;
};

export async function getScorecard(businessId: string, experiments?: ExperimentReport[]): Promise<Scorecard> {
  const since = new Date(Date.now() - 7 * 86400000);
  const since30 = new Date(Date.now() - 30 * 86400000);
  const [waIn, aiQs, decided, logged, products, exps, latest] = await Promise.all([
    db.select({ at: waMessages.createdAt }).from(waMessages).where(and(eq(waMessages.businessId, businessId), eq(waMessages.direction, "in"), gte(waMessages.createdAt, since))),
    db.select({ at: aiMessages.createdAt }).from(aiMessages).where(and(eq(aiMessages.businessId, businessId), eq(aiMessages.role, "user"), gte(aiMessages.createdAt, since))),
    db.select({ at: actionLog.decidedAt }).from(actionLog).where(and(eq(actionLog.businessId, businessId), isNotNull(actionLog.decidedAt), gte(actionLog.decidedAt, since))),
    db.select({ status: actionLog.status }).from(actionLog).where(and(eq(actionLog.businessId, businessId), gte(actionLog.createdAt, since30))),
    loadProducts(businessId),
    experiments ? Promise.resolve(experiments) : getExperiments(businessId),
    getLatestForecast(businessId, 7),
  ]);
  const days = new Set<string>();
  for (const r of [...waIn, ...aiQs]) days.add(r.at.toISOString().slice(0, 10));
  for (const r of decided) if (r.at) days.add(r.at.toISOString().slice(0, 10));

  const acted = logged.filter((l) => ["approved", "auto_approved", "received"].includes(l.status)).length;
  const tracked = products.length;
  const out = products.filter((p) => p.stockQty <= 0).length;

  const ok = exps.filter((e): e is ExperimentReport & { result: Extract<ExperimentReport["result"], { status: "ok" }> } => e.result.status === "ok");
  const nT = ok.reduce((a, e) => a + e.result.nT, 0);
  const nH = ok.reduce((a, e) => a + e.result.nH, 0);
  const repeatVsHoldout =
    nT > 0 && nH > 0
      ? {
          treatedPct: (ok.reduce((a, e) => a + e.result.rateT * e.result.nT, 0) / nT) * 100,
          heldPct: (ok.reduce((a, e) => a + e.result.rateH * e.result.nH, 0) / nH) * 100,
          messaged: nT,
          heldBack: nH,
          experiments: ok.length,
        }
      : null;

  let forecast: Scorecard["forecast"] = null;
  if (latest?.metricsJson) {
    try {
      const b = JSON.parse(latest.metricsJson)?.backtest;
      if (b) forecast = { beatPct: b.beatPct ?? null, modelMae: b.modelMae ?? null, naiveMae: b.naiveMae ?? null, naiveName: b.naiveName ?? "same weekday last week" };
    } catch {
      forecast = null;
    }
  }

  return {
    activeDays: { days: days.size, of: 7 },
    actionsTaken: { acted, total: logged.length, pct: logged.length ? (acted / logged.length) * 100 : null },
    stockout: { out, tracked, pct: tracked ? (out / tracked) * 100 : null },
    repeatVsHoldout,
    forecast,
  };
}
