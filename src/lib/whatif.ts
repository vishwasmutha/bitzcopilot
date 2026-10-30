import "server-only";
import { loadProducts, loadSales } from "./analytics";
import type { Receipt } from "./trust";
import { insufficient } from "./trust";
import { addDays, fmtCurrency, todayISO } from "./utils";

export type Scenario =
  | { kind: "price"; query: string; delta: number; pct: boolean }
  | { kind: "weekend"; pct: number }
  | { kind: "delay"; days: number }
  | { kind: "unknown" };

type Prod = { name: string; stock: number; cost: number; price: number };

function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-9) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const div = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

function matchProduct(query: string, products: Prod[]): Prod | null {
  const q = query.toLowerCase();
  const alias = q.replace(/तेल|ಎಣ್ಣೆ/g, "oil").replace(/चावल|ಅಕ್ಕಿ/g, "rice").replace(/आटा|ಹಿಟ್ಟು/g, "atta");
  const hit = products.find((p) => p.name.toLowerCase().includes(alias) || alias.includes(p.name.toLowerCase().split(" ")[0]));
  if (hit) return hit;
  const token = alias.split(/\s+/).find((t) => t.length > 2);
  return token ? products.find((p) => p.name.toLowerCase().includes(token)) ?? null : null;
}

export function parseWhatIf(raw: string): Scenario {
  const q = raw.toLowerCase();
  const delay = q.match(/(delay|late|लेट|ವಿಳಂಬ|ತಡ).*?(\d+)\s*(day|दिन|ದಿನ)/);
  if (delay) return { kind: "delay", days: Math.min(30, Math.max(1, Number(delay[2]))) };
  if (/delay|a week late|एक हफ्ता|ಒಂದು ವಾರ|supplier/.test(q) && /delay|late|लेट|ತಡ|ವಿಳಂಬ/.test(q)) return { kind: "delay", days: 7 };
  const weekend = q.match(/(\d+)\s*%/);
  if ((/weekend|वीकेंड|ವೀಕೆಂಡ್/.test(q) && /off|discount|छूट|ರಿಯಾಯಿತಿ|%/.test(q)) || /10%\s*off/.test(q) && /weekend|वीकेंड|ವೀಕೆಂಡ್/.test(q)) {
    return { kind: "weekend", pct: Math.min(80, Math.max(1, Number(weekend?.[1] ?? 10))) };
  }
  const rupee = q.match(/(?:₹|rs\.?|rupee|रुपय|ರೂ)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:₹|rs|rupee|रुपय|ರೂ)/);
  const pct = q.match(/(\d+(?:\.\d+)?)\s*%/);
  const up = /raise|increas|hike|up by|बढ़|ಹೆಚ್ಚ/.test(q);
  const down = /drop|cut|reduc|lower|कम|ಕಡಿಮೆ/.test(q);
  if ((up || down) && (rupee || pct)) {
    const query = (q.match(/(?:raise|increas|hike|drop|cut|reduc|lower|बढ़ा\w*|कम)\s+([a-z\u0900-\u097F\u0C80-\u0CFF ]{2,30}?)(?:\s+by|\s+को|\s+₹|\s+rs|$)/)?.[1] || q.match(/(oil|rice|atta|तेल|चावल|ಎಣ್ಣೆ|ಅಕ್ಕಿ)/)?.[1] || "oil").trim();
    if (rupee) return { kind: "price", query, delta: (up ? 1 : -1) * Number(rupee[1] || rupee[2]), pct: false };
    return { kind: "price", query, delta: (up ? 1 : -1) * Number(pct?.[1] ?? 0), pct: true };
  }
  return { kind: "unknown" };
}

type Elas = { status: "computed"; b: number; se: number; n: number; prices: number } | { status: "insufficient"; why: string };

