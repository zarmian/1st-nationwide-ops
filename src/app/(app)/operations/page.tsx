import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OperationsHubPage() {
  // Live counts that make the cards actionable. Same $transaction trick
  // as /admin to keep connection use low on the pooler.
  const [
    activeSchedules,
    pendingShifts,
    keysWithUs,
    activitiesPastWeek,
    onboardingOpen,
    activeOfficers,
    pendingReviews,
  ] = await prisma.$transaction([
    prisma.patrolSchedule.count({ where: { active: true } }),
    prisma.shift.count({ where: { status: "PENDING" } }),
    prisma.key.count({ where: { status: "WITH_US" } }),
    prisma.job.count({
      where: {
        createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
    }),
    prisma.onboardingPipeline.count({
      where: { stage: { notIn: ["GO_LIVE", "CANCELLED"] } },
    }),
    prisma.user.count({ where: { active: true, role: "OFFICER" } }),
    prisma.reportReview.count({ where: { status: "PENDING" } }),
  ]);

  const cards = [
    {
      href: "/patrols",
      title: "Schedules",
      blurb:
        "Recurring patrols, VPI cadence, lock/unlock times. Set days, frequency, officer per day.",
      stat: activeSchedules,
      statLabel: "active",
    },
    {
      href: "/shifts",
      title: "Shifts",
      blurb: "Static guarding + dog handler shifts with check-in intervals.",
      stat: pendingShifts,
      statLabel: "pending",
    },
    {
      href: "/keys",
      title: "Keys",
      blurb:
        "Every key, fob, padlock, code we hold. Track handovers and current holders.",
      stat: keysWithUs,
      statLabel: "with us",
    },
    {
      href: "/activities",
      title: "Activities log",
      blurb:
        "Unified ledger across jobs and visits. Filter by site, customer, officer, region.",
      stat: activitiesPastWeek,
      statLabel: "last 7 days",
    },
    {
      href: "/onboarding",
      title: "Onboarding",
      blurb:
        "New customer + site go-live pipelines: setup jobs, surveys, handovers.",
      stat: onboardingOpen,
      statLabel: "open",
    },
    {
      href: "/officers",
      title: "Officers",
      blurb:
        "Officer roster: on-duty status, last seen, SIA expiry, pay rates.",
      stat: activeOfficers,
      statLabel: "active",
    },
    {
      href: "/admin/reports",
      title: "Review queue",
      blurb:
        "Officer submissions waiting for sign-off before they go to the customer (alarm responses, lock-ups, etc. Patrols + VPI auto-approve).",
      stat: pendingReviews,
      statLabel: "pending",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Operations</h1>
        <p className="text-sm text-slate-500">
          Day-to-day running of the business — schedules, shifts, keys, the
          activities log.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="card p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold text-brand-navy">{c.title}</h2>
              <div className="text-right">
                <div className="text-2xl font-semibold text-brand-navy tabular-nums">
                  {c.stat.toLocaleString("en-GB")}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">
                  {c.statLabel}
                </div>
              </div>
            </div>
            <p className="text-sm text-slate-500 mt-2">{c.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
