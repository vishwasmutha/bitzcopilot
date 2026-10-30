import { NextResponse } from "next/server";
import { db } from "@/db";
import { sales, uploadedFiles } from "@/db/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { parseUpiText } from "@/lib/impact-math";
import { refreshCustomerAggregates, syncNotifications } from "@/lib/analytics";
import { todayISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRODUCT = "UPI receipt";

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
}

/**
 * Paste lines from a UPI app, bank SMS or passbook. Money received becomes sales.
 * Money paid out is ignored. Send { commit: false } for a preview, { commit: true } to import.
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await req.json().catch(() => null);
    const text = String(body?.text ?? "");
    const commit = body?.commit === true;
    if (text.trim().length < 8) return NextResponse.json({ error: "Paste at least one line from your UPI history or bank messages." }, { status: 400 });
    if (text.length > 200_000 || text.split("\n").length > 3000) return NextResponse.json({ error: "That is too much at once. Paste up to 3,000 lines." }, { status: 400 });

    const parsed = parseUpiText(text, todayISO());
    const rows = parsed.credits.map((c) => ({ ...c, customerId: c.party === "Walk-in UPI" ? null : `UPI-${slug(c.party) || "customer"}` }));

    // skip anything already imported: same day, amount and payer
    let duplicates = 0;
    let fresh = rows;
    if (rows.length) {
      const from = rows.reduce((m, r) => (r.date < m ? r.date : m), rows[0].date);
      const to = rows.reduce((m, r) => (r.date > m ? r.date : m), rows[0].date);
      const existing = await db
        .select({ d: sales.saleDate, a: sales.totalAmount, c: sales.customerId })
        .from(sales)
        .where(and(eq(sales.businessId, session.business.id), eq(sales.productName, PRODUCT), gte(sales.saleDate, from), lte(sales.saleDate, to)));
      const seen = new Map<string, number>();
      for (const e of existing) seen.set(`${e.d}|${e.a}|${e.c ?? ""}`, (seen.get(`${e.d}|${e.a}|${e.c ?? ""}`) ?? 0) + 1);
      fresh = rows.filter((r) => {
        const k = `${r.date}|${r.amount}|${r.customerId ?? ""}`;
        const left = seen.get(k) ?? 0;
        if (left > 0) {
          seen.set(k, left - 1);
          duplicates++;
          return false;
        }
        return true;
      });
    }

    const preview = {
      found: rows.length,
      toImport: fresh.length,
      duplicates,
      debitsIgnored: parsed.debitsIgnored,
      total: Math.round(fresh.reduce((a, r) => a + r.amount, 0) * 100) / 100,
      skipped: parsed.skipped.slice(0, 20),
      sample: fresh.slice(0, 6).map((r) => ({ date: r.date, amount: r.amount, party: r.party })),
    };
    if (!commit) return NextResponse.json({ ok: true, committed: false, ...preview });
    if (!fresh.length) return NextResponse.json({ error: "Nothing new to import from that text.", ...preview }, { status: 422 });

    const values = fresh.map((r) => ({
      businessId: session.business!.id,
      saleDate: r.date,
      productName: PRODUCT,
      quantity: 1,
      unitPrice: r.amount,
      totalAmount: r.amount,
      customerId: r.customerId,
      demo: false,
    }));
    for (let i = 0; i < values.length; i += 500) await db.insert(sales).values(values.slice(i, i + 500));
    await db.insert(uploadedFiles).values({
      businessId: session.business.id,
      fileName: "pasted-upi-history",
      datasetType: "sales",
      totalRows: parsed.credits.length + parsed.skipped.length + parsed.debitsIgnored,
      importedRows: fresh.length,
      skippedRows: parsed.skipped.length + duplicates,
      issuesJson: JSON.stringify({ warnings: [`${parsed.debitsIgnored} payments out were ignored.`, `${duplicates} duplicates skipped.`] }),
      isDemo: false,
    });
    await refreshCustomerAggregates(session.business.id);
    await syncNotifications(session.business.id);
    return NextResponse.json({ ok: true, committed: true, ...preview });
  } catch (e) {
    console.error("upi import failed", e);
    return NextResponse.json({ error: "Could not read that text. Check the lines and try again." }, { status: 500 });
  }
}
