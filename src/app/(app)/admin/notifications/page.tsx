import Link from "next/link";
import { prisma } from "@/lib/db";
import { retryNotification, flushQueueNow } from "./_actions";
import { RetryButton, FlushButton } from "./_components/RetryButton";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  PENDING: "chip-amber",
  SENT: "chip-mint",
  FAILED: "chip-red",
  SKIPPED: "chip-slate",
};

const KIND_LABEL: Record<string, string> = {
  VISIT_STARTED: "Visit started",
  VISIT_COMPLETED: "Visit completed",
  VISIT_LATE: "Visit late",
  VISIT_MISSED: "Visit missed",
  ALARM_RECEIVED: "Alarm received",
  KEY_HANDOVER: "Key handover",
};

function fmt(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: { status?: string; kind?: string };
}) {
  const statusFilter = searchParams.status ?? "";
  const kindFilter = searchParams.kind ?? "";

  const where: any = {};
  if (statusFilter) where.status = statusFilter;
  if (kindFilter) where.kind = kindFilter;

  const rows = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      recipientUser: { select: { name: true, email: true } },
    },
  });
  const totals = await prisma.notification.groupBy({
    by: ["status"],
    _count: { _all: true },
    orderBy: { status: "asc" },
  });

  const counts: Record<string, number> = {};
  for (const t of totals) counts[t.status] = t._count._all;

  const configured = !!(
    process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_ACCESS_TOKEN
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <Link
            href="/admin"
            className="text-sm text-slate-500 hover:text-brand-mint-dark"
          >
            ← Admin
          </Link>
          <h1 className="text-2xl font-semibold text-brand-navy mt-1">
            WhatsApp notifications
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Outbound queue. The /api/cron/whatsapp-queue cron drains every
            minute. Officers / dispatchers receive notifications based on{" "}
            <Link
              href="/officers"
              className="text-brand-mint-dark hover:underline"
            >
              their WhatsApp number
            </Link>{" "}
            being set.
          </p>
        </div>
        <FlushButton flush={flushQueueNow} />
      </div>

      {!configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">WhatsApp is not configured.</span> Set{" "}
          <code className="text-xs bg-amber-100 px-1 rounded">
            WHATSAPP_PHONE_ID
          </code>{" "}
          and{" "}
          <code className="text-xs bg-amber-100 px-1 rounded">
            WHATSAPP_ACCESS_TOKEN
          </code>{" "}
          in Vercel to start sending. See{" "}
          <code className="text-xs bg-amber-100 px-1 rounded">
            docs/whatsapp-setup.md
          </code>{" "}
          for the Meta steps.
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {(["PENDING", "SENT", "FAILED", "SKIPPED"] as const).map((s) => (
          <Link
            key={s}
            href={`/admin/notifications?status=${s}`}
            className={`card p-3 hover:shadow-md transition-shadow ${
              statusFilter === s ? "ring-2 ring-brand-mint/40" : ""
            }`}
          >
            <div className="text-xs uppercase tracking-wider text-slate-500">
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </div>
            <div className="text-2xl font-semibold text-brand-navy tabular-nums">
              {(counts[s] ?? 0).toLocaleString("en-GB")}
            </div>
          </Link>
        ))}
      </div>

      <form className="card p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="status">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={statusFilter}
            className="input"
          >
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
            <option value="SKIPPED">Skipped</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="kind">
            Kind
          </label>
          <select
            id="kind"
            name="kind"
            defaultValue={kindFilter}
            className="input"
          >
            <option value="">All</option>
            {Object.entries(KIND_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-secondary text-sm">
          Apply
        </button>
        {(statusFilter || kindFilter) && (
          <Link href="/admin/notifications" className="btn-ghost text-sm">
            Clear
          </Link>
        )}
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                When
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Kind
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Recipient
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Body preview
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Status
              </th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((n) => (
              <tr key={n.id} className="align-top">
                <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">
                  {fmt(n.createdAt)}
                  {n.sentAt && (
                    <div className="text-[11px] text-slate-400">
                      sent {fmt(n.sentAt)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-700">
                  {KIND_LABEL[n.kind] ?? n.kind}
                </td>
                <td className="px-4 py-2 text-slate-700">
                  {n.recipientUser?.name ?? "—"}
                  <div className="text-[11px] text-slate-500 font-mono">
                    {n.recipientNumber ?? ""}
                  </div>
                </td>
                <td className="px-4 py-2 text-slate-700 max-w-[440px]">
                  <div className="line-clamp-2">{n.bodyPreview ?? "—"}</div>
                  {n.error && (
                    <div className="text-[11px] text-red-600 mt-0.5 line-clamp-2">
                      {n.error}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className={STATUS_TONE[n.status] ?? "chip-slate"}>
                    {n.status.toLowerCase()}
                  </span>
                  {n.attempts > 0 && (
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {n.attempts} attempt{n.attempts === 1 ? "" : "s"}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {(n.status === "FAILED" || n.status === "SKIPPED") && (
                    <RetryButton id={n.id} retry={retryNotification} />
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No notifications match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {rows.length === 200 && (
          <div className="px-4 py-2 text-xs text-slate-500 bg-slate-50 border-t border-slate-100">
            Showing first 200 — narrow filters to see more.
          </div>
        )}
      </div>
    </div>
  );
}
