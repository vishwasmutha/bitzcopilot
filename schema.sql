-- BizCopilot — PostgreSQL schema (managed by Drizzle ORM, src/db/schema.ts)
-- Applied automatically with:  npx drizzle-kit push

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE businesses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES users(id),
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  location    TEXT,
  size        TEXT,
  employees   INTEGER,
  is_demo     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses(id),
  name              TEXT NOT NULL,
  category          TEXT,
  unit_cost         DOUBLE PRECISION NOT NULL DEFAULT 0,
  selling_price     DOUBLE PRECISION NOT NULL DEFAULT 0,
  stock_qty         INTEGER NOT NULL DEFAULT 0,
  min_stock         INTEGER NOT NULL DEFAULT 0,
  last_restocked_at TIMESTAMPTZ,
  demo              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
CREATE INDEX products_business_idx ON products (business_id);

CREATE TABLE sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses(id),
  sale_date      DATE NOT NULL,
  product_name   TEXT NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 1,
  unit_price     DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_amount   DOUBLE PRECISION NOT NULL DEFAULT 0,
  customer_id    TEXT,
  demo           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sales_business_date_idx    ON sales (business_id, sale_date);
CREATE INDEX sales_business_product_idx ON sales (business_id, product_name);

CREATE TABLE customers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses(id),
  ref_id            TEXT NOT NULL,
  name              TEXT,
  email             TEXT,
  phone             TEXT,
  first_purchase_at DATE,
  last_purchase_at  DATE,
  total_spent       DOUBLE PRECISION NOT NULL DEFAULT 0,
  order_count       INTEGER NOT NULL DEFAULT 0,
  demo              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, ref_id)
);
CREATE INDEX customers_business_idx ON customers (business_id);

CREATE TABLE inventory_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id),
  product_id   UUID NOT NULL REFERENCES products(id),
  type         TEXT NOT NULL, -- restock | sale | adjustment | import
  qty_change   INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invtx_product_idx ON inventory_transactions (business_id, product_id);

CREATE TABLE uploaded_files (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses(id),
  file_name      TEXT NOT NULL,
  dataset_type   TEXT NOT NULL, -- sales | products | inventory | customers
  total_rows     INTEGER NOT NULL DEFAULT 0,
  imported_rows  INTEGER NOT NULL DEFAULT 0,
  skipped_rows   INTEGER NOT NULL DEFAULT 0,
  issues_json    TEXT,
  is_demo        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX uploads_business_idx ON uploaded_files (business_id);

CREATE TABLE marketing_campaigns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id),
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  inputs_json  TEXT,
  engine       TEXT NOT NULL DEFAULT 'builtin',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_business_idx ON marketing_campaigns (business_id);

CREATE TABLE ai_conversations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  title        TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX conv_business_idx ON ai_conversations (business_id, user_id);

CREATE TABLE ai_messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   UUID NOT NULL REFERENCES ai_conversations(id),
  business_id       UUID NOT NULL REFERENCES businesses(id),
  role              TEXT NOT NULL, -- user | assistant
  content           TEXT NOT NULL,
  meta_json         TEXT,
  engine            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX msgs_conv_idx ON ai_messages (conversation_id);

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id),
  type         TEXT NOT NULL,
  severity     TEXT NOT NULL DEFAULT 'info', -- info | positive | warning | critical
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  dedupe_key   TEXT NOT NULL,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, dedupe_key)
);
CREATE INDEX notif_business_idx ON notifications (business_id);

CREATE TABLE forecast_results (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses(id),
  horizon_days   INTEGER NOT NULL,
  model_name     TEXT NOT NULL,
  metrics_json   TEXT,
  series_json    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fc_business_idx ON forecast_results (business_id);

CREATE TABLE password_resets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  email      TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- v2 additions. The authoritative definition is src/db/schema.ts (drizzle-kit push).
-- ---------------------------------------------------------------------------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS opening_cash DOUBLE PRECISION;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS opening_cash_on DATE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS autopilot_level INTEGER NOT NULL DEFAULT 2;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS autopilot_budget DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS lead_time_days INTEGER NOT NULL DEFAULT 3;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_source TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS impact_rs DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS cash_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id),
  kind TEXT NOT NULL, party TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL,
  issued_on DATE NOT NULL, due_date DATE NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'none', status TEXT NOT NULL DEFAULT 'open',
  note TEXT, demo BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS promo_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id),
  campaign_id UUID REFERENCES marketing_campaigns(id),
  title TEXT NOT NULL, segment TEXT NOT NULL, product_name TEXT,
  holdout_pct INTEGER NOT NULL DEFAULT 20, window_days INTEGER NOT NULL DEFAULT 14,
  started_on DATE NOT NULL, demo BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS promo_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES promo_experiments(id),
  business_id UUID NOT NULL REFERENCES businesses(id),
  customer_ref TEXT NOT NULL, grp TEXT NOT NULL,
  UNIQUE (experiment_id, customer_ref)
);
CREATE TABLE IF NOT EXISTS action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id),
  kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT, why TEXT,
  level INTEGER NOT NULL, status TEXT NOT NULL, amount DOUBLE PRECISION, payload_json TEXT,
  dedupe_key TEXT NOT NULL, demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ,
  UNIQUE (business_id, dedupe_key)
);
