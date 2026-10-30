export const CATEGORY_OPTIONS = [
  "Kirana",
  "Salon",
  "Bakery",
  "Restaurant",
  "Grocery Store",
  "Retail Store",
  "Clothing Store",
  "Local Services",
  "Other",
] as const;

/** Services are not stocked: the demo and imports mark them with 999 on hand and no minimum. Stock logic skips them. */
export const isUntracked = (stockQty: number, minStock: number): boolean => stockQty >= 999 && minStock === 0;

export const LANG_OPTIONS = [
  { id: "kn", label: "ಕನ್ನಡ", speech: "kn-IN" },
  { id: "hi", label: "हिंदी", speech: "hi-IN" },
  { id: "en", label: "English", speech: "en-IN" },
] as const;

export type Lang = (typeof LANG_OPTIONS)[number]["id"];

export const BUSINESS_SIZES = ["Micro (1-4)", "Small (5-20)", "Medium (21-100)", "Large (100+)"] as const;

/* ------------------------------ money ------------------------------ */

export function fmtCurrency(n: number | null | undefined, compact = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 0,
  }).format(n);
}

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
}

export function fmtPercent(n: number | null | undefined, signed = false): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const s = signed && n > 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}

/* ------------------------------ dates ------------------------------ */

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Inclusive list of ISO dates, oldest → newest, ending at today. */
export function lastNDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(todayISO(), -i));
  return out;
}

export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function monthLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function startOfMonthISO(): string {
  return `${todayISO().slice(0, 8)}01`;
}

export function previousMonthRange(): { from: string; to: string } {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const from = toISODate(prev);
  const to = toISODate(new Date(prev.getFullYear(), prev.getMonth() + 1, 0));
  return { from, to };
}

export function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

/* ------------------------- seeded randomness ------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
