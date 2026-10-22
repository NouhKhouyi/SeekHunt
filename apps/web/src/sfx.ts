import type { EventKind } from "@seekhunt/shared";

/**
 * Tiny synthesized cues (no audio files). iOS only lets audio start inside a user gesture,
 * so the context is created and resumed on the first tap anywhere.
 */
let ctx: AudioContext | null = null;

function unlock() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
  } catch {
    // No Web Audio: cues are optional.
  }
}
window.addEventListener("pointerdown", unlock, { passive: true });

function tone(freq: number, at: number, dur: number, gain = 0.18, type: OscillatorType = "sine") {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const CUES: Partial<Record<EventKind, () => void>> = {
  zone: () => (tone(880, 0, 0.16), tone(880, 0.22, 0.16)),
  warn: () => (tone(660, 0, 0.14, 0.2, "triangle"), tone(990, 0.16, 0.22, 0.2, "triangle")),
  ping: () => tone(1320, 0, 0.35, 0.12),
  catch: () => (tone(523, 0, 0.12), tone(392, 0.14, 0.26)),
  elim: () => tone(220, 0, 0.45, 0.2, "sawtooth"),
  sos: () => [0, 0.25, 0.5].forEach((d) => tone(1046, d, 0.16, 0.22, "square")),
  end: () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.12, 0.5, 0.14)),
};

const VIBRATION: Partial<Record<EventKind, number[]>> = {
  zone: [200, 100, 200],
  warn: [300, 100, 300],
  catch: [120],
  elim: [500],
  sos: [400, 150, 400, 150, 400],
  end: [200, 100, 200],
};

export function cue(kind: EventKind) {
  CUES[kind]?.();
  const pattern = VIBRATION[kind];
  if (pattern) navigator.vibrate?.(pattern);
}
