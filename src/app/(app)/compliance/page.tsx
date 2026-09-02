import Link from "next/link";
import { ShieldAlert, CalendarClock, FileQuestion, ShieldCheck } from "lucide-react";
import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { formatDate } from "@/lib/dates";
import {
  loadComplianceRegister,
  type ComplianceStatus,
  type ComplianceItem,
} from "@/lib/compliance";

export const dynamic = "force-dynamic";

const STATUS: Record<ComplianceStatus, { chip: string; label: string }> = {
  expired: { chip: "chip-red", label: "Expired" },
  missing: { chip: "chip-amber", label: "Not recorded" },
  expiring: { chip: "chip-amber", label: "Expiring" },
  valid: { chip: "chip-green", label: "OK" },
};

const FIXED = ["SIA licence", "Right to work", "DBS"];

function DateCell({ item }: { item: ComplianceItem | undefined }) {
  if (!item) return <td className="text-slate-400">—</td>;
  const tone =
    item.status === "expired"
      ? "text-red-600 font-medium"
      : item.status === "expiring"
        ? "text-amber-700 font-medium"
        : item.status === "missing"
          ? "text-amber-700"
          : "text-slate-600";
  return (
    <td className={"whitespace-nowrap tabular-nums " + tone}>
      {item.date ? formatDate(item.date) : item.note ?? "—"}
    </td>
  );
}

export default async function CompliancePage() {
  await requireAdmin();
  const data = await loadComplianceRegister();

  return (
    <div className="section">
      <PageHeader
        title="Compliance register"
        subtitle="Officer SIA licences, right-to-work, DBS and training — with expiry alerts. Deploying a lapsed licence fails ACS audits and most contracts."
        actions={
          <Link href="/officers" className="btn-secondary text-sm">
            Officers →
          </Link>
        }
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          tone={data.counts.expired > 0 ? "rose" : "emerald"}
          label="Expired"
          value={data.counts.expired.toLocaleString("en-GB")}
          hint="officers with a lapsed item"
          icon={ShieldAlert}
        />
        <StatCard
          tone={data.counts.expiring > 0 ? "amber" : "emerald"}
          label="Expiring soon"
          value={data.counts.expiring.toLocaleString("en-GB")}
          hint="within 30 days"
          icon={CalendarClock}
        />
        <StatCard
          tone={data.counts.missing > 0 ? "amber" : "emerald"}
          label="Not recorded"
          value={data.counts.missing.toLocaleString("en-GB")}
          hint="SIA/DBS gap to fill"
          icon={FileQuestion}
        />
        <StatCard
          tone="emerald"
          label="All clear"
          value={data.counts.ok.toLocaleString("en-GB")}
          hint="fully in date"
          icon={ShieldCheck}
        />
      </div>

      {data.attention.length > 0 && (
        <div className="card overflow-hidden border-amber-200">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Needs attention</h2>
            <p className="text-xs text-slate-500">
              Officers with a lapsed, soon-expiring or unrecorded item.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {data.attention.map((o) => (
              <li key={o.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/officers/${o.id}/edit`}
                    className="font-medium text-brand-navy hover:text-brand-blue-dark"
                  >
                    {o.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {o.items
                      .filter((i) => i.status !== "valid")
                      .map((i, idx) => (
                        <span key={idx} className={STATUS[i.status].chip}>
                          {i.kind}: {STATUS[i.status].label}
                          {i.date ? ` (${formatDate(i.date)})` : ""}
                        </span>
                      ))}
                  </div>
                </div>
                <Link
                  href={`/officers/${o.id}/edit`}
                  className="text-brand-blue-dark hover:underline text-sm whitespace-nowrap shrink-0"
                >
                  Update →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">All officers</h2>
        </div>
        <div className="table-scroll">
          <table className="table-default">
            <thead>
              <tr>
                <th>Officer</th>
                <th>SIA expiry</th>
                <th>Right to work</th>
                <th>DBS checked</th>
                <th>Certificates</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.officers.map((o) => {
                const sia = o.items.find((i) => i.kind === "SIA licence");
                const rtw = o.items.find((i) => i.kind === "Right to work");
                const dbs = o.items.find((i) => i.kind === "DBS");
                const certs = o.items.filter((i) => !FIXED.includes(i.kind));
                const certWorst = certs.some((c) => c.status === "expired")
                  ? "expired"
                  : certs.some((c) => c.status === "expiring")
                    ? "expiring"
                    : null;
                return (
                  <tr key={o.id}>
                    <td>
                      <Link
                        href={`/officers/${o.id}/edit`}
                        className="font-medium text-brand-navy hover:text-brand-blue-dark"
                      >
                        {o.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {o.siaNumber ? (
                          <span className="font-mono">{o.siaNumber}</span>
                        ) : (
                          <span className="text-amber-700">No SIA number</span>
                        )}
                      </div>
                    </td>
                    <DateCell item={sia} />
                    <DateCell item={rtw} />
                    <DateCell item={dbs} />
                    <td className="whitespace-nowrap">
                      {certs.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span
                          className={
                            certWorst === "expired"
                              ? "text-red-600"
                              : certWorst === "expiring"
                                ? "text-amber-700"
                                : "text-slate-600"
                          }
                        >
                          {certs.length}
                          {certWorst ? ` · ${certWorst}` : ""}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={STATUS[o.worst].chip}>
                        {STATUS[o.worst].label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {data.officers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No active officers.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
