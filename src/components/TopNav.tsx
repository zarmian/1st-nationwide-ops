"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { BrandLogo } from "./BrandLogo";

type NavItem = { href: string; label: string };

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

// Operations / Admin are now single buttons rather than dropdowns. Each
// takes you to a hub page (`/operations`, `/admin`) that links out to
// every sub-area — keeps the top bar uncluttered and avoids the "what's
// in this menu again?" lookup.
const STAFF_HUBS: NavItem[] = [
  { href: "/operations", label: "Operations" },
];
const ADMIN_HUBS: NavItem[] = [{ href: "/admin", label: "Admin" }];

function isItemActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  if (href === "/operations") return pathname === "/operations";
  return pathname === href || pathname.startsWith(href + "/");
}

export function TopNav({
  userName,
  role,
}: {
  userName?: string | null;
  role?: string;
}) {
  const pathname = usePathname() ?? "";
  const isAdmin = role === "ADMIN";
  const isStaff = isAdmin || role === "DISPATCHER";
  const hubs = isAdmin ? [...STAFF_HUBS, ...ADMIN_HUBS] : STAFF_HUBS;

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
              {hubs.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isItemActive(pathname, item.href)}
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
          {(isStaff ? [...STAFF_TOP, ...hubs] : OFFICER_LINKS).map(
            (item) => {
              const active = isItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 " +
                    (active
                      ? "bg-brand-blue-100 text-brand-blue-800"
                      : "text-slate-600 hover:bg-brand-blue-50 hover:text-brand-blue-700")
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
      aria-current={active ? "page" : undefined}
      className={
        "relative px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 " +
        (active
          ? "text-brand-navy"
          : "text-slate-600 hover:bg-brand-blue-50 hover:text-brand-blue-700")
      }
    >
      {item.label}
      {active && (
        <span
          aria-hidden
          className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-brand-blue"
        />
      )}
    </Link>
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
