// Run with: npm run test:math   (Node 22.18+ strips the types itself; no database needed)
import assert from "node:assert/strict";
import * as m from "../src/lib/impact-math.ts";

let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const today = "2026-10-30";
const start = m.addDaysISO(today, -119);
const approved = m.addDaysISO(today, -12);
const fmt = (n: number) => "₹" + Math.round(n);

function build(lift: number) {
  const product: m.DayMap = {};
  const others: m.DayMap = {};
  for (let d = start; d <= today; d = m.addDaysISO(d, 1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const wk = dow === 0 || dow === 6 ? 1.2 : 1;
    let p = 1000 * wk * (0.8 + rnd() * 0.4);
    if (d > approved && d <= m.addDaysISO(approved, 7)) p *= lift;
    product[d] = p;
    others[d] = 8000 * wk * (0.9 + rnd() * 0.2);
  }
  return { product, others };
}
const lift = (l: number) => {
  const { product, others } = build(l);
  return m.computeLift({ product, others, approvedDate: approved, today, dataStart: start, fmt });
};

// A real +40% lift is found, a real -30% drop is found, and no effect stays "inconclusive".
const up = lift(1.4);
assert.equal(up.status, "measured");
if (up.status === "measured") assert.equal(up.verdict, "lift");
const down = lift(0.7);
if (down.status === "measured") assert.equal(down.verdict, "below");
const flat = lift(1.0);
if (flat.status === "measured") assert.equal(flat.verdict, "inconclusive");

// With no real effect, false alarms stay close to the nominal 5% (allow 8%).
let wrong = 0;
const N = 300;
for (let i = 0; i < N; i++) {
  const r = lift(1.0);
  if (r.status === "measured" && r.verdict !== "inconclusive") wrong++;
}
assert.ok(wrong / N < 0.08, `false alarm rate too high: ${wrong}/${N}`);

// Too early and too little history are reported, never guessed.
assert.equal(m.computeLift({ product: {}, others: {}, approvedDate: m.addDaysISO(today, -1), today, dataStart: start, fmt }).status, "measuring");
assert.equal(m.computeLift({ product: {}, others: {}, approvedDate: approved, today, dataStart: m.addDaysISO(approved, -5), fmt }).status, "insufficient");

// Guardrail
assert.equal(m.maxSafeDiscount(100, 80), 11);
assert.equal(m.maxSafeDiscount(100, 95), 0);
const g = m.applyGuardrail(100, 80, 25)!;
assert.equal(g.applied, 11);
assert.equal(g.clamped, true);
assert.equal(m.applyGuardrail(100, 60, 10)!.clamped, false);

// PII
const masked = m.maskPii("Ramesh 98450 12345, +91 9845012345, a@b.com, pay x@okhdfcbank GST 29ABCDE1234F1Z5");
assert.ok(!/\d{5}/.test(masked) && !masked.includes("@b.com") && !masked.includes("okhdfcbank"));

// UPI parsing: the year must never be read as the amount
const up2 = m.parseUpiText("12/10/2026 Rs. 450 received from Ramesh Kumar via UPI\n14-10-2026 Paid to Wholesaler Rs 5000\n15/10/2026 ₹300 credit\n31/12/2030 Rs 100 received from X\nnonsense", today);
assert.deepEqual(up2.credits.map((c) => c.amount), [450, 300]);
assert.equal(up2.credits[0].party, "Ramesh Kumar");
assert.equal(up2.debitsIgnored, 1);
assert.equal(up2.skipped.length, 2);

// Drop detection: same-weekday baseline over trailing weeks, flagged near 2 SD, named by product and category
const rows: { date: string; product: string; category: string; revenue: number }[] = [];
let sd2 = 3;
const rnd2 = () => {
  sd2 = (sd2 * 16807) % 2147483647;
  return sd2 / 2147483647;
};
for (let d = start; d <= today; d = m.addDaysISO(d, 1)) {
  const cur = d >= m.addDaysISO(today, -6);
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
  const wk = dow === 0 || dow === 6 ? 1.4 : 1;
  rows.push({ date: d, product: "Oil", category: "Staples", revenue: (cur ? 500 : 1000) * wk * (0.95 + rnd2() * 0.1) });
  rows.push({ date: d, product: "Rice", category: "Staples", revenue: 1000 * wk * (0.95 + rnd2() * 0.1) });
  rows.push({ date: d, product: "Milk", category: "Dairy", revenue: 400 * wk * (0.95 + rnd2() * 0.1) });
}
const dr = m.explainDrop(rows, today);
assert.equal(dr.status, "ok");
assert.equal(dr.dropDetected, true);
assert.equal(dr.drivers[0].product, "Oil");
assert.equal(dr.drivers[0].category, "Staples");
assert.equal(dr.categories[0].category, "Staples");
assert.ok(dr.baselineWeeks >= 4 && dr.baselineWeeks <= 8);
assert.ok(dr.zScore! <= -2);
assert.ok(dr.worstDay !== null);

// A normal week is not flagged
const calm = rows.map((r) => (r.product === "Oil" && r.date >= m.addDaysISO(today, -6) ? { ...r, revenue: r.revenue * 2 } : r));
assert.equal(m.explainDrop(calm, today).dropDetected, false);

// Under 4 weeks of history: declined, with a reason
const short = m.explainDrop(rows.filter((r) => r.date >= m.addDaysISO(today, -24)), today);
assert.equal(short.status, "insufficient");
assert.ok(short.why!.includes("4 full weeks"));

console.log("impact-math: all checks passed");
