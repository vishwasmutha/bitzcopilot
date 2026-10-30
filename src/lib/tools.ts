import "server-only";
import { getCustomerAnalytics, getOverview, getProductPerformance, getDailySalesSeries } from "./analytics";
import { consentSummary, resolveAudience } from "./audience";
import { getCashOutlook } from "./cash";
import { getExperiments } from "./experiments";
import { generateForecast } from "./forecast";
import { getDropReport } from "./impact";
import { buildPurchasePlan } from "./reorder";
import { fmtCurrency, fmtPercent } from "./utils";

/* ------------------------------------------------------------------ */
/* The assistant's tool interface. Every answer is built from these     */
/* functions. Each returns the figures it used so the owner can see     */
/* them beside the answer. The language model does not do arithmetic.   */
/* ------------------------------------------------------------------ */

export type ToolFigure = { label: string; value: string };
export type ToolCall = { tool: string; args: Record<string, unknown>; summary: string; figures: ToolFigure[] };

export const TOOL_SPECS: { name: string; description: string; args: string }[] = [
  { name: "get_sales", description: "Revenue, orders and average order value for a period, with the change against the period before.", args: "days: 7 | 30" },
  { name: "get_top_products", description: "Best sellers by revenue with their trend and margin.", args: "limit: number" },
  { name: "get_forecast", description: "Revenue forecast with model, confidence and backtest against a naive baseline.", args: "horizon: 7 | 14 | 30" },
  { name: "get_segment", description: "A customer segment's size, spend and how many agreed to be messaged.", args: "name: segment name or 'All customers'" },
  { name: "get_stock_risk", description: "Items under their reorder point or that will run out before delivery, and cash tied up in slow movers.", args: "none" },
  { name: "get_drop_report", description: "This week against a normal same-weekday week, with the product and category responsible.", args: "none" },
  { name: "get_cash_outlook", description: "Projected cash for 8 weeks and the first week it could run short.", args: "none" },
  { name: "get_promo_results", description: "Results of promotions tested against a held-back group.", args: "none" },
];

type Out = { call: ToolCall; data: unknown };

