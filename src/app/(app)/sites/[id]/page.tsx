import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SiteDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const site = await prisma.site.findUnique({
    where: { id: params.id },
    include: {
      customer: true,
      partner: true,
      region: true,
      jobs: {
        take: 25,
        orderBy: { createdAt: "desc" },
        include: {
          assignedTo: { select: { name: true } },
        },
      },
      keys: true,
    },
  });

  if (!site) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/sites"
            className="text-sm text-slate-500 hover:text-brand-mint-dark"
          >
            ← Back to sites
          </Link>
          <h1 className="text-2xl font-semibold text-brand-navy mt-1">
            {site.name}
          </h1>
          {site.code && (
            <div className="text-xs uppercase tracking-wider text-slate-500">
              {site.code}
            </div>
          )}
          <p className="text-sm text-slate-600 mt-1">
            {site.addressLine}
            {site.postcodeFormatted ? ` · ${site.postcodeFormatted}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/sites/${site.id}/edit`} className="btn-secondary">
            Edit
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            {site.partner ? "Operated for partner" : "Customer"}
          </div>
          <div className="font-medium text-brand-navy">
            {site.customer?.name ?? site.partner?.name ?? "—"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Region
          </div>
          <div className="font-medium text-brand-navy">
            {site.region?.name ?? "—"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Services
          </div>
          <div className="flex flex-wrap gap-1">
            {site.services.map((svc) => (
              <span key={svc} className="chip-mint">
                {svc.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-brand-navy">Recent jobs</h2>
          <Link
            href={`/dispatch?siteId=${site.id}`}
            className="text-sm text-brand-mint-dark hover:underline"
          >
            View all →
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Type</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Assigned</th>
              <th className="text-left px-4 py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {site.jobs.map((j) => (
              <tr key={j.id}>
                <td className="px-4 py-2">{j.type.replace(/_/g, " ")}</td>
                <td className="px-4 py-2">
                  <span className="chip-slate">{j.status}</span>
                </td>
                <td className="px-4 py-2">
                  {j.assignedTo?.name ?? "—"}
                </td>
                <td className="px-4 py-2 text-slate-500">
                  {j.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
              </tr>
            ))}
            {site.jobs.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={4}>
                  No jobs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {site.keys.length > 0 && (
        <div className="card">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="font-semibold text-brand-navy">Keys held</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Internal #</th>
                <th className="text-left px-4 py-2 font-medium">Label</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {site.keys.map((k) => (
                <tr key={k.id}>
                  <td className="px-4 py-2 font-medium">{k.internalNo ?? "—"}</td>
                  <td className="px-4 py-2">{k.label}</td>
                  <td className="px-4 py-2">
                    <span className="chip-slate">{k.status}</span>
                  </td>
                  <td className="px-4 py-2 text-slate-500">{k.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
