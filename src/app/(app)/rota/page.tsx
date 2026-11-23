import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/authz";
import { ukDayString } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import { PageHeader } from "@/components/PageHeader";
import {
  PATROL_LABEL,
  ROTA_SLOTS,
  SHIFT_LABEL,
  addDays,
  availabilityFor,
  dateKey,
  dateValue,
  dayLabel,
  mondayOf,
  shiftHours,
  shiftsOverlap,
  type AvailabilityShift,
  type RotaPatrolCode,
  type RotaShiftCode,
} from "@/lib/rota";
import { SOUTH_SHIFT_SERVICE } from "@/lib/rotaPay";
import { RotaCell, type PickableOfficer } from "./_components/RotaCell";

export const dynamic = "force-dynamic";

/**
 * Mobile patrol rota board, a week at a time. Each day has three shifts:
 * North Mobile (24 hours), South Mobile day and South Mobile night. Each
 * shows who's on, plus a picker of officers: the ones who marked themselves
 * available first, then everyone else. Officers already on a shift that
 * overlaps (the North 24-hour shift overlaps both South shifts that day)
 * aren't offered.
 */
export default async function RotaBoardPage({
  searchParams,
}: {
  searchParams: { week?: string };
}) {
  const me = await requireStaff();

  const today = ukDayString(new Date());
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.week ?? "")
    ? searchParams.week!
    : today;
  const monday = mondayOf(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sunday = days[6]!;

  const [availability, assignments, officers, southRates] = await Promise.all([
    prisma.officerAvailability.findMany({
      where: { date: { gte: dateValue(monday), lte: dateValue(sunday) } },
      select: { officerId: true, date: true, shift: true },
    }),
    // A day either side of the week, so a clash across midnight at the
    // week's edges still keeps an officer out of the picker.
    prisma.rotaAssignment.findMany({
      where: {
        patrol: { not: null },
        date: {
          gte: dateValue(addDays(monday, -1)),
          lte: dateValue(addDays(sunday, 1)),
        },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        date: true,
        shift: true,
        patrol: true,
        officerId: true,
        officer: { select: { name: true } },
      },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // Pay is admin-only, like Officer pay rates.
    me.role === "ADMIN"
      ? prisma.officerRate.findMany({
          where: {
            officerId: null,
            service: { in: [SOUTH_SHIFT_SERVICE.DAY, SOUTH_SHIFT_SERVICE.NIGHT] },
          },
          select: { service: true, amount: true, currency: true },
        })
      : Promise.resolve([]),
  ]);

  // The halves each officer marked, per day: "YYYY-MM-DD|officerId".
  const marked = new Map<string, Set<AvailabilityShift>>();
  for (const a of availability) {
    if (a.shift !== "DAY" && a.shift !== "NIGHT") continue;
    const k = `${dateKey(a.date)}|${a.officerId}`;
    const set = marked.get(k) ?? new Set<AvailabilityShift>();
    set.add(a.shift);
    marked.set(k, set);
  }

  const rows = assignments.map((a) => ({
    id: a.id,
    date: dateKey(a.date),
    shift: a.shift as RotaShiftCode,
    patrol: a.patrol as RotaPatrolCode,
    officerId: a.officerId,
    officerName: a.officer.name,
  }));

  const dayRate = southRates.find((r) => r.service === SOUTH_SHIFT_SERVICE.DAY);
  const nightRate = southRates.find((r) => r.service === SOUTH_SHIFT_SERVICE.NIGHT);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Rota"
        subtitle="Mobile patrol cover. North Mobile is one 24-hour shift a day, 09:00 to 09:00. South Mobile has a day shift, 09:00 to 18:00, and a night shift, 18:00 to 09:00. Officers tick the halves they can work on My rota."
        actions={
          <>
            <Link href={`/rota?week=${addDays(monday, -7)}`} className="btn-ghost text-sm">
              ← Previous week
            </Link>
            <Link href="/rota" className="btn-secondary text-sm">
              This week
            </Link>
            <Link href={`/rota?week=${addDays(monday, 7)}`} className="btn-ghost text-sm">
              Next week →
            </Link>
          </>
        }
      />

      {me.role === "ADMIN" && (
        <div className="card p-3 text-sm text-slate-600">
          {dayRate || nightRate ? (
            <>
              South Mobile pays per shift: day{" "}
              <span className="font-medium text-brand-navy tabular-nums">
                {dayRate ? formatMoney(Number(dayRate.amount), { currency: dayRate.currency }) : "not set"}
              </span>
              , night{" "}
              <span className="font-medium text-brand-navy tabular-nums">
                {nightRate
                  ? formatMoney(Number(nightRate.amount), { currency: nightRate.currency })
                  : "not set"}
              </span>{" "}
              (company default). North Mobile is paid by the monthly retainer.{" "}
            </>
          ) : (
            <>
              South Mobile shifts aren&rsquo;t paid yet: set the day and night
              shift amounts. North Mobile is paid by the monthly retainer.{" "}
            </>
          )}
          <Link href="/admin/officer-rates" className="text-brand-blue-dark hover:underline">
            Officer pay rates →
          </Link>
        </div>
      )}

      <div className="text-sm text-slate-600">
        Week of <span className="font-medium text-brand-navy">{dayLabel(monday)}</span>{" "}
        – <span className="font-medium text-brand-navy">{dayLabel(sunday)}</span>
      </div>

      <div className="space-y-6">
        {days.map((day) => {
          const isToday = day === today;
          return (
            <section key={day} className="card overflow-hidden" aria-labelledby={`rota-${day}`}>
              <div
                className={
                  "px-4 py-2 border-b border-slate-100 flex items-baseline justify-between gap-2 " +
                  (isToday ? "bg-brand-blue-50" : "bg-slate-50")
                }
              >
                <h2 id={`rota-${day}`} className="font-semibold text-brand-navy">
                  {dayLabel(day)}
                  {isToday && (
                    <span className="ml-2 chip-info text-[10px] align-middle">Today</span>
                  )}
                </h2>
              </div>
              <div className="divide-y divide-slate-100">
                {ROTA_SLOTS.map((slot) => {
                  const here = { date: day, shift: slot.shift };
                  const assigned = rows.filter(
                    (r) => r.date === day && r.patrol === slot.patrol && r.shift === slot.shift,
                  );
                  const onThisShift = new Set(assigned.map((a) => a.officerId));
                  // Officers on a shift that overlaps this one can't be added.
                  const busy = new Set(
                    rows
                      .filter((r) => !onThisShift.has(r.officerId) && shiftsOverlap(here, r))
                      .map((r) => r.officerId),
                  );
                  const pickable: PickableOfficer[] = officers
                    .filter((o) => !onThisShift.has(o.id) && !busy.has(o.id))
                    .map((o) => {
                      const halves = marked.get(`${day}|${o.id}`) ?? new Set<AvailabilityShift>();
                      const availability = availabilityFor(slot, halves);
                      return {
                        id: o.id,
                        name: o.name,
                        availability,
                        note:
                          availability === "partial"
                            ? halves.has("DAY")
                              ? "day only"
                              : "night only"
                            : null,
                      };
                    });
                  return (
                    <div key={`${slot.patrol}-${slot.shift}`} className="px-4 py-2">
                      <RotaCell
                        date={day}
                        patrol={slot.patrol}
                        shift={slot.shift}
                        patrolLabel={PATROL_LABEL[slot.patrol]}
                        shiftLabel={SHIFT_LABEL[slot.shift]}
                        hours={shiftHours(slot.shift)}
                        assigned={assigned.map((a) => ({
                          id: a.id,
                          officerId: a.officerId,
                          officerName: a.officerName,
                        }))}
                        pickable={pickable}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
