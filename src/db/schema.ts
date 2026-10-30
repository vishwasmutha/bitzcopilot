import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  doublePrecision,
  index,
  unique,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* BizCopilot schema — every business-owned row carries businessId so  */
/* data isolation is enforced at the query layer.                       */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id),
  name: text("name").notNull(),
  category: text("category").notNull(),
  location: text("location"),
  size: text("size"),
  employees: integer("employees"),
  phone: text("phone"),
  language: text("language").notNull().default("en"),
  cashBudget: doublePrecision("cash_budget"),
  openingCash: doublePrecision("opening_cash"),
  openingCashOn: date("opening_cash_on", { mode: "string" }),
  // Autopilot dial: 1 = suggest only, 2 = draft and wait for approval, 3 = act within a weekly budget
  autopilotLevel: integer("autopilot_level").notNull().default(2),
  autopilotBudget: doublePrecision("autopilot_budget").notNull().default(0),
  upiId: text("upi_id"),
  gstin: text("gstin"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    name: text("name").notNull(),
    category: text("category"),
    unitCost: doublePrecision("unit_cost").notNull().default(0),
    sellingPrice: doublePrecision("selling_price").notNull().default(0),
    stockQty: integer("stock_qty").notNull().default(0),
    minStock: integer("min_stock").notNull().default(0),
    moq: integer("moq").notNull().default(1),
    leadTimeDays: integer("lead_time_days").notNull().default(3),
    gstRate: doublePrecision("gst_rate").notNull().default(0),
    lastRestockedAt: timestamp("last_restocked_at", { withTimezone: true }),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("products_business_idx").on(t.businessId),
    unique("products_business_name_uq").on(t.businessId, t.name),
  ]
);

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    saleDate: date("sale_date", { mode: "string" }).notNull(),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: doublePrecision("unit_price").notNull().default(0),
    totalAmount: doublePrecision("total_amount").notNull().default(0),
    customerId: text("customer_id"),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sales_business_date_idx").on(t.businessId, t.saleDate),
    index("sales_business_product_idx").on(t.businessId, t.productName),
  ]
);

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    refId: text("ref_id").notNull(),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    firstPurchaseAt: date("first_purchase_at", { mode: "string" }),
    lastPurchaseAt: date("last_purchase_at", { mode: "string" }),
    totalSpent: doublePrecision("total_spent").notNull().default(0),
    orderCount: integer("order_count").notNull().default(0),
    // Marketing consent. Nothing is drafted for sending to a customer who has not opted in.
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentSource: text("consent_source"),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customers_business_idx").on(t.businessId),
    unique("customers_business_ref_uq").on(t.businessId, t.refId),
  ]
);

export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    type: text("type").notNull(), // restock | sale | adjustment | import
    qtyChange: integer("qty_change").notNull().default(0),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invtx_product_idx").on(t.businessId, t.productId)]
);

export const uploadedFiles = pgTable(
  "uploaded_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    fileName: text("file_name").notNull(),
    datasetType: text("dataset_type").notNull(), // sales | products | inventory | customers
    totalRows: integer("total_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),
    skippedRows: integer("skipped_rows").notNull().default(0),
    issuesJson: text("issues_json"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("uploads_business_idx").on(t.businessId)]
);

export const marketingCampaigns = pgTable(
  "marketing_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    inputsJson: text("inputs_json"),
    engine: text("engine").notNull().default("builtin"),
    status: text("status").notNull().default("draft"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaigns_business_idx").on(t.businessId)]
);

export const waMessages = pgTable(
  "wa_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    direction: text("direction").notNull(), // in | out
    kind: text("kind").notNull().default("text"), // text | voice | brief | promo | system
    body: text("body").notNull(),
    lang: text("lang").notNull().default("en"),
    transcript: text("transcript"),
    durationSec: integer("duration_sec"),
    metaJson: text("meta_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("wa_business_idx").on(t.businessId, t.createdAt)]
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conv_business_idx").on(t.businessId, t.userId)]
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    role: text("role").notNull(), // user | assistant
    content: text("content").notNull(),
    metaJson: text("meta_json"),
    engine: text("engine"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("msgs_conv_idx").on(t.conversationId)]
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("info"), // info | positive | warning | critical
    title: text("title").notNull(),
    message: text("message").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    impactRs: doublePrecision("impact_rs"),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notif_business_idx").on(t.businessId),
    unique("notif_dedupe_uq").on(t.businessId, t.dedupeKey),
  ]
);

export const forecastResults = pgTable(
  "forecast_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    horizonDays: integer("horizon_days").notNull(),
    modelName: text("model_name").notNull(),
    metricsJson: text("metrics_json"),
    seriesJson: text("series_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("fc_business_idx").on(t.businessId)]
);

export const passwordResets = pgTable("password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Cash-flow guardian: money owed to the shop, bills, rent              */
/* ------------------------------------------------------------------ */

export const cashItems = pgTable(
  "cash_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    kind: text("kind").notNull(), // receivable (customer credit) | payable (supplier due) | recurring (rent, salaries)
    party: text("party").notNull(),
    amount: doublePrecision("amount").notNull(),
    issuedOn: date("issued_on", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    recurrence: text("recurrence").notNull().default("none"), // none | weekly | monthly
    status: text("status").notNull().default("open"), // open | settled
    note: text("note"),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cash_items_business_idx").on(t.businessId, t.status)]
);

/* ------------------------------------------------------------------ */
/* Promotion experiments with a held-out control group                   */
/* ------------------------------------------------------------------ */

export const promoExperiments = pgTable(
  "promo_experiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    campaignId: uuid("campaign_id").references(() => marketingCampaigns.id),
    title: text("title").notNull(),
    segment: text("segment").notNull(),
    productName: text("product_name"),
    holdoutPct: integer("holdout_pct").notNull().default(20),
    windowDays: integer("window_days").notNull().default(14),
    startedOn: date("started_on", { mode: "string" }).notNull(),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("experiments_business_idx").on(t.businessId)]
);

export const promoAssignments = pgTable(
  "promo_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    experimentId: uuid("experiment_id").notNull().references(() => promoExperiments.id),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    customerRef: text("customer_ref").notNull(),
    grp: text("grp").notNull(), // treatment | holdout
  },
  (t) => [index("assign_experiment_idx").on(t.experimentId), unique("assign_unique").on(t.experimentId, t.customerRef)]
);

/* ------------------------------------------------------------------ */
/* Autopilot: every suggestion or action the system takes, and why       */
/* ------------------------------------------------------------------ */

export const actionLog = pgTable(
  "action_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    kind: text("kind").notNull(), // purchase_order | promo_draft | winback_draft | cash_warning | suggestion
    title: text("title").notNull(),
    detail: text("detail"),
    why: text("why"),
    level: integer("level").notNull(), // dial level in force when this was logged
    status: text("status").notNull(), // suggested | drafted | auto_approved | approved | received | dismissed
    amount: doublePrecision("amount"),
    payloadJson: text("payload_json"),
    dedupeKey: text("dedupe_key").notNull(),
    demo: boolean("demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("action_log_business_idx").on(t.businessId, t.createdAt), unique("action_log_dedupe_uq").on(t.businessId, t.dedupeKey)]
);
