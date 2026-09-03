"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  CalendarDays,
  CalendarRange,
  LayoutDashboard,
  MapPin,
  Wallet,
  Wrench,
  Shield,
  FileEdit,
  Search,
  LogOut,
} from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import { roleLabel } from "@/lib/roleLabel";

// Lucide's PropTypes-based signatures don't line up with our minimal
// React.ComponentType prop subset on this version of lucide-react, so
// we lean on the icon module's own typing via React.ComponentType<any>.
// The runtime contract is just "renders an icon at the given size".
type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<any>;
};

const OFFICER_LINKS: NavItem[] = [
  { href: "/m/today", label: "Today", icon: CalendarDays },
  { href: "/m/rota", label: "My rota", icon: CalendarRange },
  { href: "/submit", label: "Log activity", icon: FileEdit },
];

// Primary nav shown to every staff member (admins + dispatchers).
// "Home" is the dispatch board — the landing page for staff.
const STAFF_TOP: NavItem[] = [
  { href: "/dispatch", label: "Home", icon: LayoutDashboard },
  { href: "/sites", label: "Sites", icon: MapPin },
];

// Admin-only primary items. Finance is admin-only — a dispatcher can't open
// it, so it shouldn't sit in their bar at all.
const ADMIN_TOP: NavItem[] = [
  { href: "/finance", label: "Finance", icon: Wallet },
];

// Hub buttons (grouped landing pages). Rota now lives inside Operations.
const STAFF_HUBS: NavItem[] = [
  { href: "/operations", label: "Operations", icon: Wrench },
];
const ADMIN_HUBS: NavItem[] = [
  { href: "/admin", label: "Admin", icon: Shield },
];

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
  const topLinks = isAdmin ? [...STAFF_TOP, ...ADMIN_TOP] : STAFF_TOP;
  const hubs = isAdmin ? [...STAFF_HUBS, ...ADMIN_HUBS] : STAFF_HUBS;

  return (
    <header className="glass-nav sticky top-0 z-40 border-b border-brand-blue-100/70 pt-safe">
      <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between gap-3">
        <Link href={isStaff ? "/dispatch" : "/m/today"} aria-label="Home">
          <BrandLogo />
        </Link>

        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {isStaff ? (
            <>
              {topLinks.map((item) => (
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
            className="hidden md:flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-brand-blue-50 hover:border-brand-blue-300 hover:text-brand-blue-700 transition-colors duration-150"
            title="Search — ⌘K"
          >
            <Search size={14} aria-hidden />
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
            className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-brand-blue-50 hover:text-brand-blue-700 transition-colors"
          >
            <Search size={18} aria-hidden />
          </button>
          <div className="hidden sm:flex items-center gap-2">
            <Avatar name={userName ?? ""} role={role} />
            <div className="text-right leading-tight">
              <div className="text-sm font-medium text-brand-navy truncate max-w-[140px]">
                {userName ?? "User"}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                {roleLabel(role)}
              </div>
            </div>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="btn-ghost text-sm"
            aria-label="Sign out"
          >
            <LogOut size={14} aria-hidden />
            <span className="hidden lg:inline">Sign out</span>
          </button>
        </div>
      </div>

      {/* Mobile nav strip — primary items only, scrolls horizontally */}
      <div className="md:hidden border-t border-slate-100 overflow-x-auto">
        <div className="px-3 py-2 flex items-center gap-1 whitespace-nowrap">
          {(isStaff ? [...topLinks, ...hubs] : OFFICER_LINKS).map(
            (item) => {
              const active = isItemActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition " +
                    (active
                      ? "border-brand-blue-dark bg-gradient-to-b from-brand-blue-500 to-brand-blue-dark text-white"
                      : "border-brand-blue-200 bg-white/70 text-brand-navy")
                  }
                >
                  <Icon size={15} aria-hidden />
                  {item.label}
                </Link>
              );
            },
          )}
        </div>
      </div>
      {/* Gradient accent underline — mirrors the client portal header. */}
      <div
        aria-hidden
        className="h-[3px] w-full bg-gradient-to-r from-brand-blue via-brand-blue-dark to-brand-navy"
      />
    </header>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={
        "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium transition " +
        (active
          ? "border-brand-blue-dark bg-gradient-to-b from-brand-blue-500 to-brand-blue-dark text-white shadow-sm"
          : "border-brand-blue-200 bg-white/70 text-brand-navy hover:border-brand-blue-400 hover:bg-white hover:shadow-sm")
      }
    >
      <Icon
        size={15}
        aria-hidden
        className={active ? "text-white" : "text-brand-blue"}
      />
      {item.label}
    </Link>
  );
}

/**
 * Avatar with initials + role-tinted background. Officer → amber,
 * Dispatcher → blue, Admin → mint-tinted (uses brand-blue-100 fallback).
 * Gives the top bar a face without needing real user photos in the DB.
 */
function Avatar({ name, role }: { name: string; role?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";
  const tone =
    role === "OFFICER"
      ? "bg-amber-100 text-amber-800 ring-amber-200"
      : role === "ADMIN"
        ? "bg-brand-navy text-white ring-brand-navy-700"
        : "bg-brand-blue-100 text-brand-blue-800 ring-brand-blue-200";
  return (
    <div
      aria-hidden
      className={`h-8 w-8 rounded-full grid place-items-center text-xs font-semibold ring-1 ${tone}`}
    >
      {initials}
    </div>
  );
}
