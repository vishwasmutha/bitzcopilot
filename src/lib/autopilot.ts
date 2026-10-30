import "server-only";
import { db } from "@/db";
import { actionLog, businesses, inventoryTransactions, products } from "@/db/schema";
import { and, desc, eq, gte, notInArray, sql } from "drizzle-orm";
import { getCashOutlook } from "./cash";
import { resolveAudience, consentSummary } from "./audience";
import { buildPurchasePlan } from "./reorder";
import { getDropReport } from "./impact";
import { fmtCurrency, todayISO } from "./utils";

export type Level = 1 | 2 | 3;

export const LEVELS: { level: Level; name: string; blurb: string }[] = [
  { level: 1, name: "Suggest only", blurb: "BizCopilot tells you what it would do. Nothing is prepared." },
  { level: 2, name: "Draft and wait", blurb: "It prepares purchase orders and message drafts. Nothing happens until you approve." },
  { level: 3, name: "Act within a budget", blurb: "It approves purchase orders on its own up to your weekly budget. Messages to customers are never sent automatically." },
];

export type AutopilotState = { level: Level; budget: number; spentThisWeek: number; remaining: number };

const asLevel = (n: number): Level => (n === 1 || n === 3 ? n : 2);

export async function getAutopilot(businessId: string): Promise<AutopilotState> {
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const rows = await db
    .select({ amount: actionLog.amount })
    .from(actionLog)
    .where(and(eq(actionLog.businessId, businessId), eq(actionLog.status, "auto_approved"), gte(actionLog.createdAt, weekAgo)));
  const spent = rows.reduce((a, r) => a + (r.amount ?? 0), 0);
  const budget = biz?.autopilotBudget ?? 0;
  return { level: asLevel(biz?.autopilotLevel ?? 2), budget, spentThisWeek: spent, remaining: Math.max(0, budget - spent) };
}

export async function setAutopilot(businessId: string, level: number, budget: number): Promise<void> {
  await db
    .update(businesses)
    .set({ autopilotLevel: asLevel(level), autopilotBudget: Math.max(0, Math.min(10_000_000, Math.round(budget))) })
    .where(eq(businesses.id, businessId));
}

export type LogRow = {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  why: string | null;
  level: number;
  status: string;
  amount: number | null;
  payload: { lines?: { name: string; qty: number; cashOut: number }[]; segment?: string; product?: string } | null;
  createdAt: string;
  decidedAt: string | null;
};

export async function listActionLog(businessId: string, limit = 30): Promise<LogRow[]> {
  const rows = await db.select().from(actionLog).where(and(eq(actionLog.businessId, businessId), notInArray(actionLog.kind, ["operator_run", "collection_reminder"]))).orderBy(desc(actionLog.createdAt)).limit(limit);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    detail: r.detail,
    why: r.why,
    level: r.level,
    status: r.status,
    amount: r.amount,
    payload: r.payloadJson ? safeParse(r.payloadJson) : null,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  }));
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function record(
  businessId: string,
  level: Level,
  row: { kind: string; title: string; detail: string; why: string; status: string; amount?: number | null; payload?: unknown; dedupeKey: string }
): Promise<boolean> {
  const rows = await db
    .insert(actionLog)
    .values({
      businessId,
      kind: row.kind,
      title: row.title,
      detail: row.detail,
      why: row.why,
      level,
      status: row.status,
      amount: row.amount ?? null,
      payloadJson: row.payload ? JSON.stringify(row.payload) : null,
      dedupeKey: row.dedupeKey,
      decidedAt: row.status === "auto_approved" ? new Date() : null,
    })
    .onConflictDoNothing()
    .returning({ id: actionLog.id });
  return rows.length > 0;
}

/**
 * Looks at the shop and logs what it would do, at the level the owner chose.
 * Idempotent per day: running it twice creates nothing new.
 */
