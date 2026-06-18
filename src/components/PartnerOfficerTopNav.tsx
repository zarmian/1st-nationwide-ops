"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { CalendarDays, LogOut } from "lucide-react";
import { BrandLogo } from "./BrandLogo";

const LINKS = [
  { href: "/partner/m/today", label: "Today", icon: CalendarDays },
];

function isItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Partner-officer mobile nav. Even slimmer than the partner-admin
 * version: one link today. Shows the officer's own name + their
 * partner org so they can confirm they're on the right account.
 */
export function PartnerOfficerTopNav({
  partnerName,
  officerName,
}: {
  partnerName: string;
  officerName: string;
}) {
  const pathname = usePathname() ?? "";
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between gap-3">
        <Link
          href="/partner/m/today"
          className="inline-flex items-center gap-3"
          aria-label="Today"
        >
          <BrandLogo />
          <span className="hidden sm:inline-flex items-center gap-1.5 text-sm text-slate-600">
            <span className="chip-slate text-[10px]">Officer · {partnerName}</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 flex-1 justify-center">
          {LINKS.map((item) => {
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
                <Icon size={14} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 text-sm">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-xs font-medium text-brand-navy truncate max-w-[180px]">
              {officerName}
            </span>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="btn-ghost text-xs inline-flex items-center gap-1"
            title="Sign out"
          >
            <LogOut size={13} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
