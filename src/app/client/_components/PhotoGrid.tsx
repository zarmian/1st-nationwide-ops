import type { ClientReportPhoto } from "@/lib/clientReports";

/** Report photos as thumbnails that open full size. */
export function PhotoGrid({ photos, label }: { photos: ClientReportPhoto[]; label: string }) {
  if (photos.length === 0) return null;
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {photos.map((p, i) => (
        <li key={p.url}>
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="block aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- report photos live in Blob storage */}
            <img
              src={p.url}
              alt={p.caption ?? `${label} — photo ${i + 1}`}
              loading="lazy"
              decoding="async"
              width={240}
              height={240}
              className="h-full w-full object-cover"
            />
          </a>
          {p.caption && <p className="mt-1 truncate text-xs text-slate-500">{p.caption}</p>}
        </li>
      ))}
    </ul>
  );
}
