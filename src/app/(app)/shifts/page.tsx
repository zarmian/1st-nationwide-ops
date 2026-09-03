import Link from "next/link";
import type { ComponentType } from "react";
import {
  CalendarPlus,
  History,
  Clock,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Ban,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { STAT_TONE, type StatTone } from "@/components/StatCard";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  PENDING: "chip-slate",
  IN_PROGRESS: "chip-mint",
  COMPLETED: "chip-mint",
  MISSED: "chip-red",
  ABANDONED: "chip-amber",
};

// Icon + accent for each status tile in the summary strip.
const STATUS_STAT: Record<
  string,
  {
    icon: ComponentType<{ size?: number | string; className?: string }>;
    tone: StatTone;
  }
> = {
  PENDING: { icon: Clock, tone: "indigo" },
  IN_PROGRESS: { icon: Activity, tone: "blue" },
  COMPLETED: { icon: CheckCircle2, tone: "emerald" },
  MISSED: { icon: AlertTriangle, tone: "rose" },
  ABANDONED: { icon: Ban, tone: "amber" },
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
    hour12: false,
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
      <PageHeader
        title="Shifts"
        subtitle="Static guarding and dog-handler shifts with hourly check-ins."
        actions={
          <>
            <Link
              href="/shifts/completed/new"
              className="btn-secondary text-left"
              title="Log a shift that's already been done"
            >
              <History size={16} className="shrink-0" />
              <span className="leading-tight">
                <span className="block">Record completed shift</span>
                <span className="block text-[10px] font-normal opacity-70">
                  Log a past shift
                </span>
              </span>
            </Link>
            <Link
              href="/shifts/new"
              className="btn-primary text-left"
              title="Schedule a new shift for the future"
            >
              <CalendarPlus size={16} className="shrink-0" />
              <span className="leading-tight">
                <span className="block">New shift</span>
                <span className="block text-[10px] font-normal opacity-80">
                  Schedule for the future
                </span>
              </span>
            </Link>
          </>
        }
      />

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {(["PENDING", "IN_PROGRESS", "COMPLETED", "MISSED", "ABANDONED"] as const).map((s) => {
          const meta = STATUS_STAT[s];
          const count = countsMap[s] ?? 0;
          // "Missed" reads red only when something was actually missed.
          const tone: StatTone =
            s === "MISSED" && count === 0 ? "emerald" : meta.tone;
          const tk = STAT_TONE[tone];
          const Icon = meta.icon;
          const active = statusFilter === s;
          return (
            <Link
              key={s}
              href={`/shifts?status=${s}`}
              aria-current={active ? "true" : undefined}
              className={
                "relative overflow-hidden rounded-2xl border bg-white p-3 shadow-card " +
                "transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 " +
                (active ? "ring-2 ring-brand-blue/50 " : "") +
                tk.border
              }
            >
              <div
                aria-hidden
                className={
                  "pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br opacity-[0.12] blur-2xl " +
                  tk.wash
                }
              />
              <div className="relative flex items-start justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {s.replace("_", " ").toLowerCase()}
                </span>
                <span
                  className={
                    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm " +
                    tk.chip
                  }
                >
                  <Icon size={14} />
                </span>
              </div>
              <div
                className={
                  "relative mt-1.5 text-2xl font-semibold tabular-nums tracking-tight " +
                  tk.value
                }
              >
                {count.toLocaleString("en-GB")}
              </div>
            </Link>
          );
        })}
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
