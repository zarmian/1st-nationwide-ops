import Link from "next/link";
import { Pencil } from "lucide-react";

/**
 * Pencil icon-link used wherever an activity row offers an inline "edit"
 * affordance (dispatch cards + activities log). Icon-only to save row width;
 * the tooltip + aria-label carry the meaning.
 */
export function EditIconLink({
  href,
  label = "Edit",
  size = "default",
}: {
  href: string;
  label?: string;
  size?: "default" | "small";
}) {
  const icon = size === "small" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-navy transition-colors"
    >
      <Pencil className={icon} aria-hidden />
    </Link>
  );
}
