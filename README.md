# BizCopilot

**Meet owners on WhatsApp. The desk dashboard is secondary.**

A kirana or salon owner in Bengaluru will not open a dashboard at 9 AM. BizCopilot sends the brief there, takes voice notes in Kannada or Hindi, and waits for one tap before a promo goes out.

Sign in with **Option B** (WhatsApp number). Demo shop: `98450 12345` / PIN `demo1234`. Option A (email) still works: `demo@bizcopilot.app` / `demo1234`.

---

**Your Business. Your Data. Your AI Copilot.**

An AI-powered business intelligence and digital-transformation assistant for small businesses — bakeries, restaurants, grocery stores, retail shops and local service providers. It turns raw sales, inventory and customer files into a live dashboard, ML sales forecasts, smart reorder plans, RFM customer segments, grounded AI chat answers and trend-aware marketing copy.

> **Platform note:** the original brief proposed FastAPI + MySQL + Vite/React. This build runs on the project's provisioned fullstack platform: **Next.js (App Router) with API routes as the backend, PostgreSQL via Drizzle ORM as the database, and TypeScript for both UI and ML logic.** Every capability from the brief is implemented — REST endpoints, JWT (HS256) cookie sessions, scrypt password hashing, ML forecasting with model evaluation, LLM integration, Excel/CSV ingestion, demo mode, role-isolated data.

---

## Features

| Module | What it does |
| --- | --- |
| **Auth & onboarding** | Register / login / forgot-password (reset codes), JWT httpOnly session cookies, scrypt-hashed passwords, business onboarding (category, location, size, employees), one-click **demo account** (`demo@bizcopilot.app` / `demo1234`) |
| **Dashboard** | 8 KPI cards (revenue, orders, AOV, products, inventory value, active customers, growth, 7-day prediction), 7 interactive charts, auto-generated insights, recent alerts — all computed from stored rows |
| **Data & import** | `.csv` / `.xlsx` upload for sales, products, inventory, customers. In-browser parse (SheetJS), column auto-detection + manual mapping, preview, missing-value & duplicate detection, date normalisation (ISO/US/EU/Excel serial), server-side re-validation, dedupe against existing rows, import history |
| **AI assistant** | Natural-language Q&A wired to the authenticated business's DB. Intent detection → real queries → answer + charts. OpenAI or Gemini when a key is configured; otherwise a clearly-labelled built-in engine. Strict "no invented numbers" grounding prompt, 20 req/min rate limit, full conversation history |
| **ML forecasting** | Two models — OLS trend regression with day-of-week dummies and additive **Holt-Winters** (period 7, parameter grid search) — compared on a holdout window (MAE / RMSE / MAPE), winner retrained on all data. 7–60 day horizon, ±98% confidence band, weekly pattern, product-level demand vs stock |
| **Smart inventory** | Product CRUD, restock ledger (inventory_transactions), low/out-of-stock & overstock detection, slow movers, demand-based reorder quantities (2-week forecast coverage) |
| **Marketing studio** | 7 content types × 4 tones with product/segment/objective/discount inputs; trend-aware (points declining products at promos); generate / regenerate / copy / edit / save; nothing is auto-published |
| **Customer analytics** | RFM segmentation (Loyal, High-value, Potential loyalist, At-risk, New, Active one-time, Declining, Inactive) with per-segment suggestions and top members |
| **Alerts** | Rule-based, idempotently stored notifications: sales drops, out-of/low stock, demand surges, engagement decline, growth momentum; bell badge with unread count |
| **Demo mode** | Seeded, realistic 120-day datasets (bakery / restaurant / grocery / retail packs) with clear demo flags, full isolation from real rows, one-click reset |

## Getting started

### Windows (PowerShell)

```powershell
npm install
Copy-Item .env.example .env.local
```

Edit `.env.local` and set `DATABASE_URL` to your PostgreSQL connection string and `JWT_SECRET` to a long random value. The sample values in `.env.example` are for local development only. PostgreSQL must be running and the database named in `DATABASE_URL` must already exist. Production startup requires an explicitly configured `JWT_SECRET` and will fail closed without it.

Then sync the schema and start the development server:

```powershell
npm run db:push
npm run dev
```

Open http://localhost:3000. Use `npm run check` to run TypeScript and ESLint checks, or `npm run build` to create a production build. For production, configure the same environment variables in the hosting provider before building and starting with `npm start`.

