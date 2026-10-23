import Link from "next/link";
import { ClipboardList, Download } from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { groupLabel, isActivityGroup, loadClientActivityLog } from "@/lib/clientPortal";
import { periodHref, resolvePeriod, type PeriodSearch } from "@/lib/clientPeriod";
import { formatHours, formatMoney, formatNumber } from "@/lib/numbers";
import { PeriodControl } from "../_components/PeriodControl";
import { ActivityList } from "../_components/ActivityList";
import { ClientHero } from "../_components/ClientHero";
import { Panel } from "../_components/Panel";
import { GroupDot } from "../_components/groupColors";
import { groupAmount } from "../_components/TypeTable";

export const dynamic = "force-dynamic";

const LIMIT = 500;

export default async function ClientActivitiesPage({
  searchParams,
}: {
  searchParams: PeriodSearch & { siteId?: string; type?: string };
}) {
  const me = await requireCustomer();
  const period = resolvePeriod(searchParams);
  const siteId = searchParams.siteId?.trim() || null;
  const group = isActivityGroup(searchParams.type) ? searchParams.type : null;

  const [sites, log] = await Promise.all([
    prisma.site.findMany({
      where: { customerId: me.customerId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    loadClientActivityLog(me.customerId, {
      from: period.from,
      to: period.to,
      siteId,
      group,
      limit: LIMIT,
    }),
  ]);
  const site = siteId ? sites.find((s) => s.id === siteId) ?? null : null;
  const all = log.groups.reduce((n, g) => n + g.count, 0);
  const typeHref = (type: string | null) =>
    periodHref("/client/activities", period.params, { siteId, type });

  const summary = [
    `${formatNumber(log.count)} ${
      group === "guarding"
        ? log.count === 1
          ? "shift"
          : "shifts"
        : log.count === 1
          ? "activity"
          : "activities"
    }`,
    group === "guarding" ? formatHours(log.hours) : null,
    `${formatMoney(log.charged)} ex VAT`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-5">
      <ClientHero
        eyebrow="Activity"
        title="Security activity log"
        subtitle={`Every activity at your sites, with its charge — ${period.label}. Open one to see the officer's report.`}
      >
        <PeriodControl
          basePath="/client/activities"
          period={period}
          keep={{ siteId, type: group }}
        />
      </ClientHero>

      <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-white p-3 shadow-card">
        <form className="flex flex-wrap items-end gap-2">
          {Object.entries(period.params).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {group && <input type="hidden" name="type" value={group} />}
          <div>
            <label className="label" htmlFor="siteId">
              Site
            </label>
            <select id="siteId" name="siteId" defaultValue={siteId ?? ""} className="input">
              <option value="">All sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code ? `${s.code} · ` : ""}
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-primary text-sm">
            Apply
          </button>
        </form>

        <nav aria-label="Type of work" className="flex flex-wrap gap-1.5">
          <Link
            href={typeHref(null)}
            aria-current={group ? undefined : "true"}
            className={group ? "pill-idle" : "pill-active"}
          >
            All
            <span className="tabular-nums text-slate-500">{formatNumber(all)}</span>
          </Link>
          {log.groups
            .filter((g) => g.count > 0 || g.group === group)
            .map((g) => (
              <Link
                key={g.group}
                href={typeHref(g.group)}
                aria-current={g.group === group ? "true" : undefined}
                className={g.group === group ? "pill-active" : "pill-idle"}
              >
                <GroupDot group={g.group} />
                {groupLabel(g.group)}
                <span className="tabular-nums text-slate-500">{groupAmount(g)}</span>
              </Link>
            ))}
        </nav>
      </div>

      <Panel
        title={
          [group ? groupLabel(group) : "Activity", site?.name].filter(Boolean).join(" · ")
        }
        hint={summary}
        icon={ClipboardList}
        accent="blue"
        flush
        action={
          log.count > 0 ? (
            <a
              href={periodHref("/client/download/activities", period.params, {
                siteId,
                type: group,
              })}
              className="btn-secondary text-sm"
              download
            >
              <Download size={14} aria-hidden />
              CSV
            </a>
          ) : undefined
        }
      >
        <ActivityList activities={log.activities} />
        {log.count > log.activities.length && (
          <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Showing the latest {formatNumber(log.activities.length)} of {formatNumber(log.count)}.
            The CSV has them all.
          </p>
        )}
      </Panel>
    </div>
  );
}
