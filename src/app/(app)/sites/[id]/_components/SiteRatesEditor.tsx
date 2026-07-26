"use client";

import Link from "next/link";
import { RateCardForm, type RateFormState } from "@/components/RateCardForm";
import { DeleteRateButton } from "@/components/DeleteRateButton";
import { SERVICE_LABEL, UNIT_LABEL, fmtMoney } from "@/lib/rateMeta";

export type EffectiveRateRow = {
  service: string;
  amount: number | null;
  currency: string;
  unit: string | null;
  source: "site" | "customer" | "none";
  overrideId?: string;
};

const TH =
  "px-4 py-2 font-medium uppercase tracking-wider text-xs text-slate-600";

/**
 * Per-site rate editor. Shows the *effective* rate for every service (site
 * override, else the customer's default, else unset), lets an admin add /
 * override a site rate, and remove an override to fall back to the default.
 */
export function SiteRatesEditor({
  effective,
  upsert,
  remove,
  customerName,
  customerRatesHref,
}: {
  effective: EffectiveRateRow[];
  upsert: (s: RateFormState, fd: FormData) => Promise<RateFormState>;
  remove: (id: string) => Promise<{ ok: boolean }>;
  customerName: string | null;
  customerRatesHref: string | null;
}) {
  return (
    <div className="section">
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-brand-navy">Effective rates</h2>
            <p className="text-xs text-slate-500">
              What we bill per service at this site. Site overrides win;
              everything else inherits{" "}
              {customerName ? `${customerName}'s` : "the customer's"} defaults.
            </p>
          </div>
          {customerRatesHref && (
            <Link
              href={customerRatesHref}
              className="btn-ghost text-xs whitespace-nowrap"
            >
              Customer defaults →
            </Link>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className={`text-left ${TH}`}>Service</th>
                <th className={`text-right ${TH}`}>Rate</th>
                <th className={`text-left ${TH}`}>Unit</th>
                <th className={`text-left ${TH}`}>Source</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {effective.map((r) => (
                <tr key={r.service}>
                  <td className="px-4 py-2 text-slate-700">
                    {SERVICE_LABEL[r.service] ?? r.service}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium text-brand-navy">
                    {r.amount != null ? (
                      fmtMoney(r.amount, r.currency)
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {r.unit ? UNIT_LABEL[r.unit] ?? r.unit : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {r.source === "site" ? (
                      <span className="chip-mint text-[10px]">Site</span>
                    ) : r.source === "customer" ? (
                      <span className="chip-slate text-[10px]">
                        Customer default
                      </span>
                    ) : (
                      <span className="text-slate-400 text-xs">Not set</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.source === "site" && r.overrideId ? (
                      <DeleteRateButton
                        id={r.overrideId}
                        remove={remove}
                        label="Remove override"
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-brand-navy mb-2 text-sm">
          Add or override a rate for this site
        </h3>
        <RateCardForm action={upsert} submitLabel="Save site rate" />
      </div>
    </div>
  );
}
