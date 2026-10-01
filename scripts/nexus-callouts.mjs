// @ts-nocheck
/*
 * Nexus callouts — reads the "Upcoming Activities" straight off the dashboard,
 * since (unlike the Sites report) they can't be exported. Runs in GitHub Actions.
 *
 * Each activity row looks like:
 *   LINK-2483487
 *   Scheduled Vacant Property Inspection
 *   235 High Street Orpington
 *   Natwest, 235 High Street, Orpington, Kent, BR6 0NS
 *   VPS
 *   07/09/2026 00:00 - 21/09/2026 00:00
 *   Due Now
 *
 * It logs in, opens /Dashboard, parses the rows, saves them (JSON + HTML +
 * screenshot) as a workflow artifact AND — when the import endpoint is
 * configured (NEXUS_CALLOUTS_URL + NEXUS_IMPORT_SECRET) — POSTs them to
 * /api/imports/nexus-callouts, which upserts a VPI job stub per callout. With
 * no endpoint set it just parses + saves, so it doubles as a discovery run.
 *
 * Login is the same pinned flow as the sites sync.
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";

const env = (k, d = "") => process.env[k] || d;
const NEXUS_USERNAME = env("NEXUS_USERNAME") || env("NEXUS_PORTAL_USERNAME");
const NEXUS_PASSWORD = env("NEXUS_PASSWORD") || env("NEXUS_PORTAL_PASSWORD");
const NEXUS_DASHBOARD_URL = env(
  "NEXUS_DASHBOARD_URL",
  "https://link.linkbynexus.co.uk/Dashboard",
);
const USER_SEL = env("NEXUS_USER_SELECTOR", "#Username");
const PASS_SEL = env("NEXUS_PASS_SELECTOR", "#Password");
const SUBMIT_SEL = env("NEXUS_SUBMIT_SELECTOR", 'button[type="submit"]');
// Import endpoint. Leave unset to only parse + save (discovery). The bearer is
// the same secret the sites sync uses.
const NEXUS_CALLOUTS_URL = env("NEXUS_CALLOUTS_URL");
const NEXUS_IMPORT_SECRET = env("NEXUS_IMPORT_SECRET");
const preview = String(env("NEXUS_PREVIEW")).toLowerCase() === "true";

if (!NEXUS_USERNAME || !NEXUS_PASSWORD) {
  console.log("Nexus callouts not configured (no username/password) — skipping.");
  process.exit(0);
}

const UK_POSTCODE = /([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/i;
const DATE_RANGE =
  /(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})\s*[-–]\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2})/;

/** Turn one row's visible lines into a structured activity. */
function parseRow(lines) {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  const reference = clean.find((l) => /^LINK-\d+/i.test(l)) ?? null;

  let dueStart = null;
  let dueEnd = null;
  const dateLine = clean.find((l) => DATE_RANGE.test(l));
  if (dateLine) {
    const m = dateLine.match(DATE_RANGE);
    dueStart = m[1];
    dueEnd = m[2];
  }

  const status =
    clean.find((l) => /^(due now|overdue|upcoming|due)$/i.test(l)) ?? null;

  // The address line is the one carrying a postcode; the line before it is the
  // site name; lines between the reference and the site name are the type.
  const addressIdx = clean.findIndex((l) => UK_POSTCODE.test(l));
  const address = addressIdx >= 0 ? clean[addressIdx] : null;
  const postcode = address ? (address.match(UK_POSTCODE)?.[0] ?? null) : null;
  const siteName = addressIdx > 0 ? clean[addressIdx - 1] : null;

  const refIdx = reference ? clean.indexOf(reference) : -1;
  const type =
    refIdx >= 0 && addressIdx > refIdx + 1
      ? clean.slice(refIdx + 1, addressIdx - 1).join(" ")
      : null;

  // Service code: a short line that isn't any of the above (e.g. "VPS", "VPS OCS").
  const used = new Set([reference, dateLine, status, address, siteName, type]);
  const service =
    clean.find(
      (l) => !used.has(l) && !DATE_RANGE.test(l) && l.length <= 12 && /[A-Z]/.test(l),
    ) ?? null;

  return { reference, type, siteName, address, postcode, service, dueStart, dueEnd, status, raw: clean };
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  let activities = [];
  let emptyDashboard = false;

  try {
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
      await page.goto(NEXUS_DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    // What did Nexus actually show us? It can intercept the dashboard with its
    // annual "Review Details" wizard — a declaration about the business that a
    // PERSON must complete (the robot never clicks through it).
    const wizard = await page.evaluate(() => {
      const t = document.body?.textContent || "";
      return (
        /wizard/i.test(document.title || "") ||
        /review details/i.test(t) ||
        /reviewed the data that nexus hold/i.test(t)
      );
    });
    if (wizard) {
      throw new Error(
        "Nexus is showing its annual 'Review Details' check instead of the dashboard. " +
          "Someone needs to log in to Nexus (link.linkbynexus.co.uk) with the sync account " +
          "and complete the review — the callouts sync resumes on its own after that.",
      );
    }
    // The activity list renders client-side — give it a moment to appear.
    const onDashboard = await page.evaluate(() =>
      /upcoming activities/i.test(document.body?.textContent || ""),
    );
    if (onDashboard) {
      await page
        .waitForFunction(() => /LINK-\d+/.test(document.body?.textContent || ""), null, {
          timeout: 8_000,
        })
        .catch(() => {}); // nothing listed — a genuinely empty dashboard
    }

    // Pull each activity row's visible lines: find every "LINK-…" reference and
    // climb to the ancestor that also holds the date window — that's the row.
    const rawRows = await page.evaluate(() => {
      const isRef = (el) => /^LINK-\d+$/i.test((el.textContent || "").trim());
      const refEls = Array.from(document.querySelectorAll("*")).filter(
        (el) => isRef(el) && el.children.length === 0,
      );
      const rows = [];
      const seen = new Set();
      for (const refEl of refEls) {
        let row = refEl;
        for (let i = 0; i < 8 && row.parentElement; i++) {
          if (/\d{2}\/\d{2}\/\d{4}/.test(row.textContent || "")) break;
          row = row.parentElement;
        }
        if (seen.has(row)) continue;
        seen.add(row);
        const text = row.innerText || row.textContent || "";
        rows.push(text.split("\n").map((l) => l.trim()).filter(Boolean));
      }
      return rows;
    });

    activities = rawRows.map(parseRow).filter((a) => a.reference);

    // Save the page for reference + emit the parsed data for verification.
    await fs.writeFile("nexus-dashboard.html", await page.content());
    await page.screenshot({ path: "nexus-dashboard.png", fullPage: true }).catch(() => {});
    await fs.writeFile("nexus-activities.json", JSON.stringify(activities, null, 2));

    // Count only: run logs on this public repo are world-readable, so the
    // callouts themselves (sites, addresses) stay in nexus-activities.json.
    console.log(`Parsed ${activities.length} upcoming activities.`);
    if (activities.length === 0) {
      if (!onDashboard) {
        throw new Error(
          `Didn't reach the Nexus dashboard (page: "${await page.title()}") — see nexus-dashboard.html in the artifact.`,
        );
      }
      emptyDashboard = true;
    }
  } catch (err) {
    await page.screenshot({ path: "nexus-dashboard.png", fullPage: true }).catch(() => {});
    await fs.writeFile("nexus-dashboard.html", await page.content().catch(() => "")).catch(() => {});
    await browser.close();
    console.error("Nexus callouts read failed:", err?.message ?? err);
    process.exit(1);
  }

  await browser.close();

  // Hand the parsed callouts to the app, if the endpoint is configured.
  if (!NEXUS_CALLOUTS_URL || !NEXUS_IMPORT_SECRET) {
    console.log(
      "Import endpoint not configured (NEXUS_CALLOUTS_URL / NEXUS_IMPORT_SECRET) — parsed + saved only.",
    );
    return;
  }
  // Never POST an empty snapshot: a bad read shouldn't be treated as "no
  // callouts" and auto-cancel the board. A dashboard that loaded fine with
  // nothing listed is a normal quiet hour — succeed without importing.
  if (activities.length === 0) {
    if (emptyDashboard) {
      console.log("Dashboard loaded — no upcoming activities listed right now. Nothing to import.");
      return;
    }
    console.warn("Parsed 0 activities — not posting (empty snapshot guard).");
    process.exit(1);
  }

  const { res, json } = await postActivities(activities, preview);
  if (!res.ok || json.ok === false) {
    console.error("Callouts endpoint rejected the batch:", res.status, JSON.stringify(json));
    process.exit(1);
  }
  if (preview) {
    console.log(
      `Preview OK — would create ${json.toCreate}, update ${json.toUpdate}, drop ${json.toClose}, ${json.unmatchedSites} unmatched-site (read ${json.read}).`,
    );
  } else {
    console.log(
      `Callouts OK — created ${json.created}, updated ${json.updated}, dropped ${json.closed}, ${json.unmatched} unmatched-site, skipped ${json.skipped?.length || 0}.`,
    );
  }
}

async function postActivities(activities, preview) {
  const url = preview ? `${NEXUS_CALLOUTS_URL}?preview=1` : NEXUS_CALLOUTS_URL;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NEXUS_IMPORT_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ activities }),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

run().catch((e) => {
  console.error("Nexus callouts crashed:", e);
  process.exit(1);
});
