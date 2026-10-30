/* ------------------------------------------------------------------ */
/* Pure engines: reorder point, cash-flow projection, holdout           */
/* experiments, quick-sale parsing, alert ranking, forecast confidence. */
/* No imports, so every function runs in a plain Node test.             */
/* ------------------------------------------------------------------ */

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/* ------------------------------------------------------------------ */
/* Reorder point = average daily demand x lead time + safety stock       */
/* ------------------------------------------------------------------ */

export type ReorderPoint = {
  dailyMean: number;
  dailySd: number;
  leadTimeDays: number;
  leadDemand: number;
  safetyStock: number;
  rop: number;
};

/** Safety stock = z x daily standard deviation x sqrt(lead time). z = 1.65 targets about a 95% in-stock rate. */
export function reorderPoint(daily: number[], leadTimeDays: number, z = 1.65): ReorderPoint {
  const dailyMean = mean(daily);
  const dailySd = sd(daily);
  const L = Math.max(1, leadTimeDays);
  const leadDemand = dailyMean * L;
  const safetyStock = z * dailySd * Math.sqrt(L);
  return { dailyMean, dailySd, leadTimeDays: L, leadDemand, safetyStock, rop: leadDemand + safetyStock };
}

export type StockRisk = "stockout_before_delivery" | "reorder_now" | "ok";

export function stockRisk(stock: number, r: ReorderPoint): StockRisk {
  if (r.dailyMean <= 0) return "ok";
  if (stock < r.leadDemand) return "stockout_before_delivery";
  if (stock <= r.rop) return "reorder_now";
  return "ok";
}

/** Stock that has not moved: more than 60 days of cover, or unsold in the window. Returns cash trapped at cost. */
export function slowMover(stock: number, dailyMean: number, unitCost: number, coverDays = 60): { slow: boolean; coverDays: number | null; cashTrapped: number } {
  if (stock <= 0) return { slow: false, coverDays: null, cashTrapped: 0 };
  const cover = dailyMean > 0 ? stock / dailyMean : null;
  const slow = cover == null || cover > coverDays;
  return { slow, coverDays: cover, cashTrapped: slow ? stock * unitCost : 0 };
}

/* ------------------------------------------------------------------ */
/* Cash-flow guardian                                                   */
/* ------------------------------------------------------------------ */

export type CashItemIn = {
  kind: "receivable" | "payable" | "recurring";
  party: string;
  amount: number;
  dueDate: string;
  recurrence: "none" | "weekly" | "monthly";
  status: "open" | "settled";
};

export type CashInput = {
  today: string;
  openingCash: number;
  horizonDays: number;
  /** Expected sales revenue per day, with the forecast's low and high band. */
  salesForecast: { date: string; low: number; mid: number; high: number }[];
  /** Share of sales given on credit (0 to 0.8). Those sales reach the till only when the receivable is collected. */
  creditShare: number;
  /** Money spent on stock for every rupee of sales. */
  cogsRatio: number;
  items: CashItemIn[];
};

export type Scenario = "low" | "mid" | "high";

export type CashProjection =
  | { status: "insufficient"; why: string }
  | {
      status: "ok";
      days: { date: string; low: number; mid: number; high: number }[];
      weeks: { weekStart: string; inMid: number; outMid: number; low: number; mid: number; high: number }[];
      crunch: { date: string; weeksAhead: number; likelihood: "likely" | "possible"; shortfall: number } | null;
      lowest: Record<Scenario, { date: string; balance: number }>;
      assumptions: { label: string; detail: string }[];
    };

const COLLECT: Record<Scenario, number> = { low: 0.6, mid: 0.85, high: 1 };

