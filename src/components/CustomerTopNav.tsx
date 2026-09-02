"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LayoutDashboard, Building2, ClipboardList, Wallet, LogOut } from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ComponentType<any> };

const CLIENT_LINKS: NavItem[] = [
  { href: "/client", label: "Overview", icon: LayoutDashboard },
  { href: "/client/sites", label: "Sites", icon: Building2 },
  { href: "/client/activities", label: "Activity", icon: ClipboardList },
  { href: "/client/spend", label: "Spend", icon: Wallet },
];

function isItemActive(pathname: string, href: string): boolean {
  if (href === "/client") return pathname === "/client";
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Client-portal top nav. A light, blue-tinted glass header with a gradient
 * accent underline and the company crest in a clean badge — colourful without
 * fighting the dark gradient hero below. Read-only surface.
 */
export function CustomerTopNav({
  customerName,
  userEmail,
}: {
  customerName: string;
  userEmail?: string | null;
}) {
  const pathname = usePathname() ?? "";

  return (
    <header className="sticky top-0 z-40 pt-safe border-b border-brand-blue-100/70 bg-gradient-to-r from-brand-blue-50/90 via-white/85 to-brand-blue-50/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <Link href="/client" className="flex items-center gap-2.5" aria-label="Client portal home">
          <Image
            src="/logo.jpg"
            alt="1st Nationwide Security"
            width={40}
            height={53}
            priority
            className="h-11 w-auto mix-blend-multiply"
          />
          <div className="hidden leading-tight sm:block">
            <div className="text-sm font-semibold text-brand-navy">
              1st Nationwide Security
            </div>
            <span className="mt-0.5 inline-flex rounded-full bg-brand-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-blue-dark">
              Client portal
            </span>
          </div>
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {CLIENT_LINKS.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm transition " +
                  (active
                    ? "border-brand-blue-dark bg-gradient-to-b from-brand-blue-500 to-brand-blue-dark text-white shadow-sm"
                    : "border-brand-blue-200 bg-white/70 text-brand-navy hover:border-brand-blue-400 hover:bg-white hover:shadow-sm")
                }
              >
                <Icon size={14} aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 text-sm">
          <div className="hidden flex-col items-end leading-tight sm:flex">
            <span className="max-w-[200px] truncate text-xs font-semibold text-brand-navy">
              {customerName}
            </span>
            {userEmail && (
              <span className="max-w-[200px] truncate text-[10px] text-slate-500">
                {userEmail}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white/70 px-2.5 py-1.5 text-xs text-slate-600 transition hover:border-slate-400 hover:bg-white hover:text-brand-navy"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={13} aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>

      {/* Mobile nav — single-line scrollable */}
      <nav className="overflow-x-auto border-t border-brand-blue-100/60 px-4 py-1 md:hidden">
        <ul className="flex items-center gap-1">
          {CLIENT_LINKS.map((item) => {
            const Icon = item.icon;
            const active = isItemActive(pathname, item.href);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  className={
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm " +
                    (active
                      ? "border-brand-blue-dark bg-gradient-to-b from-brand-blue-500 to-brand-blue-dark text-white"
                      : "border-brand-blue-200 bg-white/70 text-brand-navy")
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

      {/* Gradient accent underline */}
      <div className="h-[3px] w-full bg-gradient-to-r from-brand-blue via-brand-blue-dark to-brand-navy" />
    </header>
  );
}
