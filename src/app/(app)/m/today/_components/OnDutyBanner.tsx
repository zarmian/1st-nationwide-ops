"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const LOCATION_INTERVAL_MS = 2 * 60 * 1000; // 2 min
const LOCATION_TIMEOUT_MS = 15 * 1000;

type LocationState =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "ok"; lat: number; lng: number; accuracy: number | null; at: number }
  | { kind: "denied" }
  | { kind: "error"; message: string };

export function OnDutyBanner({
  initialOnDuty,
  setOnDuty,
}: {
  initialOnDuty: boolean;
  setOnDuty: (onDuty: boolean) => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [onDuty, setLocalOnDuty] = useState(initialOnDuty);
  const [loc, setLoc] = useState<LocationState>({ kind: "idle" });
  const lastPostedRef = useRef<number>(0);

  // Push the latest position to the server, but no more than once per
  // LOCATION_INTERVAL_MS (avoid spamming on rapid watchPosition callbacks).
  function postLocation(lat: number, lng: number, accuracy: number | null) {
    const now = Date.now();
    if (now - lastPostedRef.current < LOCATION_INTERVAL_MS - 5000) return;
    lastPostedRef.current = now;
    fetch("/api/officers/me/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lng, accuracy }),
    }).catch(() => {
      /* best-effort; surface as 'error' on next try if it persists */
    });
  }

  useEffect(() => {
    if (!onDuty) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLoc({ kind: "error", message: "Geolocation not available in this browser." });
      return;
    }
    setLoc({ kind: "asking" });
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const next: LocationState = {
          kind: "ok",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
          at: Date.now(),
        };
        setLoc(next);
        postLocation(next.lat, next.lng, next.accuracy);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setLoc({ kind: "denied" });
        } else {
          setLoc({ kind: "error", message: err.message });
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30 * 1000,
        timeout: LOCATION_TIMEOUT_MS,
      },
    );
    // Also force a post every LOCATION_INTERVAL_MS regardless of movement.
    const ticker = setInterval(() => {
      setLoc((current) => {
        if (current.kind === "ok") {
          postLocation(current.lat, current.lng, current.accuracy);
        }
        return current;
      });
    }, LOCATION_INTERVAL_MS);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearInterval(ticker);
    };
  }, [onDuty]);

  function toggle(next: boolean) {
    startTransition(async () => {
      const r = await setOnDuty(next);
      if (r.ok) {
        setLocalOnDuty(next);
        if (!next) setLoc({ kind: "idle" });
        router.refresh();
      }
    });
  }

  return (
    <div
      className={
        "card p-4 flex items-center justify-between gap-3 " +
        (onDuty
          ? "border-brand-mint/50 bg-brand-mint-light/40"
          : "border-slate-200 bg-slate-50")
      }
    >
      <div>
        <div className="flex items-center gap-2">
          <span
            className={
              "w-2.5 h-2.5 rounded-full " +
              (onDuty ? "bg-brand-mint animate-pulse" : "bg-slate-400")
            }
          />
          <span className="font-medium text-brand-navy">
            {onDuty ? "On duty" : "Off duty"}
          </span>
        </div>
        <p className="text-xs text-slate-600 mt-1">
          {onDuty ? <LocationLine state={loc} /> : "Tap the button when you're ready to start your shift."}
        </p>
      </div>
      <button
        type="button"
        onClick={() => toggle(!onDuty)}
        disabled={pending}
        className={onDuty ? "btn-secondary text-sm" : "btn-primary text-sm"}
      >
        {pending ? "…" : onDuty ? "End shift" : "Start shift"}
      </button>
    </div>
  );
}

function LocationLine({ state }: { state: LocationState }) {
  switch (state.kind) {
    case "idle":
      return <>Sharing location while on duty.</>;
    case "asking":
      return <>Asking for location permission…</>;
    case "denied":
      return (
        <span className="text-amber-700">
          Location permission denied — please enable it in browser settings.
          We can't share your position without it.
        </span>
      );
    case "error":
      return <span className="text-amber-700">Location: {state.message}</span>;
    case "ok": {
      const ago = Math.max(0, Math.round((Date.now() - state.at) / 1000));
      const acc = state.accuracy != null ? ` · ±${Math.round(state.accuracy)}m` : "";
      return (
        <>
          Location shared {ago}s ago{acc}.
        </>
      );
    }
  }
}
