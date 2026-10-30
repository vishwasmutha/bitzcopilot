import "server-only";
import { getCustomerAnalytics, loadCustomers } from "./analytics";
import { todayISO } from "./utils";

export type SegmentSpec = {
  minOrders?: number;
  maxOrders?: number;
  boughtWithinDays?: number;
  notBoughtForDays?: number;
  minSpend?: number;
};

export type AudienceMember = {
  refId: string;
  name: string | null;
  phone: string | null;
  consent: boolean;
  orders: number;
  spent: number;
  recencyDays: number | null;
};

/** Segments that are people. "Local neighbourhood" is a public audience, so it has no member list. */
export const TARGETABLE = ["All customers", "Loyal customers", "At-risk customers", "Inactive customers", "New customers", "Custom segment"] as const;

export function cleanSpec(raw: unknown): SegmentSpec {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, max: number) => {
    const n = Number(v);
    return v === "" || v == null || !Number.isFinite(n) || n < 0 ? undefined : Math.min(max, Math.round(n));
  };
  const spec: SegmentSpec = {
    minOrders: num(o.minOrders, 1000),
    maxOrders: num(o.maxOrders, 1000),
    boughtWithinDays: num(o.boughtWithinDays, 3650),
    notBoughtForDays: num(o.notBoughtForDays, 3650),
    minSpend: num(o.minSpend, 100_000_000),
  };
  return Object.fromEntries(Object.entries(spec).filter(([, v]) => v !== undefined)) as SegmentSpec;
}

export function describeSpec(spec: SegmentSpec): string {
  const bits: string[] = [];
  if (spec.minOrders != null) bits.push(`${spec.minOrders}+ orders`);
  if (spec.maxOrders != null) bits.push(`at most ${spec.maxOrders} orders`);
  if (spec.boughtWithinDays != null) bits.push(`bought in the last ${spec.boughtWithinDays} days`);
  if (spec.notBoughtForDays != null) bits.push(`no purchase for ${spec.notBoughtForDays}+ days`);
  if (spec.minSpend != null) bits.push(`spent ₹${spec.minSpend}+`);
  return bits.length ? bits.join(", ") : "everyone";
}

export async function resolveAudience(businessId: string, segment: string, spec?: SegmentSpec): Promise<AudienceMember[]> {
  const today = Date.parse(`${todayISO()}T00:00:00Z`);
  const custs = await loadCustomers(businessId);
  const byRef = new Map(custs.map((c) => [c.refId, c]));
  const recency = (d: string | null) => (d ? Math.round((today - Date.parse(`${d}T00:00:00Z`)) / 86400000) : null);
  const toMember = (c: (typeof custs)[number]): AudienceMember => ({
    refId: c.refId,
    name: c.name,
    phone: c.phone,
    consent: c.marketingConsent,
    orders: c.orderCount,
    spent: c.totalSpent,
    recencyDays: recency(c.lastPurchaseAt),
  });

  if (segment === "All customers") return custs.map(toMember);

  if (segment === "Custom segment") {
    const s = spec ?? {};
    return custs.map(toMember).filter((m) => {
      if (s.minOrders != null && m.orders < s.minOrders) return false;
      if (s.maxOrders != null && m.orders > s.maxOrders) return false;
      if (s.boughtWithinDays != null && (m.recencyDays == null || m.recencyDays > s.boughtWithinDays)) return false;
      if (s.notBoughtForDays != null && m.recencyDays != null && m.recencyDays < s.notBoughtForDays) return false;
      if (s.minSpend != null && m.spent < s.minSpend) return false;
      return true;
    });
  }

  const analytics = await getCustomerAnalytics(businessId);
  const seg = analytics.segments.find((x) => x.name === segment);
  if (!seg) return [];
  return seg.members.map((m) => {
    const c = byRef.get(m.refId);
    return {
      refId: m.refId,
      name: m.name ?? c?.name ?? null,
      phone: c?.phone ?? null,
      consent: c?.marketingConsent ?? false,
      orders: m.orders,
      spent: m.spent,
      recencyDays: m.recencyDays,
    };
  });
}

export function consentSummary(members: AudienceMember[]): { total: number; consented: number; withPhone: number } {
  const ok = members.filter((m) => m.consent);
  return { total: members.length, consented: ok.length, withPhone: ok.filter((m) => !!m.phone).length };
}
