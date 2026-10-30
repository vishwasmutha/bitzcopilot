import { NextResponse } from "next/server";
import { getImportHistory } from "@/lib/ingest";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const history = await getImportHistory(session.business.id);
  return NextResponse.json({ history });
}
