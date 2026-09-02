import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { getSessionUser } from "@/lib/authz";
import { loadComplianceRegister } from "@/lib/compliance";

export const dynamic = "force-dynamic";

export default async function OperationsHubPage() {
  // Rota coverage window: assignments dated from the start of today through
  // the next 7 days — "who's booked on this week".
  const rotaWeekStart = new Date();
  rotaWeekStart.setHours(0, 0, 0, 0);
  const rotaWeekEnd = new Date(rotaWeekStart.getTime() + 7 * 86_400_000);

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
    missedCallsWeek,
    openAlarms,
    presenceThisWeek,
    rotaThisWeek,
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
    prisma.callEvent.count({
      where: {
        missed: true,
        createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
    }),
    prisma.job.count({
      where: {
        type: "ALARM_RESPONSE",
        status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] },
      },
    }),
    prisma.job.count({
      where: {
        lat: { not: null },
        locatedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
    }),
    prisma.rotaAssignment.count({
      where: { date: { gte: rotaWeekStart, lt: rotaWeekEnd } },
    }),
  ]);

  // Shurgard jobs completed so far today — the daily report card stat.
  const reportShurgard = await prisma.customer.findFirst({
    where: { name: { contains: "Shurgard", mode: "insensitive" } },
    select: { id: true },
  });
  const reportDayStart = new Date();
  reportDayStart.setHours(0, 0, 0, 0);
  const todayReportJobs = reportShurgard
    ? await prisma.job.count({
        where: {
          site: { is: { customerId: reportShurgard.id } },
          status: { not: "CANCELLED" },
          completedAt: { gte: reportDayStart },
        },
      })
    : 0;

  // Officer-compliance attention count: officers with a lapsed, soon-expiring
  // or unrecorded vetting item (SIA / RTW / DBS / certificates).
  const compliance = await loadComplianceRegister();
  const complianceAttention =
    compliance.counts.expired +
    compliance.counts.expiring +
    compliance.counts.missing;

  // Whether the person viewing this hub has linked their own Telegram —
  // the card reflects their personal connection state, not a global one.
  const viewer = await getSessionUser();
  const telegramLinked = viewer
    ? Boolean(
        (
          await prisma.user.findUnique({
            where: { id: viewer.id },
            select: { telegramChatId: true },
          })
        )?.telegramChatId,
      )
    : false;

  const cards = [
    {
      href: "/rota",
      title: "Rota",
      blurb:
        "Who's on for each region and shift — officer availability and the daily assignment grid.",
      stat: rotaThisWeek,
      statLabel: "booked · next 7 days",
    },
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
      href: "/compliance",
      title: "Compliance",
      blurb:
        "SIA licences, right-to-work, DBS and training — with expiry alerts. Keeps you ACS audit-ready.",
      stat: complianceAttention,
      statLabel: "need attention",
    },
    {
      href: "/admin/reports",
      title: "Review queue",
      blurb:
        "Officer submissions waiting for sign-off before they go to the customer (alarm responses, ad-hoc reports). Patrols, VPI, lock + unlock auto-approve.",
      stat: pendingReviews,
      statLabel: "pending",
    },
    {
      href: "/calls",
      title: "Call log",
      blurb:
        "Calls from the bOnline phone webhook. Missed calls alert dispatch by SMS.",
      stat: missedCallsWeek,
      statLabel: "missed / 7 days",
    },
    {
      href: "/alarms",
      title: "Alarm responses",
      blurb:
        "Response times against SLA targets and close-out outcomes. Spot breaches and record what each alarm turned out to be.",
      stat: openAlarms,
      statLabel: "open now",
    },
    {
      href: "/presence",
      title: "Proof of presence",
      blurb:
        "Where officers actually were when they attended — GPS fix vs the site geofence. Evidence you can show clients.",
      stat: presenceThisWeek,
      statLabel: "GPS-tagged / 7 days",
    },
    {
      href: "/reports",
      title: "Daily report",
      blurb:
        "Shurgard callouts + lock-ups and static guarding (Shurgard & Access Storage) for a day. Nexus-run sites tagged.",
      stat: todayReportJobs,
      statLabel: "Shurgard today",
    },
    {
      href: "/telegram",
      title: "Telegram",
      blurb:
        "Link your Telegram to get ops alerts — and soon create callouts by messaging the bot.",
      stat: telegramLinked ? 1 : 0,
      statLabel: telegramLinked ? "connected" : "not linked",
    },
  ];

  return (
    <div className="section">
      <PageHeader
        title="Operations"
        subtitle="Day-to-day running of the business — schedules, shifts, keys, the activities log."
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="card-hover p-5"
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
