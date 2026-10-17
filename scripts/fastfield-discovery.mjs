/**
 * FastField discovery — run by hand (workflow "FastField discovery").
 *
 * Logs into the FastField web portal and records HOW it works, so the import
 * robot can be built: the login outcome (ok / two-step code / new-location
 * check / multiple accounts / error), the portal's own JSON calls (paths and
 * the SHAPE of each response, with every value masked), and the layout of the
 * pages it visits (all text masked except buttons, menus and headings).
 * Writes fastfield-discovery.json and nothing else — it never touches the app.
 *
 * Masking: letters become a/A and digits 9 (so "14/10/2026 18:30" shows as
 * "99/99/9999 99:99" — the format without the data); numbers become 0 unless
 * the key is an id. Field labels/captions/titles/types are kept: they're the
 * form's questions, not answers. Passwords, codes and tokens are never
 * recorded, and the log prints outcomes and counts only (the repo's logs and
 * artifacts can be public).
 *
 * Env: FASTFIELD_USERNAME, FASTFIELD_PASSWORD (required);
 *      FASTFIELD_PORTAL_URL (optional — default https://portal.fastfieldforms.com,
 *      where 1NW's account is); FASTFIELD_ORG_ID (optional, if one login has
 *      several FastField accounts).
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";

const env = (k, d = "") => process.env[k] || d;
const USER = env("FASTFIELD_USERNAME");
const PASS = env("FASTFIELD_PASSWORD");
const ORG_ID = env("FASTFIELD_ORG_ID");
// 1NW's account lives on the global portal (portal.fastfieldforms.com).
const PORTALS = [
  (env("FASTFIELD_PORTAL_URL") || "https://portal.fastfieldforms.com").replace(/\/+$/, ""),
];

if (!USER || !PASS) {
  console.log("FastField login not configured (FASTFIELD_USERNAME / FASTFIELD_PASSWORD) — skipping.");
  process.exit(0);
}

// ── Masking ────────────────────────────────────────────────────────────────

/** Keys whose primitive values are UI/metadata, kept as-is. */
const KEEP = /^(id|\w*Id|\w*ID|\w*Ids|mode|originalMode|commandName|\w*[Tt]ype|status|state|version|\w*Version|label|caption|title|key|fieldKey|dataKey|count|total\w*|page\w*|route|error|warning|success|ipCheckPassed|hasMore|isDeleted|codeExpirationMinutes)$/;
/** Keys never recorded at all. */
const SECRET = /pwd|password|token|code|secret|cookie|authorization|apikey|api_key/i;

function maskString(s, key) {
  if (KEEP.test(key)) return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const path = u.pathname
        .split("/")
        .map((seg) => (seg.length > 20 || /\d{3,}/.test(seg) ? ":x" : seg))
        .join("/");
      return `${u.protocol}//${u.host}${path}${u.search ? "?…" : ""}`;
    } catch {
      /* fall through */
    }
  }
  const head = s.slice(0, 48).replace(/[A-Z]/g, "A").replace(/[a-z]/g, "a").replace(/[0-9]/g, "9");
  return s.length > 48 ? `${head}…(${s.length})` : head;
}

function mask(v, key = "", depth = 0) {
  if (depth > 10) return "…";
  if (SECRET.test(key)) return "[not recorded]";
  if (Array.isArray(v)) {
    const shown = v.slice(0, 12).map((x) => mask(x, key, depth + 1));
    return v.length > 12 ? [...shown, `…(${v.length} items)`] : shown;
  }
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v).slice(0, 80)) out[k] = mask(val, k, depth + 1);
    return out;
  }
  if (typeof v === "string") return maskString(v, key);
  if (typeof v === "number") return KEEP.test(key) ? v : 0;
  return v;
}

/** Replace long/id-like path segments so URLs show their pattern only. */
function pathPattern(u) {
  return u.pathname
    .split("/")
    .map((seg) => (seg.length > 20 || /^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) ? ":id" : seg))
    .join("/");
}

// ── Recording ──────────────────────────────────────────────────────────────

const out = {
  startedAt: new Date().toISOString(),
  portal: null,
  login: null,
  calls: [],
  pages: [],
  notes: [],
};

