/**
 * TLS settings for the database connection.
 * A local database needs none. A hosted one (Supabase, Render) is always reached over verified TLS.
 * Supabase signs with its own certificate authority, which Node does not trust by default, so its
 * certificate is supplied in DATABASE_CA (the PEM text; "\n" written as a literal backslash-n is accepted).
 * Certificate checking is never switched off.
 */
export function dbSsl(url: string): false | true | { ca: string } {
  if (/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) return false;
  const ca = process.env.DATABASE_CA?.replace(/\\n/g, "\n").trim();
  return ca ? { ca } : true;
}
