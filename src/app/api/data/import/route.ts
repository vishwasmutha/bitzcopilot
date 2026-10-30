import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { DATASET_FIELDS, importDataset, validateDataset, type DatasetType } from "@/lib/ingest";
import { syncNotifications } from "@/lib/analytics";

export const runtime = "nodejs";

type Req = { type: DatasetType; fileName: string; rows: Record<string, unknown>[]; mapping: Record<string, string> };

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = (await req.json().catch(() => null)) as Req | null;
    const type = body?.type;
    if (!type || !Object.keys(DATASET_FIELDS).includes(type))
      return NextResponse.json({ error: "Unknown dataset type." }, { status: 400 });
    if (!Array.isArray(body?.rows) || body.rows.length === 0)
      return NextResponse.json({ error: "No rows to import. Choose a file with data." }, { status: 400 });
    if (body.rows.length > 20000) return NextResponse.json({ error: "Too many rows (max 20,000)." }, { status: 400 });

    const validation = validateDataset(type, body.rows, body.mapping ?? {});
    if (!validation.ok)
      return NextResponse.json(
        { error: validation.errors[0] ?? "Validation failed.", errors: validation.errors, warnings: validation.warnings, rowErrors: validation.rowErrors.slice(0, 30) },
        { status: 422 }
      );

    const summary = await importDataset(session.business.id, type, body.fileName ?? "upload", validation.cleaned, validation);
    await syncNotifications(session.business.id);
    return NextResponse.json({ ok: true, ...summary, rowErrors: validation.rowErrors.slice(0, 30) });
  } catch (e) {
    console.error("import failed", e);
    return NextResponse.json({ error: "Import failed. Please check the file and try again." }, { status: 500 });
  }
}
