import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney } from "@/lib/numbers";
import { parseIsoDate, toIsoDate } from "@/lib/dates";
import { previewInvoice } from "@/lib/invoicing";
import { COMPANY } from "@/lib/company";
import { createInvoiceAction } from "../_actions";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: {
    customerId?: string;
    from?: string;
    to?: string;
    error?: string;
  };
}) {
  await requireAdmin();
  const customers = await prisma.customer.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const customerId = searchParams.customerId ?? "";
  const now = new Date();
  const from =
    parseIsoDate(searchParams.from) ??
    new Date(now.getFullYear(), now.getMonth(), 1);
  const to = parseIsoDate(searchParams.to, true) ?? now;

  const preview = customerId ? await previewInvoice(customerId, from, to) : null;

  return (
    <div className="section">
      <PageHeader
        title="New invoice"
        backHref="/finance/invoices"
        backLabel="Invoices"
        subtitle="Pick a customer and period, preview the billed activity, then create a draft."
      />

      {searchParams.error && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
        >
          {searchParams.error}
        </div>
      )}

      <form className="card p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label className="label" htmlFor="customerId">
            Customer
          </label>
          <select
            id="customerId"
            name="customerId"
            defaultValue={customerId}
            className="input"
            required
          >
            <option value="">— pick a customer —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
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
          Preview
        </button>
      </form>

      {preview &&
        (preview.lines.length === 0 ? (
          <div className="empty-state">
            <p className="empty-title">Nothing to invoice</p>
            <p className="empty-blurb">
              No billed, un-invoiced activity or recurring charges for{" "}
              {preview.customerName} in this period. (Work already on an invoice
              is skipped; run <span className="font-medium">Bill missing</span>{" "}
              on Finance if activity looks unpriced.)
            </p>
          </div>
        ) : (
          <div className="card p-5 space-y-4">
            <div className="text-sm text-slate-600">
              {preview.activityCount} activities
              {preview.recurringCount > 0
                ? ` + ${preview.recurringCount} recurring`
                : ""}{" "}
              for{" "}
              <span className="font-medium text-brand-navy">
                {preview.customerName}
              </span>
            </div>
            <div className="table-scroll">
              <table className="table-default">
                <thead>
                  <tr>
                    <th>Site</th>
                    <th className="col-num">Activities</th>
                    <th className="col-num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <div className="font-medium text-brand-navy">
                          {l.description}
                        </div>
                        {l.detail && (
                          <div className="text-xs text-slate-500">{l.detail}</div>
                        )}
                      </td>
                      <td className="col-num">{l.quantity}</td>
                      <td className="col-num">{formatMoney(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-end gap-1 text-sm">
              <div className="flex gap-8">
                <span className="text-slate-500">Subtotal</span>
                <span className="tabular-nums">
                  {formatMoney(preview.subtotal)}
                </span>
              </div>
              <div className="flex gap-8">
                <span className="text-slate-500">
                  VAT ({Math.round(preview.vatRate * 100)}%)
                </span>
                <span className="tabular-nums">
                  {formatMoney(preview.vatAmount)}
                </span>
              </div>
              <div className="flex gap-8 text-base font-semibold text-brand-navy">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(preview.total)}</span>
              </div>
            </div>
            <form
              action={createInvoiceAction}
              className="flex items-center justify-end gap-3"
            >
              <input type="hidden" name="customerId" value={customerId} />
              <input type="hidden" name="from" value={toIsoDate(from)} />
              <input type="hidden" name="to" value={toIsoDate(to)} />
              <button type="submit" className="btn-primary text-sm">
                Create draft invoice
              </button>
            </form>
            {!COMPANY.vatNumber && (
              <p className="text-xs text-amber-700">
                Add your VAT number &amp; registered address in{" "}
                <code className="bg-slate-100 px-1 rounded">lib/company.ts</code>{" "}
                before sending — required for a valid VAT invoice.
              </p>
            )}
          </div>
        ))}
    </div>
  );
}
