import { prisma } from "@/lib/db";
import { DEFAULT_GEOFENCE_M } from "@/lib/geo";
import { DutyRunner } from "./DutyRunner";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  STATIC_GUARDING: "Static guarding",
  DOG_HANDLER: "Dog handler",
};

function fmt(d: Date): string {
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-brand-navy text-white px-4 pb-3 pt-safe-4">
        <div className="max-w-lg mx-auto flex items-center gap-2">
          <BrandLogo showWordmark={false} onDark />
          <div className="leading-tight">
            <div className="text-sm font-semibold">1st Nationwide</div>
            <div className="text-[10px] uppercase tracking-wider text-white/70">
              Officer duty
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-lg mx-auto p-4">{children}</main>
    </div>
  );
}

export default async function DutyPage({
  params,
}: {
  params: { token: string };
}) {
  const shift = await prisma.shift.findUnique({
    where: { publicToken: params.token },
    include: {
      site: {
        select: {
          id: true,
          name: true,
          code: true,
          postcodeFormatted: true,
          addressLine: true,
          lat: true,
          lng: true,
          geofenceRadiusM: true,
        },
      },
      officer: { select: { name: true } },
      handledByPartnerOfficer: { select: { name: true } },
      formSubmissions: {
        where: { form: "SHIFT_CHECK" },
        orderBy: { submittedAt: "asc" },
        select: { id: true, submittedAt: true, payload: true },
      },
    },
  });

  if (!shift) {
    return (
      <Shell>
        <div className="card p-6 text-center">
          <h1 className="text-lg font-semibold text-brand-navy">
            Link not found
          </h1>
          <p className="text-sm text-slate-600 mt-2">
            This duty link is invalid or has expired. Please contact 1st
            Nationwide control for a new one.
          </p>
        </div>
      </Shell>
    );
  }

  const assignedName =
    shift.officer?.name ??
    shift.handledByPartnerOfficer?.name ??
    shift.officerNameRaw ??
    null;

  const siteHasCoords = shift.site.lat != null && shift.site.lng != null;

  // Which check-in slots have been done (from the stamped slotIndex).
  const doneSlotIndices = shift.formSubmissions
    .map((s) => {
      const p = s.payload as { slotIndex?: unknown } | null;
      return typeof p?.slotIndex === "number" ? p.slotIndex : null;
    })
    .filter((n): n is number => n != null);

  return (
    <Shell>
      <DutyRunner
        token={params.token}
        status={shift.status}
        typeLabel={TYPE_LABEL[shift.type] ?? shift.type}
        site={{
          id: shift.site.id,
          name: shift.site.name,
          code: shift.site.code,
          postcode: shift.site.postcodeFormatted,
          address: shift.site.addressLine,
          lat: shift.site.lat,
          lng: shift.site.lng,
          radiusM: shift.site.geofenceRadiusM ?? DEFAULT_GEOFENCE_M,
          hasCoords: siteHasCoords,
        }}
        scheduledStartLabel={fmt(shift.scheduledStartsAt)}
        scheduledEndLabel={fmt(shift.scheduledEndsAt)}
        checkIntervalMin={shift.checkIntervalMin}
        graceMinutes={shift.graceMinutes}
        shiftStartIso={(shift.actualStartedAt ?? shift.scheduledStartsAt).toISOString()}
        shiftEndIso={shift.scheduledEndsAt.toISOString()}
        doneSlotIndices={doneSlotIndices}
        assignedName={assignedName}
        checkInCount={shift.formSubmissions.length}
      />
    </Shell>
  );
}
