"use client";

import { useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  useMap,
} from "react-leaflet";
import L from "leaflet";

export type Freshness = "fresh" | "stale" | "old";

export type OfficerPin = {
  id: string;
  name: string;
  role: string;
  lat: number;
  lng: number;
  freshness: Freshness;
  lastSeenLabel: string;
};

export type SitePin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  postcode?: string | null;
  liveJobCount?: number;
  /** Marker fill colour. When unset, falls back to the live-job / neutral default. */
  colorHex?: string | null;
  /** Stable owner key — used by callers to filter pins (e.g. "shurgard"). */
  ownerKey?: string | null;
  /** Human label for the owner — shown in the popup. */
  ownerLabel?: string | null;
};

export type AssignmentLine = {
  officerId: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  officerName: string;
  siteName: string;
};

export type Layers = {
  jobSites: boolean;
  allSites: boolean;
  lines: boolean;
};

const UK_CENTER: [number, number] = [54.0, -2.5];
const UK_ZOOM = 6;

const FRESHNESS_COLOR: Record<Freshness, string> = {
  fresh: "#3B82F6", // mint
  stale: "#f59e0b", // amber-500
  old: "#94a3b8", // slate-400
};

function officerIcon(o: OfficerPin): L.DivIcon {
  const color = FRESHNESS_COLOR[o.freshness];
  const initial = (o.name || "?").trim().charAt(0).toUpperCase();
  const html = `
    <div style="
      width: 32px; height: 32px;
      background: ${color};
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(15,25,41,0.35);
      color: white;
      font: 600 13px Inter, system-ui, sans-serif;
      display: flex; align-items: center; justify-content: center;
    ">${initial}</div>
  `;
  return L.divIcon({
    className: "officer-pin",
    html,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -14],
  });
}

function FitBounds({
  pins,
}: {
  pins: Array<{ lat: number; lng: number }>;
}) {
  const map = useMap();
  if (pins.length === 0) return null;
  if (pins.length === 1) {
    map.setView([pins[0].lat, pins[0].lng], 12);
    return null;
  }
  const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number]));
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
  return null;
}

export default function DispatchMapInner({
  officers,
  jobSites,
  allSites,
  lines,
  layers,
  height = 420,
}: {
  officers: OfficerPin[];
  jobSites: SitePin[];
  allSites: SitePin[];
  lines: AssignmentLine[];
  layers: Layers;
  height?: number;
}) {
  const visibleSites = useMemo(() => {
    const map = new Map<string, SitePin>();
    if (layers.allSites) {
      for (const s of allSites) map.set(s.id, s);
    }
    if (layers.jobSites) {
      // job sites win over all-sites so liveJobCount badge renders
      for (const s of jobSites) map.set(s.id, s);
    }
    return Array.from(map.values());
  }, [allSites, jobSites, layers.allSites, layers.jobSites]);

  const fitPins = useMemo(() => {
    const pins: Array<{ lat: number; lng: number }> = [];
    for (const o of officers) pins.push({ lat: o.lat, lng: o.lng });
    for (const s of visibleSites) pins.push({ lat: s.lat, lng: s.lng });
    return pins;
  }, [officers, visibleSites]);

  return (
    <MapContainer
      center={UK_CENTER}
      zoom={UK_ZOOM}
      scrollWheelZoom
      style={{ height, width: "100%", borderRadius: 16 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      <FitBounds pins={fitPins} />

      {visibleSites.map((s) => {
        // Owner colour wins when set; otherwise fall back to the original
        // job-vs-neutral palette (mint for live-job sites, slate for the rest).
        const ownerColored = !!s.colorHex;
        const fill = s.colorHex ?? (s.liveJobCount ? "#3B82F6" : "#cbd5e1");
        const stroke = s.liveJobCount || ownerColored ? "#0F1929" : "#64748b";
        const radius = s.liveJobCount ? 9 : ownerColored ? 7 : 5;
        const weight = s.liveJobCount ? 2 : ownerColored ? 1.5 : 1;
        return (
          <CircleMarker
            key={`site-${s.id}`}
            center={[s.lat, s.lng]}
            radius={radius}
            pathOptions={{
              color: stroke,
              fillColor: fill,
              fillOpacity: 0.85,
              weight,
            }}
          >
            <Popup>
              <div style={{ fontWeight: 600, color: "#0F1929" }}>{s.name}</div>
              {s.ownerLabel && (
                <div style={{ fontSize: 12, marginTop: 2, color: "#475569", display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: fill,
                    }}
                  />
                  {s.ownerLabel}
                </div>
              )}
              {s.postcode && (
                <div style={{ fontSize: 12, marginTop: 2, fontFamily: "monospace", color: "#475569" }}>
                  {s.postcode}
                </div>
              )}
              <div style={{ fontSize: 11, marginTop: 2, color: "#64748b" }}>
                {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
              </div>
              {s.liveJobCount ? (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  {s.liveJobCount} live job{s.liveJobCount === 1 ? "" : "s"}
                </div>
              ) : null}
              <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                <a
                  href={`/sites/${s.id}/edit`}
                  style={{ fontSize: 12, color: "#3B82F6" }}
                >
                  Open site →
                </a>
                <a
                  href={`https://www.google.com/maps?q=${s.lat},${s.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: "#64748b" }}
                >
                  Verify on Maps ↗
                </a>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {layers.lines &&
        lines.map((l) => (
          <Polyline
            key={`line-${l.officerId}`}
            positions={[
              [l.fromLat, l.fromLng],
              [l.toLat, l.toLng],
            ]}
            pathOptions={{
              color: "#0F1929",
              weight: 2,
              opacity: 0.5,
              dashArray: "6 6",
            }}
          >
            <Popup>
              <div style={{ fontSize: 12 }}>
                {l.officerName} → {l.siteName}
              </div>
            </Popup>
          </Polyline>
        ))}

      {officers.map((o) => (
        <Marker key={`officer-${o.id}`} position={[o.lat, o.lng]} icon={officerIcon(o)}>
          <Popup>
            <div style={{ fontWeight: 600, color: "#0F1929" }}>{o.name}</div>
            <div style={{ fontSize: 12, color: "#475569" }}>
              {o.role.toLowerCase()} · seen {o.lastSeenLabel}
            </div>
            <a
              href={`https://www.google.com/maps?q=${o.lat},${o.lng}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12, color: "#3B82F6" }}
            >
              Open in Google Maps ↗
            </a>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
