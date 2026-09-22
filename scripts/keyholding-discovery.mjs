// @ts-nocheck
/*
 * Keyholding Company portal (Chase2Base) — DISCOVERY.
 *
 * chase2base.co.uk/app/#login is a single-page app: login, the "Jobs
 * Management → Jobs" screen, the results grid and its filters are all
 * JavaScript, backed by a JSON API. So before writing a reader we capture:
 *   - the login form (to pin the fields),
 *   - the network calls the app makes (URLs / methods / statuses — this is how
 *     we find the jobs API), and
 *   - the DOM + a screenshot of wherever we land (login page, then post-login,
 *     then the Jobs screen if we can reach it).
 *
 * It writes NOTHING to our app and logs NO request bodies or auth tokens — only
 * request URLs/methods/statuses — so the artifact is safe to share.
 *
 * Run it by hand: Actions → "Keyholding discovery" → Run workflow. Then send
 * the "keyholding-discovery" artifact.
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";

const env = (k, d = "") => process.env[k] || d;
const USERNAME = env("KEYHOLDING_PORTAL_USERNAME") || env("KEYHOLDING_USERNAME");
const PASSWORD = env("KEYHOLDING_PORTAL_PASSWORD") || env("KEYHOLDING_PASSWORD");
const LOGIN_URL = env("KEYHOLDING_LOGIN_URL", "https://chase2base.co.uk/app/#login");

if (!USERNAME || !PASSWORD) {
  console.log("Keyholding not configured (no username/password) — skipping.");
  process.exit(0);
}

// Chase2Base is CUBA/Vaadin 8 — the login uses named Vaadin components.
const USER_SELECTORS = [
  "input.c-login-username", "input[name='loginField']", "input[placeholder='Login']",
  "#username", "input[name='username']", "input[type='email']",
];
const PASS_SELECTORS = [
  "input.c-login-password", "input[name='passwordField']",
  "input[type='password']",
];
// The submit is a Vaadin div-button (role=button), not a real <button>.
const SUBMIT_SELECTORS = [
  ".c-login-submit-button",
  "div[role='button']:has-text('Submit')",
  "button[type='submit']",
];

/** Keep only the interesting (non-asset) requests; never record bodies. */
function isInteresting(url, resourceType) {
  if (/\.(png|jpe?g|gif|svg|webp|woff2?|ttf|eot|css|ico|map)(\?|$)/i.test(url)) return false;
  if (resourceType === "image" || resourceType === "font" || resourceType === "stylesheet") return false;
  return resourceType === "xhr" || resourceType === "fetch" || /\/api\//i.test(url);
}

async function firstVisible(page, selectors, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      try {
        if ((await loc.count()) > 0 && (await loc.isVisible())) return { loc, sel };
      } catch {
        /* keep trying */
      }
    }
    await page.waitForTimeout(400);
  }
  return null;
}

