// Run with: npm run test:math
import assert from "node:assert/strict";
import * as e from "../src/lib/engine-math.ts";

const fmt = (n: number) => "₹" + Math.round(n);

/* Reorder point */
const flat = Array(28).fill(10);
const r0 = e.reorderPoint(flat, 3);
assert.equal(r0.rop, 30); // no variation, no safety stock
const noisy = [8, 12, 9, 11, 10, 14, 6, 10, 13, 7, 10, 12, 8, 10, 9, 11, 10, 15, 5, 10, 12, 8, 10, 11, 9, 10, 13, 7];
const r1 = e.reorderPoint(noisy, 4);
assert.ok(r1.safetyStock > 0 && r1.rop > r1.leadDemand);
assert.equal(e.stockRisk(r1.leadDemand - 1, r1), "stockout_before_delivery");
assert.equal(e.stockRisk(r1.rop - 0.5, r1), "reorder_now");
assert.equal(e.stockRisk(r1.rop + 50, r1), "ok");
assert.equal(e.stockRisk(0, e.reorderPoint(Array(28).fill(0), 3)), "ok");
const sm = e.slowMover(200, 1, 50);
assert.deepEqual([sm.slow, sm.cashTrapped], [true, 10000]);
assert.equal(e.slowMover(20, 5, 50).slow, false);
assert.equal(e.slowMover(40, 0, 10).slow, true); // unsold stock counts as slow

/* Cash guardian */
const today = "2026-10-30";
const sales = Array.from({ length: 56 }, (_, i) => ({ date: e.addDays(today, i), low: 800, mid: 1000, high: 1200 }));
const base = { today, horizonDays: 56, salesForecast: sales, creditShare: 0.2, cogsRatio: 0.7, items: [] as e.CashItemIn[] };
const calm = e.projectCash({ ...base, openingCash: 5000 });
assert.equal(calm.status, "ok");
if (calm.status === "ok") {
  assert.equal(calm.crunch, null);
  // 1000 x 0.8 cash in - 1000 x 0.7 out = +100 a day in the mid case
  assert.equal(calm.days[0].mid, 5100);
  assert.ok(calm.days[55].high > calm.days[55].mid && calm.days[55].mid > calm.days[55].low);
}
const bills: e.CashItemIn[] = [
  { kind: "payable", party: "Wholesaler", amount: 9000, dueDate: e.addDays(today, 20), recurrence: "none", status: "open" },
  { kind: "recurring", party: "Rent", amount: 3000, dueDate: e.addDays(today, 5), recurrence: "monthly", status: "open" },
  { kind: "receivable", party: "Ramesh", amount: 1000, dueDate: e.addDays(today, 10), recurrence: "none", status: "open" },
  { kind: "payable", party: "Paid already", amount: 99999, dueDate: e.addDays(today, 3), recurrence: "none", status: "settled" },
];
const tight = e.projectCash({ ...base, openingCash: 3000, items: bills });
assert.equal(tight.status, "ok");
if (tight.status === "ok") {
  assert.ok(tight.crunch, "a crunch is expected");
  assert.ok(tight.crunch!.date >= e.addDays(today, 5));
  assert.ok(tight.crunch!.weeksAhead >= 1);
  assert.ok(tight.lowest.low.balance < tight.lowest.high.balance);
  assert.equal(tight.assumptions.length, 6);
}
// Settled items never move money
const settledOnly = e.projectCash({ ...base, openingCash: 6000, items: [bills[3]] });
if (settledOnly.status === "ok") assert.equal(settledOnly.crunch, null);
// Too little forecast: declined with a reason
assert.equal(e.projectCash({ ...base, openingCash: 1, salesForecast: sales.slice(0, 5) }).status, "insufficient");
// Monthly dates keep the day of month and clamp at month end
assert.deepEqual(e.dueDates({ dueDate: "2026-01-31", recurrence: "monthly" }, "2026-02-01", "2026-04-30"), ["2026-02-28", "2026-03-31", "2026-04-30"]);
assert.deepEqual(e.dueDates({ dueDate: "2026-10-01", recurrence: "weekly" }, "2026-10-30", "2026-11-13"), ["2026-11-05", "2026-11-12"]);
assert.deepEqual(e.dueDates({ dueDate: "2026-12-05", recurrence: "none" }, "2026-10-30", "2026-11-30"), []);

