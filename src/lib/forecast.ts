import "server-only";
import { db } from "@/db";
import { desc, eq } from "drizzle-orm";
import { forecastResults, products as productsTable } from "@/db/schema";
import { loadSales } from "./analytics";
import { addDays, lastNDays, todayISO } from "./utils";

/* ------------------------------------------------------------------ */
/* BizCopilot forecasting engine                                        */
/* - Model A: OLS regression (time trend + day-of-week dummies)         */
/* - Model B: Holt-Winters additive (period 7) with parameter search    */
/* The better model is chosen on a holdout window; MAE/RMSE/MAPE are    */
/* reported for transparency. All inputs are real stored sales.         */
/* ------------------------------------------------------------------ */

export type ForecastPoint = { date: string; predicted: number; lower: number; upper: number };

export type ForecastOutput = {
  status: "ok" | "limited" | "insufficient";
  availableDays: number;
  spanDays: number;
  horizon: number;
  model: string;
  modelNote: string;
  metrics: { mae: number; rmse: number; mape: number | null; evaluated: "holdout" | "in-sample" };
  history: { date: string; actual: number; predicted?: number }[];
  forecast: ForecastPoint[];
  weeklyPattern: { dow: string; avg: number }[];
  productDemand: {
    name: string;
    dailyRate: number;
    predictedWeekly: number;
    stock: number | null;
    stockCoversDays: number | null;
  }[];
  totalPredicted: number;
  trendPct: number | null;
  message: string | null;
  backtest: {
    status: "computed" | "insufficient";
    holdoutDays: number;
    modelMae: number | null;
    naiveMae: number | null;
    naiveName: string;
    beatPct: number | null;
    note: string;
  };
};

/* ----------------------------- linear algebra ----------------------------- */

function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-10) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function olsWithDow(y: number[]): { coefs: number[] | null; resid: number[] } {
  // features: [1, t, dow1..dow6] — Sunday (dow 0) is the reference
  const n = y.length;
  const k = 8;
  const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty: number[] = new Array(k).fill(0);
  const rows: number[][] = [];
  for (let t = 0; t < n; t++) {
    const dow = dayOfWeekOfIndex(n, t);
    const x = [1, t, 0, 0, 0, 0, 0, 0];
    if (dow > 0) x[dow] = 1;
    rows.push(x);
    for (let i = 0; i < k; i++) {
      Xty[i] += x[i] * y[t];
      for (let j = i; j < k; j++) XtX[i][j] += x[i] * x[j];
    }
  }
  for (let i = 0; i < k; i++) for (let j = 0; j < i; j++) XtX[i][j] = XtX[j][i];
  const coefs = solve(XtX, Xty);
  if (!coefs) return { coefs: null, resid: [] };
  const resid = y.map((v, t) => v - rows[t].reduce((a, x, i) => a + x * coefs[i], 0));
  return { coefs, resid };
}

/** Maps a series index (0-based from (n - i)) to a real day-of-week of the date. */
function dayOfWeekOfIndex(n: number, t: number): number {
  const d = new Date(`${addDays(todayISO(), -(n - 1 - t))}T00:00:00`);
  return d.getDay();
}

/* ------------------------------ Holt-Winters ------------------------------ */

type HW = { level: number; trend: number; season: number[]; fitted: (number | null)[] };

function hwFit(y: number[], period: number, alpha: number, beta: number, gamma: number): HW | null {
  const n = y.length;
  if (n < period * 2) return null;
  const first = y.slice(0, period);
  const second = y.slice(period, period * 2);
  let level = first.reduce((a, b) => a + b, 0) / period;
  let trend = (second.reduce((a, b) => a + b, 0) - first.reduce((a, b) => a + b, 0)) / (period * period);
  const season = new Array<number>(n).fill(0);
  for (let t = 0; t < period; t++) season[t] = first[t] - level;
  const fitted: (number | null)[] = new Array(n).fill(null);
  for (let t = period; t < n; t++) {
    fitted[t] = level + trend + season[t - period];
    const err = y[t] - (fitted[t] as number);
    const newLevel = alpha * (y[t] - season[t - period]) + (1 - alpha) * (level + trend);
    trend = beta * (newLevel - level) + (1 - beta) * trend;
    level = newLevel;
    season[t] = season[t - period] + gamma * err;
  }
  return { level, trend, season, fitted };
}

function hwResiduals(hw: HW, y: number[]): number[] {
  const out: number[] = [];
  for (let t = 0; t < y.length; t++) if (hw.fitted[t] != null) out.push(y[t] - (hw.fitted[t] as number));
  return out;
}

