import "server-only";
import { db } from "@/db";
import { marketingCampaigns, promoAssignments, promoExperiments } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { loadSales } from "./analytics";
import { consentSummary, describeSpec, resolveAudience, type SegmentSpec } from "./audience";
import { analyzeExperiment, assignHoldout, type ExperimentResult, type Member } from "./engine-math";
import { addDays, fmtCurrency, todayISO } from "./utils";

export const MIN_AUDIENCE = 10;

export type ExperimentReport = {
  id: string;
  title: string;
  segment: string;
  productName: string | null;
  startedOn: string;
  windowDays: number;
  holdoutPct: number;
  messaged: number;
  heldBack: number;
  daysElapsed: number;
  result: ExperimentResult;
};

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * Start a tracked send: pick the consenting customers in a segment, hold a random
 * share back as a control group, and return only the people to message.
 */
export async function createExperiment(
  businessId: string,
  input: { campaignId?: string | null; title: string; segment: string; spec?: SegmentSpec; productName?: string | null; holdoutPct?: number; windowDays?: number }
): Promise<
  | { ok: true; experimentId: string; treatment: { refId: string; name: string | null; phone: string | null }[]; heldBack: number; excludedNoConsent: number; excludedNoPhone: number }
  | { ok: false; error: string }
> {
  const audience = await resolveAudience(businessId, input.segment, input.spec);
  const sum = consentSummary(audience);
  const consented = audience.filter((m) => m.consent);
  if (sum.total === 0) return { ok: false, error: "That segment has no customers yet." };
  if (consented.length < MIN_AUDIENCE) {
    return {
      ok: false,
      error: `Only ${consented.length} of ${sum.total} customers in this segment have given marketing consent. A fair test needs at least ${MIN_AUDIENCE}. Record consent on the Customers page first.`,
    };
  }
  const holdoutPct = Math.min(40, Math.max(10, Math.round(input.holdoutPct ?? 20)));
  const startedOn = todayISO();
  const [exp] = await db
    .insert(promoExperiments)
    .values({
      businessId,
      campaignId: input.campaignId ?? null,
      title: input.title.slice(0, 120),
      segment: input.segment === "Custom segment" ? `Custom: ${describeSpec(input.spec ?? {})}` : input.segment,
      productName: input.productName && input.productName !== "auto" ? input.productName : null,
      holdoutPct,
      windowDays: Math.min(30, Math.max(7, Math.round(input.windowDays ?? 14))),
      startedOn,
    })
    .returning();
  const { treatment, holdout } = assignHoldout(
    consented.map((m) => m.refId),
    holdoutPct,
    exp.id
  );
  await db.insert(promoAssignments).values([
    ...treatment.map((customerRef) => ({ experimentId: exp.id, businessId, customerRef, grp: "treatment" })),
    ...holdout.map((customerRef) => ({ experimentId: exp.id, businessId, customerRef, grp: "holdout" })),
  ]);
  if (input.campaignId) {
    await db
      .update(marketingCampaigns)
      .set({ status: "sent", approvedAt: new Date() })
      .where(and(eq(marketingCampaigns.id, input.campaignId), eq(marketingCampaigns.businessId, businessId)));
  }
  const byRef = new Map(consented.map((m) => [m.refId, m]));
  const people = treatment.map((r) => ({ refId: r, name: byRef.get(r)?.name ?? null, phone: byRef.get(r)?.phone ?? null }));
  return {
    ok: true,
    experimentId: exp.id,
    treatment: people,
    heldBack: holdout.length,
    excludedNoConsent: sum.total - sum.consented,
    excludedNoPhone: people.filter((p) => !p.phone).length,
  };
}

/** Remove a test the owner started by mistake. Its campaign stays; only the group assignments and the test itself go. */
export async function deleteExperiment(businessId: string, id: string): Promise<boolean> {
  const own = await db.select({ id: promoExperiments.id }).from(promoExperiments).where(and(eq(promoExperiments.id, id), eq(promoExperiments.businessId, businessId))).limit(1);
  if (!own.length) return false;
  await db.delete(promoAssignments).where(and(eq(promoAssignments.experimentId, id), eq(promoAssignments.businessId, businessId)));
  await db.delete(promoExperiments).where(and(eq(promoExperiments.id, id), eq(promoExperiments.businessId, businessId)));
  return true;
}

export async function getExperiments(businessId: string, limit = 6): Promise<ExperimentReport[]> {
  const exps = await db.select().from(promoExperiments).where(eq(promoExperiments.businessId, businessId)).orderBy(desc(promoExperiments.startedOn)).limit(limit);
  if (!exps.length) return [];
  const assigns = await db
    .select()
    .from(promoAssignments)
    .where(
      and(
        eq(promoAssignments.businessId, businessId),
        inArray(
          promoAssignments.experimentId,
          exps.map((e) => e.id)
        )
      )
    );
  const earliest = exps.reduce((m, e) => (e.startedOn < m ? e.startedOn : m), exps[0].startedOn);
  const sales = await loadSales(businessId, addDays(earliest, 1));
  const today = todayISO();

  return exps.map((e) => {
    const mine = assigns.filter((a) => a.experimentId === e.id);
    const from = addDays(e.startedOn, 1);
    const to = addDays(e.startedOn, e.windowDays);
    const per = new Map<string, { dates: Set<string>; revenue: number }>();
    for (const s of sales) {
      if (!s.customerId || s.saleDate < from || s.saleDate > to) continue;
      const p = per.get(s.customerId) ?? { dates: new Set<string>(), revenue: 0 };
      p.dates.add(s.saleDate);
      p.revenue += s.totalAmount;
      per.set(s.customerId, p);
    }
    const member = (ref: string): Member => {
      const p = per.get(ref);
      return { orders: p ? p.dates.size : 0, revenue: p ? p.revenue : 0 };
    };
    const T = mine.filter((a) => a.grp === "treatment").map((a) => member(a.customerRef));
    const H = mine.filter((a) => a.grp === "holdout").map((a) => member(a.customerRef));
    const daysElapsed = Math.min(e.windowDays, Math.max(0, daysBetween(e.startedOn, today)));
    return {
      id: e.id,
      title: e.title,
      segment: e.segment,
      productName: e.productName,
      startedOn: e.startedOn,
      windowDays: e.windowDays,
      holdoutPct: e.holdoutPct,
      messaged: T.length,
      heldBack: H.length,
      daysElapsed,
      result: analyzeExperiment({ treatment: T, holdout: H, daysElapsed, windowDays: e.windowDays, fmt: (n) => fmtCurrency(n) }),
    };
  });
}