/* Holdout assignment */
const refs = Array.from({ length: 40 }, (_, i) => `C${i}`);
const a1 = e.assignHoldout(refs, 20, "exp-1");
const a2 = e.assignHoldout([...refs].reverse(), 20, "exp-1");
assert.deepEqual(a1, a2); // repeatable, independent of input order
assert.equal(a1.holdout.length, 8);
assert.equal(new Set([...a1.holdout, ...a1.treatment]).size, 40);
assert.notDeepEqual(a1.holdout, e.assignHoldout(refs, 20, "exp-2").holdout);
assert.ok(e.assignHoldout(refs.slice(0, 6), 20, "x").holdout.length >= 2);

/* Holdout analysis */
const mk = (n: number, buyers: number, spend: number) => Array.from({ length: n }, (_, i) => ({ orders: i < buyers ? 1 : 0, revenue: i < buyers ? spend + (i % 3) * 20 : 0 }));
const win = e.analyzeExperiment({ treatment: mk(40, 28, 300), holdout: mk(10, 2, 300), daysElapsed: 14, windowDays: 14, fmt });
assert.equal(win.status, "ok");
if (win.status === "ok") {
  assert.equal(win.verdict, "worked");
  assert.ok(win.incrementalTotal > 0 && win.totalLow > 0);
  assert.equal(win.partial, false);
  assert.equal(win.steps.length, 5);
}
// Many more customers came back, but spend per customer is too noisy for the rupee range to exclude zero
const noisy2 = e.analyzeExperiment({
  treatment: Array.from({ length: 20 }, (_, i) => ({ orders: i < 11 ? 1 : 0, revenue: i < 11 ? [40, 600, 90, 20, 900, 30, 60, 25, 700, 45, 35][i] : 0 })),
  holdout: Array.from({ length: 8 }, (_, i) => ({ orders: i < 1 ? 1 : 0, revenue: i < 1 ? 38 : 0 })),
  daysElapsed: 12,
  windowDays: 14,
  fmt,
});
assert.equal(noisy2.status, "ok");
if (noisy2.status === "ok") {
  assert.ok(noisy2.totalLow < 0, "the rupee range should still include zero");
  assert.equal(noisy2.verdict, "worked", "but the rise in customers coming back is clear");
}
const nothing = e.analyzeExperiment({ treatment: mk(40, 8, 300), holdout: mk(10, 2, 300), daysElapsed: 14, windowDays: 14, fmt });
if (nothing.status === "ok") assert.equal(nothing.verdict, "inconclusive");
const worse = e.analyzeExperiment({ treatment: mk(40, 2, 300), holdout: mk(10, 9, 300), daysElapsed: 14, windowDays: 14, fmt });
if (worse.status === "ok") assert.equal(worse.verdict, "worse");
assert.equal(e.analyzeExperiment({ treatment: mk(40, 20, 300), holdout: mk(10, 2, 300), daysElapsed: 1, windowDays: 14, fmt }).status, "measuring");
assert.equal(e.analyzeExperiment({ treatment: mk(8, 4, 300), holdout: mk(2, 0, 300), daysElapsed: 14, windowDays: 14, fmt }).status, "insufficient");
// Nobody bought in either group: no crash, no claimed win
const none = e.analyzeExperiment({ treatment: mk(20, 0, 0), holdout: mk(6, 0, 0), daysElapsed: 10, windowDays: 14, fmt });
if (none.status === "ok") assert.equal(none.verdict, "inconclusive");

