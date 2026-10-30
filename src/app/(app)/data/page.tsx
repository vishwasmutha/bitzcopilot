"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, History, UploadCloud, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, Select, Spinner, useToast } from "@/components/ui";
import { shortDate } from "@/lib/utils";
import { UpiImport } from "@/components/upi-import";
import { QuickSale } from "@/components/quick-sale";
import { ConnectorsCard } from "@/components/connectors-card";

type DatasetType = "sales" | "products" | "inventory" | "customers";

const TYPES: { key: DatasetType; label: string; desc: string }[] = [
  { key: "sales", label: "Sales data", desc: "Date, product, quantity, price, customer" },
  { key: "products", label: "Product data", desc: "Name, category, cost, price, min stock" },
  { key: "inventory", label: "Inventory data", desc: "Stock levels per product" },
  { key: "customers", label: "Customer data", desc: "ID, name, phone, consent" },
];

const FIELDS: Record<DatasetType, { key: string; label: string; required: boolean }[]> = {
  sales: [
    { key: "date", label: "Date", required: true },
    { key: "product", label: "Product", required: true },
    { key: "quantity", label: "Quantity", required: false },
    { key: "unitPrice", label: "Unit price", required: true },
    { key: "totalAmount", label: "Total amount", required: false },
    { key: "customerId", label: "Customer ID", required: false },
  ],
  products: [
    { key: "name", label: "Product name", required: true },
    { key: "category", label: "Category", required: false },
    { key: "unitCost", label: "Unit cost", required: false },
    { key: "sellingPrice", label: "Selling price", required: true },
    { key: "minStock", label: "Min stock", required: false },
  ],
  inventory: [
    { key: "product", label: "Product", required: true },
    { key: "stockQty", label: "Stock quantity", required: true },
    { key: "minStock", label: "Min stock level", required: false },
    { key: "unitCost", label: "Unit cost", required: false },
    { key: "lastRestockedAt", label: "Last restocked", required: false },
  ],
  customers: [
    { key: "id", label: "Customer ID", required: true },
    { key: "name", label: "Name", required: false },
    { key: "email", label: "Email", required: false },
    { key: "phone", label: "Phone", required: false },
    { key: "consent", label: "Marketing consent (yes/no)", required: false },
  ],
};

const AUTO_MAP: Record<DatasetType, Record<string, RegExp>> = {
  sales: {
    date: /(date|day|day of|time)/i,
    product: /(product|item|name|sku|dish|menu|baked)/i,
    quantity: /(qty|quantity|units|count|pieces)/i,
    unitPrice: /(unit\s*price|price|rate|per\s*unit|selling)/i,
    totalAmount: /(total|amount|net|gross|revenue|sale\s*value)/i,
    customerId: /(customer|client)/i,
  },
  products: {
    name: /(product|item|name|sku)/i,
    category: /(category|type|group|class)/i,
    unitCost: /(unit\s*cost|cost|cog)/i,
    sellingPrice: /(price|mrp|retail|selling)/i,
    minStock: /(min|reorder\s*level|low\s*stock)/i,
  },
  inventory: {
    product: /(product|item|name|sku)/i,
    stockQty: /(stock|quantity|inventory|units|on\s*hand)/i,
    minStock: /(min|reorder|low)/i,
    unitCost: /(cost|cog)/i,
    lastRestockedAt: /(restock|last\s*(received|purchase)|reorder\s*date)/i,
  },
  customers: {
    id: /(customer\s*id|id|code|ref|number)/i,
    name: /(name|customer|full\s*name)/i,
    email: /email/i,
    phone: /(phone|mobile|contact|tel)/i,
    consent: /(consent|opt[\s_-]?in|marketing|whatsapp\s*ok)/i,
  },
};

type Upload = { id: string; fileName: string; datasetType: string; totalRows: number; importedRows: number; skippedRows: number; createdAt: Date | string; isDemo: boolean };