export async function runTool(businessId: string, tool: string, args: Record<string, unknown> = {}): Promise<Out> {
  switch (tool) {
    case "get_sales": {
      const days = args.days === 7 ? 7 : 30;
      if (days === 30) {
        const o = await getOverview(businessId);
        return {
          data: o,
          call: {
            tool,
            args: { days },
            summary: "Sales for the last 30 days",
            figures: [
              { label: "Revenue, last 30 days", value: fmtCurrency(o.revenue30) },
              { label: "Revenue, 30 days before", value: fmtCurrency(o.revenuePrev30) },
              { label: "Change", value: o.growthPct == null ? "no earlier period" : fmtPercent(o.growthPct, true) },
              { label: "Orders", value: String(o.orders30) },
              { label: "Average order", value: o.aov ? fmtCurrency(o.aov) : "n/a" },
            ],
          },
        };
      }
      const series = await getDailySalesSeries(businessId, 14);
      const cur = series.slice(7).reduce((a, d) => a + d.revenue, 0);
      const prev = series.slice(0, 7).reduce((a, d) => a + d.revenue, 0);
      return {
        data: { cur, prev },
        call: {
          tool,
          args: { days },
          summary: "Sales for the last 7 days",
          figures: [
            { label: "Revenue, last 7 days", value: fmtCurrency(cur) },
            { label: "Revenue, 7 days before", value: fmtCurrency(prev) },
            { label: "Change", value: prev > 0 ? fmtPercent(((cur - prev) / prev) * 100, true) : "no earlier week" },
          ],
        },
      };
    }
    case "get_top_products": {
      const limit = Math.min(8, Math.max(1, Number(args.limit) || 5));
      const perf = (await getProductPerformance(businessId, 30)).slice(0, limit);
      return {
        data: perf,
        call: {
          tool,
          args: { limit },
          summary: `Top ${perf.length} products, last 30 days`,
          figures: perf.map((p) => ({
            label: p.name,
            value: `${fmtCurrency(p.revenue)} · ${p.quantity} units${p.changePct != null ? ` · ${fmtPercent(p.changePct, true)} vs prior 2 weeks` : ""}${p.margin != null ? ` · ${p.margin.toFixed(0)}% margin` : ""}`,
          })),
        },
      };
    }
    case "get_forecast": {
      const horizon = [7, 14, 30].includes(Number(args.horizon)) ? Number(args.horizon) : 7;
      const fc = await generateForecast(businessId, horizon);
      if (fc.status === "insufficient") {
        return { data: fc, call: { tool, args: { horizon }, summary: "Forecast not possible yet", figures: [{ label: "Why", value: fc.message ?? "Not enough history" }] } };
      }
      return {
        data: fc,
        call: {
          tool,
          args: { horizon },
          summary: `Forecast for the next ${horizon} days`,
          figures: [
            { label: `Expected revenue, next ${horizon} days`, value: fmtCurrency(fc.totalPredicted) },
            { label: "Model", value: fc.model },
            { label: "Confidence", value: `${fc.confidence.level}. ${fc.confidence.reason}` },
            { label: "Against the naive baseline", value: fc.backtest.status === "computed" && fc.backtest.beatPct != null ? `${fc.backtest.beatPct >= 0 ? "better" : "worse"} by ${Math.abs(fc.backtest.beatPct).toFixed(1)}% on held-out days` : "no fair backtest yet" },
          ],
        },
      };
    }
    case "get_segment": {
      const name = String(args.name ?? "All customers");
      const [analytics, members] = await Promise.all([getCustomerAnalytics(businessId), resolveAudience(businessId, name)]);
      const seg = analytics.segments.find((s) => s.name === name);
      const sum = consentSummary(members);
      return {
        data: { seg, sum },
        call: {
          tool,
          args: { name },
          summary: `Customers: ${name}`,
          figures: [
            { label: "Customers", value: String(seg ? seg.count : sum.total) },
            ...(seg ? [{ label: "Lifetime revenue", value: fmtCurrency(seg.revenue) }] : []),
            { label: "Agreed to be messaged", value: `${sum.consented} of ${sum.total}` },
          ],
        },
      };
    }
    case "get_stock_risk": {
      const plan = await buildPurchasePlan(businessId, false);
      if (plan.status === "insufficient") return { data: plan, call: { tool, args: {}, summary: "Stock risk not available", figures: [{ label: "Why", value: plan.receipt.steps[0]?.detail ?? "Not enough history" }] } };
      const risky = plan.lines.filter((l) => l.risk !== "ok").slice(0, 5);
      return {
        data: plan,
        call: {
          tool,
          args: {},
          summary: "Stock under its reorder point",
          figures: [
            ...risky.map((l) => ({ label: l.name, value: `${l.stock} in stock, reorder point ${l.reorderPoint}, ${l.daysCover ?? "n/a"} days of cover${l.risk === "stockout_before_delivery" ? ", will run out before delivery" : ""}` })),
            ...(risky.length ? [] : [{ label: "Reorder points", value: "Nothing is under its reorder point" }]),
            { label: "Cash tied up in slow movers", value: fmtCurrency(plan.cashTrapped) },
          ],
        },
      };
    }
    case "get_drop_report": {
      const d = await getDropReport(businessId);
      if (d.status === "insufficient") return { data: d, call: { tool, args: {}, summary: "No drop check yet", figures: [{ label: "Why", value: d.why ?? "Not enough history" }] } };
      return {
        data: d,
        call: {
          tool,
          args: {},
          summary: "This week against a normal week",
          figures: [
            { label: "This week", value: fmtCurrency(d.currentWeek) },
            { label: `Normal week (last ${d.baselineWeeks} same-weekday weeks)`, value: fmtCurrency(d.baseline) },
            { label: "Difference", value: d.pct == null ? "n/a" : `${fmtPercent(d.pct, true)} (${d.zScore != null ? d.zScore.toFixed(1) : "n/a"} standard deviations)` },
            { label: "Flagged as a drop", value: d.dropDetected ? "yes" : "no" },
            ...d.drivers.map((x) => ({ label: `Driver: ${x.product} (${x.category})`, value: `${fmtCurrency(x.delta)} · ${Math.round(x.share)}% of the change` })),
          ],
        },
      };
    }
    case "get_cash_outlook": {
      const o = await getCashOutlook(businessId);
      if (o.projection.status === "insufficient") return { data: o, call: { tool, args: {}, summary: "Cash outlook not available", figures: [{ label: "Why", value: o.projection.why }] } };
      const p = o.projection;
      return {
        data: o,
        call: {
          tool,
          args: {},
          summary: "Cash for the next 8 weeks",
          figures: [
            { label: "Cash today", value: fmtCurrency(o.openingCash ?? 0) },
            { label: "Lowest expected balance", value: `${fmtCurrency(p.lowest.mid.balance)} on ${p.lowest.mid.date}` },
            { label: "Lowest in the low case", value: `${fmtCurrency(p.lowest.low.balance)} on ${p.lowest.low.date}` },
            { label: "Shortfall", value: p.crunch ? `${p.crunch.likelihood === "likely" ? "expected" : "possible"} around ${p.crunch.date}, up to ${fmtCurrency(p.crunch.shortfall)}` : "none in 8 weeks" },
            { label: "Credit owed to you", value: fmtCurrency(o.openReceivables) },
            { label: "Bills and rent recorded", value: fmtCurrency(o.openPayables) },
          ],
        },
      };
    }
    case "get_promo_results": {
      const exps = await getExperiments(businessId, 4);
      return {
        data: exps,
        call: {
          tool,
          args: {},
          summary: "Promotions tested against a held-back group",
          figures: exps.length
            ? exps.map((e) => ({
                label: e.title,
                value:
                  e.result.status === "ok"
                    ? `${e.result.verdict === "worked" ? "worked" : e.result.verdict === "worse" ? "did worse than not messaging" : "inconclusive"}: ${Math.round(e.result.rateT * 100)}% of messaged customers came back against ${Math.round(e.result.rateH * 100)}% held back; about ${fmtCurrency(e.result.incrementalTotal)} extra (${fmtCurrency(e.result.totalLow)} to ${fmtCurrency(e.result.totalHigh)})`
                    : e.result.status === "measuring"
                      ? `too early (${e.daysElapsed} of at least ${e.result.needed} days)`
                      : e.result.why,
              }))
            : [{ label: "Experiments", value: "None yet. Start a tracked send from the Marketing Studio." }],
        },
      };
    }
    default:
      return { data: null, call: { tool, args, summary: "Unknown tool", figures: [] } };
  }
}

