# BizCopilot: tech stack and build plan

Written for the hackathon team. It covers what the app runs on, how the pieces connect, and how each promise in the problem-statement submission maps to code you can open.

## 1. Stack at a glance

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Recharts, lucide-react | One repo for UI and API. Self-hosted fonts, so nothing fails on venue Wi-Fi. |
| Backend | Next.js route handlers (`src/app/api/*`), Node runtime | No second server. Every handler calls `requireSession()` and scopes every query by business. |
| Database | PostgreSQL 17 through Drizzle ORM | Typed queries, `schema.sql` mirror, `drizzle-kit push` to create tables. |
| Auth | scrypt passwords, HS256 JWT in an httpOnly cookie with a bearer fallback, WhatsApp number + PIN login | No third-party auth to configure. |
| Forecasting | TypeScript: OLS with weekday terms, Holt-Winters and a seasonal-naive model, all scored on the same held-out days | Small data, so classical models beat deep learning and every number can be explained. |
| Language model | OpenAI `gpt-4o-mini` or Gemini 2.0 Flash over `fetch`, with a built-in grounded fallback | Works with no key. Phones, emails, UPI IDs and GSTINs are masked before any prompt leaves the server. |
| Data in | SheetJS (CSV, Excel), Google Sheets by share link, pasted UPI or bank messages, typed or spoken "sold 3 rice, 2 oil" | Messy data is expected. |

Design rule: **deterministic code computes every number; the language model only words them.** The assistant answers through a tool interface and shows the figures each tool returned.

## 2. Architecture

```
Browser (React)
  /wa  /dashboard  /impact  /cash  /autopilot  /customers  /marketing  /data  /inventory  /forecast  /what-if  /assistant
        │ fetch (cookie or bearer)
Route handlers  src/app/api/*
        │
Pure maths, no imports, unit tested (npm run test:math)
  impact-math.ts   drop detector, promo lift, margin guardrail, PII masking, UPI parser
  engine-math.ts   reorder point, cash projection, holdout split and analysis, quick-sale parser, alert cap, forecast confidence
Domain logic (database aware)
  analytics.ts forecast.ts reorder.ts whatif.ts impact.ts cash.ts experiments.ts audience.ts autopilot.ts tools.ts llm.ts wa.ts demo.ts
        │
PostgreSQL via Drizzle  (every row carries business_id; demo rows carry demo=true)
```

## 3. The submission, point by point

| What the submission says | Where it lives |
|---|---|
| Upload with automatic column mapping, data-quality check | `/data`, `src/lib/ingest.ts` (missing dates, duplicates, several date formats, Excel serials) |
| Connectors: Google Sheets now, Shopify, Square, Tally, Zoho later | Google Sheets: `/api/data/sheet` (docs.google.com links only). The others are shown as roadmap, not faked. |
| Sales-drop alert: same weekday, trailing 4 to 8 weeks, about 2 standard deviations, names product and category | `explainDrop` in `impact-math.ts`; alerts in `analytics.ts`; `/impact` |
| Forecast: seasonal-naive and exponential smoothing, visible band, declines when history is short | `forecast.ts`: trend model, Holt-Winters and seasonal-naive compete on a holdout; below 14 days it refuses; confidence label and models-compared table on `/forecast` |
| Reorder point = daily demand x lead time + safety stock; stockouts and slow movers tying up cash | `reorderPoint` and `slowMover` in `engine-math.ts`, used by `reorder.ts` and the purchase plan on `/inventory` |
| RFM segments | `analytics.ts`, `/customers` |
| Tool-calling Q&A, replies only from tool results, figures beside each claim | `tools.ts` (8 tools), "Figures used" panel on `/assistant` |
| WhatsApp, SMS, email, Instagram drafts for a segment, offer and tone, regional languages | `/marketing`: 8 content types in English, Hindi and Kannada |
| Daily brief with 3 to 5 prioritized actions, voice notes, one-tap approval | `/wa`; actions from `getTodayActions`, ranked by rupees at stake, in three languages |
| Dashboard with forecast charts, reorder table, segment builder | `/dashboard`, `/forecast`, `/inventory`, segment builder on `/customers` |
| What-if simulator, as a range | `/what-if`, `whatif.ts` (price elasticity, weekend discount, supplier delay) |
| Measured promotion impact against a holdout group | `/marketing` "Start tracked send", `experiments.ts`, `analyzeExperiment`; results on `/impact` |
| Forward-looking cash-flow guardian | `/cash`, `cash.ts`, `projectCash` |
| "Show the math" receipts and "not enough history" | `MathReceipt` on computed figures; every engine returns an explicit insufficient state |
| Privacy: only IDs and aggregates to the model, consent tracked before drafting for sending | `maskPii`, aggregates-only prompts, consent register on `/customers`, consent gate in `/api/marketing/generate` |
| Autopilot dial with every action logged and explained | `/autopilot`, `autopilot.ts`, `action_log` table |
| Messy-data tolerance: UPI, voice entries | UPI paste and typed or spoken sales on `/data`. Bill photos are still roadmap. |
| Alert fatigue: cap weekly alerts, rank by rupees | `rankAndCap`, 5 new alerts a week, each with rupees at stake |
| Pilot metrics: weekly active, actions per insight, stockout rate, repeat rate vs holdout, forecast error vs naive | Pilot scorecard on `/impact` |
| Anonymous neighbourhood benchmarks (roadmap) | Rule-of-thumb ranges per shop type, labelled as such. No cross-shop data is collected. |

