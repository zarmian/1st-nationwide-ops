import Link from "next/link";
import { prisma } from "@/lib/db";
import { DataTable } from "@/components/DataTable";

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
              statusFilter === s ? "ring-2 ring-brand-blue/40" : ""
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

      <DataTable
        rows={shifts}
        rowHref={(s) => `/shifts/${s.id}`}
        emptyState={
          statusFilter ? (
            "No shifts match these filters."
          ) : (
            <div className="space-y-3">
              <p>No shifts yet.</p>
              <Link href="/shifts/new" className="btn-primary text-sm inline-block">
                + Schedule your first shift
              </Link>
            </div>
          )
        }
        columns={[
          {
            header: "Site",
            cell: (s) => (
              <span className="font-medium text-brand-navy">
                {s.site.code ? `${s.site.code} · ` : ""}
                {s.site.name}
              </span>
            ),
          },
          {
            header: "Type",
            cell: (s) => (
              <span className="text-slate-600">
                {TYPE_LABEL[s.type] ?? s.type}
              </span>
            ),
          },
          {
            header: "Officer",
            cell: (s) => (
              <span className="text-slate-600">{s.officer?.name ?? "—"}</span>
            ),
          },
          {
            header: "Scheduled",
            cell: (s) => (
              <span className="text-slate-500 text-xs whitespace-nowrap">
                {fmt(s.scheduledStartsAt)} → {fmt(s.scheduledEndsAt)}
              </span>
            ),
          },
          {
            header: "Status",
            cell: (s) => (
              <span className={STATUS_TONE[s.status] ?? "chip-slate"}>
                {s.status.toLowerCase().replace("_", " ")}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
