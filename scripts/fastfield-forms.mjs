// @ts-nocheck
/*
 * FastField forms → the app. Logs into the FastField web portal, lists the
 * submissions for a date window (every user's), asks the app which are new and
 * on a form that's switched on, then for each new one reads the full report,
 * copies its photos and signature into the app's storage (shrunk to at most
 * 1600 px) and sends it to /api/imports/fastfield, which attaches it to the
 * activity it's about (lib/fastfieldImport.ts).
 *
 * Serves both the 4-hourly run (last 3 days, in partner-syncs.yml) and the
 * one-off backfill (fastfield-forms.yml with a From date). Re-running is safe:
 * reports already imported are skipped, and a run that hits its time limit
 * leaves the rest for the next one.
 *
 * Preview (FASTFIELD_PREVIEW=true) copies no photos and writes nothing except
 * the list of FastField forms; it prints what would happen.
 *
 * The repo's Actions logs are visible to anyone with access, so this prints
 * counts only — never sites, names or answers — and saves no capture files.
 *
 * Env: FASTFIELD_USERNAME, FASTFIELD_PASSWORD (the FastField login),
 *      NEXUS_IMPORT_SECRET (the app's import secret),
 *      FASTFIELD_FROM / FASTFIELD_TO (YYYY-MM-DD; default last 3 days),
 *      FASTFIELD_PREVIEW, FASTFIELD_MAX_MINUTES (time limit, default 10),
 *      FASTFIELD_PORTAL_URL, FASTFIELD_IMPORT_URL (overrides).
 */
import { chromium } from "playwright";

const env = (k, d = "") => process.env[k] || d;
const USER = env("FASTFIELD_USERNAME");
const PASS = env("FASTFIELD_PASSWORD");
const SECRET = env("NEXUS_IMPORT_SECRET");
const BASE = (env("FASTFIELD_PORTAL_URL") || "https://portal.fastfieldforms.com").replace(/\/+$/, "");
const IMPORT_URL = (
  env("FASTFIELD_IMPORT_URL") || "https://1st-nationwide-ops.vercel.app/api/imports/fastfield"
).replace(/\/+$/, "");
const preview = env("FASTFIELD_PREVIEW").toLowerCase() === "true";
const MAX_MINUTES = Number(env("FASTFIELD_MAX_MINUTES", "10")) || 10;

const PAGE_SIZE = 500; // submissions per list request
const REPORTS_AT_ONCE = 3; // reports read + photos copied in parallel
const PHOTOS_AT_ONCE = 4; // per report
const MAX_PHOTOS = 60; // per report
const PHOTO_MAX_PX = 1600;
const KEEP_ORIGINAL_BYTES = 1_200_000;

const isoDay = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const FROM = env("FASTFIELD_FROM") || isoDay(new Date(today.getTime() - 3 * 86_400_000));
const TO = env("FASTFIELD_TO") || isoDay(today);
const started = Date.now();
const outOfTime = () => Date.now() - started > MAX_MINUTES * 60_000;

if (!USER || !PASS) {
  console.log("FastField not configured (no FASTFIELD_USERNAME / FASTFIELD_PASSWORD) — skipping.");
  process.exit(0);
}
if (!SECRET) {
  console.log("Import secret not configured (NEXUS_IMPORT_SECRET) — skipping.");
  process.exit(0);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(FROM) || !/^\d{4}-\d{2}-\d{2}$/.test(TO) || FROM > TO) {
  console.error(`Bad date window: from ${FROM} to ${TO} (use YYYY-MM-DD, from on or before to).`);
  process.exit(1);
}

// ── FastField portal ──────────────────────────────────────────────────────

