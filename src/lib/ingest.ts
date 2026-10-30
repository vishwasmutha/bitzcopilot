import "server-only";
import { db } from "@/db";
import {
  customers as customersTable,
  inventoryTransactions,
  products as productsTable,
  sales as salesTable,
  uploadedFiles,
} from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { refreshCustomerAggregates } from "./analytics";

export type DatasetType = "sales" | "products" | "inventory" | "customers";

export const DATASET_FIELDS: Record<DatasetType, { key: string; label: string; required: boolean; kind: "text" | "number" | "date" }[]> = {
  sales: [
    { key: "date", label: "Date", required: true, kind: "date" },
    { key: "product", label: "Product", required: true, kind: "text" },
    { key: "quantity", label: "Quantity", required: false, kind: "number" },
    { key: "unitPrice", label: "Unit price", required: true, kind: "number" },
    { key: "totalAmount", label: "Total amount", required: false, kind: "number" },
    { key: "customerId", label: "Customer ID", required: false, kind: "text" },
  ],
  products: [
    { key: "name", label: "Product name", required: true, kind: "text" },
    { key: "category", label: "Category", required: false, kind: "text" },
    { key: "unitCost", label: "Unit cost", required: false, kind: "number" },
    { key: "sellingPrice", label: "Selling price", required: true, kind: "number" },
    { key: "minStock", label: "Min stock", required: false, kind: "number" },
  ],
  inventory: [
    { key: "product", label: "Product", required: true, kind: "text" },
    { key: "stockQty", label: "Stock quantity", required: true, kind: "number" },
    { key: "minStock", label: "Min stock level", required: false, kind: "number" },
    { key: "unitCost", label: "Unit cost", required: false, kind: "number" },
    { key: "lastRestockedAt", label: "Last restocked", required: false, kind: "date" },
  ],
  customers: [
    { key: "id", label: "Customer ID", required: true, kind: "text" },
    { key: "name", label: "Name", required: false, kind: "text" },
    { key: "email", label: "Email", required: false, kind: "text" },
    { key: "phone", label: "Phone", required: false, kind: "text" },
  ],
};

const MAX_ROWS = 20000;

/* ----------------------------- cleaners ----------------------------- */

/** Accepts ISO, US, EU date strings, datetimes, and Excel serial numbers. */
export function normalizeDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel epoch
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (m) {
    const a = +m[1],
      b = +m[2],
      y = +m[3];
    const [mm, dd] = s.includes("/") && a > 12 ? [a, b] : a > 12 || b > 12 ? [b, a] : [a, b];
    if (mm > 12 || dd > 31) return null;
    return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function toText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  rowErrors: { row: number; message: string }[];
  cleaned: Record<string, unknown>[];
  duplicatesInFile: number;
  missing: Record<string, number>;
};

