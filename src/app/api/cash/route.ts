import { NextResponse } from "next/server";
import { db } from "@/db";
import { businesses, cashItems } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { cashChanged, getCashOutlook, listCashItems, settleCashItem } from "@/lib/cash";
import { todayISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["receivable", "payable", "recurring"];
const RECUR = ["none", "weekly", "monthly"];

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= "2000-01-01" && s <= "2100-01-01";
}

export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const [outlook, items] = await Promise.all([getCashOutlook(session.business.id), listCashItems(session.business.id)]);
    return NextResponse.json({ ok: true, outlook, items });
  } catch (e) {
    console.error("cash outlook failed", e);
    return NextResponse.json({ error: "Could not work out the cash outlook. Please try again." }, { status: 500 });
  }
}

/** Add a receivable (credit given), a supplier due, or recurring rent. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const b = await req.json().catch(() => null);
  const kind = String(b?.kind ?? "");
  const party = String(b?.party ?? "").trim().slice(0, 80);
  const amount = Number(b?.amount);
  const recurrence = String(b?.recurrence ?? "none");
  const dueDate = b?.dueDate;
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "Choose what this is: credit given, supplier due or rent." }, { status: 400 });
  if (!party) return NextResponse.json({ error: "Add a name, for example the customer or supplier." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return NextResponse.json({ error: "Enter an amount above zero." }, { status: 400 });
  if (!validDate(dueDate)) return NextResponse.json({ error: "Pick a valid due date." }, { status: 400 });
  if (!RECUR.includes(recurrence) || (kind === "receivable" && recurrence !== "none")) return NextResponse.json({ error: "Credit you are owed cannot repeat." }, { status: 400 });
  if (kind === "recurring" && recurrence === "none") return NextResponse.json({ error: "Rent and salaries repeat. Choose weekly or monthly." }, { status: 400 });
  const issuedOn = validDate(b?.issuedOn) ? b.issuedOn : todayISO();
  const [row] = await db
    .insert(cashItems)
    .values({ businessId: session.business.id, kind, party, amount: Math.round(amount * 100) / 100, issuedOn, dueDate, recurrence, note: b?.note ? String(b.note).slice(0, 200) : null })
    .returning();
  cashChanged(session.business.id);
  return NextResponse.json({ ok: true, item: row });
}

/** Today's cash balance, or settle an item. */
export async function PUT(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (b?.settleId) {
    const ok = await settleCashItem(session.business.id, String(b.settleId));
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Item not found." }, { status: 404 });
  }
  const cash = Number(b?.openingCash);
  if (!Number.isFinite(cash) || cash < -1_000_000_000 || cash > 1_000_000_000) return NextResponse.json({ error: "Enter the cash you have today as a number." }, { status: 400 });
  await db.update(businesses).set({ openingCash: Math.round(cash * 100) / 100, openingCashOn: todayISO() }).where(eq(businesses.id, session.business.id));
  cashChanged(session.business.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const rows = await db.delete(cashItems).where(and(eq(cashItems.id, id), eq(cashItems.businessId, session.business.id))).returning({ id: cashItems.id });
  cashChanged(session.business.id);
  return rows.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Item not found." }, { status: 404 });
}
