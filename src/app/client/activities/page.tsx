import { requireCustomer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { loadClientActivities } from "@/lib/clientPortal";
import { resolveRange } from "../_range";
import { RangePills } from "../_components/RangePills";
import { ActivityList } from "../_components/ActivityList";

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
    <div className="section">
      <PageHeader
        title="Activity"
        subtitle="Every security activity recorded across your sites."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <RangePills
          active={key}
          basePath="/client/activities"
          extra={siteId ? { siteId } : undefined}
        />
        <form className="flex items-end gap-2">
          <input type="hidden" name="range" value={key} />
          <div>
            <label className="label" htmlFor="siteId">
              Site
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
          <button type="submit" className="btn-secondary text-sm">
            Apply
          </button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-xs text-slate-500">
            {activities.length} {activities.length === 1 ? "activity" : "activities"}{" "}
            in this period
          </p>
        </div>
        <ActivityList activities={activities} />
      </div>
    </div>
  );
}
