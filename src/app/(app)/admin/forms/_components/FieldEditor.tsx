"use client";

export const FIELD_TYPES = [
  { v: "text", label: "Short text" },
  { v: "textarea", label: "Long text" },
  { v: "checkbox", label: "Checkbox" },
  { v: "select", label: "Drop-down" },
  { v: "number", label: "Number" },
  { v: "date", label: "Date" },
  { v: "time", label: "Time" },
  { v: "datetime", label: "Date + time" },
  { v: "tri", label: "Yes / No / N/A" },
  { v: "location", label: "GPS location (auto-capture)" },
  { v: "signature", label: "Signature" },
  { v: "multiphoto", label: "Photos (multiple)" },
  { v: "section", label: "— Section heading —" },
] as const;

export type FieldRow = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  helpText?: string | null;
  meta?: { maxCount?: number } | null;
};

export function newField(index: number): FieldRow {
  return {
    key: `field_${index}`,
    label: "",
    type: "text",
    required: false,
  };
}

export function newSection(sectionCount: number): FieldRow {
  return {
    key: `section_${sectionCount}_${Date.now().toString(36)}`,
    label: "Section heading",
    type: "section",
    required: false,
  };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function FieldEditor({
  field,
  fieldIndex,
  isFirst,
  isLast,
  fieldErrors,
  onChange,
  onRemove,
  onMove,
}: {
  field: FieldRow;
  fieldIndex: number;
  isFirst: boolean;
  isLast: boolean;
  fieldErrors: Record<string, string[]>;
  onChange: (patch: Partial<FieldRow>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const errKey = (suffix: string) =>
    fieldErrors[`fields.${fieldIndex}.${suffix}`]?.join(", ");

  if (field.type === "section") {
    return (
      <div className="rounded-xl border-2 border-dashed border-brand-mint/40 bg-brand-mint-light/30 p-3">
        <div className="grid md:grid-cols-[auto_1fr_auto_auto] gap-2 items-center">
          <span className="chip-mint text-[10px]">SECTION</span>
          <input
            className="input font-semibold"
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Section heading"
            required
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={isFirst}
              className="btn-ghost text-xs disabled:text-slate-300"
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={isLast}
              className="btn-ghost text-xs disabled:text-slate-300"
              aria-label="Move down"
            >
              ↓
            </button>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="btn-ghost text-sm text-red-600"
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-3 bg-slate-50/40">
      <div className="grid md:grid-cols-[1fr_180px_140px_120px_auto] gap-2 items-end">
        <div>
          <label className="label">
            Label <span className="text-red-500">*</span>
          </label>
          <input
            className="input"
            value={field.label}
            onChange={(e) => {
              const label = e.target.value;
              const patch: Partial<FieldRow> = { label };
              if (
                !field.key ||
                field.key === slugify(field.label) ||
                /^field_\d+$/.test(field.key)
              ) {
                patch.key = slugify(label) || field.key;
              }
              onChange(patch);
            }}
            placeholder="All clear?"
            required
          />
          {errKey("label") && (
            <p className="text-xs text-red-600 mt-1">{errKey("label")}</p>
          )}
        </div>
        <div>
          <label className="label">
            Key <span className="text-red-500">*</span>
          </label>
          <input
            className="input font-mono text-xs"
            value={field.key}
            onChange={(e) => onChange({ key: e.target.value })}
            placeholder="all_clear"
            required
          />
          {errKey("key") && (
            <p className="text-xs text-red-600 mt-1">{errKey("key")}</p>
          )}
        </div>
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={field.type}
            onChange={(e) => onChange({ type: e.target.value })}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onChange({ required: e.target.checked })}
            className="rounded border-slate-300 text-brand-mint focus:ring-brand-mint/30"
          />
          <span>Required</span>
        </label>
        <div className="flex flex-col items-stretch gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={isFirst}
            className="btn-ghost text-xs disabled:text-slate-300"
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={isLast}
            className="btn-ghost text-xs disabled:text-slate-300"
            aria-label="Move down"
          >
            ↓
          </button>
        </div>
      </div>

      {field.type === "select" && (
        <div>
          <label className="label">
            Options (one per line) <span className="text-red-500">*</span>
          </label>
          <textarea
            className="input min-h-[80px]"
            value={(field.options ?? []).join("\n")}
            onChange={(e) =>
              onChange({
                options: e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder={"Yes\nNo\nN/A"}
          />
          {errKey("options") && (
            <p className="text-xs text-red-600 mt-1">{errKey("options")}</p>
          )}
        </div>
      )}

      {field.type === "multiphoto" && (
        <div className="grid md:grid-cols-[160px_1fr] gap-2 items-end">
          <div>
            <label className="label">Max photos</label>
            <input
              type="number"
              min={1}
              max={20}
              className="input"
              value={field.meta?.maxCount ?? 5}
              onChange={(e) =>
                onChange({
                  meta: {
                    ...(field.meta ?? {}),
                    maxCount: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                  },
                })
              }
            />
          </div>
          <p className="text-xs text-slate-500 pb-2">
            Officers can attach up to this many photos. Files upload directly
            from the phone camera.
          </p>
        </div>
      )}

      <div className="grid md:grid-cols-[1fr_auto] gap-2 items-end">
        <div>
          <label className="label">Help text</label>
          <input
            className="input"
            value={field.helpText ?? ""}
            onChange={(e) => onChange({ helpText: e.target.value || null })}
            placeholder="Optional hint shown under the field"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="btn-ghost text-sm text-red-600"
        >
          Remove field
        </button>
      </div>
    </div>
  );
}
