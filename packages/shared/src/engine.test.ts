import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, effectiveFinalRadius, MAX_MAP_MARKS, sanitizeConfig } from "./config";
import { distance, offset } from "./geo";
import { createGame, handle, hello, MAP_MARK_TTL_MS, tick, viewFor } from "./engine";
import type { ClientMsg } from "./protocol";
import { mulberry32 } from "./rng";
import { buildSchedule, zoneAt } from "./zones";

const center = DEFAULT_CONFIG.zone.center;
const join = (s: ReturnType<typeof createGame>, id: string, name: string) =>
  hello(s, { t: "hello", playerId: id.padEnd(8, "x"), secret: "secret-" + id, name });
const id = (x: string) => x.padEnd(8, "x");

describe("map markings", () => {
  function game(overrides = {}) {
    const s = createGame("MARKS");
    for (const name of ["seek", "seek2", "ana", "bea"]) join(s, name, name);
    handle(s, id("seek"), { t: "config", config: { hideSeconds: 60, pingIntervalSeconds: 0, lastSurvivorWins: false, mapMarkLimit: 3, ...overrides } }, 1000);
    handle(s, id("seek"), { t: "setRole", playerId: id("seek2"), role: "seeker" }, 1000);
    handle(s, id("seek"), { t: "start" }, 1000, mulberry32(1));
    return s;
  }
  const add = (s: ReturnType<typeof game>, who = "ana", at = 2000) => {
    expect(handle(s, id(who), { t: "markAdd", ...center, kind: "suspect" }, at)).toEqual([]);
    return s.mapMarks!.at(-1)!;
  };

  it("is opt-in and loads old rooms without the new fields", () => {
    expect(DEFAULT_CONFIG.mapMarkLimit).toBe(0);
    const s = game({ mapMarkLimit: 0 });
    expect(() => add(s)).toThrow("err.notAllowed");
    delete (s.config as Partial<typeof s.config>).mapMarkLimit;
    delete s.mapMarks;
    expect(sanitizeConfig({}, s.config).mapMarkLimit).toBe(0);
    expect(viewFor(s, id("ana"), 2000).mapMarks).toEqual([]);
    handle(s, id("seek"), { t: "end" }, 2000);
    handle(s, id("seek"), { t: "reset" }, 3000);
    handle(s, id("seek"), { t: "config", config: { mapMarkLimit: 3 } }, 4000);
    handle(s, id("seek"), { t: "start" }, 5000, mulberry32(1));
    delete s.mapMarks;
    expect(add(s, "ana", 6000).role).toBe("hider");
  });

  it("sends each team only its own notes, including for the host and spectators", () => {
    const s = game();
    const hider = add(s);
    const seeker = add(s, "seek");
    for (const name of ["ana", "bea"]) expect(viewFor(s, id(name), 3000).mapMarks).toEqual([hider]);
    for (const name of ["seek", "seek2"]) expect(viewFor(s, id(name), 3000).mapMarks).toEqual([seeker]);
    s.players[id("ana")]!.status = "caught";
    s.players[id("seek2")]!.status = "eliminated";
    expect(viewFor(s, id("ana"), 3000).mapMarks).toEqual([hider]);
    expect(viewFor(s, id("seek2"), 3000).mapMarks).toEqual([seeker]);
    s.phase = "ended";
    expect(viewFor(s, id("ana"), 3000).mapMarks).toEqual([]);
    expect(viewFor(s, id("seek"), 3000).mapMarks).toEqual([]);
  });

  it("limits each player independently and immediately frees removed or expired slots", () => {
    const s = game();
    for (let n = 0; n < MAX_MAP_MARKS; n++) add(s);
    expect(() => add(s)).toThrow("err.markLimit");
    add(s, "bea");
    handle(s, id("ana"), { t: "markRemove", id: s.mapMarks![0]!.id }, 3000);
    add(s, "ana", 3000);
    expect(viewFor(s, id("ana"), 3000).mapMarks).toHaveLength(4);
    // No tick is needed for expired notes to stop occupying a slot.
    add(s, "ana", 2000 + MAP_MARK_TTL_MS);
    expect(s.mapMarks!.filter((m) => m.playerId === id("ana"))).toHaveLength(2);
  });

  it("expires after exactly two minutes and survives a reconnect without resetting the clock", () => {
    const s = game();
    const mark = add(s);
    expect(mark.expiresAt).toBe(2000 + MAP_MARK_TTL_MS);
    join(s, "ana", "ana");
    expect(viewFor(s, id("ana"), mark.expiresAt - 1).mapMarks).toHaveLength(1);
    expect(viewFor(s, id("ana"), mark.expiresAt).mapMarks).toEqual([]);
    tick(s, mark.expiresAt);
    expect(s.mapMarks).toEqual([]);
    expect(() => handle(s, id("ana"), { t: "markUpdate", id: mark.id, kind: "clear" }, mark.expiresAt)).toThrow("err.markUnavailable");
  });

  it("allows only the owner to edit, move or remove a note and renews it on saved edits", () => {
    const s = game();
    const mark = add(s);
    for (const who of ["bea", "seek"]) {
      expect(() => handle(s, id(who), { t: "markUpdate", id: mark.id, kind: "clear" }, 3000)).toThrow("err.markUnavailable");
      expect(() => handle(s, id(who), { t: "markUpdate", id: mark.id, lat: 10, lng: 20 }, 3000)).toThrow("err.markUnavailable");
      expect(() => handle(s, id(who), { t: "markRemove", id: mark.id }, 3000)).toThrow("err.markUnavailable");
    }
    expect(mark.expiresAt).toBe(2000 + MAP_MARK_TTL_MS);
    handle(s, id("ana"), { t: "markUpdate", id: mark.id, kind: "clear" }, 4000);
    expect(mark.expiresAt).toBe(4000 + MAP_MARK_TTL_MS);
    handle(s, id("ana"), { t: "markUpdate", id: mark.id, lat: 10, lng: 20 }, 5000);
    expect(mark).toMatchObject({ kind: "clear", pos: { lat: 10, lng: 20 }, expiresAt: 5000 + MAP_MARK_TTL_MS });
    handle(s, id("ana"), { t: "markUpdate", id: mark.id, kind: "clear" }, 6000);
    expect(mark.expiresAt).toBe(6000 + MAP_MARK_TTL_MS);
    handle(s, id("ana"), { t: "markRemove", id: mark.id }, 7000);
    expect(s.mapMarks).toEqual([]);
  });

  it("keeps an edited mark visible past its original expiry for a full new countdown", () => {
    const s = game();
    const mark = add(s);
    const originalExpiry = mark.expiresAt;
    const editedAt = originalExpiry - 1000;
    handle(s, id("ana"), { t: "markUpdate", id: mark.id, kind: "clear" }, editedAt);
    expect(mark.expiresAt).toBe(editedAt + MAP_MARK_TTL_MS);
    expect(viewFor(s, id("bea"), originalExpiry).mapMarks).toEqual([mark]);
    expect(viewFor(s, id("bea"), mark.expiresAt - 1).mapMarks).toHaveLength(1);
    expect(viewFor(s, id("bea"), mark.expiresAt).mapMarks).toEqual([]);
    expect(() => handle(s, id("ana"), { t: "markUpdate", id: mark.id, kind: "suspect" }, mark.expiresAt)).toThrow("err.markUnavailable");
  });

  it("rejects malformed coordinates, icons and incomplete edits without partial mutation", () => {
    const s = game();
    for (const values of [{ lat: NaN }, { lng: Infinity }, { lat: 86 }, { lng: 181 }, { kind: "other" }, { lat: "10" }]) {
      const msg = { t: "markAdd", ...center, kind: "suspect", ...values } as unknown as ClientMsg;
      expect(() => handle(s, id("ana"), msg, 2000)).toThrow("err.invalidMark");
    }
    const mark = add(s);
    const before = { ...mark, pos: { ...mark.pos } };
    for (const values of [{}, { lat: 10 }, { kind: "clear", lat: 10 }, { kind: "other" }, { lat: null, lng: 10 }]) {
      const msg = { t: "markUpdate", id: mark.id, ...values } as unknown as ClientMsg;
      expect(() => handle(s, id("ana"), msg, 3000)).toThrow("err.invalidMark");
      expect(mark).toEqual(before);
    }
  });

  it("freezes countdowns during pauses and resumes with exactly the remaining duration", () => {
    const s = game();
    const mark = add(s);
    handle(s, id("ana"), { t: "markUpdate", id: mark.id, kind: "clear" }, 12_000);
    handle(s, id("seek"), { t: "pause" }, 32_000);
    tick(s, 500_000);
    expect(viewFor(s, id("bea"), 500_000).mapMarks).toEqual([mark]);
    for (const msg of [
      { t: "markAdd", ...center, kind: "suspect" },
      { t: "markUpdate", id: mark.id, kind: "clear" },
      { t: "markRemove", id: mark.id },
    ] as ClientMsg[]) expect(() => handle(s, id("ana"), msg, 500_000)).toThrow("err.paused");
    handle(s, id("seek"), { t: "resume" }, 532_000);
    expect(mark.expiresAt).toBe(632_000);
    expect(viewFor(s, id("ana"), 631_999).mapMarks).toHaveLength(1);
    expect(viewFor(s, id("ana"), 632_000).mapMarks).toEqual([]);
    // A second pause shifts the same mark once again, without reviving expired ones.
    handle(s, id("seek"), { t: "pause" }, 600_000);
    handle(s, id("seek"), { t: "resume" }, 700_000);
    expect(mark.expiresAt).toBe(732_000);
    tick(s, 732_000);
    expect(s.mapMarks).toEqual([]);
  });

  it("removes a converted player's notes and never transfers the old team's notes", () => {
    const s = game({ caughtBecomeSeekers: true });
    const mine = add(s);
    const oldTeam = add(s, "bea");
    const newTeam = add(s, "seek");
    tick(s, 61_000);
    handle(s, id("seek"), { t: "catch", code: s.players[id("ana")]!.catchCode! }, 62_000);
    expect(s.mapMarks).not.toContain(mine);
    expect(viewFor(s, id("ana"), 62_000).mapMarks).toEqual([newTeam]);
    expect(viewFor(s, id("bea"), 62_000).mapMarks).toEqual([oldTeam]);
    expect(add(s, "ana", 63_000).role).toBe("seeker");
    expect(() => handle(s, id("ana"), { t: "markRemove", id: oldTeam.id }, 64_000)).toThrow("err.markUnavailable");
  });

  it("disables mutations for caught and eliminated players and outside a running round", () => {
    const s = game();
    const mark = add(s);
    for (const status of ["caught", "eliminated"] as const) {
      s.players[id("ana")]!.status = status;
      expect(() => add(s)).toThrow("err.notAllowed");
      expect(() => handle(s, id("ana"), { t: "markRemove", id: mark.id }, 3000)).toThrow("err.notAllowed");
    }
    s.players[id("ana")]!.status = "active";
    handle(s, id("seek"), { t: "end" }, 4000);
    expect(s.mapMarks).toEqual([]);
    expect(() => add(s)).toThrow("err.wrongPhase");
    handle(s, id("seek"), { t: "reset" }, 5000);
    expect(s.mapMarks).toEqual([]);
    expect(() => add(s)).toThrow("err.wrongPhase");
    handle(s, id("seek"), { t: "start" }, 6000, mulberry32(1));
    const next = add(s, "ana", 7000);
    expect(next.id).not.toBe(mark.id);
  });
});

