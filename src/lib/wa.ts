import "server-only";
import { db } from "@/db";
import { businesses, marketingCampaigns, products as productsTable, waMessages } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { loadProducts, loadSales, getOverview, getProductPerformance } from "./analytics";
import { simulateWhatIf, parseWhatIf } from "./whatif";
import { addDays, fmtCurrency, todayISO, type Lang } from "./utils";
import { maxSafeDiscount } from "./impact-math";
import { describeCrunch, getCashOutlook } from "./cash";

export type WaLang = Lang;

/** The offer the owner wants, lowered if it would leave under 10% margin on this product. */
export async function safeDiscount(businessId: string, product: string, wanted: number): Promise<number> {
  const rows = await db.select().from(productsTable).where(and(eq(productsTable.businessId, businessId), eq(productsTable.name, product))).limit(1);
  const p = rows[0];
  if (!p || !(p.sellingPrice > 0)) return wanted;
  return Math.min(wanted, maxSafeDiscount(p.sellingPrice, p.unitCost));
}

export function istDateISO(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function nineAmIst(dateISO: string): Date {
  return new Date(`${dateISO}T03:30:00.000Z`);
}

export function inr(n: number): string {
  return fmtCurrency(n);
}

type Runway = { name: string; stock: number; daily: number; days: number };

export async function stockRunway(businessId: string): Promise<Runway[]> {
  const today = todayISO();
  const [products, sales] = await Promise.all([loadProducts(businessId), loadSales(businessId, addDays(today, -13), today)]);
  const qty = new Map<string, number>();
  for (const s of sales) qty.set(s.productName, (qty.get(s.productName) ?? 0) + s.quantity);
  return products
    .map((p) => {
      const daily = (qty.get(p.name) ?? 0) / 14;
      return {
        name: p.name,
        stock: p.stockQty,
        daily: Math.round(daily * 10) / 10,
        days: daily > 0.15 ? p.stockQty / daily : 999,
      };
    })
    .filter((p) => p.daily > 0.15)
    .sort((a, b) => a.days - b.days);
}

export async function weekdayDip(businessId: string): Promise<{ weekdayAvg: number; weekendAvg: number; downPct: number | null }> {
  const sales = await loadSales(businessId, addDays(todayISO(), -27));
  const byDate = new Map<string, number>();
  for (const s of sales) byDate.set(s.saleDate, (byDate.get(s.saleDate) ?? 0) + s.totalAmount);
  let wk = 0, wkN = 0, we = 0, weN = 0;
  for (const [date, rev] of byDate) {
    const dow = new Date(`${date}T00:00:00`).getDay();
    if (dow === 0 || dow === 6) {
      we += rev;
      weN++;
    } else {
      wk += rev;
      wkN++;
    }
  }
  const weekdayAvg = wkN ? wk / wkN : 0;
  const weekendAvg = weN ? we / weN : 0;
  const downPct = weekendAvg > 0 ? ((weekendAvg - weekdayAvg) / weekendAvg) * 100 : null;
  return { weekdayAvg, weekendAvg, downPct };
}

function shortName(name: string): string {
  return name.replace(/\s+\d.*$/, "").replace(/\s+\(.*$/, "");
}

export function briefCopy(lang: WaLang, shop: string, item: Runway | null, downPct: number | null): string {
  const days = item ? Math.max(1, Math.round(item.days)) : null;
  const itemLabel = item ? shortName(item.name) : null;
  const dip = downPct != null && downPct >= 5 ? Math.round(downPct) : null;
  if (lang === "hi") {
    const stock = itemLabel ? `*${itemLabel}* ${days} दिन में खत्म हो जाएगा।` : "स्टॉक अभी ठीक है।";
    const wd = dip != null ? `वीकडे की बिक्री वीकेंड से ${dip}% कम है।` : "वीकडे की बिक्री स्थिर है।";
    return `सुबह 9 बजे · ${shop}\n${stock}\n${wd}\n\nप्रमो ड्राफ्ट नीचे है। भेजने से पहले एक टैप में मंज़ूरी दें — बिना मंज़ूरी कुछ नहीं जाता।`;
  }
  if (lang === "kn") {
    const stock = itemLabel ? `*${itemLabel}* ${days} ದಿನದಲ್ಲಿ ಮುಗಿಯುತ್ತದೆ.` : "ಸ್ಟಾಕ್ ಈಗ ಸರಿಯಾಗಿದೆ.";
    const wd = dip != null ? `ವಾರದ ದಿನಗಳ ಮಾರಾಟ ವೀಕೆಂಡ್‌ಗಿಂತ ${dip}% ಕಡಿಮೆ.` : "ವಾರದ ದಿನಗಳ ಮಾರಾಟ ಸ್ಥಿರವಾಗಿದೆ.";
    return `ಬೆಳಿಗ್ಗೆ 9 · ${shop}\n${stock}\n${wd}\n\nಕೆಳಗೆ ಪ್ರಚಾರದ ಡ್ರಾಫ್ಟ್ ಇದೆ. ಕಳುಹಿಸುವ ಮುನ್ನ ಒಂದು ಟ್ಯಾಪ್‌ನಲ್ಲಿ ಅನುಮೋದಿಸಿ — ಅನುಮೋದನೆ ಇಲ್ಲದೆ ಏನೂ ಹೋಗುವುದಿಲ್ಲ.`;
  }
  const stock = itemLabel ? `*${itemLabel}* will run out in ${days} day${days === 1 ? "" : "s"}.` : "Stock looks fine right now.";
  const wd = dip != null ? `Weekday sales are down ${dip}% versus weekends.` : "Weekday sales are holding steady.";
  return `9:00 AM · ${shop}\n${stock}\n${wd}\n\nPromo draft is below. One tap approves it — nothing goes out without that tap.`;
}

export function promoCopy(lang: WaLang, shop: string, product: string, discount = 10): string {
  const item = shortName(product);
  if (discount <= 0) {
    if (lang === "hi") return `${shop}: ${item} आज स्टॉक में है। आइए, हम आपके लिए एक रख देंगे।`;
    if (lang === "kn") return `${shop}: ${item} ಇಂದು ಸ್ಟಾಕ್‌ನಲ್ಲಿದೆ. ಬನ್ನಿ, ನಿಮಗಾಗಿ ಒಂದು ಇಟ್ಟುಕೊಳ್ಳುತ್ತೇವೆ.`;
    return `${shop}: ${item} is in stock today. Come in and we'll keep one aside.`;
  }
  if (lang === "hi") return `${shop}: आज ${item} पर ${discount}% छूट। स्टॉक खत्म होने से पहले आ जाइए। जवाब दें, हम रख देंगे।`;
  if (lang === "kn") return `${shop}: ಇಂದು ${item} ಮೇಲೆ ${discount}% ರಿಯಾಯಿತಿ. ಸ್ಟಾಕ್ ಮುಗಿಯುವ ಮುನ್ನ ಬನ್ನಿ. ಉತ್ತರಿಸಿ, ನಾವು ಇಟ್ಟುಕೊಳ್ಳುತ್ತೇವೆ.`;
  return `${shop}: ${discount}% off ${item} today. Come in before we run out. Reply and we'll keep one aside.`;
}

type Intent = "revenue" | "stock" | "decline" | "customers" | "promo" | "forecast" | "top" | "help" | "cash";

export function detectWaIntent(q: string): Intent {
  const s = q.toLowerCase();
  if (/\bcash\b|money|afford|नकद|पैसे|पैसा|ನಗದು|ಹಣ/.test(s)) return "cash";
  if (/restock|stock|run out|inventory|rice|अक्क|चावल|खत्म|स्टॉक|माल|ಅಕ್ಕಿ|ಸ್ಟಾಕ್|ಮುಗಿ|ಸರಕು/.test(s)) return "stock";
  if (/declin|why.*down|drop|गिरा|कम क्यों|क्यों.*कम|ಏಕೆ|ಇಳಿಕೆ|ಕಡಿಮೆ/.test(s)) return "decline";
  if (/customer|ग्राहक|कस्टमर|ಗ್ರಾಹಕ/.test(s)) return "customers";
  if (/promo|offer|campaign|whatsapp|मैसेज|ऑफर|प्रमो|ಆಫರ್|ಪ್ರಚಾರ|ಮೆಸೇಜ್/.test(s)) return "promo";
  if (/forecast|next week|predict|अगले|पूर्वानुमान|ಮುಂದಿನ|ಅಂದಾಜು/.test(s)) return "forecast";
  if (/best|top|highest|सबसे|टॉप|ಅತಿ|ಟಾಪ್/.test(s)) return "top";
  if (/revenue|sales|कमाई|बिक्री|रेवेन्यू|ಮಾರಾಟ|ಆದಾಯ|ಎಷ್ಟು/.test(s)) return "revenue";
  if (/[अ-ह]|[ಀ-೿]/.test(q)) return "help";
  return "revenue";
}

export async function answerWa(businessId: string, shop: string, question: string, lang: WaLang): Promise<{ text: string; promo: { title: string; content: string; product: string } | null; receipt?: unknown }> {
  if (parseWhatIf(question).kind !== "unknown") {
    const sim = await simulateWhatIf(businessId, question, lang);
    return { text: sim.summary, promo: null, receipt: sim.receipt };
  }
  const intent = detectWaIntent(question);
  const [overview, perf, runway, dip] = await Promise.all([
    getOverview(businessId),
    getProductPerformance(businessId, 30),
    stockRunway(businessId),
    weekdayDip(businessId),
  ]);
  const tight = runway.find((r) => r.days <= 10) ?? runway[0] ?? null;
  const top = perf[0];
  const promoFor = tight && tight.days <= 14 ? tight.name : top?.name;
  const promoOffer = promoFor ? await safeDiscount(businessId, promoFor, 10) : 0;
  const promo = promoFor
    ? { title: `WhatsApp promo — ${shortName(promoFor)}`, content: promoCopy(lang, shop, promoFor, promoOffer), product: promoFor }
    : null;

  if (!overview.hasData) {
    const text =
      lang === "hi"
        ? "अभी बिक्री का डेटा नहीं है। डेमो दुकान खोलें या Data पेज से फाइल डालें — मैं नंबर नहीं गढ़ता।"
        : lang === "kn"
          ? "ಇನ್ನೂ ಮಾರಾಟದ ಡೇಟಾ ಇಲ್ಲ. ಡೆಮೋ ಅಂಗಡಿ ತೆರೆಯಿರಿ ಅಥವಾ ಫೈಲ್ ಹಾಕಿ — ನಾನು ಸಂಖ್ಯೆಗಳನ್ನು ಕಲ್ಪಿಸುವುದಿಲ್ಲ."
          : "No sales data yet. Open the demo shop or import a file — I won't invent numbers.";
    return { text, promo: null };
  }

  const dipTxt =
    dip.downPct != null && dip.downPct >= 5
      ? lang === "hi"
        ? `वीकडे वीकेंड से ${Math.round(dip.downPct)}% कम है।`
        : lang === "kn"
          ? `ವಾರದ ದಿನಗಳು ವೀಕೆಂಡ್‌ಗಿಂತ ${Math.round(dip.downPct)}% ಕಡಿಮೆ.`
          : `Weekdays are down ${Math.round(dip.downPct)}% vs weekends.`
      : "";

  let text = "";
  if (intent === "stock" || intent === "help") {
    if (!tight) text = lang === "kn" ? "ಸ್ಟಾಕ್ ಡೇಟಾ ಇನ್ನೂ ಇಲ್ಲ." : lang === "hi" ? "स्टॉक डेटा अभी नहीं है।" : "No stock data yet.";
    else if (lang === "hi") text = `*${shortName(tight.name)}* — स्टॉक ${tight.stock}, रोज़ ~${tight.daily} बिक रहा है, *${Math.max(1, Math.round(tight.days))} दिन* में खत्म। ${dipTxt}`;
    else if (lang === "kn") text = `*${shortName(tight.name)}* — ಸ್ಟಾಕ್ ${tight.stock}, ದಿನಕ್ಕೆ ~${tight.daily}, *${Math.max(1, Math.round(tight.days))} ದಿನ*ದಲ್ಲಿ ಮುಗಿಯುತ್ತದೆ. ${dipTxt}`;
    else text = `*${shortName(tight.name)}* — ${tight.stock} in stock, ~${tight.daily}/day, runs out in *${Math.max(1, Math.round(tight.days))} days*. ${dipTxt}`;
  } else if (intent === "cash") {
    const cash = await getCashOutlook(businessId);
    const c = cash.projection.status === "ok" ? cash.projection.crunch : null;
    if (cash.projection.status !== "ok") {
      text = lang === "hi" ? "नकदी का अनुमान लगाने के लिए आज की नकद रकम Cash पेज पर डालें।" : lang === "kn" ? "ನಗದು ಅಂದಾಜಿಗೆ ಇಂದಿನ ನಗದು ಮೊತ್ತವನ್ನು Cash ಪುಟದಲ್ಲಿ ಹಾಕಿ." : `${cash.projection.why}`;
    } else if (c) {
      text =
        lang === "hi"
          ? `${c.date} के आसपास नकदी ${inr(c.shortfall)} तक कम पड़ सकती है (लगभग ${c.weeksAhead} हफ्ते बाद)। उधार वसूली और सप्लायर की तारीख देखें।`
          : lang === "kn"
            ? `${c.date} ಸುಮಾರಿಗೆ ನಗದು ${inr(c.shortfall)} ವರೆಗೆ ಕಡಿಮೆಯಾಗಬಹುದು (ಸುಮಾರು ${c.weeksAhead} ವಾರ). ಬಾಕಿ ವಸೂಲಿ ಮತ್ತು ಸಪ್ಲೈಯರ್ ದಿನಾಂಕ ನೋಡಿ.`
            : `${describeCrunch(cash)} Chasing credit owed to you and moving a supplier due are the quickest fixes.`;
    } else {
      text = lang === "hi" ? "अगले 8 हफ्तों में नकदी की कमी नहीं दिखती।" : lang === "kn" ? "ಮುಂದಿನ 8 ವಾರಗಳಲ್ಲಿ ನಗದು ಕೊರತೆ ಕಾಣುತ್ತಿಲ್ಲ." : "No cash shortfall in the next 8 weeks on current numbers.";
    }
  } else if (intent === "decline") {
    const g = overview.growthPct;
    if (lang === "hi") text = g != null && g < 0 ? `पिछले 30 दिन की कमाई ${inr(overview.revenue30)} है — पिछले 30 दिन से ${Math.abs(g).toFixed(0)}% कम। ${dipTxt}` : `गिरावट नहीं दिख रही। 30 दिन की कमाई ${inr(overview.revenue30)}। ${dipTxt}`;
    else if (lang === "kn") text = g != null && g < 0 ? `ಕಳೆದ 30 ದಿನದ ಆದಾಯ ${inr(overview.revenue30)} — ಹಿಂದಿನ 30 ದಿನಕ್ಕಿಂತ ${Math.abs(g).toFixed(0)}% ಕಡಿಮೆ. ${dipTxt}` : `ಇಳಿಕೆ ಕಾಣುತ್ತಿಲ್ಲ. 30 ದಿನದ ಆದಾಯ ${inr(overview.revenue30)}. ${dipTxt}`;
    else text = g != null && g < 0 ? `Last 30 days: ${inr(overview.revenue30)}, down ${Math.abs(g).toFixed(0)}% vs the prior 30. ${dipTxt}` : `No decline in the last 30 days (${inr(overview.revenue30)}). ${dipTxt}`;
  } else if (intent === "customers") {
    if (lang === "hi") text = `ग्राहक ${overview.totalCustomers}। पिछले 30 दिन में ${overview.activeCustomers30} ने खरीदा। बाकी को विन-बैक मैसेज चाहिए — मंज़ूरी के बाद ही जाएगा।`;
    else if (lang === "kn") text = `ಗ್ರಾಹಕರು ${overview.totalCustomers}. ಕಳೆದ 30 ದಿನದಲ್ಲಿ ${overview.activeCustomers30} ಮಂದಿ ಖರೀದಿಸಿದರು. ಉಳಿದವರಿಗೆ ವಿನ್-ಬ್ಯಾಕ್ — ಅನುಮೋದನೆಯ ನಂತರ ಮಾತ್ರ.`;
    else text = `${overview.totalCustomers} customers, ${overview.activeCustomers30} bought in 30 days. A win-back can go out only after you approve it.`;
  } else if (intent === "top") {
    if (lang === "hi") text = top ? `सबसे ज़्यादा: *${top.name}* — ${inr(top.revenue)}, ${top.quantity} यूनिट (30 दिन)।` : "प्रोडक्ट डेटा नहीं है।";
    else if (lang === "kn") text = top ? `ಅತಿ ಹೆಚ್ಚು: *${top.name}* — ${inr(top.revenue)}, ${top.quantity} ಯೂನಿಟ್ (30 ದಿನ).` : "ಉತ್ಪನ್ನ ಡೇಟಾ ಇಲ್ಲ.";
    else text = top ? `Top seller: *${top.name}* — ${inr(top.revenue)}, ${top.quantity} units (30 days).` : "No product data.";
  } else if (intent === "forecast") {
    const pred = overview.predictedRevenue7;
    if (lang === "hi") text = pred != null ? `अगले 7 दिन का अनुमान ${inr(pred)} — आपकी असली बिक्री से, अंदाज़ा नहीं।` : "अनुमान के लिए और इतिहास चाहिए।";
    else if (lang === "kn") text = pred != null ? `ಮುಂದಿನ 7 ದಿನದ ಅಂದಾಜು ${inr(pred)} — ನಿಮ್ಮ ನಿಜವಾದ ಮಾರಾಟದಿಂದ.` : "ಅಂದಾಜಿಗೆ ಇನ್ನಷ್ಟು ಇತಿಹಾಸ ಬೇಕು.";
    else text = pred != null ? `Next 7 days look like ${inr(pred)} — from your real sales, not a guess.` : "Need more history before I forecast.";
  } else if (intent === "promo") {
    if (lang === "hi") text = promo ? `ड्राफ्ट तैयार है — *${shortName(promo.product)}* के लिए। एक टैप से मंज़ूर करें। मैं खुद नहीं भेजूँगा।` : "प्रमो के लिए प्रोडक्ट डेटा चाहिए।";
    else if (lang === "kn") text = promo ? `ಡ್ರಾಫ್ಟ್ ಸಿದ್ಧ — *${shortName(promo.product)}*. ಒಂದು ಟ್ಯಾಪ್‌ನಲ್ಲಿ ಅನುಮೋದಿಸಿ. ನಾನು ತಾನೇ ಕಳುಹಿಸುವುದಿಲ್ಲ.` : "ಪ್ರಚಾರಕ್ಕೆ ಉತ್ಪನ್ನ ಡೇಟಾ ಬೇಕು.";
    else text = promo ? `Draft is ready for *${shortName(promo.product)}*. One tap approves it. I will not send it myself.` : "Need product data before I draft a promo.";
  } else {
    const g = overview.growthPct;
    const gTxt = g == null ? "" : lang === "hi" ? ` (${g >= 0 ? "+" : ""}${g.toFixed(0)}%)` : lang === "kn" ? ` (${g >= 0 ? "+" : ""}${g.toFixed(0)}%)` : ` (${g >= 0 ? "+" : ""}${g.toFixed(0)}%)`;
    if (lang === "hi") text = `पिछले 30 दिन की कमाई *${inr(overview.revenue30)}*${gTxt}, ${overview.orders30} ऑर्डर। ${dipTxt}`;
    else if (lang === "kn") text = `ಕಳೆದ 30 ದಿನದ ಆದಾಯ *${inr(overview.revenue30)}*${gTxt}, ${overview.orders30} ಆರ್ಡರ್. ${dipTxt}`;
    else text = `Last 30 days: *${inr(overview.revenue30)}*${gTxt} across ${overview.orders30} orders. ${dipTxt}`;
  }

  const attach = intent === "promo" || intent === "stock" || intent === "decline" ? promo : null;
  const receipt = {
    title: "Answer",
    status: overview.hasData ? "computed" : "insufficient",
    headline: overview.hasData ? "Figures come from stored sales" : "Not enough history",
    steps: overview.hasData
      ? [
          { label: "Window", detail: `Last 30 days revenue ${inr(overview.revenue30)} from ${overview.orders30} orders. Prior 30 days ${inr(overview.revenuePrev30)}.` },
          { label: "Growth", detail: overview.growthPct == null ? "No prior window, so growth is withheld." : `${overview.growthPct.toFixed(1)}% = (recent − prior) / prior.` },
          { label: "Stock line", detail: tight ? `${tight.name}: ${tight.stock} on hand ÷ ${tight.daily}/day = ${tight.days.toFixed(1)} days.` : "No product with a measured daily rate." },
        ]
      : [{ label: "Why withheld", detail: "No sales rows for this business." }],
    caveat: "The assistant does not fill missing figures.",
  };
  return { text: text.trim(), promo: attach, receipt };
}

export async function ensureMorningBrief(businessId: string, lang: WaLang) {
  const bizRows = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const biz = bizRows[0];
  if (!biz) return null;
  const today = istDateISO();
  const existing = await db
    .select()
    .from(waMessages)
    .where(and(eq(waMessages.businessId, businessId), eq(waMessages.kind, "brief")))
    .orderBy(asc(waMessages.createdAt));
  const todays = existing.filter((m) => {
    try {
      return JSON.parse(m.metaJson || "{}").date === today;
    } catch {
      return false;
    }
  });
  if (todays.length && todays[0].lang === lang) return todays[0];
  if (todays.length) {
    await db.delete(waMessages).where(eq(waMessages.id, todays[0].id));
  }
  const [runway, dip] = await Promise.all([stockRunway(businessId), weekdayDip(businessId)]);
  const tight = runway.find((r) => r.days < 900) ?? null;
  const focus = tight && tight.days <= 14 ? tight : runway[0] ?? null;
  // Three to five prioritized actions, in the owner's language. Loaded lazily to avoid an import cycle.
  const [{ getTodayActions }, { runAutopilot }] = await Promise.all([import("./impact"), import("./autopilot")]);
  await runAutopilot(businessId).catch((e) => console.error("autopilot run failed", e));
  const actions = await getTodayActions(businessId, { lang, limit: 5 }).catch(() => []);
  const head = briefCopy(lang, biz.name, focus && focus.days < 900 ? focus : null, dip.downPct);
  const closing = head.split("\n\n").slice(-1)[0];
  const body = actions.length
    ? [
        head.split("\n")[0],
        ...actions.map((a, i) => `${i + 1}. ${a.title}${a.atStake != null ? ` — ${inr(a.atStake)}` : ""}`),
        "",
        closing,
      ].join("\n")
    : head;
  const product = focus && focus.days <= 21 ? focus.name : (await db.select().from(productsTable).where(eq(productsTable.businessId, businessId)).limit(1))[0]?.name;
  const offer = product ? await safeDiscount(businessId, product, 10) : 0;
  const promo = product
    ? { title: `9 AM promo — ${shortName(product)}`, content: promoCopy(lang, biz.name, product, offer), product, status: "draft" }
    : null;
  const receipt = {
    title: "9:00 AM brief",
    status: focus && focus.days < 900 ? "computed" : "insufficient",
    headline: focus && focus.days < 900 ? `${shortName(focus.name)} cover ${Math.max(1, Math.round(focus.days))} days` : "Not enough history",
    steps: [
      { label: "Stock cover", detail: focus ? `${focus.stock} on hand ÷ ${focus.daily} units/day (last 14 days ÷ 14) = ${focus.days.toFixed(1)} days.` : "No measured daily rate." },
      { label: "Weekday gap", detail: dip.downPct == null ? "Not enough weekday and weekend days to compare." : `Weekday average ${inr(dip.weekdayAvg)} vs weekend ${inr(dip.weekendAvg)}. Down ${(dip.downPct).toFixed(1)}% = (weekend − weekday) / weekend.` },
    ],
    caveat: "Both figures are counted from stored sales. No seasonal guess is mixed in.",
  };
  const [row] = await db
    .insert(waMessages)
    .values({
      businessId,
      direction: "out",
      kind: "brief",
      body,
      lang,
      metaJson: JSON.stringify({ date: today, promo, runway: focus, weekdayDownPct: dip.downPct, receipt, actions }),
      createdAt: nineAmIst(today),
    })
    .returning();
  return row;
}

export async function listThread(businessId: string) {
  const rows = await db.select().from(waMessages).where(eq(waMessages.businessId, businessId)).orderBy(asc(waMessages.createdAt)).limit(200);
  return rows.map((m) => ({
    ...m,
    meta: m.metaJson ? JSON.parse(m.metaJson) : null,
  }));
}

export async function saveApprovedPromo(businessId: string, input: { title: string; content: string; product?: string; lang: string }) {
  const [row] = await db
    .insert(marketingCampaigns)
    .values({
      businessId,
      type: "whatsapp",
      title: input.title || "WhatsApp promo",
      content: input.content,
      inputsJson: JSON.stringify({ product: input.product, lang: input.lang, source: "whatsapp-one-tap" }),
      engine: "builtin",
      status: "approved",
      approvedAt: new Date(),
    })
    .returning();
  return row;
}
