// @ts-nocheck
/*
 * Keyholding Company (Chase2Base / CUBA-Vaadin) — Jobs reader.
 *
 * Drives the real UI (no REST API exists): logs in, opens Jobs Management →
 * Jobs, sets the From/To date filter, clicks Find, and reads the results table
 * (mapping the 33 columns by header), paging through with the CUBA pager.
 *
 * DRY-RUN by default: saves the mapped jobs to keyholding-jobs.json + a capture
 * so the extraction/paging can be verified. When KEYHOLDING_JOBS_IMPORT_URL +
 * NEXUS_IMPORT_SECRET are set it will POST them (import wiring added once the
 * read is confirmed).
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";

const env = (k, d = "") => process.env[k] || d;
const USERNAME = env("KEYHOLDING_PORTAL_USERNAME") || env("KEYHOLDING_USERNAME");
const PASSWORD = env("KEYHOLDING_PORTAL_PASSWORD") || env("KEYHOLDING_PASSWORD");
const LOGIN_URL = env("KEYHOLDING_LOGIN_URL", "https://chase2base.co.uk/app/#login");

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const uk = (isoStr) => {
  const [y, m, d] = isoStr.split("-");
  return `${d}/${m}/${y}`;
};
const daysAgo = (n) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
};
const FROM = env("KEYHOLDING_FROM", daysAgo(2));
const TO = env("KEYHOLDING_TO", iso(today));
const MAX_PAGES = Number(env("KEYHOLDING_MAX_PAGES", "300")) || 300;

if (!USERNAME || !PASSWORD) {
  console.log("Keyholding not configured (no username/password) — skipping.");
  process.exit(0);
}

async function login(page) {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.locator("input.c-login-username").first().fill(USERNAME);
  await page.locator("input.c-login-password").first().fill(PASSWORD);
  await page.locator(".c-login-submit-button").first().click();
  await page.waitForTimeout(5000);
  if ((await page.locator("input.c-login-password").count()) > 0) {
    throw new Error("Login failed (still on login page).");
  }
}

async function openJobs(page) {
  await page.getByRole("menuitem", { name: /jobs management/i }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(1200);
  let jobs = page.getByRole("menuitem", { name: "Jobs", exact: true }).first();
  if ((await jobs.count()) === 0) {
    jobs = page.locator(".v-menubar-popup").getByText("Jobs", { exact: true }).first();
  }
  await jobs.click({ timeout: 10_000 });
  await page.waitForTimeout(6000);
}

async function setDatesAndFind(page) {
  const dfs = page.locator("input.v-datefield-textfield");
  const n = await dfs.count();
  console.log(`Found ${n} date fields; setting From=${uk(FROM)} To=${uk(TO)}`);
  if (n >= 1) {
    await dfs.nth(0).fill(uk(FROM));
    await dfs.nth(0).press("Enter");
  }
  if (n >= 2) {
    await dfs.nth(1).fill(uk(TO));
    await dfs.nth(1).press("Enter");
  }
  await page.keyboard.press("Escape").catch(() => {}); // close any date popup
  await page.waitForTimeout(500);
  // The Find button is a Vaadin div-button; match its caption exactly (its
  // accessible name is polluted by the FontAwesome icon).
  const find = page
    .locator('.v-button:has(.v-button-caption:text-is("Find"))')
    .first();
  await find.click({ timeout: 15_000 });
  await page.waitForTimeout(4000);
}

/** Read the visible v-table: header captions + each row's cell text. */
async function extractTable(page) {
  return page.evaluate(() => {
    const txt = (el) => (el?.innerText || el?.textContent || "").trim();
    const table = document.querySelector(".v-table");
    if (!table) return { headers: [], rows: [], status: null };
    const headers = Array.from(
      table.querySelectorAll(".v-table-header-cell .v-table-caption-container"),
    ).map(txt);
    const rows = Array.from(table.querySelectorAll("tr.v-table-row")).map((tr) =>
      Array.from(tr.querySelectorAll("td .v-table-cell-wrapper")).map(txt),
    );
    const status = txt(document.querySelector(".c-paging-status")) || null;
    return { headers, rows, status };
  });
}

/** Best-effort: click the pager's "next" control. Returns false if none/last. */
async function nextPage(page) {
  const cands = [
    ".c-paging-wrap [class*='angle-right']:not([class*='double'])",
    ".c-paging-wrap .v-button:not(.v-disabled) .fa-angle-right",
    ".c-paging-wrap [title='Next']",
    ".c-paging-wrap a:has-text('›')",
  ];
  for (const sel of cands) {
    const loc = page.locator(sel).first();
    try {
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        await loc.click({ timeout: 5_000 });
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

function mapRows(headers, rows) {
  return rows.map((cells) => {
    const o = {};
    headers.forEach((h, i) => {
      o[h] = (cells[i] ?? "").trim();
    });
    return o;
  });
}

async function run() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const byRef = new Map();
  let headersSeen = [];
  let lastStatus = null;

  try {
    await login(page);
    console.log("Login OK.");
    await openJobs(page);
    await setDatesAndFind(page);

    for (let p = 1; p <= MAX_PAGES; p++) {
      const { headers, rows, status } = await extractTable(page);
      if (headers.length) headersSeen = headers;
      lastStatus = status;
      const before = byRef.size;
      for (const cells of rows) {
        const ref = (cells[0] ?? "").trim();
        if (ref) byRef.set(ref, cells);
      }
      const added = byRef.size - before;
      console.log(`Page ${p}: +${added} rows (total ${byRef.size}) — status "${status}"`);
      if (added === 0) break;
      if (!(await nextPage(page))) break;
      await page.waitForTimeout(2500);
    }

    const jobs = mapRows(headersSeen, Array.from(byRef.values()));
    await fs.writeFile("keyholding-jobs-page.html", await page.content());
    await page.screenshot({ path: "keyholding-jobs-page.png", fullPage: true }).catch(() => {});
    await fs.writeFile(
      "keyholding-jobs.json",
      JSON.stringify(
        { window: { from: FROM, to: TO }, status: lastStatus, headers: headersSeen, count: jobs.length, jobs },
        null,
        2,
      ),
    );
    console.log(`Collected ${jobs.length} jobs. Paging status: "${lastStatus}".`);
    console.log("Dry run — not importing (verification stage). See keyholding-jobs.json.");
  } catch (err) {
    await page.screenshot({ path: "keyholding-jobs-page.png", fullPage: true }).catch(() => {});
    await fs.writeFile("keyholding-jobs-page.html", await page.content().catch(() => "")).catch(() => {});
    await browser.close();
    console.error("Keyholding jobs read failed:", err?.message ?? err);
    process.exit(1);
  }
  await browser.close();
}

run().catch((e) => {
  console.error("Keyholding jobs crashed:", e);
  process.exit(1);
});
