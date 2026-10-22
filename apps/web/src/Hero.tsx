import { useEffect, useState } from "react";
import { HERO_SIZE, HERO_ZONES } from "./heroGeometry";

const STEP_MS = 2600;
const LAST = HERO_ZONES.length - 1;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Unit circle placed with a transform, so position and radius animate together on the GPU. */
const place = (z: { x: number; y: number; r: number }) => ({ transform: `translate(${z.x}px, ${z.y}px) scale(${z.r})` });

/**
 * A real city with a sample game playing out: the zone closes step by step, exactly as the
 * schedule generator would do it, then the loop starts again.
 */
export function Hero() {
  const [step, setStep] = useState(reducedMotion ? 2 : 0);

  useEffect(() => {
    if (reducedMotion) return;
    const t = setInterval(() => setStep((s) => (s >= LAST + 1 ? 0 : s + 1)), STEP_MS);
    return () => clearInterval(t);
  }, []);

  // One extra beat on the final zone before looping back.
  const i = Math.min(step, LAST);
  const zone = HERO_ZONES[i]!;
  const next = HERO_ZONES[i + 1];

  return (
    <figure className="hero">
      <svg viewBox={`0 0 ${HERO_SIZE.w} ${HERO_SIZE.h}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label="Mapa de Valencia con la zona de juego cerrándose por fases">
        <defs>
          <mask id="hero-outside">
            <rect width={HERO_SIZE.w} height={HERO_SIZE.h} fill="#fff" />
            <circle className="hero-move" cx="0" cy="0" r="1" fill="#000" style={place(zone)} />
          </mask>
        </defs>
        <image className="hero-map light" href="/hero-light.webp" width={HERO_SIZE.w} height={HERO_SIZE.h} />
        <image className="hero-map dark" href="/hero-dark.webp" width={HERO_SIZE.w} height={HERO_SIZE.h} />
        <rect className="hero-dim" width={HERO_SIZE.w} height={HERO_SIZE.h} mask="url(#hero-outside)" />
        {next && <circle className="hero-move hero-next" cx="0" cy="0" r="1" style={place(next)} />}
        <circle className="hero-move hero-zone" cx="0" cy="0" r="1" style={place(zone)} />
        <circle className={`hero-survivor${i === LAST ? " on" : ""}`} cx={HERO_ZONES[LAST]!.x} cy={HERO_ZONES[LAST]!.y} r="11" />
      </svg>
      <figcaption>
        <span>Valencia, Ciutat Vella</span>
        <span className="num" aria-live="off">
          {i === 0 ? "Zona inicial" : i === LAST ? "Zona final" : `Cierre ${i} de ${LAST}`}, {zone.meters}&nbsp;m
        </span>
      </figcaption>
      <small className="hero-credit">© OpenStreetMap, OpenMapTiles, OpenFreeMap</small>
    </figure>
  );
}
