import Link from "next/link";
import { Suspense } from "react";
import { BackLink, PageTitleTracker } from "@/components/BackLink";

const BACK_LINK_CLASS =
  "inline-flex items-center rounded text-sm text-slate-500 hover:text-brand-blue-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue";

type Site = {
  id: string;
  code: string | null;
  name: string;
  addressLine: string;
  postcodeFormatted: string;
  city: string | null;
  region: { name: string } | null;
};

type SummaryChip = {
  key: string;
  label: string;
  tone: "mint" | "slate";
};

export function SiteHeader({
  site,
  chips,
}: {
  site: Site;
  chips: SummaryChip[];
}) {
  const mapsQuery = encodeURIComponent(
    `${site.addressLine}, ${site.postcodeFormatted}`,
  );
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  return (
    <div className="space-y-3">
      {/* Back to the page you came from (e.g. the job you opened the site
          from), else the Sites list. */}
      <Suspense
        fallback={
          <Link href="/sites" className={BACK_LINK_CLASS}>
            <span aria-hidden="true">←&nbsp;</span>
            <span>Sites</span>
          </Link>
        }
      >
        <BackLink fallbackHref="/sites" fallbackLabel="Sites" className={BACK_LINK_CLASS} />
        <PageTitleTracker title={site.name} />
      </Suspense>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-brand-navy truncate">
            {site.name}
            {site.code && (
              <span className="ml-2 align-middle text-sm font-normal text-slate-500">{site.code}</span>
            )}
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            {site.addressLine}
            {site.city ? `, ${site.city}` : ""} ·{" "}
            <span className="font-medium">{site.postcodeFormatted}</span>
            {site.region && (
              <>
                {" · "}
                <span className="chip-slate">{site.region.name}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-sm"
          >
            Open in maps
          </a>
          <Link href={`/sites/${site.id}/edit`} className="btn-secondary text-sm">
            Edit
          </Link>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {chips.map((c) => (
            <span
              key={c.key}
              className={c.tone === "mint" ? "chip-mint" : "chip-slate"}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
