/**
 * Pure, server-authoritative game rules. The server owns a GameState, feeds it client
 * messages and periodic ticks, and sends each player a personalised GameView.
 * No I/O in here so everything is unit-testable.
 */
import { DEFAULT_CONFIG, type GameConfig, sanitizeConfig } from "./config";
import { distance, randomPointInCircle, type Circle } from "./geo";
import type { ClientMsg, Fix, GameEvent, GameView, Phase, Ping, PlayerStatus, PlayerView, Role } from "./protocol";
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
  winReason: string | null;
  players: Record<string, PlayerState>;
  /** Players in join order, for stable lists. */
  order: string[];
  pings: Ping[];
  nextPingAt: number | null;
  announcedStep: number;
  /** Highest shrink index already warned about (optional: rooms created before this field). */
  warnedStep?: number;
  hidersAtStart: number;
}

export class GameError extends Error {}

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
  if (!n) throw new GameError("Pon un nombre");
  return n;
}

/** Registers or reconnects a player. Returns the events to broadcast. */
export function hello(s: GameState, msg: Extract<ClientMsg, { t: "hello" }>): GameEvent[] {
  if (typeof msg.playerId !== "string" || msg.playerId.length < 8 || typeof msg.secret !== "string" || msg.secret.length < 8) {
    throw new GameError("Identificador inválido");
  }
  const existing = s.players[msg.playerId];
  if (existing) {
    if (existing.secret !== msg.secret) throw new GameError("Identificador inválido");
    existing.connected = true;
    if (s.phase === "lobby") existing.name = cleanName(msg.name);
    return [];
  }
  if (s.phase !== "lobby") throw new GameError("La partida ya ha empezado");
  if (s.order.length >= MAX_PLAYERS) throw new GameError("La sala está llena");
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
  return [{ kind: "info", text: `${name} se ha unido` }];
}

export function disconnect(s: GameState, playerId: string) {
  const p = s.players[playerId];
  if (p) p.connected = false;
}

function requireHost(s: GameState, playerId: string) {
  if (s.hostId !== playerId) throw new GameError("Solo el anfitrión puede hacer eso");
}
function requirePhase(s: GameState, ...phases: Phase[]) {
  if (!phases.includes(s.phase)) throw new GameError("No disponible en esta fase");
}

function catchCodes(count: number, rand: () => number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(String(Math.floor(rand() * 10_000)).padStart(4, "0"));
  return [...codes];
}

