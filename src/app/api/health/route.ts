import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** A safe, secret-free hint about why the database did not answer. */
function reason(e: unknown): string {
  const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = err.cause?.code ?? err.code;
  const msg = `${err.cause?.message ?? ""} ${err.message ?? ""}`;
  if (/SELF_SIGNED|certificate|UNABLE_TO_VERIFY/i.test(`${code} ${msg}`)) return "tls: the database certificate is not trusted. Check DATABASE_CA.";
  if (/password authentication|28P01/i.test(`${code} ${msg}`)) return "auth: the database rejected the user or password. Check DATABASE_URL.";
  if (/ENOTFOUND|EAI_AGAIN/.test(`${code} ${msg}`)) return "dns: the database host was not found. Check DATABASE_URL.";
  if (/ECONNREFUSED|ETIMEDOUT|ENETUNREACH/.test(`${code} ${msg}`)) return "network: the database could not be reached.";
  if (/42P01|does not exist/i.test(`${code} ${msg}`)) return "schema: the tables are missing. Run db:push.";
  if (/Tenant or user not found/i.test(msg)) return "auth: Supabase did not recognise the user. Use the pooler connection string.";
  return `error${code ? ` ${code}` : ""}`;
}

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, reason: reason(e) }, { status: 500 });
  }
}
