import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  PENDING: "chip-slate",
  IN_PROGRESS: "chip-mint",
  COMPLETED: "chip-mint",
  MISSED: "chip-red",
  ABANDONED: "chip-amber",
};

const TYPE_LABEL: Record<string, string> = {
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
};

function fmt(d: Date): string {
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const statusFilter = searchParams.status ?? "";
  const where: any = {};
  if (statusFilter) where.status = statusFilter;

  const [shifts, counts] = await Promise.all([
    prisma.shift.findMany({
      where,
      orderBy: { scheduledStartsAt: "desc" },
      take: 100,
      include: {
        site: { select: { id: true, name: true, code: true } },
        officer: { select: { id: true, name: true } },
      },
    }),
    prisma.shift.groupBy({
      by: ["status"],
      _count: { _all: true },
      orderBy: { status: "asc" },
    }),
  ]);
  const countsMap: Record<string, number> = {};
  for (const c of counts) countsMap[c.status] = c._count._all;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Shifts</h1>
          <p className="text-sm text-slate-500">
            Static guarding and dog-handler shifts with hourly check-ins.
          </p>
        </div>
        <Link href="/shifts/new" className="btn-primary">
          + New shift
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {(["PENDING", "IN_PROGRESS", "COMPLETED", "MISSED", "ABANDONED"] as const).map((s) => (
          <Link
            key={s}
            href={`/shifts?status=${s}`}
            className={`card p-3 hover:shadow-md transition-shadow ${
              statusFilter === s ? "ring-2 ring-brand-mint/40" : ""
            }`}
          >
            <div className="text-xs uppercase tracking-wider text-slate-500">
              {s.replace("_", " ").toLowerCase()}
            </div>
            <div className="text-2xl font-semibold text-brand-navy tabular-nums">
              {countsMap[s] ?? 0}
            </div>
          </Link>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Site
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Type
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Officer
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Scheduled
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shifts.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link
                    href={`/shifts/${s.id}`}
                    className="font-medium text-brand-navy hover:text-brand-mint-dark"
                  >
                    {s.site.code ? `${s.site.code} · ` : ""}
                    {s.site.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {TYPE_LABEL[s.type] ?? s.type}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {s.officer?.name ?? "—"}
                </td>
                <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">
                  {fmt(s.scheduledStartsAt)} →{" "}
                  {fmt(s.scheduledEndsAt)}
                </td>
                <td className="px-4 py-2">
                  <span className={STATUS_TONE[s.status] ?? "chip-slate"}>
                    {s.status.toLowerCase().replace("_", " ")}
                  </span>
                </td>
              </tr>
            ))}
            {shifts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No shifts match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
