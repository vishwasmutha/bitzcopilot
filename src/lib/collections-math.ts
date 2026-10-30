/* ------------------------------------------------------------------ */
/* Collections: pure rules for chasing money customers owe the shop.   */
/* No imports, so it can be tested on its own.                          */
/*                                                                      */
/* Principles: a reminder is a draft the owner sends, never something   */
/* the system sends. Tone gets firmer with age but stays polite. Each   */
/* customer gets at most one draft per stage and a quiet gap between    */
/* drafts, so nobody is nagged.                                         */
/* ------------------------------------------------------------------ */

export type Stage = 1 | 2 | 3;
export type MsgLang = "en" | "hi" | "kn";

export const COOLDOWN_DAYS = 5;
export const MIN_AMOUNT = 50;
export const MAX_PER_RUN = 5;

export type OweItem = { id: string; party: string; amount: number; dueDate: string };
export type History = { itemId: string; stage: number; at: string };

export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.UTC(Number(fromISO.slice(0, 4)), Number(fromISO.slice(5, 7)) - 1, Number(fromISO.slice(8, 10)));
  const b = Date.UTC(Number(toISO.slice(0, 4)), Number(toISO.slice(5, 7)) - 1, Number(toISO.slice(8, 10)));
  return Math.round((b - a) / 86400000);
}

/** 0 = not overdue yet. 1 = friendly nudge, 2 = clear request, 3 = firm but polite. */
export function stageFor(daysOverdue: number): 0 | Stage {
  if (daysOverdue < 1) return 0;
  if (daysOverdue <= 7) return 1;
  if (daysOverdue <= 21) return 2;
  return 3;
}

export type Planned = { itemId: string; party: string; amount: number; daysOverdue: number; stage: Stage; priority: number };

/**
 * Which reminders to draft today. Rules:
 *  - only items that are overdue and at least MIN_AMOUNT
 *  - one draft per item per stage (a dismissed draft counts, so it is not re-drafted)
 *  - COOLDOWN_DAYS between drafts for the same item
 *  - biggest and oldest first, at most MAX_PER_RUN per run
 */
export function planReminders(
  items: OweItem[],
  history: History[],
  today: string,
  opts: { cooldownDays?: number; minAmount?: number; maxPerRun?: number } = {}
): Planned[] {
  const cooldown = opts.cooldownDays ?? COOLDOWN_DAYS;
  const min = opts.minAmount ?? MIN_AMOUNT;
  const cap = opts.maxPerRun ?? MAX_PER_RUN;
  const out: Planned[] = [];
  for (const it of items) {
    if (!(it.amount >= min)) continue;
    const daysOverdue = daysBetween(it.dueDate, today);
    const stage = stageFor(daysOverdue);
    if (stage === 0) continue;
    const mine = history.filter((h) => h.itemId === it.id);
    if (mine.some((h) => h.stage === stage)) continue;
    const last = mine.reduce<string | null>((m, h) => (m == null || h.at > m ? h.at : m), null);
    if (last && daysBetween(last.slice(0, 10), today) < cooldown) continue;
    out.push({ itemId: it.id, party: it.party, amount: it.amount, daysOverdue, stage, priority: it.amount * (1 + daysOverdue / 30) });
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, cap);
}

/** Why an overdue item is not getting a new draft right now. */
export function holdReason(item: OweItem, history: History[], today: string, cooldownDays = COOLDOWN_DAYS): string | null {
  const daysOverdue = daysBetween(item.dueDate, today);
  const stage = stageFor(daysOverdue);
  if (stage === 0) return "Not overdue yet";
  if (item.amount < MIN_AMOUNT) return "Amount is too small to chase";
  const mine = history.filter((h) => h.itemId === item.id);
  if (mine.some((h) => h.stage === stage)) return "Reminder already drafted for this stage";
  const last = mine.reduce<string | null>((m, h) => (m == null || h.at > m ? h.at : m), null);
  if (last && daysBetween(last.slice(0, 10), today) < cooldownDays) return `Waiting ${cooldownDays} days between reminders`;
  return null;
}