/** Dates a recurring or one-off item falls due inside [from, to]. Monthly items keep their day of month, clamped to month end. */
export function dueDates(item: Pick<CashItemIn, "dueDate" | "recurrence">, from: string, to: string): string[] {
  const out: string[] = [];
  if (item.recurrence === "none") {
    if (item.dueDate <= to) out.push(item.dueDate < from ? from : item.dueDate);
    return out;
  }
  if (item.recurrence === "weekly") {
    let d = item.dueDate;
    while (d < from) d = addDays(d, 7);
    for (; d <= to; d = addDays(d, 7)) out.push(d);
    return out;
  }
  const day = Number(item.dueDate.slice(8, 10));
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (let i = 0; i < 18; i++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
    if (d >= item.dueDate && d >= from && d <= to) out.push(d);
    if (d > to) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function projectCash(inp: CashInput): CashProjection {
  const { today, openingCash, horizonDays, salesForecast } = inp;
  if (salesForecast.length < Math.min(14, horizonDays)) return { status: "insufficient", why: "The sales forecast is too short to project cash. It needs about 2 weeks of sales history first." };
  const to = addDays(today, horizonDays - 1);
  const dates: string[] = [];
  for (let i = 0; i < horizonDays; i++) dates.push(addDays(today, i));
  const fc = new Map(salesForecast.map((f) => [f.date, f]));
  const credit = Math.min(0.8, Math.max(0, inp.creditShare));
  const cogs = Math.min(1, Math.max(0, inp.cogsRatio));

  // One-off movements that do not depend on the scenario
  const outflow: Record<string, number> = {};
  const inflowBase: Record<string, number> = {}; // receivables, before collection probability
  for (const it of inp.items) {
    if (it.status !== "open" || !(it.amount > 0)) continue;
    const overdue = it.recurrence === "none" && it.dueDate < today;
    if (it.kind === "receivable") {
      // Overdue money is assumed to arrive a week out, at half the usual odds. See assumptions.
      const when = overdue ? addDays(today, Math.min(7, horizonDays - 1)) : it.dueDate;
      if (when >= today && when <= to) inflowBase[when] = (inflowBase[when] ?? 0) + it.amount * (overdue ? 0.5 : 1);
    } else {
      for (const d of dueDates(it, today, to)) outflow[d] = (outflow[d] ?? 0) + it.amount;
    }
  }

  const bal: Record<Scenario, number> = { low: openingCash, mid: openingCash, high: openingCash };
  const days: { date: string; low: number; mid: number; high: number }[] = [];
  const dayIn: number[] = [];
  const dayOut: number[] = [];
  for (const d of dates) {
    const f = fc.get(d);
    let inMid = 0;
    let outMid = 0;
    for (const s of ["low", "mid", "high"] as Scenario[]) {
      const rev = f ? f[s] : 0;
      const cashIn = rev * (1 - credit) + (inflowBase[d] ?? 0) * COLLECT[s];
      const cashOut = rev * cogs + (outflow[d] ?? 0);
      bal[s] += cashIn - cashOut;
      if (s === "mid") {
        inMid = cashIn;
        outMid = cashOut;
      }
    }
    dayIn.push(inMid);
    dayOut.push(outMid);
    days.push({ date: d, low: round(bal.low), mid: round(bal.mid), high: round(bal.high) });
  }

  const weeks: { weekStart: string; inMid: number; outMid: number; low: number; mid: number; high: number }[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const end = Math.min(i + 6, days.length - 1);
    weeks.push({
      weekStart: days[i].date,
      inMid: round(dayIn.slice(i, end + 1).reduce((a, b) => a + b, 0)),
      outMid: round(dayOut.slice(i, end + 1).reduce((a, b) => a + b, 0)),
      low: days[end].low,
      mid: days[end].mid,
      high: days[end].high,
    });
  }

  const lowest = {} as Record<Scenario, { date: string; balance: number }>;
  for (const s of ["low", "mid", "high"] as Scenario[]) {
    const m = days.reduce((a, d) => (d[s] < a.balance ? { date: d.date, balance: d[s] } : a), { date: days[0].date, balance: days[0][s] });
    lowest[s] = m;
  }
  let crunch: { date: string; weeksAhead: number; likelihood: "likely" | "possible"; shortfall: number } | null = null;
  const firstNeg = (s: Scenario) => days.find((d) => d[s] < 0);
  const midNeg = firstNeg("mid");
  const lowNeg = firstNeg("low");
  const hit = midNeg ?? lowNeg;
  if (hit) {
    const scenario: Scenario = midNeg ? "mid" : "low";
    const idx = days.indexOf(hit);
    crunch = { date: hit.date, weeksAhead: Math.max(1, Math.ceil((idx + 1) / 7)), likelihood: midNeg ? "likely" : "possible", shortfall: round(-lowest[scenario].balance) };
  }

  return {
    status: "ok",
    days,
    weeks,
    crunch,
    lowest,
    assumptions: [
      { label: "Opening cash", detail: "The balance you entered for today. Everything below starts from it." },
      { label: "Sales coming in", detail: `Forecast daily sales. ${Math.round(credit * 100)}% of sales are on credit, so that share reaches the till only when the customer pays.` },
      { label: "Stock going out", detail: `${Math.round(cogs * 100)} paise of every rupee of sales is spent restocking, paid as you sell.` },
      { label: "Bills and rent", detail: "Supplier dues and rent leave on their due date. Anything already overdue is paid on day one." },
      { label: "Credit you are owed", detail: "Collected on the due date at 60% (low case), 85% (expected) or 100% (high case). Overdue amounts count half and arrive a week out." },
      { label: "Low and high cases", detail: "Low uses the lower forecast band and slower collection. High uses the upper band and full collection." },
    ],
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Holdout experiments                                                  */
/* ------------------------------------------------------------------ */

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random but repeatable split: the same people land in the same group when run again with the same seed. */
export function assignHoldout(refs: string[], holdoutPct: number, seed: string): { treatment: string[]; holdout: string[] } {
  const sorted = [...new Set(refs)].sort();
  const r = rng(hashSeed(seed));
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  }
  const want = Math.round((sorted.length * holdoutPct) / 100);
  const n = Math.min(Math.max(want, sorted.length >= 12 ? 3 : 2), Math.max(0, sorted.length - 2));
  return { holdout: sorted.slice(0, n), treatment: sorted.slice(n) };
}

export type Member = { orders: number; revenue: number };

export type ExperimentResult =
  | { status: "insufficient"; why: string }
  | { status: "measuring"; daysElapsed: number; needed: number }
  | {
      status: "ok";
      verdict: "worked" | "inconclusive" | "worse";
      nT: number;
      nH: number;
      rateT: number;
      rateH: number;
      rateDiff: number;
      rateLow: number;
      rateHigh: number;
      revPerT: number;
      revPerH: number;
      incrementalPerCustomer: number;
      incrementalTotal: number;
      totalLow: number;
      totalHigh: number;
      partial: boolean;
      steps: { label: string; detail: string }[];
    };

/** t critical value for a given normal quantile z (1.96 = two-sided 95%), close enough for df >= 2. */
function tCrit(df: number, z = 1.96): number {
  const d = Math.max(1, df);
  return z + (z ** 3 + z) / (4 * d) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * d * d);
}

export function analyzeExperiment(input: { treatment: Member[]; holdout: Member[]; daysElapsed: number; windowDays: number; fmt: (n: number) => string }): ExperimentResult {
  const { treatment: T, holdout: H, daysElapsed, windowDays, fmt } = input;
  if (T.length < 10 || H.length < 5) {
    return { status: "insufficient", why: `Need at least 10 customers messaged and 5 held back for a fair comparison. This test has ${T.length} and ${H.length}.` };
  }
  if (daysElapsed < 3) return { status: "measuring", daysElapsed: Math.max(0, daysElapsed), needed: 3 };
  const rateT = T.filter((m) => m.orders > 0).length / T.length;
  const rateH = H.filter((m) => m.orders > 0).length / H.length;
  // Agresti-Caffo interval: stays sensible when a group has 0 or all successes
  const pT = (rateT * T.length + 1) / (T.length + 2);
  const pH = (rateH * H.length + 1) / (H.length + 2);
  const seR = Math.sqrt((pT * (1 - pT)) / (T.length + 2) + (pH * (1 - pH)) / (H.length + 2));
  const rateDiff = rateT - rateH;
  const revT = T.map((m) => m.revenue);
  const revH = H.map((m) => m.revenue);
  const revPerT = mean(revT);
  const revPerH = mean(revH);
  const vT = sd(revT) ** 2 / T.length;
  const vH = sd(revH) ** 2 / H.length;
  const se = Math.sqrt(vT + vH);
  const df = se > 0 ? (vT + vH) ** 2 / ((vT * vT) / (T.length - 1) + (vH * vH) / (H.length - 1)) : T.length + H.length - 2;
  const crit = tCrit(df);
  const diff = revPerT - revPerH;
  const low = diff - crit * se;
  const high = diff + crit * se;
  // Two measures are checked (did more customers come back, did they spend more), so each is judged at a
  // stricter 98.8% level. That keeps the chance of a false "worked" near 5% overall.
  const zStrict = 2.5;
  const rateLowStrict = rateDiff - zStrict * seR;
  const rateHighStrict = rateDiff + zStrict * seR;
  const critStrict = tCrit(df, zStrict);
  const revLowStrict = diff - critStrict * se;
  const revHighStrict = diff + critStrict * se;
  const verdict: "worked" | "inconclusive" | "worse" =
    (rateLowStrict > 0 && diff >= 0) || revLowStrict > 0 ? "worked" : (rateHighStrict < 0 && diff <= 0) || revHighStrict < 0 ? "worse" : "inconclusive";
  return {
    status: "ok",
    verdict,
    nT: T.length,
    nH: H.length,
    rateT,
    rateH,
    rateDiff,
    rateLow: rateDiff - 1.96 * seR,
    rateHigh: rateDiff + 1.96 * seR,
    revPerT,
    revPerH,
    incrementalPerCustomer: diff,
    incrementalTotal: diff * T.length,
    totalLow: low * T.length,
    totalHigh: high * T.length,
    partial: daysElapsed < windowDays,
    steps: [
      { label: "Groups", detail: `${T.length} customers were messaged and ${H.length} were deliberately held back, chosen at random from the same segment.` },
      { label: "Came back", detail: `${Math.round(rateT * 100)}% of the messaged group bought again against ${Math.round(rateH * 100)}% of the held-back group.` },
      { label: "Spend", detail: `Average spend per customer: ${fmt(revPerT)} messaged against ${fmt(revPerH)} held back. The difference is ${fmt(diff)} per customer.` },
      { label: "Extra rupees", detail: `${fmt(diff)} x ${T.length} messaged = ${fmt(diff * T.length)}, likely between ${fmt(low * T.length)} and ${fmt(high * T.length)} (95%).` },
      { label: "Verdict", detail: "Marked as worked when more customers came back or they spent more, judged at a stricter 98.8% level on each measure so that looking at two measures does not make a lucky result look real. A wide rupee range with a clear rise in customers coming back is still a real effect." },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* "Sold 3 rice, 2 oil": text or voice to sales                          */
/* ------------------------------------------------------------------ */

const ALIASES: [RegExp, string][] = [
  [/\b(chawal|chaaval|chawl)\b|चावल|ಅಕ್ಕಿ/g, "rice"],
  [/\b(tel|teil)\b|तेल|ಎಣ್ಣೆ/g, "oil"],
  [/\b(aata|ata|flour)\b|आटा|ಹಿಟ್ಟು/g, "atta"],
  [/\b(daal|dal)\b|दाल|ಬೇಳೆ/g, "dal"],
  [/\b(cheeni|shakkar)\b|चीनी|ಸಕ್ಕರೆ/g, "sugar"],
  [/\b(doodh)\b|दूध|ಹಾಲು/g, "milk"],
];

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, ek: 1, do: 2, teen: 3, char: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10 };

export type QuickItem = {
  text: string;
  qty: number;
  status: "matched" | "ambiguous" | "unknown";
  product: string | null;
  candidates: string[];
  unitPrice: number | null;
  total: number | null;
};

export type QuickSale = { items: QuickItem[]; customer: string | null; onCredit: boolean; ignored: string[] };

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿಀ-೿ ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !/^\d+(kg|l|g|ml)?$/.test(t));
}

export function parseQuickSale(raw: string, products: { name: string; price: number }[]): QuickSale {
  let text = raw.toLowerCase().trim();
  for (const [re, rep] of ALIASES) text = text.replace(re, rep);
  const onCredit = /\b(on credit|udhaar|udhar|credit)\b|उधार|ಸಾಲ/.test(text);
  text = text.replace(/\b(on credit|udhaar|udhar|credit)\b|उधार|ಸಾಲ/g, " ");
  let customer: string | null = null;
  const who = text.match(/\b(?:to|for)\s+([a-z][a-z .'-]{1,30}?)(?=\s*(?:,|;|$|\band\b))/);
  if (who && !products.some((p) => tokens(p.name).includes(who[1].trim().split(" ")[0]))) {
    customer = who[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
    text = text.replace(who[0], " ");
  }
  text = text.replace(/^\s*(sold|sale|sell|bech[ae]?|becha|बेचा|ಮಾರಿದೆ|ಮಾರಾಟ)\b[:\s-]*/, "");
  const chunks = text.split(/,|;|\n|\band\b|\baur\b|और|ಮತ್ತು/).map((c) => c.trim()).filter(Boolean);
  const items: QuickItem[] = [];
  const ignored: string[] = [];
  for (const chunk of chunks) {
    let qty = NaN;
    let name = chunk;
    let m = chunk.match(/^(\d+(?:\.\d+)?)\s*(?:kg|kgs|ltr|litre|liter|l|pkt|packet|packets|pc|pcs|x|×)?\s*(?:of\s+)?(.+)$/);
    if (m) {
      qty = Number(m[1]);
      name = m[2];
    } else if ((m = chunk.match(/^(.+?)\s*(?:x|×)?\s*(\d+(?:\.\d+)?)$/))) {
      name = m[1];
      qty = Number(m[2]);
    } else {
      const w = chunk.split(/\s+/);
      if (w.length > 1 && NUMBER_WORDS[w[0]] != null) {
        qty = NUMBER_WORDS[w[0]];
        name = w.slice(1).join(" ");
      }
    }
    if (!(qty > 0) || qty > 1000 || !name.trim()) {
      ignored.push(chunk);
      continue;
    }
    const want = tokens(name);
    const scored = products
      .map((p) => {
        const pt = tokens(p.name);
        const score = want.filter((w) => pt.some((t) => t === w || (w.length >= 3 && (t.startsWith(w) || w.startsWith(t))))).length;
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    const ties = best ? scored.filter((x) => x.score === best.score) : [];
    if (!best) items.push({ text: chunk, qty, status: "unknown", product: null, candidates: [], unitPrice: null, total: null });
    else if (ties.length > 1) items.push({ text: chunk, qty, status: "ambiguous", product: null, candidates: ties.map((t) => t.p.name), unitPrice: null, total: null });
    else items.push({ text: chunk, qty, status: "matched", product: best.p.name, candidates: [best.p.name], unitPrice: best.p.price, total: Math.round(qty * best.p.price * 100) / 100 });
  }
  return { items, customer, onCredit, ignored };
}

/* ------------------------------------------------------------------ */
/* Alert fatigue: rank by rupees, cap per week                          */
/* ------------------------------------------------------------------ */

const SEV: Record<string, number> = { critical: 3, warning: 2, info: 1, positive: 0 };

export function rankAndCap<T extends { severity: string; impactRs: number | null }>(drafts: T[], alreadyThisWeek: number, cap = 5): { keep: T[]; dropped: T[] } {
  const ranked = [...drafts].sort((a, b) => (b.impactRs ?? 0) - (a.impactRs ?? 0) || (SEV[b.severity] ?? 0) - (SEV[a.severity] ?? 0));
  const room = Math.max(0, cap - alreadyThisWeek);
  return { keep: ranked.slice(0, room), dropped: ranked.slice(room) };
}

/* ------------------------------------------------------------------ */
/* Forecast confidence label                                            */
/* ------------------------------------------------------------------ */

export function forecastConfidence(i: { status: string; spanDays: number; beatPct: number | null; mape: number | null }): { level: "high" | "medium" | "low" | "none"; reason: string } {
  if (i.status === "insufficient") return { level: "none", reason: "Not enough history to forecast." };
  if (i.spanDays < 42 || i.beatPct == null) return { level: "low", reason: "Under 6 weeks of history, so there is no fair backtest. Treat the numbers as a direction." };
  if (i.beatPct < 0) return { level: "low", reason: "The model did not beat the simple same-weekday-last-week guess on held-out days." };
  if (i.beatPct >= 10 && (i.mape == null || i.mape <= 25)) return { level: "high", reason: `Beat the simple baseline by ${i.beatPct.toFixed(0)}% on held-out days${i.mape != null ? `, typical miss ${i.mape.toFixed(0)}%` : ""}.` };
  return { level: "medium", reason: `Beat the simple baseline by ${i.beatPct.toFixed(0)}% on held-out days, but the margin is modest.` };
}
