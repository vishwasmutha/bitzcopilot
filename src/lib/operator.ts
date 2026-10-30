import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { actionLog, businesses, notifications, waMessages } from "@/db/schema";
import { getAutopilot, runAutopilot } from "./autopilot";
import { runCollections } from "./collections";
import { ensureMorningBrief, istDateISO } from "./wa";
import { LANG_OPTIONS, type Lang } from "./utils";

/* ------------------------------------------------------------------ */
/* The daily operator.                                                  */
/* Once a day it checks the shop, logs what autopilot would do, writes  */
/* the morning brief in the owner's language and delivers it. It uses   */
/* the same deterministic code as the rest of the app. Nothing here     */
/* invents a figure, and it never messages customers.                   */
/* ------------------------------------------------------------------ */

/** Rows of this kind are the operator's own run records. They are not shown as owner actions. */
export const OPERATOR_KIND = "operator_run";

export type Delivery = {
  channel: "whatsapp" | "in-app";
  status: "sent" | "not_configured" | "no_phone" | "failed";
  note: string;
};

export type OperatorRun = {
  date: string;
  ranAt: string;
  alreadyRan: boolean;
  lang: Lang;
  newActions: number;
  /** Overdue credit and the reminders drafted today. Absent on runs stored before this existed. */
  collections?: { drafted: number; overdueCount: number; overdueTotal: number };
  actions: { title: string; atStake: number | null }[];
  brief: string;
  delivery: Delivery;
};

const LANGS = LANG_OPTIONS.map((l) => l.id) as string[];
const asLang = (v: unknown): Lang | null => (typeof v === "string" && LANGS.includes(v) ? (v as Lang) : null);

/** Sends the brief to the owner's own WhatsApp number. Needs a WhatsApp Business API account. */
async function deliver(phone: string | null, body: string): Promise<Delivery> {
  const token = process.env.WHATSAPP_TOKEN?.trim();
  const numberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!token || !numberId) {
    return { channel: "in-app", status: "not_configured", note: "Saved in the app. Add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID to also send it on WhatsApp." };
  }
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return { channel: "in-app", status: "no_phone", note: "Saved in the app. Add the owner's WhatsApp number to send it." };
  const to = digits.length === 10 ? `91${digits}` : digits;
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${numberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, 3800) } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      // Outside the 24 hour window WhatsApp only accepts approved templates, so a plain text can be refused.
      return { channel: "in-app", status: "failed", note: `WhatsApp refused the message (HTTP ${res.status}). The brief is saved in the app. A business-started message may need an approved template.` };
    }
    return { channel: "whatsapp", status: "sent", note: "Sent to the owner's WhatsApp." };
  } catch {
    return { channel: "in-app", status: "failed", note: "Could not reach WhatsApp. The brief is saved in the app." };
  }
}

async function ownerLang(businessId: string): Promise<Lang> {
  const [last] = await db
    .select({ lang: waMessages.lang })
    .from(waMessages)
    .where(eq(waMessages.businessId, businessId))
    .orderBy(desc(waMessages.createdAt))
    .limit(1);
  const [biz] = await db.select({ language: businesses.language }).from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return asLang(biz?.language) ?? asLang(last?.lang) ?? "en";
}

export async function getLastOperatorRun(businessId: string): Promise<OperatorRun | null> {
  const [row] = await db
    .select()
    .from(actionLog)
    .where(and(eq(actionLog.businessId, businessId), eq(actionLog.kind, OPERATOR_KIND)))
    .orderBy(desc(actionLog.createdAt))
    .limit(1);
  if (!row?.payloadJson) return null;
  try {
    return { ...(JSON.parse(row.payloadJson) as OperatorRun), alreadyRan: true };
  } catch {
    return null;
  }
}

/**
 * One business, one day. Safe to call repeatedly: a second call on the same day returns the first run
 * unless `force` is set (the "Run now" button).
 */