/* ------------------------------ wording ------------------------------ */

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const shortDate = (iso: string, lang: MsgLang) => {
  const [y, m, d] = iso.split("-").map(Number);
  const en = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  void y;
  return lang === "en" ? `${d} ${en[m - 1]}` : `${d}/${m}`;
};

export type MsgInput = { shop: string; party: string; amount: number; dueDate: string; daysOverdue: number; stage: Stage; upi?: string | null };

/** Polite, never threatening. Mentions only the shop, the amount and the date. */
export function buildMessage(lang: MsgLang, m: MsgInput): string {
  const amt = rupees(m.amount);
  const date = shortDate(m.dueDate, lang);
  const n = m.daysOverdue;
  const upi = m.upi?.trim() ? m.upi.trim() : null;
  if (lang === "hi") {
    const pay = upi ? ` UPI: ${upi}` : "";
    if (m.stage === 1) return `नमस्ते ${m.party} जी, ${m.shop} का ${amt} ${date} को देना था। जब सुविधा हो, कृपया चुका दें।${pay} धन्यवाद!`;
    if (m.stage === 2) return `नमस्ते ${m.party} जी, ${m.shop} का ${amt} ${date} से बाकी है (${n} दिन)। कृपया इस हफ़्ते चुका दीजिए।${pay}`;
    return `नमस्ते ${m.party} जी, ${m.shop} का ${amt} अब भी बाकी है (${date} से)। कृपया बताइए कब तक दे पाएँगे, या कोई दिक्कत हो तो हमें बताइए ताकि मिलकर हल कर सकें।${pay}`;
  }
  if (lang === "kn") {
    const pay = upi ? ` UPI: ${upi}` : "";
    if (m.stage === 1) return `ನಮಸ್ಕಾರ ${m.party}, ${m.shop} ನಲ್ಲಿ ${amt} ${date} ರಂದು ಪಾವತಿಸಬೇಕಿತ್ತು. ಅನುಕೂಲವಾದಾಗ ದಯವಿಟ್ಟು ಪಾವತಿಸಿ.${pay} ಧನ್ಯವಾದಗಳು!`;
    if (m.stage === 2) return `ನಮಸ್ಕಾರ ${m.party}, ${m.shop} ನ ${amt} ${date} ರಿಂದ ಬಾಕಿ ಇದೆ (${n} ದಿನ). ದಯವಿಟ್ಟು ಈ ವಾರ ಪಾವತಿಸಿ.${pay}`;
    return `ನಮಸ್ಕಾರ ${m.party}, ${m.shop} ನ ${amt} ಇನ್ನೂ ಬಾಕಿ ಇದೆ (${date} ರಿಂದ). ಯಾವಾಗ ಕೊಡಲು ಸಾಧ್ಯ ಎಂದು ತಿಳಿಸಿ, ಅಥವಾ ತೊಂದರೆ ಇದ್ದರೆ ಹೇಳಿ, ಒಟ್ಟಿಗೆ ಬಗೆಹರಿಸೋಣ.${pay}`;
  }
  const pay = upi ? ` You can pay by UPI: ${upi}.` : "";
  if (m.stage === 1) return `Hello ${m.party}, a small reminder: ${amt} for purchases at ${m.shop} was due on ${date}. Whenever convenient, please settle it.${pay} Thank you!`;
  if (m.stage === 2) return `Hello ${m.party}, ${amt} at ${m.shop} has been pending since ${date} (${n} days). Could you please clear it this week?${pay}`;
  return `Hello ${m.party}, ${amt} at ${m.shop} is still pending since ${date}. Please let us know when you can pay, or if there is any problem, so we can sort it out together.${pay}`;
}

export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const to = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

export const STAGE_LABEL: Record<Stage, string> = { 1: "Friendly nudge", 2: "Clear request", 3: "Firm, polite" };