export function handle(s: GameState, playerId: string, msg: ClientMsg, now: number, rand: () => number = Math.random): GameEvent[] {
  const me = s.players[playerId];
  if (!me) throw new GameError("No estás en la sala");
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
      if (!target || (msg.role !== "seeker" && msg.role !== "hider")) throw new GameError("Jugador inválido");
      target.role = msg.role;
      return [];
    }

    case "kick": {
      requireHost(s, playerId);
      requirePhase(s, "lobby");
      const target = s.players[msg.playerId];
      if (!target || target.id === playerId) throw new GameError("Jugador inválido");
      delete s.players[target.id];
      s.order = s.order.filter((id) => id !== target.id);
      return [{ kind: "info", text: `${target.name} ha sido expulsado` }];
    }

    case "start": {
      requireHost(s, playerId);
      requirePhase(s, "lobby");
      const all = list(s);
      const hiders = all.filter((p) => p.role === "hider");
      if (!all.some((p) => p.role === "seeker")) throw new GameError("Hace falta al menos un cazador");
      if (hiders.length === 0) throw new GameError("Hace falta al menos un escondido");
      const codes = catchCodes(hiders.length, rand);
      for (const p of all) {
        p.status = "active";
        p.outOfZoneSince = null;
        p.sosAt = null;
        p.catchCode = p.role === "hider" ? codes.pop()! : null;
      }
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
      const hide = s.config.hideSeconds;
      const when = hide >= 60 ? `${Math.round(hide / 60)} min` : `${hide} s`;
      return [{ kind: "info", text: `¡A esconderse! El cazador sale en ${when}` }];
    }

    case "loc": {
      if (![msg.lat, msg.lng, msg.acc].every((v) => typeof v === "number" && Number.isFinite(v))) return [];
      if (Math.abs(msg.lat) > 90 || Math.abs(msg.lng) > 180) return [];
      const fix: Fix = { lat: msg.lat, lng: msg.lng, acc: Math.max(0, Math.min(10_000, msg.acc)), ts: now };
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

    case "catch": {
      requirePhase(s, "seeking");
      if (me.role !== "seeker" || me.status !== "active") throw new GameError("Solo los cazadores pueden pillar");
      const victim = activeHiders(s).find((p) => p.catchCode === String(msg.code).trim());
      if (!victim) throw new GameError("Código incorrecto. Revisa las 4 cifras.");
      if (me.loc && now - me.loc.ts < FRESH_FIX_MS && (me.speed ?? 0) > WALKING_SPEED_LIMIT) {
        throw new GameError("Vas demasiado rápido. Solo se puede pillar a pie.");
      }
      // Stops codes being passed around by message: both phones must roughly agree they're together.
      if (me.loc && victim.loc && now - me.loc.ts < FRESH_FIX_MS && now - victim.loc.ts < FRESH_FIX_MS) {
        const gap = distance(me.loc, victim.loc) - me.loc.acc - victim.loc.acc;
        if (gap > CATCH_MAX_DISTANCE) throw new GameError(`Estáis a unos ${Math.round(distance(me.loc, victim.loc))} m. Tienes que tocar a ${victim.name} para pillarle.`);
      }
      return [...markCaught(s, victim, me), ...checkEnd(s, now)];
    }

    case "sos":
      requirePhase(s, "hiding", "seeking");
      if (me.sosAt) return [];
      me.sosAt = now;
      return [{ kind: "sos", text: `${me.name} necesita ayuda. Su posición es visible para todos.` }];

    case "sosClear":
      if (!me.sosAt) return [];
      me.sosAt = null;
      return [{ kind: "info", text: `${me.name} está bien` }];

    case "surrender": {
      requirePhase(s, "hiding", "seeking");
      if (me.role !== "hider" || me.status !== "active") throw new GameError("No puedes hacer eso");
      return [...markCaught(s, me, null), ...checkEnd(s, now)];
    }

    case "end":
      requireHost(s, playerId);
      requirePhase(s, "hiding", "seeking");
      return finish(s, now, [], "El anfitrión ha terminado la partida");

    case "reset":
      requireHost(s, playerId);
      requirePhase(s, "ended");
      s.phase = "lobby";
      s.pings = [];
      s.winners = [];
      s.winReason = null;
      for (const p of list(s)) {
        p.status = "active";
        p.catchCode = null;
        p.outOfZoneSince = null;
        p.sosAt = null;
      }
      return [{ kind: "info", text: "Nueva partida: de vuelta al lobby" }];
  }
}

function markCaught(s: GameState, victim: PlayerState, by: PlayerState | null): GameEvent[] {
  victim.status = "caught";
  victim.outOfZoneSince = null;
  if (s.config.caughtBecomeSeekers) {
    victim.role = "seeker";
    victim.status = "active";
    victim.catchCode = null;
  }
  const text = by ? `${by.name} ha pillado a ${victim.name}` : `${victim.name} ha sido pillado`;
  return [{ kind: "catch", text: s.config.caughtBecomeSeekers ? `${text}. ¡Ahora caza!` : text }];
}

function finish(s: GameState, now: number, winners: string[], reason: string): GameEvent[] {
  s.phase = "ended";
  s.endedAt = now;
  s.winners = winners;
  s.winReason = reason;
  s.nextPingAt = null;
  return [{ kind: "end", text: reason }];
}

function checkEnd(s: GameState, now: number): GameEvent[] {
  if (!inGame(s)) return [];
  const left = activeHiders(s);
  if (left.length === 0) {
    return finish(s, now, seekers(s).map((p) => p.id), "¡Los cazadores han pillado a todos!");
  }
  if (s.config.lastSurvivorWins && s.hidersAtStart >= 2 && left.length === 1) {
    return finish(s, now, [left[0]!.id], `¡${left[0]!.name} es el último superviviente!`);
  }
  return [];
}

