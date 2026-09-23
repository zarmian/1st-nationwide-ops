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

// The Jobs table's fixed column order (Carole's saved layout). Map row cells by
// index against this — the live header read intermittently drops a column.
const KH_COLUMNS = [
  "#", "Client Job Number", "Source Type", "Type", "Service", "Date",
  "Last Date", "Status", "Execution Status", "Property Number", "Property",
  "Contract", "Addresses", "Route", "Partner Number", "Partner", "Executor",
  "Login", "Executor Team", "Associated Cases", "Incident raised?",
  "Image or Operative Note attached to job", "Appearance Date", "Allocated At",
  "Accepted At", "Started At", "On Site At", "On Way At", "Finished At",
  "Leave Site At", "Finishing Type", "Cancellation Type", "Done/Cancel Date",
  "PO / WO",
];

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
  console.log(`Found ${n} date fields (From/To); setting ${uk(FROM)} → ${uk(TO)}`);
  // Vaadin DateField ignores a raw .fill() — it needs real keystrokes so the
  // GWT widget parses the value. Type char-by-char, then Tab to commit (NOT
  // Escape: that closes the CUBA screen).
  async function typeDate(field, value) {
    await field.click();
    await field.press("Control+a").catch(() => {});
    await field.press("Delete").catch(() => {});
    await field.pressSequentially(value, { delay: 40 });
    await field.press("Tab");
    await page.waitForTimeout(300);
  }
  if (n >= 1) await typeDate(dfs.nth(0), uk(FROM));
  if (n >= 2) await typeDate(dfs.nth(1), uk(TO));
  const vals = await dfs.evaluateAll((els) => els.map((e) => e.value));
  console.log("Date fields now read:", JSON.stringify(vals));
  await page.waitForTimeout(500);
  // Find is a Vaadin div-button; match its caption exactly.
  const find = page
    .locator('.v-button:has(.v-button-caption:text-is("Find"))')
    .first();
  await find.waitFor({ state: "visible", timeout: 15_000 });
  await find.click();
  await page.waitForTimeout(4000);
}

/** Read the currently-rendered v-table rows (cell text) + the paging status. */
async function extractTable(page) {
  return page.evaluate(() => {
    const txt = (el) => (el?.innerText || el?.textContent || "").trim();
    const rows = Array.from(document.querySelectorAll(".v-table tr.v-table-row")).map(
      (tr) => Array.from(tr.querySelectorAll("td .v-table-cell-wrapper")).map(txt),
    );
    const status = txt(document.querySelector(".c-paging-status")) || null;
    return { rows, status };
  });
}

/** Scroll the Vaadin table body by HALF a viewport so consecutive reads overlap
 *  (a full-viewport jump skips the rows that render between positions). Returns
 *  { scrolled, inDom } — inDom is how many rows are currently in the DOM. */
async function scrollTableBody(page) {
  return page.evaluate(() => {
    const table = document.querySelector(".v-table");
    const inDom = document.querySelectorAll(".v-table tr.v-table-row").length;
    if (!table) return { scrolled: false, inDom };
    const sc =
      table.querySelector(".v-table-body-wrapper") ||
      Array.from(table.querySelectorAll("*")).find(
        (el) =>
          el.scrollHeight > el.clientHeight + 20 &&
          el.clientHeight > 40 &&
          /wrapper|scroll|body/i.test(el.className),
      );
    if (!sc) return { scrolled: false, inDom };
    const before = sc.scrollTop;
    sc.scrollTop = before + Math.max(Math.floor(sc.clientHeight / 2), 80);
    return { scrolled: sc.scrollTop > before, inDom };
  });
}

/** Click the CUBA pager's Next button (.c-paging-next). False when it's absent
 *  or disabled (last page). */
async function nextPage(page) {
  const next = page.locator(".c-paging-next").first();
  if ((await next.count()) === 0) return false;
  const cls = (await next.getAttribute("class").catch(() => "")) || "";
  if (/v-disabled/.test(cls)) return false;
  await next.click({ timeout: 8_000 }).catch(() => {});
  return true;
}

function mapRows(rows) {
  return rows.map((cells) => {
    const o = {};
    KH_COLUMNS.forEach((h, i) => {
      o[h] = (cells[i] ?? "").trim();
    });
    return o;
  });
}

async function run() {
  const browser = await chromium.launch();
  // A very tall viewport makes the Vaadin Table (height:100%) render a whole
  // 50-row CUBA page at once, so we don't have to fight its row virtualisation.
  const page = await (
    await browser.newContext({ viewport: { width: 1680, height: 5200 } })
  ).newPage();
  const byRef = new Map();
  let lastStatus = null;

  try {
    await login(page);
    console.log("Login OK.");
    await openJobs(page);
    await setDatesAndFind(page);

    for (let pagerPage = 1; pagerPage <= MAX_PAGES; pagerPage++) {
      // Load every (vertically virtualised) row on this pager page by scrolling
      // the table body until nothing new appears.
      let stable = 0;
      for (let s = 0; s < 150; s++) {
        const { rows, status } = await extractTable(page);
        lastStatus = status;
        const before = byRef.size;
        for (const cells of rows) {
          const ref = (cells[0] ?? "").trim();
          if (ref) byRef.set(ref, cells);
        }
        const { scrolled } = await scrollTableBody(page);
        // Stop only once we can't scroll further AND no new rows arrive for
        // several passes (Vaadin lazy-loads on scroll).
        if (byRef.size === before && !scrolled) {
          if (++stable >= 5) break;
        } else {
          stable = 0;
        }
        await page.waitForTimeout(500);
      }
      console.log(`Pager page ${pagerPage}: total ${byRef.size} — status "${lastStatus}"`);
      if (!(await nextPage(page))) break;
      await page.waitForTimeout(2500);
      await page.evaluate(() => {
        const t = document.querySelector(".v-table");
        if (t)
          for (const el of t.querySelectorAll("*"))
            if (el.scrollHeight > el.clientHeight + 20) {
              el.scrollTop = 0;
              break;
            }
      });
    }

    const jobs = mapRows(Array.from(byRef.values()));
    await fs.writeFile("keyholding-jobs-page.html", await page.content());
    await page.screenshot({ path: "keyholding-jobs-page.png", fullPage: true }).catch(() => {});
    await fs.writeFile(
      "keyholding-jobs.json",
      JSON.stringify(
        { window: { from: FROM, to: TO }, status: lastStatus, headers: KH_COLUMNS, count: jobs.length, jobs },
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