async function login(page) {
  await page.goto(`${BASE}/Portal/Login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("#email", { timeout: 30_000 });
  const loginResponse = page.waitForResponse((r) => /\/portal\/logincommand/i.test(r.url()), {
    timeout: 45_000,
  });
  await page.fill("#email", USER);
  if (!(await page.isVisible("#pwd").catch(() => false))) {
    await page.press("#email", "Enter"); // two-step form: password box comes next
    await page.waitForSelector("#pwd", { state: "visible", timeout: 15_000 }).catch(() => {});
  }
  await page.fill("#pwd", PASS);
  await page.press("#pwd", "Enter");
  const res = await loginResponse.catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  if (data?.tfa) throw new Error("FastField asked for a two-step login code — the robot can't read it.");
  if (data?.mode === "verify-ip") {
    throw new Error("FastField asked to verify a new location (it emails a code) — log in once by hand, then re-run.");
  }
  if (data?.mode === "multi-account") {
    throw new Error("This FastField login has several accounts — the robot needs a single-account login.");
  }
  await page.waitForURL((u) => !/\/login/i.test(u.pathname), { timeout: 30_000 }).catch(() => {});
  if (/\/login/i.test(new URL(page.url()).pathname)) {
    throw new Error("FastField login didn't go through — check FASTFIELD_USERNAME / FASTFIELD_PASSWORD.");
  }
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
}

/** POST a portal command the way the portal's own pages do. */
async function command(page, body, attempts = 3) {
  for (let i = 1; ; i++) {
    const res = await page
      .evaluate(async (b) => {
        const headers = { "Content-Type": "application/json" };
        const tok =
          window.axios?.defaults?.headers?.common?.__RequestVerificationToken ||
          document.querySelector('input[name="__RequestVerificationToken"]')?.value;
        if (tok) headers.__RequestVerificationToken = tok;
        const r = await fetch("/portal/command", {
          method: "POST",
          headers,
          body: JSON.stringify(b),
          credentials: "same-origin",
        });
        let json = null;
        try {
          json = JSON.parse(await r.text());
        } catch {}
        return { status: r.status, json };
      }, body)
      .catch((e) => ({ status: 0, json: null, error: e?.message }));
    if (res.status === 200 && res.json != null) return res.json;
    if (i >= attempts || (res.status >= 400 && res.status < 500)) {
      throw new Error(`FastField ${body.commandName} failed (HTTP ${res.status || "no response"}).`);
    }
    await new Promise((r) => setTimeout(r, 2000 * i));
  }
}

async function readSetup(page) {
  const d = await command(page, { commandName: "Dashboard.GetDashboards" });
  const dashboards = Array.isArray(d?.dashboards) ? d.dashboards : [];
  let dashboard = null;
  let card = null;
  for (const db of dashboards) {
    const c = (db.cards || []).find((x) => x?.type === "RecentSubmissions");
    if (c) {
      dashboard = db;
      card = c;
      break;
    }
  }
  if (!card) {
    throw new Error("The FastField dashboard has no “Recent Submissions” card — add it back for the robot's login.");
  }
  let allForms = d?.supportData?.allForms;
  if (!Array.isArray(allForms) || !allForms.length) {
    const nav = await command(page, { commandName: "LeftNavCommands.GetLeftNav" }).catch(() => null);
    allForms = nav?.allForms ?? [];
  }
  const forms = allForms
    .filter((f) => Number.isInteger(f?.formId) && f.formId > 0)
    .map((f) => ({ formId: f.formId, name: String(f.formName ?? "").slice(0, 300) }));
  return { dashboard, card, forms };
}

/** Every submission in the window for one user filter, newest first. */
async function listFor(page, setup, selectedUser, selectedUserGroup) {
  const start = new Date(`${FROM}T00:00:00Z`);
  start.setUTCHours(start.getUTCHours() - 1); // UK midnight in summer time
  const end = new Date(`${TO}T23:59:59Z`);
  const seen = new Map();
  for (let p = 0; p < 200; p++) {
    const json = await command(page, {
      commandName: "Dashboard.GetCardData",
      dashboardId: setup.dashboard.dashboardId,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      selectedUser,
      selectedUserGroup,
      dashboardFilters: [],
      card: setup.card,
      page: p,
      size: PAGE_SIZE,
      maxResults: PAGE_SIZE,
      sorters: [],
    });
    if (json?.warning) return { rows: [], warning: String(json.warning).slice(0, 120) };
    const records = Array.isArray(json?.records) ? json.records : [];
    for (const r of records) {
      if (typeof r?.submissionId === "string" && r.submissionId && !seen.has(r.submissionId)) {
        seen.set(r.submissionId, String(r.formName ?? ""));
      }
    }
    if (records.length < PAGE_SIZE) break;
  }
  return { rows: Array.from(seen.entries()).map(([submissionId, formName]) => ({ submissionId, formName })) };
}

/** Every submission in the window, oldest first: everyone's, or — if this
 *  login may not list all users — the dashboard's own user filter. */
async function listSubmissions(page, setup) {
  let result = await listFor(page, setup, "All Users", "All User Groups");
  const own = setup.dashboard.selectedUser;
  if (!result.rows.length && own && own !== "All Users") {
    const fallback = await listFor(page, setup, own, setup.dashboard.selectedUserGroup || "All User Groups");
    if (fallback.rows.length || !result.warning) {
      if (fallback.rows.length) console.log("Listed with the dashboard's own user filter (this login can't list all users).");
      result = fallback;
    }
  }
  if (result.warning) throw new Error(`FastField wouldn't list submissions: ${result.warning}`);
  return result.rows.reverse(); // the list comes newest first; import oldest first
}

// ── Reading one submission ────────────────────────────────────────────────

function coords(loc) {
  if (!loc) return null;
  let lat, lng;
  if (typeof loc === "string") [lat, lng] = loc.split(",").map((s) => Number(s.trim()));
  else {
    lat = Number(loc.latitude ?? loc.lat);
    lng = Number(loc.longitude ?? loc.lng);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const isPhotoType = (t) => /photo|image|sketch|annotat/i.test(t || "");
const isSignatureType = (t) => /signature/i.test(t || "");

/** Media keys per field: from the submission's media list, else the value. */
function mediaKeys(detail) {
  const byField = new Map();
  for (const m of Array.isArray(detail.media) ? detail.media : []) {
    if (typeof m?.fieldValue !== "string" || !m.fieldValue) continue;
    const list = byField.get(m.fieldKey) ?? [];
    list.push({ key: m.fieldValue, comment: typeof m.comment === "string" ? m.comment : "" });
    byField.set(m.fieldKey, list);
  }
  return byField;
}

function keysFromValue(v) {
  if (typeof v === "string" && v) return [{ key: v, comment: "" }];
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : x?.photo ?? x?.item2 ?? x?.key))
      .filter((k) => typeof k === "string" && k)
      .map((key) => ({ key, comment: "" }));
  }
  return [];
}

