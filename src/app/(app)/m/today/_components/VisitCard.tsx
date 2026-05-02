"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Visit = {
  id: string;
  status: string;
  scheduledAt: string;
  arrivedAt: string | null;
  kind: string;
  site: {
    id: string;
    name: string;
    addressLine: string;
    postcodeFormatted: string;
    lat: number | null;
    lng: number | null;
  };
  isMine: boolean;
};

const STATUS_TONE: Record<string, string> = {
  PENDING: "chip-slate",
  IN_PROGRESS: "chip-amber",
  LATE: "chip-amber",
  COMPLETED: "chip-mint",
  MISSED: "chip-red",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "On site",
  LATE: "Late",
  COMPLETED: "Completed",
  MISSED: "Missed",
};

export function VisitCard({ visit }: { visit: Visit }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const time = new Date(visit.scheduledAt).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const mapsQuery = encodeURIComponent(
    `${visit.site.addressLine}, ${visit.site.postcodeFormatted}`,
  );
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;

  function onSite() {
    setError(null);
    setBusy(true);
    if (!("geolocation" in navigator)) {
      postOnSite(null, null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => postOnSite(pos.coords.latitude, pos.coords.longitude),
      () => postOnSite(null, null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }

  async function postOnSite(lat: number | null, lng: number | null) {
    try {
      const res = await fetch(`/api/visits/${visit.id}/on-site`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(j?.error ?? "Could not mark on-site");
      }
      startTransition(() => router.refresh());
    } catch (e: any) {
      setError(e.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  const isOnSite =
    visit.status === "IN_PROGRESS" || visit.arrivedAt !== null;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-slate-500">
            {visit.kind === "VPI" ? "VPI" : "Patrol"} · {time}
          </div>
          <div className="font-semibold text-brand-navy">
            {visit.site.name}
          </div>
          <div className="text-xs text-slate-500">
            {visit.site.addressLine} · {visit.site.postcodeFormatted}
          </div>
        </div>
        <span className={STATUS_TONE[visit.status] ?? "chip-slate"}>
          {STATUS_LABEL[visit.status] ?? visit.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary text-sm"
        >
          Directions
        </a>
        {!isOnSite && (
          <button
            type="button"
            onClick={onSite}
            disabled={busy || pending}
            className="btn-primary text-sm"
          >
            {busy ? "Sending GPS…" : visit.isMine ? "I'm on site" : "Claim & on site"}
          </button>
        )}
        {isOnSite && (
          <Link
            href={`/submit?visitId=${visit.id}`}
            className="btn-primary text-sm"
          >
            Submit form
          </Link>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
