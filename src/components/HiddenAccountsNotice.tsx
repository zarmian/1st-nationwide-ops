import Link from "next/link";
import { EyeOff } from "lucide-react";

/**
 * Small banner shown on admin surfaces whose figures/rows exclude hidden
 * customers/partners — so a hidden account can't silently skew what's shown
 * (a VAT/P&L figure, a who-owes-us list) without the admin knowing.
 * Render only when there is at least one hidden account.
 */
export function HiddenAccountsNotice({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <EyeOff size={14} aria-hidden className="shrink-0" />
      <span>
        {count} hidden {count === 1 ? "account is" : "accounts are"} excluded
        from these figures.
      </span>
      <Link
        href="/admin/hidden"
        className="ml-auto font-medium underline whitespace-nowrap"
      >
        Manage
      </Link>
    </div>
  );
}
