import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { DeleteShiftButton } from "../_components/DeleteShiftButton";
import { ShiftLinkCard } from "../_components/ShiftLinkCard";
import { PageHeader } from "@/components/PageHeader";
import { dutyUrl } from "@/lib/dutyLink";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  PENDING: "chip-slate",
  IN_PROGRESS: "chip-mint",
  COMPLETED: "chip-mint",
  MISSED: "chip-red",
  ABANDONED: "chip-amber",
};

const TYPE_LABEL: Record<string, string> = {
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
};

const ACTION_LABEL: Record<string, string> = {
  created: "Shift created",
  edited: "Edited",
  edited_after_completion: "Edited after completion",
  started_on_duty: "Started on site",
  ended_on_duty: "Ended on site",
  link_sent: "Link sent by SMS",
};

function fmt(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

function fmtMinutes(min: number | null | undefined): string {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function money(amount: unknown, currency: string | null): string {
  if (amount == null) return "—";
  const n = typeof amount === "object" ? Number(amount) : Number(amount);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency ?? "GBP",
  }).format(n);
}

function GeoBadge({
  within,
  distanceM,
}: {
  within: boolean | null;
  distanceM: number | null;
}) {
  if (within == null) {
    return (
      <span className="chip-slate text-[10px]">
        {distanceM != null ? `${distanceM} m` : "no geo check"}
      </span>
    );
  }
  return within ? (
    <span className="chip-mint text-[10px]">
      in range{distanceM != null ? ` · ${distanceM} m` : ""}
    </span>
  ) : (
    <span className="chip-red text-[10px]">
      outside{distanceM != null ? ` · ${distanceM} m` : ""}
    </span>
  );
}

function mapsLink(lat: number | null, lng: number | null) {
  if (lat == null || lng == null) return null;
  return `https://maps.google.com/?q=${lat},${lng}`;
}

function renderDiffValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("from" in o || "to" in o) {
      return `${String(o.from ?? "—")} → ${String(o.to ?? "—")}`;
    }
    return JSON.stringify(v);
  }
  return String(v);
}