function record(page) {
  page.on("response", async (res) => {
    const req = res.request();
    if (!["xhr", "fetch"].includes(req.resourceType())) return;
    let u;
    try {
      u = new URL(res.url());
    } catch {
      return;
    }
    if (!u.hostname.endsWith("fastfieldforms.com")) return;
    const isLogin = /logincommand|resendcode/i.test(u.pathname);
    let body = null;
    const type = res.headers()["content-type"] ?? "";
    if (type.includes("json")) body = await res.json().catch(() => null);
    let sent = null;
    if (!isLogin) {
      try {
        sent = req.postDataJSON();
      } catch {
        sent = req.postData() ? "[non-JSON body]" : null;
      }
    }
    const entry = {
      method: req.method(),
      host: u.host,
      path: pathPattern(u),
      query: [...u.searchParams.keys()],
      status: res.status(),
      contentType: type.split(";")[0],
      ...(sent && typeof sent === "object" ? { sent: mask(sent) } : {}),
      ...(body !== null ? { response: mask(body) } : {}),
    };
    if (JSON.stringify(entry).length > 40_000) {
      entry.response = "[too large — shape trimmed]";
      if (body && typeof body === "object") entry.responseKeys = Object.keys(body).slice(0, 80);
    }
    out.calls.push(entry);
  });
}

/** Page layout with data masked: keep UI controls, mask everything else. */
async function snapshot(page, label) {
  const info = await page.evaluate(() => {
    const maskText = (t) =>
      t.replace(/[A-Z]/g, "A").replace(/[a-z]/g, "a").replace(/[0-9]/g, "9").slice(0, 60);
    const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
    const inData = (el) => Boolean(el.closest("table, tbody, [role=row], [role=gridcell], .table, .list-item, .card-content"));
    const take = (sel, map, n = 60) => [...document.querySelectorAll(sel)].slice(0, n).map(map);
    const attrs = (el) => ({
      id: el.id || undefined,
      cls: el.className && typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 4).join(" ") : undefined,
      aria: el.getAttribute("aria-label") || undefined,
    });
    return {
      title: document.title,
      buttons: take("button, [role=button], input[type=submit]", (el) => ({
        text: inData(el) ? maskText(clean(el.textContent)) : clean(el.textContent).slice(0, 60),
        ...attrs(el),
      })),
      links: take("a[href]", (el) => {
        let href = el.getAttribute("href") || "";
        try {
          const u = new URL(href, location.href);
          href = u.origin === location.origin ? u.pathname + (u.hash ? u.hash.replace(/\d{3,}/g, ":id") : "") : u.origin;
        } catch {}
        return { text: inData(el) ? maskText(clean(el.textContent)) : clean(el.textContent).slice(0, 60), href, ...attrs(el) };
      }, 80),
      inputs: take("input, select, textarea", (el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || undefined,
        name: el.getAttribute("name") || undefined,
        placeholder: el.getAttribute("placeholder") || undefined,
        ...attrs(el),
      })),
      headings: take("h1, h2, h3, h4, th, label, .label, .menu-label, nav li", (el) =>
        clean(el.textContent).slice(0, 80),
      ),
      tables: take("table", (t) => ({
        headers: [...t.querySelectorAll("th")].map((th) => clean(th.textContent).slice(0, 40)),
        rows: t.querySelectorAll("tbody tr").length,
      }), 10),
    };
  });
  const u = new URL(page.url());
  out.pages.push({ label, path: u.pathname, hash: u.hash.replace(/\d{3,}/g, ":id"), ...info });
}

// ── Login ──────────────────────────────────────────────────────────────────

