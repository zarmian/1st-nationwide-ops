/**
 * Whether a staff-app role can open a page: the same rules as
 * src/middleware.ts, which bounces everyone else (src/middleware.test.ts
 * checks the two agree). For menus and links, so nobody is offered a page
 * they'd only be bounced from.
 *
 * OFFICER can only reach /m/* and /submit. /finance and /admin are
 * ADMIN-only, except /admin/reports: DISPATCHER keeps it because they're the
 * reviewers.
 */
export function isAllowedForRole(href: string, role?: string): boolean {
  const path = href.split(/[?#]/)[0];
  if (role === "OFFICER") {
    return (
      path === "/m" ||
      path.startsWith("/m/") ||
      path === "/submit" ||
      path.startsWith("/submit/")
    );
  }
  if (role === "ADMIN") return true;
  if (path === "/finance" || path.startsWith("/finance/")) return false;
  if (path.startsWith("/admin")) {
    return path === "/admin/reports" || path.startsWith("/admin/reports/");
  }
  return true;
}
