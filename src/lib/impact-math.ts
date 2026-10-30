/* ------------------------------------------------------------------ */
/* Pure calculation core for the "Impact" module. No imports on purpose */
/* so every function here can be unit-tested without a database.        */
/* ------------------------------------------------------------------ */

export type DayMap = Record<string, number>;

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dowOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function range(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysISO(d, 1)) out.push(d);
  return out;
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
/* 1. Promo lift vs a counterfactual baseline                           */
/* ------------------------------------------------------------------ */

export type LiftResult =
  | { status: "insufficient"; why: string }
  | { status: "measuring"; daysElapsed: number; needed: number }
  | {
      status: "measured";
      verdict: "lift" | "inconclusive" | "below";
      days: number;
      actual: number;
      expected: number;
      incremental: number;
      liftPct: number | null;
      low: number;
      high: number;
      controlRatio: number;
      steps: { label: string; detail: string }[];
    };

/**
 * Compares what a product really sold in the days after a promo went out with
 * what it would have sold anyway.
 *
 * - Baseline: the product's own same-weekday average over the 28 days before the
 *   promo (shrunk halfway to the overall mean, because 4 samples per weekday is thin).
 * - Control: the rest of the shop is held to the same method; if the whole shop
 *   moved (festival, weather, payday) the baseline moves with it.
 * - Verdict: only "lift" when the gain clears a 95% noise band.
 */
