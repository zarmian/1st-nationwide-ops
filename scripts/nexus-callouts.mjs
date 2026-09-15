// @ts-nocheck
/*
 * Nexus callouts — reads the "due activities" straight off the dashboard, since
 * (unlike the Sites report) they can't be exported. Runs in GitHub Actions.
 *
 * STAGE 1 — DISCOVERY (this file, now): log in, open the dashboard, and save the
 * page HTML + a screenshot as artifacts so the real activity-list markup can be
 * read and a precise parser written.
 *
 * STAGE 2 — LIVE (added once the markup is known): parse each activity row and
 * POST them to /api/imports/nexus-callouts, which creates internal job stubs.
 *
 * Login is the same pinned flow as the sites sync (link.linkbynexus.co.uk:
 * #Username / #Password, a "Login" button, anti-forgery handled, no 2FA).
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";

const env = (k, d = "") => process.env[k] || d;
const NEXUS_USERNAME = env("NEXUS_USERNAME") || env("NEXUS_PORTAL_USERNAME");
const NEXUS_PASSWORD = env("NEXUS_PASSWORD") || env("NEXUS_PORTAL_PASSWORD");
const NEXUS_DASHBOARD_URL = env("NEXUS_DASHBOARD_URL", "https://link.linkbynexus.co.uk/");
const USER_SEL = env("NEXUS_USER_SELECTOR", "#Username");
const PASS_SEL = env("NEXUS_PASS_SELECTOR", "#Password");
const SUBMIT_SEL = env("NEXUS_SUBMIT_SELECTOR", 'button[type="submit"]');

if (!NEXUS_USERNAME || !NEXUS_PASSWORD) {
  // Not configured yet — skip quietly (don't fail the scheduled/manual run).
  console.log("Nexus callouts not configured (no username/password) — skipping.");
  process.exit(0);
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    // Open the dashboard; if logged out we get bounced to the login form.
    await page.goto(NEXUS_DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

    if ((await page.locator(PASS_SEL).count()) > 0) {
      await page.locator(USER_SEL).first().fill(NEXUS_USERNAME);
      await page.locator(PASS_SEL).first().fill(NEXUS_PASSWORD);
      await Promise.all([
        page.waitForLoadState("domcontentloaded", { timeout: 60_000 }),
        page.locator(SUBMIT_SEL).first().click(),
      ]);
      if ((await page.locator(PASS_SEL).count()) > 0) {
        throw new Error("Login appears to have failed (still on the login page).");
      }
      // Make sure we're on the dashboard, not wherever login landed us.
      await page.goto(NEXUS_DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }

    // Let any client-side activity list render.
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    // Save the dashboard so the activity markup can be read and parsed.
    const html = await page.content();
    await fs.writeFile("nexus-dashboard.html", html);
    await page.screenshot({ path: "nexus-dashboard.png", fullPage: true }).catch(() => {});
    console.log(
      `Saved dashboard: nexus-dashboard.html (${html.length} bytes) + nexus-dashboard.png. ` +
        `Download the 'nexus-callouts-discovery' artifact to build the reader.`,
    );
  } catch (err) {
    await page.screenshot({ path: "nexus-dashboard.png", fullPage: true }).catch(() => {});
    await fs.writeFile("nexus-dashboard.html", await page.content().catch(() => "")).catch(() => {});
    await browser.close();
    console.error("Nexus callouts discovery failed:", err?.message ?? err);
    process.exit(1);
  }

  await browser.close();
}

run().catch((e) => {
  console.error("Nexus callouts crashed:", e);
  process.exit(1);
});