// Calibration: with no real effect (same buying rate and spend in both groups), false calls stay near 5%
let seedX = 11;
const rx = () => {
  seedX = (seedX * 16807) % 2147483647;
  return seedX / 2147483647;
};
const draw = (n: number) => Array.from({ length: n }, () => (rx() < 0.3 ? { orders: 1, revenue: 80 + rx() * 700 } : { orders: 0, revenue: 0 }));
let falseCalls = 0;
const RUNS = 600;
for (let i = 0; i < RUNS; i++) {
  const r = e.analyzeExperiment({ treatment: draw(20), holdout: draw(8), daysElapsed: 14, windowDays: 14, fmt });
  if (r.status === "ok" && r.verdict !== "inconclusive") falseCalls++;
}
assert.ok(falseCalls / RUNS < 0.08, `false call rate too high: ${falseCalls}/${RUNS}`);
console.log(`experiment false-call rate with no real effect: ${((falseCalls / RUNS) * 100).toFixed(1)}%`);

/* Quick sale */
const prods = [
  { name: "Sona Masoori Rice 5kg", price: 420 },
  { name: "Sunflower Oil 1L", price: 175 },
  { name: "Aashirvaad Atta 5kg", price: 295 },
  { name: "Toor Dal 1kg", price: 168 },
];
const q = e.parseQuickSale("sold 3 rice, 2 oil", prods);
assert.deepEqual(q.items.map((i) => [i.product, i.qty, i.total]), [["Sona Masoori Rice 5kg", 3, 1260], ["Sunflower Oil 1L", 2, 350]]);
const hi = e.parseQuickSale("2 चावल और 1 तेल", prods);
assert.deepEqual(hi.items.map((i) => i.product), ["Sona Masoori Rice 5kg", "Sunflower Oil 1L"]);
const cr = e.parseQuickSale("sold 2 atta to ramesh on credit", prods);
assert.equal(cr.onCredit, true);
assert.equal(cr.customer, "Ramesh");
assert.equal(cr.items[0].product, "Aashirvaad Atta 5kg");
assert.equal(e.parseQuickSale("rice 4", prods).items[0].qty, 4);
assert.equal(e.parseQuickSale("two dal", prods).items[0].qty, 2);
const unk = e.parseQuickSale("5 unicorns, 1 oil", prods);
assert.deepEqual(unk.items.map((i) => i.status), ["unknown", "matched"]);
const amb = e.parseQuickSale("1 rice", [...prods, { name: "Basmati Rice 1kg", price: 120 }]);
assert.equal(amb.items[0].status, "ambiguous");
assert.equal(amb.items[0].candidates.length, 2);
assert.equal(e.parseQuickSale("hello there", prods).items.length, 0);

/* Alert cap */
const drafts = [
  { id: "a", severity: "info", impactRs: 50 },
  { id: "b", severity: "critical", impactRs: 9000 },
  { id: "c", severity: "warning", impactRs: 1200 },
  { id: "d", severity: "warning", impactRs: null },
];
const capped = e.rankAndCap(drafts, 3, 5);
assert.deepEqual(capped.keep.map((d) => d.id), ["b", "c"]);
assert.equal(capped.dropped.length, 2);
assert.equal(e.rankAndCap(drafts, 9, 5).keep.length, 0);

/* Forecast confidence */
assert.equal(e.forecastConfidence({ status: "insufficient", spanDays: 5, beatPct: null, mape: null }).level, "none");
assert.equal(e.forecastConfidence({ status: "limited", spanDays: 30, beatPct: null, mape: null }).level, "low");
assert.equal(e.forecastConfidence({ status: "ok", spanDays: 90, beatPct: -4, mape: 12 }).level, "low");
assert.equal(e.forecastConfidence({ status: "ok", spanDays: 90, beatPct: 18, mape: 14 }).level, "high");
assert.equal(e.forecastConfidence({ status: "ok", spanDays: 90, beatPct: 3, mape: 14 }).level, "medium");

console.log("engine-math: all checks passed");
