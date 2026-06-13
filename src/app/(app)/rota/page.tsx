import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireStaff } from "@/lib/authz";
import { RotaCell } from "./_components/RotaCell";

export const dynamic = "force-dynamic";

const SHIFTS = ["DAY", "NIGHT"] as const;
type Shift = (typeof SHIFTS)[number];

/**
 * Dispatcher rota board. Week-at-a-time view with regions as rows and
 * day×shift as columns. Each cell shows who's already rota'd plus a
 * picker of the officers who marked themselves available for that
 * (date, shift) but haven't been assigned to any region yet.
 */

function ymd(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocalDate(s: string | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfWeek(d: Date): Date {
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function fmtDayShort(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

export default async function RotaBoardPage({
  searchParams,
}: {
  searchParams: { week?: string };
}) {
  await requireStaff();

  const today = new Date();
  const anchor = parseLocalDate(searchParams.week) ?? today;
  const monday = startOfWeek(anchor);
  const sunday = addDays(monday, 6);

  // Date column for Postgres DATE comparison. We want all 7 days,
  // inclusive of Sunday.
  const rangeStart = new Date(
    Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()),
  );
  const rangeEnd = new Date(
    Date.UTC(sunday.getFullYear(), sunday.getMonth(), sunday.getDate()),
  );

  const [regions, availability, assignments, officers] = await Promise.all([
    prisma.region.findMany({ orderBy: { name: "asc" } }),
    prisma.officerAvailability.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd } },
      include: { officer: { select: { id: true, name: true, regionId: true } } },
    }),
    prisma.rotaAssignment.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd } },
      include: { officer: { select: { id: true, name: true } } },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, regionId: true },
    }),
  ]);

  // Bucket lookups: key = "YYYY-MM-DD|SHIFT".
  const availabilityKey = (date: Date, shift: Shift) =>
    `${ymd(new Date(date))}|${shift}`;

  const availMap = new Map<
    string,
    { officerId: string; officerName: string; regionId: number | null }[]
  >();
  for (const a of availability) {
    const k = availabilityKey(a.date, a.shift as Shift);
    const list = availMap.get(k) ?? [];
    list.push({
      officerId: a.officer.id,
      officerName: a.officer.name,
      regionId: a.officer.regionId,
    });
    availMap.set(k, list);
  }

  // assignmentMap: key = "YYYY-MM-DD|SHIFT|regionId" → assignments.
  const assignMap = new Map<
    string,
    { id: string; officerId: string; officerName: string }[]
  >();
  for (const r of assignments) {
    const k = `${ymd(new Date(r.date))}|${r.shift}|${r.regionId}`;
    const list = assignMap.get(k) ?? [];
    list.push({
      id: r.id,
      officerId: r.officer.id,
      officerName: r.officer.name,
    });
    assignMap.set(k, list);
  }

  // assignedByDateShift: every officerId already placed in *any* region
  // for this (date, shift) — used to grey them out in the picker.
  const assignedByDateShift = new Map<string, Set<string>>();
  for (const r of assignments) {
    const k = `${ymd(new Date(r.date))}|${r.shift}`;
    const set = assignedByDateShift.get(k) ?? new Set<string>();
    set.add(r.officerId);
    assignedByDateShift.set(k, set);
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  const prevWeek = ymd(addDays(monday, -7));
  const nextWeek = ymd(addDays(monday, 7));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Rota</h1>
          <p className="text-sm text-slate-500">
            Region-wise day and night cover. Day = 06:00–18:00, Night =
            18:00–06:00. Assign officers from the list of who marked
            themselves available on /m/rota.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/rota?week=${prevWeek}`}
            className="btn-ghost text-sm"
          >
            ← Previous week
          </Link>
          <Link href="/rota" className="btn-secondary text-sm">
            This week
          </Link>
          <Link
            href={`/rota?week=${nextWeek}`}
            className="btn-ghost text-sm"
          >
            Next week →
          </Link>
        </div>
      </div>

      <div className="text-sm text-slate-600">
        Week of{" "}
        <span className="font-medium text-brand-navy">{fmtDayShort(monday)}</span>{" "}
        – <span className="font-medium text-brand-navy">{fmtDayShort(sunday)}</span>
      </div>

      <div className="space-y-6">
        {days.map((day) => {
          const dayKey = ymd(day);
          const isToday = dayKey === ymd(today);
          return (
            <div key={dayKey} className="card overflow-hidden">
              <div
                className={
                  "px-4 py-2 border-b border-slate-100 flex items-baseline justify-between gap-2 " +
                  (isToday ? "bg-brand-blue-50" : "bg-slate-50")
                }
              >
                <h2 className="font-semibold text-brand-navy">
                  {fmtDayShort(day)}
                  {isToday && (
                    <span className="ml-2 chip-info text-[10px] align-middle">
                      Today
                    </span>
                  )}
                </h2>
              </div>
              {SHIFTS.map((shift) => {
                const k = `${dayKey}|${shift}`;
                const availableHere = availMap.get(k) ?? [];
                const alreadyAssigned =
                  assignedByDateShift.get(k) ?? new Set<string>();
                return (
                  <div
                    key={shift}
                    className="border-t border-slate-100 px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between mb-2">
                      <h3 className="text-sm font-medium text-brand-navy">
                        {shift === "DAY" ? "Day" : "Night"} shift
                        <span className="ml-2 text-xs text-slate-500 font-normal">
                          {shift === "DAY"
                            ? "06:00 – 18:00"
                            : "18:00 – 06:00"}
                        </span>
                      </h3>
                      <span className="text-xs text-slate-500">
                        {availableHere.length} available
                      </span>
                    </div>
                    <div className="space-y-2">
                      {regions.map((region) => {
                        const cellKey = `${dayKey}|${shift}|${region.id}`;
                        const cellAssigned = assignMap.get(cellKey) ?? [];
                        const pickable = availableHere
                          .filter((a) => !alreadyAssigned.has(a.officerId))
                          .map((a) => ({
                            id: a.officerId,
                            name: a.officerName,
                            homeRegion: a.regionId === region.id,
                          }));
                        return (
                          <RotaCell
                            key={region.id}
                            regionName={region.name}
                            regionId={region.id}
                            date={dayKey}
                            shift={shift}
                            assigned={cellAssigned}
                            pickable={pickable}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