export function computeLift(input: {
  product: DayMap;
  others: DayMap;
  approvedDate: string;
  today: string;
  dataStart: string | null;
  fmt: (n: number) => string;
}): LiftResult {
  const { product, others, approvedDate, today, dataStart, fmt } = input;
  const preFrom = addDaysISO(approvedDate, -28);
  const preTo = addDaysISO(approvedDate, -1);
  if (!dataStart || dayDiff(dataStart, approvedDate) < 14) {
    return { status: "insufficient", why: "Fewer than 14 days of sales exist before this promo, so there is no baseline to compare against." };
  }
  const winFrom = addDaysISO(approvedDate, 1);
  const winTo = addDaysISO(approvedDate, 7) < today ? addDaysISO(approvedDate, 7) : today;
  const days = dayDiff(winFrom, winTo) + 1;
  if (days < 3) return { status: "measuring", daysElapsed: Math.max(0, days), needed: 3 };

  const preDays = range(preFrom < dataStart ? dataStart : preFrom, preTo);
  const baseline = (series: DayMap) => {
    const vals = preDays.map((d) => series[d] ?? 0);
    const all = mean(vals);
    const byDow = new Map<number, number[]>();
    preDays.forEach((d, i) => byDow.set(dowOf(d), [...(byDow.get(dowOf(d)) ?? []), vals[i]]));
    const at = (d: string) => {
      const s = byDow.get(dowOf(d));
      return s && s.length >= 2 ? 0.5 * mean(s) + 0.5 * all : all;
    };
    const resid = preDays.map((d, i) => vals[i] - at(d));
    return { at, all, sigma: sd(resid) };
  };

  const bp = baseline(product);
  if (bp.all <= 0) return { status: "insufficient", why: "This product had no sales in the 4 weeks before the promo, so there is nothing to compare against." };
  const bo = baseline(others);
  const winDays = range(winFrom, winTo);
  const actual = winDays.reduce((a, d) => a + (product[d] ?? 0), 0);
  const baseSum = winDays.reduce((a, d) => a + bp.at(d), 0);
  const othersActual = winDays.reduce((a, d) => a + (others[d] ?? 0), 0);
  const othersBase = winDays.reduce((a, d) => a + bo.at(d), 0);
  const rawRatio = othersBase > 0 ? othersActual / othersBase : 1;
  const controlRatio = Math.min(1.3, Math.max(0.7, rawRatio));
  const expected = baseSum * controlRatio;
  const incremental = actual - expected;
  // Noise has three parts: day-to-day wobble inside the window, error in the
  // baseline itself (only ~28 days to learn from), and error in the shop-wide check.
  const n = winDays.length;
  const k = Math.max(1, preDays.length);
  const sigma = bp.sigma * Math.sqrt(k / Math.max(1, k - 8));
  const windowNoise = sigma * Math.sqrt(n);
  const baselineNoise = (sigma * n) / Math.sqrt(k);
  const controlNoise = bo.all > 0 ? baseSum * (bo.sigma / bo.all / Math.sqrt(n)) : 0;
  const se = Math.sqrt(windowNoise ** 2 + baselineNoise ** 2 + controlNoise ** 2) * controlRatio;
  const band = 1.96 * se;
  const verdict: "lift" | "inconclusive" | "below" = incremental > band ? "lift" : incremental < -band ? "below" : "inconclusive";
  return {
    status: "measured",
    verdict,
    days: winDays.length,
    actual,
    expected,
    incremental,
    liftPct: expected > 0 ? (incremental / expected) * 100 : null,
    low: incremental - band,
    high: incremental + band,
    controlRatio,
    steps: [
      { label: "Window", detail: `${winDays.length} days after the promo (${winFrom} to ${winTo}).` },
      { label: "Baseline", detail: `Same-weekday average of this product over the 28 days before the promo, ${fmt(bp.all)} a day on average.` },
      { label: "Shop-wide check", detail: `The rest of the shop ran at ${(rawRatio * 100).toFixed(0)}% of its own baseline in the same days, so the expected figure was scaled by ${(controlRatio * 100).toFixed(0)}%.` },
      { label: "Result", detail: `Sold ${fmt(actual)} against ${fmt(expected)} expected. Difference ${fmt(incremental)}, with a 95% noise range of ${fmt(incremental - band)} to ${fmt(incremental + band)}.` },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* 2. Sales-drop detection against a same-weekday seasonal baseline     */
/* ------------------------------------------------------------------ */

export type DropDriver = { product: string; category: string; delta: number; share: number; cur: number; expected: number };

export type DropReport = {
  status: "ok" | "insufficient";
  why?: string;
  currentWeek: number;
  /** Mean of the same 7-day window over the trailing weeks. Every window holds each weekday once. */
  baseline: number;
  baselineWeeks: number;
  sigma: number;
  delta: number;
  pct: number | null;
  zScore: number | null;
  dropDetected: boolean;
  growthDetected: boolean;
  drivers: DropDriver[];
  categories: { category: string; delta: number; share: number; cur: number; expected: number }[];
  worstDay: { date: string; weekday: string; actual: number; expected: number; deltaPct: number | null } | null;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The last 7 days are compared with the same 7-day window in each of the trailing
 * 4 to 8 weeks, so weekday and weekend mix match exactly. A drop is flagged when this
 * week sits about 2 standard deviations (and at least 5%) under that baseline. The gap
 * is then split by product and category using the same baseline.
 */
export function explainDrop(rows: { date: string; product: string; category: string; revenue: number }[], today: string): DropReport {
  const empty: DropReport = {
    status: "insufficient", currentWeek: 0, baseline: 0, baselineWeeks: 0, sigma: 0, delta: 0, pct: null, zScore: null,
    dropDetected: false, growthDetected: false, drivers: [], categories: [], worstDay: null,
  };
  if (!rows.length) return { ...empty, why: "No sales yet." };
  const first = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date);
  const weeks: { from: string; to: string }[] = [];
  for (let k = 1; k <= 8; k++) {
    const to = addDaysISO(today, -7 * k);
    const from = addDaysISO(to, -6);
    if (from < first) break;
    weeks.push({ from, to });
  }
  if (weeks.length < 4) {
    return { ...empty, why: `Needs at least 4 full weeks of sales to learn what a normal week looks like; ${weeks.length} found. Until then no drop is declared.` };
  }

  const curFrom = addDaysISO(today, -6);
  const weekIndex = (d: string): number => {
    if (d >= curFrom && d <= today) return 0;
    for (let i = 0; i < weeks.length; i++) if (d >= weeks[i].from && d <= weeks[i].to) return i + 1;
    return -1;
  };
  const n = weeks.length;
  const totals = new Array(n + 1).fill(0);
  const prod = new Map<string, { category: string; w: number[] }>();
  const dayRev: Record<string, number> = {};
  for (const r of rows) {
    const wi = weekIndex(r.date);
    if (wi < 0) continue;
    totals[wi] += r.revenue;
    dayRev[r.date] = (dayRev[r.date] ?? 0) + r.revenue;
    const e = prod.get(r.product) ?? { category: r.category, w: new Array(n + 1).fill(0) };
    e.w[wi] += r.revenue;
    prod.set(r.product, e);
  }
  const hist = totals.slice(1);
  const baseline = mean(hist);
  const sigma = Math.max(sd(hist), baseline * 0.02);
  const cur = totals[0];
  const delta = cur - baseline;
  const pct = baseline > 0 ? (delta / baseline) * 100 : null;
  const zScore = sigma > 0 ? delta / sigma : null;
  const dropDetected = zScore != null && pct != null && zScore <= -2 && pct <= -5;
  const growthDetected = zScore != null && pct != null && zScore >= 2 && pct >= 5;

  const wantNeg = delta < 0;
  const split = (key: (e: { category: string; w: number[] }, name: string) => string) => {
    const m = new Map<string, { cur: number; expected: number }>();
    for (const [name, e] of prod) {
      const k = key(e, name);
      const x = m.get(k) ?? { cur: 0, expected: 0 };
      x.cur += e.w[0];
      x.expected += mean(e.w.slice(1));
      m.set(k, x);
    }
    return m;
  };
  const drivers: DropDriver[] = Array.from(prod.entries())
    .map(([product, e]) => {
      const expected = mean(e.w.slice(1));
      const d = e.w[0] - expected;
      return { product, category: e.category, delta: d, cur: e.w[0], expected, share: delta !== 0 ? (d / delta) * 100 : 0 };
    })
    .filter((d) => (wantNeg ? d.delta < 0 : d.delta > 0))
    .sort((a, b) => (wantNeg ? a.delta - b.delta : b.delta - a.delta))
    .slice(0, 3);
  const categories = Array.from(split((e) => e.category).entries())
    .map(([category, v]) => ({ category, delta: v.cur - v.expected, cur: v.cur, expected: v.expected, share: delta !== 0 ? ((v.cur - v.expected) / delta) * 100 : 0 }))
    .filter((c) => (wantNeg ? c.delta < 0 : c.delta > 0))
    .sort((a, b) => (wantNeg ? a.delta - b.delta : b.delta - a.delta))
    .slice(0, 3);

  let worstDay: DropReport["worstDay"] = null;
  for (let i = 0; i < 7; i++) {
    const d = addDaysISO(curFrom, i);
    const expected = mean(weeks.map((w, wi) => dayRev[addDaysISO(d, -7 * (wi + 1))] ?? 0));
    const actual = dayRev[d] ?? 0;
    const gap = actual - expected;
    if (!worstDay || gap < worstDay.actual - worstDay.expected) {
      worstDay = { date: d, weekday: WEEKDAYS[dowOf(d)], actual, expected, deltaPct: expected > 0 ? (gap / expected) * 100 : null };
    }
  }
  return { status: "ok", currentWeek: cur, baseline, baselineWeeks: n, sigma, delta, pct, zScore, dropDetected, growthDetected, drivers, categories, worstDay };
}

/* ------------------------------------------------------------------ */
/* 3. Margin guardrail for discounts                                    */
/* ------------------------------------------------------------------ */

export type Guardrail = {
  requested: number | null;
  applied: number | null;
  cap: number;
  clamped: boolean;
  breakEvenUnitsPct: number | null;
  note: string;
};

/** Highest whole-percent discount that still leaves `minMarginPct` margin on the discounted price. */
export function maxSafeDiscount(price: number, cost: number, minMarginPct = 10): number {
  if (!(price > 0)) return 0;
  const cap = 100 * (1 - cost / (price * (1 - minMarginPct / 100)));
  return Math.max(0, Math.min(50, Math.floor(cap)));
}

export function applyGuardrail(price: number, cost: number, requested: number | null, minMarginPct = 10): Guardrail | null {
  if (!(price > 0) || cost < 0) return null;
  const cap = maxSafeDiscount(price, cost, minMarginPct);
  if (requested == null || requested <= 0) {
    return { requested, applied: requested, cap, clamped: false, breakEvenUnitsPct: null, note: `Safe discount ceiling for this product is ${cap}% (keeps at least ${minMarginPct}% margin).` };
  }
  const applied = Math.min(requested, cap);
  const m0 = price - cost;
  const m1 = price * (1 - applied / 100) - cost;
  const breakEven = applied > 0 && m1 > 0 ? (m0 / m1 - 1) * 100 : null;
  const clamped = applied < requested;
  const be = breakEven != null ? ` At ${applied}% off you need about ${Math.round(breakEven)}% more units just to earn the same profit.` : "";
  return {
    requested,
    applied,
    cap,
    clamped,
    breakEvenUnitsPct: breakEven,
    note: clamped
      ? `${requested}% would leave under ${minMarginPct}% margin, so the offer was lowered to ${applied}%.${be}`
      : `${applied}% keeps at least ${minMarginPct}% margin.${be}`,
  };
}

/* ------------------------------------------------------------------ */
/* 4. Privacy: strip identifiers before text leaves for an LLM          */
/* ------------------------------------------------------------------ */

export function maskPii(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "[email]")
    .replace(/\b[\w.-]+@(?:ok[a-z]+|ybl|ibl|axl|paytm|upi|apl|sbi|hdfcbank|icici|oksbi|okhdfcbank|okicici|okaxis)\b/gi, "[upi-id]")
    .replace(/(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, "[phone]")
    .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, "[gstin]");
}

/* ------------------------------------------------------------------ */
/* 5. UPI / bank statement text -> receipts                             */
/* ------------------------------------------------------------------ */

export type UpiRow = { date: string; amount: number; party: string; line: number };
export type UpiParse = { credits: UpiRow[]; skipped: { line: number; text: string; reason: string }[]; debitsIgnored: number };

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

function parseDate(s: string, now: string): string | null {
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return valid(m[1], m[2], m[3]);
  m = s.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) return valid(m[3].length === 2 ? `20${m[3]}` : m[3], m[2], m[1]);
  m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{2,4})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(m[3].length === 2 ? `20${m[3]}` : m[3], MONTHS[m[2].toLowerCase()], m[1]);
  m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(now.slice(0, 4), MONTHS[m[2].toLowerCase()], m[1]);
  return null;
}