function elasticity(points: { t: number; price: number; qty: number }[]): Elas {
  const usable = points.filter((p) => p.qty > 0 && p.price > 0);
  const prices = new Set(usable.map((p) => Math.round(p.price)));
  if (usable.length < 21) return { status: "insufficient", why: `Only ${usable.length} selling days. Price sensitivity needs at least 21.` };
  if (prices.size < 2) return { status: "insufficient", why: `Sold at one price (₹${Math.round(usable[0]?.price ?? 0)}) across ${usable.length} days. There is no price movement to learn from.` };
  const n = usable.length;
  const k = 3;
  const XtX = Array.from({ length: k }, () => Array(k).fill(0));
  const Xty = Array(k).fill(0);
  const rows: number[][] = [];
  const y: number[] = [];
  usable.forEach((p, i) => {
    const x = [1, Math.log(p.price), i];
    rows.push(x);
    const yi = Math.log(p.qty);
    y.push(yi);
    for (let a = 0; a < k; a++) {
      Xty[a] += x[a] * yi;
      for (let b = 0; b < k; b++) XtX[a][b] += x[a] * x[b];
    }
  });
  const coef = solve(XtX, Xty);
  if (!coef) return { status: "insufficient", why: "The price and time columns are collinear. Sensitivity cannot be separated from trend, so it is withheld." };
  let sse = 0;
  rows.forEach((x, i) => {
    const fit = x.reduce((s, v, j) => s + v * coef[j], 0);
    sse += (y[i] - fit) ** 2;
  });
  const sigma2 = sse / Math.max(1, n - k);
  const seCol = solve(XtX, [0, 1, 0]);
  const se = seCol ? Math.sqrt(Math.max(0, sigma2 * seCol[1])) : Infinity;
  if (!Number.isFinite(se) || se > 1.5) {
    return { status: "insufficient", why: `Price did move (${prices.size} price levels, ${n} days), but quantity noise is too large (SE ${se.toFixed(2)}) to publish an elasticity.` };
  }
  return { status: "computed", b: coef[1], se, n, prices: prices.size };
}

function money(n: number) {
  return fmtCurrency(Math.round(n));
}

export type WhatIfResult = {
  status: "computed" | "insufficient" | "unknown";
  summary: string;
  low: number | null;
  high: number | null;
  point: number | null;
  unit: string;
  receipt: Receipt;
};

export async function simulateWhatIf(businessId: string, question: string, lang: "en" | "hi" | "kn" = "en"): Promise<WhatIfResult> {
  const scenario = parseWhatIf(question);
  if (scenario.kind === "unknown") {
    return {
      status: "unknown",
      summary: lang === "kn" ? "ಇದನ್ನು ಓದಲಾಗಲಿಲ್ಲ. ಉದಾಹರಣೆ: ಎಣ್ಣೆ ₹5 ಹೆಚ್ಚಿಸಿದರೆ? ವೀಕೆಂಡ್ 10% ರಿಯಾಯಿತಿ? ಸಪ್ಲೈಯರ್ ಒಂದು ವಾರ ತಡವಾದರೆ?" : lang === "hi" ? "यह सवाल पढ़ नहीं पाया। उदाहरण: तेल ₹5 बढ़ाऊँ? वीकेंड पर 10% छूट? सप्लायर एक हफ्ता लेट हो?" : "I couldn't read that as a what-if. Try: raise oil by ₹5, 10% off on weekends, or supplier delays a week.",
      low: null,
      high: null,
      point: null,
      unit: "",
      receipt: insufficient("What-if", "The question did not match a price change, a weekend discount, or a supplier delay. Nothing was simulated."),
    };
  }

  const today = todayISO();
  const [products, sales] = await Promise.all([
    loadProducts(businessId),
    loadSales(businessId, addDays(today, -90), today),
  ]);
  const prods: Prod[] = products.map((p) => ({ name: p.name, stock: p.stockQty, cost: p.unitCost, price: p.sellingPrice }));
  const days = new Set(sales.map((s) => s.saleDate)).size;
  if (days < 14) {
    return {
      status: "insufficient",
      summary: "Not enough history. A what-if needs at least 14 selling days. No projection was made.",
      low: null,
      high: null,
      point: null,
      unit: "",
      receipt: insufficient("What-if", `Only ${days} distinct selling days on record.`),
    };
  }

  if (scenario.kind === "delay") return delayCase(prods, sales, scenario.days, lang);
  if (scenario.kind === "weekend") return weekendCase(prods, sales, scenario.pct, lang);
  const product = matchProduct(scenario.query, prods);
  if (!product) {
    return {
      status: "insufficient",
      summary: `No product matched “${scenario.query}”. Name a product you actually sell. Nothing was assumed.`,
      low: null,
      high: null,
      point: null,
      unit: "",
      receipt: insufficient("Price change", `No catalog match for “${scenario.query}”.`),
    };
  }
  return priceCase(product, sales, scenario, lang);
}

