import Image from "next/image";

/**
 * Brand mark — the real 1st Nationwide crest (public/logo.jpg).
 *
 * The asset is a photo with an opaque white background, so on our light
 * surfaces we drop that white with `mix-blend-multiply` (white × light ground
 * → the ground; the blue crest stays). On a dark surface that trick would
 * erase the crest instead, so `onDark` sits it in a small white badge.
 */
export function BrandLogo({
  className = "",
  size = "sm",
  showWordmark = true,
  onDark = false,
}: {
  className?: string;
  size?: "sm" | "lg";
  showWordmark?: boolean;
  /** Render for a dark background (e.g. the navy duty header). */
  onDark?: boolean;
}) {
  const h = size === "lg" ? "h-14" : "h-9";
  const img = (
    <Image
      src="/logo.jpg"
      alt="1st Nationwide Security"
      width={40}
      height={53}
      priority
      className={`${h} w-auto ${onDark ? "" : "mix-blend-multiply"}`}
    />
  );
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {onDark ? (
        <span className="inline-flex items-center justify-center rounded-lg bg-white p-1 shadow-sm">
          {img}
        </span>
      ) : (
        img
      )}
      {showWordmark && (
        <div className="leading-tight">
          <div
            className={
              (size === "lg" ? "text-base" : "text-sm") +
              " font-semibold " +
              (onDark ? "text-white" : "text-brand-navy")
            }
          >
            1st Nationwide
          </div>
          <div
            className={
              "text-[10px] uppercase tracking-wider " +
              (onDark ? "text-white/70" : "text-slate-500")
            }
          >
            Operations
          </div>
        </div>
      )}
    </div>
  );
}
