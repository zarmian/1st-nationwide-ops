import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { AvailabilityToggle } from "./_components/AvailabilityToggle";

export const dynamic = "force-dynamic";

/**
 * Officer self-service rota page. Two surfaces in one:
 *
 *   1. "My availability" — a 14-day strip where the officer toggles
 *      DAY / NIGHT slots they can cover. Dispatch sees these when
 *      assigning the rota.
 *   2. "My rota" — read-only list of the assignments dispatch has
 *      already placed on them, with region + shift + date.
 *
 * Date semantics match the rota board: each row is one UK calendar
 * day; NIGHT slots span 18:00 → 06:00 next day.
 */

const DAYS_AHEAD = 14;
const SHIFTS = ["DAY", "NIGHT"] as const;
type Shift = (typeof SHIFTS)[number];

function ymd(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtLong(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  });
}

export default async function MyRotaPage() {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rangeStart = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()),
  );
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + DAYS_AHEAD);

  const [availability, assignments] = await Promise.all([
    prisma.officerAvailability.findMany({
      where: {
        officerId: userId,
        date: { gte: rangeStart, lte: rangeEnd },
      },
    }),
    prisma.rotaAssignment.findMany({
      where: {
        officerId: userId,
        date: { gte: rangeStart, lte: rangeEnd },
      },
      include: { region: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { shift: "asc" }],
    }),
  ]);

  const availSet = new Set(
    availability.map((a) => `${ymd(new Date(a.date))}|${a.shift}`),
  );
  const assignByDateShift = new Map<
    string,
    { regionName: string }[]
  >();
  for (const r of assignments) {
    const k = `${ymd(new Date(r.date))}|${r.shift}`;
    const list = assignByDateShift.get(k) ?? [];
    list.push({ regionName: r.region.name });
    assignByDateShift.set(k, list);
  }

  const days = Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="My rota"
        subtitle="Tick the shifts you can work and dispatch will place you on the rota. Day = 06:00–18:00, Night = 18:00–06:00."
      />

      {assignments.length > 0 && (
        <div className="card p-4 space-y-2">
          <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
            You're on the rota for
          </h2>
          <ul className="text-sm space-y-1">
            {assignments.map((a) => {
              const d = new Date(a.date);
              return (
                <li
                  key={a.id}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span>
                    <span className="font-medium text-brand-navy">
                      {fmtLong(d)}
                    </span>{" "}
                    <span className="text-slate-500">
                      ·{" "}
                      {a.shift === "DAY"
                        ? "Day (06:00–18:00)"
                        : "Night (18:00–06:00)"}
                    </span>
                  </span>
                  <span className="chip-mint text-xs">{a.region.name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="font-semibold text-brand-navy text-sm uppercase tracking-wider">
          My availability — next {DAYS_AHEAD} days
        </h2>
        <ul className="space-y-1.5">
          {days.map((day) => {
            const dayKey = ymd(day);
            return (
              <li
                key={dayKey}
                className="card p-3 grid grid-cols-[1fr_auto_auto] gap-3 items-center"
              >
                <div className="text-sm">
                  <div className="font-medium text-brand-navy">
                    {fmtLong(day)}
                  </div>
                </div>
                {SHIFTS.map((shift) => {
                  const k = `${dayKey}|${shift}`;
                  const isAvailable = availSet.has(k);
                  const rotaedRegions = assignByDateShift.get(k) ?? [];
                  return (
                    <AvailabilityToggle
                      key={shift}
                      date={dayKey}
                      shift={shift}
                      initialAvailable={isAvailable}
                      assignedRegions={rotaedRegions.map(
                        (r) => r.regionName,
                      )}
                    />
                  );
                })}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
