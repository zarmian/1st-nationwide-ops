/**
 * The sign-in guard (src/middleware.ts). Next only runs a middleware file in
 * the folder that holds `app/` (here `src/`); one anywhere else is ignored
 * without a warning, which is how it once went unused. These tests use Next's
 * own functions, so they judge the file and its matcher the way `next build`
 * and the server do.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";
import type { NextRequestWithAuth } from "next-auth/middleware";
import { encode } from "next-auth/jwt";
import { findPagesDir } from "next/dist/lib/find-pages-dir";
import { getMiddlewareMatchers } from "next/dist/build/analysis/get-page-static-info";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";
import middleware, { config } from "./middleware";
import { isAllowedForRole } from "@/lib/navAccess";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP_DIR = path.join(REPO_ROOT, "src", "app");

describe("where the middleware lives", () => {
  it("sits in the folder that holds app/, where next build looks for it", () => {
    const { pagesDir, appDir } = findPagesDir(REPO_ROOT);
    expect(appDir).toBe(APP_DIR);
    // next/dist/build/index.js: rootDir = path.join(pagesDir || appDir, "..")
    const rootDir = path.join(pagesDir || appDir!, "..");
    expect(existsSync(path.join(rootDir, "middleware.ts"))).toBe(true);
  });

  it("is not back at the repo root, where Next ignores it", () => {
    for (const ext of ["ts", "tsx", "js", "jsx"]) {
      expect(existsSync(path.join(REPO_ROOT, `middleware.${ext}`)), `middleware.${ext}`).toBe(false);
    }
  });
});

describe("which paths it runs on", () => {
  // The same two steps Next uses: compile config.matcher with path-to-regexp
  // (getMiddlewareMatchers), then test each request path against it. The app
  // sets no basePath or i18n, so the Next config passed here is empty.
  const runsOn = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
  const guarded = (pathname: string) => runsOn(pathname, {} as never, {});

  it("lets every API route through: each one checks its own caller", () => {
    const api = [
      "/api/auth/csrf",
      "/api/auth/callback/credentials",
      "/api/cron/fastfield-recheck",
      "/api/imports/fastfield",
      "/api/imports/fastfield/photo",
      "/api/search",
      "/api/submissions",
      "/api/blob/upload-token",
      "/api/webhooks/bonline",
      "/api/telegram/webhook",
      "/api/mcp",
      "/api/oauth/token",
      "/api/shifts/abc/report",
      "/api/visits/abc/on-site",
    ];
    expect(api.filter(guarded)).toEqual([]);
  });

  it("lets the public pages, static files and Next's assets through", () => {
    const open = [
      "/login",
      "/login/client",
      "/login/client/verify",
      "/submit",
      "/jobs",
      "/jobs/abc",
      "/duty/abc",
      "/offline",
      "/oauth/authorize",
      "/monitoring", // Sentry's tunnel route
      "/manifest.webmanifest",
      "/sw.js",
      "/icon.svg",
      "/icon-maskable.svg",
      "/logo.jpg",
      "/favicon.ico",
      "/robots.txt",
      "/sitemap.xml",
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource/api/mcp",
    ];
    expect(open.filter(guarded)).toEqual([]);
  });

  it("guards the staff, officer, partner and client pages", () => {
    const pages = [
      "/",
      "/dispatch",
      "/dispatch/abc",
      "/keys",
      "/keys/1",
      "/shifts",
      "/shifts/abc",
      "/sites/abc",
      "/admin",
      "/admin/fastfield",
      "/admin/fastfield/abc",
      "/admin/officer-rates",
      "/admin/reports",
      "/admin/reports/abc",
      "/finance",
      "/finance/pnl",
      "/m",
      "/m/today",
      "/partner",
      "/partner/m/today",
      "/client",
      "/client/sites",
    ];
    expect(pages.filter((p) => !guarded(p))).toEqual([]);
  });

  it("guards every page folder in (app), however it's named", () => {
    // The exclusions are prefixes: a staff page called /jobs-board or
    // /submitted would quietly go public.
    const staff = readdirSync(path.join(APP_DIR, "(app)"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("("))
      .map((d) => `/${d.name}`);
    expect(staff.length).toBeGreaterThan(10);
    expect(staff.filter((p) => !guarded(p) || !guarded(`${p}/abc`))).toEqual([]);
  });

  it("leaves public only the top-level routes chosen to be public", () => {
    const top = readdirSync(APP_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_") && !d.name.startsWith("("))
      .map((d) => d.name);
    const open = top.filter((name) => !guarded(`/${name}/abc`)).sort();
    expect(open).toEqual([".well-known", "api", "duty", "jobs", "login", "oauth", "offline", "submit"]);
  });
});

type Role = "ADMIN" | "DISPATCHER" | "OFFICER" | "PARTNER" | "PARTNER_OFFICER" | "CUSTOMER";

describe("who is sent where", () => {
  const SECRET = "middleware-test-secret";
  const saved = { secret: process.env.NEXTAUTH_SECRET, url: process.env.NEXTAUTH_URL };
  beforeAll(() => {
    process.env.NEXTAUTH_SECRET = SECRET;
    // http, so next-auth reads the plain (not __Secure-) session cookie.
    process.env.NEXTAUTH_URL = "http://localhost:3000";
  });
  afterAll(() => {
    for (const [key, value] of [["NEXTAUTH_SECRET", saved.secret], ["NEXTAUTH_URL", saved.url]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** "ok" when the request goes on to the page, else where it's sent. */
  async function visit(pathname: string, role?: Role, cookies: Record<string, string> = {}) {
    const jar = { ...cookies };
    if (role) {
      jar["next-auth.session-token"] = await encode({
        token: { sub: "user-1", id: "user-1", role },
        secret: SECRET,
      });
    }
    const headers = new Headers();
    const cookie = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    if (cookie) headers.set("cookie", cookie);
    const req = new NextRequest(new URL(pathname, "http://localhost:3000"), { headers });
    const res = await middleware(req as NextRequestWithAuth, {} as NextFetchEvent);
    const location = res?.headers.get("location");
    if (!location) return "ok";
    const to = new URL(location);
    return to.pathname + to.search;
  }

  it("sends signed-out visitors to sign in, and back afterwards", async () => {
    expect(await visit("/dispatch")).toBe("/login?callbackUrl=%2Fdispatch");
    expect(await visit("/keys/1?tab=notes")).toBe("/login?callbackUrl=%2Fkeys%2F1%3Ftab%3Dnotes");
    // Clients sign in with an emailed link instead.
    expect(await visit("/client")).toBe("/login/client");
    expect(await visit("/client/sites")).toBe("/login/client");
  });

  it("tells the (app) layout which page it's on", async () => {
    const req = new NextRequest(new URL("/m/today", "http://localhost:3000"), {
      headers: {
        cookie: `next-auth.session-token=${await encode({ token: { sub: "u", id: "u", role: "OFFICER" }, secret: SECRET })}`,
        "x-pathname": "/forged", // a visitor can't choose it
      },
    });
    const res = await middleware(req as NextRequestWithAuth, {} as NextFetchEvent);
    expect(res?.headers.get("x-middleware-request-x-pathname")).toBe("/m/today");
  });

  it("keeps officers on their own pages", async () => {
    expect(await visit("/m/today", "OFFICER")).toBe("ok");
    expect(await visit("/m/rota", "OFFICER")).toBe("ok");
    for (const p of ["/keys", "/shifts", "/shifts/abc", "/admin/officer-rates", "/dispatch", "/finance", "/sites/abc", "/partner", "/client"]) {
      expect(await visit(p, "OFFICER"), p).toBe("/m/today");
    }
  });

  it("keeps dispatchers out of finance and admin, except the review queue", async () => {
    for (const p of ["/dispatch", "/shifts", "/keys", "/admin/reports", "/admin/reports/abc", "/m/today"]) {
      expect(await visit(p, "DISPATCHER"), p).toBe("ok");
    }
    for (const p of ["/admin", "/admin/fastfield", "/admin/officer-rates", "/finance", "/finance/pnl", "/partner", "/client"]) {
      expect(await visit(p, "DISPATCHER"), p).toBe("/dispatch");
    }
  });

  it("lets admins in everywhere but the portals (client preview aside)", async () => {
    for (const p of ["/admin/fastfield", "/finance", "/shifts", "/keys", "/dispatch"]) {
      expect(await visit(p, "ADMIN"), p).toBe("ok");
    }
    expect(await visit("/partner", "ADMIN")).toBe("/dispatch");
    expect(await visit("/client", "ADMIN")).toBe("/dispatch");
    expect(await visit("/client", "ADMIN", { client_preview: "c-1" })).toBe("ok");
    expect(await visit("/client", "DISPATCHER", { client_preview: "c-1" })).toBe("/dispatch");
  });

  it("keeps partner and client seats in their portals", async () => {
    expect(await visit("/partner", "PARTNER")).toBe("ok");
    expect(await visit("/partner/activities", "PARTNER")).toBe("ok");
    expect(await visit("/partner/m/today", "PARTNER")).toBe("/partner");
    expect(await visit("/dispatch", "PARTNER")).toBe("/partner");
    expect(await visit("/partner/m/today", "PARTNER_OFFICER")).toBe("ok");
    expect(await visit("/partner", "PARTNER_OFFICER")).toBe("/partner/m/today");
    expect(await visit("/dispatch", "PARTNER_OFFICER")).toBe("/partner/m/today");
    expect(await visit("/client/sites", "CUSTOMER")).toBe("ok");
    expect(await visit("/dispatch", "CUSTOMER")).toBe("/client");
    expect(await visit("/m/today", "CUSTOMER")).toBe("/client");
  });

  it("agrees with the command palette on what each staff role can open", async () => {
    // The palette's own pages, plus the shapes of its search results.
    const hrefs = [
      "/m/today", "/m/rota", "/submit", "/rota", "/dispatch", "/dispatch/new", "/sites", "/sites/new",
      "/officers", "/officers/new", "/keys", "/patrols", "/shifts", "/shifts/new", "/activities",
      "/finance", "/admin", "/admin/reports", "/admin/forms/new",
      "/sites/abc", "/officers/abc/edit", "/dispatch/abc", "/shifts/abc",
    ];
    for (const role of ["ADMIN", "DISPATCHER", "OFFICER"] as const) {
      for (const href of hrefs) {
        expect(isAllowedForRole(href, role), `${role} ${href}`).toBe((await visit(href, role)) === "ok");
      }
    }
  });
});
