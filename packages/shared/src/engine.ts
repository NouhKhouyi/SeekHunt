/**
 * Pure, server-authoritative game rules. The server owns a GameState, feeds it client
 * messages and periodic ticks, and sends each player a personalised GameView.
 * No I/O in here so everything is unit-testable. Player-facing text is never built here:
 * events and errors carry a message key and parameters that each phone translates.
 */
import { DEFAULT_CONFIG, type GameConfig, sanitizeConfig } from "./config";
import { distance, randomPointInCircle, type Circle } from "./geo";
import type { ClientMsg, EventKind, Fix, GameEvent, GameView, Msg, Phase, Ping, PlayerStatus, PlayerView, Role } from "./protocol";
import { buildSchedule, gameDeadline, zoneAt } from "./zones";

export const MAX_PLAYERS = 30;
/** Fixes implying a faster speed than this (m/s) within a short window are discarded as glitches/spoofing. */
const MAX_PLAUSIBLE_SPEED = 60;
/** Accuracy slack (m) granted before declaring someone out of the zone. */
const MAX_ACCURACY_SLACK = 30;
/** A catch is refused when both fresh fixes put the players further apart than this (plus their accuracy). */
export const CATCH_MAX_DISTANCE = 80;
const FRESH_FIX_MS = 30_000;
/** 25 km/h: anything faster is a vehicle, and catching from a vehicle is not allowed. */
export const WALKING_SPEED_LIMIT = 7;
/** Heads-up before each shrink starts. */
const SHRINK_WARNING_MS = 30_000;
/** Wrong catch codes allowed before a cooldown: stops a seeker trying all 10,000 codes. */
export const CATCH_FREE_ATTEMPTS = 3;
const CATCH_LOCK_BASE_MS = 30_000;
const CATCH_LOCK_MAX_MS = 5 * 60_000;
/** Altitude is only shared on the radar when the device claims at least this vertical accuracy (m). */
export const TRUSTED_ALTITUDE_ACCURACY = 10;
export const MIN_FLOOR = -5;
export const MAX_FLOOR = 200;

export interface PlayerState {
  id: string;
  secret: string;
  name: string;
  role: Role;
  status: PlayerStatus;
  connected: boolean;
  loc?: Fix;
  catchCode: string | null;
  outOfZoneSince: number | null;
  /** Set while the player has an active SOS: everybody sees their position. */
  sosAt?: number | null;
  /** Speed (m/s) derived from the last two accepted fixes. */
  speed?: number;
  /** Floor the player says they are on (building mode). */
  floor?: number | null;
  /** When they were caught or eliminated, and by which seeker. */
  outAt?: number | null;
  caughtBy?: string | null;
  /** Wrong catch codes in a row, and the cooldown they earned. */
  catchFails?: number;
  catchLockedUntil?: number;
}

export interface GameState {
  code: string;
  hostId: string;
  phase: Phase;
  config: GameConfig;
  seed: number;
  startedAt: number | null;
  seekStartAt: number | null;
  endedAt: number | null;
  winners: string[];
  winReason: Msg | string | null;
  players: Record<string, PlayerState>;
  /** Players in join order, for stable lists. */
  order: string[];
  pings: Ping[];
  nextPingAt: number | null;
  announcedStep: number;
  /** Highest shrink index already warned about (optional: rooms created before this field). */
  warnedStep?: number;
  hidersAtStart: number;
  /** Host pause: everything time-based is frozen while set (optional: rooms saved before pausing existed). */
  pausedAt?: number | null;
}

export class GameError extends Error {
  constructor(
    readonly key: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(key);
  }
  get msg(): Msg {
    return { key: this.key, params: this.params };
  }
}

const ev = (kind: EventKind, key: string, params?: Msg["params"], to?: string[]): GameEvent => ({ kind, msg: { key, params }, ...(to ? { to } : {}) });

export function createGame(code: string, config: GameConfig = DEFAULT_CONFIG): GameState {
  return {
    code,
    hostId: "",
    phase: "lobby",
    config,
    seed: 0,
    startedAt: null,
    seekStartAt: null,
    endedAt: null,
    winners: [],
    winReason: null,
    players: {},
    order: [],
    pings: [],
    nextPingAt: null,
    announcedStep: 0,
    hidersAtStart: 0,
  };
}

const list = (s: GameState) => s.order.map((id) => s.players[id]!).filter(Boolean);
const activeHiders = (s: GameState) => list(s).filter((p) => p.role === "hider" && p.status === "active");
const seekers = (s: GameState) => list(s).filter((p) => p.role === "seeker");
const inGame = (s: GameState) => s.phase === "hiding" || s.phase === "seeking";

