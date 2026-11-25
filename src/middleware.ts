import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import { CLIENT_PREVIEW_COOKIE } from "@/lib/clientPreview";

/**
 * The sign-in guard for pages. It must live in `src/`, the folder that holds
 * `app/`: Next ignores a `middleware.ts` anywhere else, silently (until Nov
 * 2026 it sat at the repo root and never ran). src/middleware.test.ts checks
 * where it is and what the matcher covers.
 *
 *  1. Sign-in: every page except the public ones (see `config` below) needs
 *     a session — that's the `withAuth` baseline.
 *  2. Role: officers are hard-locked to `/m/*` and `/submit`; non-admins are
 *     bounced from `/admin/*` (except the review queue, which dispatchers
 *     use) and `/finance`; partner and client seats stay in their portals.
 *  3. Backstops: the (app) layout re-checks the role using `x-pathname`, and
 *     pages and server actions call requireAdmin/requireStaff — if someone
 *     slips past middleware, those still hold.
 *
 * API routes (`/api/*`) are not covered: each one checks its own caller.
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

    if (!role) {
      // Signed out on the client dashboard (let through by `authorized`
      // below): clients sign in with an emailed link, not the staff page.
      if (pathname === "/client" || pathname.startsWith("/client/")) {
        const url = req.nextUrl.clone();
        url.pathname = "/login/client";
        url.search = "";
        return NextResponse.redirect(url);
      }
      return passThrough; // unauthenticated — withAuth's signIn redirect handles it
    }

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
    // above); staff have no customerId so /client/* is meaningless —
    // except an admin previewing a customer's dashboard.
    if (pathname === "/client" || pathname.startsWith("/client/")) {
      if (role === "ADMIN" && req.cookies.get(CLIENT_PREVIEW_COOKIE)?.value) {
        return passThrough;
      }
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
    callbacks: {
      // Signed-out visitors to the client dashboard reach the middleware
      // above, which sends them to the client sign-in page.
      authorized: ({ req, token }) =>
        Boolean(token) ||
        req.nextUrl.pathname === "/client" ||
        req.nextUrl.pathname.startsWith("/client/"),
    },
  },
);

export const config = {
  // Pages only. Each name below is a prefix (`login` also covers
  // /login/client); everything else hits this middleware.
  //
  // - `api/`: every API route checks its own caller (session + role, a shared
  //   secret, the cron secret or a token) and must answer callers that have
  //   no session — Vercel crons, the portal robots' imports, webhooks,
  //   Telegram, the Claude connector (MCP/OAuth), blob upload tokens for
  //   /submit and /duty, the /submit form's POST. A sign-in redirect would
  //   break them (Vercel crons don't follow redirects).
  // - Public pages: login, submit, duty, jobs (public job board), offline,
  //   and the `oauth` consent page (it checks the session itself).
  // - `monitoring`: Sentry's tunnel route, when Sentry is switched on.
  // - Next's assets (`_next/static`, `_next/image`), robots/sitemap, and any
  //   path with a dot: static files (icons, manifest.webmanifest, sw.js) and
  //   `/.well-known/*`.
  //
  // Next reads this at build time, so it must stay a plain string.
  matcher: [
    "/((?!api/|oauth|_next/static|_next/image|login|submit|duty|jobs|offline|monitoring|robots|sitemap|.*\\..*).*)",
  ],
};