/** Server-side re-validation of client-parsed rows + mapping. */
export function validateDataset(
  type: DatasetType,
  rawRows: Record<string, unknown>[],
  mapping: Record<string, string>
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rowErrors: { row: number; message: string }[] = [];
  const missing: Record<string, number> = {};
  if (rawRows.length === 0) errors.push("The file contains no data rows.");
  if (rawRows.length > MAX_ROWS) errors.push(`File has ${rawRows.length} rows — the limit is ${MAX_ROWS}.`);
  if (errors.length) return { ok: false, errors, warnings, rowErrors, cleaned: [], duplicatesInFile: 0, missing };

  const fields = DATASET_FIELDS[type];
  for (const f of fields) {
    if (f.required && !mapping[f.key]) errors.push(`Required field "${f.label}" is not mapped.`);
  }
  if (errors.length) return { ok: false, errors, warnings, rowErrors, cleaned: [], duplicatesInFile: 0, missing };

  const get = (row: Record<string, unknown>, key: string): unknown => {
    const col = mapping[key];
    if (!col) return undefined;
    return row[col];
  };

  const cleaned: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let dupes = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const rowNum = i + 2; // header is row 1
    const out: Record<string, unknown> = {};
    let bad = false;
    for (const f of fields) {
      const raw = get(row, f.key);
      if (raw === undefined || raw === null || raw === "") {
        missing[f.key] = (missing[f.key] ?? 0) + 1;
        continue;
      }
      if (f.kind === "number") {
        const n = toNumber(raw);
        if (n === null) {
          rowErrors.push({ row: rowNum, message: `Column "${mapping[f.key]}": "${String(raw)}" is not a valid number` });
          bad = true;
          break;
        }
        out[f.key] = n;
      } else if (f.kind === "date") {
        const d = normalizeDate(raw);
        if (!d) {
          if (f.required) {
            rowErrors.push({ row: rowNum, message: `Column "${mapping[f.key]}": "${String(raw)}" is not a recognizable date` });
            bad = true;
            break;
          }
        } else out[f.key] = d;
      } else {
        out[f.key] = toText(raw);
      }
    }
    if (bad) continue;

    // required checks after cleaning
    for (const f of fields) {
      if (f.required && out[f.key] === undefined) {
        rowErrors.push({ row: rowNum, message: `Missing required value for ${f.label}` });
        bad = true;
        break;
      }
    }
    if (bad) continue;

    if (type === "sales") {
      if (out.totalAmount === undefined) {
        const q = (out.quantity as number) ?? 1;
        out.totalAmount = Math.round(q * ((out.unitPrice as number) ?? 0) * 100) / 100;
      }
      if (out.quantity === undefined) out.quantity = 1;
    }
    if (type === "products") {
      if (out.unitCost === undefined) out.unitCost = 0;
      if (out.minStock === undefined) out.minStock = 0;
    }

    const keyStr = JSON.stringify(out);
    if (seen.has(keyStr)) {
      dupes++;
      continue;
    }
    seen.add(keyStr);
    cleaned.push(out);
  }

  const fieldsWithMissing = fields.filter((f) => (missing[f.key] ?? 0) > 0);
  for (const f of fieldsWithMissing) {
    if (!f.required)
      warnings.push(`${f.label}: ${missing[f.key]} of ${rawRows.length} rows empty (filled with defaults where possible).`);
  }
  if (dupes > 0) warnings.push(`${dupes} duplicate row${dupes > 1 ? "s" : ""} detected in the file — they were removed.`);
  if (rowErrors.length) warnings.push(`${rowErrors.length} row${rowErrors.length > 1 ? "s" : ""} skipped due to validation errors.`);

  return {
    ok: cleaned.length > 0,
    errors,
    warnings,
    rowErrors,
    cleaned,
    duplicatesInFile: dupes,
    missing,
  };
}

/* ------------------------------- import ------------------------------- */

export type ImportSummary = {
  imported: number;
  skippedExisting: number;
  created: number;
  updated: number;
  warnings: string[];
};

