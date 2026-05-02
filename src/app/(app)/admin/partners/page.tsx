import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  CUSTOMER: "Customer",
  SUBCONTRACTOR: "Subcontractor",
  BOTH: "Both",
};

export default async function PartnersAdminPage() {
  const partners = await prisma.partner.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { sites: true, jobs: true, contacts: true } },
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
            Partners
          </h1>
          <p className="text-sm text-slate-500">
            Companies we sub work to or that sub work to us.
          </p>
        </div>
        <Link href="/admin/partners/new" className="btn-primary">
          + New partner
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
                Relationship
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Channel
              </th>
              <th className="text-right px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Sites
              </th>
              <th className="text-right px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Contacts
              </th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {partners.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/partners/${p.id}/edit`}
                    className="font-medium text-brand-navy hover:text-brand-mint-dark"
                  >
                    {p.name}
                  </Link>
                  {!p.active && (
                    <span className="ml-2 chip-slate text-[10px]">Inactive</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className="chip-slate">{ROLE_LABEL[p.role] ?? p.role}</span>
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {p.preferred.replace(/_/g, " ").toLowerCase()}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {p._count.sites}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {p._count.contacts}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/admin/partners/${p.id}/edit`}
                    className="btn-ghost text-sm"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {partners.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No partners yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