/** The report as the app's import expects it, plus the media still to copy. */
function buildReport(submissionId, detail) {
  const sub = detail.submission ?? {};
  const meta = sub.formMetaData ?? {};
  const fieldMeta = new Map(
    (Array.isArray(meta.fieldMetaData) ? meta.fieldMetaData : []).map((m) => [m.fieldKey, m]),
  );
  const media = mediaKeys(detail);
  const answers = [];
  const toCopy = []; // { answerIndex|null, key, comment, kind }
  const fields = [];
  for (const page of detail.form?.page ?? []) {
    for (const section of page?.section ?? []) {
      for (const f of section?.field ?? []) if (f?.fieldKey) fields.push(f);
    }
  }
  const coveredKeys = new Set();
  for (const f of fields) {
    const key = f.fieldKey;
    const type = String(f.fieldType ?? "");
    let value = Object.prototype.hasOwnProperty.call(sub, key) ? sub[key] : f.fieldValue;
    const fm = fieldMeta.get(key);
    const at = fm?.timestamp ?? f.timestamp ?? null;
    const gps = coords(fm?.location) ?? coords(f.location);
    const label = String(f.fieldName ?? key).slice(0, 1000);
    if (isPhotoType(type) || isSignatureType(type)) {
      const keys = (media.get(key) ?? keysFromValue(value)).slice(0, MAX_PHOTOS);
      if (!keys.length) continue;
      keys.forEach((k) => coveredKeys.add(k.key));
      value = null; // filled in once copied
      answers.push({ key, label, type, value, at, lat: gps?.lat ?? null, lng: gps?.lng ?? null });
      for (const k of keys) {
        toCopy.push({ answerIndex: answers.length - 1, ...k, kind: isSignatureType(type) ? "signature" : "photo" });
      }
      continue;
    }
    if (value === null || value === undefined || value === "") continue;
    answers.push({ key, label, type, value, at, lat: gps?.lat ?? null, lng: gps?.lng ?? null });
  }
  // Photos in parts of the form not listed above (e.g. repeating sections).
  for (const [, list] of media) {
    for (const k of list) {
      if (!coveredKeys.has(k.key) && toCopy.length < MAX_PHOTOS) {
        coveredKeys.add(k.key);
        toCopy.push({ answerIndex: null, ...k, kind: "photo" });
      }
    }
  }
  const formId = Number(sub.formId);
  return {
    report: {
      submissionId,
      formId,
      formName: String(sub.formName ?? detail.form?.formName ?? ""),
      submittedAt: sub.updatedAt ?? meta.endFormTimeStamp ?? new Date().toISOString(),
      startedAt: meta.startFormTimeStamp ?? null,
      finishedAt: meta.endFormTimeStamp ?? null,
      submittedBy: typeof sub.userName === "string" ? sub.userName : null,
      answers,
      photoUrls: [],
      signatureUrl: null,
    },
    toCopy,
  };
}