function cleanName(name: unknown): string {
  const n = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 20) : "";
  if (!n) throw new GameError("err.nameRequired");
  return n;
}

/** Registers or reconnects a player. Returns the events to broadcast. */
export function hello(s: GameState, msg: Extract<ClientMsg, { t: "hello" }>): GameEvent[] {
  if (typeof msg.playerId !== "string" || msg.playerId.length < 8 || typeof msg.secret !== "string" || msg.secret.length < 8) {
    throw new GameError("err.invalidId");
  }
  const existing = s.players[msg.playerId];
  if (existing) {
    if (existing.secret !== msg.secret) throw new GameError("err.invalidId");
    existing.connected = true;
    if (s.phase === "lobby") existing.name = cleanName(msg.name);
    return [];
  }
  if (s.phase !== "lobby") throw new GameError("err.gameStarted");
  if (s.order.length >= MAX_PLAYERS) throw new GameError("err.roomFull");
  const name = cleanName(msg.name);
  const isFirst = s.order.length === 0;
  s.players[msg.playerId] = {
    id: msg.playerId,
    secret: msg.secret,
    name,
    role: isFirst ? "seeker" : "hider",
    status: "active",
    connected: true,
    catchCode: null,
    outOfZoneSince: null,
  };
  s.order.push(msg.playerId);
  if (isFirst) s.hostId = msg.playerId;
  return [ev("info", "ev.joined", { name })];
}

export function disconnect(s: GameState, playerId: string) {
  const p = s.players[playerId];
  if (p) p.connected = false;
}

function requireHost(s: GameState, playerId: string) {
  if (s.hostId !== playerId) throw new GameError("err.hostOnly");
}
function requirePhase(s: GameState, ...phases: Phase[]) {
  if (!phases.includes(s.phase)) throw new GameError("err.wrongPhase");
}