export function currentZone(s: GameState, now: number) {
  if (s.seekStartAt === null) return null;
  const schedule = buildSchedule(s.config, s.seed, s.seekStartAt);
  return { schedule, zone: zoneAt(schedule, now), deadline: gameDeadline(schedule, s.config) };
}

function outside(fix: Fix, c: Circle): boolean {
  return distance(fix, c.center) - Math.min(fix.acc, MAX_ACCURACY_SLACK) > c.radius;
}

/** Advances timers. Call every few seconds and after every message. */
export function tick(s: GameState, now: number, rand: () => number = Math.random): GameEvent[] {
  const events: GameEvent[] = [];
  if (s.phase === "hiding" && s.seekStartAt !== null && now >= s.seekStartAt) {
    s.phase = "seeking";
    events.push({ kind: "warn", text: "¡El cazador ha salido!" });
  }
  if (s.phase !== "seeking") return events;

  const z = currentZone(s, now)!;
  if (z.zone.index > s.announcedStep) {
    s.announcedStep = z.zone.index;
    events.push({ kind: "zone", text: `La zona se está cerrando (${z.zone.index}/${s.config.shrinkCount})` });
  }
  const upcoming = z.zone.index + 1;
  if (z.zone.nextShrinkAt !== null && now >= z.zone.nextShrinkAt - SHRINK_WARNING_MS && (s.warnedStep ?? 0) < upcoming) {
    s.warnedStep = upcoming;
    events.push({ kind: "zone", text: "La zona se cierra en 30 s. Ve hacia el círculo discontinuo." });
  }

  const grace = s.config.outOfZoneGraceSeconds * 1000;
  for (const p of activeHiders(s)) {
    if (!p.loc) continue;
    if (!outside(p.loc, z.zone.current)) {
      p.outOfZoneSince = null;
    } else if (p.outOfZoneSince === null) {
      p.outOfZoneSince = now;
      events.push({ kind: "warn", text: `¡Estás fuera de la zona! Tienes ${s.config.outOfZoneGraceSeconds}s para volver`, to: [p.id] });
    } else if (now - p.outOfZoneSince >= grace) {
      p.status = "eliminated";
      p.outOfZoneSince = null;
      events.push({ kind: "elim", text: `${p.name} ha sido eliminado por salir de la zona` });
    }
  }

  if (s.nextPingAt !== null && now >= s.nextPingAt) {
    const fuzz = s.config.pingFuzzMeters;
    s.pings = [];
    for (const p of activeHiders(s)) {
      if (p.loc) s.pings.push({ playerId: p.id, area: { center: randomPointInCircle(p.loc, fuzz * 0.85, rand), radius: Math.max(fuzz, 10) }, at: now });
    }
    for (const p of seekers(s)) {
      if (p.status === "active" && p.loc) s.pings.push({ playerId: p.id, area: { center: p.loc, radius: Math.max(p.loc.acc, 15) }, at: now });
    }
    s.nextPingAt += s.config.pingIntervalSeconds * 1000;
    events.push({ kind: "ping", text: "📡 Radar: los cazadores ven vuestra zona aproximada y vosotros a ellos" });
  }

  events.push(...checkEnd(s, now));
  if (s.phase === "seeking" && now >= z.deadline) {
    const survivors = activeHiders(s);
    events.push(...finish(s, now, survivors.map((p) => p.id), `¡Tiempo! Ganan los supervivientes: ${survivors.map((p) => p.name).join(", ")}`));
  }
  return events;
}

/** What a given player is allowed to know. */
export function viewFor(s: GameState, viewerId: string, now: number): GameView {
  const me = s.players[viewerId]!;
  const spectator = s.phase === "ended" || s.phase === "lobby" || me.status !== "active";
  const staleMs = s.config.staleLocationSeconds * 1000;

  const players: PlayerView[] = list(s).map((p) => {
    const v: PlayerView = { id: p.id, name: p.name, role: p.role, status: p.status, connected: p.connected, outOfZoneSince: p.outOfZoneSince, sos: !!p.sosAt };
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
    me: { id: me.id, role: me.role, status: me.status, catchCode: me.role === "hider" ? me.catchCode : null },
    players,
    pings,
    nextPingAt: s.nextPingAt,
    serverNow: now,
  };
}
