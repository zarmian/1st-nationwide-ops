"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { BrandLogo } from "./BrandLogo";

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") {
    // Match the hub itself plus the lookups, but NOT /admin/reports.
    return (
      pathname === "/admin" ||
      /^\/admin\/(customers|partners|regions)(\/|$)/.test(pathname)
    );
  }
  return pathname === href || pathname.startsWith(href + "/");
}

const links = [
  { href: "/sites", label: "Sites" },
  { href: "/patrols", label: "Patrols" },
  { href: "/keys", label: "Keys" },
  { href: "/onboarding", label: "Onboarding" },
  { href: "/officers", label: "Officers" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin", label: "Admin" },
];

export function TopNav({
  userName,
  role,
}: {
  userName?: string | null;
  role?: string;
}) {
  const pathname = usePathname();

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
        <Link href="/" aria-label="Home">
          <BrandLogo />
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {links.map((l) => {
            const active = isActive(pathname ?? "", l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  active
                    ? "bg-brand-mint-light text-brand-mint-dark"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block text-right leading-tight">
            <div className="text-sm font-medium text-slate-800">
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
    </header>
  );
}
