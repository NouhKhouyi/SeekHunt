import type { GameConfig } from "./config";
import { type Circle, randomPointInCircle } from "./geo";
import { mulberry32 } from "./rng";

export interface ZoneStep {
  circle: Circle;
  /** When the shrink towards this circle begins (ms epoch). Step 0 has shrinkStart = shrinkEnd = seekStart. */
  shrinkStart: number;
  shrinkEnd: number;
}

/**
 * Deterministic zone schedule. Each new circle is fully contained in the previous one,
 * radii shrink geometrically from the initial radius to `finalRadius`.
 */
export function buildSchedule(config: GameConfig, seed: number, seekStart: number): ZoneStep[] {
  const rand = mulberry32(seed);
  const n = config.shrinkCount;
  const r0 = config.zone.radius;
  const rf = Math.min(config.finalRadius, r0);
  const steps: ZoneStep[] = [{ circle: config.zone, shrinkStart: seekStart, shrinkEnd: seekStart }];
  for (let k = 1; k <= n; k++) {
    const prev = steps[k - 1]!.circle;
    const radius = r0 * Math.pow(rf / r0, k / n);
    const center = randomPointInCircle(prev.center, Math.max(0, prev.radius - radius), rand);
    const shrinkStart = seekStart + k * config.shrinkIntervalSeconds * 1000;
    steps.push({ circle: { center, radius }, shrinkStart, shrinkEnd: shrinkStart + config.shrinkDurationSeconds * 1000 });
  }
  return steps;
}

/** When survivors win if nobody else ended the game first. */
export function gameDeadline(schedule: ZoneStep[], config: GameConfig): number {
  return schedule[schedule.length - 1]!.shrinkEnd + config.finalHoldSeconds * 1000;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface ZoneState {
  current: Circle;
  /** The next target circle, if any shrink remains. */
  next: Circle | null;
  /** Index of the step the zone is at or moving towards. */
  index: number;
  shrinking: boolean;
  /** Next shrink start, or null if none remain. */
  nextShrinkAt: number | null;
}

export function zoneAt(schedule: ZoneStep[], now: number): ZoneState {
  let i = 0;
  while (i + 1 < schedule.length && now >= schedule[i + 1]!.shrinkStart) i++;
  const step = schedule[i]!;
  const nextStep = schedule[i + 1] ?? null;
  if (i > 0 && now < step.shrinkEnd) {
    const from = schedule[i - 1]!.circle;
    const t = (now - step.shrinkStart) / Math.max(1, step.shrinkEnd - step.shrinkStart);
    return {
      current: {
        center: { lat: lerp(from.center.lat, step.circle.center.lat, t), lng: lerp(from.center.lng, step.circle.center.lng, t) },
        radius: lerp(from.radius, step.circle.radius, t),
      },
      next: step.circle,
      index: i,
      shrinking: true,
      nextShrinkAt: nextStep?.shrinkStart ?? null,
    };
  }
  return {
    current: step.circle,
    next: nextStep?.circle ?? null,
    index: i,
    shrinking: false,
    nextShrinkAt: nextStep?.shrinkStart ?? null,
  };
}
