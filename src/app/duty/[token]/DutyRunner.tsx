"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { haversineMeters } from "@/lib/geo";
import { CameraCapture } from "./CameraCapture";
import { startDuty, checkInDuty, endDuty, type GpsInput } from "./_actions";

type SiteInfo = {
  id: string;
  name: string;
  code: string | null;
  postcode: string;
  address: string;
  lat: number | null;
  lng: number | null;
  radiusM: number;
  hasCoords: boolean;
};

type Msg = { tone: "error" | "ok" | "info"; text: string } | null;

function getGps(): Promise<GpsInput> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Location isn't supported on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location permission denied. Turn it on for this site to continue."
              : "Couldn't get your location. Step outside or try again.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

export function DutyRunner({
  token,
  status,
  typeLabel,
  site,
  scheduledStartLabel,
  scheduledEndLabel,
  checkIntervalMin,
  assignedName,
  checkInCount,
}: {
  token: string;
  status: string;
  typeLabel: string;
  site: SiteInfo;
  scheduledStartLabel: string;
  scheduledEndLabel: string;
  checkIntervalMin: number;
  assignedName: string | null;
  checkInCount: number;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [camKey, setCamKey] = useState(0);
  const [needLate, setNeedLate] = useState(false);
  const [lateReason, setLateReason] = useState("");
  const [lastDistance, setLastDistance] = useState<number | null>(null);

  const mapsHref =
    site.lat != null && site.lng != null
      ? `https://maps.google.com/?q=${site.lat},${site.lng}`
      : null;

  function noteDistance(gps: GpsInput) {
    if (site.hasCoords && site.lat != null && site.lng != null) {
      setLastDistance(
        Math.round(haversineMeters(site.lat, site.lng, gps.lat, gps.lng)),
      );
    }
  }

  async function handleStart() {
    setMsg(null);
    if (!assignedName && !name.trim()) {
      setMsg({ tone: "error", text: "Enter your name to start the shift." });
      return;
    }
    setBusy(true);
    let gps: GpsInput;
    try {
      gps = await getGps();
      noteDistance(gps);
    } catch (e: any) {
      setBusy(false);
      setMsg({ tone: "error", text: e.message });
      return;
    }
    const res = await startDuty({
      token,
      name: name.trim() || undefined,
      gps,
    });
    setBusy(false);
    if (!res.ok) {
      setMsg({ tone: "error", text: res.error ?? "Couldn't start." });
      return;
    }
    setMsg({ tone: "ok", text: "Shift started. Stay safe." });
    router.refresh();
  }

  async function handleCheckIn() {
    setMsg(null);
    if (!photoUrl) {
      setMsg({ tone: "error", text: "Take a photo to complete the check-in." });
      return;
    }
    setBusy(true);
    let gps: GpsInput;
    try {
      gps = await getGps();
      noteDistance(gps);
    } catch (e: any) {
      setBusy(false);
      setMsg({ tone: "error", text: e.message });
      return;
    }
    const res = await checkInDuty({ token, gps, photoUrl });
    setBusy(false);
    if (!res.ok) {
      setMsg({ tone: "error", text: res.error ?? "Check-in failed." });
      return;
    }
    setPhotoUrl(null);
    setCamKey((k) => k + 1); // reset the camera widget
    setMsg({ tone: "ok", text: "Check-in recorded." });
    router.refresh();
  }

  async function handleEnd() {
    setMsg(null);
    if (needLate && !lateReason.trim()) {
      setMsg({ tone: "error", text: "Add a brief reason for the late finish." });
      return;
    }
    setBusy(true);
    let gps: GpsInput;
    try {
      gps = await getGps();
      noteDistance(gps);
    } catch (e: any) {
      setBusy(false);
      setMsg({ tone: "error", text: e.message });
      return;
    }
    const res = await endDuty({
      token,
      gps,
      lateReason: lateReason.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      if (res.needsLateReason) setNeedLate(true);
      setMsg({ tone: "error", text: res.error ?? "Couldn't end the shift." });
      return;
    }
    setMsg({ tone: "ok", text: "Shift ended. Thank you." });
    router.refresh();
  }

  const isDone = status === "COMPLETED" || status === "ABANDONED";
  const isRunning = status === "IN_PROGRESS";

  return (
    <div className="space-y-4">
      {/* Site card */}
      <div className="card p-4">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          {typeLabel}
        </div>
        <h1 className="text-lg font-semibold text-brand-navy mt-0.5">
          {site.code ? `${site.code} · ` : ""}
          {site.name}
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          {site.address}, {site.postcode}
        </p>
        <dl className="grid grid-cols-2 gap-2 mt-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Starts</dt>
            <dd className="text-brand-navy">{scheduledStartLabel}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Ends</dt>
            <dd className="text-brand-navy">{scheduledEndLabel}</dd>
          </div>
        </dl>
        {mapsHref && (
          <a
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-brand-blue-dark underline mt-2 inline-block"
          >
            Open site in maps
          </a>
        )}
        {!site.hasCoords && (
          <p className="text-xs text-amber-600 mt-2">
            Site location isn&apos;t set, so distance can&apos;t be checked.
            Your GPS is still recorded.
          </p>
        )}
      </div>

      {msg && (
        <div
          className={
            msg.tone === "error"
              ? "rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2"
              : msg.tone === "ok"
                ? "rounded-lg bg-brand-mint/15 text-brand-navy text-sm px-3 py-2"
                : "rounded-lg bg-slate-100 text-slate-700 text-sm px-3 py-2"
          }
        >
          {msg.text}
        </div>
      )}

      {lastDistance != null && site.hasCoords && (
        <p className="text-xs text-slate-500 text-center">
          Last reading: ~{lastDistance} m from site (must be within{" "}
          {site.radiusM} m).
        </p>
      )}

      {/* ── Done ─────────────────────────────────────────────── */}
      {isDone && (
        <div className="card p-5 text-center">
          <div className="text-2xl">✓</div>
          <h2 className="font-semibold text-brand-navy mt-1">Shift complete</h2>
          <p className="text-sm text-slate-600 mt-1">
            {checkInCount} check-in{checkInCount === 1 ? "" : "s"} recorded. You
            can close this page.
          </p>
        </div>
      )}

      {/* ── Start ────────────────────────────────────────────── */}
      {!isDone && !isRunning && (
        <div className="card p-4 space-y-3">
          <h2 className="font-semibold text-brand-navy">Start your shift</h2>
          {assignedName ? (
            <p className="text-sm text-slate-600">
              Signed in as <span className="font-medium">{assignedName}</span>.
            </p>
          ) : (
            <div>
              <label className="label" htmlFor="name">
                Your name <span className="text-red-500">*</span>
              </label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="Full name"
                autoComplete="name"
              />
            </div>
          )}
          <p className="text-xs text-slate-500">
            We&apos;ll check your location is at the site before starting.
          </p>
          <button
            type="button"
            onClick={handleStart}
            disabled={busy}
            className="btn-primary w-full"
          >
            {busy ? "Checking location…" : "Start shift"}
          </button>
        </div>
      )}

      {/* ── Running: check-in + end ───────────────────────────── */}
      {isRunning && (
        <>
          <div className="card p-4 space-y-3">
            <h2 className="font-semibold text-brand-navy">Hourly check-in</h2>
            <p className="text-xs text-slate-500">
              Every {checkIntervalMin} min: take a photo on site and submit.
              {checkInCount > 0
                ? ` ${checkInCount} done so far.`
                : ""}
            </p>
            <CameraCapture
              key={camKey}
              siteId={site.id}
              onCaptured={setPhotoUrl}
              disabled={busy}
            />
            <button
              type="button"
              onClick={handleCheckIn}
              disabled={busy || !photoUrl}
              className="btn-primary w-full"
            >
              {busy ? "Submitting…" : "Submit check-in"}
            </button>
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="font-semibold text-brand-navy">End your shift</h2>
            {needLate && (
              <div>
                <label className="label" htmlFor="lateReason">
                  Reason for late finish <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="lateReason"
                  value={lateReason}
                  onChange={(e) => setLateReason(e.target.value)}
                  rows={2}
                  className="input"
                  placeholder="e.g. relief officer arrived late"
                />
              </div>
            )}
            <button
              type="button"
              onClick={handleEnd}
              disabled={busy}
              className="btn-secondary w-full"
            >
              {busy ? "Checking location…" : "End shift"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