function valid(y: string, mo: string, d: string): string | null {
  const yy = Number(y), mm = Number(mo), dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yy < 2000 || yy > 2100) return null;
  const iso = `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) || new Date(`${iso}T00:00:00Z`).getUTCDate() !== dd ? null : iso;
}

export function parseUpiText(raw: string, now: string): UpiParse {
  const credits: UpiRow[] = [];
  const skipped: UpiParse["skipped"] = [];
  let debitsIgnored = 0;
  raw.split(/\r?\n/).forEach((lineText, i) => {
    const text = lineText.trim();
    if (!text) return;
    const line = i + 1;
    const amt = text.match(/(?:₹|\brs\.?|\binr)\s*([\d,]+(?:\.\d{1,2})?)/i) ?? text.match(/(?<![\d/.-])([\d,]+(?:\.\d{1,2})?)\s*(?:₹|rs\b|inr\b)/i);
    if (!amt) return void skipped.push({ line, text: text.slice(0, 80), reason: "No amount (₹ / Rs / INR) found" });
    const amount = Number(amt[1].replace(/,/g, ""));
    if (!(amount > 0) || amount > 1_000_000) return void skipped.push({ line, text: text.slice(0, 80), reason: "Amount is zero or unrealistically large" });
    const isOut = /\b(paid to|paid|debited|debit|dr|sent to|sent|withdraw|purchase at)\b/i.test(text) && !/\b(received|credited|credit|cr)\b/i.test(text);
    const isIn = /\b(received|credited|credit|cr|paid you|sent you|from)\b/i.test(text);
    if (isOut) {
      debitsIgnored++;
      return;
    }
    if (!isIn) return void skipped.push({ line, text: text.slice(0, 80), reason: "Could not tell if money came in or went out" });
    const date = parseDate(text, now);
    if (!date) return void skipped.push({ line, text: text.slice(0, 80), reason: "No readable date" });
    if (date > now) return void skipped.push({ line, text: text.slice(0, 80), reason: "Date is in the future" });
    const who = text.match(/\b(?:from|by)\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?=\s+(?:on|via|ref|upi|at|for|rs|inr)\b|[,.;|]|\s*\d|$)/i)?.[1]?.trim();
    credits.push({ date, amount, party: who && who.length > 1 ? who : "Walk-in UPI", line });
  });
  return { credits, skipped, debitsIgnored };
}