function seriesFor(name: string, sales: { saleDate: string; productName: string; quantity: number; unitPrice: number; totalAmount: number }[]) {
  const by = new Map<string, { qty: number; rev: number }>();
  for (const s of sales) {
    if (s.productName !== name) continue;
    const a = by.get(s.saleDate) ?? { qty: 0, rev: 0 };
    a.qty += s.quantity;
    a.rev += s.totalAmount;
    by.set(s.saleDate, a);
  }
  return [...by.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v], t) => ({ date, t, qty: v.qty, price: v.qty ? v.rev / v.qty : 0 }));
}

function priceCase(product: Prod, sales: { saleDate: string; productName: string; quantity: number; unitPrice: number; totalAmount: number }[], scenario: Extract<Scenario, { kind: "price" }>, lang: string): WhatIfResult {
  const series = seriesFor(product.name, sales);
  const linePoints = sales
    .filter((s) => s.productName === product.name && s.quantity > 0 && s.unitPrice > 0)
    .map((s, i) => ({ t: i, price: s.unitPrice, qty: s.quantity }));
  const last14 = series.filter((p) => p.date >= addDays(todayISO(), -13));
  const qty14 = last14.reduce((a, p) => a + p.qty, 0);
  const rev14 = last14.reduce((a, p) => a + p.qty * p.price, 0);
  const curPrice = qty14 > 0 ? rev14 / qty14 : product.price;
  const daily = qty14 / 14;
  const newPrice = scenario.pct ? curPrice * (1 + scenario.delta / 100) : curPrice + scenario.delta;
  if (!(newPrice > 0)) {
    return { status: "insufficient", summary: "That price change would make the selling price zero or negative. Stopped.", low: null, high: null, point: null, unit: "", receipt: insufficient("Price change", "New price is not positive.") };
  }
  const elas = elasticity(linePoints);
  const horizon = 7;
  const baseRev = daily * horizon * curPrice;
  const baseProfit = daily * horizon * (curPrice - product.cost);
  const accountingRev = daily * horizon * newPrice;
  const accountingProfit = daily * horizon * (newPrice - product.cost);

  if (elas.status === "insufficient") {
    const receipt: Receipt = {
      title: `${product.name} price change`,
      status: "insufficient",
      headline: "Demand response withheld",
      steps: [
        { label: "Current price", detail: `${money(curPrice)} over the last 14 days (${qty14} units, ${daily.toFixed(1)}/day).` },
        { label: "Proposed price", detail: money(newPrice) },
        { label: "If volume is unchanged", detail: `7-day revenue ${money(baseRev)} → ${money(accountingRev)} (${money(accountingRev - baseRev)}). Profit ${money(baseProfit)} → ${money(accountingProfit)}. This is arithmetic, not a forecast of customer behaviour.` },
        { label: "Demand response", detail: elas.why },
      ],
      caveat: "Stockout risk under a demand response is not estimated, because that would require the withheld elasticity.",
    };
    const summary = `${product.name}: not enough history to say how many customers leave. If the same ${daily.toFixed(1)} units/day still sell, 7-day revenue moves from ${money(baseRev)} to ${money(accountingRev)}. That is not a prediction of demand.`;
    return { status: "insufficient", summary: localize(summary, lang), low: accountingRev, high: accountingRev, point: null, unit: "7-day revenue if volume unchanged", receipt };
  }

  const ratio = (newPrice / curPrice) ** elas.b;
  const ratioLo = (newPrice / curPrice) ** (elas.b - 1.96 * elas.se);
  const ratioHi = (newPrice / curPrice) ** (elas.b + 1.96 * elas.se);
  const [r1, r2] = ratioLo < ratioHi ? [ratioLo, ratioHi] : [ratioHi, ratioLo];
  const rev = (r: number) => Math.max(0, daily * r) * horizon * newPrice;
  const profit = (r: number) => Math.max(0, daily * r) * horizon * (newPrice - product.cost);
  const cover = (r: number) => (daily * r > 0.05 ? product.stock / (daily * r) : 999);
  const low = Math.min(rev(r1), rev(r2));
  const high = Math.max(rev(r1), rev(r2));
  const point = rev(ratio);
  const receipt: Receipt = {
    title: `${product.name} price change`,
    status: "computed",
    headline: `7-day revenue ${money(low)} – ${money(high)}`,
    steps: [
      { label: "Sample", detail: `${elas.n} sale lines, ${elas.prices} distinct prices. Elasticity ${elas.b.toFixed(2)} (SE ${elas.se.toFixed(2)}) from ln(units per sale) on ln(price), with a time trend so a slow drift is not mistaken for a price effect.` },
      { label: "Price", detail: `${money(curPrice)} → ${money(newPrice)}.` },
      { label: "Volume", detail: `${daily.toFixed(1)}/day × ${(ratio).toFixed(2)} at the point estimate. The range uses elasticity ± 1.96 SE.` },
      { label: "7-day revenue", detail: `${money(low)} to ${money(high)} (point ${money(point)}). Was ${money(baseRev)}.` },
      { label: "7-day profit", detail: `${money(Math.min(profit(r1), profit(r2)))} to ${money(Math.max(profit(r1), profit(r2)))}. Cost held at ${money(product.cost)}.` },
      { label: "Stock cover", detail: `${cover(ratio).toFixed(1)} days at the point estimate (now ${product.stock} units). Range ${Math.min(cover(r1), cover(r2)).toFixed(1)}–${Math.max(cover(r1), cover(r2)).toFixed(1)} days.` },
    ],
    caveat: "Range is the regression uncertainty, not a scenario the model invented. If SE had been above 1.5 this elasticity would have been withheld.",
  };
  const summary = `${product.name} ${money(curPrice)} → ${money(newPrice)}. Elasticity ${elas.b.toFixed(2)} from your own price history. 7-day revenue ${money(low)}–${money(high)}. Profit ${money(Math.min(profit(r1), profit(r2)))}–${money(Math.max(profit(r1), profit(r2)))}. Stock cover about ${cover(ratio).toFixed(1)} days.`;
  return { status: "computed", summary: localize(summary, lang), low, high, point, unit: "7-day revenue", receipt };
}

