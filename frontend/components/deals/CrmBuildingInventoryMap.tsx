"use client";

import { useEffect, useMemo, useRef } from "react";
import type { CrmBuilding } from "@/lib/workspace/crm";

type CrmBuildingInventoryMapProps = {
  buildings: CrmBuilding[];
  selectedBuildingId: string | null;
  selectedBuildingIds?: string[];
  selectionMode?: boolean;
  onSelectBuilding: (buildingId: string) => void;
  onSelectionChange?: (buildingIds: string[]) => void;
};

function asText(value: unknown): string {
  return String(value || "").trim();
}

function hasCoordinates(building: CrmBuilding): building is CrmBuilding & { latitude: number; longitude: number } {
  return Number.isFinite(building.latitude) && Number.isFinite(building.longitude);
}

type PositionedBuilding = CrmBuilding & {
  displayLatitude: number;
  displayLongitude: number;
  groupSize: number;
  groupIndex: number;
};

type CoordinatePoint = {
  latitude: number;
  longitude: number;
};

function distanceMeters(left: CrmBuilding & { latitude: number; longitude: number }, right: CrmBuilding & { latitude: number; longitude: number }): number {
  const avgLat = ((left.latitude + right.latitude) / 2) * (Math.PI / 180);
  const dx = (left.longitude - right.longitude) * 111320 * Math.cos(avgLat);
  const dy = (left.latitude - right.latitude) * 110540;
  return Math.hypot(dx, dy);
}

function compareHullPoints(left: CoordinatePoint, right: CoordinatePoint): number {
  if (left.longitude === right.longitude) return left.latitude - right.latitude;
  return left.longitude - right.longitude;
}

function cross(origin: CoordinatePoint, left: CoordinatePoint, right: CoordinatePoint): number {
  return (left.longitude - origin.longitude) * (right.latitude - origin.latitude)
    - (left.latitude - origin.latitude) * (right.longitude - origin.longitude);
}

function convexHull(points: CoordinatePoint[]): CoordinatePoint[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort(compareHullPoints);
  const lower: CoordinatePoint[] = [];
  const upper: CoordinatePoint[] = [];

  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }

  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function buildTerritoryOutline(points: CoordinatePoint[]): CoordinatePoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    const point = points[0];
    return [
      { latitude: point.latitude + 0.12, longitude: point.longitude - 0.12 },
      { latitude: point.latitude + 0.12, longitude: point.longitude + 0.12 },
      { latitude: point.latitude - 0.12, longitude: point.longitude + 0.12 },
      { latitude: point.latitude - 0.12, longitude: point.longitude - 0.12 },
    ];
  }

  const hull = convexHull(points);
  const centroid = hull.reduce(
    (sum, point) => ({
      latitude: sum.latitude + point.latitude,
      longitude: sum.longitude + point.longitude,
    }),
    { latitude: 0, longitude: 0 },
  );
  centroid.latitude /= hull.length;
  centroid.longitude /= hull.length;
  const centroidLatRad = centroid.latitude * (Math.PI / 180);

  return hull.map((point) => {
    const dx = (point.longitude - centroid.longitude) * 111320 * Math.max(0.2, Math.cos(centroidLatRad));
    const dy = (point.latitude - centroid.latitude) * 110540;
    const radius = Math.hypot(dx, dy);
    const extraRadius = Math.max(6500, radius * 0.28);
    const scale = radius > 0 ? (radius + extraRadius) / radius : 1;
    return {
      latitude: centroid.latitude + ((dy * scale) / 110540),
      longitude: centroid.longitude + ((dx * scale) / (111320 * Math.max(0.2, Math.cos(centroidLatRad)))),
    };
  });
}

