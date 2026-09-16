// @ts-nocheck
/*
 * Nexus completed activities — reads the "Activities" report off the Nexus Link
 * portal for a date window (ActivityStatus=9 = completed) and imports the rows
 * as completed job stubs via /api/imports/nexus-activities.
 *
 * The report filters entirely through the URL query string, so the robot just
 * builds the URL, logs in, pages through the results (50 rows/page), maps each
 * table row to an activity, and POSTs them in chunks. Serves BOTH the one-time
 * backfill (a wide From/To) and the nightly incremental run (a recent window).
 *
 * With the import endpoint unset it only parses + saves the capture artifact
 * (discovery mode). Login is the same pinned flow as the sites sync.
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";

const env = (k, d = "") => process.env[k] || d;
const NEXUS_USERNAME = env("NEXUS_USERNAME") || env("NEXUS_PORTAL_USERNAME");
const NEXUS_PASSWORD = env("NEXUS_PASSWORD") || env("NEXUS_PORTAL_PASSWORD");
const USER_SEL = env("NEXUS_USER_SELECTOR", "#Username");
const PASS_SEL = env("NEXUS_PASS_SELECTOR", "#Password");
const SUBMIT_SEL = env("NEXUS_SUBMIT_SELECTOR", 'button[type="submit"]');

const STATUS = env("NEXUS_ACTIVITY_STATUS", "9"); // 9 = Completed
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
};
const FROM = env("NEXUS_ACTIVITY_FROM", iso(daysAgo(3)));
const TO = env("NEXUS_ACTIVITY_TO", iso(today));

const IMPORT_URL = env("NEXUS_ACTIVITIES_IMPORT_URL");
const IMPORT_SECRET = env("NEXUS_IMPORT_SECRET");
const preview = String(env("NEXUS_PREVIEW")).toLowerCase() === "true";
const CHUNK = Number(env("NEXUS_ACTIVITIES_CHUNK", "100")) || 100;
const MAX_PAGES = Number(env("NEXUS_ACTIVITIES_MAX_PAGES", "400")) || 400;

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

// Column header → the field name our importer expects.
const HEADER_MAP = {
  reference: "reference",
  type: "type",
  site: "siteName",
  "site address": "address",
  sin: "sin",
  customer: "customer",
  "due date": "dueDate",
  "time on site": "timeOnSite",
  "time off site": "timeOffSite",
  "time call received": "timeCallReceived",
  status: "status",
};

/** Map one table row to an activity object, using the header names. The portal
 *  renders a column's NAME as placeholder text when its cell is empty, so a
 *  cell equal to its header (e.g. "SIN", "Time Call Received") counts as blank. */
function mapRow(headers, cells) {
  const act = {};
  headers.forEach((h, i) => {
    const key = HEADER_MAP[(h || "").trim().toLowerCase()];
    if (!key) return;
    let v = (cells[i] ?? "").trim();
    if (v && v.toLowerCase() === (h || "").trim().toLowerCase()) v = "";
    act[key] = v || null;
  });
  return act;
}

async function extractPage(page) {
  return page.evaluate(() => {
    const txt = (el) => (el.innerText || el.textContent || "").trim();
    const table = Array.from(document.querySelectorAll("table")).find((t) =>
      /LINK-\d+/i.test(t.textContent || ""),
    );
    if (!table) return { headers: [], rows: [] };
    const trs = Array.from(table.querySelectorAll("tr"));
    const grid = trs.map((tr) =>
      Array.from(tr.querySelectorAll("th, td")).map(txt),
    );
    const hIdx = grid.findIndex((r) => r.some((c) => /^reference$/i.test(c)));
    const headers = hIdx >= 0 ? grid[hIdx] : [];
    const rows = grid.filter(
      (r, i) => i !== hIdx && r.some((c) => /LINK-\d+/i.test(c)),
    );
    return { headers, rows };
  });
}

/** Best-effort "next page" click. Returns false when there's no (enabled) next. */
async function goToNext(page) {
  const cands = [
    page.getByRole("link", { name: /^\s*next\s*$/i }),
    page.getByRole("button", { name: /^\s*next\s*$/i }),
    page.locator('a[rel="next"]'),
    page.locator('a[aria-label*="Next" i], button[aria-label*="Next" i]'),
    page.locator('.pagination a:has-text("Next"), .pager a:has-text("Next"), li.next a'),
    page.getByRole("link", { name: /^(›|»)$/ }),
  ];
  for (const c of cands) {
    try {
      if ((await c.count()) === 0) continue;
      const first = c.first();
      const dis = (await first.getAttribute("aria-disabled")) === "true";
      const cls = (await first.getAttribute("class")) || "";
      const parentCls =
        (await first.evaluate((n) => n.parentElement?.className || "").catch(() => "")) || "";
      if (dis || /disabled/i.test(cls) || /disabled/i.test(parentCls)) return false;
      await first.click();
      return true;
    } catch {
      /* try next selector */
    }
  }
  return false;
}

