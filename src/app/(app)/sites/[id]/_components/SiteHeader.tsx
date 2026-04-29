import Link from "next/link";

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
      <div className="text-sm">
        <Link href="/sites" className="text-brand-mint-dark hover:underline">
          Sites
        </Link>
        <span className="text-slate-400 mx-1">›</span>
        <span className="text-slate-500">{site.code ?? "—"}</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-brand-navy truncate">
            {site.name}
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
          <Link
            href={`/submit?siteId=${site.id}`}
            className="btn inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium bg-brand-navy text-white hover:bg-slate-800"
          >
            Log activity
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
