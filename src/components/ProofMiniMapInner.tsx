"use client";

import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";

/**
 * A small read-only map centred on one captured GPS fix — the officer's
 * location for an attendance. Uses the same OSM tiles + CircleMarker as the
 * dispatch map (no marker-icon assets needed). Rendered client-only via
 * ProofMiniMap.
 */
export default function ProofMiniMapInner({
  lat,
  lng,
}: {
  lat: number;
  lng: number;
}) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={16}
      scrollWheelZoom={false}
      className="w-full overflow-hidden rounded-lg"
      style={{ height: 180 }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap"
      />
      <CircleMarker
        center={[lat, lng]}
        radius={9}
        pathOptions={{
          color: "#ffffff",
          weight: 2,
          fillColor: "#2563EB",
          fillOpacity: 1,
        }}
      >
        <Tooltip>Officer location</Tooltip>
      </CircleMarker>
    </MapContainer>
  );
}
