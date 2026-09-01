import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { createCreditNoteAction } from "../_actions";

export const dynamic = "force-dynamic";

export default async function NewCreditNotePage({
  searchParams,
}: {
  searchParams: { customerId?: string; invoiceId?: string; error?: string };
}) {
  await requireAdmin();

  const invoiceId = searchParams.invoiceId?.trim() || null;
  const invoice = invoiceId
    ? await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, number: true, customerId: true, total: true },
      })
    : null;

  const presetCustomerId = invoice?.customerId ?? searchParams.customerId ?? "";
  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="section">
      <PageHeader
        title="New credit note"
        backHref="/finance/credit-notes"
        backLabel="Credit notes"
        subtitle={
          invoice
            ? `Crediting against invoice ${invoice.number}`
            : "Reduce what a customer owes — correction, dispute or goodwill."
        }
      />

      {searchParams.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {searchParams.error}
        </div>
      )}

      <form action={createCreditNoteAction} className="card p-5 space-y-4 max-w-xl">
        {invoice ? (
          <input type="hidden" name="invoiceId" value={invoice.id} />
        ) : null}

        <div>
          <label className="label" htmlFor="customerId">
            Customer
          </label>
          {invoice ? (
            <>
              <input type="hidden" name="customerId" value={presetCustomerId} />
              <p className="input bg-slate-50 text-slate-700">
                {customers.find((c) => c.id === presetCustomerId)?.name ?? "—"}
              </p>
            </>
          ) : (
            <select
              id="customerId"
              name="customerId"
              defaultValue={presetCustomerId}
              className="input"
              required
            >
              <option value="">Pick a customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="net">
              Credit amount (net, before VAT)
            </label>
            <input
              id="net"
              name="net"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className="input"
              placeholder="0.00"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="vatRate">
              VAT rate
            </label>
            <select id="vatRate" name="vatRate" defaultValue="0.2" className="input">
              <option value="0.2">20% (standard)</option>
              <option value="0.05">5% (reduced)</option>
              <option value="0">0% / no VAT</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="reason">
            Reason
          </label>
          <input
            id="reason"
            name="reason"
            type="text"
            className="input"
            placeholder="e.g. Patrol not carried out on 12 Aug — credited"
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="notes">
            Notes
          </label>
          <input
            id="notes"
            name="notes"
            type="text"
            className="input"
            placeholder="Optional"
          />
        </div>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary text-sm">
            Create credit note
          </button>
        </div>
      </form>
    </div>
  );
}
