// @ts-nocheck
/*
 * Nexus completed activities — DISCOVERY.
 *
 * The Activities page (link.linkbynexus.co.uk/Activities) filters entirely
 * through the URL query string, e.g. ActivityStatus=9 (completed) plus a
 * DueDateFrom / DueDateTo window. So the robot just builds the URL and reads
 * the resulting table — no form controls to click.
 *
 * This stage logs in, opens the Activities URL for a date window, and SAVES the
 * page (table rows as JSON + full HTML + a screenshot) as a workflow artifact,
 * plus notes whether the page offers an export. It writes NOTHING to the app —
 * the importer + completed-job stubs land once the real columns are confirmed
 * against this capture (same careful path we used for the dashboard).
 *
 * Run it by hand: Actions → "Nexus activities (discovery)" → Run workflow
 * (optionally set the From/To dates). Then download the "nexus-activities-page"
 * artifact and send it over.
 *
 * Login is the same pinned flow as the sites sync.
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";

const env = (k, d = "") => process.env[k] || d;
const NEXUS_USERNAME = env("NEXUS_USERNAME") || env("NEXUS_PORTAL_USERNAME");
const NEXUS_PASSWORD = env("NEXUS_PASSWORD") || env("NEXUS_PORTAL_PASSWORD");
const USER_SEL = env("NEXUS_USER_SELECTOR", "#Username");
const PASS_SEL = env("NEXUS_PASS_SELECTOR", "#Password");
const SUBMIT_SEL = env("NEXUS_SUBMIT_SELECTOR", 'button[type="submit"]');

// Status 9 = Completed (from the sample URL). Configurable in case it differs.
const STATUS = env("NEXUS_ACTIVITY_STATUS", "9");
// Window (YYYY-MM-DD). Defaults: a recent 14-day window keeps discovery small.
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};
const FROM = env("NEXUS_ACTIVITY_FROM", iso(daysAgo(14)));
const TO = env("NEXUS_ACTIVITY_TO", iso(today));

// Faithful copy of the working URL the operator shared: keep every parameter
// (ASP.NET model-binds the full set, incl. the __Invariant markers) and only
// substitute the status + date window.
const URL_TEMPLATE = env(
  "NEXUS_ACTIVITIES_URL",
  "https://link.linkbynexus.co.uk/Activities?GetActivityRequest.Filter.OnlyUpcoming=False&GetActivityRequest.Filter.DateCompletedFrom=&GetActivityRequest.Filter.DateCompletedTo=&GetActivityRequest.FreeText=&GetActivityRequest.Filter.ActivityStatus=9&GetActivityRequest.Filter.DueFlag=&GetActivityRequest.Filter.DueDateFrom=2026-07-01&__Invariant=GetActivityRequest.Filter.DueDateFrom&GetActivityRequest.Filter.DueDateTo=2026-09-15&__Invariant=GetActivityRequest.Filter.DueDateTo&GetActivityRequest.Filter.LengthOnSiteMinutes=&__Invariant=GetActivityRequest.Filter.LengthOnSiteMinutes&GetActivityRequest.Filter.PaidStatus=&GetActivityRequest.Filter.ActivityMainType=&ScheduledActivityType=&OneOffJobActivityType=&GetActivityRequest.Filter.TimeCallReceivedFrom=&__Invariant=GetActivityRequest.Filter.TimeCallReceivedFrom&GetActivityRequest.Filter.TimeCallReceivedTo=&__Invariant=GetActivityRequest.Filter.TimeCallReceivedTo&GetActivityRequest.Filter.CompletedOn=&GetActivityRequest.Filter.HadKeyIssue=false&GetActivityRequest.Filter.SiteIssueLogged=false",
);

function buildUrl(from, to, status) {
  return URL_TEMPLATE.replace(
    /(GetActivityRequest\.Filter\.DueDateFrom=)[^&]*/,
    `$1${from}`,
  )
    .replace(/(GetActivityRequest\.Filter\.DueDateTo=)[^&]*/, `$1${to}`)
    .replace(/(GetActivityRequest\.Filter\.ActivityStatus=)[^&]*/, `$1${status}`);
}

