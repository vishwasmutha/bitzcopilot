import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { actionLog, businesses, cashItems, customers } from "@/db/schema";
import { getAutopilot, type Level } from "./autopilot";
import { cashChanged } from "./cash";
import {
  COOLDOWN_DAYS,
  STAGE_LABEL,
  buildMessage,
  daysBetween,
  holdReason,
  planReminders,
  stageFor,
  whatsappLink,
  type History,
  type MsgLang,
  type OweItem,
  type Stage,
} from "./collections-math";
import { fmtCurrency, todayISO } from "./utils";

/* ------------------------------------------------------------------ */
/* The collections agent: gentle, rule-based chasing of credit that     */
/* customers owe the shop.                                              */
/* It only ever DRAFTS reminders. The owner sends them (WhatsApp link   */
/* or copy) and marks the result. Nothing is sent by the system.        */
/* ------------------------------------------------------------------ */

/** Rows of this kind are collection drafts. They have their own panel, not the autopilot log. */
export const COLLECTION_KIND = "collection_reminder";
const LANGS: MsgLang[] = ["en", "hi", "kn"];

type Payload = {
  itemId: string;
  party: string;
  amount: number;
  dueDate: string;
  daysOverdue: number;
  stage: Stage;
  messages?: Record<MsgLang, string>;
  phone?: string | null;
};

export type OverdueRow = {
  itemId: string;
  party: string;
  amount: number;
  dueDate: string;
  daysOverdue: number;
  stage: Stage;
  hasPhone: boolean;
  /** Why no new draft is being made right now, or null when one is due. */
  hold: string | null;
};

export type ReminderRow = {
  id: string;
  itemId: string;
  party: string;
  amount: number;
  daysOverdue: number;
  stage: Stage;
  stageLabel: string;
  status: "suggested" | "drafted" | "approved" | "received" | "dismissed";
  messages: Record<MsgLang, string> | null;
  waLinks: Record<MsgLang, string | null> | null;
  createdAt: string;
};

export type CollectionsView = {
  today: string;
  level: Level;
  overdueTotal: number;
  overdueCount: number;
  overdue: OverdueRow[];
  reminders: ReminderRow[];
  pending: number;
  recovered: { count: number; amount: number };
  cooldownDays: number;
};

function parse(json: string | null): Payload | null {
  try {
    return json ? (JSON.parse(json) as Payload) : null;
  } catch {
    return null;
  }
}

async function loadOwed(businessId: string): Promise<(OweItem & { status: string })[]> {
  const rows = await db
    .select()
    .from(cashItems)
    .where(and(eq(cashItems.businessId, businessId), eq(cashItems.kind, "receivable"), eq(cashItems.status, "open")));
  return rows.map((r) => ({ id: r.id, party: r.party, amount: r.amount, dueDate: r.dueDate, status: r.status }));
}

async function loadHistory(businessId: string): Promise<{ history: History[]; rows: (typeof actionLog.$inferSelect)[] }> {
  const rows = await db
    .select()
    .from(actionLog)
    .where(and(eq(actionLog.businessId, businessId), eq(actionLog.kind, COLLECTION_KIND)))
    .orderBy(desc(actionLog.createdAt));
  const history: History[] = [];
  for (const r of rows) {
    const p = parse(r.payloadJson);
    if (p) history.push({ itemId: p.itemId, stage: p.stage, at: r.createdAt.toISOString() });
  }
  return { history, rows };
}

/** Phone numbers for people who owe money, matched by name against the customer list. */
async function phonesFor(businessId: string, names: string[]): Promise<Map<string, string>> {
  if (!names.length) return new Map();
  const rows = await db
    .select({ name: customers.name, phone: customers.phone })
    .from(customers)
    .where(and(eq(customers.businessId, businessId), inArray(sql`lower(${customers.name})`, names.map((n) => n.toLowerCase()))));
  const out = new Map<string, string>();
  for (const r of rows) if (r.name && r.phone && !out.has(r.name.toLowerCase())) out.set(r.name.toLowerCase(), r.phone);
  return out;
}

/** A pending reminder whose money has since been collected is closed automatically. */
async function syncCollected(rows: (typeof actionLog.$inferSelect)[], open: Set<string>): Promise<void> {
  const stale = rows.filter((r) => {
    const p = parse(r.payloadJson);
    return p && ["suggested", "drafted", "approved"].includes(r.status) && !open.has(p.itemId);
  });
  if (!stale.length) return;
  await db
    .update(actionLog)
    .set({ status: "received", decidedAt: new Date() })
    .where(inArray(actionLog.id, stale.map((r) => r.id)));
  for (const r of stale) r.status = "received";
}

