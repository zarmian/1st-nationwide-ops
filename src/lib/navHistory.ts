/**
 * Where you came from — a per-tab trail of the app pages you've visited
 * (sessionStorage), so a page's back link returns you to the page you
 * actually came from, with its filters, instead of a fixed parent. Open a job
 * from the Activities log and its back link reads "← Activities"; open it from
 * a site and it reads "← <site name>".
 *
 * The trail behaves like the browser's history: visiting a page that's
 * already in it (going back, or saving a form that returns you there) cuts
 * the trail back to that page. Forms (…/new, …/edit) are never offered as
 * the page to go back to.
 *
 * Browser-only. Every read/write is wrapped, so private windows or blocked
 * storage simply fall back to the page's fixed back link.
 */

const KEY = "1nw:nav";
const MAX = 40;

export type NavEntry = { url: string; title?: string };
type State = {
  stack: NavEntry[];
  /** The last move added a page (not a jump back along the trail). */
  pushed: boolean;
};

function load(): State {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (Array.isArray(s.stack)) return { stack: s.stack, pushed: Boolean(s.pushed) };
    }
  } catch {
    // storage unavailable or corrupt — start afresh
  }
  return { stack: [], pushed: false };
}

function save(s: State): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable — the trail just isn't kept
  }
}

const pathOf = (url: string) => url.split("?")[0];
const isForm = (url: string) => /\/(new|edit)$/.test(pathOf(url));

/** The current page's URL as the trail stores it. */
export function currentUrl(): string {
  return window.location.pathname + window.location.search;
}

/** Note a page visit. Safe to call repeatedly for the same page. */
export function recordVisit(url: string): void {
  const s = load();
  if (s.stack[s.stack.length - 1]?.url === url) return;
  let i = -1;
  for (let k = s.stack.length - 1; k >= 0; k--) {
    if (s.stack[k].url === url) {
      i = k;
      break;
    }
  }
  if (i >= 0) {
    s.stack = s.stack.slice(0, i + 1);
    s.pushed = false;
  } else {
    s.stack.push({ url });
    if (s.stack.length > MAX) s.stack = s.stack.slice(-MAX);
    s.pushed = true;
  }
  save(s);
}

/** Remember a page's title, for the back link of the page after it. */
export function setPageTitle(url: string, title: string): void {
  recordVisit(url);
  const s = load();
  const last = s.stack[s.stack.length - 1];
  if (last && last.url === url && last.title !== title) {
    last.title = title;
    save(s);
  }
}

/**
 * The page to go back to from `url`: the nearest earlier page in the trail
 * that isn't a form or the same page. `viaHistory` is true when it's the
 * browser's previous page too, so going back can restore its scroll position.
 */
export function previousPage(url: string): { entry: NavEntry; viaHistory: boolean } | null {
  recordVisit(url);
  const s = load();
  const here = s.stack.length - 1;
  for (let j = here - 1; j >= 0; j--) {
    const e = s.stack[j];
    if (isForm(e.url) || pathOf(e.url) === pathOf(url)) continue;
    return { entry: e, viaHistory: s.pushed && j === here - 1 };
  }
  return null;
}

/** A name for a page that didn't record its own title. */
export function labelForUrl(url: string): string {
  const parts = pathOf(url).split("/").filter(Boolean);
  const first = parts[0] ?? "";
  const known: Record<string, string> = {
    dispatch: parts.length > 1 ? "Job" : "Home",
    activities: "Activities",
    sites: parts.length > 1 ? "Site" : "Sites",
    patrols: parts[1] === "visits" ? "Patrol visit" : "Patrols",
    shifts: parts.length > 1 ? "Shift" : "Shifts",
    finance: "Finance",
    operations: "Operations",
    admin: "Admin",
    officers: "Officers",
    customers: "Customers",
    partners: "Partners",
    reports: "Reports",
    keys: "Keys",
    rota: "Rota",
    m: "Today",
  };
  return known[first] ?? "Back";
}
