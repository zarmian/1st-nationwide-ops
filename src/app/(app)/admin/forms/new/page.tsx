import Link from "next/link";
import { prisma } from "@/lib/db";
import { FormTemplateForm, type FieldRow } from "../_components/FormTemplateForm";
import { createTemplate } from "../_actions";
import { parseFields, SUBMISSION_FORM_LABEL } from "@/lib/formTemplates";

export const dynamic = "force-dynamic";

export default async function NewFormTemplatePage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  const from = searchParams.from;

  // No starter chosen → show picker
  if (!from) {
    const blueprints = await prisma.formBlueprint.findMany({
      where: { active: true },
      orderBy: [{ builtin: "desc" }, { name: "asc" }],
    });
    return <BlueprintPicker blueprints={blueprints} />;
  }

  const [customers, partners, sites, blueprint] = await Promise.all([
    prisma.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.partner.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.site.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    from === "blank"
      ? Promise.resolve(null)
      : prisma.formBlueprint.findUnique({ where: { id: from } }),
  ]);

  // Pre-fill from blueprint, or sensible defaults if blank.
  const initialFields: FieldRow[] = blueprint
    ? parseFields(blueprint.fields).map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options,
        helpText: f.helpText ?? null,
        meta: f.meta ?? null,
      }))
    : [
        { key: "all_clear", label: "All clear?", type: "checkbox", required: false },
        {
          key: "summary",
          label: "Summary",
          type: "textarea",
          required: true,
          helpText: "What you saw on site",
        },
      ];

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/forms/new"
          className="text-sm text-slate-500 hover:text-brand-blue-dark"
        >
          ← Back to picker
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          New form template
        </h1>
        {blueprint && (
          <p className="text-sm text-slate-500 mt-0.5">
            Pre-filled from blueprint{" "}
            <span className="font-medium text-slate-700">{blueprint.name}</span>
            . Edit anything before saving — it's just a copy.
          </p>
        )}
      </div>
      <FormTemplateForm
        action={createTemplate}
        submitLabel="Create template"
        customers={customers}
        partners={partners}
        sites={sites}
        blueprintId={blueprint?.id ?? null}
        initial={{
          name: blueprint?.name ?? "",
          jobType: blueprint?.jobType ?? "PATROL",
          scope: "GLOBAL",
          customerId: null,
          partnerId: null,
          siteId: null,
          fields: initialFields,
          active: true,
        }}
      />
    </div>
  );
}

function BlueprintPicker({
  blueprints,
}: {
  blueprints: {
    id: string;
    name: string;
    description: string | null;
    jobType: string | null;
    source: string | null;
    builtin: boolean;
    fields: unknown;
  }[];
}) {
  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <Link
          href="/admin/forms"
          className="text-sm text-slate-500 hover:text-brand-blue-dark"
        >
          ← Form templates
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          Choose a starting point
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          Pick a blueprint to pre-fill the fields, or start blank. After
          creating, you'll be able to change anything — the blueprint is just a
          copy.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Link
          href="/admin/forms/new?from=blank"
          className="card p-5 hover:shadow-md transition-shadow border-dashed"
        >
          <h2 className="font-semibold text-brand-navy">Start blank</h2>
          <p className="text-sm text-slate-500 mt-1">
            Two starter fields you can edit. Use this when the form is unique
            or you want full control.
          </p>
        </Link>

        {blueprints.map((bp) => {
          const fieldCount = parseFields(bp.fields).filter(
            (f) => f.type !== "section",
          ).length;
          return (
            <Link
              key={bp.id}
              href={`/admin/forms/new?from=${bp.id}`}
              className="card p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-semibold text-brand-navy">{bp.name}</h2>
                {bp.builtin && (
                  <span className="chip-slate text-[10px]">Built-in</span>
                )}
              </div>
              {bp.description && (
                <p className="text-sm text-slate-500 mt-1 line-clamp-2">
                  {bp.description}
                </p>
              )}
              <div className="flex items-center gap-2 mt-3 text-xs text-slate-500">
                <span className="chip-slate">
                  {bp.jobType
                    ? (SUBMISSION_FORM_LABEL[bp.jobType] ?? bp.jobType)
                    : "Any job type"}
                </span>
                <span>·</span>
                <span>
                  {fieldCount} field{fieldCount === 1 ? "" : "s"}
                </span>
                {bp.source && (
                  <>
                    <span>·</span>
                    <span className="truncate">{bp.source}</span>
                  </>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {blueprints.length === 0 && (
        <p className="text-sm text-slate-500">
          No active blueprints yet. Manage them at{" "}
          <Link href="/admin/blueprints" className="text-brand-blue-dark">
            /admin/blueprints
          </Link>
          .
        </p>
      )}
    </div>
  );
}