async function capture(page, label, net) {
  await fs.writeFile(`keyholding-${label}.html`, await page.content().catch(() => ""));
  await page.screenshot({ path: `keyholding-${label}.png`, fullPage: true }).catch(() => {});
  await fs.writeFile("keyholding-network.json", JSON.stringify(net, null, 2));
  console.log(`Captured "${label}" — url ${page.url()}`);
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const net = [];
  page.on("requestfinished", async (req) => {
    try {
      const url = req.url();
      if (!isInteresting(url, req.resourceType())) return;
      const res = await req.response();
      // Strip query values that might carry a token; keep the parameter names.
      const clean = url.replace(/([?&])([^=]+)=[^&]*/g, "$1$2=…");
      net.push({
        method: req.method(),
        url: clean,
        status: res ? res.status() : null,
        type: res?.headers()?.["content-type"] ?? null,
      });
    } catch {
      /* ignore */
    }
  });

  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500); // let the SPA render
    await capture(page, "1-login", net);

    // Fill + submit login with the first fields that appear.
    const user = await firstVisible(page, USER_SELECTORS);
    const pass = await firstVisible(page, PASS_SELECTORS);
    if (!user || !pass) {
      console.warn("Could not find the login fields — see keyholding-1-login.html for the real form.");
    } else {
      console.log(`Login fields: user=${user.sel}, pass=${pass.sel}`);
      await user.loc.fill(USERNAME);
      await pass.loc.fill(PASSWORD);
      const submit = await firstVisible(page, SUBMIT_SELECTORS, 5_000);
      if (submit) {
        console.log(`Submit: ${submit.sel}`);
        await Promise.all([
          page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {}),
          submit.loc.click(),
        ]);
      } else {
        await pass.loc.press("Enter");
      }
      // Vaadin swaps in the main UI after login; PUSH keeps a long-poll open
      // so networkidle never fires — use fixed waits.
      await page.waitForTimeout(5000);
      await capture(page, "2-after-login", net);

      const stillLogin =
        (await page.locator("input.c-login-password, input[type='password']").count()) > 0;
      console.log(stillLogin ? "Still on login page — check credentials." : "Login succeeded.");

      // Dump the top-level menu / button labels so navigation can be pinned.
      const labels = await page.evaluate(() => {
        const out = [];
        document
          .querySelectorAll(".v-menubar-menuitem, [role='button'], .v-button-caption, .v-caption")
          .forEach((el) => {
            const t = (el.textContent || "").trim();
            if (t && t.length <= 40 && el.offsetParent !== null) out.push(t);
          });
        return Array.from(new Set(out)).slice(0, 150);
      });
      console.log("Menu / button labels:", JSON.stringify(labels));

      // Open "Jobs Management" (click the menuitem itself — the caption span
      // intercepts pointer events), then the "Jobs" item in the popup submenu.
      try {
        const jm = page.getByRole("menuitem", { name: /jobs management/i }).first();
        await jm.click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1200);
        let jobs = page.getByRole("menuitem", { name: "Jobs", exact: true }).first();
        if ((await jobs.count()) === 0) {
          jobs = page.locator(".v-menubar-popup").getByText("Jobs", { exact: true }).first();
        }
        await jobs.click({ timeout: 10_000 }).catch((e) =>
          console.warn("Jobs submenu click failed:", e?.message ?? e),
        );
        await page.waitForTimeout(6000); // Jobs screen + grid load via UIDL
        await capture(page, "3-jobs", net);

        // Structural dump of the Jobs screen — everything needed to build the
        // reader: filter inputs, date fields, grid columns + a few sample rows.
        const structure = await page.evaluate(() => {
          const txt = (el) => (el.textContent || "").trim();
          const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({
            type: i.type,
            name: i.name || null,
            placeholder: i.getAttribute("placeholder"),
            cls: i.className,
            hasValue: Boolean(i.value),
          }));
          const captions = Array.from(
            document.querySelectorAll(".v-button-caption, .v-menubar-menuitem-caption, .v-caption"),
          )
            .map(txt)
            .filter((t) => t && t.length <= 40);
          const gridHeaders = Array.from(
            document.querySelectorAll(
              ".v-grid-header .v-grid-cell, .v-table-header-cell .v-table-caption-container, th",
            ),
          )
            .map(txt)
            .filter(Boolean);
          const gridRows = Array.from(
            document.querySelectorAll(".v-grid-body .v-grid-row, .v-table-row"),
          )
            .slice(0, 3)
            .map((r) =>
              Array.from(r.querySelectorAll(".v-grid-cell, .v-table-cell-wrapper, td")).map(txt),
            );
          const dateFields = Array.from(document.querySelectorAll(".v-datefield")).map(
            (d) => d.className,
          );
          return {
            inputCount: inputs.length,
            inputs,
            captions: Array.from(new Set(captions)).slice(0, 100),
            gridHeaders,
            gridRowSample: gridRows,
            dateFieldClasses: Array.from(new Set(dateFields)),
          };
        });
        await fs.writeFile(
          "keyholding-jobs-structure.json",
          JSON.stringify(structure, null, 2),
        );
        console.log(
          `Jobs screen: ${structure.inputCount} inputs, grid headers ${JSON.stringify(structure.gridHeaders)}`,
        );
        const exports = structure.captions.filter((t) => /export|excel|download|csv/i.test(t));
        if (exports.length) console.log("Export controls:", JSON.stringify(exports));
      } catch (e) {
        console.warn("Could not reach the Jobs screen automatically:", e?.message ?? e);
        await capture(page, "3-jobs", net).catch(() => {});
      }
    }

    // Final network dump (already written by capture, but ensure it's complete).
    await fs.writeFile("keyholding-network.json", JSON.stringify(net, null, 2));
    console.log(`Recorded ${net.length} API/XHR calls (URLs only, no bodies).`);
  } catch (err) {
    await capture(page, "error", net).catch(() => {});
    console.error("Keyholding discovery failed:", err?.message ?? err);
    await browser.close();
    process.exit(1);
  }

  await browser.close();
}

run().catch((e) => {
  console.error("Keyholding discovery crashed:", e);
  process.exit(1);
});