## 4. Run it

```bash
npm install
cp .env.example .env        # DATABASE_URL and JWT_SECRET; API keys optional
npx drizzle-kit push        # creates the tables
npm run dev
npm run test:math           # unit tests for the maths, no database
npm run smoke               # end-to-end check against the running app
npm run typecheck && npm run build
```

Demo: `98450 12345` / PIN `demo1234`, or the demo button. The Kirana demo plants five scenarios so every feature has something to show: a supplier-delay sales dip, a 10%-off promo with a before/after lift, a win-back test with a held-back group, a cash shortfall about four weeks out, and stock that is not selling.

## 5. Demo script (5 minutes)

1. `/wa`: the 9 AM brief in Kannada or Hindi with five ranked actions. One tap approves a promo.
2. `/impact`: the dip is flagged, the cause named (product and category), "How was this worked out?" open.
3. `/impact`: the win-back test. 55% of messaged customers came back against 13% held back.
4. `/marketing`: ask for a 40% discount. The margin check lowers it and shows the break-even.
5. `/cash`: a shortfall about four weeks ahead, with the week-by-week table and every assumption.
6. `/autopilot`: change the dial; the log shows what it did and why.
7. `/assistant`: "Will I run short of cash?" and open "Figures used".
8. `/data`: type "sold 2 atta to Ramesh on credit", then paste a few UPI lines.

## 6. Known limits (say them before a judge does)

- Promo lift without a holdout is a before-and-after estimate. The holdout test is the strong evidence, and it needs about 15 consenting customers to be fair.
- Peer ranges are assumptions per shop type, not data from other shops.
- The cash projection is a forecast with a low and a high case. It needs today's balance and the bills and credit you record.
- Price sensitivity needs 21+ selling days and at least two prices; otherwise the simulator withholds a number.
- Bill and ledger photos are not read yet. Shopify, Square, Tally and Zoho connectors are not built.
- The app never messages customers. The owner sends from their own WhatsApp.
- The built-in assistant routes questions to tools by rules. A language model, when a key is set, only words the answer.
- The demo data is simulated, and its planted scenarios are labelled as demo.

## Agents

Agents here are rule-based and deterministic. The model only words things; it never decides amounts or sends messages.

| Agent | What it does | Where |
|---|---|---|
| Daily operator | Once a day: checks sales, stock and cash, logs autopilot items, runs collections, writes the morning brief and delivers it (in-app, and WhatsApp when configured). | `src/lib/operator.ts`, `/api/operator`, `/api/cron/daily` (09:00 IST via `vercel.json`), Autopilot page |
| Collections | Finds overdue credit, drafts polite reminders in en/hi/kn that get firmer by age, one per stage and spaced apart. The owner sends them (WhatsApp link or copy) and marks the result. | `src/lib/collections-math.ts` (rules, unit-tested), `src/lib/collections.ts`, `/api/collections`, Cash page |

Env: `CRON_SECRET` protects the cron endpoint. `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are optional, for sending the brief to the owner on WhatsApp.
