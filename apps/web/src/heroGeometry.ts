import { buildSchedule, DEFAULT_CONFIG, type LatLng, sanitizeConfig } from "@seekhunt/shared";

// The home hero is a real map render (scripts/hero-map.mjs) with the real zone algorithm on top.
// Both read these constants, so the circles land on the same streets as in a game.
export const HERO_CENTER: LatLng = { lat: 39.4745, lng: -0.3763 };
export const HERO_ZOOM = 14.6;
export const HERO_SIZE = { w: 1400, h: 1750 };

const EARTH_CIRCUMFERENCE = 40_075_016.686;
const metersPerPixel = (EARTH_CIRCUMFERENCE * Math.cos((HERO_CENTER.lat * Math.PI) / 180)) / (512 * 2 ** HERO_ZOOM);

/** Web Mercator projection relative to the image centre, in image pixels. */
function toPixels(p: LatLng) {
  const worldX = (lng: number) => ((lng + 180) / 360) * 512 * 2 ** HERO_ZOOM;
  const worldY = (lat: number) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 512 * 2 ** HERO_ZOOM;
  };
  return {
    x: HERO_SIZE.w / 2 + worldX(p.lng) - worldX(HERO_CENTER.lng),
    y: HERO_SIZE.h / 2 + worldY(p.lat) - worldY(HERO_CENTER.lat),
  };
}

const config = sanitizeConfig({ zone: { center: HERO_CENTER, radius: 750 }, shrinkCount: 5, finalRadius: 70 }, DEFAULT_CONFIG);

/** Every zone of a sample game, in image pixels: [outer, …, final]. */
export const HERO_ZONES = buildSchedule(config, 1407, 0).map((s) => ({ ...toPixels(s.circle.center), r: s.circle.radius / metersPerPixel, meters: Math.round(s.circle.radius) }));
