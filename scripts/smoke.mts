// End-to-end check against a running dev server and database.
//   npm run dev        (in one terminal)
//   npm run smoke      (in another; BASE_URL defaults to http://localhost:3000)
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let token = "";
let failures = 0;

async function api(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(BASE + path, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as any };
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${(e as Error).message.split("\n").slice(0, 3).join("\n       ")}`);
  }
}

console.log(`Smoke test against ${BASE}`);

await step("demo login", async () => {
  const r = await api("/api/auth/demo", { body: {} });
  assert.equal(r.status, 200);
  token = r.json.token;
  assert.ok(token);
});

await step("reload the demo dataset (fresh planted scenarios)", async () => {
  const r = await api("/api/demo", { body: { action: "load" } });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
});

await step("impact: drop report, actions, experiments, scorecard", async () => {
  const r = await api("/api/impact?limit=5");
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
  assert.ok(["ok", "insufficient"].includes(r.json.drop.status));
  assert.ok(r.json.actions.length >= 1 && r.json.actions.length <= 5, `actions: ${r.json.actions.length}`);
  assert.ok(r.json.experiments.length >= 1, "the demo experiment should exist");
  const demoExp = r.json.experiments.find((e: any) => /Win-back/.test(e.title));
  assert.ok(demoExp, "the planted win-back experiment should exist: " + r.json.experiments.map((e: any) => e.title).join("; "));
  const x = demoExp.result;
  assert.equal(x.status, "ok", JSON.stringify(x).slice(0, 200));
  assert.equal(x.verdict, "worked", `the planted effect should be detected: ${JSON.stringify(x).slice(0, 300)}`);
  assert.equal(r.json.drop.dropDetected, true, "the planted supplier-delay dip should be flagged");
  assert.ok(r.json.drop.categories.length > 0 && r.json.drop.drivers.length > 0);
  console.log(`       drop: ${r.json.drop.status} pct=${r.json.drop.pct?.toFixed?.(1)} z=${r.json.drop.zScore?.toFixed?.(1)} detected=${r.json.drop.dropDetected}`);
  console.log(`       experiment: ${x.status} ${x.verdict ?? ""} treated=${x.rateT?.toFixed?.(2)} held=${x.rateH?.toFixed?.(2)} extra=${Math.round(x.incrementalTotal ?? 0)}`);
  console.log(`       actions: ${r.json.actions.map((a: any) => a.kind).join(", ")}`);
  assert.ok(r.json.scorecard.stockout.tracked > 0);
});

await step("impact: localized titles (hi, kn)", async () => {
  for (const lang of ["hi", "kn"]) {
    const r = await api(`/api/impact?lang=${lang}&limit=5`);
    assert.equal(r.status, 200);
    assert.ok(r.json.actions.every((a: any) => /[ऀ-ॿಀ-೿]/.test(a.title) || a.kind === "stock" || a.kind === "winback" || a.kind === "repeat" || a.kind === "festival" || a.kind === "slow" || a.kind === "cash" || a.kind === "drop"));
  }
});

await step("cash outlook", async () => {
  const r = await api("/api/cash");
  assert.equal(r.status, 200);
  assert.equal(r.json.outlook.projection.status, "ok", JSON.stringify(r.json.outlook.projection).slice(0, 200));
  const p = r.json.outlook.projection;
  assert.equal(p.days.length, 56);
  assert.ok(p.assumptions.length >= 6);
  console.log(`       opening=${r.json.outlook.openingCash} crunch=${JSON.stringify(p.crunch)} lowestMid=${Math.round(p.lowest.mid.balance)} lowestLow=${Math.round(p.lowest.low.balance)} credit=${r.json.outlook.params.creditSharePct}% cogs=${r.json.outlook.params.cogsPct}%`);
  assert.ok(r.json.items.length >= 4);
});

await step("cash: validation and add / settle / delete", async () => {
  assert.equal((await api("/api/cash", { body: { kind: "nope", party: "x", amount: 5, dueDate: "2026-12-01" } })).status, 400);
  assert.equal((await api("/api/cash", { body: { kind: "payable", party: "x", amount: -5, dueDate: "2026-12-01" } })).status, 400);
  assert.equal((await api("/api/cash", { body: { kind: "payable", party: "x", amount: 5, dueDate: "2026-02-31" } })).status, 400);
  assert.equal((await api("/api/cash", { body: { kind: "recurring", party: "x", amount: 5, dueDate: "2026-12-01", recurrence: "none" } })).status, 400);
  const add = await api("/api/cash", { body: { kind: "payable", party: "Smoke supplier", amount: 1234, dueDate: "2026-12-15" } });
  assert.equal(add.status, 200);
  assert.equal((await api("/api/cash", { method: "PUT", body: { settleId: add.json.item.id } })).status, 200);
  const del = await api(`/api/cash?id=${add.json.item.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.equal((await api("/api/cash", { method: "PUT", body: { openingCash: "abc" } })).status, 400);
});

