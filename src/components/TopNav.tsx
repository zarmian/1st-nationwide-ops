"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { BrandLogo } from "./BrandLogo";

type NavItem = { href: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

const OFFICER_LINKS: NavItem[] = [
  { href: "/m/today", label: "Today" },
  { href: "/submit", label: "Log activity" },
];

const STAFF_TOP: NavItem[] = [
  { href: "/m/today", label: "Today" },
  { href: "/dispatch", label: "Dispatch" },
  { href: "/sites", label: "Sites" },
  { href: "/finance", label: "Finance" },
];

const STAFF_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/patrols", label: "Schedules" },
      { href: "/shifts", label: "Shifts" },
      { href: "/keys", label: "Keys" },
      { href: "/onboarding", label: "Onboarding" },
      { href: "/officers", label: "Officers" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin", label: "Admin home" },
      { href: "/admin/reports", label: "Review queue" },
      { href: "/admin/customers", label: "Customers" },
      { href: "/admin/partners", label: "Partners" },
      { href: "/admin/regions", label: "Regions" },
      { href: "/admin/forms", label: "Form templates" },
      { href: "/admin/blueprints", label: "Form blueprints" },
      { href: "/admin/officer-rates", label: "Officer rates" },
      { href: "/admin/notifications", label: "Notifications" },
      { href: "/admin/imports/nexus", label: "Nexus import" },
    ],
  },
];

function isItemActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

function isGroupActive(pathname: string, group: NavGroup): boolean {
  return group.items.some((i) => isItemActive(pathname, i.href));
}

export function TopNav({
  userName,
  role,
}: {
  userName?: string | null;
  role?: string;
}) {
  const pathname = usePathname() ?? "";
  const isStaff = role === "ADMIN" || role === "DISPATCHER";

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between gap-3">
        <Link href={isStaff ? "/dispatch" : "/m/today"} aria-label="Home">
          <BrandLogo />
        </Link>

        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {isStaff ? (
            <>
              {STAFF_TOP.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isItemActive(pathname, item.href)}
                />
              ))}
              {STAFF_GROUPS.map((g) => (
                <NavDropdown
                  key={g.label}
                  group={g}
                  pathname={pathname}
                  active={isGroupActive(pathname, g)}
                />
              ))}
            </>
          ) : (
            OFFICER_LINKS.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isItemActive(pathname, item.href)}
              />
            ))
          )}
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              document.dispatchEvent(new CustomEvent("palette:open"))
            }
            aria-label="Search (⌘K)"
            className="hidden md:flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            title="Search — ⌘K"
          >
            <span>Search…</span>
            <kbd className="text-[10px] bg-slate-100 px-1 rounded font-mono">
              ⌘K
            </kbd>
          </button>
          <button
            type="button"
            onClick={() =>
              document.dispatchEvent(new CustomEvent("palette:open"))
            }
            aria-label="Search"
            className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <SearchIcon />
          </button>
          <div className="hidden sm:block text-right leading-tight">
            <div className="text-sm font-medium text-slate-800 truncate max-w-[140px]">
              {userName ?? "User"}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              {role ?? "—"}
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="btn-ghost text-sm"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Mobile nav strip — primary items only, scrolls horizontally */}
      <div className="md:hidden border-t border-slate-100 overflow-x-auto">
        <div className="px-3 py-2 flex items-center gap-1 whitespace-nowrap">
          {(isStaff ? [...STAFF_TOP, ...STAFF_GROUPS.flatMap((g) => g.items.slice(0, 1))] : OFFICER_LINKS).map(
            (item) => {
              const active = isItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "px-3 py-1.5 rounded-lg text-sm font-medium " +
                    (active
                      ? "bg-brand-mint-light text-brand-mint-dark"
                      : "text-slate-600 hover:bg-slate-100")
                  }
                >
                  {item.label}
                </Link>
              );
            },
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={
        "px-3 py-1.5 rounded-lg text-sm font-medium " +
        (active
          ? "bg-brand-mint-light text-brand-mint-dark"
          : "text-slate-600 hover:bg-slate-100")
      }
    >
      {item.label}
    </Link>
  );
}

function NavDropdown({
  group,
  pathname,
  active,
}: {
  group: NavGroup;
  pathname: string;
  active: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on click outside / ESC.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          "px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 " +
          (active
            ? "bg-brand-mint-light text-brand-mint-dark"
            : "text-slate-600 hover:bg-slate-100")
        }
      >
        {group.label}
        <ChevronDown />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 min-w-[200px] rounded-xl bg-white border border-slate-200 shadow-lg p-1 z-30"
        >
          {group.items.map((item) => {
            const isActive = isItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                className={
                  "block px-3 py-2 rounded-lg text-sm " +
                  (isActive
                    ? "bg-brand-mint-light text-brand-mint-dark"
                    : "text-slate-700 hover:bg-slate-50")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