export async function runAutopilot(businessId: string): Promise<number> {
  const state = await getAutopilot(businessId);
  const today = todayISO();
  const week = `${today.slice(0, 8)}${Math.floor(Number(today.slice(8)) / 7)}`;
  let created = 0;
  const draftStatus = state.level === 1 ? "suggested" : "drafted";

  // 1. Purchase order from the reorder-point plan (measured demand only, no festival prior)
  const plan = await buildPurchasePlan(businessId, false);
  if (plan.status === "computed") {
    const urgent = plan.lines.filter((l) => l.funded && l.orderQty > 0 && (l.risk !== "ok" || (l.daysCover ?? 99) < 7));
    if (urgent.length) {
      const total = urgent.reduce((a, l) => a + l.cashOut, 0);
      const cash = await getCashOutlook(businessId);
      const tight = cash.projection.status === "ok" && cash.projection.crunch?.likelihood === "likely" && cash.projection.crunch.weeksAhead <= 3;
      let status = draftStatus;
      let hold = "";
      if (state.level === 3) {
        if (tight) hold = " Held for your approval because the cash outlook shows a likely shortfall within 3 weeks.";
        else if (total > state.remaining) hold = ` Held for your approval because it is above your remaining weekly budget of ${fmtCurrency(state.remaining)}.`;
        else status = "auto_approved";
      }
      const ok = await record(businessId, state.level, {
        kind: "purchase_order",
        title: `Reorder ${urgent.length} item${urgent.length === 1 ? "" : "s"} for ${fmtCurrency(total)}`,
        detail: urgent.map((l) => `${l.orderQty} x ${l.name}`).join(", "),
        why: `Each item is at or under its reorder point (average daily demand x lead time + safety stock), or cannot last until delivery. Quantities cover 14 days plus safety stock, rounded up to the supplier minimum.${hold}`,
        status,
        amount: total,
        payload: { lines: urgent.map((l) => ({ name: l.name, qty: l.orderQty, cashOut: l.cashOut })) },
        dedupeKey: `po:${today}`,
      });
      if (ok) created++;
    }
  }

  // 2. Win-back draft for lapsing regulars who agreed to hear from the shop. Never sent by the system.
  const atRisk = await resolveAudience(businessId, "At-risk customers");
  const sum = consentSummary(atRisk);
  if (sum.consented >= 1) {
    const ok = await record(businessId, state.level, {
      kind: "winback_draft",
      title: `Win-back message for ${sum.consented} regular${sum.consented === 1 ? "" : "s"}`,
      detail: `${sum.consented} of ${sum.total} at-risk customers have given consent to be messaged.`,
      why: "At-risk customers used to buy often and have gone quiet. Only customers with recorded consent are included. You send the message yourself, and a share is held back so the result can be measured.",
      status: draftStatus,
      payload: { segment: "At-risk customers" },
      dedupeKey: `winback:${week}`,
    });
    if (ok) created++;
  }

  // 3. Promo draft for whatever is dragging sales down this week
  const drop = await getDropReport(businessId);
  if (drop.status === "ok" && drop.dropDetected && drop.drivers[0]) {
    const d = drop.drivers[0];
    const ok = await record(businessId, state.level, {
      kind: "promo_draft",
      title: `Promo for ${d.product}`,
      detail: `${d.product} sold ${fmtCurrency(Math.abs(d.delta))} under a normal week.`,
      why: `Sales are ${Math.abs(Math.round(drop.pct ?? 0))}% under normal and ${d.product} explains ${Math.round(d.share)}% of the gap. The offer is capped so the margin stays safe.`,
      status: draftStatus,
      amount: Math.abs(d.delta),
      payload: { product: d.product },
      dedupeKey: `promo:${week}:${d.product}`,
    });
    if (ok) created++;
  }

  // 4. Cash warning: information only, at every level
  const cash = await getCashOutlook(businessId);
  if (cash.projection.status === "ok" && cash.projection.crunch) {
    const c = cash.projection.crunch;
    const ok = await record(businessId, state.level, {
      kind: "cash_warning",
      title: `Cash may run short around ${c.date}`,
      detail: `${c.likelihood === "likely" ? "Expected" : "Possible"} shortfall of ${fmtCurrency(c.shortfall)}, about ${c.weeksAhead} week${c.weeksAhead === 1 ? "" : "s"} ahead.`,
      why: "Forecast sales, credit you are owed, supplier dues and rent rolled forward day by day from today's cash.",
      status: "suggested",
      amount: c.shortfall,
      dedupeKey: `cash:${week}`,
    });
    if (ok) created++;
  }
  return created;
}

export async function decideAction(businessId: string, id: string, decision: "approve" | "dismiss" | "received"): Promise<{ ok: boolean; error?: string }> {
  const [row] = await db.select().from(actionLog).where(and(eq(actionLog.id, id), eq(actionLog.businessId, businessId))).limit(1);
  if (!row) return { ok: false, error: "Not found." };
  if (decision === "dismiss") {
    if (row.status === "received") return { ok: false, error: "Already received." };
    await db.update(actionLog).set({ status: "dismissed", decidedAt: new Date() }).where(eq(actionLog.id, id));
    return { ok: true };
  }
  if (decision === "approve") {
    if (!["suggested", "drafted"].includes(row.status)) return { ok: false, error: "That item is already decided." };
    await db.update(actionLog).set({ status: "approved", decidedAt: new Date() }).where(eq(actionLog.id, id));
    return { ok: true };
  }
  // received: add the delivered stock
  if (row.kind !== "purchase_order" || !["approved", "auto_approved"].includes(row.status)) return { ok: false, error: "Only an approved purchase order can be marked received." };
  const payload = row.payloadJson ? safeParse(row.payloadJson) : null;
  const lines: { name: string; qty: number }[] = payload?.lines ?? [];
  await db.transaction(async (tx) => {
    for (const l of lines) {
      const [p] = await tx.select().from(products).where(and(eq(products.businessId, businessId), eq(products.name, l.name))).limit(1);
      if (!p) continue;
      await tx.update(products).set({ stockQty: sql`${products.stockQty} + ${l.qty}`, lastRestockedAt: new Date(), updatedAt: new Date() }).where(eq(products.id, p.id));
      await tx.insert(inventoryTransactions).values({ businessId, productId: p.id, type: "restock", qtyChange: l.qty, note: "Purchase order received" });
    }
    await tx.update(actionLog).set({ status: "received", decidedAt: new Date() }).where(eq(actionLog.id, id));
  });
  return { ok: true };
}
