import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney } from "@/lib/numbers";
import { formatDate, parseIsoDate, toIsoDate } from "@/lib/dates";
import {
  loadPartnerStatement,
  type StatementSide,
} from "@/lib/partnerStatement";

export const dynamic = "force-dynamic";

function SideTable({ title, side }: { title: string; side: StatementSide }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          {title}
        </div>
      </div>
      {side.lines.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500 text-center">Nothing.</p>
      ) : (
        <table className="table-default">
          <thead>
            <tr>
              <th>Service</th>
              <th className="col-num">Qty</th>
              <th className="col-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {side.lines.map((l, i) => (
              <tr key={i}>
                <td>{l.service}</td>
                <td className="col-num">{l.quantity}</td>
                <td className="col-num">{formatMoney(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="px-4 py-2 font-medium text-brand-navy">Total</td>
              <td className="col-num text-slate-500">{side.count}</td>
              <td className="col-num font-semibold text-brand-navy">
                {formatMoney(side.total)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}

export default async function PartnerStatementPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { from?: string; to?: string };
}) {
  await requireAdmin();

  const now = new Date();
  const from =
    parseIsoDate(searchParams.from) ??
    new Date(now.getFullYear(), now.getMonth(), 1);
  const to = parseIsoDate(searchParams.to, true) ?? now;

  const st = await loadPartnerStatement(params.id, from, to);
  if (!st) notFound();

  const netLabel =
    st.net > 0
      ? `${st.partnerName} owes us`
      : st.net < 0
        ? `We owe ${st.partnerName}`
        : "Settled";
  const netTone =
    st.net > 0 ? "text-emerald-700" : st.net < 0 ? "text-red-700" : "text-slate-600";

  const pdfHref = `/api/partners/${params.id}/statement/pdf?from=${toIsoDate(
    from,
  )}&to=${toIsoDate(to)}`;

  return (
    <div className="section">
      <PageHeader
        title={`${st.partnerName} — statement`}
        backHref={`/finance/partners/${params.id}`}
        backLabel="Partner"
        subtitle={
          <>
            {formatDate(st.from)} – {formatDate(st.to)}
          </>
        }
        actions={
          <a href={pdfHref} className="btn-secondary text-sm">
            Download PDF
          </a>
        }
      />

      <form className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="from">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={toIsoDate(from)}
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="to">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={toIsoDate(to)}
            className="input"
          />
        </div>
        <button type="submit" className="btn-secondary text-sm">
          Apply
        </button>
      </form>

      <div className="card-accent p-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="kpi-label">Net position</div>
          <div className={`text-3xl font-semibold tabular-nums ${netTone}`}>
            {formatMoney(Math.abs(st.net))}
          </div>
          <div className="kpi-hint">{netLabel}</div>
        </div>
        <div className="text-sm text-slate-500 text-right">
          <div>
            They owe us{" "}
            <span className="tabular-nums text-brand-navy">
              {formatMoney(st.theyOweUs.total)}
            </span>
          </div>
          <div>
            We owe them{" "}
            <span className="tabular-nums text-brand-navy">
              {formatMoney(st.weOweThem.total)}
            </span>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <SideTable title="They owe us — we worked for them" side={st.theyOweUs} />
        <SideTable title="We owe them — they worked for us" side={st.weOweThem} />
      </div>
    </div>
  );
}