function weekendCase(prods: Prod[], sales: { saleDate: string; productName: string; quantity: number; totalAmount: number; unitPrice: number }[], pct: number, lang: string): WhatIfResult {
  let weRev = 0, wdRev = 0, weN = 0, wdN = 0;
  const byDate = new Map<string, number>();
  for (const s of sales) {
    if (s.saleDate < addDays(todayISO(), -27)) continue;
    byDate.set(s.saleDate, (byDate.get(s.saleDate) ?? 0) + s.totalAmount);
  }
  for (const [date, rev] of byDate) {
    const dow = new Date(`${date}T00:00:00`).getDay();
    if (dow === 0 || dow === 6) {
      weRev += rev;
      weN++;
    } else {
      wdRev += rev;
      wdN++;
    }
  }
  if (weN < 4) {
    return { status: "insufficient", summary: "Not enough weekend history to price a weekend discount.", low: null, high: null, point: null, unit: "", receipt: insufficient("Weekend discount", `Only ${weN} weekend days in the last 4 weeks.`) };
  }
  const weDaily = weRev / weN;
  const accounting = weDaily * 0.1 * 2 * (pct / 10); // rough: not used
  void accounting;
  const weekendShare = weRev / Math.max(1, weRev + wdRev);
  const weekRev = (weRev / Math.max(1, weN / 2)) ; // not used
  void weekRev;
  // Per typical week: 2 weekend days at weDaily, 5 weekday days at wdDaily
  const wdDaily = wdN ? wdRev / wdN : 0;
  const weekNow = wdDaily * 5 + weDaily * 2;
  const weekAcct = wdDaily * 5 + weDaily * 2 * (1 - pct / 100);
  const receipt: Receipt = {
    title: `${pct}% off on weekends`,
    status: "insufficient",
    headline: "Demand response withheld",
    steps: [
      { label: "Weekend rate", detail: `${money(weDaily)}/weekend-day over ${weN} days. Weekdays ${money(wdDaily)}/day (${wdN} days). Weekend share of revenue ${(weekendShare * 100).toFixed(0)}%.` },
      { label: "If volume is unchanged", detail: `A typical week falls from ${money(weekNow)} to ${money(weekAcct)} because weekend prices are ${pct}% lower and quantity is held fixed. Arithmetic only.` },
      { label: "Demand response", detail: "A weekend-only discount is not a price change observed in history, so elasticity is not applied. Inventing a lift would be a guess." },
      { label: "Stock", detail: `Catalog has ${prods.length} products. Stockout risk under a demand surge is withheld for the same reason.` },
    ],
    caveat: "The only number published is the accounting case: same baskets, lower weekend price.",
  };
  return {
    status: "insufficient",
    summary: localize(`Weekend ${pct}% off: if customers buy the same amount, a typical week goes from ${money(weekNow)} to ${money(weekAcct)}. How many extra people would come is not in your history, so that lift is not estimated.`, lang),
    low: weekAcct,
    high: weekAcct,
    point: null,
    unit: "weekly revenue if volume unchanged",
    receipt,
  };
}

