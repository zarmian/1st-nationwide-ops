import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import { addRecurringCharge } from "./_actions";
import { RecurringActions } from "./_components/RecurringActions";

export const dynamic = "force-dynamic";

const CADENCE_LABEL: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
  ONE_OFF: "One-off",
};

export default async function RecurringChargesPage() {
  await requireAdmin();
  const [charges, customers] = await Promise.all([
    prisma.recurringCharge.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      include: { customer: { select: { name: true } } },
    }),
    prisma.customer.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="section">
      <PageHeader
        title="Recurring charges"
        backHref="/finance"
        backLabel="Finance"
        subtitle="Standing charges billed on a cadence — retainers, subscriptions, setup fees. Each due period lands on the customer's next invoice automatically."
      />

      <form action={addRecurringCharge} className="card p-4 space-y-3">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label" htmlFor="customerId">
              Customer
            </label>
            <select
              id="customerId"
              name="customerId"
              className="input"
              required
            >
              <option value="">— pick —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="label" htmlFor="description">
              Description
            </label>
            <input
              id="description"
              name="description"
              className="input"
              placeholder="e.g. Keyholding retainer"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="amount">
              Amount (£)
            </label>
            <input
              id="amount"
              name="amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className="input"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="cadence">
              Cadence
            </label>
            <select id="cadence" name="cadence" defaultValue="MONTHLY" className="input">
              {Object.entries(CADENCE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="startDate">
              Start
            </label>
            <input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={todayIso}
              className="input"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="endDate">
              End (optional)
            </label>
            <input id="endDate" name="endDate" type="date" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="service">
              Service (optional)
            </label>
            <input
              id="service"
              name="service"
              className="input"
              placeholder="e.g. KEYHOLDING"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary text-sm">
            Add charge
          </button>
        </div>
      </form>

      {charges.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No recurring charges yet</p>
          <p className="empty-blurb">
            Add a retainer or subscription above; it'll appear on the customer's
            next invoice.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="table-scroll">
            <table className="table-default">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Description</th>
                  <th className="col-num">Amount</th>
                  <th>Cadence</th>
                  <th>From</th>
                  <th>Until</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c) => (
                  <tr key={c.id} className={c.active ? "" : "opacity-60"}>
                    <td className="whitespace-nowrap">{c.customer.name}</td>
                    <td>
                      {c.description}
                      {!c.active && (
                        <span className="chip-slate text-[10px] ml-2">
                          paused
                        </span>
                      )}
                    </td>
                    <td className="col-num">{formatMoney(Number(c.amount))}</td>
                    <td className="whitespace-nowrap">
                      {CADENCE_LABEL[c.cadence] ?? c.cadence}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">
                      {formatDate(c.startDate)}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">
                      {c.endDate ? formatDate(c.endDate) : "—"}
                    </td>
                    <td>
                      <RecurringActions
                        id={c.id}
                        active={c.active}
                        description={c.description}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
