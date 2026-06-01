import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { VisitCard } from "./_components/VisitCard";
import { OnDutyBanner } from "./_components/OnDutyBanner";
import { ShiftCard } from "./_components/ShiftCard";
import { AutoRefresh } from "./_components/AutoRefresh";
import { InstallHint } from "./_components/InstallHint";
import { setMyOnDuty } from "../../officers/_actions";
import { startShift, endShift } from "../../shifts/_actions";
import { daysFromTodayUk } from "@/lib/dates";

export const dynamic = "force-dynamic";

function formatScheduled(date: Date | null | undefined): {
  day: string;
  time: string;
} | null {
  if (!date) return null;
  const diffDays = daysFromTodayUk(date);
  const time = date.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
  let day: string;
  if (diffDays === 0) day = "Today";
  else if (diffDays === 1) day = "Tomorrow";
  else if (diffDays === -1) day = "Yesterday";
  else
    day = date.toLocaleDateString("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  return { day, time };
}

export default async function OfficerTodayPage() {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { onDuty: true },
  });

  // Officer's "next 2 days" window: from now, up to end of (today + 2 days).
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfWindow = new Date();
  endOfWindow.setDate(endOfWindow.getDate() + 2);
  endOfWindow.setHours(23, 59, 59, 999);

  const [myVisits, jobs, myShifts] = await Promise.all([
    prisma.patrolVisit.findMany({
      where: {
        officerId: userId,
        scheduledAt: { gte: startOfDay, lte: endOfWindow },
        status: { in: ["PENDING", "LATE", "IN_PROGRESS"] },
      },
      include: {
        site: {
          select: {
            id: true,
            name: true,
            addressLine: true,
            postcodeFormatted: true,
            lat: true,
            lng: true,
          },
        },
        patrolSchedule: { select: { kind: true, frequency: true } },
      },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.job.findMany({
      where: {
        assignedToUserId: userId,
        status: {
          in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "REVIEW_PENDING"],
        },
        // Show jobs scheduled within the next 2 days, plus undated ones
        // (dispatch may have assigned them without a fixed time).
        OR: [
          { scheduledFor: { lte: endOfWindow } },
          { scheduledFor: null },
        ],
      },
      include: {
        site: { select: { name: true, addressLine: true, postcodeFormatted: true } },
      },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    }),
    prisma.shift.findMany({
      where: {
        OR: [{ officerId: userId }, { officerId: null }],
        status: { in: ["PENDING", "IN_PROGRESS"] },
        scheduledStartsAt: { lte: endOfWindow },
        scheduledEndsAt: { gte: startOfDay },
      },
      orderBy: { scheduledStartsAt: "asc" },
      include: {
        site: { select: { id: true, name: true } },
        formSubmissions: {
          where: { form: "SHIFT_CHECK" },
          orderBy: { submittedAt: "desc" },
          take: 1,
          select: { submittedAt: true },
        },
      },
    }),
  ]);

  const totalVisits = myVisits.length;

  return (
    <div className="space-y-5">
      <AutoRefresh />
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Your work</h1>
        <p className="text-sm text-slate-500">
          {totalVisits} patrol{totalVisits === 1 ? "" : "s"}
          {jobs.length > 0
            ? ` · ${jobs.length} job${jobs.length === 1 ? "" : "s"}`
            : ""}{" "}
          assigned to you for the next 2 days.
        </p>
      </div>

      <InstallHint />
      <OnDutyBanner initialOnDuty={me?.onDuty ?? false} setOnDuty={setMyOnDuty} />

      {myShifts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-slate-500">
            Your shifts
          </h2>
          {myShifts.map((s) => (
            <ShiftCard
              key={s.id}
              startShift={startShift}
              endShift={endShift}
              shift={{
                id: s.id,
                type: s.type,
                status: s.status,
                siteId: s.site.id,
                siteName: s.site.name,
                scheduledStartsAt: s.scheduledStartsAt.toISOString(),
                scheduledEndsAt: s.scheduledEndsAt.toISOString(),
                actualStartedAt: s.actualStartedAt?.toISOString() ?? null,
                checkIntervalMin: s.checkIntervalMin,
                graceMinutes: s.graceMinutes,
                lastCheckAt:
                  s.formSubmissions[0]?.submittedAt.toISOString() ?? null,
              }}
            />
          ))}
        </section>
      )}

      {myVisits.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-slate-500">
            Your patrols — next 2 days
          </h2>
          {myVisits.map((v) => (
            <VisitCard
              key={v.id}
              visit={{
                id: v.id,
                status: v.status,
                scheduledAt: v.scheduledAt.toISOString(),
                arrivedAt: v.arrivedAt?.toISOString() ?? null,
                kind: v.patrolSchedule?.kind ?? "PATROL",
                site: {
                  id: v.site.id,
                  name: v.site.name,
                  addressLine: v.site.addressLine,
                  postcodeFormatted: v.site.postcodeFormatted,
                  lat: v.site.lat,
                  lng: v.site.lng,
                },
                isMine: true,
              }}
            />
          ))}
        </section>
      )}

      {jobs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-slate-500">
            Your jobs — next 2 days
          </h2>
          {jobs.map((j) => {
            const f = formatScheduled(j.scheduledFor);
            return (
              <Link
                key={j.id}
                href={`/submit?jobId=${j.id}`}
                className="card p-4 flex items-start justify-between hover:bg-slate-50 gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wider text-slate-500">
                    {j.type.replace(/_/g, " ")}
                    {f ? ` · ${f.day} · ${f.time}` : ""}
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
                <span className="chip-slate shrink-0">{j.status}</span>
              </Link>
            );
          })}
        </section>
      )}

      {totalVisits === 0 && jobs.length === 0 && (
        <div className="card p-8 text-center text-slate-500">
          Nothing on your list right now. Tap{" "}
          <Link
            href="/submit"
            className="text-brand-mint-dark hover:underline"
          >
            Submit a report
          </Link>{" "}
          if you've attended a site outside of your roster.
        </div>
      )}
    </div>
  );
}
