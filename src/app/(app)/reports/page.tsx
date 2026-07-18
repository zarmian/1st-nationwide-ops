import Link from "next/link";
import { requireStaff } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { getJobTypeLabels } from "@/lib/labels";
import { jobScheduledRange, shiftScheduledRange } from "@/lib/activityWhen";
import { ukDayPlus, ukWallClockToUtc } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * Daily client report — Shurgard (+ Access Storage for static guarding).
 *
 *  - Callouts + lock-ups/unlocks (Jobs) on Shurgard sites.
 *  - Static guarding shifts on Shurgard OR Access Storage sites.
 *
 * A site is tagged "(Nexus)" ONLY when the work was subcontracted to Nexus.
 * Our own officers and any other partner are shown without a tag.
 */

type UkDay = { year: number; month: number; day: number };

function parseUkDay(s: string | undefined): UkDay | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function ymd(d: UkDay): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.year}-${p(d.month)}-${p(d.day)}`;
}

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function longDate(d: UkDay): string {
  return ukWallClockToUtc(d.year, d.month, d.day, 12, 0).toLocaleDateString(
    "en-GB",
    {
      timeZone: "Europe/London",
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    },
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  await requireStaff();

  const now = new Date();
  const day = parseUkDay(searchParams.date) ?? ukDayPlus(now, 0);
  const dayStart = ukWallClockToUtc(day.year, day.month, day.day, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const prev = ymd(ukDayPlus(dayStart, -1));
  const next = ymd(ukDayPlus(dayStart, 1));

  // Identify the accounts + Nexus by name (case-insensitive).
  const [shurgard, access, nexus, jobTypeLabels] = await Promise.all([
    prisma.customer.findFirst({
      where: { name: { contains: "Shurgard", mode: "insensitive" } },
      select: { id: true, name: true },
    }),
    prisma.customer.findFirst({
      where: { name: { contains: "Access", mode: "insensitive" } },
      select: { id: true, name: true },
    }),
    prisma.partner.findFirst({
      where: { name: { contains: "Nexus", mode: "insensitive" } },
      select: { id: true, name: true },
    }),
    getJobTypeLabels(),
  ]);

  // Callouts + lock/unlocks on Shurgard sites.
  const jobs = shurgard
    ? await prisma.job.findMany({
        where: {
          site: { is: { customerId: shurgard.id } },
          status: { not: "CANCELLED" },
          completedAt: { not: null },
          ...jobScheduledRange(dayStart, dayEnd),
        },
        select: {
          id: true,
          type: true,
          typeLabel: true,
          scheduledFor: true,
          completedAt: true,
          notes: true,
          handledByPartnerId: true,
          handledByPartner: { select: { name: true } },
          assignedTo: { select: { name: true } },
          site: { select: { id: true, name: true, code: true } },
        },
      })
    : [];

  // Static guarding shifts on Shurgard OR Access Storage sites.
  const storageCustomerIds = [shurgard?.id, access?.id].filter(
    (id): id is string => Boolean(id),
  );
  const shifts = storageCustomerIds.length
    ? await prisma.shift.findMany({
        where: {
          type: "STATIC_GUARDING",
          status: "COMPLETED",
          site: { is: { customerId: { in: storageCustomerIds } } },
          ...shiftScheduledRange(dayStart, dayEnd),
        },
        select: {
          id: true,
          scheduledStartsAt: true,
          scheduledEndsAt: true,
          actualStartedAt: true,
          actualEndedAt: true,
          handledByPartnerId: true,
          handledByPartner: { select: { name: true } },
          officer: { select: { name: true } },
          officerNameRaw: true,
          site: {
            select: {
              id: true,
              name: true,
              code: true,
              customer: { select: { name: true } },
            },
          },
        },
      })
    : [];

  const nexusId = nexus?.id ?? null;
  // A site is tagged (Nexus) only when Nexus specifically handled it.
  function siteLabel(
    site: { name: string; code: string | null },
    handledByPartnerId: string | null,
  ): string {
    const base = site.code ? `${site.code} · ${site.name}` : site.name;
    return nexusId && handledByPartnerId === nexusId ? `${base} (Nexus)` : base;
  }

  const jobRows = jobs
    .filter((j): j is typeof j & { site: NonNullable<typeof j.site> } =>
      j.site != null,
    )
    .map((j) => ({
      when: j.scheduledFor ?? j.completedAt ?? dayStart,
      site: siteLabel(j.site, j.handledByPartnerId),
      siteId: j.site.id,
      type: j.typeLabel ?? jobTypeLabels[j.type] ?? j.type.replace(/_/g, " "),
      who: j.handledByPartner
        ? j.handledByPartner.name
        : (j.assignedTo?.name ?? "—"),
      notes: j.notes,
    }))
    .sort((a, b) => a.when.getTime() - b.when.getTime());

  const shiftRows = shifts
    .map((s) => ({
      when: s.scheduledStartsAt,
      site: siteLabel(s.site, s.handledByPartnerId),
      siteId: s.site.id,
      account: s.site.customer?.name ?? "—",
      hours:
        s.actualStartedAt && s.actualEndedAt
          ? `${fmtTime(s.actualStartedAt)}–${fmtTime(s.actualEndedAt)}`
          : `${fmtTime(s.scheduledStartsAt)}–${fmtTime(s.scheduledEndsAt)} (sched.)`,
      who: s.handledByPartner
        ? s.handledByPartner.name
        : (s.officer?.name ?? s.officerNameRaw ?? "—"),
    }))
    .sort((a, b) => a.when.getTime() - b.when.getTime());

  return (
    <div className="section">
      <PageHeader
        title="Daily report"
        subtitle={
          <>Shurgard callouts &amp; lock-ups · static guarding (Shurgard &amp; Access Storage) · {longDate(day)}</>
        }
        actions={
          <a
            href={`/api/reports/shurgard?date=${ymd(day)}`}
            target="_blank"
            rel="noreferrer"
            className="btn-primary text-sm"
          >
            Download PDF
          </a>
        }
      />

      {/* Date navigation */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/reports?date=${prev}`} className="btn-secondary text-sm">
          ← Prev day
        </Link>
        <form className="flex items-end gap-2">
          <input
            type="date"
            name="date"
            defaultValue={ymd(day)}
            className="input"
          />
          <button type="submit" className="btn-secondary text-sm">
            Go
          </button>
        </form>
        <Link href={`/reports?date=${next}`} className="btn-secondary text-sm">
          Next day →
        </Link>
      </div>

      {!shurgard && (
        <div className="card p-4 text-sm text-amber-700 bg-amber-50">
          No customer named “Shurgard” found. Create it in Admin → Partners /
          customers and its sites, then this report will populate.
        </div>
      )}

      {/* Callouts + lock/unlocks */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">
            Callouts, lock-ups &amp; unlocks — Shurgard
          </h2>
          <p className="text-xs text-slate-500">
            {jobRows.length} on {longDate(day)}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="table-default">
            <thead>
              <tr>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider font-medium">Time</th>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider font-medium">Site</th>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider font-medium">Type</th>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider font-medium">Attended by</th>
              </tr>
            </thead>
            <tbody>
              {jobRows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 text-slate-700 tabular-nums whitespace-nowrap">
                    {fmtTime(r.when)}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/sites/${r.siteId}`}
                      className="font-medium text-brand-navy hover:text-brand-blue-dark"
                    >
                      {r.site}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{r.type}</td>
                  <td className="px-4 py-2 text-slate-600">{r.who}</td>
                </tr>
              ))}
              {jobRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No callouts or lock-ups for Shurgard on this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Static guarding */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">
            Static guarding — Shurgard &amp; Access Storage
          </h2>
          <p className="text-xs text-slate-500">
            {shiftRows.length} shift{shiftRows.length === 1 ? "" : "s"} on{" "}
            {longDate(day)}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="table-default">
            <thead>
              <tr>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider font-medium">Hours</th>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider font-medium">Site</th>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider font-medium">Account</th>
                <th className="text-left px-4 py-2 text-xs uppercase tracking-wider font-medium">Officer</th>
              </tr>
            </thead>
            <tbody>
              {shiftRows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 text-slate-700 tabular-nums whitespace-nowrap">
                    {r.hours}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/sites/${r.siteId}`}
                      className="font-medium text-brand-navy hover:text-brand-blue-dark"
                    >
                      {r.site}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{r.account}</td>
                  <td className="px-4 py-2 text-slate-600">{r.who}</td>
                </tr>
              ))}
              {shiftRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No static guarding shifts on this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
