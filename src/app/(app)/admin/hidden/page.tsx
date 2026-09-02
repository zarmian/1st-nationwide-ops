import Link from "next/link";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { UnhideButton } from "./_components/UnhideButton";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  CUSTOMER: "Customer",
  SUBCONTRACTOR: "Subcontractor",
  BOTH: "Both",
};

export default async function HiddenAccountsPage() {
  await requireAdmin();

  const [customers, partners] = await Promise.all([
    prisma.customer.findMany({
      where: { hidden: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { sites: true } } },
    }),
    prisma.partner.findMany({
      where: { hidden: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        role: true,
        _count: { select: { sites: true } },
      },
    }),
  ]);

  const nothingHidden = customers.length === 0 && partners.length === 0;

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader
        title="Hidden accounts"
        backHref="/admin"
        backLabel="Admin"
        subtitle="Customers and partners you've hidden from the admin browse views (the activity log, sites, alarms and presence). They're only hidden for admins — dispatch, finance totals and the client portal still show everything. Un-hide any of them here."
      />

      {nothingHidden && (
        <div className="card p-6 text-center text-slate-500">
          Nothing is hidden. Hide a customer or partner from its edit page and it
          will appear here.
        </div>
      )}

      {customers.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">
              Hidden customers ({customers.length})
            </h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {customers.map((c) => (
              <li
                key={c.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/customers/${c.id}/edit`}
                    className="font-medium text-brand-navy hover:text-brand-blue-dark"
                  >
                    {c.name}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {c._count.sites} site{c._count.sites === 1 ? "" : "s"}
                  </div>
                </div>
                <UnhideButton kind="customer" id={c.id} name={c.name} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {partners.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">
              Hidden partners ({partners.length})
            </h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {partners.map((p) => (
              <li
                key={p.id}
                className="px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/partners/${p.id}/edit`}
                    className="font-medium text-brand-navy hover:text-brand-blue-dark"
                  >
                    {p.name}
                  </Link>
                  <div className="text-xs text-slate-500">
                    {ROLE_LABEL[p.role] ?? p.role} · {p._count.sites} site
                    {p._count.sites === 1 ? "" : "s"}
                  </div>
                </div>
                <UnhideButton kind="partner" id={p.id} name={p.name} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
