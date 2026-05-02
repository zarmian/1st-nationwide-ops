export function ComingSoon({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold text-brand-navy">{title}</h1>
      <p className="text-sm text-slate-500 max-w-xl">{blurb}</p>
      <div className="card p-8 text-center mt-6">
        <div className="text-base font-medium text-slate-700">Coming soon</div>
        <p className="text-sm text-slate-500 mt-1">
          This screen isn’t built yet. Tell Claude what to ship next.
        </p>
      </div>
    </div>
  );
}
