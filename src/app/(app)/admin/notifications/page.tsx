import Link from "next/link";
import { prisma } from "@/lib/db";
import { DataTable } from "@/components/DataTable";
import { FilterPanel } from "@/components/FilterPanel";
import { retryNotification, flushQueueNow } from "./_actions";
import { PageHeader } from "@/components/PageHeader";
import { RetryButton, FlushButton } from "./_components/RetryButton";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  PENDING: "chip-amber",
  SENT: "chip-mint",
  FAILED: "chip-red",
  SKIPPED: "chip-slate",
};

const KIND_LABEL: Record<string, string> = {
  VISIT_STARTED: "Patrol started",
  VISIT_COMPLETED: "Patrol completed",
  VISIT_LATE: "Patrol late",
  VISIT_MISSED: "Patrol missed",
  ALARM_RECEIVED: "Alarm received",
  KEY_HANDOVER: "Key handover",
  SHIFT_CHECK_OVERDUE: "Check-in overdue",
  SHIFT_REMINDER: "Shift reminder",
  JOB_REMINDER: "Job reminder",
  OFFICER_NO_SHOW: "Officer no-show",
  ALARM_CUSTOMER_ACK: "Customer alarm ack",
  PAY_SUMMARY: "Pay summary",
  MISSED_CALL: "Missed call",
  SHIFT_LINK: "Shift link",
};

const CHANNEL_TONE: Record<string, string> = {
  WHATSAPP: "chip-green",
  SMS: "chip-info",
  TELEGRAM: "chip-mint",
  EMAIL: "chip-slate",
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
      <PageHeader
        title="Notifications"
        backHref="/admin"
        backLabel="Admin"
        subtitle={
          <>
            Outbound queue for WhatsApp, SMS and Telegram alerts. The per-minute
            crons drain WhatsApp and SMS; Telegram is sent instantly. Choose who
            gets what on the{" "}
            <Link
              href="/admin/notifications/settings"
              className="text-brand-blue-dark hover:underline"
            >
              routing settings
            </Link>{" "}
            page.
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Link href="/admin/notifications/settings" className="btn-secondary">
              Routing settings
            </Link>
            <FlushButton flush={flushQueueNow} />
          </div>
        }
      />

      {!configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">WhatsApp isn't set up.</span> WhatsApp
          messages are skipped — Telegram and SMS are unaffected. Turn WhatsApp
          off per alert on the{" "}
          <Link
            href="/admin/notifications/settings"
            className="font-medium underline"
          >
            routing settings
          </Link>{" "}
          page, or set{" "}
          <code className="text-xs bg-amber-100 px-1 rounded">
            WHATSAPP_PHONE_ID
          </code>{" "}
          and{" "}
          <code className="text-xs bg-amber-100 px-1 rounded">
            WHATSAPP_ACCESS_TOKEN
          </code>{" "}
          in Vercel to enable it.
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {(["PENDING", "SENT", "FAILED", "SKIPPED"] as const).map((s) => (
          <Link
            key={s}
            href={`/admin/notifications?status=${s}`}
            className={`card p-3 hover:shadow-md transition-shadow ${
              statusFilter === s ? "ring-2 ring-brand-blue/40" : ""
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

      <FilterPanel
        clearAllHref="/admin/notifications"
        activeFilters={(() => {
          const filters: { label: string; clearHref: string }[] = [];
          const drop = (k: string): string => {
            const sp = new URLSearchParams(searchParams as any);
            sp.delete(k);
            const qs = sp.toString();
            return qs ? `/admin/notifications?${qs}` : "/admin/notifications";
          };
          if (statusFilter) {
            filters.push({
              label: `Status: ${statusFilter.toLowerCase()}`,
              clearHref: drop("status"),
            });
          }
          if (kindFilter) {
            filters.push({
              label: `Kind: ${KIND_LABEL[kindFilter] ?? kindFilter}`,
              clearHref: drop("kind"),
            });
          }
          return filters;
        })()}
      >
        <form className="flex flex-wrap items-end gap-3">
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
        </form>
      </FilterPanel>

      <DataTable
        rows={rows}
        footer={
          rows.length === 200
            ? "Showing first 200 — narrow filters to see more."
            : undefined
        }
        emptyState="No notifications match these filters."
        columns={[
          {
            header: "When",
            cell: (n) => (
              <div className="text-slate-500 text-xs whitespace-nowrap">
                {fmt(n.createdAt)}
                {n.sentAt && (
                  <div className="text-[11px] text-slate-400">
                    sent {fmt(n.sentAt)}
                  </div>
                )}
              </div>
            ),
          },
          {
            header: "Kind",
            cell: (n) => (
              <span className="text-slate-700">
                {KIND_LABEL[n.kind] ?? n.kind}
              </span>
            ),
          },
          {
            header: "Channel",
            cell: (n) => (
              <span className={CHANNEL_TONE[n.channel] ?? "chip-slate"}>
                {n.channel.toLowerCase()}
              </span>
            ),
          },
          {
            header: "Recipient",
            cell: (n) => (
              <div>
                <div className="text-slate-700">{n.recipientUser?.name ?? "—"}</div>
                <div className="text-[11px] text-slate-500 font-mono">
                  {n.recipientNumber ?? ""}
                </div>
              </div>
            ),
          },
          {
            header: "Body preview",
            cell: (n) => (
              <div className="text-slate-700 max-w-[440px]">
                <div className="line-clamp-2">{n.bodyPreview ?? "—"}</div>
                {n.error && (
                  <div className="text-[11px] text-red-600 mt-0.5 line-clamp-2">
                    {n.error}
                  </div>
                )}
              </div>
            ),
          },
          {
            header: "Status",
            cell: (n) => (
              <div>
                <span className={STATUS_TONE[n.status] ?? "chip-slate"}>
                  {n.status.toLowerCase()}
                </span>
                {n.attempts > 0 && (
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {n.attempts} attempt{n.attempts === 1 ? "" : "s"}
                  </div>
                )}
              </div>
            ),
          },
          {
            header: "",
            align: "right",
            cell: (n) =>
              n.status === "FAILED" || n.status === "SKIPPED" ? (
                <RetryButton id={n.id} retry={retryNotification} />
              ) : null,
          },
        ]}
      />
    </div>
  );
}
