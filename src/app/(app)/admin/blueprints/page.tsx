import Link from "next/link";
import { prisma } from "@/lib/db";
import { SUBMISSION_FORM_LABEL, parseFields } from "@/lib/formTemplates";

export const dynamic = "force-dynamic";

export default async function BlueprintsAdminPage() {
  const blueprints = await prisma.formBlueprint.findMany({
    orderBy: [{ active: "desc" }, { builtin: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { templates: true } },
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <Link
            href="/admin"
            className="text-sm text-slate-500 hover:text-brand-blue-dark"
          >
            ← Admin
          </Link>
          <h1 className="text-2xl font-semibold text-brand-navy mt-1">
            Form blueprints
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Reusable starting points for form templates. When you create a
            template at <span className="font-medium">/admin/forms/new</span>{" "}
            you can pick a blueprint to pre-fill the fields, then tweak per
            customer.
          </p>
        </div>
        <Link href="/admin/blueprints/new" className="btn-primary">
          + New blueprint
        </Link>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Name
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Job type
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Source
              </th>
              <th className="text-right px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Fields
              </th>
              <th className="text-right px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Used by
              </th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {blueprints.map((bp) => {
              const fieldCount = parseFields(bp.fields).filter(
                (f) => f.type !== "section",
              ).length;
              return (
                <tr key={bp.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/blueprints/${bp.id}/edit`}
                        className="font-medium text-brand-navy hover:text-brand-blue-dark"
                      >
                        {bp.name}
                      </Link>
                      {bp.builtin && (
                        <span className="chip-slate text-[10px]">Built-in</span>
                      )}
                      {!bp.active && (
                        <span className="chip-slate text-[10px]">Inactive</span>
                      )}
                    </div>
                    {bp.description && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                        {bp.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="chip-slate">
                      {bp.jobType
                        ? (SUBMISSION_FORM_LABEL[bp.jobType] ?? bp.jobType)
                        : "Any"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">
                    {bp.source ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {fieldCount}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {bp._count.templates}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/admin/forms/new?from=${bp.id}`}
                      className="btn-ghost text-sm"
                    >
                      Use →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {blueprints.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No blueprints yet. Built-ins are seeded by{" "}
                  <code className="text-xs bg-slate-100 px-1 rounded">
                    npm run db:seed
                  </code>
                  .
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
