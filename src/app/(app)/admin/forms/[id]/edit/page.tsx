import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { FormTemplateForm, type FieldRow } from "../../_components/FormTemplateForm";
import { updateTemplate, deleteTemplate } from "../../_actions";
import { parseFields } from "@/lib/formTemplates";
import { DeleteButton } from "./_components/DeleteButton";

export const dynamic = "force-dynamic";

export default async function EditFormTemplatePage({
  params,
}: {
  params: { id: string };
}) {
  const [template, customers, partners, sites] = await Promise.all([
    prisma.formTemplate.findUnique({
      where: { id: params.id },
      include: {
        customer: { select: { id: true, name: true } },
        partner: { select: { id: true, name: true } },
        site: { select: { id: true, name: true, code: true } },
        _count: { select: { submissions: true } },
      },
    }),
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
  ]);

  if (!template) notFound();
  const action = updateTemplate.bind(null, template.id);

  const fields: FieldRow[] = parseFields(template.fields).map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    options: f.options,
    helpText: f.helpText ?? null,
    meta: f.meta ?? null,
  }));

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/forms"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Form templates
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          Edit {template.name}
        </h1>
      </div>

      <FormTemplateForm
        action={action}
        submitLabel="Save changes"
        customers={customers}
        partners={partners}
        sites={sites}
        initial={{
          id: template.id,
          name: template.name,
          jobType: template.jobType,
          scope: template.scope,
          customerId: template.customerId,
          partnerId: template.partnerId,
          siteId: template.siteId,
          fields,
          active: template.active,
        }}
      />

      <div className="border-t border-slate-200 pt-4">
        <DeleteButton
          id={template.id}
          submissions={template._count.submissions}
          deleteAction={deleteTemplate}
        />
      </div>
    </div>
  );
}
