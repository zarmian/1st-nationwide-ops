import { ClipboardList } from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { loadClientActivities } from "@/lib/clientPortal";
import { resolveRange } from "../_range";
import { RangePills } from "../_components/RangePills";
import { ActivityList } from "../_components/ActivityList";
import { ClientHero } from "../_components/ClientHero";
import { Panel } from "../_components/Panel";

export const dynamic = "force-dynamic";

export default async function ClientActivitiesPage({
  searchParams,
}: {
  searchParams: { range?: string; siteId?: string };
}) {
  const me = await requireCustomer();
  const { key, from, to } = resolveRange(searchParams.range);
  const siteId = searchParams.siteId?.trim() || null;

  const [sites, activities] = await Promise.all([
    prisma.site.findMany({
      where: { customerId: me.customerId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    loadClientActivities(me.customerId, { from, to, siteId, limit: 500 }),
  ]);

  return (
    <div className="space-y-5">
      <ClientHero
        eyebrow="Activity"
        title="Security activity log"
        subtitle="Every attended activity recorded across your sites."
      >
        <RangePills
          active={key}
          basePath="/client/activities"
          extra={siteId ? { siteId } : undefined}
          dark
        />
      </ClientHero>

      <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200/70 bg-white p-3 shadow-card">
        <input type="hidden" name="range" value={key} />
        <div>
          <label className="label" htmlFor="siteId">
            Filter by site
          </label>
          <select
            id="siteId"
            name="siteId"
            defaultValue={siteId ?? ""}
            className="input"
          >
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

      <Panel
        title="Activity"
        hint={`${activities.length} ${
          activities.length === 1 ? "activity" : "activities"
        } in this period`}
        icon={ClipboardList}
        accent="blue"
        flush
      >
        <ActivityList activities={activities} />
      </Panel>
    </div>
  );
}
