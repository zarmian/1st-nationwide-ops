/**
 * Soft duplicate warning shown inside a create form. When the server action
 * returns `warnings`, this renders them plus an "Add it anyway" checkbox
 * (name="override") — ticking it and resubmitting bypasses the check.
 */
export function DuplicateWarning({ warnings }: { warnings?: string[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm">
      <p className="font-semibold text-amber-800">Possible duplicate</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-700">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
      <label className="mt-2.5 flex cursor-pointer items-center gap-2 font-medium text-amber-900">
        <input type="checkbox" name="override" className="checkbox" />
        <span>Add it anyway — I&rsquo;ve checked this isn&rsquo;t a duplicate.</span>
      </label>
    </div>
  );
}
