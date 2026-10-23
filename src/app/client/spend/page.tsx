import Link from "next/link";
import { PoundSterling, CalendarDays, Building2, TrendingUp, Receipt, FileDown } from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import { BarList } from "@/components/BarList";
import { formatMoney, formatNumber } from "@/lib/numbers";
import { formatDate } from "@/lib/dates";
import {
  loadClientInvoices,
  loadClientOverview,
  type ClientInvoice,
} from "@/lib/clientPortal";
import {
  bucketParams,
  periodHref,
  resolvePeriod,
  type PeriodSearch,
} from "@/lib/clientPeriod";
import { PeriodControl } from "../_components/PeriodControl";
import { PeriodBars } from "../_components/PeriodBars";
import { ClientHero } from "../_components/ClientHero";
import { StatCard } from "../_components/StatCard";
import { Panel } from "../_components/Panel";

export const dynamic = "force-dynamic";

export default async function ClientSpendPage({ searchParams }: { searchParams: PeriodSearch }) {
  const me = await requireCustomer();
  const period = resolvePeriod(searchParams);
  const { from, to, bucket } = period;
  const [data, invoices] = await Promise.all([
    loadClientOverview(me.customerId, { from, to, bucket }),
    loadClientInvoices(me.customerId, { from, to }),
  ]);
  const p = period.params;
  const bucketHref = (key: string) =>
    periodHref("/client/activities", bucketParams(period, key));

  const periods = data.byPeriod.length || 1;
  const avgPerPeriod = data.totalSpend / periods;
  const sitesBilled = data.spendBySite.filter((s) => s.amount > 0).length;
  const periodWord =
    bucket === "month" ? "month" : bucket === "week" ? "week" : "day";

  return (
    <div className="space-y-5">
      <ClientHero
        eyebrow="Charges"
        title="What you've been charged"
        subtitle={`Security work charged to your account, by period and by site, and your invoices — ${period.label}. Figures exclude VAT unless marked.`}
      >
        <PeriodControl basePath="/client/spend" period={period} />
      </ClientHero>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          tone="emerald"
          label="Total charged"
          value={formatMoney(data.totalSpend)}
          hint="see each activity's charge"
          icon={PoundSterling}
          href={periodHref("/client/activities", p)}
        />
        <StatCard
          tone="blue"
          label={`Avg / ${periodWord}`}
          value={formatMoney(avgPerPeriod)}
          hint={`across ${formatNumber(periods)} ${periodWord}s`}
          icon={CalendarDays}
        />
        <StatCard
          tone="indigo"
          label="Sites charged"
          value={formatNumber(sitesBilled)}
          hint="had charged work"
          icon={Building2}
          href={periodHref("/client/sites", p)}
        />
      </div>

      {data.byPeriod.length >= 2 && data.totalSpend > 0 && (
        <Panel
          title="Charges over time"
          hint="Click a bar to see the activities behind it"
          icon={TrendingUp}
          accent="emerald"
        >
          <PeriodBars
            tone="emerald"
            data={data.byPeriod.map((b) => ({
              label: b.label,
              short: b.short,
              value: b.charged,
              display: formatMoney(b.charged),
              href: bucketHref(b.key),
            }))}
            ariaLabel="Charges per period"
          />
        </Panel>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title="By site" hint="Highest first" icon={Building2} accent="blue">
          <BarList
            tone="blue"
            items={data.spendBySite.map((s) => ({
              label: s.siteName,
              value: s.amount,
              display: formatMoney(s.amount),
              href: periodHref(`/client/sites/${s.siteId}`, p),
            }))}
            emptyLabel="Nothing charged in this period."
          />
        </Panel>
        <Panel title="By period" icon={CalendarDays} accent="indigo" flush>
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Period</th>
                  <th className="col-num">Charged</th>
                </tr>
              </thead>
              <tbody>
                {data.byPeriod.map((b) => (
                  <tr key={b.key}>
                    <td className="whitespace-nowrap">
                      <Link
                        href={bucketHref(b.key)}
                        className="font-medium text-brand-navy hover:text-brand-blue-dark"
                      >
                        {b.label}
                      </Link>
                    </td>
                    <td className="col-num tabular-nums text-slate-700">
                      {formatMoney(b.charged)}
                    </td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="text-brand-navy">Total</td>
                  <td className="col-num tabular-nums text-brand-navy">
                    {formatMoney(data.totalSpend)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel
        title="Invoices"
        hint="For work in this period · totals include VAT"
        icon={Receipt}
        accent="amber"
        flush
      >
        <InvoiceTable invoices={invoices} />
      </Panel>
    </div>
  );
}

const STATE_CHIP: Record<ClientInvoice["state"], string> = {
  Paid: "chip-green",
  Overdue: "chip-red",
  Unpaid: "chip-amber",
};

function InvoiceTable({ invoices }: { invoices: ClientInvoice[] }) {
  if (invoices.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-slate-500">No invoices for this period.</p>
    );
  }
  return (
    <div className="table-scroll">
      <table className="table-default">
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Period</th>
            <th>Issued</th>
            <th>Due</th>
            <th className="col-num">Total</th>
            <th>Status</th>
            <th>
              <span className="sr-only">Download</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id}>
              <td className="font-medium text-brand-navy">{inv.number}</td>
              <td className="whitespace-nowrap text-slate-700">
                {formatDate(inv.periodFrom)} – {formatDate(inv.periodTo)}
              </td>
              <td className="whitespace-nowrap text-slate-700">{formatDate(inv.issuedAt)}</td>
              <td className="whitespace-nowrap text-slate-700">{formatDate(inv.dueAt)}</td>
              <td className="col-num tabular-nums text-slate-700">{formatMoney(inv.total)}</td>
              <td className="whitespace-nowrap">
                <span className={STATE_CHIP[inv.state]}>{inv.state}</span>
                {inv.state !== "Paid" && inv.balance < inv.total && (
                  <span className="ml-2 text-xs text-slate-500">
                    {formatMoney(inv.balance)} left
                  </span>
                )}
              </td>
              <td className="text-right">
                <a
                  href={`/client/download/invoice/${inv.id}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand-blue-dark hover:underline"
                  download
                  aria-label={`Download invoice ${inv.number} (PDF)`}
                >
                  <FileDown size={14} aria-hidden />
                  PDF
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
