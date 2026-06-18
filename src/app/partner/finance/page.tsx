import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { BarList } from "@/components/BarList";

export const dynamic = "force-dynamic";

const SERVICE_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCK: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  KEY_COLLECTION: "Key collection",
  KEY_DROPOFF: "Key drop-off",
  SURVEY: "Survey",
  ADHOC: "Ad-hoc",
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
};

function fmtMoney(n: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n);
}

function parseLocalDate(s: string | undefined, end = false): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    end ? 23 : 0,
    end ? 59 : 0,
    end ? 59 : 0,
    end ? 999 : 0,
  );
}

function ymd(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", { timeZone: "Europe/London" });
}

/**
 * Partner-portal finance dashboard.
 *
 * Counts the partner's own perspective:
 *   - Billed to 1NW          sum of chargeToUs across the range
 *   - Paid to officers       sum of payToOfficer across the range
 *   - Margin                  difference (their gross take)
 *   - Per-officer breakdown   total pay + activities per partner-officer
 *   - Per-customer breakdown  total charge per 1NW customer
 *   - Per-service breakdown   total charge per service kind
 *
 * Only counts activities the partner recorded themselves (jobs +
 * shifts with recordedByPartner = true). Jobs we *sent* them but
 * they haven't yet logged with a rate are excluded — those need to
 * be backfilled via /partner/activities anyway.
 */
