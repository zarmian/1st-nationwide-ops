import Image from "next/image";

export function BrandLogo({
  className = "",
  size = "sm",
  showWordmark = true,
}: {
  className?: string;
  size?: "sm" | "lg";
  showWordmark?: boolean;
}) {
  const px = size === "lg" ? 64 : 36;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Image
        src="/logo.jpg"
        alt="1st Nationwide Security"
        width={px}
        height={px}
        priority
        className="object-contain"
        style={{ width: "auto", height: px }}
      />
      {showWordmark && (
        <div className="leading-tight">
          <div
            className={
              size === "lg"
                ? "text-base font-semibold text-brand-navy"
                : "text-sm font-semibold text-brand-navy"
            }
          >
            1st Nationwide
          </div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500">
            Operations
          </div>
        </div>
      )}
    </div>
  );
}
