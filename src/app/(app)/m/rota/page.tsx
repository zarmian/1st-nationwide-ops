import { requireOfficerPage } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ukDayString } from "@/lib/dates";
import { PageHeader } from "@/components/PageHeader";
import {
  AVAILABILITY_SHIFTS,
  PATROL_LABEL,
  SHIFT_LABEL,
  addDays,
  dateKey,
  dateValue,
  halvesOf,
  shiftHours,
  type AvailabilityShift,
  type RotaPatrolCode,
  type RotaShiftCode,
} from "@/lib/rota";
import { AvailabilityToggle } from "./_components/AvailabilityToggle";

export const dynamic = "force-dynamic";

/**
 * Officer self-service rota page. Two surfaces in one:
 *
 *   1. "My availability" — a 14-day strip where the officer ticks the Day
 *      (09:00–18:00) and Night (18:00–09:00) halves they can cover. The
 *      office sees these when filling the rota.
 *   2. "You're on the rota for" — read-only list of the mobile patrol shifts
 *      the office has put them on.
 *
 * North Mobile is a 24-hour shift (09:00–09:00), so it takes both halves.
 */

const DAYS_AHEAD = 14;

function longDay(day: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "2-digit",
    month: "short",
  }).format(dateValue(day));
}

export default async function MyRotaPage() {
  const { id: userId } = await requireOfficerPage();

  const today = ukDayString(new Date());
  const lastDay = addDays(today, DAYS_AHEAD);

  const [availability, assignments] = await Promise.all([
    prisma.officerAvailability.findMany({
      where: { officerId: userId, date: { gte: dateValue(today), lte: dateValue(lastDay) } },
      select: { date: true, shift: true },
    }),
    prisma.rotaAssignment.findMany({
      where: { officerId: userId, date: { gte: dateValue(today), lte: dateValue(lastDay) } },
      include: { region: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { shift: "asc" }],
    }),
  ]);

  const availSet = new Set(availability.map((a) => `${dateKey(a.date)}|${a.shift}`));

  // What each assignment is called, and which halves of its day it takes.
  // Rows from the older region-based rota have no patrol: show the region.
  const shifts = assignments.map((a) => {
    const shift = a.shift as RotaShiftCode;
    const patrol = a.patrol as RotaPatrolCode | null;
    return {
      id: a.id,
      day: dateKey(a.date),
      halves: halvesOf(shift),
      name: patrol ? PATROL_LABEL[patrol] : (a.region?.name ?? "Rota"),
      when: patrol
        ? `${SHIFT_LABEL[shift]} (${shiftHours(shift)})`
        : shift === "DAY"
          ? "Day"
          : "Night",
    };
  });
  const onFor = new Map<string, string[]>(); // "day|half" → patrol names
  for (const s of shifts) {
    for (const h of s.halves) {
      const k = `${s.day}|${h}`;
      onFor.set(k, [...(onFor.get(k) ?? []), s.name]);
    }
  }

  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="My rota"
        subtitle="Tick the halves you can work and the office will put you on the rota. Day is 09:00 to 18:00, Night is 18:00 to 09:00 the next morning. North Mobile is a 24-hour shift, 09:00 to 09:00, so tick both halves if you can do it."
      />

      {shifts.length > 0 && (
        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            You&rsquo;re on the rota for
          </h2>
          <ul className="text-sm space-y-1">
            {shifts.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3">
                <span>
                  <span className="font-medium text-brand-navy">{longDay(s.day)}</span>{" "}
                  <span className="text-slate-500">· {s.when}</span>
                </span>
                <span className="chip-mint text-xs">{s.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
          My availability — next {DAYS_AHEAD} days
        </h2>
        <ul className="space-y-1.5">
          {days.map((day) => (
            <li
              key={day}
              className="card p-3 grid grid-cols-[1fr_auto_auto] gap-3 items-center"
            >
              <div className="text-sm">
                <div className="font-medium text-brand-navy">{longDay(day)}</div>
              </div>
              {AVAILABILITY_SHIFTS.map((half: AvailabilityShift) => {
                const k = `${day}|${half}`;
                return (
                  <AvailabilityToggle
                    key={half}
                    date={day}
                    shift={half}
                    initialAvailable={availSet.has(k)}
                    assignedTo={onFor.get(k) ?? []}
                  />
                );
              })}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
