import type { Circle } from "./geo";

export interface GameConfig {
  /** Initial play area. */
  zone: Circle;
  /** Head start for hiders before the seeker is released. */
  hideSeconds: number;
  /** How many times the zone shrinks. */
  shrinkCount: number;
  /** Time between the start of consecutive shrinks. */
  shrinkIntervalSeconds: number;
  /** How long each shrink takes to animate from old to new circle. */
  shrinkDurationSeconds: number;
  /** Radius after the last shrink. */
  finalRadius: number;
  /** Extra time after the last shrink before survivors win. */
  finalHoldSeconds: number;
  /** A hider outside the zone longer than this is eliminated. */
  outOfZoneGraceSeconds: number;
  /** Every N seconds seekers get a fuzzy area for each hider and hiders see the seekers. 0 disables. */
  pingIntervalSeconds: number;
  /** Radius of the fuzzy circle shown to seekers on a ping. */
  pingFuzzMeters: number;
  /** A hider without location updates for this long is revealed at their last known position. */
  staleLocationSeconds: number;
  /** Caught hiders join the seekers ("zombie" mode). */
  caughtBecomeSeekers: boolean;
  /** The game ends as soon as a single hider is left standing. */
  lastSurvivorWins: boolean;
  /** Players declare which floor they are on, and the radar shows it. For games inside buildings. */
  buildingMode: boolean;
}

export const DEFAULT_CONFIG: GameConfig = {
  zone: { center: { lat: 39.4699, lng: -0.3763 }, radius: 800 },
  hideSeconds: 5 * 60,
  shrinkCount: 5,
  shrinkIntervalSeconds: 5 * 60,
  shrinkDurationSeconds: 60,
  finalRadius: 60,
  finalHoldSeconds: 5 * 60,
  outOfZoneGraceSeconds: 45,
  pingIntervalSeconds: 3 * 60,
  pingFuzzMeters: 80,
  staleLocationSeconds: 90,
  caughtBecomeSeekers: false,
  lastSurvivorWins: true,
  buildingMode: false,
};

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export const MIN_ZONE_RADIUS = 25;
export const MAX_ZONE_RADIUS = 20_000;

/** The last zone is never more than half the first one, so even a tiny play area still closes in. */
export function effectiveFinalRadius(config: GameConfig): number {
  return Math.max(5, Math.min(config.finalRadius, config.zone.radius / 2));
}

/** Merges an untrusted partial config onto `base`, clamping every value to a sane range. */
export function sanitizeConfig(input: Partial<GameConfig> | undefined, base: GameConfig): GameConfig {
  const i = input ?? {};
  const zoneIn = i.zone;
  const zone: Circle =
    zoneIn && zoneIn.center
      ? {
          center: {
            lat: clamp(zoneIn.center.lat, -85, 85, base.zone.center.lat),
            lng: clamp(zoneIn.center.lng, -180, 180, base.zone.center.lng),
          },
          radius: Math.round(clamp(zoneIn.radius, MIN_ZONE_RADIUS, MAX_ZONE_RADIUS, base.zone.radius)),
        }
      : base.zone;
  const shrinkIntervalSeconds = clamp(i.shrinkIntervalSeconds, 30, 3600, base.shrinkIntervalSeconds);
  return {
    zone,
    hideSeconds: clamp(i.hideSeconds, 0, 3600, base.hideSeconds),
    shrinkCount: Math.round(clamp(i.shrinkCount, 0, 20, base.shrinkCount)),
    shrinkIntervalSeconds,
    shrinkDurationSeconds: clamp(i.shrinkDurationSeconds, 0, shrinkIntervalSeconds, base.shrinkDurationSeconds),
    // Kept as chosen; effectiveFinalRadius() fits it to the zone at play time, so shrinking the zone
    // and growing it back doesn't lose the setting.
    finalRadius: clamp(i.finalRadius, 5, MAX_ZONE_RADIUS, base.finalRadius),
    finalHoldSeconds: clamp(i.finalHoldSeconds, 0, 3600, base.finalHoldSeconds),
    outOfZoneGraceSeconds: clamp(i.outOfZoneGraceSeconds, 0, 600, base.outOfZoneGraceSeconds),
    pingIntervalSeconds: clamp(i.pingIntervalSeconds, 0, 3600, base.pingIntervalSeconds),
    pingFuzzMeters: clamp(i.pingFuzzMeters, 0, 2000, base.pingFuzzMeters),
    staleLocationSeconds: clamp(i.staleLocationSeconds, 15, 3600, base.staleLocationSeconds),
    caughtBecomeSeekers: typeof i.caughtBecomeSeekers === "boolean" ? i.caughtBecomeSeekers : base.caughtBecomeSeekers,
    lastSurvivorWins: typeof i.lastSurvivorWins === "boolean" ? i.lastSurvivorWins : base.lastSurvivorWins,
    // `?? false`: rooms saved before this option existed have no value for it.
    buildingMode: typeof i.buildingMode === "boolean" ? i.buildingMode : (base.buildingMode ?? false),
  };
}
