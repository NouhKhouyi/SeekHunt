import { buildSchedule, DEFAULT_CONFIG, sanitizeConfig } from "@seekhunt/shared";

// The hero is the real zone algorithm: the same schedule a game would produce from this seed.
const CONFIG = sanitizeConfig({ shrinkCount: 5, finalRadius: 70 }, DEFAULT_CONFIG);
const STEPS = buildSchedule(CONFIG, 20261022, 0);
const R0 = CONFIG.zone.radius;
const C0 = CONFIG.zone.center;
const PAD = 70;
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG = 111_320 * Math.cos((C0.lat * Math.PI) / 180);

const project = (lat: number, lng: number) => ({ x: (lng - C0.lng) * M_PER_DEG_LNG, y: -(lat - C0.lat) * M_PER_DEG_LAT });

export function ZoneRings() {
  const size = R0 + PAD;
  const last = STEPS[STEPS.length - 1]!;
  const end = project(last.circle.center.lat, last.circle.center.lng);
  const grid = [];
  for (let v = -800; v <= 800; v += 200) grid.push(v);

  return (
    <svg className="hero-art" viewBox={`${-size} ${-size} ${size * 2} ${size * 2}`} role="img" aria-label="Cinco cierres de zona, de 800 m a 70 m de radio">
      <g stroke="currentColor" strokeOpacity="0.07" strokeWidth="2">
        {grid.map((v) => (
          <g key={v}>
            <line x1={v} x2={v} y1={-size} y2={size} />
            <line y1={v} y2={v} x1={-size} x2={size} />
          </g>
        ))}
      </g>
      {STEPS.map((s, i) => {
        const p = project(s.circle.center.lat, s.circle.center.lng);
        const isLast = i === STEPS.length - 1;
        return (
          <circle
            key={i}
            className="ring"
            style={{ animationDelay: `${i * 140}ms` }}
            cx={p.x}
            cy={p.y}
            r={s.circle.radius}
            fill={isLast ? "var(--blaze)" : "none"}
            fillOpacity={isLast ? 0.18 : 0}
            stroke={isLast ? "var(--blaze)" : "currentColor"}
            strokeWidth={i === 0 ? 7 : isLast ? 7 : 4}
            strokeDasharray={i === 0 || isLast ? undefined : "22 14"}
            strokeOpacity={i === 0 || isLast ? 1 : 0.55 - i * 0.05}
          />
        );
      })}
      <circle cx={end.x} cy={end.y} r="14" fill="var(--blaze)" />
      <circle cx={end.x} cy={end.y} r="30" fill="none" stroke="var(--blaze)" strokeWidth="4" className="pulse" />
      <g className="ring-labels" fill="currentColor" fontSize="40" fontWeight="700">
        <text x={0} y={-R0 - 22} textAnchor="middle">
          800 m
        </text>
        <text x={end.x + last.circle.radius + 18} y={end.y + 13} fill="var(--blaze)">
          70 m
        </text>
      </g>
    </svg>
  );
}
