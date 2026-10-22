import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, sanitizeConfig } from "./config";
import { distance, offset } from "./geo";
import { createGame, handle, hello, tick, viewFor } from "./engine";
import { mulberry32 } from "./rng";
import { buildSchedule, zoneAt } from "./zones";

const center = DEFAULT_CONFIG.zone.center;
const join = (s: ReturnType<typeof createGame>, id: string, name: string) =>
  hello(s, { t: "hello", playerId: id.padEnd(8, "x"), secret: "secret-" + id, name });
const id = (x: string) => x.padEnd(8, "x");

function startedGame(players = ["seek", "ana", "bea"], overrides = {}) {
  const s = createGame("ABCD");
  players.forEach((p) => join(s, p, p));
  handle(s, id(players[0]!), { t: "config", config: { hideSeconds: 60, pingIntervalSeconds: 0, ...overrides } }, 0);
  handle(s, id(players[0]!), { t: "start" }, 0, mulberry32(1));
  for (const p of players) handle(s, id(p), { t: "loc", ...center, acc: 5 }, 0);
  return s;
}

describe("zones", () => {
  it("each circle is contained in the previous one and radii shrink to finalRadius", () => {
    const cfg = sanitizeConfig({ shrinkCount: 6, finalRadius: 50 }, DEFAULT_CONFIG);
    for (let seed = 0; seed < 50; seed++) {
      const steps = buildSchedule(cfg, seed, 0);
      expect(steps).toHaveLength(7);
      for (let k = 1; k < steps.length; k++) {
        const a = steps[k - 1]!.circle, b = steps[k]!.circle;
        expect(b.radius).toBeLessThan(a.radius);
        expect(distance(a.center, b.center) + b.radius).toBeLessThanOrEqual(a.radius + 0.5);
      }
      expect(steps.at(-1)!.circle.radius).toBeCloseTo(50, 5);
    }
  });

  it("interpolates during a shrink", () => {
    const cfg = sanitizeConfig({ shrinkIntervalSeconds: 100, shrinkDurationSeconds: 20 }, DEFAULT_CONFIG);
    const steps = buildSchedule(cfg, 7, 0);
    const mid = zoneAt(steps, 110_000);
    expect(mid.shrinking).toBe(true);
    expect(mid.current.radius).toBeCloseTo((steps[0]!.circle.radius + steps[1]!.circle.radius) / 2, 3);
    const after = zoneAt(steps, 125_000);
    expect(after.shrinking).toBe(false);
    expect(after.current).toEqual(steps[1]!.circle);
    expect(after.next).toEqual(steps[2]!.circle);
  });
});

describe("engine", () => {
  it("first player is host and seeker, the rest hide", () => {
    const s = createGame("ABCD");
    join(s, "seek", "Seek");
    join(s, "ana", "Ana");
    expect(s.hostId).toBe(id("seek"));
    expect(s.players[id("seek")]!.role).toBe("seeker");
    expect(s.players[id("ana")]!.role).toBe("hider");
  });

  it("rejects new players after start but lets existing ones reconnect", () => {
    const s = startedGame();
    expect(() => join(s, "late", "Late")).toThrow();
    expect(() => join(s, "ana", "Ana")).not.toThrow();
    expect(() => hello(s, { t: "hello", playerId: id("ana"), secret: "wrong-secret", name: "x" })).toThrow();
  });

  it("hiding switches to seeking after the head start", () => {
    const s = startedGame();
    expect(s.phase).toBe("hiding");
    tick(s, 59_000);
    expect(s.phase).toBe("hiding");
    tick(s, 60_000);
    expect(s.phase).toBe("seeking");
  });

  it("catching with a hider's code works, last survivor wins", () => {
    const s = startedGame();
    tick(s, 60_000);
    const ana = s.players[id("ana")]!;
    expect(() => handle(s, id("seek"), { t: "catch", code: "zzzz" }, 61_000)).toThrow();
    handle(s, id("seek"), { t: "catch", code: ana.catchCode! }, 61_000);
    expect(ana.status).toBe("caught");
    expect(s.phase).toBe("ended");
    expect(s.winners).toEqual([id("bea")]);
  });

  it("seekers win when everybody is caught", () => {
    const s = startedGame(["seek", "ana"]);
    tick(s, 60_000);
    handle(s, id("seek"), { t: "catch", code: s.players[id("ana")]!.catchCode! }, 61_000);
    expect(s.winners).toEqual([id("seek")]);
  });

  it("eliminates a hider who stays outside the zone past the grace period", () => {
    const s = startedGame(["seek", "ana", "bea", "cris"], { outOfZoneGraceSeconds: 30 });
    tick(s, 60_000);
    const far = offset(center, DEFAULT_CONFIG.zone.radius + 200, 0);
    handle(s, id("ana"), { t: "loc", ...far, acc: 5 }, 60_000); // 60s after the previous fix, so the jump is plausible
    tick(s, 61_000);
    expect(s.players[id("ana")]!.outOfZoneSince).toBe(61_000);
    // While outside, the seeker can see Ana.
    const seekerView = viewFor(s, id("seek"), 62_000);
    expect(seekerView.players.find((p) => p.id === id("ana"))!.visibleBecause).toBe("outOfZone");
    tick(s, 91_000);
    expect(s.players[id("ana")]!.status).toBe("eliminated");
  });

  it("hides hider positions from seekers while inside the zone", () => {
    const s = startedGame();
    tick(s, 60_000);
    const v = viewFor(s, id("seek"), 61_000);
    expect(v.players.find((p) => p.id === id("ana"))!.loc).toBeUndefined();
    expect(v.me.catchCode).toBeNull();
    expect(viewFor(s, id("ana"), 61_000).me.catchCode).toMatch(/^\d{4}$/);
  });

  it("ping gives seekers a fuzzy circle containing the hider", () => {
    const s = startedGame(["seek", "ana", "bea"], { pingIntervalSeconds: 60, pingFuzzMeters: 100 });
    tick(s, 60_000);
    tick(s, 120_000, mulberry32(3));
    const v = viewFor(s, id("seek"), 120_000);
    const ping = v.pings.find((p) => p.playerId === id("ana"))!;
    expect(distance(ping.area.center, center)).toBeLessThanOrEqual(ping.area.radius);
    expect(viewFor(s, id("ana"), 120_000).pings.every((p) => p.playerId === id("seek"))).toBe(true);
  });

  it("discards physically impossible jumps", () => {
    const s = startedGame();
    handle(s, id("ana"), { t: "loc", ...offset(center, 5000, 0), acc: 5 }, 1000);
    expect(distance(s.players[id("ana")]!.loc!, center)).toBeLessThan(1);
  });
});
