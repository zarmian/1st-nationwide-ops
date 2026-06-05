import Link from "next/link";
import { prisma } from "@/lib/db";
import { BrandLogo } from "@/components/BrandLogo";
import { getJobTypeLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function PublicJobsListPage() {
  const [jobs, jobTypeLabels] = await Promise.all([
    prisma.job.findMany({
      where: {
        status: "OPEN",
        assignedToUserId: null,
        externalResponder: null,
      },
      select: {
        id: true,
        type: true,
        priority: true,
        scheduledFor: true,
        notes: true,
        site: { select: { name: true, postcode: true, city: true } },
      },
      orderBy: [
        { priority: "desc" },
        { scheduledFor: "asc" },
        { createdAt: "asc" },
      ],
      take: 200,
    }),
    getJobTypeLabels(),
  ]);

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-2xl px-4 h-14 flex items-center justify-between">
          <BrandLogo />
          <div className="text-xs text-slate-500">Open jobs</div>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Open jobs</h1>
          <p className="text-sm text-slate-500 mt-1">
            Tap a job to claim it and start the report. First come, first served.
          </p>
        </div>

        {jobs.length === 0 ? (
          <div className="card p-6 text-center text-sm text-slate-500">
            No open jobs right now. Check back soon.
          </div>
        ) : (
          <ul className="space-y-2">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/jobs/${j.id}`}
                  className="card p-4 block hover:border-brand-blue transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-brand-navy truncate">
                        {j.site?.name ?? "Site TBC"}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {[j.site?.postcode, j.site?.city]
                          .filter(Boolean)
                          .join(" · ") || "Location TBC"}
                      </div>
                    </div>
                    {j.priority === "HIGH" && (
                      <span className="shrink-0 rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium">
                        High
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="rounded-full bg-brand-blue-light text-brand-blue-dark px-2 py-0.5 font-medium">
                      {jobTypeLabels[j.type] ?? j.type}
                    </span>
                    <span className="text-slate-500">
                      {j.scheduledFor
                        ? formatUkDateTime(j.scheduledFor)
                        : "ASAP"}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function formatUkDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
