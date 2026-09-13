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
// "Active sites" filter, applied before export. Configurable; otherwise
// best-effort auto-detect. VALUE is the option label / value to choose.
const NEXUS_ACTIVE_FILTER_SELECTOR = env("NEXUS_ACTIVE_FILTER_SELECTOR");
const NEXUS_ACTIVE_FILTER_VALUE = env("NEXUS_ACTIVE_FILTER_VALUE", "Active");
// This portal needs an explicit "Apply filter" click before the list + export
// button appear. Configurable; otherwise best-effort auto-detect.
const NEXUS_APPLY_FILTER_SELECTOR = env("NEXUS_APPLY_FILTER_SELECTOR");

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
  // Prefer an explicit "Export CSV" / "CSV" control (that's what the report
  // has), then fall back to generic export/download.
  const candidates = [
    page.getByRole("link", { name: /export.*csv|csv|export to csv/i }),
    page.getByRole("button", { name: /export.*csv|csv|export to csv/i }),
    page.getByRole("link", { name: /export|download/i }),
    page.getByRole("button", { name: /export|download/i }),
    page.locator(
      'a:has-text("Export CSV"), button:has-text("Export CSV"), a:has-text("CSV"), button:has-text("CSV"), a:has-text("Export"), button:has-text("Export")',
    ),
  ];
  for (const c of candidates) {
    if (await c.count()) return c.first();
  }
  return null;
}

/** Set the report's filter to "active sites" before exporting. Uses the
 *  configured control if given, else best-effort auto-detect. Logs what it did
 *  so a Preview run reveals whether the right rows were exported. */
async function setActiveFilter(page) {
  try {
    if (NEXUS_ACTIVE_FILTER_SELECTOR) {
      const el = page.locator(NEXUS_ACTIVE_FILTER_SELECTOR).first();
      await el.waitFor({ state: "visible", timeout: 15_000 });
      const tag = (await el.evaluate((n) => n.tagName)).toLowerCase();
      const type = (await el.getAttribute("type")) ?? "";
      if (tag === "select") {
        await el
          .selectOption({ label: NEXUS_ACTIVE_FILTER_VALUE })
          .catch(() => el.selectOption(NEXUS_ACTIVE_FILTER_VALUE));
      } else if (type === "checkbox") {
        await el.check();
      } else {
        await el.click();
      }
      console.log(`Active filter set via ${NEXUS_ACTIVE_FILTER_SELECTOR}.`);
    } else {
      let done = false;
      // A status <select> that offers an "Active" option.
      const selects = page.locator("select");
      const n = await selects.count();
      for (let i = 0; i < n && !done; i++) {
        const opt = selects.nth(i).locator("option", { hasText: /^\s*active\s*$/i });
        if (await opt.count()) {
          await selects.nth(i).selectOption({ label: (await opt.first().innerText()).trim() });
          console.log("Active filter: chose 'Active' in a dropdown.");
          done = true;
        }
      }
      // Else a checkbox labelled "Active".
      if (!done) {
        const cb = page.getByLabel(/active/i).first();
        if ((await cb.count()) && (await cb.getAttribute("type")) === "checkbox") {
          if (!(await cb.isChecked())) await cb.check();
          console.log("Active filter: ticked an 'Active' checkbox.");
          done = true;
        }
      }
      if (!done) {
        console.warn(
          "Active filter: no control auto-detected — exporting the report's default view. Pin it with NEXUS_ACTIVE_FILTER_SELECTOR/VALUE (or send the page HTML).",
        );
      }
    }
    // This portal only shows the list + Export CSV after "Apply filter" is
    // clicked, so selecting the value isn't enough — click Apply.
    await clickApplyFilter(page);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  } catch (e) {
    console.warn("Active filter: attempt failed —", e?.message ?? e);
  }
}

/** Click the "Apply filter" control so the list + export button render. */
async function clickApplyFilter(page) {
  const tryClick = async (loc, label) => {
    if ((await loc.count()) > 0) {
      await loc.first().click();
      console.log(`Clicked "${label}".`);
      return true;
    }
    return false;
  };
  if (NEXUS_APPLY_FILTER_SELECTOR) {
    if (await tryClick(page.locator(NEXUS_APPLY_FILTER_SELECTOR), "apply filter (configured)"))
      return;
  }
  const candidates = [
    [page.getByRole("button", { name: /apply(\s*filter)?/i }), "Apply filter"],
    [page.getByRole("link", { name: /apply(\s*filter)?/i }), "Apply filter"],
    [
      page.locator(
        'button:has-text("Apply"), a:has-text("Apply"), input[type="submit"][value*="Apply" i]',
      ),
      "Apply",
    ],
    [page.getByRole("button", { name: /^(search|go|update|refresh)$/i }), "filter submit"],
  ];
  for (const [loc, label] of candidates) {
    if (await tryClick(loc, label)) return;
  }
  console.warn(
    'Apply-filter button not found — the list/export may not appear. Pin it with NEXUS_APPLY_FILTER_SELECTOR.',
  );
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

    // Filter to active sites before exporting.
    await setActiveFilter(page);

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
  if (preview) {
    // Preview is a cheap read — send it whole.
    const { res, json } = await postCsv(csvText, true);
    if (!res.ok || json.ok === false) {
      console.error("Import endpoint rejected the file:", res.status, JSON.stringify(json));
      process.exit(1);
    }
    console.log(
      `Preview OK — would create ${json.toCreate}, update ${json.toUpdate}, write ${json.ratesToWrite} rates (read ${json.read} rows).`,
    );
    return;
  }

  // Real import writes each row in its own transaction, which can exceed the
  // app's serverless time limit for the whole file. Send it in small chunks so
  // each request finishes quickly. Upsert-only, so chunking is safe.
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = lines[0];
  const rows = lines.slice(1);
  const size = Number(process.env.NEXUS_IMPORT_CHUNK || "50") || 50;
  let created = 0, updated = 0, rates = 0, skipped = 0, chunkNo = 0;

  for (let i = 0; i < rows.length; i += size) {
    const chunk = [header, ...rows.slice(i, i + size)].join("\n");
    chunkNo++;
    let ok = false;
    let last = { status: 0, json: {} };
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      const { res, json } = await postCsv(chunk, false);
      last = { status: res.status, json };
      if (res.ok && json.ok !== false) {
        ok = true;
        created += json.created || 0;
        updated += json.updated || 0;
        rates += json.ratesWritten || 0;
        skipped += json.skipped?.length || 0;
      } else if (res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000 * attempt)); // transient — retry
      } else {
        break; // 4xx — won't fix itself
      }
    }
    if (!ok) {
      console.error(
        `Chunk ${chunkNo} (rows ${i + 1}-${Math.min(i + size, rows.length)}) failed:`,
        last.status,
        JSON.stringify(last.json),
      );
      process.exit(1);
    }
    console.log(
      `Chunk ${chunkNo}: ${Math.min(i + size, rows.length)}/${rows.length} rows → created ${created}, updated ${updated}, rates ${rates}`,
    );
  }

  console.log(
    `Import OK — created ${created}, updated ${updated}, rates ${rates}, skipped ${skipped} across ${chunkNo} chunks.`,
  );
}

async function postCsv(csv, preview) {
  const url = preview ? `${NEXUS_IMPORT_URL}?preview=1` : NEXUS_IMPORT_URL;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NEXUS_IMPORT_SECRET}`,
      "Content-Type": "text/csv",
    },
    body: csv,
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

run().catch((e) => {
  console.error("Nexus sync crashed:", e);
  process.exit(1);
});
