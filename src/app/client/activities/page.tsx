import { ClipboardList, Download } from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  ACTIVITY_GROUPS,
  isActivityGroup,
  loadClientActivities,
} from "@/lib/clientPortal";
import { formatMoney } from "@/lib/numbers";
import { resolveRange } from "../_range";
import { RangePills } from "../_components/RangePills";
import { ActivityList } from "../_components/ActivityList";
import { ClientHero } from "../_components/ClientHero";
import { Panel } from "../_components/Panel";

export const dynamic = "force-dynamic";

export default async function ClientActivitiesPage({
  searchParams,
}: {
  searchParams: { range?: string; siteId?: string; type?: string };
}) {
  const me = await requireCustomer();
  const { key, from, to } = resolveRange(searchParams.range);
  const siteId = searchParams.siteId?.trim() || null;
  const group = isActivityGroup(searchParams.type) ? searchParams.type : null;

  const [sites, activities] = await Promise.all([
    prisma.site.findMany({
      where: { customerId: me.customerId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    loadClientActivities(me.customerId, { from, to, siteId, group, limit: 500 }),
  ]);
  const total = activities.reduce((n, a) => n + (a.charge ?? 0), 0);

  const query = new URLSearchParams({ range: key });
  if (siteId) query.set("siteId", siteId);
  if (group) query.set("type", group);

  return (
    <div className="space-y-5">
      <ClientHero
        eyebrow="Activity"
        title="Security activity log"
        subtitle="Every activity at your sites, with its charge. Open one to see the officer's report."
      >
        <RangePills
          active={key}
          basePath="/client/activities"
          extra={{
            ...(siteId ? { siteId } : {}),
            ...(group ? { type: group } : {}),
          }}
          dark
        />
      </ClientHero>

      <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200/70 bg-white p-3 shadow-card">
        <input type="hidden" name="range" value={key} />
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
        <div>
          <label className="label" htmlFor="type">
            Type
          </label>
          <select id="type" name="type" defaultValue={group ?? ""} className="input">
            <option value="">All types</option>
            {ACTIVITY_GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary text-sm">
          Apply
        </button>
      </form>

      <Panel
        title="Activity"
        hint={`${activities.length} ${
          activities.length === 1 ? "activity" : "activities"
        } in this period · ${formatMoney(total)} ex VAT`}
        icon={ClipboardList}
        accent="blue"
        flush
        action={
          activities.length > 0 ? (
            <a
              href={`/client/download/activities?${query.toString()}`}
              className="btn-secondary text-sm"
              download
            >
              <Download size={14} aria-hidden />
              CSV
            </a>
          ) : undefined
        }
      >
        <ActivityList activities={activities} />
      </Panel>
    </div>
  );
}
