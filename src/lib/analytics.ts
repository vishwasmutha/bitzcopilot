import "server-only";
import { db } from "@/db";
import {
  customers as customersTable,
  notifications,
  products as productsTable,
  sales as salesTable,
} from "@/db/schema";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { addDays, fmtCurrency, previousMonthRange, startOfMonthISO, todayISO } from "./utils";
import { explainDrop } from "./impact-math";
import { rankAndCap } from "./engine-math";

type SalesRow = {
  saleDate: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  customerId: string | null;
};

/* ------------------------------------------------------------------ */
/* Data loading                                                         */
/* ------------------------------------------------------------------ */

export async function loadSales(businessId: string, from?: string, to?: string): Promise<SalesRow[]> {
  const conds = [eq(salesTable.businessId, businessId)];
  if (from) conds.push(gte(salesTable.saleDate, from));
  if (to) conds.push(lte(salesTable.saleDate, to));
  return db
    .select({
      saleDate: salesTable.saleDate,
      productName: salesTable.productName,
      quantity: salesTable.quantity,
      unitPrice: salesTable.unitPrice,
      totalAmount: salesTable.totalAmount,
      customerId: salesTable.customerId,
    })
    .from(salesTable)
    .where(and(...conds));
}

export async function loadProducts(businessId: string) {
  return db
    .select()
    .from(productsTable)
    .where(eq(productsTable.businessId, businessId))
    .orderBy(productsTable.name);
}

export async function loadCustomers(businessId: string) {
  return db
    .select()
    .from(customersTable)
    .where(eq(customersTable.businessId, businessId));
}

/* ------------------------------------------------------------------ */
/* KPI overview                                                         */
/* ------------------------------------------------------------------ */

export type Overview = {
  hasData: boolean;
  dataDays: number;
  totalRevenue: number;
  totalOrders: number;
  revenue30: number;
  revenuePrev30: number;
  growthPct: number | null;
  orders30: number;
  aov: number | null;
  productCount: number;
  inventoryValue: number;
  activeCustomers30: number;
  totalCustomers: number;
  predictedRevenue7: number | null;
  topProduct: { name: string; revenue: number } | null;
  lowStockCount: number;
  outOfStockCount: number;
};

export async function getOverview(businessId: string): Promise<Overview> {
  const [sales, products, custs] = await Promise.all([
    loadSales(businessId),
    loadProducts(businessId),
    loadCustomers(businessId),
  ]);

  const today = todayISO();
  const d30 = addDays(today, -29);
  const d60 = addDays(today, -59);

  let revenue30 = 0;
  let revenuePrev30 = 0;
  let totalRevenue = 0;
  const orderKeys = new Set<string>();
  let orders30 = 0;
  let rev30Amt = 0;
  const datesSeen = new Set<string>();
  const buyers30 = new Set<string>();
  const prodRevenue = new Map<string, number>();

  for (const s of sales) {
    totalRevenue += s.totalAmount;
    datesSeen.add(s.saleDate);
    const key = `${s.saleDate}|${s.customerId ?? "walkin"}`;
    orderKeys.add(key);
    if (s.saleDate >= d30) {
      revenue30 += s.totalAmount;
      orders30++;
      rev30Amt += s.totalAmount;
      if (s.customerId) buyers30.add(s.customerId);
      prodRevenue.set(s.productName, (prodRevenue.get(s.productName) ?? 0) + s.totalAmount);
    }
    if (s.saleDate >= d60 && s.saleDate < d30) revenuePrev30 += s.totalAmount;
  }

  const growthPct = revenuePrev30 > 0 ? ((revenue30 - revenuePrev30) / revenuePrev30) * 100 : null;

  // Simple trend-aware 7-day prediction (full ML lives in /forecast)
  let predictedRevenue7: number | null = null;
  if (datesSeen.size >= 28) {
    const last14 = sales.filter((s) => s.saleDate >= addDays(today, -13));
    const prev14 = sales.filter((s) => s.saleDate >= addDays(today, -27) && s.saleDate < addDays(today, -14));
    const sum = (rows: SalesRow[]) => rows.reduce((a, r) => a + r.totalAmount, 0);
    const a = sum(last14) / 14;
    const b = sum(prev14) / 14;
    const rate = b > 0 ? (a - b) / b : 0;
    predictedRevenue7 = Math.max(0, a * 7 * (1 + Math.max(-0.5, Math.min(0.5, rate))));
  }

  let topProduct: { name: string; revenue: number } | null = null;
  for (const [name, revenue] of prodRevenue) {
    if (!topProduct || revenue > topProduct.revenue) topProduct = { name, revenue };
  }

  const lowStockCount = products.filter((p) => p.stockQty > 0 && p.stockQty <= Math.max(p.minStock, 1)).length;
  const outOfStockCount = products.filter((p) => p.stockQty <= 0).length;

  return {
    hasData: sales.length > 0,
    dataDays: datesSeen.size,
    totalRevenue,
    totalOrders: orderKeys.size,
    revenue30,
    revenuePrev30,
    growthPct,
    orders30,
    aov: orders30 > 0 ? rev30Amt / orders30 : null,
    productCount: products.length,
    inventoryValue: products.reduce((a, p) => a + p.stockQty * p.unitCost, 0),
    activeCustomers30: buyers30.size,
    totalCustomers: custs.length,
    predictedRevenue7,
    topProduct,
    lowStockCount,
    outOfStockCount,
  };
}