if (!NEXUS_USERNAME || !NEXUS_PASSWORD) {
  console.log("Nexus activities not configured (no username/password) — skipping.");
  process.exit(0);
}

async function run() {
  const url = buildUrl(FROM, TO, STATUS);
  console.log(`Activities window ${FROM} → ${TO}, status ${STATUS}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Log in if the portal bounced us to the login form, then re-open the URL.
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
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    // Generic capture: pull every <table> that mentions a LINK- reference as
    // header + rows of cell text, and separately list any export controls.
    const capture = await page.evaluate(() => {
      const txt = (el) => (el?.innerText || el?.textContent || "").trim();
      const tables = Array.from(document.querySelectorAll("table"))
        .filter((t) => /LINK-\d+/i.test(t.textContent || ""))
        .map((t) => {
          const headers = Array.from(t.querySelectorAll("thead th, thead td")).map(txt);
          const bodyRows = Array.from(t.querySelectorAll("tbody tr"))
            .length
            ? Array.from(t.querySelectorAll("tbody tr"))
            : Array.from(t.querySelectorAll("tr"));
          const rows = bodyRows
            .map((tr) => Array.from(tr.querySelectorAll("th, td")).map(txt))
            .filter((cells) => cells.some((c) => c));
          return { headers, rows };
        });

      // Fallback: if there's no obvious table, climb from each LINK- ref.
      let climbed = [];
      if (tables.length === 0) {
        const isRef = (el) => /^LINK-\d+$/i.test(txt(el));
        const refEls = Array.from(document.querySelectorAll("*")).filter(
          (el) => isRef(el) && el.children.length === 0,
        );
        const seen = new Set();
        for (const refEl of refEls) {
          let row = refEl;
          for (let i = 0; i < 10 && row.parentElement; i++) {
            if (/\d{2}\/\d{2}\/\d{4}/.test(row.textContent || "")) break;
            row = row.parentElement;
          }
          if (seen.has(row)) continue;
          seen.add(row);
          climbed.push(txt(row).split("\n").map((l) => l.trim()).filter(Boolean));
        }
      }

      const exportControls = Array.from(
        document.querySelectorAll("a, button, input[type=submit]"),
      )
        .map((el) => txt(el) || el.value || "")
        .filter((t) => /export|csv|excel|download/i.test(t));

      const refCount = (document.body.innerText.match(/LINK-\d+/gi) || []).length;
      return { tables, climbed, exportControls, refCount };
    });

    await fs.writeFile("nexus-activities-page.html", await page.content());
    await page.screenshot({ path: "nexus-activities-page.png", fullPage: true }).catch(() => {});
    await fs.writeFile(
      "nexus-activities-rows.json",
      JSON.stringify({ window: { from: FROM, to: TO, status: STATUS }, ...capture }, null, 2),
    );

    const rowCount = capture.tables.reduce((n, t) => n + t.rows.length, 0) || capture.climbed.length;
    console.log(`LINK- references on page: ${capture.refCount}; parsed rows: ${rowCount}`);
    if (capture.tables[0]?.headers?.length) {
      console.log("Table headers:", JSON.stringify(capture.tables[0].headers));
    }
    if (capture.exportControls.length) {
      console.log("Possible export controls:", JSON.stringify(capture.exportControls));
    }
    console.log(JSON.stringify(capture, null, 2).slice(0, 4000));
    if (capture.refCount === 0) {
      console.warn(
        "No LINK- references found — check nexus-activities-page.html (dates/status may return nothing, or the layout differs).",
      );
    }
  } catch (err) {
    await page.screenshot({ path: "nexus-activities-page.png", fullPage: true }).catch(() => {});
    await fs.writeFile("nexus-activities-page.html", await page.content().catch(() => "")).catch(() => {});
    await browser.close();
    console.error("Nexus activities read failed:", err?.message ?? err);
    process.exit(1);
  }

  await browser.close();
}

run().catch((e) => {
  console.error("Nexus activities crashed:", e);
  process.exit(1);
});
