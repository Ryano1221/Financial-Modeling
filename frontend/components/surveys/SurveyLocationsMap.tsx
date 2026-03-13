"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SurveyEntry } from "@/lib/surveys/types";

type SurveyLocationsMapProps = {
  entries: SurveyEntry[];
  selectedEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
};

type GeocodeHit = {
  lat: number;
  lon: number;
  displayName: string;
};

type LocationRow = {
  id: string;
  label: string;
  address: string;
  query: string;
};

const GEOCODE_CACHE_KEY = "survey_geocode_cache_v1";
const GEOCODE_DELAY_MS = 1100;

function asText(value: unknown): string {
  return String(value || "").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildLocationRow(entry: SurveyEntry): LocationRow {
  const building = asText(entry.buildingName);
  const address = asText(entry.address);
  const suite = asText(entry.suite);
  const floor = asText(entry.floor);
  const fallbackName = asText(entry.sourceDocumentName) || "Survey Location";
  const query = [building, address, suite ? `Suite ${suite}` : "", floor ? `Floor ${floor}` : ""]
    .filter(Boolean)
    .join(", ");
  return {
    id: entry.id,
    label: building || fallbackName,
    address,
    query: asText(query),
  };
}

export function SurveyLocationsMap({ entries, selectedEntryId, onSelectEntry }: SurveyLocationsMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const [geocodeByQuery, setGeocodeByQuery] = useState<Record<string, GeocodeHit | null>>({});

  const locations = useMemo(() => entries.map(buildLocationRow), [entries]);
  const uniqueQueries = useMemo(
    () => Array.from(new Set(locations.map((row) => row.query).filter(Boolean))),
    [locations],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(GEOCODE_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, GeocodeHit | null>;
      if (parsed && typeof parsed === "object") {
        setGeocodeByQuery(parsed);
      }
    } catch {
      // Ignore malformed cache entries.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(geocodeByQuery));
    } catch {
      // Ignore cache persistence failures.
    }
  }, [geocodeByQuery]);

  useEffect(() => {
    let cancelled = false;

    async function geocodeMissingQueries() {
      for (const query of uniqueQueries) {
        if (!query) continue;
        if (query in geocodeByQuery) continue;
        try {
          const params = new URLSearchParams({
            format: "jsonv2",
            limit: "1",
            q: query,
          });
          const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
            headers: {
              Accept: "application/json",
              "Accept-Language": "en-US",
            },
          });
          if (!res.ok) {
            if (!cancelled) {
              setGeocodeByQuery((prev) => ({ ...prev, [query]: null }));
            }
            await sleep(GEOCODE_DELAY_MS);
            continue;
          }
          const payload = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
          const first = payload[0];
          const lat = Number(first?.lat || NaN);
          const lon = Number(first?.lon || NaN);
          const nextValue =
            Number.isFinite(lat) && Number.isFinite(lon)
              ? {
                  lat,
                  lon,
                  displayName: asText(first?.display_name) || query,
                }
              : null;
          if (!cancelled) {
            setGeocodeByQuery((prev) => ({ ...prev, [query]: nextValue }));
          }
          await sleep(GEOCODE_DELAY_MS);
        } catch {
          if (!cancelled) {
            setGeocodeByQuery((prev) => ({ ...prev, [query]: null }));
          }
          await sleep(GEOCODE_DELAY_MS);
        }
      }
    }

    if (uniqueQueries.length > 0) {
      void geocodeMissingQueries();
    }

    return () => {
      cancelled = true;
    };
  }, [uniqueQueries, geocodeByQuery]);

  const geocodedLocations = useMemo(
    () =>
      locations
        .map((row) => {
          const hit = row.query ? geocodeByQuery[row.query] : null;
          if (!hit) return null;
          return {
            ...row,
            lat: hit.lat,
            lon: hit.lon,
            displayName: hit.displayName,
          };
        })
        .filter(Boolean) as Array<LocationRow & GeocodeHit>,
    [locations, geocodeByQuery],
  );

  useEffect(() => {
    let cancelled = false;

    async function initializeMap() {
      if (!mapContainerRef.current || mapRef.current) return;
      const leaflet = await import("leaflet");
      if (cancelled || !mapContainerRef.current) return;
      leafletRef.current = leaflet;
      const map = leaflet.map(mapContainerRef.current, {
        zoomControl: true,
      });
      leaflet
        .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
        .addTo(map);
      const markerLayer = leaflet.layerGroup().addTo(map);
      map.setView([39.8283, -98.5795], 4);
      mapRef.current = map;
      layerRef.current = markerLayer;
    }

    void initializeMap();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const leaflet = leafletRef.current;
    if (!map || !layer || !leaflet) return;

    layer.clearLayers();
    if (geocodedLocations.length === 0) {
      map.setView([39.8283, -98.5795], 4);
      return;
    }

    const defaultIcon = leaflet.divIcon({
      className: "survey-map-pin",
      html: '<span style="display:block;width:12px;height:12px;border-radius:9999px;background:#22d3ee;border:2px solid #082f49;box-shadow:0 0 0 2px rgba(34,211,238,0.35);"></span>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    const selectedIcon = leaflet.divIcon({
      className: "survey-map-pin-selected",
      html: '<span style="display:block;width:16px;height:16px;border-radius:9999px;background:#67e8f9;border:2px solid #cffafe;box-shadow:0 0 0 3px rgba(103,232,249,0.35);"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    const bounds = leaflet.latLngBounds([]);
    for (const row of geocodedLocations) {
      const isSelected = row.id === selectedEntryId;
      const marker = leaflet
        .marker([row.lat, row.lon], { icon: isSelected ? selectedIcon : defaultIcon })
        .addTo(layer);
      const tooltip = document.createElement("div");
      tooltip.textContent = `${row.label}${row.address ? ` - ${row.address}` : ""}`;
      marker.bindTooltip(tooltip, {
        direction: "top",
        sticky: true,
      });
      marker.on("click", () => onSelectEntry(row.id));
      bounds.extend([row.lat, row.lon]);
    }

    if (geocodedLocations.length === 1) {
      map.setView([geocodedLocations[0].lat, geocodedLocations[0].lon], 13);
    } else {
      map.fitBounds(bounds.pad(0.2));
    }

    window.setTimeout(() => map.invalidateSize(), 60);
  }, [geocodedLocations, onSelectEntry, selectedEntryId]);

  const unresolvedCount = useMemo(
    () => locations.filter((row) => row.query && geocodeByQuery[row.query] === null).length,
    [locations, geocodeByQuery],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
        <p>
          Pinned {geocodedLocations.length} of {locations.length} survey location{locations.length === 1 ? "" : "s"}.
        </p>
        <p className="text-slate-400">Click a pin to select that survey row.</p>
      </div>
      <div ref={mapContainerRef} className="h-[360px] w-full border border-white/20 bg-black/40" />
      {unresolvedCount > 0 ? (
        <p className="text-xs text-amber-300">
          {unresolvedCount} location{unresolvedCount === 1 ? "" : "s"} could not be pinned. Add a fuller street address for better map accuracy.
        </p>
      ) : null}
    </div>
  );
}
