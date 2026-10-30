// Run with: npm run test:math
import assert from "node:assert/strict";
import * as c from "../src/lib/collections-math.ts";

const TODAY = "2026-10-31";
const ago = (d: number) => {
  const t = new Date(Date.UTC(2026, 9, 31) - d * 86400000);
  return t.toISOString().slice(0, 10);
};
const item = (id: string, party: string, amount: number, overdueBy: number) => ({ id, party, amount, dueDate: ago(overdueBy) });

/* Day counting and stages */
assert.equal(c.daysBetween("2026-10-01", "2026-10-31"), 30);
assert.equal(c.daysBetween("2026-10-31", "2026-10-31"), 0);
assert.equal(c.daysBetween("2026-12-31", "2027-01-02"), 2, "crosses a year end");
assert.equal(c.stageFor(-3), 0);
assert.equal(c.stageFor(0), 0, "due today is not overdue");
assert.equal(c.stageFor(1), 1);
assert.equal(c.stageFor(7), 1);
assert.equal(c.stageFor(8), 2);
assert.equal(c.stageFor(21), 2);
assert.equal(c.stageFor(22), 3);

/* Planning */
const items = [item("a", "Asha", 1000, 3), item("b", "Bala", 9000, 12), item("c", "Chitra", 30, 40), item("d", "Dev", 5000, -4), item("e", "Esha", 4000, 30)];
const plan = c.planReminders(items, [], TODAY);
assert.deepEqual(plan.map((p) => p.itemId), ["b", "e", "a"], "ranked by amount weighted by age; tiny and not-yet-due items are skipped");
assert.equal(plan.find((p) => p.itemId === "e")!.stage, 3);
assert.equal(plan.find((p) => p.itemId === "b")!.stage, 2);
assert.equal(plan.find((p) => p.itemId === "a")!.stage, 1);

/* Never the same stage twice, even if the owner dismissed it */
const again = c.planReminders(items, [{ itemId: "e", stage: 3, at: ago(20) + "T09:00:00Z" }], TODAY);
assert.ok(!again.some((p) => p.itemId === "e"), "stage 3 already drafted for Esha");

/* Cooldown between drafts for the same item */
const recent = c.planReminders([item("b", "Bala", 9000, 12)], [{ itemId: "b", stage: 1, at: ago(2) + "T09:00:00Z" }], TODAY);
assert.equal(recent.length, 0, "drafted two days ago, so wait");
const later = c.planReminders([item("b", "Bala", 9000, 12)], [{ itemId: "b", stage: 1, at: ago(6) + "T09:00:00Z" }], TODAY);
assert.equal(later.length, 1, "six days later it moves on to the next stage");
assert.equal(later[0].stage, 2);

/* Cap per run */
const many = Array.from({ length: 12 }, (_, i) => item("x" + i, "P" + i, 1000 + i * 100, 5));
assert.equal(c.planReminders(many, [], TODAY).length, c.MAX_PER_RUN);
assert.equal(c.planReminders(many, [], TODAY, { maxPerRun: 2 }).length, 2);

/* Hold reasons are honest */
assert.equal(c.holdReason(item("d", "Dev", 5000, -4), [], TODAY), "Not overdue yet");
assert.equal(c.holdReason(item("c", "Chitra", 30, 40), [], TODAY), "Amount is too small to chase");
assert.match(c.holdReason(item("b", "Bala", 9000, 12), [{ itemId: "b", stage: 1, at: ago(2) + "T00:00:00Z" }], TODAY)!, /Waiting/);
assert.equal(c.holdReason(item("b", "Bala", 9000, 12), [], TODAY), null, "eligible items have no hold");

/* Wording: includes the facts, escalates, stays polite, never threatens */
const base = { shop: "Annapurna Kirana", party: "Bala", amount: 9000, dueDate: ago(12), daysOverdue: 12, upi: "shop@upi" } as const;
for (const lang of ["en", "hi", "kn"] as const) {
  for (const stage of [1, 2, 3] as const) {
    const m = c.buildMessage(lang, { ...base, stage });
    assert.ok(m.includes("₹9,000"), `${lang} s${stage} has the amount`);
    assert.ok(m.includes("Bala"), `${lang} s${stage} has the name`);
    assert.ok(m.includes("Annapurna Kirana"), `${lang} s${stage} has the shop`);
    assert.ok(m.includes("shop@upi"), `${lang} s${stage} has the UPI id`);
    assert.ok(!/police|legal|court|shame|threat|fine|penalty/i.test(m), `${lang} s${stage} is not threatening`);
  }
}
const s1 = c.buildMessage("en", { ...base, stage: 1 });
const s3 = c.buildMessage("en", { ...base, stage: 3 });
assert.notEqual(s1, s3, "tone changes with age");
assert.ok(c.buildMessage("en", { ...base, upi: null, stage: 2 }).indexOf("UPI") === -1, "no UPI line without an id");
assert.ok(c.buildMessage("en", { ...base, stage: 2 }).includes("12 days"));

/* WhatsApp link */
const link = c.whatsappLink("98450 12345", "Hello & thanks");
assert.equal(link, "https://wa.me/919845012345?text=Hello%20%26%20thanks");
assert.equal(c.whatsappLink("919845012345", "x"), "https://wa.me/919845012345?text=x");
assert.equal(c.whatsappLink(null, "x"), null);
assert.equal(c.whatsappLink("123", "x"), null, "too short to be a number");

console.log("collections-math: all checks passed");
