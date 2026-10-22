import { type Circle, circleRing, type LatLng } from "@seekhunt/shared";
import type { Feature, FeatureCollection } from "geojson";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { initials } from "./ui";

export interface MapPlayer {
  id: string;
  name: string;
  pos: LatLng;
  kind: "me" | "seeker" | "hider" | "revealed" | "sos";
}

export interface MapPing {
  area: Circle;
  label: string;
  kind: "seeker" | "hider";
}

interface Props {
  zone: Circle | null;
  nextZone?: Circle | null;
  pings?: MapPing[];
  players?: MapPlayer[];
  /** Fit the view to this circle on load and whenever its value changes. */
  focus?: Circle | null;
  /** Extra padding so fitted content clears floating UI. */
  padding?: { top: number; bottom: number; left: number; right: number };
  /** Refit to `focus` only when this changes (defaults to any change of focus). */
  refitKey?: string | number;
  /** Where the (collapsed) OSM attribution sits, away from floating UI. */
  attribution?: "top-right" | "bottom-left" | "bottom-right";
  onTap?: (p: LatLng) => void;
}

export interface MapHandle {
  flyTo: (p: LatLng) => void;
  fit: (c: Circle) => void;
}

const DARK = matchMedia("(prefers-color-scheme: dark)").matches;
const STYLE = `https://tiles.openfreemap.org/styles/${DARK ? "dark" : "positron"}`;
const C = DARK
  ? { mask: "#000000", maskOpacity: 0.45, zone: "#ff6a2c", next: "#f1f2f4", label: "#f1f2f4", halo: "#17191c" }
  : { mask: "#121417", maskOpacity: 0.2, zone: "#ff5714", next: "#121417", label: "#121417", halo: "#ffffff" };

const empty: FeatureCollection = { type: "FeatureCollection", features: [] };
const polygon = (c: Circle, props: Record<string, unknown> = {}): Feature => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Polygon", coordinates: [circleRing(c)] },
});
/** Everything outside the zone is dimmed: a world polygon with the zone cut out. */
const outsideMask = (c: Circle): Feature => ({
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]],
      circleRing(c).reverse(),
    ],
  },
});

function boundsOf(c: Circle) {
  const ring = circleRing(c, 16);
  return ring.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(ring[0], ring[0]));
}

function markerEl(p: MapPlayer): HTMLElement {
  const el = document.createElement("div");
  if (p.kind === "me") {
    el.className = "mk-me";
  } else {
    el.className = `mk ${p.kind}`;
    el.textContent = initials(p.name);
    el.title = p.name;
  }
  return el;
}

export const GameMap = forwardRef<MapHandle, Props>(function GameMap({ zone, nextZone, pings = [], players = [], focus, padding, refitKey, attribution = "bottom-right", onTap }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; kind: string }>());
  const ready = useRef(false);
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const data = useRef({ zone, nextZone, pings });
  data.current = { zone, nextZone, pings };
  const pad = padding ?? { top: 40, bottom: 40, left: 40, right: 40 };

  useImperativeHandle(ref, () => ({
    flyTo: (p) => mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: Math.max(mapRef.current.getZoom(), 16), duration: 700 }),
    fit: (c) => mapRef.current?.fitBounds(boundsOf(c), { padding: pad, duration: 700 }),
  }));

  const renderShapes = () => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const d = data.current;
    const set = (id: string, fc: FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(fc);
    set("mask", d.zone ? { type: "FeatureCollection", features: [outsideMask(d.zone)] } : empty);
    set("zone", d.zone ? { type: "FeatureCollection", features: [polygon(d.zone)] } : empty);
    set("next", d.nextZone ? { type: "FeatureCollection", features: [polygon(d.nextZone)] } : empty);
    set("pings", { type: "FeatureCollection", features: d.pings.map((p) => polygon(p.area, { label: p.label, kind: p.kind })) });
  };

  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: STYLE,
      center: zone ? [zone.center.lng, zone.center.lat] : [-0.3763, 39.4699],
      zoom: 14,
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), attribution);
    mapRef.current = map;
    map.on("click", (e: MapMouseEvent) => onTapRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    map.on("load", () => {
      for (const id of ["mask", "zone", "next", "pings"]) map.addSource(id, { type: "geojson", data: empty });
      map.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": C.mask, "fill-opacity": C.maskOpacity } });
      map.addLayer({ id: "zone-fill", type: "fill", source: "zone", paint: { "fill-color": C.zone, "fill-opacity": 0.04 } });
      map.addLayer({ id: "zone-line", type: "line", source: "zone", paint: { "line-color": C.zone, "line-width": 3 } });
      map.addLayer({ id: "next-line", type: "line", source: "next", paint: { "line-color": C.next, "line-width": 2, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "pings", type: "fill", source: "pings", paint: { "fill-color": C.zone, "fill-opacity": 0.16 } });
      map.addLayer({ id: "pings-line", type: "line", source: "pings", paint: { "line-color": C.zone, "line-width": 1.5, "line-dasharray": [1, 1] } });
      map.addLayer({
        id: "ping-labels",
        type: "symbol",
        source: "pings",
        layout: { "text-field": ["get", "label"], "text-size": 12, "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.5 },
      });
      // Start collapsed to the (i) button; it still expands on tap.
      el.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      ready.current = true;
      renderShapes();
      const f = focus ?? zone;
      if (f) map.fitBounds(boundsOf(f), { padding: pad, duration: 0 });
    });
    return () => {
      ready.current = false;
      markers.current.clear();
      map.remove();
    };
    // The map instance lives for the component's lifetime; data flows in through effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(renderShapes, [zone, nextZone, pings]);

  // Players are DOM markers (initials avatars), diffed by id so they glide instead of blinking.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      const existing = markers.current.get(p.id);
      if (existing && existing.kind === p.kind) {
        existing.marker.setLngLat([p.pos.lng, p.pos.lat]);
      } else {
        existing?.marker.remove();
        const marker = new maplibregl.Marker({ element: markerEl(p) }).setLngLat([p.pos.lng, p.pos.lat]).addTo(map);
        markers.current.set(p.id, { marker, kind: p.kind });
      }
    }
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) {
        m.marker.remove();
        markers.current.delete(id);
      }
    }
  }, [players]);

  const focusKey = refitKey ?? (focus ? `${focus.center.lat},${focus.center.lng},${focus.radius}` : "");
  useEffect(() => {
    if (focus && mapRef.current && ready.current) mapRef.current.fitBounds(boundsOf(focus), { padding: pad, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  return <div ref={el} className="map" />;
});