// ── Photos ────────────────────────────────────────────────────────────────

/** Shrink an image in the browser (no extra packages). Null = keep as is. */
async function shrink(imgPage, buf, type) {
  const out = await imgPage
    .evaluate(
      async ({ b64, type, max, keep }) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([bytes], { type }));
        const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
        if (scale === 1 && bytes.length <= keep && /jpeg|png|webp/.test(type)) return null;
        const w = Math.max(1, Math.round(bmp.width * scale));
        const h = Math.max(1, Math.round(bmp.height * scale));
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; // signatures are transparent PNGs
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bmp, 0, 0, w, h);
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
        const ab = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < ab.length; i += 0x8000) s += String.fromCharCode.apply(null, ab.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { b64: buf.toString("base64"), type, max: PHOTO_MAX_PX, keep: KEEP_ORIGINAL_BYTES },
    )
    .catch(() => undefined);
  if (out === undefined) return null; // couldn't decode it
  return out ? { buf: Buffer.from(out, "base64"), type: "image/jpeg" } : { buf, type };
}

async function copyMedia(context, imgPage, submissionId, item, n) {
  const res = await context.request
    .get(`${BASE}/api/media/amazon/${encodeURIComponent(item.key)}/redirect`, { timeout: 60_000 })
    .catch(() => null);
  if (!res || !res.ok()) return null;
  const type = (res.headers()["content-type"] || "image/jpeg").split(";")[0].trim().toLowerCase();
  const image = await shrink(imgPage, Buffer.from(await res.body()), type);
  if (!image || image.buf.length > 4 * 1024 * 1024) return null;
  const name = `${item.kind}-${n + 1}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const up = await fetch(
      `${IMPORT_URL}/photo?submission=${encodeURIComponent(submissionId)}&name=${encodeURIComponent(name)}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": image.type },
        body: image.buf,
      },
    ).catch(() => null);
    if (up?.ok) {
      const json = await up.json().catch(() => ({}));
      if (typeof json.url === "string") return json.url;
    }
    if (up && up.status < 500) return null;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return null;
}