/* ------------------------------------------------------------------ */
/* Time series                                                          */
/* ------------------------------------------------------------------ */

export async function getDailySalesSeries(businessId: string, days: number) {
  const from = addDays(todayISO(), -(days - 1));
  const sales = await loadSales(businessId, from);
  const map = new Map<string, { revenue: number; orders: number }>();
  for (const s of sales) {
    const cur = map.get(s.saleDate) ?? { revenue: 0, orders: 0 };
    cur.revenue += s.totalAmount;
    cur.orders += 1;
    map.set(s.saleDate, cur);
  }
  const out: { date: string; revenue: number; orders: number; label: string }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(todayISO(), -i);
    const v = map.get(d) ?? { revenue: 0, orders: 0 };
    out.push({ date: d, revenue: Math.round(v.revenue * 100) / 100, orders: v.orders, label: d.slice(5) });
  }
  return out;
}

export async function getMonthlyRevenue(businessId: string, months: number) {
  const now = new Date();
  const fromD = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const from = `${fromD.getFullYear()}-${String(fromD.getMonth() + 1).padStart(2, "0")}-01`;
  const sales = await loadSales(businessId, from);
  const map = new Map<string, number>();
  for (const s of sales) {
    const k = s.saleDate.slice(0, 7);
    map.set(k, (map.get(k) ?? 0) + s.totalAmount);
  }
  const out: { month: string; label: string; revenue: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({
      month: key,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      revenue: Math.round((map.get(key) ?? 0) * 100) / 100,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Product performance                                                  */
/* ------------------------------------------------------------------ */

export type ProductPerf = {
  name: string;
  category: string;
  revenue: number;
  quantity: number;
  last14: number;
  prev14: number;
  changePct: number | null;
  margin: number | null;
};

export async function getProductPerformance(businessId: string, days = 30): Promise<ProductPerf[]> {
  const today = todayISO();
  const from = addDays(today, -(days - 1));
  const [sales, products] = await Promise.all([loadSales(businessId, from), loadProducts(businessId)]);
  const catMap = new Map(products.map((p) => [p.name, p.category ?? "Other"]));
  const priceMap = new Map(products.map((p) => [p.name, p.unitCost]));

  const agg = new Map<string, { revenue: number; quantity: number; last14: number; prev14: number }>();
  for (const s of sales) {
    const a = agg.get(s.productName) ?? { revenue: 0, quantity: 0, last14: 0, prev14: 0 };
    a.revenue += s.totalAmount;
    a.quantity += s.quantity;
    if (s.saleDate >= addDays(today, -13)) a.last14 += s.totalAmount;
    else a.prev14 += s.totalAmount;
    agg.set(s.productName, a);
  }
  return Array.from(agg.entries())
    .map(([name, a]) => {
      const unitCost = priceMap.get(name);
      const unitPrice = a.quantity > 0 ? a.revenue / a.quantity : null;
      return {
        name,
        category: catMap.get(name) ?? "Other",
        revenue: Math.round(a.revenue * 100) / 100,
        quantity: a.quantity,
        last14: Math.round(a.last14 * 100) / 100,
        prev14: Math.round(a.prev14 * 100) / 100,
        changePct: a.prev14 > 0 ? ((a.last14 - a.prev14) / a.prev14) * 100 : null,
        margin: unitCost != null && unitPrice != null && unitPrice > 0 ? ((unitPrice - unitCost) / unitPrice) * 100 : null,
      };
    })
    .sort((x, y) => y.revenue - x.revenue);
}

export async function getCategoryRevenue(businessId: string, days = 30) {
  const perf = await getProductPerformance(businessId, days);
  const map = new Map<string, number>();
  for (const p of perf) map.set(p.category, (map.get(p.category) ?? 0) + p.revenue);
  return Array.from(map.entries())
    .map(([category, revenue]) => ({ category, revenue: Math.round(revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue);
}

/* ------------------------------------------------------------------ */
/* Customer analytics + RFM                                             */
/* ------------------------------------------------------------------ */

export type RfmSegment = {
  name: string;
  description: string;
  suggestion: string;
  count: number;
  revenue: number;
  members: { refId: string; name: string | null; recencyDays: number; orders: number; spent: number }[];
};

export type CustomerAnalytics = {
  total: number;
  repeat: number;
  new30: number;
  inactive45: number;
  active30: number;
  avgSpent: number | null;
  avgOrdersPerCustomer: number | null;
  topSpenders: { refId: string; name: string | null; spent: number; orders: number }[];
  segments: RfmSegment[];
  monthly: { month: string; label: string; newCustomers: number; revenue: number }[];
};

export async function refreshCustomerAggregates(businessId: string): Promise<void> {
  const [sales, custs] = await Promise.all([loadSales(businessId), loadCustomers(businessId)]);
  const agg = new Map<string, { first: string; last: string; spent: number; orders: Set<string> }>();
  for (const s of sales) {
    if (!s.customerId) continue;
    const a = agg.get(s.customerId) ?? { first: s.saleDate, last: s.saleDate, spent: 0, orders: new Set<string>() };
    if (s.saleDate < a.first) a.first = s.saleDate;
    if (s.saleDate > a.last) a.last = s.saleDate;
    a.spent += s.totalAmount;
    a.orders.add(s.saleDate);
    agg.set(s.customerId, a);
  }
  for (const c of custs) {
    const a = agg.get(c.refId);
    if (!a) continue;
    await db
      .update(customersTable)
      .set({
        firstPurchaseAt: a.first,
        lastPurchaseAt: a.last,
        totalSpent: Math.round(a.spent * 100) / 100,
        orderCount: a.orders.size,
      })
      .where(eq(customersTable.id, c.id));
  }
}

function classify(
  recencyDays: number,
  orders: number,
  rMed: number,
  fMed: number,
  mMed: number,
  spent: number
): string {
  const rHigh = recencyDays <= rMed;
  const fHigh = orders >= fMed;
  const mHigh = spent >= mMed;
  if (orders <= 2 && recencyDays <= 30) return "new";
  if (recencyDays > 90) return "inactive";
  if (rHigh && fHigh && mHigh) return "loyal";
  if (fHigh && mHigh) return "high_value";
  if (fHigh && !rHigh) return "at_risk";
  if (fHigh) return "potential_loyalist";
  if (rHigh) return "active";
  return "declining";
}

export async function getCustomerAnalytics(businessId: string): Promise<CustomerAnalytics> {
  const today = todayISO();
  const [custs, sales] = await Promise.all([loadCustomers(businessId), loadSales(businessId)]);

  const perCust = new Map<
    string,
    { refId: string; name: string | null; last: string; first: string; spent: number; orders: Set<string> }
  >();
  for (const c of custs)
    perCust.set(c.refId, {
      refId: c.refId,
      name: c.name,
      last: c.lastPurchaseAt ?? "1970-01-01",
      first: c.firstPurchaseAt ?? c.lastPurchaseAt ?? today,
      spent: c.totalSpent,
      orders: new Set(),
    });
  for (const s of sales) {
    if (!s.customerId) continue;
    let a = perCust.get(s.customerId);
    if (!a) {
      a = { refId: s.customerId, name: null, last: s.saleDate, first: s.saleDate, spent: 0, orders: new Set() };
      perCust.set(s.customerId, a);
    }
    if (s.saleDate > a.last) a.last = s.saleDate;
    if (s.saleDate < a.first) a.first = s.saleDate;
    a.spent += s.totalAmount;
    a.orders.add(s.saleDate);
  }

  const arr = Array.from(perCust.values());
  const recs = arr.map((c) => (Date.parse(`${today}T00:00:00`) - Date.parse(`${c.last}T00:00:00`)) / 86400000);
  const freqs = arr.map((c) => c.orders.size);
  const mones = arr.map((c) => c.spent);
  const median = (xs: number[]) => {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const rMed = median(recs);
  const fMed = Math.max(2, median(freqs));
  const mMed = median(mones);

  const buckets: Record<string, RfmSegment> = {
    loyal: {
      name: "Loyal customers",
      description: "Buy frequently, spend well, and are active right now.",
      suggestion: "Reward them with a VIP offer or early access to new products.",
      count: 0,
      revenue: 0,
      members: [],
    },
    high_value: {
      name: "High-value customers",
      description: "Large baskets, strong history, but not buying this week.",
      suggestion: "Send a win-back message with a personalised recommendation.",
      count: 0,
      revenue: 0,
      members: [],
    },
    new: {
      name: "New customers",
      description: "First purchases within the last 30 days.",
      suggestion: "Follow up within 2 days with a thank-you + second-visit incentive.",
      count: 0,
      revenue: 0,
      members: [],
    },
    potential_loyalist: {
      name: "Potential loyalists",
      description: "Buying frequently — one nudge away from becoming loyal.",
      suggestion: "Introduce a punch-card / loyalty program targeted at them.",
      count: 0,
      revenue: 0,
      members: [],
    },
    at_risk: {
      name: "At-risk customers",
      description: "Used to buy often, but their last visit is drifting away.",
      suggestion: "Launch an exclusive reactivation offer within the next 7 days.",
      count: 0,
      revenue: 0,
      members: [],
    },
    active: {
      name: "Active one-time",
      description: "Recently purchased, but only once or twice so far.",
      suggestion: "Cross-sell your best-seller to trigger a repeat visit.",
      count: 0,
      revenue: 0,
      members: [],
    },
    declining: {
      name: "Declining customers",
      description: "Irregular purchasing and fading engagement.",
      suggestion: "Test a small discount to see if the relationship can be revived.",
      count: 0,
      revenue: 0,
      members: [],
    },
    inactive: {
      name: "Inactive customers",
      description: "No purchase for more than 90 days.",
      suggestion: "A 'we miss you' campaign with a generous one-time offer.",
      count: 0,
      revenue: 0,
      members: [],
    },
  };

  const new30 = new Set<string>();
  const inactive = new Set<string>();
  const active30 = new Set<string>();
  const repeat = new Set<string>();
  for (const c of arr) {
    const rec = (Date.parse(`${today}T00:00:00`) - Date.parse(`${c.last}T00:00:00`)) / 86400000;
    if (rec <= 30) active30.add(c.refId);
    if (rec > 45) inactive.add(c.refId);
    if (c.orders.size >= 2) repeat.add(c.refId);
    const firstRec = (Date.parse(`${today}T00:00:00`) - Date.parse(`${c.first}T00:00:00`)) / 86400000;
    // "new" = recent first purchase AND not yet a regular
    if (firstRec <= 30 && c.orders.size < 3) new30.add(c.refId);

    const seg = classify(rec, c.orders.size, Math.max(0, rMed), fMed, mMed, c.spent);
    const b = buckets[seg];
    b.count++;
    b.revenue += c.spent;
    b.members.push({
      refId: c.refId,
      name: c.name,
      recencyDays: Math.round(rec),
      orders: c.orders.size,
      spent: Math.round(c.spent * 100) / 100,
    });
  }
  for (const b of Object.values(buckets)) b.members.sort((a, z) => z.spent - a.spent);

  const topSpenders = [...arr]
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 5)
    .map((c) => ({ refId: c.refId, name: c.name, spent: Math.round(c.spent * 100) / 100, orders: c.orders.size }));

  // monthly trend last 6 months
  const now = new Date();
  const monthly: { month: string; label: string; newCustomers: number; revenue: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthly.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-US", { month: "short" }),
      newCustomers: 0,
      revenue: 0,
    });
  }
  for (const c of arr) {
    const fm = (c.first ?? today).slice(0, 7);
    const m = monthly.find((x) => x.month === fm);
    if (m) m.newCustomers++;
  }
  for (const s of sales) {
    const m = monthly.find((x) => x.month === s.saleDate.slice(0, 7));
    if (m) m.revenue += s.totalAmount;
  }
  monthly.forEach((m) => (m.revenue = Math.round(m.revenue * 100) / 100));

  return {
    total: arr.length,
    repeat: repeat.size,
    new30: new30.size,
    inactive45: inactive.size,
    active30: active30.size,
    avgSpent: arr.length ? arr.reduce((a, c) => a + c.spent, 0) / arr.length : null,
    avgOrdersPerCustomer: arr.length ? arr.reduce((a, c) => a + c.orders.size, 0) / arr.length : null,
    topSpenders,
    segments: Object.values(buckets).filter((b) => b.count > 0).sort((a, b) => b.revenue - a.revenue),
    monthly,
  };
}

/* ------------------------------------------------------------------ */
/* Rule-based insights (dashboard + notifications)                      */
/* ------------------------------------------------------------------ */

export type Insight = {
  tone: "positive" | "warning" | "negative" | "info";
  text: string;
};

export async function getInsights(businessId: string): Promise<Insight[]> {
  const out: Insight[] = [];
  const overview = await getOverview(businessId);
  if (!overview.hasData) {
    out.push({
      tone: "info",
      text: "No sales data yet. Import a sales file (CSV or Excel) on the Data page, or load a demo dataset from Settings.",
    });
    return out;
  }

  // Month over month
  const curFrom = startOfMonthISO();
  const prev = previousMonthRange();
  const [cur, prevS] = await Promise.all([loadSales(businessId, curFrom), loadSales(businessId, prev.from, prev.to)]);
  const curRev = cur.reduce((a, s) => a + s.totalAmount, 0);
  const prevRev = prevS.reduce((a, s) => a + s.totalAmount, 0);
  if (prevRev > 0) {
    const ch = ((curRev - prevRev) / prevRev) * 100;
    if (Math.abs(ch) >= 3)
      out.push({
        tone: ch > 0 ? "positive" : "negative",
        text: `Revenue is ${ch > 0 ? "up" : "down"} ${Math.abs(ch).toFixed(1)}% month-over-month (${cur.length} transactions so far this month vs ${prevS.length} last month).`,
      });
  }

  // Top product
  const perf = await getProductPerformance(businessId, 30);
  if (perf.length) {
    out.push({
      tone: "info",
      text: `${perf[0].name} is your top seller over the last 30 days — ${perf[0].quantity} units, ${fmtCurrency(perf[0].revenue)} in revenue.`,
    });
    const decliners = perf
      .filter((p) => p.changePct != null && p.prev14 >= 20 && p.changePct < -15)
      .sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0));
    if (decliners.length) {
      const d = decliners[0];
      out.push({
        tone: "warning",
        text: `${d.name} sales fell ${Math.abs(d.changePct ?? 0).toFixed(0)}% in the last two weeks — a targeted promotion could help.`,
      });
    }
    const risers = perf
      .filter((p) => p.changePct != null && p.prev14 >= 20 && p.changePct > 25)
      .sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
    if (risers.length)
      out.push({
        tone: "positive",
        text: `${risers[0].name} demand is surging (+${(risers[0].changePct ?? 0).toFixed(0)}% vs the prior two weeks). Make sure stock keeps up.`,
      });
  }

  // Stock
  if (overview.outOfStockCount > 0)
    out.push({
      tone: "negative",
      text: `${overview.outOfStockCount} product${overview.outOfStockCount > 1 ? "s are" : " is"} completely out of stock right now.`,
    });
  else if (overview.lowStockCount > 0)
    out.push({
      tone: "warning",
      text: `${overview.lowStockCount} product${overview.lowStockCount > 1 ? "s are" : " is"} running low on stock. Check Inventory → Recommendations.`,
    });

  // Weekend vs weekday
  const sales = await loadSales(businessId, addDays(todayISO(), -28));
  let wkRev = 0,
    wkN = 0,
    weRev = 0,
    weN = 0;
  for (const s of sales) {
    const dow = new Date(`${s.saleDate}T00:00:00`).getDay();
    if (dow === 0 || dow === 6) {
      weRev += s.totalAmount;
      weN++;
    } else {
      wkRev += s.totalAmount;
      wkN++;
    }
  }
  if (wkN > 5 && weN > 1) {
    const wkAvg = wkRev / 5;
    const weAvg = weRev / 2;
    if (weAvg > wkAvg * 1.1)
      out.push({ tone: "info", text: `Weekend days average ${fmtCurrency(weAvg)} vs ${fmtCurrency(wkAvg)} on weekdays — plan staffing around weekends.` });
    else if (wkAvg > weAvg * 1.1)
      out.push({ tone: "info", text: `Weekdays outperform weekends for you (${fmtCurrency(wkAvg)} vs ${fmtCurrency(weAvg)} per day) — weekday promos may be under-used.` });
  }

  return out.slice(0, 6);
}

export type NotifDraft = {
  type: string;
  severity: "info" | "positive" | "warning" | "critical";
  title: string;
  message: string;
  dedupeKey: string;
  /** Estimated rupees at stake. Alerts are ranked by this and capped per week to avoid alert fatigue. */
  impactRs: number | null;
};

/** At most this many new alerts a week. The ones with the most rupees at stake win. */
export const WEEKLY_ALERT_CAP = 5;

export async function computeAlerts(businessId: string): Promise<NotifDraft[]> {
  const drafts: NotifDraft[] = [];
  const today = todayISO();
  const week = `${today.slice(0, 8)}${Math.floor(Number(today.slice(8)) / 7)}`;
  const [products, perf, sales8w] = await Promise.all([loadProducts(businessId), getProductPerformance(businessId, 28), loadSales(businessId, addDays(today, -7 * 8 - 7))]);

  // Units per day over the last 14 days, to price what an empty shelf costs
  const since14 = addDays(today, -13);
  const units = new Map<string, number>();
  for (const s of sales8w) if (s.saleDate >= since14) units.set(s.productName, (units.get(s.productName) ?? 0) + s.quantity);
  const dailyOf = (name: string) => (units.get(name) ?? 0) / 14;

  const outOfStock = products.filter((p) => p.stockQty <= 0);
  for (const p of outOfStock)
    drafts.push({
      type: "out_of_stock",
      severity: "critical",
      title: "Out of stock",
      message: `${p.name} has no stock left. Every sale of this item is currently lost revenue.`,
      dedupeKey: `out_of_stock:${p.name}:${today}`,
      impactRs: Math.round(dailyOf(p.name) * p.sellingPrice * 7),
    });

  const low = products.filter((p) => p.stockQty > 0 && p.stockQty <= Math.max(p.minStock, 1));
  for (const p of low) {
    const d = dailyOf(p.name);
    const emptyDays = d > 0 ? Math.max(0, 7 - p.stockQty / d) : 0;
    drafts.push({
      type: "low_stock",
      severity: "warning",
      title: "Low stock",
      message: `${p.name} is down to ${p.stockQty} units (minimum level ${p.minStock}). Consider reordering.`,
      dedupeKey: `low_stock:${p.name}:${week}`,
      impactRs: Math.round(d * p.sellingPrice * emptyDays),
    });
  }

  // Sales drop: this week against the same 7-day window in each of the last 4 to 8 weeks
  const cat = new Map(products.map((p) => [p.name, p.category ?? "Other"]));
  const drop = explainDrop(
    sales8w.map((s) => ({ date: s.saleDate, product: s.productName, category: cat.get(s.productName) ?? "Other", revenue: s.totalAmount })),
    today
  );
  if (drop.status === "ok" && drop.dropDetected) {
    const top = drop.drivers[0];
    const topCat = drop.categories[0];
    drafts.push({
      type: "sales_drop",
      severity: "warning",
      title: "Sales drop detected",
      message: `This week's sales are ${Math.abs(drop.pct ?? 0).toFixed(0)}% below a normal week (${fmtCurrency(drop.currentWeek)} against ${fmtCurrency(drop.baseline)}, ${Math.abs(drop.zScore ?? 0).toFixed(1)} standard deviations under).${top ? ` ${top.product} explains ${Math.round(top.share)}% of the gap` : ""}${topCat ? `, mostly in ${topCat.category}` : ""}.`,
      dedupeKey: `sales_drop:week:${week}`,
      impactRs: Math.round(Math.abs(drop.delta)),
    });
  } else if (drop.status === "ok" && drop.growthDetected) {
    drafts.push({
      type: "sales_growth",
      severity: "positive",
      title: "Sales momentum",
      message: `This week's sales are ${(drop.pct ?? 0).toFixed(0)}% above a normal week${drop.drivers[0] ? `, led by ${drop.drivers[0].product}` : ""}. Keep the momentum and stock up on best-sellers.`,
      dedupeKey: `sales_growth:week:${week}`,
      impactRs: null,
    });
  }

  // Demand surge per product
  const surge = perf.filter((p) => p.changePct != null && p.prev14 >= 25 && p.changePct > 40);
  for (const p of surge.slice(0, 3))
    drafts.push({
      type: "demand_surge",
      severity: "info",
      title: "Demand increasing",
      message: `${p.name} is selling ${p.changePct!.toFixed(0)}% faster than the prior two weeks. The AI inventory plan will factor this in.`,
      dedupeKey: `demand_surge:${p.name}:${week}`,
      impactRs: null,
    });

  // Customer engagement
  const overview = await getOverview(businessId);
  if (overview.activeCustomers30 < 3 && overview.totalCustomers > 10)
    drafts.push({
      type: "customer_decline",
      severity: "warning",
      title: "Customer engagement falling",
      message: `Fewer than 3 of your ${overview.totalCustomers} customers purchased in the last 30 days. A win-back campaign may help.`,
      dedupeKey: `customer_decline:month:${today.slice(0, 7)}`,
      impactRs: null,
    });

  return drafts;
}

/**
 * Inserts alerts that do not exist yet for this business. New alerts are ranked by
 * rupees at stake and only the top few per week are kept, so the owner is not flooded.
 */
export async function syncNotifications(businessId: string): Promise<number> {
  const drafts = await computeAlerts(businessId);
  if (!drafts.length) return 0;
  const existing = await db.select({ key: notifications.dedupeKey, at: notifications.createdAt, type: notifications.type }).from(notifications).where(eq(notifications.businessId, businessId));
  const have = new Set(existing.map((e) => e.key));
  const weekAgo = Date.now() - 7 * 86400000;
  // The daily brief is a delivery receipt, not an alert, so it does not use up the weekly alert budget.
  const thisWeek = existing.filter((e) => e.type !== "daily_brief" && e.at.getTime() >= weekAgo).length;
  const fresh = drafts.filter((d) => !have.has(d.dedupeKey));
  const { keep } = rankAndCap(fresh, thisWeek, WEEKLY_ALERT_CAP);
  for (const d of keep) await db.insert(notifications).values({ businessId, ...d });
  return keep.length;
}

export async function getNotifications(businessId: string) {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.businessId, businessId))
    .orderBy(desc(notifications.createdAt))
    .limit(100);
  return rows;
}