await step("audience and consent", async () => {
  const a = await api("/api/audience?segment=All%20customers");
  assert.equal(a.status, 200);
  assert.ok(a.json.total > 10 && a.json.consented > 0 && a.json.consented < a.json.total, JSON.stringify(a.json).slice(0, 200));
  console.log(`       all customers: ${a.json.consented} of ${a.json.total} consented`);
  const c = await api("/api/audience?segment=Custom%20segment&spec=" + encodeURIComponent(JSON.stringify({ minOrders: 3 })));
  assert.equal(c.status, 200);
  assert.equal((await api("/api/audience?segment=Local%20neighbourhood")).json.targetable, false);
  assert.equal((await api("/api/audience?segment=Custom%20segment&spec=%7Bbad")).status, 400);
});

await step("marketing: guardrail, sms, languages", async () => {
  const hi = await api("/api/marketing/generate", { body: { type: "sms", product: "Aashirvaad Atta 5kg", segment: "All customers", tone: "friendly", discount: 40, lang: "hi" } });
  assert.equal(hi.status, 200, JSON.stringify(hi.json).slice(0, 200));
  assert.ok(/[ऀ-ॿ]/.test(hi.json.content), hi.json.content);
  assert.ok(hi.json.content.includes("STOP"));
  assert.equal(hi.json.guardrail.clamped, true, JSON.stringify(hi.json.guardrail));
  assert.ok(hi.json.guardrail.applied < 40);
  const kn = await api("/api/marketing/generate", { body: { type: "whatsapp", product: "Toor Dal 1kg", segment: "All customers", tone: "urgent", discount: 5, lang: "kn" } });
  assert.ok(/[ಀ-೿]/.test(kn.json.content), kn.json.content);
  const en = await api("/api/marketing/generate", { body: { type: "sms", product: "Toor Dal 1kg", segment: "All customers", tone: "friendly", discount: 5, lang: "en" } });
  assert.ok(en.json.content.includes("STOP"));
  assert.equal(en.json.audience.total > 0, true);
  console.log(`       hi sms: ${hi.json.content}`);
  console.log(`       guardrail: ${hi.json.guardrail.note}`);
});

await step("marketing: consent gate blocks drafting for a segment nobody agreed to", async () => {
  const list = await api("/api/consent");
  assert.equal(list.status, 200);
  const consented = list.json.customers.filter((c: any) => c.consent).map((c: any) => c.refId);
  assert.ok(consented.length > 0);
  assert.equal((await api("/api/consent", { method: "PATCH", body: { refIds: consented, consent: false } })).status, 200);
  const blocked = await api("/api/marketing/generate", { body: { type: "whatsapp", product: "auto", segment: "All customers", tone: "friendly", lang: "en" } });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.json).slice(0, 200));
  assert.equal(blocked.json.blocked, true);
  const publicPost = await api("/api/marketing/generate", { body: { type: "instagram", product: "auto", segment: "All customers", tone: "friendly", lang: "en" } });
  assert.equal(publicPost.status, 200, "a public post needs no consent");
  const exp = await api("/api/experiments", { body: { segment: "All customers", title: "should not start" } });
  assert.equal(exp.status, 422);
  assert.equal((await api("/api/consent", { method: "PATCH", body: { refIds: consented, consent: true, source: "smoke restore" } })).status, 200);
});

