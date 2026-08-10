"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Wallet,
  Tag,
  LogOut,
} from "lucide-react";
import { BrandLogo } from "./BrandLogo";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<any>;
};

const PARTNER_LINKS: NavItem[] = [
  { href: "/partner", label: "Home", icon: LayoutDashboard },
  { href: "/partner/activities", label: "Activities", icon: ClipboardList },
  { href: "/partner/officers", label: "Officers", icon: Users },
  { href: "/partner/rates", label: "Rates", icon: Tag },
  { href: "/partner/finance", label: "Finance", icon: Wallet },
];

function isItemActive(pathname: string, href: string): boolean {
  if (href === "/partner") return pathname === "/partner";
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Partner-portal top nav. Slimmer than the staff TopNav — no admin /
 * operations hubs, no role-conditional finance access, no search.
 * The partner name is rendered as the "you are signed in as" label
 * so the partner sees their org confirmed at a glance.
 */
export function PartnerTopNav({
  partnerName,
  userEmail,
}: {
  partnerName: string;
  userEmail?: string | null;
}) {
  const pathname = usePathname() ?? "";

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between gap-3">
        <Link
          href="/partner"
          className="inline-flex items-center gap-3"
          aria-label="Partner portal home"
        >
          <BrandLogo />
          <span className="hidden sm:inline-flex items-center gap-1.5 text-sm text-slate-600">
            <span className="chip-slate text-[10px]">Partner portal</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {PARTNER_LINKS.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm transition " +
                  (active
                    ? "bg-brand-blue-50 text-brand-blue-dark font-medium"
                    : "text-slate-600 hover:bg-brand-blue-50 hover:text-brand-navy")
                }
              >
                <Icon size={14} aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 text-sm">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-xs font-medium text-brand-navy truncate max-w-[200px]">
              {partnerName}
            </span>
            {userEmail && (
              <span className="text-[10px] text-slate-500 truncate max-w-[200px]">
                {userEmail}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="btn-ghost text-xs inline-flex items-center gap-1"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={13} aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>

      {/* Mobile nav — single-line scrollable */}
      <nav className="md:hidden border-t border-slate-100 px-4 py-1 overflow-x-auto">
        <ul className="flex items-center gap-1">
          {PARTNER_LINKS.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(pathname, item.href);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  className={
                    "inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg " +
                    (active
                      ? "bg-brand-blue-50 text-brand-blue-dark font-medium"
                      : "text-slate-600")
                  }
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