async function tryLogin(page, base) {
  await page.goto(`${base}/Portal/Login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForSelector("#email", { timeout: 20_000 });
  await snapshot(page, "login page");
  const loginResponse = page.waitForResponse((r) => /\/portal\/logincommand/i.test(r.url()), { timeout: 30_000 });
  await page.fill("#email", USER);
  if (!(await page.isVisible("#pwd").catch(() => false))) {
    // Two-step login: email first, then the password box appears.
    await page.press("#email", "Enter");
    await page.waitForSelector("#pwd", { state: "visible", timeout: 15_000 }).catch(() => {});
  }
  if (await page.isVisible("#pwd").catch(() => false)) {
    await page.fill("#pwd", PASS);
    await page.press("#pwd", "Enter");
  }
  const res = await loginResponse.catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  return {
    httpStatus: res?.status() ?? null,
    mode: data?.mode ?? null,
    error: typeof data?.error === "string" ? data.error.slice(0, 200) : null,
    warning: typeof data?.warning === "string" ? data.warning.slice(0, 200) : null,
    twoStep: data?.tfa ? { sms: Boolean(data.tfa.hasSMS), app: Boolean(data.tfa.hasGA), backup: Boolean(data.tfa.hasBU) } : null,
    route: typeof data?.route === "string" ? data.route : null,
    responseShape: mask(data),
  };
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 2200 } });
  const page = await context.newPage();
  record(page);
  try {
    let loggedIn = false;
    for (const base of PORTALS) {
      out.portal = base;
      const result = await tryLogin(page, base);
      out.login = result;
      const host = new URL(base).host;
      if (result.twoStep) {
        console.log(`${host}: FastField asked for a two-step login code — the robot can't read it.`);
        break;
      }
      if (result.mode === "verify-ip") {
        console.log(`${host}: FastField asked to verify a new location (it emails a code) — the robot can't read it.`);
        break;
      }
      if (result.mode === "multi-account" && !ORG_ID) {
        console.log(`${host}: this login has several FastField accounts — set FASTFIELD_ORG_ID to pick one.`);
        break;
      }
      await page.waitForURL((u) => !/\/login/i.test(u.pathname), { timeout: 20_000 }).catch(() => {});
      if (!/\/login/i.test(new URL(page.url()).pathname)) {
        loggedIn = true;
        console.log(`${host}: logged in.`);
        break;
      }
      console.log(`${host}: login didn't go through (${result.error ? "FastField said: " + result.error : "no message"}).`);
    }
    if (!loggedIn) return;

    // Home, then anything that looks like submissions / reports / forms.
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await snapshot(page, "home");
    const candidates = await page.evaluate(() => {
      const seen = new Set();
      return [...document.querySelectorAll("a[href]")]
        .map((a) => ({ text: (a.textContent || "").trim(), href: a.href }))
        .filter((l) => /submi|report|result|data|dispatch|form/i.test(`${l.text} ${l.href}`) && !/logout|sign ?out|help|support|billing|pricing/i.test(`${l.text} ${l.href}`))
        .filter((l) => (seen.has(l.href) ? false : (seen.add(l.href), true)))
        .slice(0, 6);
    });
    out.notes.push(`menu candidates: ${candidates.length}`);
    for (const c of candidates) {
      await page.goto(c.href, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(2500);
      await snapshot(page, `menu: ${c.text.slice(0, 40)}`);
      // On a submissions-like page, open the first submission to see its detail.
      if (/submi/i.test(`${c.text} ${c.href}`)) {
        const opener = page
          .locator("table tbody tr a, table tbody tr, [class*=submission] a, a[href*='ubmission'], button:has-text('View')")
          .first();
        if (await opener.count().catch(() => 0)) {
          await opener.click({ timeout: 10_000 }).catch(() => {});
          await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
          await page.waitForTimeout(3000);
          await snapshot(page, "first submission");
          out.notes.push("opened the first submission");
        } else {
          out.notes.push("no submission row found to open");
        }
      }
    }
  } catch (e) {
    out.notes.push(`error: ${e?.message?.slice(0, 200) ?? e}`);
    console.error("FastField discovery stopped early:", e?.message ?? e);
  } finally {
    out.finishedAt = new Date().toISOString();
    await fs.writeFile("fastfield-discovery.json", JSON.stringify(out, null, 1));
    console.log(`Recorded ${out.calls.length} portal calls and ${out.pages.length} page layouts (values masked).`);
    await browser.close();
  }
}

main().catch((e) => {
  console.error("FastField discovery crashed:", e?.message ?? e);
  process.exit(1);
});