function startedGame(players = ["seek", "ana", "bea"], overrides = {}) {
  const s = createGame("ABCD");
  players.forEach((p) => join(s, p, p));
  handle(s, id(players[0]!), { t: "config", config: { hideSeconds: 60, pingIntervalSeconds: 0, ...overrides } }, 0);
  handle(s, id(players[0]!), { t: "start" }, 0, mulberry32(1));
  for (const p of players) handle(s, id(p), { t: "loc", ...center, acc: 5 }, 0);
  return s;
}

describe("config", () => {
  it("clamps the map marking limit and keeps it off for rooms saved without it", () => {
    expect(sanitizeConfig({ mapMarkLimit: 2.4 }, DEFAULT_CONFIG).mapMarkLimit).toBe(2);
    expect(sanitizeConfig({ mapMarkLimit: 99 }, DEFAULT_CONFIG).mapMarkLimit).toBe(MAX_MAP_MARKS);
    expect(sanitizeConfig({ mapMarkLimit: -1 }, DEFAULT_CONFIG).mapMarkLimit).toBe(0);
    expect(sanitizeConfig({ mapMarkLimit: NaN }, { ...DEFAULT_CONFIG, mapMarkLimit: 2 }).mapMarkLimit).toBe(2);
    const legacy = { ...DEFAULT_CONFIG } as Partial<typeof DEFAULT_CONFIG>;
    delete legacy.mapMarkLimit;
    expect(sanitizeConfig({}, legacy as typeof DEFAULT_CONFIG).mapMarkLimit).toBe(0);
  });

  it("accepts exact radii down to 25 m and keeps the chosen final radius", () => {
    const small = sanitizeConfig({ zone: { center, radius: 30.4 } }, DEFAULT_CONFIG);
    expect(small.zone.radius).toBe(30);
    expect(sanitizeConfig({ zone: { center, radius: 3 } }, DEFAULT_CONFIG).zone.radius).toBe(25);
    // Growing the zone back restores the original final radius.
    expect(sanitizeConfig({ zone: { center, radius: 900 } }, small).finalRadius).toBe(DEFAULT_CONFIG.finalRadius);
  });

  it("a tiny zone still shrinks: the final circle is at most half the first", () => {
    const cfg = sanitizeConfig({ zone: { center, radius: 30 }, finalRadius: 60 }, DEFAULT_CONFIG);
    expect(effectiveFinalRadius(cfg)).toBe(15);
    const steps = buildSchedule(cfg, 3, 0);
    expect(steps.at(-1)!.circle.radius).toBeCloseTo(15, 5);
    for (let k = 1; k < steps.length; k++) expect(steps[k]!.circle.radius).toBeLessThan(steps[k - 1]!.circle.radius);
  });
});

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
    // Hiders get the seeker's ping, and only that one.
    const anaPings = viewFor(s, id("ana"), 120_000).pings;
    expect(anaPings.map((p) => p.playerId)).toEqual([id("seek")]);
  });

  it("refuses a catch when both fresh fixes say the players are far apart", () => {
    const s = startedGame();
    tick(s, 60_000);
    handle(s, id("ana"), { t: "loc", ...offset(center, 400, 0), acc: 5 }, 60_000);
    handle(s, id("seek"), { t: "loc", ...center, acc: 5 }, 60_000);
    const code = s.players[id("ana")]!.catchCode!;
    expect(() => handle(s, id("seek"), { t: "catch", code }, 61_000)).toThrow(expect.objectContaining({ key: "err.tooFar", params: { meters: 400, name: "ana" } }));
    // With a stale fix on one side we can't tell, so the code wins.
    handle(s, id("seek"), { t: "catch", code }, 100_000);
    expect(s.players[id("ana")]!.status).toBe("caught");
  });

  it("SOS reveals the player to everybody until cleared", () => {
    const s = startedGame();
    tick(s, 60_000);
    const events = handle(s, id("ana"), { t: "sos" }, 61_000);
    expect(events[0]!.kind).toBe("sos");
    expect(viewFor(s, id("bea"), 61_000).players.find((p) => p.id === id("ana"))!.visibleBecause).toBe("sos");
    handle(s, id("ana"), { t: "sosClear" }, 62_000);
    expect(viewFor(s, id("bea"), 62_000).players.find((p) => p.id === id("ana"))!.loc).toBeUndefined();
  });

  it("warns 30 s before each shrink, once", () => {
    const s = startedGame(["seek", "ana", "bea"], { shrinkIntervalSeconds: 120 });
    tick(s, 60_000);
    expect(tick(s, 60_000 + 89_000).some((e) => e.msg.key === "ev.zoneWarning")).toBe(false);
    expect(tick(s, 60_000 + 90_000).some((e) => e.msg.key === "ev.zoneWarning")).toBe(true);
    expect(tick(s, 60_000 + 95_000).some((e) => e.msg.key === "ev.zoneWarning")).toBe(false);
  });

  it("exact radar shows the real position with only the GPS error as radius", () => {
    const s = startedGame(["seek", "ana", "bea"], { pingIntervalSeconds: 60, pingFuzzMeters: 0 });
    tick(s, 60_000);
    tick(s, 120_000, mulberry32(9));
    const ping = viewFor(s, id("seek"), 120_000).pings.find((p) => p.playerId === id("ana"))!;
    expect(distance(ping.area.center, center)).toBeLessThan(0.01);
    expect(ping.area.radius).toBe(5);
  });

  it("building mode puts declared floors on the radar, and altitude only when it is trustworthy", () => {
    const s = startedGame(["seek", "ana", "bea"], { pingIntervalSeconds: 60, buildingMode: true });
    handle(s, id("ana"), { t: "floor", floor: 3 }, 1_000);
    handle(s, id("bea"), { t: "floor", floor: 999 }, 1_000);
    handle(s, id("ana"), { t: "loc", ...center, acc: 5, alt: 41.4, altAcc: 4 }, 31_000);
    handle(s, id("bea"), { t: "loc", ...center, acc: 5, alt: 30, altAcc: 25 }, 31_000);
    tick(s, 60_000);
    tick(s, 120_000);
    const pings = viewFor(s, id("seek"), 120_000).pings;
    const ana = pings.find((p) => p.playerId === id("ana"))!;
    const bea = pings.find((p) => p.playerId === id("bea"))!;
    expect(ana.floor).toBe(3);
    expect(ana.alt).toBe(41);
    expect(bea.floor).toBe(200); // clamped
    expect(bea.alt).toBeUndefined(); // ±25 m is not trusted
  });

  it("discards physically impossible jumps", () => {
    const s = startedGame();
    handle(s, id("ana"), { t: "loc", ...offset(center, 5000, 0), acc: 5 }, 1000);
    expect(distance(s.players[id("ana")]!.loc!, center)).toBeLessThan(1);
  });

  it("locks out a seeker who keeps guessing catch codes", () => {
    const s = startedGame();
    tick(s, 60_000);
    const real = s.players[id("ana")]!.catchCode!;
    const wrong = real === "0000" ? "0001" : "0000";
    for (let i = 0; i < 2; i++) {
      expect(() => handle(s, id("seek"), { t: "catch", code: wrong }, 61_000)).toThrow("err.wrongCode");
    }
    // The third wrong guess earns a cooldown, and even the right code is refused during it.
    expect(() => handle(s, id("seek"), { t: "catch", code: wrong }, 61_000)).toThrow("err.catchLocked");
    expect(() => handle(s, id("seek"), { t: "catch", code: real }, 70_000)).toThrow("err.catchLocked");
    handle(s, id("seek"), { t: "catch", code: real }, 92_000);
    expect(s.players[id("ana")]!.status).toBe("caught");
  });

  it("refuses a catch when the seeker hides their own position but the hider's is known", () => {
    const s = startedGame();
    tick(s, 60_000);
    handle(s, id("ana"), { t: "loc", ...center, acc: 5 }, 61_000);
    const code = s.players[id("ana")]!.catchCode!;
    expect(() => handle(s, id("seek"), { t: "catch", code }, 62_000)).toThrow("err.needLocation");
    handle(s, id("seek"), { t: "loc", ...center, acc: 5 }, 62_000);
    handle(s, id("seek"), { t: "catch", code }, 62_500);
    expect(s.players[id("ana")]!.status).toBe("caught");
  });

  it("pause freezes the game and resume carries on where it stopped", () => {
    const s = startedGame(["seek", "ana", "bea"], { pingIntervalSeconds: 60 });
    handle(s, id("seek"), { t: "pause" }, 30_000);
    expect(() => handle(s, id("ana"), { t: "pause" }, 30_000)).toThrow("err.hostOnly");
    // Nothing moves while paused, however long it lasts.
    expect(tick(s, 10 * 60_000)).toEqual([]);
    expect(s.phase).toBe("hiding");
    expect(viewFor(s, id("ana"), 10 * 60_000).pausedAt).toBe(30_000);
    handle(s, id("seek"), { t: "resume" }, 10 * 60_000);
    // 30 s of hiding were left when the pause started; they are still left now.
    expect(s.seekStartAt).toBe(10 * 60_000 + 30_000);
    expect(s.nextPingAt).toBe(s.seekStartAt! + 60_000);
    tick(s, 10 * 60_000 + 29_000);
    expect(s.phase).toBe("hiding");
    tick(s, 10 * 60_000 + 30_000);
    expect(s.phase).toBe("seeking");
  });

  it("records who caught whom and when, for the recap", () => {
    const s = startedGame();
    tick(s, 60_000);
    handle(s, id("seek"), { t: "catch", code: s.players[id("ana")]!.catchCode! }, 75_000);
    const ana = viewFor(s, id("bea"), 75_000).players.find((p) => p.id === id("ana"))!;
    expect(ana.outAt).toBe(75_000);
    expect(ana.caughtBy).toBe(id("seek"));
  });
});
