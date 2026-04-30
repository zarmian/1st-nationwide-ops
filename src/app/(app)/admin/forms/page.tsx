import Link from "next/link";
import { prisma } from "@/lib/db";
import { SUBMISSION_FORM_LABEL } from "@/lib/formTemplates";

export const dynamic = "force-dynamic";

const SCOPE_LABEL: Record<string, string> = {
  GLOBAL: "Global",
  CUSTOMER: "Customer",
  PARTNER: "Partner",
  SITE: "Site",
};

const SCOPE_TONE: Record<string, string> = {
  GLOBAL: "chip-slate",
  CUSTOMER: "chip-mint",
  PARTNER: "chip-mint",
  SITE: "chip-amber",
};

export default async function FormsAdminPage() {
  const templates = await prisma.formTemplate.findMany({
    orderBy: [{ active: "desc" }, { jobType: "asc" }, { scope: "asc" }, { name: "asc" }],
    include: {
      customer: { select: { name: true } },
      partner: { select: { name: true } },
      site: { select: { name: true, code: true } },
      _count: { select: { submissions: true } },
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <Link
            href="/admin"
            className="text-sm text-slate-500 hover:text-brand-mint-dark"
          >
            ← Admin
          </Link>
          <h1 className="text-2xl font-semibold text-brand-navy mt-1">
            Form templates
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Define what officers fill in for each kind of job. Resolution at
            submit time is{" "}
            <span className="font-medium text-slate-700">
              site → customer → partner → global
            </span>{" "}
            — first active match wins.
          </p>
        </div>
        <Link href="/admin/forms/new" className="btn-primary">
          + New template
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
                Scope
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Target
              </th>
              <th className="text-right px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Submissions
              </th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {templates.map((t) => {
              const target =
                t.scope === "CUSTOMER"
                  ? t.customer?.name
                  : t.scope === "PARTNER"
                    ? t.partner?.name
                    : t.scope === "SITE"
                      ? `${t.site?.code ? `${t.site.code} · ` : ""}${t.site?.name ?? ""}`
                      : "—";
              return (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/forms/${t.id}/edit`}
                      className="font-medium text-brand-navy hover:text-brand-mint-dark"
                    >
                      {t.name}
                    </Link>
                    {!t.active && (
                      <span className="ml-2 chip-slate text-[10px]">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="chip-slate">
                      {SUBMISSION_FORM_LABEL[t.jobType] ?? t.jobType}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={SCOPE_TONE[t.scope] ?? "chip-slate"}>
                      {SCOPE_LABEL[t.scope] ?? t.scope}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 truncate max-w-[260px]">
                    {target ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {t._count.submissions}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={`/admin/forms/${t.id}/edit`}
                      className="btn-ghost text-sm"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              );
            })}
            {templates.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  No templates yet. Create a global template per job type to
                  get started — officers won't see a form on /submit until at
                  least one matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
