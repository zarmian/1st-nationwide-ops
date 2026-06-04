import Link from "next/link";
import { prisma } from "@/lib/db";
import { upsertOfficerRate, deleteOfficerRate } from "./_actions";
import { RateForm } from "./_components/RateForm";
import { DeleteRateButton } from "./_components/DeleteButton";

export const dynamic = "force-dynamic";

const SERVICE_LABEL: Record<string, string> = {
  ALARM_RESPONSE: "Alarm response",
  PATROL: "Patrol",
  LOCKUP: "Lock-up",
  UNLOCK: "Unlock",
  VPI: "VPI",
  KEYHOLDING: "Keyholding",
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
  ADHOC: "Ad-hoc",
  ANNUAL_SUBSCRIPTION: "Monthly retainer",
  SITE_SETUP: "Site setup",
};

function fmtMoney(amount: unknown, currency: string): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n);
}

export default async function OfficerRatesPage() {
  const [defaults, perOfficer, officers] = await Promise.all([
    prisma.officerRate.findMany({
      where: { officerId: null },
      orderBy: { service: "asc" },
    }),
    prisma.officerRate.findMany({
      where: { officerId: { not: null } },
      orderBy: [{ officerId: "asc" }, { service: "asc" }],
      include: { officer: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="section">
      <div>
        <Link
          href="/admin"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          Officer pay rates
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          Company defaults apply to all officers unless a per-officer override
          exists for the same service. Monthly retainer = the standing charge
          paid regardless of activity (use service "Monthly retainer", unit
          "per month").
        </p>
      </div>

      <RateForm action={upsertOfficerRate} officers={officers} />

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">Company defaults</h2>
          <p className="text-xs text-slate-500">
            Apply to every officer unless overridden below.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Service
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Amount
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Unit
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Notes
              </th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {defaults.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">{SERVICE_LABEL[r.service] ?? r.service}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-brand-navy">
                  {fmtMoney(r.amount, r.currency)}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {r.unit.toLowerCase().replace("_", " ")}
                </td>
                <td className="px-4 py-2 text-slate-500 text-xs">
                  {r.notes ?? "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <DeleteRateButton id={r.id} remove={deleteOfficerRate} />
                </td>
              </tr>
            ))}
            {defaults.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500 text-sm">
                  No company defaults yet. Add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">Per-officer overrides</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Officer
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Service
              </th>
              <th className="text-right px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Amount
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Unit
              </th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {perOfficer.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 font-medium text-brand-navy">
                  {r.officer?.name ?? "—"}
                </td>
                <td className="px-4 py-2">{SERVICE_LABEL[r.service] ?? r.service}</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium text-brand-navy">
                  {fmtMoney(r.amount, r.currency)}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {r.unit.toLowerCase().replace("_", " ")}
                </td>
                <td className="px-4 py-2 text-right">
                  <DeleteRateButton id={r.id} remove={deleteOfficerRate} />
                </td>
              </tr>
            ))}
            {perOfficer.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-500 text-sm">
                  No per-officer overrides yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
