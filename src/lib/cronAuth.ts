/**
 * Validates a Vercel Cron request. Vercel sends Authorization: Bearer <CRON_SECRET>.
 * In dev (no CRON_SECRET set) we allow it through, so you can hit endpoints
 * by hand from a terminal.
 */
export function isAuthorisedCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}
