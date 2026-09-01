"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LineChart,
  Activity,
  Banknote,
  FileText,
  Clock,
  CreditCard,
  ScrollText,
  FileMinus,
  Landmark,
  Wallet,
  Repeat,
  FileSignature,
  AlertTriangle,
  Download,
  type LucideIcon,
} from "lucide-react";

/**
 * Finance sub-navigation. Replaces the pile of ~11 link-buttons every finance
 * page used to stack in its header with one consistent, scrollable tab bar —
 * so wayfinding ("where am I / where can I go") is answered the same way on
 * every finance screen.
 *
 * Rendered once by finance/layout.tsx, so pages no longer carry nav in their
 * PageHeader `actions` — those are reserved for page-specific actions only.
 *
 * Ordered by workflow: overview → what we're owed → what we owe / tax → pay →
 * housekeeping. Each item carries `match` prefixes so detail pages that live
 * off the main path (a statement under /finance/customers/…, a payslip under
 * /finance/officers/…) still light up the right tab.
 */
type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Path prefixes (besides `href`) that should mark this tab current. */
  match?: string[];
};

const ITEMS: NavItem[] = [
  { href: "/finance", label: "Overview", icon: LayoutDashboard },
  { href: "/finance/cashflow", label: "Cash flow", icon: LineChart },
  { href: "/finance/invoices", label: "Invoices", icon: FileText },
  { href: "/finance/receivables", label: "Receivables", icon: Clock },
  { href: "/finance/payables", label: "Payables", icon: CreditCard },
  {
    href: "/finance/statements",
    label: "Statements",
    icon: ScrollText,
    match: ["/finance/customers/"],
  },
  { href: "/finance/credit-notes", label: "Credit notes", icon: FileMinus },
  { href: "/finance/vat", label: "VAT", icon: Landmark },
  { href: "/finance/costs", label: "Costs", icon: Wallet },
  {
    href: "/finance/payroll",
    label: "Payroll",
    icon: Banknote,
    match: ["/finance/officers/"],
  },
  { href: "/finance/activities", label: "Activities", icon: Activity },
  { href: "/finance/recurring", label: "Recurring", icon: Repeat },
  { href: "/finance/contracts", label: "Contracts", icon: FileSignature },
  { href: "/finance/exceptions", label: "Exceptions", icon: AlertTriangle },
  { href: "/finance/export", label: "Export", icon: Download },
];

function isCurrent(pathname: string, item: NavItem): boolean {
  // Overview is exact-match only — every other path starts with "/finance".
  if (item.href === "/finance") return pathname === "/finance";
  if (pathname === item.href || pathname.startsWith(item.href + "/")) return true;
  return (item.match ?? []).some((p) => pathname.startsWith(p));
}

export function FinanceNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label="Finance" className="finance-nav-scroll -mx-1 overflow-x-auto">
      <ul className="flex w-max items-center gap-1 px-1 pb-1">
        {ITEMS.map((item) => {
          const active = isCurrent(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "group inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap " +
                  "min-h-[2.75rem] transition-[color,background-color,box-shadow] duration-150 ease-out " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white " +
                  (active
                    ? "bg-brand-blue-50 text-brand-blue-700 shadow-inner-highlight ring-1 ring-inset ring-brand-blue-200"
                    : "text-slate-600 hover:bg-white hover:text-brand-navy hover:shadow-card")
                }
              >
                <Icon
                  size={16}
                  strokeWidth={active ? 2.4 : 2}
                  className={active ? "text-brand-blue" : "text-slate-400 group-hover:text-brand-blue"}
                  aria-hidden="true"
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
