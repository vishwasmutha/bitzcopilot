import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Google Sheets connector. The sheet must be shared as "anyone with the link can view".
 * Only docs.google.com sheet links are accepted. The CSV is returned to the browser,
 * which runs the same column mapping and checks as a file upload.
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.business) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const b = await req.json().catch(() => null);
  const raw = String(b?.url ?? "").trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Paste the full link to your Google Sheet." }, { status: 400 });
  }
  const m = u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})/);
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com" || !m) {
    return NextResponse.json({ error: "That is not a Google Sheets link. It should start with https://docs.google.com/spreadsheets/d/" }, { status: 400 });
  }
  const gid = (u.hash.match(/gid=(\d+)/) ?? u.search.match(/gid=(\d+)/))?.[1];
  const target = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(15_000), headers: { Accept: "text/csv" } });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || type.includes("text/html")) {
      return NextResponse.json({ error: "Google would not share that sheet. Open it, press Share, and set General access to “Anyone with the link can view”, then try again." }, { status: 422 });
    }
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return NextResponse.json({ error: "That sheet is too large (over 5 MB). Export part of it and upload the file." }, { status: 422 });
    const csv = await res.text();
    if (csv.length > MAX_BYTES) return NextResponse.json({ error: "That sheet is too large (over 5 MB). Export part of it and upload the file." }, { status: 422 });
    if (csv.trim().length < 3) return NextResponse.json({ error: "The sheet looks empty." }, { status: 422 });
    return NextResponse.json({ ok: true, csv, fileName: `google-sheet-${m[1].slice(0, 8)}.csv` });
  } catch {
    return NextResponse.json({ error: "Could not reach Google Sheets. Check the link and your connection." }, { status: 502 });
  }
}
