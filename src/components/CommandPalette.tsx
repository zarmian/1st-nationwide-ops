"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SiteHit = {
  id: string;
  name: string;
  code: string | null;
  postcodeFormatted: string;
  customer: { name: string } | null;
  partner: { name: string } | null;
};
type OfficerHit = { id: string; name: string; email: string; role: string };
type JobHit = {
  id: string;
  type: string;
  status: string;
  site: { name: string } | null;
  customer: { name: string } | null;
  partner: { name: string } | null;
};
type ShiftHit = {
  id: string;
  type: string;
  status: string;
  site: { name: string };
  officer: { name: string } | null;
};

type SearchResults = {
  sites: SiteHit[];
  officers: OfficerHit[];
  jobs: JobHit[];
  shifts: ShiftHit[];
};

type Action = {
  id: string;
  group: "Quick actions" | "Sites" | "Officers" | "Live jobs" | "Shifts" | "Navigation";
  label: string;
  hint?: string;
  href: string;
};

const QUICK_NAV: Action[] = [
  { id: "nav-today", group: "Navigation", label: "Today", hint: "/m/today", href: "/m/today" },
  { id: "nav-dispatch", group: "Navigation", label: "Dispatch", hint: "/dispatch", href: "/dispatch" },
  { id: "nav-sites", group: "Navigation", label: "Sites", hint: "/sites", href: "/sites" },
  { id: "nav-officers", group: "Navigation", label: "Officers", hint: "/officers", href: "/officers" },
  { id: "nav-keys", group: "Navigation", label: "Keys", hint: "/keys", href: "/keys" },
  { id: "nav-patrols", group: "Navigation", label: "Schedules (patrols, lock-ups)", hint: "/patrols", href: "/patrols" },
  { id: "nav-shifts", group: "Navigation", label: "Shifts", hint: "/shifts", href: "/shifts" },
  { id: "nav-activities", group: "Navigation", label: "Activities log", hint: "/activities", href: "/activities" },
  { id: "nav-finance", group: "Navigation", label: "Finance", hint: "/finance", href: "/finance" },
  { id: "nav-reports", group: "Navigation", label: "Reports / review queue", hint: "/admin/reports", href: "/admin/reports" },
  { id: "nav-admin", group: "Navigation", label: "Admin home", hint: "/admin", href: "/admin" },
];

const QUICK_ACTIONS: Action[] = [
  { id: "act-new-job", group: "Quick actions", label: "New job (alarm / ad-hoc / lock / unlock)", hint: "+ /dispatch/new", href: "/dispatch/new" },
  { id: "act-new-shift", group: "Quick actions", label: "New shift", hint: "+ /shifts/new", href: "/shifts/new" },
  { id: "act-new-site", group: "Quick actions", label: "New site", hint: "+ /sites/new", href: "/sites/new" },
  { id: "act-new-officer", group: "Quick actions", label: "New officer", hint: "+ /officers/new", href: "/officers/new" },
  { id: "act-new-template", group: "Quick actions", label: "New form template", hint: "+ /admin/forms/new", href: "/admin/forms/new" },
];

const STATIC_ACTIONS = [...QUICK_ACTIONS, ...QUICK_NAV];

// Hrefs that only ADMIN can reach. DISPATCHER also sees /admin/reports
// because they're the reviewers; everything else under /admin redirects them.
// OFFICER can only reach /m/* and /submit (see middleware.ts).
function isAllowedForRole(href: string, role?: string): boolean {
  if (role === "OFFICER") {
    return (
      href === "/m" ||
      href.startsWith("/m/") ||
      href === "/submit" ||
      href.startsWith("/submit/")
    );
  }
  if (href.startsWith("/admin")) {
    if (role === "ADMIN") return true;
    return href === "/admin/reports" || href.startsWith("/admin/reports/");
  }
  return true;
}