export default async function PartnerFinancePage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const me = await requirePartner();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  const fromDate = parseLocalDate(searchParams.from) ?? monthStart;
  const toDate = parseLocalDate(searchParams.to, true) ?? monthEnd;

  const [jobs, shifts] = await Promise.all([
    prisma.job.findMany({
      where: {
        handledByPartnerId: me.partnerId,
        recordedByPartner: true,
        status: { not: "CANCELLED" },
        OR: [
          { completedAt: { gte: fromDate, lte: toDate } },
          { scheduledFor: { gte: fromDate, lte: toDate } },
        ],
      },
      select: {
        type: true,
        partnerChargeToUsAmount: true,
        partnerOfficerPayAmount: true,
        handledByPartnerOfficer: { select: { id: true, name: true } },
        customer: { select: { id: true, name: true } },
      },
    }),
    prisma.shift.findMany({
      where: {
        handledByPartnerId: me.partnerId,
        recordedByPartner: true,
        actualStartedAt: { gte: fromDate, lte: toDate },
      },
      select: {
        type: true,
        partnerChargeToUsAmount: true,
        partnerOfficerPayAmount: true,
        handledByPartnerOfficer: { select: { id: true, name: true } },
        site: { select: { customer: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  type Bucketed = {
    activities: number;
    chargeToUs: number;
    payToOfficer: number;
  };

  const empty = (): Bucketed => ({ activities: 0, chargeToUs: 0, payToOfficer: 0 });
  const byOfficer = new Map<string, Bucketed & { name: string; id: string }>();
  const byCustomer = new Map<string, Bucketed & { name: string; id: string }>();
  const byService = new Map<string, Bucketed & { label: string }>();
  const totals: Bucketed = empty();

  function add(
    map: Map<string, Bucketed & Record<string, any>>,
    key: string,
    extras: Record<string, any>,
    charge: number,
    pay: number,
  ) {
    const row =
      map.get(key) ?? ({ ...empty(), ...extras } as Bucketed & Record<string, any>);
    row.activities += 1;
    row.chargeToUs += charge;
    row.payToOfficer += pay;
    map.set(key, row);
  }

  for (const j of jobs) {
    const charge = Number(j.partnerChargeToUsAmount ?? 0);
    const pay = Number(j.partnerOfficerPayAmount ?? 0);
    totals.activities += 1;
    totals.chargeToUs += charge;
    totals.payToOfficer += pay;
    const officerId = j.handledByPartnerOfficer?.id ?? "__unassigned";
    add(
      byOfficer,
      officerId,
      {
        id: officerId,
        name: j.handledByPartnerOfficer?.name ?? "Unassigned",
      },
      charge,
      pay,
    );
    if (j.customer) {
      add(
        byCustomer,
        j.customer.id,
        { id: j.customer.id, name: j.customer.name },
        charge,
        pay,
      );
    }
    const service = j.type;
    add(
      byService,
      service,
      { label: SERVICE_LABEL[service] ?? service.replace(/_/g, " ") },
      charge,
      pay,
    );
  }
  for (const s of shifts) {
    const charge = Number(s.partnerChargeToUsAmount ?? 0);
    const pay = Number(s.partnerOfficerPayAmount ?? 0);
    totals.activities += 1;
    totals.chargeToUs += charge;
    totals.payToOfficer += pay;
    const officerId = s.handledByPartnerOfficer?.id ?? "__unassigned";
    add(
      byOfficer,
      officerId,
      {
        id: officerId,
        name: s.handledByPartnerOfficer?.name ?? "Unassigned",
      },
      charge,
      pay,
    );
    if (s.site?.customer) {
      add(
        byCustomer,
        s.site.customer.id,
        { id: s.site.customer.id, name: s.site.customer.name },
        charge,
        pay,
      );
    }
    const service = s.type;
    add(
      byService,
      service,
      { label: SERVICE_LABEL[service] ?? service.replace(/_/g, " ") },
      charge,
      pay,
    );
  }

  const officerRows = Array.from(byOfficer.values()).sort(
    (a, b) => b.chargeToUs - a.chargeToUs,
  );
  const customerRows = Array.from(byCustomer.values()).sort(
    (a, b) => b.chargeToUs - a.chargeToUs,
  );
  const serviceRows = Array.from(byService.values()).sort(
    (a, b) => b.chargeToUs - a.chargeToUs,
  );

  const margin = totals.chargeToUs - totals.payToOfficer;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance"
        subtitle={`Your invoiced + paid totals, ${fmtDate(fromDate)} → ${fmtDate(toDate)}.`}
        actions={
          <form className="flex items-end gap-2" method="GET">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
                From
              </label>
              <input
                type="date"
                name="from"
                defaultValue={ymd(fromDate)}
                className="input text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-500 mb-0.5">
                To
              </label>
              <input
                type="date"
                name="to"
                defaultValue={ymd(toDate)}
                className="input text-sm"
              />
            </div>
            <button type="submit" className="btn-secondary text-sm">
              Apply
            </button>
          </form>
        }
      />

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card-accent p-4">
          <div className="kpi-label">Billed to 1NW</div>
          <div className="kpi-value">{fmtMoney(totals.chargeToUs)}</div>
          <div className="kpi-hint">
            {totals.activities} activities in range
          </div>
        </div>
        <div className="kpi p-4">
          <div className="kpi-label">Paid to officers</div>
          <div className="kpi-value">{fmtMoney(totals.payToOfficer)}</div>
          <div className="kpi-hint">your officer-side cost</div>
        </div>
        <div className="kpi p-4">
          <div className="kpi-label">Margin</div>
          <div
            className={
              "kpi-value " + (margin >= 0 ? "text-brand-navy" : "text-red-600")
            }
          >
            {fmtMoney(margin)}
          </div>
          <div className="kpi-hint">
            {totals.chargeToUs > 0
              ? `${Math.round((margin / totals.chargeToUs) * 100)}% of billed`
              : "—"}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">By your officer</h2>
            <p className="text-xs text-slate-500">
              Activities + pay per officer in range
            </p>
          </div>
          {officerRows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              No activities in range.
            </p>
          ) : (
            <table className="table-default">
              <thead>
                <tr>
                  <th>Officer</th>
                  <th className="col-num">Activities</th>
                  <th className="col-num">Their pay</th>
                </tr>
              </thead>
              <tbody>
                {officerRows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium text-brand-navy">{r.name}</td>
                    <td className="col-num">{r.activities}</td>
                    <td className="col-num">{fmtMoney(r.payToOfficer)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-medium">
                  <td className="text-slate-600">Total</td>
                  <td className="col-num">{totals.activities}</td>
                  <td className="col-num">{fmtMoney(totals.payToOfficer)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">By 1NW customer</h2>
            <p className="text-xs text-slate-500">
              Which customer drove what billing
            </p>
          </div>
          <BarList
            tone="navy"
            items={customerRows.map((r) => ({
              label: r.name,
              hint: `${r.activities} ${r.activities === 1 ? "activity" : "activities"}`,
              value: r.chargeToUs,
              display: fmtMoney(r.chargeToUs),
            }))}
            emptyLabel="No activities in range."
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">By service</h2>
          <p className="text-xs text-slate-500">
            Billed to 1NW broken out by service type
          </p>
        </div>
        <BarList
          items={serviceRows.map((r) => ({
            label: r.label,
            hint: `${r.activities} ${r.activities === 1 ? "activity" : "activities"}`,
            value: r.chargeToUs,
            display: fmtMoney(r.chargeToUs),
          }))}
          emptyLabel="No activities in range."
        />
      </div>

      <p className="text-xs text-slate-500">
        Counts only activities you've recorded yourself. Jobs 1NW sent
        you that you haven't yet logged with a rate aren't counted —
        record them at{" "}
        <Link
          href="/partner/activities/new"
          className="text-brand-blue-dark hover:underline"
        >
          /partner/activities/new
        </Link>{" "}
        to include them.
      </p>
    </div>
  );
}