export async function getCollections(businessId: string): Promise<CollectionsView> {
  const today = todayISO();
  const [owed, { history, rows }, state] = await Promise.all([loadOwed(businessId), loadHistory(businessId), getAutopilot(businessId)]);
  await syncCollected(rows, new Set(owed.map((o) => o.id)));
  const phones = await phonesFor(businessId, owed.map((o) => o.party));

  const overdue: OverdueRow[] = owed
    .map((o) => ({ o, days: daysBetween(o.dueDate, today) }))
    .filter((x) => x.days >= 1)
    .map(({ o, days }) => ({
      itemId: o.id,
      party: o.party,
      amount: o.amount,
      dueDate: o.dueDate,
      daysOverdue: days,
      stage: stageFor(days) as Stage,
      hasPhone: phones.has(o.party.toLowerCase()),
      hold: holdReason(o, history, today),
    }))
    .sort((a, b) => b.amount * (1 + b.daysOverdue / 30) - a.amount * (1 + a.daysOverdue / 30));

  const reminders: ReminderRow[] = rows.slice(0, 30).flatMap((r) => {
    const p = parse(r.payloadJson);
    if (!p) return [];
    const waLinks = p.messages ? (Object.fromEntries(LANGS.map((l) => [l, whatsappLink(p.phone, p.messages![l])])) as Record<MsgLang, string | null>) : null;
    return [
      {
        id: r.id,
        itemId: p.itemId,
        party: p.party,
        amount: p.amount,
        daysOverdue: p.daysOverdue,
        stage: p.stage,
        stageLabel: STAGE_LABEL[p.stage],
        status: r.status as ReminderRow["status"],
        messages: p.messages ?? null,
        waLinks,
        createdAt: r.createdAt.toISOString(),
      },
    ];
  });

  const recoveredRows = rows.filter((r) => r.status === "received");
  const recoveredItems = new Set<string>();
  let recoveredAmount = 0;
  for (const r of recoveredRows) {
    const p = parse(r.payloadJson);
    if (p && !recoveredItems.has(p.itemId)) {
      recoveredItems.add(p.itemId);
      recoveredAmount += p.amount;
    }
  }

  return {
    today,
    level: state.level,
    overdueTotal: overdue.reduce((a, o) => a + o.amount, 0),
    overdueCount: overdue.length,
    overdue,
    reminders,
    pending: rows.filter((r) => r.status === "suggested" || r.status === "drafted").length,
    recovered: { count: recoveredItems.size, amount: recoveredAmount },
    cooldownDays: COOLDOWN_DAYS,
  };
}

/**
 * Drafts today's reminders. Idempotent: the same item and stage is never drafted twice.
 * At level 1 it only says who it would remind; from level 2 it prepares the message in all three languages.
 * Level 3 behaves like level 2, because customer messages are never sent automatically.
 */
export async function runCollections(businessId: string): Promise<{ drafted: number; overdueCount: number; overdueTotal: number }> {
  const today = todayISO();
  const [owed, { history }, state] = await Promise.all([loadOwed(businessId), loadHistory(businessId), getAutopilot(businessId)]);
  const [biz] = await db.select({ name: businesses.name, upiId: businesses.upiId }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const plan = planReminders(owed, history, today);
  const phones = await phonesFor(businessId, plan.map((p) => p.party));
  const prepare = state.level >= 2;

  let drafted = 0;
  for (const p of plan) {
    const item = owed.find((o) => o.id === p.itemId)!;
    const messages = prepare
      ? (Object.fromEntries(
          LANGS.map((l) => [l, buildMessage(l, { shop: biz?.name ?? "our shop", party: p.party, amount: p.amount, dueDate: item.dueDate, daysOverdue: p.daysOverdue, stage: p.stage, upi: biz?.upiId })])
        ) as Record<MsgLang, string>)
      : undefined;
    const payload: Payload = { itemId: p.itemId, party: p.party, amount: p.amount, dueDate: item.dueDate, daysOverdue: p.daysOverdue, stage: p.stage, messages, phone: phones.get(p.party.toLowerCase()) ?? null };
    const inserted = await db
      .insert(actionLog)
      .values({
        businessId,
        kind: COLLECTION_KIND,
        title: `Remind ${p.party} about ${fmtCurrency(p.amount)}`,
        detail: `${p.daysOverdue} day${p.daysOverdue === 1 ? "" : "s"} overdue · ${STAGE_LABEL[p.stage]}`,
        why: `Credit of ${fmtCurrency(p.amount)} was due on ${item.dueDate} and is ${p.daysOverdue} days overdue. Reminders are drafts you send yourself, one per stage and at least ${COOLDOWN_DAYS} days apart, so nobody is nagged.`,
        level: state.level,
        status: prepare ? "drafted" : "suggested",
        amount: p.amount,
        payloadJson: JSON.stringify(payload),
        dedupeKey: `collect:${p.itemId}:${p.stage}`,
      })
      .onConflictDoNothing()
      .returning({ id: actionLog.id });
    if (inserted.length) drafted++;
  }

  const overdue = owed.filter((o) => daysBetween(o.dueDate, today) >= 1);
  return { drafted, overdueCount: overdue.length, overdueTotal: overdue.reduce((a, o) => a + o.amount, 0) };
}

export type Decision = "sent" | "dismiss" | "collected";

/** The owner's follow-up: "I sent it", "Skip", or "They paid". */
export async function decideReminder(businessId: string, id: string, decision: Decision): Promise<{ ok: boolean; error?: string; code?: number }> {
  const [row] = await db
    .select()
    .from(actionLog)
    .where(and(eq(actionLog.id, id), eq(actionLog.businessId, businessId), eq(actionLog.kind, COLLECTION_KIND)))
    .limit(1);
  if (!row) return { ok: false, error: "Reminder not found.", code: 404 };
  const pending = row.status === "suggested" || row.status === "drafted";
  if (decision === "collected") {
    if (row.status === "received") return { ok: false, error: "Already marked as collected.", code: 409 };
    const p = parse(row.payloadJson);
    if (p) {
      await db.update(cashItems).set({ status: "settled" }).where(and(eq(cashItems.id, p.itemId), eq(cashItems.businessId, businessId)));
      cashChanged(businessId);
    }
    await db.update(actionLog).set({ status: "received", decidedAt: new Date() }).where(eq(actionLog.id, id));
    return { ok: true };
  }
  if (!pending) return { ok: false, error: `This reminder is already ${row.status === "approved" ? "marked as sent" : row.status}.`, code: 409 };
  await db
    .update(actionLog)
    .set({ status: decision === "sent" ? "approved" : "dismissed", decidedAt: new Date() })
    .where(eq(actionLog.id, id));
  return { ok: true };
}
