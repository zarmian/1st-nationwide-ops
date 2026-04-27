export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-8 w-8 rounded-xl bg-brand-mint flex items-center justify-center text-white font-bold">
        1
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-brand-navy">1st Nationwide</div>
        <div className="text-[10px] uppercase tracking-wider text-slate-500">
          Operations
        </div>
      </div>
    </div>
  );
}
