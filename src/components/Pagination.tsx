import Link from "next/link";

/**
 * Shared page navigator for server-rendered lists. Builds `?page=` links that
 * preserve every other search param (filters, search, sort), so paging never
 * drops the active filters. Renders nothing for a single page.
 *
 * `basePath` is the route the links point at (e.g. "/calls"). `searchParams`
 * is the page's current params — everything except `page` is carried through.
 */
export function Pagination({
  page,
  totalPages,
  basePath,
  searchParams,
}: {
  page: number;
  totalPages: number;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  if (totalPages <= 1) return null;

  const link = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && k !== "page") qs.set(k, v);
    }
    qs.set("page", String(p));
    return `${basePath}?${qs.toString()}`;
  };

  const pages: (number | "…")[] = [];
  pages.push(1);
  if (page > 3) pages.push("…");
  for (
    let p = Math.max(2, page - 1);
    p <= Math.min(totalPages - 1, page + 1);
    p++
  ) {
    pages.push(p);
  }
  if (page < totalPages - 2) pages.push("…");
  if (totalPages > 1) pages.push(totalPages);

  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      <Link
        href={page > 1 ? link(page - 1) : "#"}
        aria-disabled={page === 1}
        aria-label="Previous page"
        className={`px-2 py-1 rounded-lg border border-slate-200 ${
          page === 1
            ? "text-slate-300 pointer-events-none"
            : "text-slate-600 hover:bg-slate-50"
        }`}
      >
        ‹
      </Link>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-2 text-slate-400">
            …
          </span>
        ) : (
          <Link
            key={p}
            href={link(p)}
            aria-current={p === page ? "page" : undefined}
            aria-label={`Page ${p}`}
            className={`min-w-[32px] text-center px-2 py-1 rounded-lg text-sm ${
              p === page
                ? "bg-brand-navy text-white"
                : "text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {p}
          </Link>
        ),
      )}
      <Link
        href={page < totalPages ? link(page + 1) : "#"}
        aria-disabled={page === totalPages}
        aria-label="Next page"
        className={`px-2 py-1 rounded-lg border border-slate-200 ${
          page === totalPages
            ? "text-slate-300 pointer-events-none"
            : "text-slate-600 hover:bg-slate-50"
        }`}
      >
        ›
      </Link>
    </nav>
  );
}