export default function DataPage() {
  const { push } = useToast();
  const [type, setType] = useState<DatasetType>("sales");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [history, setHistory] = useState<Upload[] | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const loadHistory = useCallback(() => {
    fetch("/api/data/history")
      .then((r) => r.json())
      .then((j) => setHistory(j.history ?? []))
      .catch(() => setHistory([]));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  const reset = () => {
    setFile(null);
    setRows(null);
    setHeaders([]);
    setMapping({});
    setParseError(null);
    setImportResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (f: File) => {
    setParseError(null);
    setParsing(true);
    reset();
    setFile(f);
    try {
      const XLSX = await import("@e965/xlsx");
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
      if (!data.length) {
        setParseError("The first sheet has no data rows. Check that the file contains a table with a header row.");
        return;
      }
      const hs = Object.keys(data[0]);
      setHeaders(hs);
      setRows(data);
      const auto: Record<string, string> = {};
      for (const fdef of FIELDS[type]) {
        const match = hs.find((h) => AUTO_MAP[type][fdef.key]?.test(h));
        auto[fdef.key] = match ?? "";
      }
      setMapping(auto);
    } catch {
      setParseError("Could not read that file. Use .csv or .xlsx with a header row.");
    } finally {
      setParsing(false);
    }
  };

  const doImport = async () => {
    if (!rows || !file) return;
    setImporting(true);
    try {
      const r = await fetch("/api/data/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, fileName: file.name, rows, mapping }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        push({ title: "Import failed", desc: j.error ?? "Fix the mapping and retry.", tone: "error" });
        return;
      }
      setImportResult(`${j.imported} rows imported${j.created ? ` · ${j.created} created` : ""}${j.updated ? ` · ${j.updated} updated` : ""}${j.warnings?.length ? ` · ${j.warnings.length} warnings` : ""}`);
      push({ title: "Import complete", desc: `${j.imported} rows imported into your workspace.`, tone: "success" });
      setRows(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      loadHistory();
    } finally {
      setImporting(false);
    }
  };

  const previewRows = (rows ?? []).slice(0, 8);

  const downloadTemplate = () => {
    const csv = `${FIELDS[type].map((field) => field.key).join(",")}\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `bizcopilot-${type}-template.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bc-fade-up">
      <PageHeader title="Data & Import" desc="Bring in your sales, products, inventory or customer files. Columns are auto-detected — adjust the mapping before importing." />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* Step 1: type */}
          <Card title="1 · What are you importing?">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {TYPES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setType(t.key);
                    setRows(null);
                    setHeaders([]);
                    setMapping({});
                    setParseError(null);
                  }}
                  className={
                    "rounded-xl border p-3 text-left transition-all " +
                    (type === t.key
                      ? "border-brand-500 bg-brand-50 ring-2 ring-brand-500/15 dark:bg-brand-500/10"
                      : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800")
                  }
                >
                  <p className={"text-sm font-semibold " + (type === t.key ? "text-brand-700 dark:text-brand-300" : "text-slate-700 dark:text-slate-200")}>{t.label}</p>
                  <p className="mt-0.5 text-xs leading-snug text-slate-400">{t.desc}</p>
                </button>
              ))}
            </div>
            <Button variant="outline" className="mt-4" onClick={downloadTemplate}>
              <Download className="h-4 w-4" /> Download {type} CSV template
            </Button>
          </Card>

          {/* Step 2: file */}
          <Card title="2 · Choose a file" sub="CSV or Excel (.xlsx) · max 20,000 rows">
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            {!file ? (
              <button
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleFile(f);
                }}
                className={
                  "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 transition-colors " +
                  (dragOver ? "border-brand-500 bg-brand-50/50 dark:bg-brand-500/5" : "border-slate-300 hover:border-brand-400 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800/50")
                }
              >
                <UploadCloud className="h-8 w-8 text-brand-500" />
                <p className="text-sm font-medium">Drop your file here, or click to browse</p>
                <p className="text-xs text-slate-400">The file is parsed in your browser — the first sheet is used.</p>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <FileSpreadsheet className="h-8 w-8 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(0)} KB · {rows ? `${rows.length} rows · ${headers.length} columns` : "parsing…"}</p>
                </div>
                <button onClick={reset} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title="Remove file" aria-label="Remove selected file">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {parsing && <Spinner label="Reading file…" />}
            {parseError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{parseError}</p>}
          </Card>

          <ConnectorsCard onFile={handleFile} />

          {/* Step 3: mapping + preview */}
          {rows && headers.length > 0 && (
            <Card title="3 · Map columns & review" sub={`${rows.length} rows ready · mapping is applied before import`}>
              <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS[type].map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      {f.label} {f.required && <span className="text-red-500">*</span>}
                    </span>
                    <Select value={mapping[f.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}>
                      <option value="">— not mapped —</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                    <tr>
                      {headers.map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                          {h}
                          {Object.entries(mapping).some(([k, v]) => v === h && FIELDS[type].find((f) => f.key === k)?.required) && <span className="ml-1 text-brand-500">*</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {previewRows.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                        {headers.map((h) => (
                          <td key={h} className="max-w-[180px] truncate whitespace-nowrap px-3 py-2 text-slate-600 dark:text-slate-300">
                            {r[h] === null || r[h] === undefined ? <span className="text-slate-300 dark:text-slate-600">—</span> : String(r[h])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 8 && <p className="mt-2 text-xs text-slate-400">Showing 8 of {rows.length} rows — all rows are validated and de-duplicated on import.</p>}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button onClick={doImport} loading={importing}>
                  Import {rows.length} rows
                </Button>
                {importResult && (
                  <span className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> {importResult}
                  </span>
                )}
              </div>
            </Card>
          )}
          <UpiImport onDone={loadHistory} />
          <QuickSale onDone={loadHistory} />
        </div>

        {/* History */}
        <Card title="Import history" sub="Your most recent uploads" pad={false}>
          {history === null ? (
            <Spinner />
          ) : history.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={<History className="h-5 w-5" />} title="No imports yet" desc="Files you import will appear here with row counts and any cleaning notes." />
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {(showAllHistory ? history : history.slice(0, 6)).map((h) => (
                <div key={h.id} className="flex items-center gap-3 px-5 py-3.5">
                  <FileSpreadsheet className="h-7 w-7 shrink-0 text-slate-300 dark:text-slate-600" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {h.fileName}
                      {h.isDemo && <Badge tone="warning">Demo</Badge>}
                    </p>
                    <p className="text-xs capitalize text-slate-400">
                      {h.datasetType} · {h.createdAt instanceof Date ? shortDate(h.createdAt.toISOString().slice(0, 10)) : String(h.createdAt).slice(0, 10)}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400">{h.importedRows} in</p>
                    <p className="text-slate-400">{h.skippedRows} skipped</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {history !== null && history.length > 6 && (
            <div className="border-t border-slate-100 px-5 py-3 text-center">
              <button onClick={() => setShowAllHistory(!showAllHistory)} className="text-sm font-semibold text-brand-600 hover:underline">
                {showAllHistory ? "Show fewer" : `Show all ${history.length} imports`}
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
