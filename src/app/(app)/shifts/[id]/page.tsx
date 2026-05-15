import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { DeleteShiftButton } from "../_components/DeleteShiftButton";

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

function fmt(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildExpectedCheckpoints(
  start: Date,
  end: Date,
  intervalMin: number,
): Date[] {
  const out: Date[] = [];
  let t = new Date(start.getTime() + intervalMin * 60_000);
  while (t.getTime() <= end.getTime()) {
    out.push(new Date(t));
    t = new Date(t.getTime() + intervalMin * 60_000);
  }
  return out;
}

export default async function ShiftDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const shift = await prisma.shift.findUnique({
    where: { id: params.id },
    include: {
      site: { select: { id: true, name: true, code: true } },
      officer: { select: { id: true, name: true } },
      formSubmissions: {
        where: { form: "SHIFT_CHECK" },
        orderBy: { submittedAt: "asc" },
        select: { id: true, submittedAt: true, payload: true },
      },
    },
  });
  if (!shift) notFound();

  const refStart = shift.actualStartedAt ?? shift.scheduledStartsAt;
  const refEnd = shift.actualEndedAt ?? shift.scheduledEndsAt;
  const expected = buildExpectedCheckpoints(
    refStart,
    refEnd,
    shift.checkIntervalMin,
  );

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <Link
          href="/shifts"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Shifts
        </Link>
        <div className="flex items-baseline justify-between gap-3 mt-1">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold text-brand-navy">
              {shift.site.code ? `${shift.site.code} · ` : ""}
              {shift.site.name}
            </h1>
            <span className={STATUS_TONE[shift.status] ?? "chip-slate"}>
              {shift.status.toLowerCase().replace("_", " ")}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href={`/shifts/${shift.id}/edit`} className="btn-secondary">
              Edit
            </Link>
            <DeleteShiftButton shiftId={shift.id} />
          </div>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          {TYPE_LABEL[shift.type] ?? shift.type} ·{" "}
          {shift.officer?.name ?? "unassigned"} · every{" "}
          {shift.checkIntervalMin} min (+{shift.graceMinutes} grace)
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Scheduled start
          </div>
          <div className="text-base font-medium text-brand-navy mt-1">
            {fmt(shift.scheduledStartsAt)}
          </div>
          <div className="text-xs text-slate-500">
            Actual: {fmt(shift.actualStartedAt)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Scheduled end
          </div>
          <div className="text-base font-medium text-brand-navy mt-1">
            {fmt(shift.scheduledEndsAt)}
          </div>
          <div className="text-xs text-slate-500">
            Actual: {fmt(shift.actualEndedAt)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Check-ins so far
          </div>
          <div className="text-2xl font-semibold text-brand-navy mt-1 tabular-nums">
            {shift.formSubmissions.length}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Expected total
          </div>
          <div className="text-2xl font-semibold text-brand-navy mt-1 tabular-nums">
            {expected.length}
          </div>
          <div className="text-xs text-slate-500">over the planned window</div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">Check-ins</h2>
          <p className="text-xs text-slate-500">
            Each row is one submitted hourly check.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                #
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Submitted
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Payload
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shift.formSubmissions.map((s, i) => (
              <tr key={s.id}>
                <td className="px-4 py-2 text-slate-500">{i + 1}</td>
                <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                  {fmt(s.submittedAt)}
                </td>
                <td className="px-4 py-2 text-slate-600 text-xs max-w-[600px] truncate">
                  {JSON.stringify(s.payload)}
                </td>
              </tr>
            ))}
            {shift.formSubmissions.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-500 text-sm">
                  No check-ins yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {shift.notes && (
        <div className="card p-4">
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
            Notes
          </h3>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">
            {shift.notes}
          </p>
        </div>
      )}
    </div>
  );
}
