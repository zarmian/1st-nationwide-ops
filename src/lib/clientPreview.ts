/**
 * "Preview the client dashboard": an admin sees /client exactly as a
 * customer would. The cookie holds the customer's id; it only counts for an
 * ADMIN session (middleware.ts, getClientScope in authz.ts). No Node imports —
 * middleware runs on the edge.
 */
export const CLIENT_PREVIEW_COOKIE = "client_preview";

/** Two hours, then the admin is back to their own pages. */
export const CLIENT_PREVIEW_MAX_AGE_S = 2 * 60 * 60;

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
