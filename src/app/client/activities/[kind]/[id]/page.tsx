import { notFound } from "next/navigation";
import { ClipboardCheck, Clock, FileDown, MapPin, ShieldCheck } from "lucide-react";
import { requireCustomer } from "@/lib/authz";
import {
  isActivityKind,
  loadClientActivityDetail,
  type ClientReport,
} from "@/lib/clientActivityDetail";
import { formatDateTime, formatTime } from "@/lib/dates";
import { formatMoney } from "@/lib/numbers";
import { FastFieldAnswers } from "@/components/FastFieldAnswers";
import { ClientHero } from "../../../_components/ClientHero";
import { Panel } from "../../../_components/Panel";
import { StatusChip } from "../../../_components/StatusChip";
import { PhotoGrid } from "../../../_components/PhotoGrid";

export const dynamic = "force-dynamic";

export default async function ClientActivityPage({
  params,
}: {
  params: { kind: string; id: string };
}) {
  const me = await requireCustomer();
  if (!isActivityKind(params.kind)) notFound();
  const a = await loadClientActivityDetail(me.customerId, params.kind, params.id);
  if (!a) notFound();

  const when = a.times[0]?.at ?? null;
  const nothing = a.reports.length === 0 && a.checkIns.length === 0 && a.photos.length === 0;

  return (
    <div className="space-y-5">
      <ClientHero
        backHref="/client/activities"
        backLabel="Activity log"
        eyebrow={a.label}
        title={a.site.name}
        subtitle={when ? formatDateTime(when) : ""}
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={a.status} />
          {a.kind === "shift" && (
            <a
              href={`/client/download/shift/${a.id}`}
              className="btn-secondary text-sm"
              download
            >
              <FileDown size={14} aria-hidden />
              Shift report (PDF)
            </a>
          )}
        </div>
      </ClientHero>

      <Panel title="Details" icon={ClipboardCheck} accent="indigo">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[180px_1fr]">
          <dt className="text-slate-500">Site</dt>
          <dd className="text-slate-800">
            {a.site.code ? `${a.site.code} · ` : ""}
            {a.site.name}
            {a.site.address && (
              <span className="mt-0.5 flex items-center gap-1 text-slate-500">
                <MapPin size={13} aria-hidden />
                {a.site.address}
              </span>
            )}
          </dd>
          {a.times.map((t) => (
            <Row key={t.label} label={t.label}>
              {formatDateTime(t.at)}
            </Row>
          ))}
          <Row label="Charge (ex VAT)">
            {a.charge == null ? "Not priced yet" : formatMoney(a.charge)}
            {a.invoiceNumber && (
              <span className="text-slate-500"> · on invoice {a.invoiceNumber}</span>
            )}
          </Row>
        </dl>
      </Panel>

      {a.checkIns.length > 0 && (
        <Panel
          title="Check-ins"
          hint={`${a.checkIns.length} during the shift`}
          icon={Clock}
          accent="blue"
        >
          <ul className="space-y-4">
            {a.checkIns.map((c, i) => (
              <li key={i} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium tabular-nums text-brand-navy">
                    {formatTime(c.at)}
                  </span>
                  {c.onSite === true && <span className="chip-green">On site</span>}
                  {c.onSite === false && <span className="chip-amber">Away from the site</span>}
                </div>
                <PhotoGrid photos={c.photos} label={`Check-in at ${formatTime(c.at)}`} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {a.reports.map((r) => (
        <ReportPanel key={r.id} report={r} />
      ))}

      {a.photos.length > 0 && (
        <Panel title="Photos" icon={ShieldCheck} accent="emerald">
          <PhotoGrid photos={a.photos} label={a.label} />
        </Panel>
      )}

      {nothing && (
        <p className="rounded-2xl border border-slate-200/70 bg-white px-4 py-6 text-center text-sm text-slate-500 shadow-card">
          No written report for this activity.
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800">{children}</dd>
    </>
  );
}

function ReportPanel({ report: r }: { report: ClientReport }) {
  const hint = [
    r.id === "alarm" ? null : `Filed ${formatDateTime(r.submittedAt)}`,
    r.arrivedAt ? `arrived ${formatTime(r.arrivedAt)}` : null,
    r.departedAt ? `left ${formatTime(r.departedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Panel title={r.title} hint={hint || undefined} icon={ShieldCheck} accent="emerald">
      {r.fastfield ? (
        <FastFieldAnswers answers={r.fastfield.answers} photoUrls={r.fastfield.photoUrls} />
      ) : (
        <div className="space-y-4">
          {r.fields.length > 0 && (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[220px_1fr]">
              {r.fields.map((f, i) => (
                <Row key={`${f.label}-${i}`} label={f.label}>
                  <span className="whitespace-pre-wrap break-words">{f.value}</span>
                </Row>
              ))}
            </dl>
          )}
          <PhotoGrid photos={r.photos} label={r.title} />
          {r.signatureUrl && (
            <div>
              <div className="text-xs text-slate-500 mb-1">Signature</div>
              {/* eslint-disable-next-line @next/next/no-img-element -- stored in Blob storage */}
              <img
                src={r.signatureUrl}
                alt="Signature"
                width={240}
                height={96}
                className="max-h-24 w-auto rounded border border-slate-200 bg-white p-1"
              />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