function spreadBuildingPins(buildings: Array<CrmBuilding & { latitude: number; longitude: number }>): PositionedBuilding[] {
  const visited = new Set<string>();
  const groups: Array<Array<CrmBuilding & { latitude: number; longitude: number }>> = [];

  for (const building of buildings) {
    if (visited.has(building.id)) continue;
    const group: Array<CrmBuilding & { latitude: number; longitude: number }> = [];
    const queue = [building];
    visited.add(building.id);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      group.push(current);
      for (const candidate of buildings) {
        if (visited.has(candidate.id)) continue;
        if (distanceMeters(current, candidate) <= 140) {
          visited.add(candidate.id);
          queue.push(candidate);
        }
      }
    }

    groups.push(group);
  }

  return groups.flatMap((group) => {
    if (group.length === 1) {
      return group.map((building) => ({
        ...building,
        displayLatitude: building.latitude,
        displayLongitude: building.longitude,
        groupSize: 1,
        groupIndex: 0,
      }));
    }

    const centerLat = group.reduce((sum, building) => sum + building.latitude, 0) / group.length;
    const centerLon = group.reduce((sum, building) => sum + building.longitude, 0) / group.length;
    const centerLatRad = centerLat * (Math.PI / 180);

    return group.map((building, index) => {
      const ring = Math.floor(index / 7);
      const slotCount = Math.min(7, group.length - ring * 7);
      const slot = index % 7;
      const angle = (-Math.PI / 2) + ((Math.PI * 2) / Math.max(1, slotCount)) * slot + ring * 0.18;
      const radiusMeters = 24 + ring * 24 + Math.max(0, group.length - 3) * 2.6;
      const dx = Math.cos(angle) * radiusMeters;
      const dy = Math.sin(angle) * radiusMeters;
      return {
        ...building,
        displayLatitude: centerLat + (dy / 110540),
        displayLongitude: centerLon + (dx / (111320 * Math.max(0.2, Math.cos(centerLatRad)))),
        groupSize: group.length,
        groupIndex: index,
      };
    });
  });
}

