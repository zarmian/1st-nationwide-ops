import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { BlueprintForm } from "../../_components/BlueprintForm";
import { updateBlueprint, deleteBlueprint } from "../../_actions";
import { parseFields } from "@/lib/formTemplates";
import type { FieldRow } from "../../../forms/_components/FieldEditor";
import { DeleteBlueprintButton } from "./_components/DeleteBlueprintButton";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditBlueprintPage({
  params,
}: {
  params: { id: string };
}) {
  const bp = await prisma.formBlueprint.findUnique({
    where: { id: params.id },
    include: { _count: { select: { templates: true } } },
  });
  if (!bp) notFound();

  const fields: FieldRow[] = parseFields(bp.fields).map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    options: f.options,
    helpText: f.helpText ?? null,
    meta: f.meta ?? null,
  }));

  const action = updateBlueprint.bind(null, bp.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Edit ${bp.name}`}
        backHref="/admin/blueprints"
        backLabel="Form blueprints"
      />

      <BlueprintForm
        action={action}
        submitLabel="Save changes"
        initial={{
          id: bp.id,
          slug: bp.slug,
          name: bp.name,
          description: bp.description,
          jobType: bp.jobType,
          source: bp.source,
          fields,
          active: bp.active,
          builtin: bp.builtin,
        }}
      />

      <div className="border-t border-slate-200 pt-4">
        <DeleteBlueprintButton
          id={bp.id}
          builtin={bp.builtin}
          templateCount={bp._count.templates}
          deleteAction={deleteBlueprint}
        />
      </div>
    </div>
  );
}
