import { type Circle, circleRing, type LatLng } from "@seekhunt/shared";
import type { Feature, FeatureCollection } from "geojson";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapMouseEvent, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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
  /** When the radar fired: a new value plays the pulse animation once. */
  at?: number;
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
  /** The zone is closing right now: its edge pulses. */
  shrinking?: boolean;
  /** The game is paused: the map goes grey. */
  paused?: boolean;
  onTap?: (p: LatLng) => void;
}

export interface MapHandle {
  flyTo: (p: LatLng) => void;
  fit: (c: Circle) => void;
}

const DARK = matchMedia("(prefers-color-scheme: dark)").matches;
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const STYLE = `https://tiles.openfreemap.org/styles/${DARK ? "dark" : "positron"}`;

// MapLibre v6 looks for its worker next to its own module; once bundled that file isn't there,
// so ship it as an asset and point MapLibre at it.
maplibregl.setWorkerUrl(workerUrl);

let styleRequest: Promise<StyleSpecification | string> | null = null;
/**
 * The style is fetched once and trimmed before MapLibre sees it: highway shields add nothing on foot
 * and their filters log warnings while the style is parsed. Falls back to the URL if the fetch fails.
 */
function loadStyle() {
  styleRequest ??= fetch(STYLE)
    .then((r) => (r.ok ? (r.json() as Promise<StyleSpecification>) : Promise.reject(new Error(String(r.status)))))
    .then((s): StyleSpecification => ({ ...s, layers: s.layers.filter((l) => !l.id.includes("shield")) }))
    .catch(() => STYLE);
  return styleRequest;
}
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

/**
 * Diagonal hazard stripes for everything outside the zone. Lines every 8 px on a 16 px tile with
 * slope 1 tile seamlessly, so the pattern reads as one continuous surface.
 */