async function inBatches(items, size, fn) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i += size) {
    const part = await Promise.all(items.slice(i, i + size).map((x, j) => fn(x, i + j)));
    part.forEach((v, j) => (out[i + j] = v));
  }
  return out;
}

const photoCounts = { copied: 0, failed: 0 };

async function readReport(page, context, imgPage, submissionId) {
  const detail = await command(page, { commandName: "Submission.GetSubmissionData", submissionId });
  if (!detail?.submission) return null;
  const { report, toCopy } = buildReport(submissionId, detail);
  if (!Number.isInteger(report.formId) || report.formId <= 0) return null;
  if (preview || toCopy.length === 0) return report;

  const urls = await inBatches(toCopy, PHOTOS_AT_ONCE, (item, n) =>
    copyMedia(context, imgPage, submissionId, item, n),
  );
  toCopy.forEach((item, i) => {
    const url = urls[i];
    if (!url) {
      photoCounts.failed++;
      return;
    }
    photoCounts.copied++;
    if (item.kind === "signature") {
      if (!report.signatureUrl) report.signatureUrl = url;
      if (item.answerIndex != null) report.answers[item.answerIndex].value = url;
      return;
    }
    report.photoUrls.push(url);
    if (item.answerIndex != null) {
      const a = report.answers[item.answerIndex];
      a.value = [...(Array.isArray(a.value) ? a.value : []), item.comment ? { url, comment: item.comment } : { url }];
    }
  });
  return report;
}

// ── The app ───────────────────────────────────────────────────────────────

class Refused extends Error {}

async function postApp(body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${IMPORT_URL}${preview ? "?preview=1" : ""}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok && json.ok !== false) return json;
    if (res && res.status < 500) {
      throw new Refused(`The app refused the ${body.action} (HTTP ${res.status}${json.error ? `: ${String(json.error).slice(0, 120)}` : ""}).`);
    }
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  throw new Error(`The app didn't answer the ${body.action} request.`);
}

/** Send reports; if the app refuses a batch, send them one by one so a single
 *  odd report doesn't stop the rest. */
async function importReports(reports, total) {
  try {
    addSummary(total, await postApp({ action: "import", reports }));
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    if (reports.length === 1) {
      console.warn(String(e.message));
      total.failed = (total.failed ?? 0) + 1;
      return;
    }
    for (const r of reports) await importReports([r], total);
  }
}

function addSummary(total, s) {
  for (const k of ["received", "alreadyImported", "formOff", "linked", "created", "failed"]) {
    total[k] = (total[k] ?? 0) + (s[k] ?? 0);
  }
  total.linkedByType ??= {};
  for (const [t, n] of Object.entries(s.linkedByType ?? {})) total.linkedByType[t] = (total.linkedByType[t] ?? 0) + n;
  total.unmatched ??= { site: 0, none: 0, taken: 0, ambiguous: 0 };
  for (const [r, n] of Object.entries(s.unmatched ?? {})) total.unmatched[r] = (total.unmatched[r] ?? 0) + n;
}

const TYPE_WORDS = {
  ALARM_RESPONSE: "callouts",
  PATROL: "patrols",
  LOCK: "lock-ups",
  UNLOCK: "unlocks",
  KEY_COLLECTION: "key collections",
  KEY_DROPOFF: "key drop-offs",
  VPI: "VPIs",
  ADHOC: "ad-hoc jobs",
  SURVEY: "surveys",
};

