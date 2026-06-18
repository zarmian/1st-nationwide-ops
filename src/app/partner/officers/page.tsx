import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function PartnerOfficersPage() {
  const me = await requirePartner();

  const officers = await prisma.partnerOfficer.findMany({
    where: { partnerId: me.partnerId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { user: { select: { active: true } } },
  });

  const activeCount = officers.filter((o) => o.active).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Officers"
        subtitle={`${activeCount} active · ${officers.length} total. This roster is private to your portal — it isn't visible to 1NW staff.`}
        actions={
          <Link href="/partner/officers/new" className="btn-primary">
            + New officer
          </Link>
        }
      />

      <div className="card overflow-hidden">
        {officers.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">No officers yet.</p>
            <p className="empty-blurb">
              Add the officers you assign to 1NW jobs so you can keep
              track of who attended what.
            </p>
            <Link
              href="/partner/officers/new"
              className="btn-primary text-sm inline-flex mt-3"
            >
              + Add your first officer
            </Link>
          </div>
        ) : (
          <table className="table-default">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>SIA</th>
                <th>Status</th>
                <th>Login</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {officers.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link
                      href={`/partner/officers/${o.id}/edit`}
                      className="font-medium text-brand-navy hover:text-brand-blue-dark"
                    >
                      {o.name}
                    </Link>
                  </td>
                  <td className="text-slate-600 tabular-nums">
                    {o.phone ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="text-slate-600 font-mono text-xs">
                    {o.siaNumber ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td>
                    {o.active ? (
                      <span className="chip-mint text-[10px]">Active</span>
                    ) : (
                      <span className="chip-slate text-[10px]">Inactive</span>
                    )}
                  </td>
                  <td>
                    {o.userId && o.user?.active ? (
                      <span className="chip-info text-[10px]">Can sign in</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="text-right">
                    <Link
                      href={`/partner/officers/${o.id}/edit`}
                      className="text-xs text-brand-blue-dark hover:text-brand-navy underline"
                    >
                      edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
