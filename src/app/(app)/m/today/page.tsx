import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Link from "next/link";
import { VisitCard } from "./_components/VisitCard";

export const dynamic = "force-dynamic";

export default async function OfficerTodayPage() {
  const session = await getServerSession(authOptions);
  const userId = (session!.user as any).id as string;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const [myVisits, unassignedVisits, jobs] = await Promise.all([
    prisma.patrolVisit.findMany({
      where: {
        officerId: userId,
        scheduledAt: { gte: startOfDay, lte: endOfDay },
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
    prisma.patrolVisit.findMany({
      where: {
        officerId: null,
        scheduledAt: { gte: startOfDay, lte: endOfDay },
        status: { in: ["PENDING", "LATE"] },
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
        OR: [
          { scheduledFor: { gte: startOfDay, lte: endOfDay } },
          { status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
        ],
      },
      include: {
        site: { select: { name: true, addressLine: true, postcodeFormatted: true } },
      },
      orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const totalVisits = myVisits.length + unassignedVisits.length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Today</h1>
        <p className="text-sm text-slate-500">
          {totalVisits} patrol{totalVisits === 1 ? "" : "s"}
          {jobs.length > 0
            ? ` · ${jobs.length} job${jobs.length === 1 ? "" : "s"}`
            : ""}{" "}
          on your list.
        </p>
      </div>

      {myVisits.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-slate-500">
            Your patrols
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

      {unassignedVisits.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-slate-500">
            Unassigned — claim by tapping "On site"
          </h2>
          {unassignedVisits.map((v) => (
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
                isMine: false,
              }}
            />
          ))}
        </section>
      )}

      {jobs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider text-slate-500">
            Other jobs
          </h2>
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