function describe(total) {
  const byType = Object.entries(total.linkedByType ?? {})
    .map(([t, n]) => `${n} ${TYPE_WORDS[t] ?? t}`)
    .join(", ");
  const u = total.unmatched ?? {};
  const unmatched = (u.site ?? 0) + (u.none ?? 0) + (u.taken ?? 0) + (u.ambiguous ?? 0);
  return (
    `linked ${total.linked ?? 0}${byType ? ` (${byType})` : ""}, ` +
    `created ${total.created ?? 0}, ` +
    `unmatched ${unmatched} (site not recognised ${u.site ?? 0}, no activity near the time ${u.none ?? 0}, ` +
    `activity already had a report ${u.taken ?? 0}, two activities equally close ${u.ambiguous ?? 0})` +
    (total.failed ? `, failed ${total.failed}` : "")
  );
}

// ── Run ───────────────────────────────────────────────────────────────────

async function run() {
  console.log(`FastField ${preview ? "preview" : "import"}: ${FROM} to ${TO}, time limit ${MAX_MINUTES} min.`);
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const imgPage = await context.newPage(); // blank page used to shrink photos
  try {
    await login(page);
    console.log("Logged in to FastField.");
    const setup = await readSetup(page);
    const listed = await listSubmissions(page, setup);
    console.log(`Listed ${listed.length} submissions across ${setup.forms.length} forms.`);

    const byName = new Map();
    for (const f of setup.forms) {
      const k = f.name.trim().toLowerCase();
      byName.set(k, byName.has(k) ? null : f.formId); // null = name used twice
    }
    const plan = await postApp({
      action: "plan",
      forms: setup.forms,
      submissions: listed.map((s) => ({
        submissionId: s.submissionId,
        formId: byName.get(s.formName.trim().toLowerCase()) ?? null,
        formName: s.formName,
      })),
    });
    const c = plan.counts ?? {};
    console.log(
      `New to import: ${c.toFetch ?? 0} (already imported ${c.alreadyImported ?? 0}, ` +
        `on forms switched off ${c.formOff ?? 0}, unknown form ${c.unknownForm ?? 0}).`,
    );

    const ids = Array.isArray(plan.fetch) ? plan.fetch : [];
    const total = {};
    let done = 0;
    let unreadable = 0;
    for (let i = 0; i < ids.length; i += REPORTS_AT_ONCE) {
      if (outOfTime()) break;
      const chunk = ids.slice(i, i + REPORTS_AT_ONCE);
      const reports = (
        await Promise.all(
          chunk.map((id) =>
            readReport(page, context, imgPage, id).catch((e) => {
              console.warn(`Couldn't read one submission: ${String(e?.message ?? e).slice(0, 120)}`);
              return null;
            }),
          ),
        )
      ).filter(Boolean);
      unreadable += chunk.length - reports.length;
      if (reports.length) await importReports(reports, total);
      done += chunk.length;
      if (done % 60 < REPORTS_AT_ONCE || done === ids.length) {
        console.log(`Progress: ${done}/${ids.length}`);
      }
    }
    if (done < ids.length) {
      console.log(`Stopped after ${done} of ${ids.length} at the ${MAX_MINUTES}-minute limit — the next run carries on.`);
    }
    if (unreadable) console.log(`Couldn't read ${unreadable} submissions from FastField (deleted or no access).`);

    if (preview) {
      console.log(`Preview OK — would have ${describe(total)}.`);
    } else {
      console.log(
        `FastField OK — ${describe(total)}; photos copied ${photoCounts.copied}` +
          (photoCounts.failed ? `, ${photoCounts.failed} couldn't be copied` : "") +
          ".",
      );
      const retry = await postApp({ action: "retry" });
      if ((retry.linked ?? 0) + (retry.created ?? 0) > 0) {
        console.log(`Earlier unmatched reports now attached: linked ${retry.linked ?? 0}, created ${retry.created ?? 0}.`);
      }
    }
    if (ids.length && (total.failed ?? 0) >= ids.length) {
      throw new Error("Every report failed to import.");
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

run().catch((e) => {
  console.error("FastField sync failed:", String(e?.message ?? e).slice(0, 300));
  process.exit(1);
});
