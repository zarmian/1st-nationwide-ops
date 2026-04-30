import Link from "next/link";
import { prisma } from "@/lib/db";
import { FormTemplateForm } from "../_components/FormTemplateForm";
import { createTemplate } from "../_actions";

export const dynamic = "force-dynamic";

export default async function NewFormTemplatePage() {
  const [customers, partners, sites] = await Promise.all([
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
          New form template
        </h1>
      </div>
      <FormTemplateForm
        action={createTemplate}
        submitLabel="Create template"
        customers={customers}
        partners={partners}
        sites={sites}
        initial={{
          name: "",
          jobType: "PATROL",
          scope: "GLOBAL",
          customerId: null,
          partnerId: null,
          siteId: null,
          fields: [
            { key: "all_clear", label: "All clear?", type: "checkbox", required: false },
            {
              key: "summary",
              label: "Summary",
              type: "textarea",
              required: true,
              helpText: "What you saw on site",
            },
          ],
          active: true,
        }}
      />
    </div>
  );
}
