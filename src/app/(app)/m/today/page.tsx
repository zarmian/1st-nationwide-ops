import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OfficerTodayPage() {
  const session = await getServerSession(authOptions);
  const userId = (session!.user as any).id as string;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const jobs = await prisma.job.findMany({
    where: {
      assignedToUserId: userId,
      OR: [
        { scheduledFor: { gte: startOfDay, lte: endOfDay } },
        { status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
      ],
    },
    include: {
      site: { select: { name: true, addressLine: true, postcodeFormatted: true } },
    },
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Today</h1>
        <p className="text-sm text-slate-500">
          {jobs.length} job{jobs.length === 1 ? "" : "s"} on your list
        </p>
      </div>

      <Link
        href="/submit"
        className="card p-4 flex items-center justify-between hover:bg-slate-50"
      >
        <div>
          <div className="font-medium text-brand-navy">Submit a report</div>
          <div className="text-xs text-slate-500">
            Patrol, alarm response, lock/unlock, VPI…
          </div>
        </div>
        <span className="chip-mint">Open form →</span>
      </Link>

      <div className="space-y-2">
        {jobs.map((j) => (
          <Link
            key={j.id}
            href={`/submit?jobId=${j.id}`}
            className="card p-4 flex items-start justify-between hover:bg-slate-50"
          >
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">
                {j.type.replace(/_/g, " ")}
              </div>
              <div className="font-medium text-brand-navy">
                {j.site?.name ?? "Site TBD"}
              </div>
              <div className="text-xs text-slate-500">
                {[j.site?.addressLine, j.site?.postcodeFormatted]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <span className="chip-slate">{j.status}</span>
          </Link>
        ))}
        {jobs.length === 0 && (
          <div className="card p-8 text-center text-slate-500">
            Nothing on your list right now. Tap “Submit a report” when you arrive
            on site.
          </div>
        )}
      </div>
    </div>
  );
}