await step("experiments: start a tracked send, then it shows as measuring", async () => {
  assert.equal((await api("/api/experiments", { body: { segment: "Local neighbourhood", title: "x" } })).status, 400);
  const r = await api("/api/experiments", { body: { segment: "All customers", title: "Smoke test promo", product: "Toor Dal 1kg", holdoutPct: 20 } });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
  assert.ok(r.json.treatment.length >= 8 && r.json.heldBack >= 2);
  assert.ok(r.json.treatment.every((t: any) => t.refId));
  const list = await api("/api/experiments");
  const mine = list.json.experiments.find((e: any) => e.title === "Smoke test promo");
  assert.ok(mine, "new experiment is listed");
  assert.equal(mine.result.status, "measuring");
  assert.equal((await api(`/api/experiments?id=${mine.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await api(`/api/experiments?id=${mine.id}`, { method: "DELETE" })).status, 404, "already deleted");
  assert.ok(!(await api("/api/experiments")).json.experiments.some((e: any) => e.id === mine.id));
  console.log(`       messaged=${r.json.treatment.length} heldBack=${r.json.heldBack} noConsent=${r.json.excludedNoConsent}`);
});

await step("quick sale: preview, ambiguity, credit commit", async () => {
  assert.equal((await api("/api/data/quick", { body: { text: "hi" } })).status, 400);
  const none = await api("/api/data/quick", { body: { text: "hello there" } });
  assert.equal(none.status, 200);
  assert.equal(none.json.items.length, 0);
  assert.equal((await api("/api/data/quick", { body: { text: "hello there", commit: true } })).status, 422);
  const p = await api("/api/data/quick", { body: { text: "sold 2 atta, 1 dal to Ramesh Smoke on credit" } });
  assert.equal(p.status, 200, JSON.stringify(p.json).slice(0, 200));
  assert.equal(p.json.onCredit, true);
  assert.equal(p.json.unresolved, 0, JSON.stringify(p.json.items));
  const before = await api("/api/cash");
  const noName = await api("/api/data/quick", { body: { text: "sold 2 atta on credit", commit: true } });
  assert.equal(noName.status, 422);
  const ok = await api("/api/data/quick", { body: { text: "sold 2 atta, 1 dal to Ramesh Smoke on credit", commit: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json).slice(0, 300));
  const after = await api("/api/cash");
  assert.equal(after.json.items.length, before.json.items.length + 1, "a receivable was created");
  const frac = await api("/api/data/quick", { body: { text: "sold 2.5 atta", commit: true } });
  assert.equal(frac.status, 422);
});

await step("UPI paste: preview then import, duplicates skipped", async () => {
  const n = 100 + (Date.now() % 800); // unique per run so a repeated run is not read as duplicates
  const text = `01/10/2026 Rs. ${n} received from Smoke Payer via UPI\n02 Oct 2026 UPI credited ₹${n + 0.5} from Smoke Stores\n03-10-2026 Paid to Wholesaler Rs 5000`;
  const p = await api("/api/data/upi", { body: { text } });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  assert.equal(p.json.found, 2, JSON.stringify(p.json));
  assert.equal(p.json.debitsIgnored, 1);
  const c = await api("/api/data/upi", { body: { text, commit: true } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const again = await api("/api/data/upi", { body: { text, commit: true } });
  assert.equal(again.status, 422, "second import has nothing new");
  assert.equal(again.json.duplicates, 2);
});

await step("google sheets connector: rejects anything but a docs.google.com sheet", async () => {
  assert.equal((await api("/api/data/sheet", { body: { url: "not a url" } })).status, 400);
  assert.equal((await api("/api/data/sheet", { body: { url: "https://evil.example.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa" } })).status, 400);
  assert.equal((await api("/api/data/sheet", { body: { url: "http://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa" } })).status, 400);
  assert.equal((await api("/api/data/sheet", { body: { url: "https://docs.google.com/document/d/aaaaaaaaaaaaaaaaaaaaaaaa" } })).status, 400);
});

await step("autopilot: dial, budget, log, approve, receive", async () => {
  assert.equal((await api("/api/autopilot", { method: "PUT", body: { level: 9, budget: 1 } })).status, 400);
  assert.equal((await api("/api/autopilot", { method: "PUT", body: { level: 3, budget: 0 } })).status, 400);
  assert.equal((await api("/api/autopilot", { method: "PUT", body: { level: 3, budget: 200000 } })).status, 200);
  const run = await api("/api/autopilot", { body: {} });
  assert.equal(run.status, 200, JSON.stringify(run.json).slice(0, 200));
  const kinds = run.json.log.map((l: any) => `${l.kind}:${l.status}`);
  console.log(`       log: ${kinds.join(", ")}`);
  assert.ok(run.json.log.length >= 1);
  const again = await api("/api/autopilot", { body: {} });
  assert.equal(again.json.created, 0, "running twice the same day creates nothing new");
  const po = run.json.log.find((l: any) => l.kind === "purchase_order");
  if (po) {
    assert.ok(["auto_approved", "drafted", "received", "approved"].includes(po.status), `unexpected status ${po.status}`);
    if (po.status === "auto_approved") {
      const recv = await api(`/api/autopilot/${po.id}`, { method: "PATCH", body: { decision: "received" } });
      assert.equal(recv.status, 200, JSON.stringify(recv.json));
      assert.equal((await api(`/api/autopilot/${po.id}`, { method: "PATCH", body: { decision: "received" } })).status, 409, "cannot receive twice");
    }
  }
  const drafted = run.json.log.find((l: any) => l.status === "suggested" || l.status === "drafted");
  if (drafted) assert.equal((await api(`/api/autopilot/${drafted.id}`, { method: "PATCH", body: { decision: "dismiss" } })).status, 200);
  assert.equal((await api(`/api/autopilot/00000000-0000-0000-0000-000000000000`, { method: "PATCH", body: { decision: "approve" } })).status, 404);
  assert.equal((await api("/api/autopilot", { method: "PUT", body: { level: 2, budget: 0 } })).status, 200);
});

await step("assistant: tool interface returns figures", async () => {
  for (const [q, tool] of [
    ["Will I run short of cash in the next month?", "get_cash_outlook"],
    ["Did my last promotion actually work?", "get_promo_results"],
    ["Why have my sales declined?", "get_drop_report"],
    ["Which products should I restock?", "get_stock_risk"],
    ["Predict my revenue for next week", "get_forecast"],
    ["What was my total revenue last month?", "get_sales"],
  ] as const) {
    const r = await api("/api/ai/chat", { body: { question: q } });
    assert.equal(r.status, 200, `${q}: ${JSON.stringify(r.json).slice(0, 200)}`);
    assert.ok(r.json.tools.some((t: any) => t.tool === tool), `${q} should call ${tool}, got ${r.json.tools.map((t: any) => t.tool)}`);
    assert.ok(r.json.tools.every((t: any) => t.figures.length > 0), `${q}: tool returned no figures`);
    assert.ok(r.json.reply.length > 20);
  }
});

await step("whatsapp brief: numbered actions in three languages", async () => {
  for (const lang of ["en", "hi", "kn"]) {
    const r = await api(`/api/wa/thread?lang=${lang}`);
    assert.equal(r.status, 200);
    const brief = r.json.messages.filter((m: any) => m.kind === "brief").slice(-1)[0];
    assert.ok(brief, "brief exists");
    assert.ok(/^1\. /m.test(brief.body), `${lang} brief should list actions:\n${brief.body}`);
    if (lang === "hi") console.log("       hi brief:\n       " + brief.body.split("\n").join("\n       "));
  }
  const cash = await api("/api/wa/ask", { body: { text: "Will I run short of cash?", lang: "en" } });
  assert.equal(cash.status, 200, JSON.stringify(cash.json).slice(0, 200));
});

await step("alerts: capped at 5 new per week, ranked by rupees", async () => {
  const r = await api("/api/notifications");
  assert.equal(r.status, 200);
  const week = Date.now() - 7 * 86400000;
  const recent = r.json.notifications.filter((n: any) => new Date(n.createdAt).getTime() >= week);
  assert.ok(recent.length <= 5, `got ${recent.length} alerts this week`);
  console.log(`       ${recent.length} alerts: ${recent.map((n: any) => `${n.type}(${n.impactRs ?? "-"})`).join(", ")}`);
});

await step("forecast: candidates and confidence", async () => {
  const r = await api("/api/forecast", { body: { horizon: 14 } });
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
  const f = r.json;
  assert.ok(f.candidates.length === 3, JSON.stringify(f.candidates));
  assert.equal(f.candidates.filter((c: any) => c.chosen).length, 1);
  assert.ok(["high", "medium", "low"].includes(f.confidence.level));
  console.log(`       model=${f.model} confidence=${f.confidence.level} candidates=${f.candidates.map((c: any) => `${c.name.split(" ")[0]}:${c.mae}`).join(" ")}`);
});

await step("purchase plan: reorder point, safety stock, slow movers", async () => {
  const r = await api("/api/inventory/plan");
  assert.equal(r.status, 200, JSON.stringify(r.json).slice(0, 200));
  assert.ok(r.json.lines.every((l: any) => typeof l.reorderPoint === "number" && l.leadTimeDays >= 1 && ["ok", "reorder_now", "stockout_before_delivery"].includes(l.risk)));
  assert.ok(Array.isArray(r.json.slowMovers));
  console.log(`       risks: ${r.json.lines.filter((l: any) => l.risk !== "ok").map((l: any) => `${l.name}:${l.risk}`).join(", ") || "none"}; slow movers cash=${r.json.cashTrapped}`);
});

await step("local services demo: unstocked services never show as dead stock", async () => {
  const load = await api("/api/demo", { body: { action: "load", category: "Local Services" } });
  assert.equal(load.status, 200, JSON.stringify(load.json).slice(0, 200));
  const plan = await api("/api/inventory/plan");
  assert.equal(plan.status, 200, JSON.stringify(plan.json).slice(0, 200));
  assert.equal(plan.json.cashTrapped, 0, `services are not stock, got ${plan.json.cashTrapped}`);
  assert.equal(plan.json.slowMovers.length, 0);
  assert.ok(plan.json.lines.every((l: any) => l.risk === "ok"));
  const imp = await api("/api/impact?limit=5");
  assert.equal(imp.status, 200);
  assert.ok(!imp.json.actions.some((a: any) => a.kind === "slow"), "no slow-stock action for services");
  assert.equal((await api("/api/cash")).status, 200);
  assert.equal((await api("/api/autopilot", { body: {} })).status, 200);
  // back to the Kirana demo for the page checks below
  assert.equal((await api("/api/demo", { body: { action: "load", category: "Kirana" } })).status, 200);
});

for (const path of ["/impact", "/cash", "/autopilot", "/customers", "/marketing", "/data", "/dashboard", "/forecast", "/inventory", "/assistant", "/notifications", "/settings", "/what-if", "/wa"]) {
  await step(`page ${path} renders`, async () => {
    const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}`, Cookie: `bizcopilot_token=${token}` } });
    assert.equal(res.status, 200, `${path} -> ${res.status}`);
    const html = await res.text();
    assert.ok(!/Application error|Internal Server Error/.test(html), `${path} shows an error`);
  });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
