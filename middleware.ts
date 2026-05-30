import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Three-layer auth model:
 *
 *  1. Sign-in: every page except /login, /submit, and Next assets requires a
 *     session — that's the `withAuth` baseline.
 *  2. Role: officers are hard-locked to `/m/*` and `/submit`; non-admins are
 *     bounced from `/admin/*` (except the review queue, which dispatcher uses).
 *  3. Server actions still call requireAdmin/requireStaff as a backstop — if
 *     someone slips past middleware, the action throws.
 *
 * `/submit` is intentionally excluded so any officer (including third-party)
 * can fill it from a phone link without an account.
 */
export default withAuth(
  function middleware(req) {
    const pathname = req.nextUrl.pathname;
    const role = req.nextauth.token?.role as
      | "ADMIN"
      | "DISPATCHER"
      | "OFFICER"
      | undefined;
    if (!role) return; // unauthenticated — withAuth's signIn redirect handles it

    const homeFor = (r: typeof role) =>
      r === "OFFICER" ? "/m/today" : "/dispatch";

    // ── Officer hard-lock ────────────────────────────────────────────
    // Officers can only see /m/* and /submit. Anything else → bounce home.
    if (role === "OFFICER") {
      const officerOk =
        pathname === "/m" ||
        pathname.startsWith("/m/") ||
        pathname === "/submit" ||
        pathname.startsWith("/submit/");
      if (!officerOk) {
        const url = req.nextUrl.clone();
        url.pathname = "/m/today";
        url.search = "";
        return NextResponse.redirect(url);
      }
      return;
    }

    // ── Admin section ────────────────────────────────────────────────
    // Dispatcher keeps /admin/reports/* (the review queue) — they're trusted
    // reviewers. Everything else under /admin is admin-only.
    if (pathname.startsWith("/admin")) {
      const isReviewQueue =
        pathname === "/admin/reports" || pathname.startsWith("/admin/reports/");
      if (!isReviewQueue && role !== "ADMIN") {
        const url = req.nextUrl.clone();
        url.pathname = homeFor(role);
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
  },
  {
    pages: { signIn: "/login" },
  },
);

export const config = {
  // Catch-all: anything that isn't a Next.js asset, the login page, /submit,
  // /offline, the next-auth callbacks, or a file with an extension (favicons,
  // images, manifest.json, sw.js, etc.). Everything else hits this middleware.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|login|submit|offline|robots|sitemap|.*\\..*).*)",
  ],
};
