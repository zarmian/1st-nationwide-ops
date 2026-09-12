// @ts-nocheck
/*
 * Nexus sync robot — runs in GitHub Actions (see .github/workflows/nexus-sync.yml).
 *
 * Logs into the Nexus portal, downloads the sites export, and POSTs it to the
 * app's secure import endpoint (/api/imports/nexus), which runs the existing
 * Nexus importer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  FINISH ME: the login/download steps below use best-guess selectors because
 *  the real portal layout isn't known yet. Fill in the three spots marked
 *  `TODO(portal)` — or set the matching NEXUS_* env vars — once we've seen the
 *  actual login page and export button. Run the workflow with "Preview only"
 *  first; on failure it saves nexus-error.png / nexus-error.html as artifacts
 *  so we can read the real field names off the page.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";

const {
  NEXUS_PORTAL_URL,
  NEXUS_USERNAME,
  NEXUS_PASSWORD,
  NEXUS_IMPORT_URL,
  NEXUS_IMPORT_SECRET,
  NEXUS_PREVIEW,
  // Optional selector overrides so we can tune without editing code:
  NEXUS_USER_SELECTOR,
  NEXUS_PASS_SELECTOR,
  NEXUS_SUBMIT_SELECTOR,
  NEXUS_LOGGED_IN_SELECTOR, // something only present AFTER login (confirms success)
  NEXUS_EXPORT_URL, // if the export is a direct link once logged in
  NEXUS_EXPORT_SELECTOR, // otherwise, the "export / download" button
} = process.env;

const preview = String(NEXUS_PREVIEW).toLowerCase() === "true";

// Required config. If NONE is set the sync simply isn't configured yet, so a
// scheduled run skips quietly (exit 0) instead of emailing a failure every
// night. If SOME are set but others are missing, that's a real misconfig — fail
// loudly (exit 2) so it gets fixed.
const REQUIRED = {
  NEXUS_PORTAL_URL,
  NEXUS_USERNAME,
  NEXUS_PASSWORD,
  NEXUS_IMPORT_URL,
  NEXUS_IMPORT_SECRET,
};
const present = Object.entries(REQUIRED).filter(([, v]) => v);
const missing = Object.entries(REQUIRED).filter(([, v]) => !v).map(([k]) => k);
if (present.length === 0) {
  console.log("Nexus sync not configured yet (no secrets set) — skipping.");
  process.exit(0);
}
if (missing.length > 0) {
  console.error(`Nexus sync is misconfigured — missing: ${missing.join(", ")}`);
  process.exit(2);
}

// Best-guess selectors; override via env once we've seen the real page.
const USER_SEL =
  NEXUS_USER_SELECTOR ||
  'input[name="username"], input[name="email"], input[type="email"], #username';
const PASS_SEL =
  NEXUS_PASS_SELECTOR || 'input[name="password"], input[type="password"], #password';
const SUBMIT_SEL =
  NEXUS_SUBMIT_SELECTOR ||
  'button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Sign in")';

async function firstVisible(page, selector) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: "visible", timeout: 30_000 });
  return loc;
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  let csvText = "";

  try {
    // 1) Login page
    await page.goto(NEXUS_PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // 2) TODO(portal): confirm these field selectors match the real login form.
    await (await firstVisible(page, USER_SEL)).fill(NEXUS_USERNAME);
    await (await firstVisible(page, PASS_SEL)).fill(NEXUS_PASSWORD);
    await (await firstVisible(page, SUBMIT_SEL)).click();

    // 3) Confirm login succeeded. TODO(portal): set NEXUS_LOGGED_IN_SELECTOR to
    //    something only shown when logged in (e.g. a "Log out" link).
    if (NEXUS_LOGGED_IN_SELECTOR) {
      await page.locator(NEXUS_LOGGED_IN_SELECTOR).first().waitFor({ timeout: 30_000 });
    } else {
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    }

    // 4) Get to the export. Either a direct URL, or click a button that triggers
    //    a file download. TODO(portal): set NEXUS_EXPORT_URL or NEXUS_EXPORT_SELECTOR.
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    if (NEXUS_EXPORT_URL) {
      await page.goto(NEXUS_EXPORT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    } else if (NEXUS_EXPORT_SELECTOR) {
      await (await firstVisible(page, NEXUS_EXPORT_SELECTOR)).click();
    } else {
      throw new Error(
        "No export target configured. Set NEXUS_EXPORT_URL or NEXUS_EXPORT_SELECTOR.",
      );
    }
    const download = await downloadPromise;
    const path = await download.path();
    csvText = await fs.readFile(path, "utf8");
    if (!csvText.trim()) throw new Error("Downloaded export was empty.");
    console.log(`Downloaded export: ${csvText.length} bytes`);
  } catch (err) {
    // Save the page so we can read the real selectors off it, then fail.
    await page.screenshot({ path: "nexus-error.png", fullPage: true }).catch(() => {});
    await fs
      .writeFile("nexus-error.html", await page.content().catch(() => ""))
      .catch(() => {});
    await browser.close();
    console.error("Nexus sync failed during login/download:", err?.message ?? err);
    process.exit(1);
  }

  await browser.close();

  // 5) Hand the CSV to the app importer.
  const url = preview ? `${NEXUS_IMPORT_URL}?preview=1` : NEXUS_IMPORT_URL;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NEXUS_IMPORT_SECRET}`,
      "Content-Type": "text/csv",
    },
    body: csvText,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    console.error("Import endpoint rejected the file:", res.status, JSON.stringify(json));
    process.exit(1);
  }
  console.log(
    preview
      ? `Preview OK — would create ${json.toCreate}, update ${json.toUpdate}, write ${json.ratesToWrite} rates (read ${json.read} rows).`
      : `Import OK — created ${json.created}, updated ${json.updated}, rates ${json.ratesWritten}, skipped ${json.skipped?.length ?? 0}.`,
  );
}

run().catch((e) => {
  console.error("Nexus sync crashed:", e);
  process.exit(1);
});
