import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const liveStatuses = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "SUBMITTED",
  "REVIEW_PENDING",
] as const;

export default async function DispatchPage() {
  const jobs = await prisma.job.findMany({
    where: { status: { in: liveStatuses as any } },
    include: {
      site: { select: { name: true, postcodeFormatted: true } },
      customer: { select: { name: true } },
      assignedTo: { select: { name: true } },
      partner: { select: { name: true } },
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  const counts = liveStatuses.reduce<Record<string, number>>((acc, s) => {
    acc[s] = jobs.filter((j) => j.status === s).length;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Dispatch</h1>
          <p className="text-sm text-slate-500">Live jobs across all sites</p>
        </div>
        <Link href="/dispatch/new" className="btn-primary">
          + New job
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {liveStatuses.map((s) => (
          <div key={s} className="card p-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              {s.replace(/_/g, " ")}
            </div>
            <div className="text-2xl font-semibold text-brand-navy">
              {counts[s] ?? 0}
            </div>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Type</th>
              <th className="text-left px-4 py-2.5 font-medium">Site</th>
              <th className="text-left px-4 py-2.5 font-medium">Customer</th>
              <th className="text-left px-4 py-2.5 font-medium">Source</th>
              <th className="text-left px-4 py-2.5 font-medium">Assigned</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 font-medium">Priority</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {jobs.map((j) => (
              <tr key={j.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium">
                  {j.type.replace(/_/g, " ")}
                </td>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-brand-navy">
                    {j.site?.name ?? "—"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {j.site?.postcodeFormatted}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  {j.customer?.name ?? j.partner?.name ?? "—"}
                </td>
                <td className="px-4 py-2.5">
                  <span className="chip-slate">
                    {j.source.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {j.assignedTo?.name ?? (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className="chip-mint">{j.status}</span>
                </td>
                <td className="px-4 py-2.5">
                  {j.priority === "HIGH" ? (
                    <span className="chip-red">{j.priority}</span>
                  ) : (
                    <span className="chip-slate">{j.priority}</span>
                  )}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={7}>
                  No live jobs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