export default async function ShiftDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [shift, history] = await Promise.all([
    prisma.shift.findUnique({
      where: { id: params.id },
      include: {
        site: { select: { id: true, name: true, code: true, lat: true, lng: true } },
        officer: { select: { id: true, name: true } },
        handledByPartner: { select: { name: true } },
        handledByPartnerOfficer: { select: { name: true } },
        formSubmissions: {
          where: { form: "SHIFT_CHECK" },
          orderBy: { submittedAt: "asc" },
          select: { id: true, submittedAt: true, payload: true, officerNameRaw: true },
        },
      },
    }),
    prisma.activityLog.findMany({
      where: { entity: "Shift", entityId: params.id },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true } } },
    }),
  ]);
  if (!shift) notFound();

  const officerLabel =
    shift.officer?.name ??
    (shift.handledByPartnerOfficer?.name
      ? `${shift.handledByPartnerOfficer.name} (partner)`
      : null) ??
    (shift.officerNameRaw ? `${shift.officerNameRaw} (entered on link)` : null) ??
    "unassigned";

  const isOpen = shift.status !== "COMPLETED" && shift.status !== "ABANDONED";
  const url = shift.publicToken ? dutyUrl(shift.publicToken) : null;

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader
        title={`${shift.site.code ? `${shift.site.code} · ` : ""}${shift.site.name}`}
        backHref="/shifts"
        backLabel="Shifts"
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className={STATUS_TONE[shift.status] ?? "chip-slate"}>
              {shift.status.toLowerCase().replace("_", " ")}
            </span>
            <span>
              {TYPE_LABEL[shift.type] ?? shift.type} · {officerLabel} · every{" "}
              {shift.checkIntervalMin} min (+{shift.graceMinutes} buffer)
            </span>
          </span>
        }
        actions={
          <>
            <a
              href={`/api/shifts/${shift.id}/report`}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary"
            >
              Download report (PDF)
            </a>
            <Link href={`/shifts/${shift.id}/edit`} className="btn-secondary">
              Edit
            </Link>
            <DeleteShiftButton shiftId={shift.id} />
          </>
        }
      />

      {/* Officer link (copy + send SMS) */}
      {url && (
        <ShiftLinkCard
          shiftId={shift.id}
          url={url}
          linkPhone={shift.linkPhone}
        />
      )}
      {!url && (
        <div className="card p-4 text-sm text-slate-600">
          No officer link on this shift. New shifts get one automatically;
          shifts recorded after the fact don&apos;t need one.
        </div>
      )}

      {/* Start / end report */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="card p-4 space-y-1">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Start
          </div>
          <div className="text-base font-medium text-brand-navy">
            {fmt(shift.actualStartedAt)}
          </div>
          <div className="text-xs text-slate-500">
            Scheduled {fmt(shift.scheduledStartsAt)}
          </div>
          {(shift.startLat != null || shift.startWithinGeofence != null) && (
            <div className="flex items-center gap-2 pt-1">
              <GeoBadge
                within={shift.startWithinGeofence}
                distanceM={shift.startDistanceM}
              />
              {mapsLink(shift.startLat, shift.startLng) && (
                <a
                  href={mapsLink(shift.startLat, shift.startLng)!}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-blue-dark underline"
                >
                  map
                </a>
              )}
            </div>
          )}
        </div>

        <div className="card p-4 space-y-1">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            End
          </div>
          <div className="text-base font-medium text-brand-navy">
            {fmt(shift.actualEndedAt)}
          </div>
          <div className="text-xs text-slate-500">
            Scheduled {fmt(shift.scheduledEndsAt)}
          </div>
          {(shift.endLat != null || shift.endWithinGeofence != null) && (
            <div className="flex items-center gap-2 pt-1">
              <GeoBadge
                within={shift.endWithinGeofence}
                distanceM={shift.endDistanceM}
              />
              {mapsLink(shift.endLat, shift.endLng) && (
                <a
                  href={mapsLink(shift.endLat, shift.endLng)!}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-blue-dark underline"
                >
                  map
                </a>
              )}
            </div>
          )}
          {shift.endedLate && (
            <div className="pt-1">
              <span className="chip-amber text-[10px]">ended late</span>
              {shift.lateReason && (
                <p className="text-xs text-slate-600 mt-1">
                  Reason: {shift.lateReason}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pay breakdown */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Worked
          </div>
          <div className="text-lg font-semibold text-brand-navy mt-1">
            {shift.actualStartedAt && shift.actualEndedAt
              ? fmtMinutes(
                  Math.round(
                    (shift.actualEndedAt.getTime() -
                      shift.actualStartedAt.getTime()) /
                      60000,
                  ),
                )
              : "—"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Payable (30-min)
          </div>
          <div className="text-lg font-semibold text-brand-navy mt-1">
            {fmtMinutes(shift.payableMinutes)}
          </div>
          <div className="text-xs text-slate-500">rounded up</div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            Officer pay
          </div>
          <div className="text-lg font-semibold text-brand-navy mt-1">
            {money(shift.paidAmount, shift.paidCurrency)}
          </div>
          <div className="text-xs text-slate-500">
            bill {money(shift.billedAmount, shift.billedCurrency)}
          </div>
        </div>
      </div>

      {/* Check-ins with GPS + photos */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">Check-ins</h2>
          <p className="text-xs text-slate-500">
            Each hourly check: time, location vs site, and the on-site photo.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                #
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Time
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Location
              </th>
              <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                Photo
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shift.formSubmissions.map((s, i) => {
              const p = (s.payload ?? {}) as Record<string, any>;
              const gps = p.gps as
                | { lat?: number; lng?: number }
                | undefined;
              const photoUrl = p.photoUrl as string | undefined;
              const gpsMap =
                gps?.lat != null && gps?.lng != null
                  ? `https://maps.google.com/?q=${gps.lat},${gps.lng}`
                  : null;
              return (
                <tr key={s.id}>
                  <td className="px-4 py-2 text-slate-500">{i + 1}</td>
                  <td className="px-4 py-2 text-slate-700 whitespace-nowrap">
                    {fmt(s.submittedAt)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <GeoBadge
                        within={
                          typeof p.withinGeofence === "boolean"
                            ? p.withinGeofence
                            : null
                        }
                        distanceM={
                          typeof p.distanceM === "number" ? p.distanceM : null
                        }
                      />
                      {gpsMap && (
                        <a
                          href={gpsMap}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-brand-blue-dark underline"
                        >
                          map
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {photoUrl ? (
                      <a href={photoUrl} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photoUrl}
                          alt={`Check-in ${i + 1}`}
                          className="h-12 w-12 object-cover rounded border border-slate-200"
                        />
                      </a>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {shift.formSubmissions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500 text-sm">
                  No check-ins yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {shift.notes && (
        <div className="card p-4">
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
            Notes
          </h3>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">
            {shift.notes}
          </p>
        </div>
      )}

      {/* Edit / activity history */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">History</h2>
          <p className="text-xs text-slate-500">
            Every action and edit on this shift, with who and when.
          </p>
        </div>
        <ul className="divide-y divide-slate-100">
          {history.map((h) => {
            const diff = (h.diff ?? null) as Record<string, unknown> | null;
            return (
              <li key={h.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm font-medium text-brand-navy">
                    {ACTION_LABEL[h.action] ?? h.action}
                  </span>
                  <span className="text-xs text-slate-500">
                    {h.user?.name ?? "Officer (link)"} · {fmt(h.createdAt)}
                  </span>
                </div>
                {diff && Object.keys(diff).length > 0 && (
                  <ul className="mt-1 text-xs text-slate-600 space-y-0.5">
                    {Object.entries(diff).map(([k, v]) => (
                      <li key={k}>
                        <span className="text-slate-400">{k}:</span>{" "}
                        {renderDiffValue(v)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {history.length === 0 && (
            <li className="px-4 py-6 text-center text-slate-500 text-sm">
              No history yet.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
