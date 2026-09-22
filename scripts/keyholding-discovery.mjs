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

const USER_SELECTORS = [
  "#username", "#Username", "#email", "#Email",
  "input[name='username']", "input[name='email']", "input[name='Username']",
  "input[type='email']",
  "input[formcontrolname='username']", "input[formcontrolname='email']",
  "input[autocomplete='username']",
];
const PASS_SELECTORS = [
  "#password", "#Password",
  "input[name='password']", "input[name='Password']",
  "input[type='password']",
  "input[formcontrolname='password']",
  "input[autocomplete='current-password']",
];
const SUBMIT_SELECTORS = [
  "button[type='submit']", "input[type='submit']",
  "button:has-text('Log in')", "button:has-text('Login')",
  "button:has-text('Sign in')", "button:has-text('Log In')",
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
      await page.waitForTimeout(2500);
      await capture(page, "2-after-login", net);

      // Best-effort: open Jobs Management → Jobs and capture the grid.
      try {
        const jm = page.getByText(/jobs management/i).first();
        if (await jm.count()) {
          await jm.click();
          await page.waitForTimeout(800);
        }
        const jobs = page.getByText(/^\s*jobs\s*$/i).first();
        if (await jobs.count()) {
          await jobs.click();
          await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
          await page.waitForTimeout(1500);
        }
        await capture(page, "3-jobs", net);
      } catch (e) {
        console.warn("Could not reach the Jobs screen automatically:", e?.message ?? e);
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
