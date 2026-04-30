import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CustomersAdminPage() {
  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { sites: true, contacts: true } },
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
            Customers
          </h1>
          <p className="text-sm text-slate-500">
            Direct customers we serve.
          </p>
        </div>
        <Link href="/admin/customers/new" className="btn-primary">
          + New customer
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
                Type
              </th>
              <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
                Contract
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
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/customers/${c.id}/edit`}
                    className="font-medium text-brand-navy hover:text-brand-mint-dark"
                  >
                    {c.name}
                  </Link>
                  {!c.active && (
                    <span className="ml-2 chip-slate text-[10px]">Inactive</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {c.type.charAt(0) + c.type.slice(1).toLowerCase()}
                </td>
                <td className="px-4 py-2.5 text-slate-500">
                  {c.contractRef ?? "—"}
                  {c.contractStart && (
                    <div className="text-xs">
                      since {monthYear(c.contractStart)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {c._count.sites}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {c._count.contacts}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/admin/customers/${c.id}/edit`}
                    className="btn-ghost text-sm"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function monthYear(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
