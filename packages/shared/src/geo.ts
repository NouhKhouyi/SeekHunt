export interface LatLng {
  lat: number;
  lng: number;
}

export interface Circle {
  center: LatLng;
  /** Radius in meters. */
  radius: number;
}

const EARTH_RADIUS = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in meters. */
export function distance(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Moves a point by (east, north) meters. Accurate enough at game scale (< ~20 km). */
export function offset(p: LatLng, eastMeters: number, northMeters: number): LatLng {
  const dLat = northMeters / EARTH_RADIUS;
  const dLng = eastMeters / (EARTH_RADIUS * Math.cos(toRad(p.lat)));
  return { lat: p.lat + toDeg(dLat), lng: p.lng + toDeg(dLng) };
}

/** Uniformly random point within `radius` meters of `center`. */
export function randomPointInCircle(center: LatLng, radius: number, rand: () => number): LatLng {
  const r = radius * Math.sqrt(rand());
  const theta = 2 * Math.PI * rand();
  return offset(center, r * Math.cos(theta), r * Math.sin(theta));
}

export function isInside(p: LatLng, c: Circle): boolean {
  return distance(p, c.center) <= c.radius;
}

/** Polygon ring approximating a circle, as [lng, lat] pairs (GeoJSON order), closed. */
export function circleRing(c: Circle, steps = 96): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (2 * Math.PI * i) / steps;
    const p = offset(c.center, c.radius * Math.cos(theta), c.radius * Math.sin(theta));
    ring.push([p.lng, p.lat]);
  }
  return ring;
}
