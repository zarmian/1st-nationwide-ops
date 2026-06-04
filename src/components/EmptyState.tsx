import Link from "next/link";

/**
 * Unified empty state. Replaces hand-rolled `card p-8 text-center text-sm`
 * panels and bare `<p>No data</p>` rows so every "nothing here yet" looks
 * the same: dashed border surface, title, supporting copy, optional CTA.
 *
 * Use inside or instead of a `.card` — the dashed-border styling reads as
 * intentionally empty rather than as a real surface, which is what the
 * data-dense-dashboard pattern asks for.
 */
export function EmptyState({
  title,
  blurb,
  ctaHref,
  ctaLabel,
  variant = "default",
}: {
  title: string;
  blurb?: React.ReactNode;
  ctaHref?: string;
  ctaLabel?: string;
  // "default" stands alone; "inline" sits inside a card/table cell with no
  // extra border so it doesn't double-box.
  variant?: "default" | "inline";
}) {
  const wrapper =
    variant === "inline"
      ? "px-6 py-10 text-center"
      : "empty-state";
  return (
    <div className={wrapper}>
      <p className="empty-title">{title}</p>
      {blurb && <p className="empty-blurb">{blurb}</p>}
      {ctaHref && ctaLabel && (
        <Link
          href={ctaHref}
          className="btn-secondary text-xs mt-3 inline-flex"
        >
          {ctaLabel}
        </Link>
      )}
    </div>
  );
}