export async function importDataset(
  businessId: string,
  type: DatasetType,
  fileName: string,
  cleaned: Record<string, unknown>[],
  validation: ValidationResult,
  isDemo = false
): Promise<ImportSummary> {
  const skippedExisting = 0;
  let imported = 0;
  let created = 0;
  let updated = 0;

  if (type === "sales") {
    const existing = await db
      .select({
        saleDate: salesTable.saleDate,
        productName: salesTable.productName,
        quantity: salesTable.quantity,
        unitPrice: salesTable.unitPrice,
        customerId: salesTable.customerId,
      })
      .from(salesTable)
      .where(eq(salesTable.businessId, businessId));
    const existingKeys = new Set(
      existing.map((r) => `${r.saleDate}|${r.productName}|${r.quantity}|${r.unitPrice}|${r.customerId ?? ""}`)
    );
    const rows = cleaned
      .filter(
        (r) => !existingKeys.has(`${r.date}|${r.product}|${r.quantity ?? 1}|${r.unitPrice}|${(r.customerId as string) ?? ""}`)
      )
      .map((r) => ({
        businessId,
        saleDate: r.date as string,
        productName: r.product as string,
        quantity: (r.quantity as number) ?? 1,
        unitPrice: r.unitPrice as number,
        totalAmount: r.totalAmount as number,
        customerId: (r.customerId as string) ?? null,
        demo: isDemo,
      }));
    for (let i = 0; i < rows.length; i += 500) await db.insert(salesTable).values(rows.slice(i, i + 500));
    imported = rows.length;

    // ensure customer rows exist for referenced IDs
    const custIds = Array.from(new Set(rows.map((r) => r.customerId).filter(Boolean))) as string[];
    if (custIds.length) {
      const existingCust = await db.select({ refId: customersTable.refId }).from(customersTable).where(and(eq(customersTable.businessId, businessId), inArray(customersTable.refId, custIds)));
      const have = new Set(existingCust.map((c) => c.refId));
      const newCusts = custIds.filter((c) => !have.has(c)).map((c) => ({ businessId, refId: c, demo: isDemo }));
      if (newCusts.length) await db.insert(customersTable).values(newCusts);
      created += newCusts.length;
    }
    await refreshCustomerAggregates(businessId);
  } else if (type === "products") {
    const rows = cleaned.map((r) => ({
      name: r.name as string,
      category: (r.category as string) ?? null,
      unitCost: (r.unitCost as number) ?? 0,
      sellingPrice: r.sellingPrice as number,
      minStock: (r.minStock as number) ?? 0,
    }));
    const existing = await db.select().from(productsTable).where(eq(productsTable.businessId, businessId));
    const byName = new Map(existing.map((p) => [p.name, p]));
    for (const r of rows) {
      const cur = byName.get(r.name);
      if (cur) {
        await db
          .update(productsTable)
          .set({
            category: r.category ?? cur.category,
            unitCost: r.unitCost,
            sellingPrice: r.sellingPrice,
            minStock: r.minStock,
            updatedAt: new Date(),
          })
          .where(eq(productsTable.id, cur.id));
        updated++;
      } else {
        await db.insert(productsTable).values({ businessId, ...r, demo: isDemo });
        created++;
      }
      imported++;
    }
  } else if (type === "inventory") {
    const names = cleaned.map((r) => r.product as string);
    const prods = await db.select().from(productsTable).where(and(eq(productsTable.businessId, businessId), inArray(productsTable.name, names)));
    const byName = new Map(prods.map((p) => [p.name, p]));
    for (const r of cleaned) {
      const p = byName.get(r.product as string);
      if (!p) continue;
      const newStock = r.stockQty as number;
      const delta = newStock - p.stockQty;
      await db
        .update(productsTable)
        .set({
          stockQty: newStock,
          minStock: (r.minStock as number) ?? p.minStock,
          unitCost: (r.unitCost as number) ?? p.unitCost,
          lastRestockedAt: (r.lastRestockedAt as string) ? new Date(`${r.lastRestockedAt}T00:00:00`) : p.lastRestockedAt,
          updatedAt: new Date(),
        })
        .where(eq(productsTable.id, p.id));
      if (delta !== 0)
        await db.insert(inventoryTransactions).values({
          businessId,
          productId: p.id,
          type: "import",
          qtyChange: delta,
          note: `Stock synced from ${fileName}`,
        });
      updated++;
      imported++;
    }
    if (updated < cleaned.length)
      validation.warnings.push(`${cleaned.length - updated} product names were not found in your catalog — add them via the Products import or Inventory page first.`);
  } else if (type === "customers") {
    const rows = cleaned.map((r) => ({
      refId: String(r.id),
      name: (r.name as string) ?? null,
      email: (r.email as string) ?? null,
      phone: (r.phone as string) ?? null,
    }));
    const existing = await db.select().from(customersTable).where(eq(customersTable.businessId, businessId));
    const byRef = new Map(existing.map((c) => [c.refId, c]));
    for (const r of rows) {
      const cur = byRef.get(r.refId);
      if (cur) {
        await db
          .update(customersTable)
          .set({ name: r.name ?? cur.name, email: r.email ?? cur.email, phone: r.phone ?? cur.phone })
          .where(eq(customersTable.id, cur.id));
        updated++;
      } else {
        await db.insert(customersTable).values({ businessId, ...r, demo: isDemo });
        created++;
      }
      imported++;
    }
  }

  await db.insert(uploadedFiles).values({
    businessId,
    fileName,
    datasetType: type,
    totalRows: cleaned.length + validation.duplicatesInFile + validation.rowErrors.length,
    importedRows: imported,
    skippedRows: validation.duplicatesInFile + validation.rowErrors.length,
    issuesJson: JSON.stringify({ warnings: validation.warnings, rowErrors: validation.rowErrors.slice(0, 20) }),
    isDemo,
  });

  return { imported, skippedExisting, created, updated, warnings: validation.warnings };
}

export async function getImportHistory(businessId: string) {
  const rows = await db
    .select()
    .from(uploadedFiles)
    .where(eq(uploadedFiles.businessId, businessId))
    .orderBy(desc(uploadedFiles.createdAt))
    .limit(30);
  return rows;
}