function catchCodes(count: number, rand: () => number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(String(Math.floor(rand() * 10_000)).padStart(4, "0"));
  return [...codes];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function handle(s: GameState, playerId: string, msg: ClientMsg, now: number, rand: () => number = Math.random): GameEvent[] {
  const me = s.players[playerId];
  if (!me) throw new GameError("err.notInRoom");
  switch (msg.t) {
    case "hello":
      return hello(s, msg);

    case "config":
      requireHost(s, playerId);
      requirePhase(s, "lobby");
      s.config = sanitizeConfig(msg.config, s.config);
      return [];

    case "setRole": {
      requireHost(s, playerId);
      requirePhase(s, "lobby");
      const target = s.players[msg.playerId];
      if (!target || (msg.role !== "seeker" && msg.role !== "hider")) throw new GameError("err.invalidPlayer");
      target.role = msg.role;
      return [];
    }

    case "kick": {
      requireHost(s, playerId);
      requirePhase(s, "lobby");
      const target = s.players[msg.playerId];
      if (!target || target.id === playerId) throw new GameError("err.invalidPlayer");
      delete s.players[target.id];
      s.order = s.order.filter((id) => id !== target.id);
      return [ev("info", "ev.kicked", { name: target.name })];
    }

    case "start": {
      requireHost(s, playerId);
      requirePhase(s, "lobby");
      const all = list(s);
      const hiders = all.filter((p) => p.role === "hider");
      if (!all.some((p) => p.role === "seeker")) throw new GameError("err.needSeeker");
      if (hiders.length === 0) throw new GameError("err.needHider");
      const codes = catchCodes(hiders.length, rand);
      for (const p of all) {
        p.status = "active";
        p.outOfZoneSince = null;
        p.sosAt = null;
        p.outAt = null;
        p.caughtBy = null;
        p.catchFails = 0;
        p.catchLockedUntil = 0;
        p.catchCode = p.role === "hider" ? codes.pop()! : null;
      }
      s.pausedAt = null;
      s.warnedStep = 0;
      s.seed = Math.floor(rand() * 2 ** 32);
      s.phase = "hiding";
      s.startedAt = now;
      s.seekStartAt = now + s.config.hideSeconds * 1000;
      s.endedAt = null;
      s.winners = [];
      s.winReason = null;
      s.pings = [];
      s.announcedStep = 0;
      s.hidersAtStart = hiders.length;
      s.nextPingAt = s.config.pingIntervalSeconds > 0 ? s.seekStartAt + s.config.pingIntervalSeconds * 1000 : null;
      return [ev("info", "ev.hideStart", { seconds: s.config.hideSeconds })];
    }

    case "loc": {
      if (![msg.lat, msg.lng, msg.acc].every(finite)) return [];
      if (Math.abs(msg.lat) > 90 || Math.abs(msg.lng) > 180) return [];
      const fix: Fix = { lat: msg.lat, lng: msg.lng, acc: Math.max(0, Math.min(10_000, msg.acc)), ts: now };
      if (finite(msg.alt) && finite(msg.altAcc) && Math.abs(msg.alt) < 10_000) {
        fix.alt = msg.alt;
        fix.altAcc = Math.max(0, msg.altAcc);
      }
      const prev = me.loc;
      if (prev) {
        const dt = (now - prev.ts) / 1000;
        if (dt < 30 && distance(prev, fix) > Math.max(MAX_PLAUSIBLE_SPEED * dt, prev.acc + fix.acc)) return [];
        // Ignore jitter: only measure speed over a real time window and beyond GPS noise.
        if (dt >= 2) me.speed = Math.max(0, distance(prev, fix) - prev.acc - fix.acc) / dt;
      }
      me.loc = fix;
      return [];
    }

    case "floor": {
      if (msg.floor === null) me.floor = null;
      else if (finite(msg.floor)) me.floor = Math.round(Math.min(MAX_FLOOR, Math.max(MIN_FLOOR, msg.floor)));
      return [];
    }

    case "catch": {
      requirePhase(s, "seeking");
      if (s.pausedAt) throw new GameError("err.paused");
      if (me.role !== "seeker" || me.status !== "active") throw new GameError("err.seekersOnly");
      if ((me.catchLockedUntil ?? 0) > now) throw new GameError("err.catchLocked", { seconds: Math.ceil((me.catchLockedUntil! - now) / 1000) });
      const victim = activeHiders(s).find((p) => p.catchCode === String(msg.code).trim());
      if (!victim) {
        // Guessing codes is the only way to catch someone without meeting them: make it slow.
        me.catchFails = (me.catchFails ?? 0) + 1;
        const over = me.catchFails - CATCH_FREE_ATTEMPTS;
        if (over >= 0) {
          me.catchLockedUntil = now + Math.min(CATCH_LOCK_MAX_MS, CATCH_LOCK_BASE_MS * 2 ** over);
          throw new GameError("err.catchLocked", { seconds: Math.ceil((me.catchLockedUntil - now) / 1000) });
        }
        throw new GameError("err.wrongCode");
      }
      const myFresh = !!me.loc && now - me.loc.ts < FRESH_FIX_MS;
      const victimFresh = !!victim.loc && now - victim.loc.ts < FRESH_FIX_MS;
      if (myFresh && (me.speed ?? 0) > WALKING_SPEED_LIMIT) throw new GameError("err.tooFast");
      // With the hider's position known, the seeker's must be too: switching GPS off can't skip the check below.
      if (victimFresh && !myFresh) throw new GameError("err.needLocation");
      // Stops codes being passed around by message: both phones must roughly agree they're together.
      if (myFresh && victimFresh) {
        const gap = distance(me.loc!, victim.loc!) - me.loc!.acc - victim.loc!.acc;
        if (gap > CATCH_MAX_DISTANCE) throw new GameError("err.tooFar", { meters: Math.round(distance(me.loc!, victim.loc!)), name: victim.name });
      }
      me.catchFails = 0;
      return [...markCaught(s, victim, me, now), ...checkEnd(s, now)];
    }

    case "pause":
      requireHost(s, playerId);
      requirePhase(s, "hiding", "seeking");
      if (s.pausedAt) return [];
      s.pausedAt = now;
      return [ev("warn", "ev.paused")];

    case "resume": {
      requireHost(s, playerId);
      requirePhase(s, "hiding", "seeking");
      if (!s.pausedAt) return [];
      // Shift every clock by the time spent paused, so the game carries on exactly where it stopped.
      const d = now - s.pausedAt;
      const shift = (t: number | null | undefined) => (t == null ? null : t + d);
      s.startedAt = shift(s.startedAt);
      s.seekStartAt = shift(s.seekStartAt);
      s.nextPingAt = shift(s.nextPingAt);
      for (const p of list(s)) p.outOfZoneSince = shift(p.outOfZoneSince);
      s.pausedAt = null;
      return [ev("warn", "ev.resumed")];
    }

    case "sos":
      requirePhase(s, "hiding", "seeking");
      if (me.sosAt) return [];
      me.sosAt = now;
      return [ev("sos", "ev.sos", { name: me.name })];

    case "sosClear":
      if (!me.sosAt) return [];
      me.sosAt = null;
      return [ev("info", "ev.sosClear", { name: me.name })];

    case "surrender": {
      requirePhase(s, "hiding", "seeking");
      if (me.role !== "hider" || me.status !== "active") throw new GameError("err.notAllowed");
      return [...markCaught(s, me, null, now), ...checkEnd(s, now)];
    }

    case "end":
      requireHost(s, playerId);
      requirePhase(s, "hiding", "seeking");
      return finish(s, now, [], { key: "win.hostEnded" });

    case "reset":
      requireHost(s, playerId);
      requirePhase(s, "ended");
      s.phase = "lobby";
      s.pings = [];
      s.winners = [];
      s.winReason = null;
      s.pausedAt = null;
      for (const p of list(s)) {
        p.status = "active";
        p.catchCode = null;
        p.outOfZoneSince = null;
        p.sosAt = null;
        p.outAt = null;
        p.caughtBy = null;
      }
      return [ev("info", "ev.reset")];
  }
}

function markCaught(s: GameState, victim: PlayerState, by: PlayerState | null, now: number): GameEvent[] {
  victim.status = "caught";
  victim.outOfZoneSince = null;
  victim.outAt = now;
  victim.caughtBy = by?.id ?? null;
  const infected = s.config.caughtBecomeSeekers;
  if (infected) {
    victim.role = "seeker";
    victim.status = "active";
    victim.catchCode = null;
  }
  const key = by ? (infected ? "ev.caughtByInfect" : "ev.caughtBy") : infected ? "ev.surrenderedInfect" : "ev.surrendered";
  return [ev("catch", key, { by: by?.name ?? "", name: victim.name })];
}

function finish(s: GameState, now: number, winners: string[], reason: Msg): GameEvent[] {
  s.phase = "ended";
  s.endedAt = now;
  s.winners = winners;
  s.winReason = reason;
  s.nextPingAt = null;
  s.pausedAt = null;
  return [{ kind: "end", msg: reason }];
}

function checkEnd(s: GameState, now: number): GameEvent[] {
  if (!inGame(s)) return [];
  const left = activeHiders(s);
  if (left.length === 0) return finish(s, now, seekers(s).map((p) => p.id), { key: "win.seekers" });
  if (s.config.lastSurvivorWins && s.hidersAtStart >= 2 && left.length === 1) {
    return finish(s, now, [left[0]!.id], { key: "win.lastSurvivor", params: { name: left[0]!.name } });
  }
  return [];
}

export function currentZone(s: GameState, now: number) {
  if (s.seekStartAt === null) return null;
  const schedule = buildSchedule(s.config, s.seed, s.seekStartAt);
  return { schedule, zone: zoneAt(schedule, now), deadline: gameDeadline(schedule, s.config) };
}

function outside(fix: Fix, c: Circle): boolean {
  // GPS error is forgiven up to 30 m, but never more than half the zone: in a 25 m zone that would be most of it.
  return distance(fix, c.center) - Math.min(fix.acc, MAX_ACCURACY_SLACK, c.radius / 2) > c.radius;
}

/** Radar circle for a hider. Fuzz 0 means "exact": the circle is just the GPS error itself. */
function radarArea(loc: Fix, fuzz: number, rand: () => number): Circle {
  if (fuzz <= 0) return { center: { lat: loc.lat, lng: loc.lng }, radius: Math.max(loc.acc, 5) };
  return { center: randomPointInCircle(loc, fuzz * 0.85, rand), radius: Math.max(fuzz, loc.acc, 5) };
}

function pingFor(p: PlayerState, area: Circle, now: number, building: boolean): Ping {
  const ping: Ping = { playerId: p.id, area, at: now };
  if (building) ping.floor = p.floor ?? null;
  if (p.loc?.alt !== undefined && (p.loc.altAcc ?? Infinity) <= TRUSTED_ALTITUDE_ACCURACY) ping.alt = Math.round(p.loc.alt);
  return ping;
}

/** Advances timers. Call every few seconds and after every message. */
export function tick(s: GameState, now: number, rand: () => number = Math.random): GameEvent[] {
  const events: GameEvent[] = [];
  if (s.pausedAt) return events;
  if (s.phase === "hiding" && s.seekStartAt !== null && now >= s.seekStartAt) {
    s.phase = "seeking";
    events.push(ev("warn", "ev.seekerOut"));
  }
  if (s.phase !== "seeking") return events;

  const z = currentZone(s, now)!;
  if (z.zone.index > s.announcedStep) {
    s.announcedStep = z.zone.index;
    events.push(ev("zone", "ev.zoneClosing", { index: z.zone.index, total: s.config.shrinkCount }));
  }
  const upcoming = z.zone.index + 1;
  if (z.zone.nextShrinkAt !== null && now >= z.zone.nextShrinkAt - SHRINK_WARNING_MS && (s.warnedStep ?? 0) < upcoming) {
    s.warnedStep = upcoming;
    events.push(ev("zone", "ev.zoneWarning"));
  }

  const grace = s.config.outOfZoneGraceSeconds * 1000;
  for (const p of activeHiders(s)) {
    if (!p.loc) continue;
    if (!outside(p.loc, z.zone.current)) {
      p.outOfZoneSince = null;
    } else if (p.outOfZoneSince === null) {
      p.outOfZoneSince = now;
      events.push(ev("warn", "ev.outOfZone", { seconds: s.config.outOfZoneGraceSeconds }, [p.id]));
    } else if (now - p.outOfZoneSince >= grace) {
      p.status = "eliminated";
      p.outOfZoneSince = null;
      p.outAt = now;
      events.push(ev("elim", "ev.eliminated", { name: p.name }));
    }
  }

  if (s.nextPingAt !== null && now >= s.nextPingAt) {
    const building = !!s.config.buildingMode;
    s.pings = [];
    for (const p of activeHiders(s)) if (p.loc) s.pings.push(pingFor(p, radarArea(p.loc, s.config.pingFuzzMeters, rand), now, building));
    for (const p of seekers(s)) {
      if (p.status === "active" && p.loc) s.pings.push(pingFor(p, { center: { lat: p.loc.lat, lng: p.loc.lng }, radius: Math.max(p.loc.acc, 15) }, now, building));
    }
    s.nextPingAt += s.config.pingIntervalSeconds * 1000;
    events.push(ev("ping", "ev.ping"));
  }

  events.push(...checkEnd(s, now));
  if (s.phase === "seeking" && now >= z.deadline) {
    const survivors = activeHiders(s);
    events.push(...finish(s, now, survivors.map((p) => p.id), { key: "win.timeUp", params: { names: survivors.map((p) => p.name).join(", ") } }));
  }
  return events;
}

/** What a given player is allowed to know. */
export function viewFor(s: GameState, viewerId: string, now: number): GameView {
  const me = s.players[viewerId]!;
  const spectator = s.phase === "ended" || s.phase === "lobby" || me.status !== "active";
  const staleMs = s.config.staleLocationSeconds * 1000;

  const players: PlayerView[] = list(s).map((p) => {
    const v: PlayerView = {
      id: p.id,
      name: p.name,
      role: p.role,
      status: p.status,
      connected: p.connected,
      outOfZoneSince: p.outOfZoneSince,
      sos: !!p.sosAt,
      outAt: p.outAt ?? null,
      caughtBy: p.caughtBy ?? null,
    };
    let because: PlayerView["visibleBecause"];
    if (p.id === viewerId) because = "self";
    else if (p.sosAt) because = "sos";
    else if (spectator) because = "spectator";
    else if (p.role === "seeker" && me.role === "seeker") because = "teammate";
    else if (me.role === "seeker" && p.role === "hider" && p.status === "active" && s.phase === "seeking") {
      if (p.outOfZoneSince !== null) because = "outOfZone";
      else if (p.loc && now - p.loc.ts > staleMs) because = "stale";
    }
    if (because && p.loc) {
      v.loc = p.loc;
      v.visibleBecause = because;
      if (s.config.buildingMode) v.floor = p.floor ?? null;
    }
    if (me.role === "hider" && !spectator && p.id !== viewerId) v.outOfZoneSince = null;
    return v;
  });

  const pings = s.pings.filter((ping) => {
    if (spectator) return true;
    const target = s.players[ping.playerId];
    return target && target.role !== me.role;
  });

  return {
    code: s.code,
    phase: s.phase,
    hostId: s.hostId,
    config: s.config,
    seed: s.phase === "lobby" ? 0 : s.seed,
    startedAt: s.startedAt,
    seekStartAt: s.seekStartAt,
    endedAt: s.endedAt,
    winners: s.winners,
    winReason: s.winReason,
    me: { id: me.id, role: me.role, status: me.status, catchCode: me.role === "hider" ? me.catchCode : null, floor: me.floor ?? null },
    players,
    pings,
    nextPingAt: s.nextPingAt,
    pausedAt: s.pausedAt ?? null,
    serverNow: now,
  };
}
