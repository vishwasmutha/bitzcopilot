/**
 * TLS settings for the database connection.
 * A local database needs none. A hosted one (Supabase, Render) is always reached over verified TLS.
 * Supabase signs with its own certificate authority, which Node does not trust by default, so its
 * certificate is supplied in DATABASE_CA. Pasted values vary, so this accepts the PEM text with real line
 * breaks, with each break written as a literal backslash-n, and with or without surrounding quotes.
 * Certificate checking is never switched off.
 */
export function dbSsl(url: string): false | true | { ca: string } {
  if (/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)) return false;
  const raw = process.env.DATABASE_CA;
  if (!raw?.trim()) return true;
  const ca = raw
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\r/g, "")
    .replace(/\\n/g, "\n")
    .trim();
  return ca.includes("BEGIN CERTIFICATE") ? { ca } : true;
}