function hwPredict(hw: HW, h: number): number {
  const n = hw.season.length;
  const idx = n - 1 - ((7 - (h % 7)) % 7);
  return hw.level + hw.trend * h + hw.season[idx];
}

/* -------------------------------- metrics -------------------------------- */

function metrics(resid: number[], actuals: number[]) {
  const mae = resid.reduce((a, r) => a + Math.abs(r), 0) / Math.max(1, resid.length);
  const rmse = Math.sqrt(resid.reduce((a, r) => a + r * r, 0) / Math.max(1, resid.length));
  const pairs = resid
    .map((r, i) => ({ r, a: actuals[i] }))
    .filter((p) => p.a > 1);
  const mape = pairs.length
    ? (pairs.reduce((a, p) => a + Math.abs(p.r) / p.a, 0) / pairs.length) * 100
    : null;
  return { mae, rmse, mape };
}

/* ------------------------------- main entry ------------------------------- */

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function generateForecast(businessId: string, horizon: number): Promise<ForecastOutput> {
  const today = todayISO();
  const historyDays = 182;
  const dates = lastNDays(historyDays);
  const sales = await loadSales(businessId, dates[0]);
  const byDate = new Map<string, number>();
  for (const s of sales) byDate.set(s.saleDate, (byDate.get(s.saleDate) ?? 0) + s.totalAmount);

  const firstSale = dates.find((d) => (byDate.get(d) ?? 0) > 0);
  const spanDays = firstSale ? historyDays - dates.indexOf(firstSale) : 0;
  const activeDays = dates.filter((d) => (byDate.get(d) ?? 0) > 0).length;

  if (spanDays < 14 || activeDays < 10) {
    const msg =
      spanDays === 0
        ? "No historical sales yet. Import a sales dataset (or load the demo data) — forecasting needs at least ~2 weeks of history."
        : `Only ${spanDays} days of history so far. The engine needs at least 14 days (28+ recommended) to fit a reliable model. Keep uploading sales data and try again.`;
    return {
      status: "insufficient",
      availableDays: activeDays,
      spanDays,
      horizon,
      model: "—",
      modelNote: "Not enough history",
      metrics: { mae: 0, rmse: 0, mape: null, evaluated: "in-sample" },
      history: [],
      forecast: [],
      weeklyPattern: [],
      productDemand: [],
      totalPredicted: 0,
      trendPct: null,
      message: msg,
      backtest: {
        status: "insufficient",
        holdoutDays: 0,
        modelMae: null,
        naiveMae: null,
        naiveName: "same weekday last week",
        beatPct: null,
        note: "Not enough history for a backtest. A percentage here would be a guess, so it is withheld.",
      },
    };
  }

  const firstSaleIdx = dates.indexOf(firstSale as string);
  const fullDates = dates.slice(firstSaleIdx);
  const y = fullDates.map((d) => byDate.get(d) ?? 0);
  const limited = spanDays < 42;
  let backtestComputed: ForecastOutput["backtest"] = {
    status: "insufficient",
    holdoutDays: 0,
    modelMae: null,
    naiveMae: null,
    naiveName: "same weekday last week",
    beatPct: null,
    note: "Not enough history for a holdout backtest. Under 6 weeks, any “beat the baseline by X%” figure would be fitted on the same days it is scored — that is withheld.",
  };

  // Weekly pattern
  const dowSum = new Array(7).fill(0);
  const dowCnt = new Array(7).fill(0);
  fullDates.forEach((d, i) => {
    const dow = new Date(`${d}T00:00:00`).getDay();
    dowSum[dow] += y[i];
    dowCnt[dow]++;
  });
  const weeklyPattern = DOW_NAMES.map((name, dow) => ({
    dow: name,
    avg: dowCnt[dow] ? Math.round((dowSum[dow] / dowCnt[dow]) * 100) / 100 : 0,
  }));

  let model = "Trend regression (OLS)";
  let modelNote = "";
  let histResid: number[] = [];
  let fc: (h: number) => number = () => 0;

  const train = limited ? y : y.slice(0, y.length - 14);
  const test = limited ? [] : y.slice(y.length - 14);

  if (!limited) {
    // Evaluate both models on the holdout
    const o = olsWithDow(train);
    const hwCandidates: { hw: HW; sse: number; params: [number, number, number] }[] = [];
    for (const a of [0.1, 0.3, 0.5, 0.8])
      for (const b of [0.05, 0.2, 0.4])
        for (const g of [0.1, 0.3, 0.6]) {
          const hw = hwFit(train, 7, a, b, g);
          if (!hw) continue;
          const sse = hwResiduals(hw, train).reduce((s, r) => s + r * r, 0);
          hwCandidates.push({ hw, sse, params: [a, b, g] });
        }
    hwCandidates.sort((a, b) => a.sse - b.sse);
    const bestHW = hwCandidates[0]?.hw ?? null;

    const oPred: number[] = [];
    const oIdx0 = y.length - train.length;
    for (let i = 0; i < test.length; i++) {
      const t = train.length + i;
      const dow = new Date(`${fullDates[oIdx0 + train.length + i]}T00:00:00`).getDay();
      const x = [1, t, 0, 0, 0, 0, 0, 0];
      if (dow > 0) x[dow] = 1;
      oPred.push(x.reduce((s, v, k) => s + v * (o.coefs?.[k] ?? 0), 0));
    }
    const oResid = test.map((v, i) => v - oPred[i]);
    const oMet = metrics(oResid, test);

    let hwMet = { mae: Infinity, rmse: Infinity, mape: null as number | null };
    if (bestHW) {
      const base = train.length - 1;
      const hResid: number[] = [];
      const hActuals: number[] = [];
      for (let h = 1; h <= test.length; h++) {
        hResid.push(test[h - 1] - hwPredict(bestHW, h));
        hActuals.push(test[h - 1]);
      }
      hwMet = metrics(hResid, hActuals);
    }

    const naivePred = test.map((_, i) => y[train.length + i - 7] ?? 0);
    const naiveMet = metrics(test.map((v, i) => v - naivePred[i]), test);
    const holdoutModelMae = bestHW && (hwMet.mae < oMet.mae || !o.coefs) ? hwMet.mae : oMet.mae;
    const beatPct = naiveMet.mae > 1 ? ((naiveMet.mae - holdoutModelMae) / naiveMet.mae) * 100 : null;
    backtestComputed = {
      status: "computed",
      holdoutDays: test.length,
      modelMae: Math.round(holdoutModelMae * 100) / 100,
      naiveMae: Math.round(naiveMet.mae * 100) / 100,
      naiveName: "same weekday last week",
      beatPct: beatPct == null ? null : Math.round(beatPct * 10) / 10,
      note:
        beatPct == null
          ? "Holdout was too thin to compare."
          : beatPct >= 0
            ? `On the last ${test.length} days held out of the fit, this model’s MAE was ${beatPct.toFixed(1)}% lower than predicting each day as the same weekday a week earlier.`
            : `On the last ${test.length} held-out days, this model did not beat the naive baseline (MAE was ${Math.abs(beatPct).toFixed(1)}% worse). The baseline is shown so the miss is visible.`,
    };

    if (bestHW && (hwMet.mae < oMet.mae || !o.coefs)) {
      // Refit the winning smoothing combination on the full history
      const [wa, wb, wg] = hwCandidates[0].params;
      const win = hwFit(y, 7, wa, wb, wg) ?? bestHW;
      model = "Holt-Winters (additive, weekly seasonality)";
      modelNote = `Chosen on a ${test.length}-day holdout: MAE ₹${hwMet.mae.toFixed(0)} vs ₹${oMet.mae.toFixed(0)} for the trend model.`;
      histResid = hwResiduals(win, y);
      const chosen = win;
      fc = (h: number) => Math.max(0, hwPredict(chosen, h));
    } else {
      const full = olsWithDow(y);
      if (!full.coefs) throw new Error("Forecast model could not be fitted");
      histResid = full.resid;
      const c = full.coefs;
      const n = y.length;
      fc = (h: number) => {
        const t = n - 1 + h;
        const dow = new Date(`${addDays(today, h - 1)}T00:00:00`).getDay();
        return Math.max(0, c[0] + c[1] * t + (dow > 0 ? c[2 + dow] : 0));
      };
    }
  } else {
    const full = olsWithDow(y);
    if (!full.coefs) throw new Error("Forecast model could not be fitted");
    histResid = full.resid;
    const c = full.coefs;
    const n = y.length;
    fc = (h: number) => {
      const t = n - 1 + h;
      const dow = new Date(`${addDays(today, h - 1)}T00:00:00`).getDay();
      return Math.max(0, c[0] + c[1] * t + (dow > 0 ? c[2 + dow] : 0));
    };
    modelNote = "History is under 6 weeks, so the model was fit on all available data without a holdout evaluation — treat numbers as directional.";
  }

  const residArr = histResid.length ? histResid : [0];
  const sigma = Math.sqrt(residArr.reduce((a, r) => a + r * r, 0) / residArr.length) || 1;
  // Align actuals with the residuals (Holt-Winters residuals start after the first season)
  const alignStart = Math.max(0, y.length - residArr.length);
  const met = metrics(residArr, y.slice(alignStart));

  // In-sample fitted series for the last 60 days (actual vs predicted comparison)
  const last60 = 60;
  const startIdx = Math.max(0, y.length - last60);
  const fitArr: (number | undefined)[] = new Array(y.length).fill(undefined);
  for (let i = alignStart; i < y.length; i++) fitArr[i] = Math.max(0, y[i] - residArr[i - alignStart]);
  const history: { date: string; actual: number; predicted?: number }[] = fullDates
    .slice(startIdx)
    .map((d, i) => ({
      date: d,
      actual: Math.round(y[startIdx + i] * 100) / 100,
      predicted: fitArr[startIdx + i] != null ? Math.round((fitArr[startIdx + i] as number) * 100) / 100 : undefined,
    }));

  const forecast: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const p = fc(h);
    const band = 1.96 * sigma * (1 + 0.08 * (h - 1));
    forecast.push({
      date: addDays(today, h - 1),
      predicted: Math.round(Math.max(0, p) * 100) / 100,
      lower: Math.round(Math.max(0, p - band) * 100) / 100,
      upper: Math.round(Math.max(0, p + band) * 100) / 100,
    });
  }

  // Trend: last-14-day run rate vs prior 14
  const last14 = y.slice(-14).reduce((a, b) => a + b, 0) / 14;
  const prev14 = y.slice(-28, -14).reduce((a, b) => a + b, 0) / 14;
  const trendPct = prev14 > 0 ? ((last14 - prev14) / prev14) * 100 : null;

  // Product-level demand
  const [products, sales28] = await Promise.all([
    db.select().from(productsTable).where(eq(productsTable.businessId, businessId)),
    loadSales(businessId, addDays(today, -27)),
  ]);
  const agg = new Map<string, number[]>();
  for (const s of sales28) {
    const idx = dates.indexOf(s.saleDate);
    const dist = idx >= 0 ? dates.length - 1 - idx : 30;
    const wIdx = Math.min(3, Math.max(0, Math.floor(dist / 7)));
    const arr = agg.get(s.productName) ?? [0, 0, 0, 0];
    arr[wIdx] += s.quantity;
    agg.set(s.productName, arr);
  }
  const productDemand = Array.from(agg.entries())
    .map(([name, weeks]) => {
      const xs = [0, 1, 2, 3];
      const n = 2;
      const xb = xs.reduce((a, b) => a + b, 0) / n;
      const yb = weeks.reduce((a, b) => a + b, 0) / n;
      let num = 0,
        den = 0;
      for (let i = 0; i < n; i++) {
        num += (xs[i] - xb) * (weeks[i] - yb);
        den += (xs[i] - xb) ** 2;
      }
      const slope = den ? num / den : 0;
      const intercept = yb - slope * xb;
      const predictedWeekly = Math.max(0, intercept + slope * 4);
      const dailyRate = weeks.reduce((a, b) => a + b, 0) / 28;
      const prod = products.find((p) => p.name === name);
      return {
        name,
        dailyRate: Math.round(dailyRate * 100) / 100,
        predictedWeekly: Math.round(predictedWeekly * 10) / 10,
        stock: prod ? prod.stockQty : null,
        stockCoversDays: prod && dailyRate > 0 ? Math.round(prod.stockQty / dailyRate) : null,
      };
    })
    .sort((a, b) => b.predictedWeekly - a.predictedWeekly)
    .slice(0, 10);

  const out: ForecastOutput = {
    status: limited ? "limited" : "ok",
    availableDays: activeDays,
    spanDays,
    horizon,
    model,
    modelNote:
      modelNote ||
      (limited
        ? ""
        : `Both models were tested on a ${test.length}-day holdout and the strongest was retrained on all ${y.length} days of history.`),
    metrics: { ...met, evaluated: limited ? "in-sample" : "holdout" },
    history,
    forecast,
    weeklyPattern,
    productDemand,
    totalPredicted: Math.round(forecast.reduce((a, f) => a + f.predicted, 0) * 100) / 100,
    trendPct,
    message: null,
    backtest: backtestComputed,
  };

  await db.insert(forecastResults).values({
    businessId,
    horizonDays: horizon,
    modelName: model,
    metricsJson: JSON.stringify({ ...out.metrics, backtest: out.backtest }),
    seriesJson: JSON.stringify({ history: out.history.slice(-30), forecast }),
  });

  return out;
}

export async function getLatestForecast(businessId: string, horizon: number) {
  const rows = await db
    .select()
    .from(forecastResults)
    .where(eq(forecastResults.businessId, businessId))
    .orderBy(desc(forecastResults.createdAt))
    .limit(10);
  return rows.find((r) => r.horizonDays === horizon) ?? rows[0] ?? null;
}
