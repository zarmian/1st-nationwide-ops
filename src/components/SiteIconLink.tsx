import Link from "next/link";
import { MapPin } from "lucide-react";

/** A small pin that opens the site, on activity rows and cards — where a
 *  click anywhere else opens the activity itself (ClickableRow). Its hit
 *  area is 44px for touch, without changing the layout. */
export function SiteIconLink({ siteId, siteName }: { siteId: string; siteName: string | null }) {
  const label = `Open site${siteName ? `: ${siteName}` : ""}`;
  return (
    <Link
      href={`/sites/${siteId}`}
      aria-label={label}
      title={label}
      className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 before:absolute before:-inset-2.5 before:content-[''] hover:bg-slate-100 hover:text-brand-blue-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
    >
      <MapPin size={14} aria-hidden />
    </Link>
  );
}
