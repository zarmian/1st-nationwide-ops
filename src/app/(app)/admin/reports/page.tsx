import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const queue = await prisma.reportReview.findMany({
    where: { status: { in: ["PENDING", "REJECTED"] } },
    include: {
      submission: {
        include: {
          site: { select: { name: true, postcodeFormatted: true } },
          submittedBy: { select: { name: true } },
          job: {
            include: {
              customer: { select: { name: true } },
              partner: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">
          Review queue
        </h1>
        <p className="text-sm text-slate-500">
          {queue.length} submission{queue.length === 1 ? "" : "s"} awaiting
          review before client send
        </p>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Submitted</th>
              <th className="text-left px-4 py-2.5 font-medium">Form</th>
              <th className="text-left px-4 py-2.5 font-medium">Site</th>
              <th className="text-left px-4 py-2.5 font-medium">Customer</th>
              <th className="text-left px-4 py-2.5 font-medium">Officer</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {queue.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 text-slate-500">
                  {r.submission.submittedAt
                    .toISOString()
                    .slice(0, 16)
                    .replace("T", " ")}
                </td>
                <td className="px-4 py-2.5">
                  <span className="chip-slate">
                    {r.submission.form.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-brand-navy">
                    {r.submission.site?.name ?? "—"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {r.submission.site?.postcodeFormatted}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  {r.submission.job?.customer?.name ??
                    r.submission.job?.partner?.name ??
                    "—"}
                </td>
                <td className="px-4 py-2.5">
                  {r.submission.submittedBy?.name ??
                    r.submission.officerNameRaw ??
                    "—"}
                </td>
                <td className="px-4 py-2.5">
                  {r.status === "PENDING" ? (
                    <span className="chip-amber">Pending</span>
                  ) : (
                    <span className="chip-red">Rejected</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/admin/reports/${r.id}`}
                    className="btn-secondary text-xs"
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))}
            {queue.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={7}>
                  Nothing pending. You’re all caught up.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
