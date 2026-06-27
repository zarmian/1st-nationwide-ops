/**
 * Absolute URL of the public officer duty page for a shift token.
 * Base comes from NEXTAUTH_URL (set in Vercel to the live origin).
 *
 * Kept out of any "use server" module so non-action code (the shift detail
 * page, the link card) can import it directly.
 */
export function dutyUrl(token: string): string {
  const fromEnv =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const base = fromEnv.replace(/\/$/, "");
  return `${base}/duty/${token}`;
}