async function postChunk(list, isPreview) {
  const url = isPreview ? `${IMPORT_URL}?preview=1` : IMPORT_URL;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${IMPORT_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ activities: list }),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function run() {
  const url = buildUrl(FROM, TO, STATUS);
  console.log(`Activities window ${FROM} → ${TO}, status ${STATUS}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const byRef = new Map();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
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

    let headersSeen = [];
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      const { headers, rows } = await extractPage(page);
      if (headers.length) headersSeen = headers;
      const before = byRef.size;
      for (const cells of rows) {
        const act = mapRow(headers, cells);
        if (act.reference && /^LINK-\d+/i.test(act.reference)) {
          byRef.set(act.reference, act);
        }
      }
      const added = byRef.size - before;
      console.log(`Page ${pageNo}: +${added} rows (total ${byRef.size})`);
      if (added === 0) break;
      if (!(await goToNext(page))) break;
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(300);
    }

    const activities = Array.from(byRef.values());
    await fs.writeFile("nexus-activities-page.html", await page.content());
    await page.screenshot({ path: "nexus-activities-page.png", fullPage: true }).catch(() => {});
    await fs.writeFile(
      "nexus-activities.json",
      JSON.stringify({ window: { from: FROM, to: TO, status: STATUS }, headers: headersSeen, count: activities.length, activities }, null, 2),
    );
    console.log(`Collected ${activities.length} completed activities.`);

    await browser.close();

    if (!IMPORT_URL || !IMPORT_SECRET) {
      console.log("Import endpoint not configured (NEXUS_ACTIVITIES_IMPORT_URL / NEXUS_IMPORT_SECRET) — parsed + saved only.");
      return;
    }
    if (activities.length === 0) {
      console.warn("No activities parsed — not posting (check the capture artifact).");
      return;
    }

    // POST in chunks so each request stays within the serverless time limit.
    let created = 0, updated = 0, unmatched = 0, dupes = 0, skipped = 0;
    let pCreate = 0, pUpdate = 0, pUnmatched = 0, pDupes = 0;
    for (let i = 0; i < activities.length; i += CHUNK) {
      const chunk = activities.slice(i, i + CHUNK);
      let ok = false, last = { status: 0, json: {} };
      for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
        const { res, json } = await postChunk(chunk, preview);
        last = { status: res.status, json };
        if (res.ok && json.ok !== false) {
          ok = true;
          if (preview) {
            pCreate += json.toCreate || 0;
            pUpdate += json.toUpdate || 0;
            pUnmatched += json.unmatchedSites || 0;
            pDupes += json.possibleDuplicates || 0;
          } else {
            created += json.created || 0;
            updated += json.updated || 0;
            unmatched += json.unmatched || 0;
            dupes += json.possibleDuplicates || 0;
            skipped += json.skipped?.length || 0;
          }
        } else if (res.status >= 500) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        } else break;
      }
      if (!ok) {
        console.error(`Chunk ${i / CHUNK + 1} failed:`, last.status, JSON.stringify(last.json));
        process.exit(1);
      }
      console.log(`Chunk ${Math.floor(i / CHUNK) + 1}: ${Math.min(i + CHUNK, activities.length)}/${activities.length}`);
    }

    if (preview) {
      console.log(`Preview OK — would create ${pCreate}, update ${pUpdate}, ${pUnmatched} unmatched-site, ${pDupes} possible duplicates.`);
    } else {
      console.log(`Activities OK — created ${created}, updated ${updated}, ${unmatched} unmatched-site, ${dupes} possible duplicates, skipped ${skipped}.`);
    }
  } catch (err) {
    await page.screenshot({ path: "nexus-activities-page.png", fullPage: true }).catch(() => {});
    await fs.writeFile("nexus-activities-page.html", await page.content().catch(() => "")).catch(() => {});
    await browser.close().catch(() => {});
    console.error("Nexus activities failed:", err?.message ?? err);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Nexus activities crashed:", e);
  process.exit(1);
});