export type Intent = "revenue" | "top_products" | "profit" | "decline" | "inventory" | "marketing" | "customers" | "forecast" | "cash" | "promo_results" | "overview";

/** Which tools answer which kind of question. Chosen by rules so the plan is predictable and testable. */
export function planTools(intent: Intent): { tool: string; args: Record<string, unknown> }[] {
  switch (intent) {
    case "revenue":
      return [{ tool: "get_sales", args: { days: 30 } }];
    case "top_products":
    case "profit":
      return [{ tool: "get_top_products", args: { limit: 5 } }];
    case "decline":
      return [{ tool: "get_drop_report", args: {} }, { tool: "get_sales", args: { days: 30 } }];
    case "inventory":
      return [{ tool: "get_stock_risk", args: {} }];
    case "marketing":
      return [{ tool: "get_top_products", args: { limit: 3 } }, { tool: "get_segment", args: { name: "At-risk customers" } }];
    case "customers":
      return [{ tool: "get_segment", args: { name: "All customers" } }, { tool: "get_segment", args: { name: "At-risk customers" } }];
    case "forecast":
      return [{ tool: "get_forecast", args: { horizon: 7 } }];
    case "cash":
      return [{ tool: "get_cash_outlook", args: {} }];
    case "promo_results":
      return [{ tool: "get_promo_results", args: {} }];
    default:
      return [{ tool: "get_sales", args: { days: 30 } }, { tool: "get_top_products", args: { limit: 3 } }];
  }
}

export function figuresToText(calls: ToolCall[]): string {
  return calls.map((c) => `${c.tool}(${JSON.stringify(c.args)}): ${c.summary}\n${c.figures.map((f) => `- ${f.label}: ${f.value}`).join("\n")}`).join("\n\n");
}