function hazardImage(color: string) {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.strokeStyle = color;
  g.lineWidth = 2.5;
  g.beginPath();
  for (let o = -size; o <= size * 2; o += 8) {
    g.moveTo(o, size);
    g.lineTo(o + size, 0);
  }
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

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

export const GameMap = forwardRef<MapHandle, Props>(function GameMap({ zone, nextZone, pings = [], players = [], focus, padding, refitKey, attribution = "bottom-right", shrinking = false, paused = false, onTap }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; kind: string }>());
  const ready = useRef(false);
  // The map is created after the style arrives; markers wait for it.
  const [mapReady, setMapReady] = useState(false);
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const data = useRef({ zone, nextZone, pings });
  data.current = { zone, nextZone, pings };
  const pad = padding ?? { top: 40, bottom: 40, left: 40, right: 40 };

  // Camera requests that arrive before the map has loaded (e.g. the first GPS fix) are kept and run on load.
  const pendingCamera = useRef<((map: maplibregl.Map) => void) | null>(null);
  const camera = (move: (map: maplibregl.Map) => void) => {
    if (mapRef.current && ready.current) move(mapRef.current);
    else pendingCamera.current = move;
  };

  useImperativeHandle(ref, () => ({
    flyTo: (p) => camera((map) => map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 16), duration: 700 })),
    fit: (c) => camera((map) => map.fitBounds(boundsOf(c), { padding: pad, duration: 700 })),
  }));

  const renderShapes = () => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const d = data.current;
    const set = (id: string, fc: FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(fc);
    set("mask", d.zone ? { type: "FeatureCollection", features: [outsideMask(d.zone)] } : empty);
    set("zone", d.zone ? { type: "FeatureCollection", features: [polygon(d.zone)] } : empty);
    set("next", d.nextZone ? { type: "FeatureCollection", features: [polygon(d.nextZone)] } : empty);
    set("pings", { type: "FeatureCollection", features: d.pings.map((p) => polygon(p.area, { kind: p.kind })) });
    set("ping-points", {
      type: "FeatureCollection",
      features: d.pings.map((p) => ({ type: "Feature", properties: { label: p.label, kind: p.kind }, geometry: { type: "Point", coordinates: [p.area.center.lng, p.area.center.lat] } })),
    });
  };

  useEffect(() => {
    let map: maplibregl.Map | undefined;
    let cancelled = false;
    loadStyle().then((style) => {
      if (cancelled || !el.current) return;
      map = init(el.current, style);
    });
    return () => {
      cancelled = true;
      ready.current = false;
      markers.current.clear();
      map?.remove();
      mapRef.current = null;
    };
    // The map instance lives for the component's lifetime; data flows in through effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function init(container: HTMLElement, style: StyleSpecification | string) {
    const map = new maplibregl.Map({
      container,
      style,
      center: zone ? [zone.center.lng, zone.center.lat] : [-0.3763, 39.4699],
      zoom: 14,
      attributionControl: false,
      pitchWithRotate: false,
      // The hosted style is known-good; skipping validation saves work on load.
      validateStyle: false,
      dragRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), attribution);
    mapRef.current = map;
    setMapReady(true);
    map.on("click", (e: MapMouseEvent) => onTapRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    map.on("load", () => {
      for (const id of ["mask", "zone", "next", "pings", "ping-points"]) map.addSource(id, { type: "geojson", data: empty });
      map.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": C.mask, "fill-opacity": C.maskOpacity } });
      map.addImage("hazard", hazardImage(C.zone), { pixelRatio: 2 });
      map.addLayer({ id: "mask-hatch", type: "fill", source: "mask", paint: { "fill-pattern": "hazard", "fill-opacity": DARK ? 0.22 : 0.16 } });
      map.addLayer({ id: "zone-fill", type: "fill", source: "zone", paint: { "fill-color": C.zone, "fill-opacity": 0.04 } });
      map.addLayer({ id: "zone-line", type: "line", source: "zone", paint: { "line-color": C.zone, "line-width": 3 } });
      map.addLayer({ id: "next-line", type: "line", source: "next", paint: { "line-color": C.next, "line-width": 2, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "pings", type: "fill", source: "pings", paint: { "fill-color": C.zone, "fill-opacity": 0.16 } });
      map.addLayer({ id: "pings-line", type: "line", source: "pings", paint: { "line-color": C.zone, "line-width": 1.5, "line-dasharray": [1, 1] } });
      // A precise radar circle can be a few metres wide: always mark its centre so it can't vanish at city zoom.
      map.addLayer({
        id: "ping-dots",
        type: "circle",
        source: "ping-points",
        paint: { "circle-radius": 6, "circle-color": C.zone, "circle-stroke-color": C.halo, "circle-stroke-width": 2 },
      });
      map.addLayer({
        id: "ping-labels",
        type: "symbol",
        source: "ping-points",
        layout: { "text-field": ["get", "label"], "text-size": 12, "text-font": ["Noto Sans Bold"], "text-offset": [0, 1.2], "text-anchor": "top" },
        paint: { "text-color": C.label, "text-halo-color": C.halo, "text-halo-width": 1.5 },
      });
      // Start collapsed to the (i) button; it still expands on tap.
      el.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      ready.current = true;
      renderShapes();
      const f = focus ?? zone;
      if (f) map.fitBounds(boundsOf(f), { padding: pad, duration: 0 });
      pendingCamera.current?.(map);
      pendingCamera.current = null;
    });
    return map;
  }

  useEffect(renderShapes, [zone, nextZone, pings]);

  // While the zone closes, its edge thickens and breathes, so the moment is felt even at a glance.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready.current || !map.getLayer("zone-line")) return;
    map.setPaintProperty("zone-line", "line-width", shrinking ? 5 : 3);
    if (!shrinking || REDUCED_MOTION) {
      map.setPaintProperty("zone-line", "line-opacity", 1);
      return;
    }
    let on = false;
    const timer = setInterval(() => {
      on = !on;
      if (map.getLayer("zone-line")) map.setPaintProperty("zone-line", "line-opacity", on ? 0.35 : 1);
    }, 650);
    return () => {
      clearInterval(timer);
      if (map.getLayer("zone-line")) map.setPaintProperty("zone-line", "line-opacity", 1);
    };
  }, [shrinking, mapReady]);

  // A fresh radar plays a sonar pulse on every circle it reveals. Pings already on screen when the
  // map opens (a reload) stay still.
  const pingKey = pings.map((p) => p.at ?? 0).join(",");
  const seenPings = useRef(pingKey);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || pingKey === seenPings.current) return;
    seenPings.current = pingKey;
    if (REDUCED_MOTION) return;
    const pulses = data.current.pings.map((p) => {
      const el = document.createElement("div");
      el.className = `ping-pulse ${p.kind}`;
      el.innerHTML = "<i></i><i></i><i></i>";
      return new maplibregl.Marker({ element: el }).setLngLat([p.area.center.lng, p.area.center.lat]).addTo(map);
    });
    const timer = setTimeout(() => pulses.forEach((m) => m.remove()), 3200);
    return () => {
      clearTimeout(timer);
      pulses.forEach((m) => m.remove());
    };
  }, [pingKey]);

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
  }, [players, mapReady]);

  const focusKey = refitKey ?? (focus ? `${focus.center.lat},${focus.center.lng},${focus.radius}` : "");
  useEffect(() => {
    if (focus && mapRef.current && ready.current) mapRef.current.fitBounds(boundsOf(focus), { padding: pad, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  return <div ref={el} className={`map${paused ? " paused" : ""}`} />;
});