export function CrmBuildingInventoryMap({
  buildings,
  selectedBuildingId,
  selectedBuildingIds = [],
  selectionMode = false,
  onSelectBuilding,
  onSelectionChange,
}: CrmBuildingInventoryMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const viewportKeyRef = useRef("");

  const mappedBuildings = useMemo(
    () => buildings.filter(hasCoordinates),
    [buildings],
  );
  const positionedBuildings = useMemo(
    () => spreadBuildingPins(mappedBuildings),
    [mappedBuildings],
  );
  const territoryOutline = useMemo(
    () => buildTerritoryOutline(mappedBuildings.map((building) => ({ latitude: building.latitude, longitude: building.longitude }))),
    [mappedBuildings],
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
        preferCanvas: true,
      });
      leaflet
        .tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
          maxZoom: 20,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
        })
        .addTo(map);
      leaflet
        .tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png", {
          maxZoom: 20,
          attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
        })
        .addTo(map);
      const markerLayer = leaflet.layerGroup().addTo(map);
      map.setView([30.2672, -97.7431], 11);
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
    if (positionedBuildings.length === 0) {
      map.setView([30.2672, -97.7431], 11);
      return;
    }

    const bounds = leaflet.latLngBounds([]);
    if (territoryOutline.length >= 3) {
      const polygon = leaflet.polygon(
        territoryOutline.map((point) => [point.latitude, point.longitude] as [number, number]),
        {
          color: "#1459b6",
          weight: 5,
          opacity: 0.96,
          fillColor: "#50baf0",
          fillOpacity: 0.08,
          lineJoin: "round",
          className: "crm-building-territory",
        },
      );
      polygon.addTo(layer);
      bounds.extend(polygon.getBounds());
    }

    const nextViewportKey = JSON.stringify({
      ids: positionedBuildings.map((building) => building.id).sort(),
      selectedIds: [...selectedBuildingIds].sort(),
      territory: territoryOutline
        .map((point) => ({
          latitude: Number(point.latitude.toFixed(6)),
          longitude: Number(point.longitude.toFixed(6)),
        }))
        .sort((left, right) => (left.longitude - right.longitude) || (left.latitude - right.latitude)),
    });

    for (const building of positionedBuildings) {
      const isMultiSelected = selectedBuildingIds.includes(building.id);
      const isSelected = building.id === selectedBuildingId || isMultiSelected;
      const classTone = asText(building.buildingClass).toUpperCase() === "B"
        ? {
            fill: "#2f5ca8",
            border: "#ffffff",
            glow: "rgba(47,92,168,0.24)",
            accent: "#d7e5ff",
            badge: "#1e3f79",
          }
        : {
            fill: "#3c63b7",
            border: "#ffffff",
            glow: "rgba(60,99,183,0.26)",
            accent: "#f6fbff",
            badge: "#0d3f8c",
          };
      const classLabel = asText(building.buildingClass).toUpperCase() || "O";
      const pinSize = isSelected ? 32 : 26;
      const fanBadge = building.groupSize > 1
        ? `<span style="position:absolute;top:-9px;right:-9px;display:flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:9999px;background:${classTone.badge};border:2px solid rgba(255,255,255,0.92);font-size:10px;font-weight:700;color:white;padding:0 5px;box-shadow:0 10px 22px rgba(15,23,42,0.22);">${building.groupSize}</span>`
        : "";
      const marker = leaflet
        .marker([building.displayLatitude, building.displayLongitude], {
          icon: leaflet.divIcon({
            className: isSelected ? "crm-building-pin-selected" : "crm-building-pin",
            html: `
              <span style="display:flex;flex-direction:column;align-items:center;transform:translateY(-8px);">
                ${isSelected ? `<span style="margin-bottom:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(6,19,40,0.92);padding:5px 10px;border-radius:9999px;color:#f8fafc;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;white-space:nowrap;box-shadow:0 10px 28px rgba(15,23,42,0.26);max-width:160px;overflow:hidden;text-overflow:ellipsis;">${asText(building.name) || "Building"}</span>` : ""}
                <span style="display:block;position:relative;width:${pinSize}px;height:${pinSize}px;background:linear-gradient(180deg,#4f75c6 0%,${classTone.fill} 100%);border:3px solid ${classTone.border};transform:rotate(45deg);box-shadow:0 0 0 ${isSelected ? 8 : 4}px ${classTone.glow},0 12px 18px rgba(15,23,42,0.18);border-radius:3px;">
                  ${fanBadge}
                  <span style="position:absolute;inset:5px;transform:rotate(-45deg);display:flex;align-items:flex-end;justify-content:center;gap:2px;">
                    <span style="width:4px;height:${isSelected ? 11 : 9}px;border-radius:2px 2px 0 0;background:${classTone.accent};"></span>
                    <span style="width:4px;height:${isSelected ? 16 : 13}px;border-radius:2px 2px 0 0;background:white;"></span>
                    <span style="width:4px;height:${isSelected ? 10 : 8}px;border-radius:2px 2px 0 0;background:${classTone.accent};"></span>
                  </span>
                </span>
                <span style="margin-top:7px;border:1px solid rgba(20,89,182,0.2);background:rgba(255,255,255,0.92);padding:2px 7px;border-radius:9999px;color:#174ea6;font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;box-shadow:0 5px 12px rgba(15,23,42,0.08);">${classLabel}</span>
              </span>
            `,
            iconSize: [pinSize + 48, pinSize + (isSelected ? 86 : 54)],
            iconAnchor: [(pinSize + 48) / 2, pinSize + 23],
          }),
        })
        .addTo(layer);
      if (isSelected) marker.setZIndexOffset(1000);
      marker.bindTooltip(`${building.name}${building.groupSize > 1 ? ` · cluster ${building.groupIndex + 1}/${building.groupSize}` : ""}${building.address ? ` - ${building.address}` : ""}`, {
        direction: "top",
        sticky: true,
      });
      marker.on("click", () => {
        if (selectionMode && onSelectionChange) {
          const nextIds = isMultiSelected
            ? selectedBuildingIds.filter((id) => id !== building.id)
            : [...selectedBuildingIds, building.id];
          onSelectionChange(nextIds);
          return;
        }
        onSelectBuilding(building.id);
      });
      bounds.extend([building.displayLatitude, building.displayLongitude]);
    }

    if (viewportKeyRef.current !== nextViewportKey) {
      viewportKeyRef.current = nextViewportKey;
      if (positionedBuildings.length === 1) {
        map.setView([positionedBuildings[0].displayLatitude, positionedBuildings[0].displayLongitude], 13);
      } else {
        map.fitBounds(bounds.pad(0.16));
      }
    }

    window.setTimeout(() => map.invalidateSize(), 60);
  }, [onSelectBuilding, onSelectionChange, positionedBuildings, selectedBuildingId, selectedBuildingIds, selectionMode, territoryOutline]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
        <p>
          Pinned {mappedBuildings.length} of {buildings.length} Austin office building{buildings.length === 1 ? "" : "s"}.
        </p>
        <p className="text-slate-400">Diamond markers reflect your CRM branding, blue territory lines frame the inventory pocket, and badges show dense building clusters.</p>
      </div>
      <div ref={mapContainerRef} className="h-[440px] w-full overflow-hidden border border-white/20 bg-[#dbeaf0]" />
      {mappedBuildings.length < buildings.length ? (
        <p className="text-xs text-amber-300">
          {buildings.length - mappedBuildings.length} building{buildings.length - mappedBuildings.length === 1 ? "" : "s"} did not include usable latitude/longitude in the current import.
        </p>
      ) : null}
    </div>
  );
}
