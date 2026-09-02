import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

/**
 * Three-layer auth model:
 *
 *  1. Sign-in: every page except /login, /submit, /jobs, and Next assets
 *     requires a session — that's the `withAuth` baseline.
 *  2. Role: officers are hard-locked to `/m/*` and `/submit`; non-admins are
 *     bounced from `/admin/*` (except the review queue, which dispatcher uses).
 *  3. Server actions still call requireAdmin/requireStaff as a backstop — if
 *     someone slips past middleware, the action throws.
 *
 * `/submit`, `/jobs` and `/duty` are intentionally excluded so any outside
 * officer can browse the public job board, claim a job, or run a single
 * shift from a token link without an account. `/duty/<token>` opens exactly
 * one shift and nothing else — the token is the only credential.
 */
export default withAuth(
  function middleware(req) {
    const pathname = req.nextUrl.pathname;
    const role = req.nextauth.token?.role as
      | "ADMIN"
      | "DISPATCHER"
      | "OFFICER"
      | "PARTNER"
      | "PARTNER_OFFICER"
      | "CUSTOMER"
      | undefined;

    // Forward the pathname as a request header so the (app) layout can
    // do server-side path-aware role gating without re-parsing the URL.
    // Defence-in-depth: even if a route somehow bypasses the redirects
    // below (stale matcher cache, edge runtime hiccup, etc.), the
    // layout will still gate access.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-pathname", pathname);
    const passThrough = NextResponse.next({
      request: { headers: requestHeaders },
    });

    if (!role) return passThrough; // unauthenticated — withAuth's signIn redirect handles it

    const homeFor = (r: typeof role) =>
      r === "OFFICER"
        ? "/m/today"
        : r === "PARTNER"
          ? "/partner"
          : r === "PARTNER_OFFICER"
            ? "/partner/m/today"
            : r === "CUSTOMER"
              ? "/client"
              : "/dispatch";

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
      return passThrough;
    }

    // ── Partner-admin hard-lock ──────────────────────────────────────
    // PARTNER seats see /partner/* EXCEPT /partner/m/* (which is the
    // partner-officer mobile surface — different role, different nav).
    // Everything else (dispatch, finance, admin, sites) is off-limits.
    if (role === "PARTNER") {
      const onPartnerOfficer =
        pathname === "/partner/m" || pathname.startsWith("/partner/m/");
      const partnerOk =
        (pathname === "/partner" || pathname.startsWith("/partner/")) &&
        !onPartnerOfficer;
      if (!partnerOk) {
        const url = req.nextUrl.clone();
        url.pathname = "/partner";
        url.search = "";
        return NextResponse.redirect(url);
      }
      return passThrough;
    }

    // ── Partner-officer hard-lock ────────────────────────────────────
    // PARTNER_OFFICER seats can only see /partner/m/*. Everything else
    // (including the partner-admin pages) is off-limits.
    if (role === "PARTNER_OFFICER") {
      const officerOk =
        pathname === "/partner/m" || pathname.startsWith("/partner/m/");
      if (!officerOk) {
        const url = req.nextUrl.clone();
        url.pathname = "/partner/m/today";
        url.search = "";
        return NextResponse.redirect(url);
      }
      return passThrough;
    }

    // ── Client hard-lock ─────────────────────────────────────────────
    // CUSTOMER seats see only the read-only client portal /client/*.
    // Everything else (dispatch, admin, finance, partner) is off-limits.
    if (role === "CUSTOMER") {
      const clientOk =
        pathname === "/client" || pathname.startsWith("/client/");
      if (!clientOk) {
        const url = req.nextUrl.clone();
        url.pathname = "/client";
        url.search = "";
        return NextResponse.redirect(url);
      }
      return passThrough;
    }

    // ── Partner portal is partner-only ───────────────────────────────
    // Our own staff don't have a partnerId, so /partner/* is meaningless
    // for them. Send them back to their normal home.
    if (pathname === "/partner" || pathname.startsWith("/partner/")) {
      const url = req.nextUrl.clone();
      url.pathname = homeFor(role);
      url.search = "";
      return NextResponse.redirect(url);
    }

    // ── Client portal is customer-only ───────────────────────────────
    // Reached only by ADMIN/DISPATCHER here (the other roles returned
    // above); staff have no customerId so /client/* is meaningless.
    if (pathname === "/client" || pathname.startsWith("/client/")) {
      const url = req.nextUrl.clone();
      url.pathname = homeFor(role);
      url.search = "";
      return NextResponse.redirect(url);
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

    // ── Finance section ──────────────────────────────────────────────
    // Admin-only: P&L, payroll, per-officer pay, per-partner splits.
    // Dispatchers don't need to see what we billed or paid; their job is
    // running the live ops board. Server actions backstop this with
    // requireAdmin() but the redirect keeps them from a blank page.
    if (pathname === "/finance" || pathname.startsWith("/finance/")) {
      if (role !== "ADMIN") {
        const url = req.nextUrl.clone();
        url.pathname = homeFor(role);
        url.search = "";
        return NextResponse.redirect(url);
      }
    }

    return passThrough;
  },
  {
    pages: { signIn: "/login" },
  },
);

export const config = {
  // Catch-all: anything that isn't a Next.js asset, the login page, /submit,
  // /jobs (public job board), /offline, the next-auth callbacks, or a file
  // with an extension (favicons, images, manifest.json, sw.js, etc.).
  // Everything else hits this middleware.
  matcher: [
    // `api/blob` is excluded so anonymous officers on /submit and /duty can
    // get a scoped upload token (the route does its own siteId + size +
    // rate-limit validation; it never relied on a session). `api/webhooks`
    // is excluded so external providers (bOnline calls) can POST in — those
    // routes verify their own shared secret.
    "/((?!api/auth|api/blob|api/webhooks|api/telegram|_next/static|_next/image|login|submit|duty|jobs|offline|robots|sitemap|.*\\..*).*)",
  ],
};
