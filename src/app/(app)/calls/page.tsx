import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { Pagination } from "@/components/Pagination";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const STATUS_TONE: Record<string, string> = {
  MISSED: "chip-red",
  ANSWERED: "chip-mint",
  VOICEMAIL: "chip-amber",
  BUSY: "chip-amber",
  FAILED: "chip-slate",
  UNKNOWN: "chip-slate",
};

function fmt(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function parseLocalDate(s: string | undefined, endOfDay = false): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d));
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function ymd(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: {
    from?: string;
    to?: string;
    missed?: string;
    direction?: string;
    page?: string;
  };
}) {
  const page = Math.max(1, Number(searchParams.page) || 1);
  const now = new Date();
  const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const fromDate = parseLocalDate(searchParams.from) ?? weekAgo;
  const toDate = parseLocalDate(searchParams.to, true) ?? now;
  const missedOnly = searchParams.missed === "1";
  const direction =
    searchParams.direction === "INBOUND" || searchParams.direction === "OUTBOUND"
      ? searchParams.direction
      : "";

  // Anchor on the provider's event time when known, else when we received it.
  const where: any = {
    OR: [
      { occurredAt: { gte: fromDate, lte: toDate } },
      { AND: [{ occurredAt: null }, { createdAt: { gte: fromDate, lte: toDate } }] },
    ],
  };
  if (missedOnly) where.missed = true;
  if (direction) where.direction = direction;

  const [calls, total, missedCount] = await prisma.$transaction([
    prisma.callEvent.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.callEvent.count({ where }),
    prisma.callEvent.count({
      where: {
        missed: true,
        OR: [
          { occurredAt: { gte: fromDate, lte: toDate } },
          { AND: [{ occurredAt: null }, { createdAt: { gte: fromDate, lte: toDate } }] },
        ],
      },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Call log"
        subtitle="Calls posted by the bOnline webhook. Missed calls alert dispatch by SMS."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            In range
          </div>
          <div className="text-2xl font-semibold text-brand-navy tabular-nums">
            {total.toLocaleString("en-GB")}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Missed
          </div>
          <div className="text-2xl font-semibold text-red-600 tabular-nums">
            {missedCount.toLocaleString("en-GB")}
          </div>
        </div>
      </div>

      <form className="card p-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={ymd(fromDate)} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={ymd(toDate)} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="direction">Direction</label>
          <select id="direction" name="direction" defaultValue={direction} className="input">
            <option value="">All</option>
            <option value="INBOUND">Inbound</option>
            <option value="OUTBOUND">Outbound</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="missed" value="1" defaultChecked={missedOnly} className="h-4 w-4" />
          Missed only
        </label>
        <button type="submit" className="btn-secondary text-sm">Apply</button>
      </form>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-default">
            <thead>
              <tr>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">When</th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">Direction</th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">From</th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">To</th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">Status</th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">Duration</th>
                <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">Raw</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                    {fmt(c.occurredAt ?? c.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-slate-600 text-xs">
                    {c.direction?.toLowerCase() ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                    {c.fromNumber ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                    {c.toNumber ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`${STATUS_TONE[c.status ?? "UNKNOWN"] ?? "chip-slate"} text-[10px]`}>
                      {(c.status ?? "unknown").toLowerCase()}
                    </span>
                    {c.missed && c.alerted && (
                      <span className="chip-slate text-[10px] ml-1">alerted</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600 text-xs">
                    {fmtDuration(c.durationSec)}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <details>
                      <summary className="cursor-pointer text-brand-blue-dark">view</summary>
                      <pre className="mt-1 max-w-[420px] overflow-x-auto whitespace-pre-wrap break-words text-[10px] text-slate-600">
                        {JSON.stringify(c.payload, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
              {calls.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No calls in this range yet. Once bOnline&apos;s webhook is
                    pointed here, call events will appear.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination
            page={page}
            totalPages={totalPages}
            basePath="/calls"
            searchParams={searchParams}
          />
        </div>
      )}

      <p className="text-xs text-slate-500">
        Tip: the raw payload above is what bOnline sent. If missed calls
        aren&apos;t being detected, open a missed call&apos;s raw data and share
        it so the detection can be tuned.{" "}
        <Link href="/activities" className="text-brand-blue-dark hover:underline">
          Back to activities
        </Link>
      </p>
    </div>
  );
}
