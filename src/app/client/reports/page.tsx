import { CalendarDays, FileDown, FileText } from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import { loadClientActivities } from "@/lib/clientPortal";
import { ukDayPlus, ukDayString } from "@/lib/dates";
import { FLOOR_DAY, resolvePeriod, type PeriodSearch } from "@/lib/clientPeriod";
import { PeriodControl } from "../_components/PeriodControl";
import { ActivityList } from "../_components/ActivityList";
import { ClientHero } from "../_components/ClientHero";
import { Panel } from "../_components/Panel";

export const dynamic = "force-dynamic";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default async function ClientReportsPage({ searchParams }: { searchParams: PeriodSearch }) {
  const me = await requireCustomer();
  const period = resolvePeriod(searchParams);
  const { from, to } = period;
  const activities = (
    await loadClientActivities(me.customerId, { from, to, limit: 2000 })
  ).filter((a) => a.hasReport);

  const today = ukDayString(new Date());
  const y = ukDayPlus(new Date(), -1);
  const yesterday = `${y.year}-${pad(y.month)}-${pad(y.day)}`;

  return (
    <div className="space-y-5">
      <ClientHero
        eyebrow="Reports"
        title="Reports"
        subtitle="The daily report for any day, and every officer report from your sites."
      >
        <PeriodControl basePath="/client/reports" period={period} />
      </ClientHero>

      <Panel
        title="Daily report"
        hint="Callouts, lock-ups, unlocks and static guarding for one day (PDF)"
        icon={CalendarDays}
        accent="indigo"
      >
        <form
          action="/client/download/daily-report"
          method="get"
          className="flex flex-wrap items-end gap-2"
        >
          <div>
            <label className="label" htmlFor="report-date">
              Day
            </label>
            <input
              id="report-date"
              name="date"
              type="date"
              min={FLOOR_DAY}
              max={today}
              defaultValue={yesterday}
              required
              className="input"
            />
          </div>
          <button type="submit" className="btn-primary text-sm">
            <FileDown size={14} aria-hidden />
            Download PDF
          </button>
        </form>
      </Panel>

      <Panel
        title="Officer reports"
        hint={`${activities.length} ${
          activities.length === 1 ? "activity" : "activities"
        } with a report — ${period.label}`}
        icon={FileText}
        accent="emerald"
        flush
      >
        <ActivityList
          activities={activities}
          emptyLabel="No officer reports in this period."
        />
      </Panel>
    </div>
  );
}