export function CommandPalette({ role }: { role?: string } = {}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  // Global ⌘K / Ctrl+K hotkey + custom event so non-keyboard surfaces
  // (e.g. a "Search" button in the TopNav) can also open the palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isOpen = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      if (isOpen) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    }
    function onCustomOpen() {
      setOpen(true);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("palette:open", onCustomOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("palette:open", onCustomOpen);
    };
  }, []);

  // Auto-focus on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
      setActive(0);
    } else {
      setQuery("");
      setResults(null);
    }
  }, [open]);

  // Debounced server-side search
  useEffect(() => {
    if (!open) return;
    if (query.trim().length < 2) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const handle = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`, {
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then((data: SearchResults) => setResults(data))
        .catch(() => {
          /* aborted or offline — ignore */
        })
        .finally(() => setLoading(false));
    }, 150);
    return () => {
      ctrl.abort();
      clearTimeout(handle);
    };
  }, [query, open]);

  // Build the flat ordered action list (quick actions + nav + search results).
  const items = buildItems(query, results, role);

  // Keep active index in bounds
  useEffect(() => {
    if (active >= items.length) setActive(Math.max(0, items.length - 1));
  }, [items.length, active]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyInput(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[active];
      if (item) go(item.href);
    }
  }

  if (!open) return null;

  // Group items for display
  const groups = new Map<string, Action[]>();
  for (const item of items) {
    const existing = groups.get(item.group) ?? [];
    existing.push(item);
    groups.set(item.group, existing);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-slate-900/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl overflow-hidden border border-slate-200">
        <div className="flex items-center px-3 border-b border-slate-100">
          <span className="text-slate-400 text-sm pr-2" aria-hidden>⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyInput}
            placeholder="Find a site, officer, job, or jump to a page…"
            className="w-full py-3 text-base focus:outline-none placeholder:text-slate-400"
            aria-label="Search"
          />
          {loading && (
            <span className="text-xs text-slate-400 pl-2 pr-1">…</span>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              {query.trim().length < 2
                ? "Type at least 2 characters to search."
                : loading
                  ? "Searching…"
                  : "Nothing matched."}
            </div>
          ) : (
            Array.from(groups.entries()).map(([group, groupItems]) => (
              <div key={group} className="py-1">
                <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-slate-400">
                  {group}
                </div>
                {groupItems.map((item) => {
                  const idx = items.indexOf(item);
                  const isActive = idx === active;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={
                        "w-full text-left px-3 py-2 flex items-center justify-between gap-3 text-sm " +
                        (isActive
                          ? "bg-brand-blue-light text-brand-navy"
                          : "hover:bg-slate-50 text-slate-700")
                      }
                      onClick={() => go(item.href)}
                      onMouseEnter={() => setActive(idx)}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.hint && (
                        <span className="text-xs text-slate-400 font-mono shrink-0">
                          {item.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="px-3 py-2 text-[11px] text-slate-400 border-t border-slate-100 flex items-center gap-3">
          <span><kbd className="px-1 bg-slate-100 rounded">↑</kbd>/<kbd className="px-1 bg-slate-100 rounded">↓</kbd> navigate</span>
          <span><kbd className="px-1 bg-slate-100 rounded">↵</kbd> open</span>
          <span><kbd className="px-1 bg-slate-100 rounded">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function buildItems(
  query: string,
  results: SearchResults | null,
  role?: string,
): Action[] {
  const q = query.trim().toLowerCase();
  const items: Action[] = [];

  // Include searchable static actions, filtered by label AND by role —
  // surfacing /admin/customers to a dispatcher would just bounce them.
  for (const a of STATIC_ACTIONS) {
    if (!isAllowedForRole(a.href, role)) continue;
    if (!q || a.label.toLowerCase().includes(q) || (a.hint ?? "").toLowerCase().includes(q)) {
      items.push(a);
    }
  }

  if (results) {
    for (const s of results.sites) {
      items.push({
        id: `site-${s.id}`,
        group: "Sites",
        label: [s.code, s.name].filter(Boolean).join(" · "),
        hint: `${s.postcodeFormatted}${
          s.customer?.name
            ? ` · ${s.customer.name}`
            : s.partner?.name
              ? ` · ${s.partner.name}`
              : ""
        }`,
        href: `/sites/${s.id}`,
      });
    }
    for (const o of results.officers) {
      items.push({
        id: `officer-${o.id}`,
        group: "Officers",
        label: o.name,
        hint: `${o.role.toLowerCase()} · ${o.email}`,
        href: `/officers/${o.id}/edit`,
      });
    }
    for (const j of results.jobs) {
      items.push({
        id: `job-${j.id}`,
        group: "Live jobs",
        label: `${j.type.replace(/_/g, " ").toLowerCase()} — ${j.site?.name ?? "site TBD"}`,
        hint: `${j.status.toLowerCase()} · ${
          j.customer?.name ?? j.partner?.name ?? "—"
        }`,
        href: `/dispatch`,
      });
    }
    for (const s of results.shifts) {
      items.push({
        id: `shift-${s.id}`,
        group: "Shifts",
        label: `${s.type.replace(/_/g, " ").toLowerCase()} — ${s.site.name}`,
        hint: `${s.status.toLowerCase()} · ${s.officer?.name ?? "unassigned"}`,
        href: `/shifts/${s.id}`,
      });
    }
  }

  return items;
}
