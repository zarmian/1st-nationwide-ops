// @ts-nocheck
/*
 * Nexus sync robot — runs in GitHub Actions (see .github/workflows/nexus-sync.yml).
 *
 * Logs into the Nexus "Link" portal, opens the Sites report, downloads the
 * export, and POSTs it to the app's secure import endpoint (/api/imports/nexus),
 * which runs the existing Nexus importer.
 *
 * Login is fully pinned to the real portal (link.linkbynexus.co.uk):
 *   - login page at "/", form posts to /login, fields #Username / #Password,
 *     a "Login" submit button, an anti-forgery token (submitted automatically),
 *     no two-factor.
 *   - hitting the report URL while logged out 302s to "/?returnUrl=…", so we
 *     just navigate to the report and fill the login it bounces us to.
 *
 * The one thing not yet pinned is the EXPORT control on the Sites report page
 * (it's behind login). The script auto-detects a link/button labelled
 * export/CSV/download; if the portal uses something else, set NEXUS_EXPORT_URL
 * (a direct download link) or NEXUS_EXPORT_SELECTOR. On any failure it saves
 * nexus-error.png / nexus-error.html as workflow artifacts so the real control
 * can be read off the page.
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";

const { NEXUS_USERNAME, NEXUS_PASSWORD, NEXUS_IMPORT_URL, NEXUS_IMPORT_SECRET, NEXUS_PREVIEW } =
  process.env;

// Overridable, with real-portal defaults. Use `|| default` (not destructuring
// defaults) because GitHub Actions sets an unset secret to "" — which would
// otherwise wipe the default.
const env = (k, d = "") => process.env[k] || d;
const NEXUS_REPORT_URL = env("NEXUS_REPORT_URL", "https://link.linkbynexus.co.uk/Reports/Sites");
const NEXUS_USER_SELECTOR = env("NEXUS_USER_SELECTOR", "#Username");
const NEXUS_PASS_SELECTOR = env("NEXUS_PASS_SELECTOR", "#Password");
const NEXUS_SUBMIT_SELECTOR = env("NEXUS_SUBMIT_SELECTOR", 'button[type="submit"]');
// Export target — leave unset to auto-detect; set one to pin it.
const NEXUS_EXPORT_URL = env("NEXUS_EXPORT_URL");
const NEXUS_EXPORT_SELECTOR = env("NEXUS_EXPORT_SELECTOR");

const preview = String(NEXUS_PREVIEW).toLowerCase() === "true";

// If NONE of the required secrets is set the sync just isn't configured yet, so
// a scheduled run skips quietly. If SOME are set but not all, that's a real
// misconfig — fail loudly.
const REQUIRED = {
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

async function findExport(page) {
  if (NEXUS_EXPORT_SELECTOR) return page.locator(NEXUS_EXPORT_SELECTOR).first();
  // Auto-detect a link/button that reads like an export control.
  const byRole = page
    .getByRole("link", { name: /export|csv|download/i })
    .or(page.getByRole("button", { name: /export|csv|download/i }));
  if (await byRole.count()) return byRole.first();
  const byText = page.locator(
    'a:has-text("Export"), button:has-text("Export"), a:has-text("CSV"), button:has-text("CSV"), a:has-text("Download"), button:has-text("Download")',
  );
  if (await byText.count()) return byText.first();
  return null;
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  let csvText = "";

  try {
    // Navigate to the report; if logged out, the portal bounces us to the login
    // page (with returnUrl back to the report).
    await page.goto(NEXUS_REPORT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

    const needsLogin = (await page.locator(NEXUS_PASS_SELECTOR).count()) > 0;
    if (needsLogin) {
      await page.locator(NEXUS_USER_SELECTOR).first().fill(NEXUS_USERNAME);
      await page.locator(NEXUS_PASS_SELECTOR).first().fill(NEXUS_PASSWORD);
      await Promise.all([
        page.waitForLoadState("domcontentloaded", { timeout: 60_000 }),
        page.locator(NEXUS_SUBMIT_SELECTOR).first().click(),
      ]);
      // Confirm we're through: the password field should be gone. If it's still
      // there, the login was rejected.
      if ((await page.locator(NEXUS_PASS_SELECTOR).count()) > 0) {
        throw new Error("Login appears to have failed (still on the login page).");
      }
      // Make sure we're on the report (returnUrl usually handles this).
      if (!page.url().includes("/Reports/Sites")) {
        await page.goto(NEXUS_REPORT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      }
    }

    // Trigger the export and capture the download.
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    if (NEXUS_EXPORT_URL) {
      await page.goto(NEXUS_EXPORT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    } else {
      const exportEl = await findExport(page);
      if (!exportEl) {
        throw new Error(
          "Couldn't find an export control on the Sites report. Set NEXUS_EXPORT_URL or NEXUS_EXPORT_SELECTOR (see nexus-error.html for the real control).",
        );
      }
      await exportEl.click();
    }
    const download = await downloadPromise;
    csvText = await fs.readFile(await download.path(), "utf8");
    if (!csvText.trim()) throw new Error("Downloaded export was empty.");
    console.log(`Downloaded export: ${csvText.length} bytes`);
  } catch (err) {
    await page.screenshot({ path: "nexus-error.png", fullPage: true }).catch(() => {});
    await fs.writeFile("nexus-error.html", await page.content().catch(() => "")).catch(() => {});
    await browser.close();
    console.error("Nexus sync failed during login/download:", err?.message ?? err);
    process.exit(1);
  }

  await browser.close();

  // Hand the CSV to the app importer.
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