Optional: set `OPENAI_API_KEY` or `GEMINI_API_KEY` in `.env.local` to enable an external language model. Without a key, the built-in grounded engine is used.

Open the app → **Sign up**, finish onboarding (optionally load the demo dataset), or hit **“Explore the demo bakery”** for a pre-loaded workspace.

## API surface

```
Auth         POST /api/auth/register · /login · /demo · /logout
             GET  /api/auth/me
             POST /api/auth/forgot-password · /reset-password
Business     GET/PUT /api/business/profile
Data         POST /api/data/import · GET /api/data/history
Analytics    (server-rendered dashboard; data via src/lib/analytics.ts)
Forecast     POST /api/forecast · GET /api/forecast?horizon=
Inventory    GET/POST /api/inventory · GET /api/inventory?history=<productId>
             PUT/POST/DELETE /api/inventory/:id  (POST = restock)
             GET  /api/inventory/recommendations
AI           POST /api/ai/chat · GET/POST /api/ai/conversations
             GET/DELETE /api/ai/conversations/:id · GET /api/ai/status
Marketing    POST /api/marketing/generate
             GET/POST/DELETE /api/marketing/campaigns
Alerts       GET/POST /api/notifications · PUT /api/notifications/:id
Demo         GET/POST /api/demo   (action: load | clear)
```

All routes verify the JWT cookie, and every business-scoped query is filtered by the caller's `businessId` — data isolation is enforced at the query layer.

## Forecasting engine

- **Inputs:** daily revenue aggregated from stored sales (zero-filled).
- **Models:** (a) OLS regression `y = β0 + β1·t + Σβ_dow`; (b) Holt-Winters additive with weekly seasonality, 24 smoothing combinations.
- **Selection:** both fitted on the oldest ~85% of history, compared on the final 14-day holdout by MAE; the winner is retrained on the full series. With <6 weeks of history the model runs in a clearly-labelled "limited" mode; with <2 weeks it refuses to forecast and explains why.
- **Metrics:** MAE, RMSE, MAPE (holdout when possible, in-sample otherwise).
- **Uncertainty:** residual σ widened with horizon → per-day lower/upper band.
- **Products:** 4-week per-product volume buckets, least-squares trend → predicted weekly demand, days-of-stock coverage.

## LLM integration & honesty guarantees

- Server-side only; keys read from `process.env` (`OPENAI_API_KEY`, `GEMINI_API_KEY`) — never exposed to the browser.
- The chat assistant assembles a factual context block from **real database queries** and instructs the model to use only those figures. When no key is configured, a built-in engine composes answers from the same queried numbers, and the UI labels which engine answered (`OpenAI` / `Gemini` / `Built-in engine`).
- Marketing generation is trend-aware (e.g. a declining product triggers a promo-first framing) and reports the exact data grounding used.
- AI endpoints are rate limited (chat 20/min, generation 15/min).

## Security

- scrypt password hashing with per-user salts; constant-time comparison.
- HS256 JWT in an httpOnly, SameSite=Lax cookie; 7-day expiry.
- Drizzle parameterised queries everywhere (no raw string SQL).
- File upload validation: type/extension checks client-side, row cap 20k, field-level type validation server-side, date normalisation, in-file and cross-file dedupe.
- Business-level row isolation on every read/write; reset tokens hashed (SHA-256) and single-use with 30-min expiry.

## Project structure

```
src/
  app/
    page.tsx                  landing
    (auth)/ login · signup · forgot
    onboarding/
    (app)/ layout (auth gate + shell)
      dashboard · data · forecast · customers · inventory
      marketing · assistant · notifications · settings
    api/  auth/ business/ data/ forecast/ inventory/ ai/ marketing/ notifications/ demo/
  components/   ui.tsx (design system) · charts.tsx (Recharts) · shell.tsx (sidebar/topbar)
  lib/          auth.ts · analytics.ts · forecast.ts · ingest.ts · llm.ts · demo.ts · utils.ts
  db/           schema.ts (Drizzle) · index.ts
schema.sql      plain-SQL mirror of the schema
.env.example    environment template
```

## Demo datasets

Generated with a seeded PRNG (stable across loads): ~120 days of daily sales with weekly seasonality and per-product trend curves (incl. an intentionally declining product and a surging one), a product catalog with cost/price/stock (incl. low-stock and out-of-stock items), and ~46 customers spread across RFM behaviour profiles. All rows carry `demo=true`, are shown behind a "Demo data" badge, and are deleted by **Settings → Reset demo data** without touching real records.