function delayCase(prods: Prod[], sales: { saleDate: string; productName: string; quantity: number; unitPrice: number; totalAmount: number }[], days: number, lang: string): WhatIfResult {
  const from = addDays(todayISO(), -13);
  const recent = sales.filter((s) => s.saleDate >= from);
  let lostPoint = 0, lostLow = 0, lostHigh = 0;
  const lines: string[] = [];
  for (const p of prods) {
    const by = new Map<string, number>();
    for (const s of recent) if (s.productName === p.name) by.set(s.saleDate, (by.get(s.saleDate) ?? 0) + s.quantity);
    const vals = [...by.values()];
    if (vals.length < 7) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / 14;
    const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, vals.length - 1);
    const sd = Math.sqrt(variance);
    if (mean < 0.2) continue;
    const cover = p.stock / mean;
    const stockout = Math.max(0, days - cover);
    if (stockout <= 0) continue;
    const price = p.price;
    const point = stockout * mean * price;
    const low = stockout * Math.max(0, mean - sd) * price;
    const high = stockout * (mean + sd) * price;
    lostPoint += point;
    lostLow += low;
    lostHigh += high;
    lines.push(`${p.name}: ${cover.toFixed(1)} days cover, stockout ~${stockout.toFixed(1)} days, lost sales ${money(low)}–${money(high)}.`);
  }
  if (!lines.length) {
    return {
      status: "computed",
      summary: localize(`A ${days}-day supplier delay does not stock out anything with a measured run-rate. Cover is longer than the delay on every product that has 7+ selling days.`, lang),
      low: 0,
      high: 0,
      point: 0,
      unit: "lost revenue",
      receipt: {
        title: "Supplier delay",
        status: "computed",
        headline: "No measured stockout",
        steps: [
          { label: "Delay", detail: `${days} days.` },
          { label: "Cover", detail: "Days of cover = current stock ÷ (units in last 14 days / 14). Every measured product covers the delay." },
        ],
      },
    };
  }
  const receipt: Receipt = {
    title: `${days}-day supplier delay`,
    status: "computed",
    headline: `Lost revenue ${money(lostLow)} – ${money(lostHigh)}`,
    steps: [
      { label: "Method", detail: "Stockout days = delay − stock / daily rate. Daily rate = last 14 days ÷ 14. Range uses ± 1 standard deviation of observed daily quantity, not a guessed demand shock." },
      ...lines.slice(0, 6).map((detail, i) => ({ label: `Item ${i + 1}`, detail })),
    ],
    caveat: lines.length > 6 ? `${lines.length - 6} more lines omitted from the receipt; they are included in the total.` : undefined,
  };
  return {
    status: "computed",
    summary: localize(`If the supplier is ${days} days late, measured stockouts cost about ${money(lostLow)}–${money(lostHigh)} in lost revenue (point ${money(lostPoint)}). ${lines[0]}`, lang),
    low: lostLow,
    high: lostHigh,
    point: lostPoint,
    unit: "lost revenue",
    receipt,
  };
}

function localize(en: string, lang: string): string {
  if (lang === "en") return en;
  if (lang === "hi") return `हिसाब कोड में है, अनुमान नहीं। ${en}`;
  return `ಲೆಕ್ಕ ಕೋಡ್‌ನಲ್ಲಿದೆ, ಊಹೆ ಅಲ್ಲ. ${en}`;
}
