import { type Circle, circleRing, type LatLng } from "@seekhunt/shared";
import type { Feature, FeatureCollection } from "geojson";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

export interface MapPlayer {
  id: string;
  name: string;
  pos: LatLng;
  kind: "me" | "seeker" | "hider" | "revealed";
}

interface Props {
  zone: Circle | null;
  nextZone?: Circle | null;
  pings?: { area: Circle; label: string; kind: "seeker" | "hider" }[];
  players?: MapPlayer[];
  /** Fit the view to this circle when it changes identity (e.g. lobby zone edits). */
  focus?: Circle | null;
  onTap?: (p: LatLng) => void;
}

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const empty: FeatureCollection = { type: "FeatureCollection", features: [] };

const polygon = (c: Circle, props: Record<string, unknown> = {}): Feature => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Polygon", coordinates: [circleRing(c)] },
});

/** Everything outside the zone gets shaded: a world polygon with the zone as a hole. */
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

function fit(map: maplibregl.Map, c: Circle) {
  const ring = circleRing(c, 16);
  const bounds = ring.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(ring[0], ring[0]));
  map.fitBounds(bounds, { padding: 40, duration: 600 });
}

export function GameMap({ zone, nextZone, pings = [], players = [], focus, onTap }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  const data = useRef({ zone, nextZone, pings, players });
  data.current = { zone, nextZone, pings, players };

  const render = () => {
    const map = mapRef.current;
    if (!map || !ready.current) return;
    const d = data.current;
    const set = (id: string, fc: FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(fc);
    set("mask", d.zone ? { type: "FeatureCollection", features: [outsideMask(d.zone)] } : empty);
    set("zone", d.zone ? { type: "FeatureCollection", features: [polygon(d.zone)] } : empty);
    set("next", d.nextZone ? { type: "FeatureCollection", features: [polygon(d.nextZone)] } : empty);
    set("pings", { type: "FeatureCollection", features: d.pings.map((p) => polygon(p.area, { label: p.label, kind: p.kind })) });
    set("players", {
      type: "FeatureCollection",
      features: d.players.map((p) => ({
        type: "Feature",
        properties: { name: p.name, kind: p.kind },
        geometry: { type: "Point", coordinates: [p.pos.lng, p.pos.lat] },
      })),
    });
  };

  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: STYLE,
      center: zone ? [zone.center.lng, zone.center.lat] : [-0.3763, 39.4699],
      zoom: 14,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("click", (e: MapMouseEvent) => onTapRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    map.on("load", () => {
      for (const id of ["mask", "zone", "next", "pings", "players"]) map.addSource(id, { type: "geojson", data: empty });
      map.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": "#ff2d46", "fill-opacity": 0.22 } });
      map.addLayer({ id: "zone-line", type: "line", source: "zone", paint: { "line-color": "#ff2d46", "line-width": 3 } });
      map.addLayer({ id: "next-line", type: "line", source: "next", paint: { "line-color": "#ffffff", "line-width": 2.5, "line-dasharray": [2, 2] } });
      map.addLayer({
        id: "pings",
        type: "fill",
        source: "pings",
        paint: { "fill-color": ["match", ["get", "kind"], "seeker", "#ff8a00", "#ffd23f"], "fill-opacity": 0.3, "fill-outline-color": "#ff8a00" },
      });
      map.addLayer({
        id: "players",
        type: "circle",
        source: "players",
        paint: {
          "circle-radius": ["match", ["get", "kind"], "me", 9, 7],
          "circle-color": ["match", ["get", "kind"], "me", "#2f80ff", "seeker", "#ff2d46", "revealed", "#ffd23f", "#3ddc97"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2.5,
        },
      });
      map.addLayer({
        id: "player-labels",
        type: "symbol",
        source: "players",
        layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.4], "text-anchor": "top", "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": "#111", "text-halo-color": "#fff", "text-halo-width": 1.5 },
      });
      map.addLayer({
        id: "ping-labels",
        type: "symbol",
        source: "pings",
        layout: { "text-field": ["get", "label"], "text-size": 12, "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": "#5a3200", "text-halo-color": "#fff", "text-halo-width": 1.5 },
      });
      ready.current = true;
      render();
      if (focus ?? zone) fit(map, (focus ?? zone)!);
    });
    return () => {
      ready.current = false;
      map.remove();
    };
    // The map instance lives for the component's lifetime; data flows in through render().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(render, [zone, nextZone, pings, players]);

  const focusKey = focus ? `${focus.center.lat},${focus.center.lng},${focus.radius}` : "";
  useEffect(() => {
    if (focus && mapRef.current && ready.current) fit(mapRef.current, focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  return <div ref={el} className="map" />;
}