export async function runDailyOperator(businessId: string, opts: { force?: boolean; lang?: Lang } = {}): Promise<OperatorRun> {
  const date = istDateISO();
  const dedupeKey = `operator:${date}`;

  if (!opts.force) {
    const [existing] = await db
      .select()
      .from(actionLog)
      .where(and(eq(actionLog.businessId, businessId), eq(actionLog.dedupeKey, dedupeKey)))
      .limit(1);
    if (existing?.payloadJson) {
      try {
        return { ...(JSON.parse(existing.payloadJson) as OperatorRun), alreadyRan: true };
      } catch {
        // fall through and run again
      }
    }
  }

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!biz) throw new Error("Business not found");

  const lang = opts.lang ?? (await ownerLang(businessId));
  const [state, newActions] = await Promise.all([getAutopilot(businessId), runAutopilot(businessId)]);
  if (opts.force) {
    // "Run now" should reflect today's latest data, so drop today's stored brief and rebuild it.
    const briefs = await db.select().from(waMessages).where(and(eq(waMessages.businessId, businessId), eq(waMessages.kind, "brief")));
    for (const m of briefs) {
      try {
        if (JSON.parse(m.metaJson || "{}").date === date) await db.delete(waMessages).where(eq(waMessages.id, m.id));
      } catch {
        // leave unreadable rows alone
      }
    }
  }
  const collections = await runCollections(businessId);
  const brief = await ensureMorningBrief(businessId, lang);
  if (!brief) throw new Error("Could not build the brief");

  let actions: OperatorRun["actions"] = [];
  try {
    const meta = JSON.parse(brief.metaJson || "{}");
    actions = Array.isArray(meta.actions) ? meta.actions.map((a: { title: string; atStake?: number | null }) => ({ title: a.title, atStake: a.atStake ?? null })) : [];
  } catch {
    actions = [];
  }

  // An in-app notification, so the bell shows the brief is ready even if WhatsApp is not connected.
  const top = actions[0];
  await db
    .insert(notifications)
    .values({
      businessId,
      type: "daily_brief",
      severity: top?.atStake ? "warning" : "info",
      title: top ? "Today's brief is ready" : "Today's brief: nothing urgent",
      message: top ? top.title : "No drops, stock-outs or cash shortfalls were found in your data.",
      impactRs: top?.atStake ?? null,
      dedupeKey: `daily:${date}`,
    })
    .onConflictDoNothing();

  const delivery = await deliver(biz.phone, brief.body);
  const run: OperatorRun = { date, ranAt: new Date().toISOString(), alreadyRan: false, lang, newActions, collections, actions, brief: brief.body, delivery };

  const values = {
    businessId,
    kind: OPERATOR_KIND,
    title: `Daily check for ${date}`,
    detail: `${actions.length} priorit${actions.length === 1 ? "y" : "ies"} found, ${newActions} new autopilot item${newActions === 1 ? "" : "s"}, ${collections.drafted} payment reminder${collections.drafted === 1 ? "" : "s"} drafted. ${delivery.note}`,
    why: "Runs once a day: looks at sales, stock and cash, logs what autopilot would do, writes the brief and delivers it.",
    level: state.level,
    status: "logged",
    payloadJson: JSON.stringify(run),
    dedupeKey,
  };
  await db
    .insert(actionLog)
    .values(values)
    .onConflictDoUpdate({
      target: [actionLog.businessId, actionLog.dedupeKey],
      set: { detail: values.detail, payloadJson: values.payloadJson, createdAt: new Date() },
    });
  return run;
}

/** The scheduled entry point: every business, one failure never stops the rest. */
export async function runOperatorForAll(): Promise<{ businesses: number; ran: number; skipped: number; failed: number; errors: string[] }> {
  const all = await db.select({ id: businesses.id }).from(businesses);
  let ran = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const b of all) {
    try {
      const r = await runDailyOperator(b.id);
      if (r.alreadyRan) skipped++;
      else ran++;
    } catch (e) {
      failed++;
      errors.push(`${b.id}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return { businesses: all.length, ran, skipped, failed, errors };
}
