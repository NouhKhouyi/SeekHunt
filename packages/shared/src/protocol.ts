import type { GameConfig } from "./config";
import type { Circle, LatLng } from "./geo";

export type Role = "seeker" | "hider";
export type PlayerStatus = "active" | "caught" | "eliminated";
export type Phase = "lobby" | "hiding" | "seeking" | "ended";

export interface Fix extends LatLng {
  /** Reported accuracy in meters. */
  acc: number;
  /** Server receive time (ms epoch). */
  ts: number;
}

export interface PlayerView {
  id: string;
  name: string;
  role: Role;
  status: PlayerStatus;
  connected: boolean;
  /** Present only when the viewer is allowed to see this player's position. */
  loc?: Fix;
  /** Why the position is visible: teammate, out of zone, stale signal, spectator... */
  visibleBecause?: "self" | "teammate" | "outOfZone" | "stale" | "spectator" | "ping" | "sos";
  outOfZoneSince?: number | null;
  /** Player asked for help: everybody sees them. */
  sos?: boolean;
}

export interface Ping {
  playerId: string;
  /** Fuzzy circle that contains the true position. */
  area: Circle;
  at: number;
}

export interface GameView {
  code: string;
  phase: Phase;
  hostId: string;
  config: GameConfig;
  seed: number;
  startedAt: number | null;
  seekStartAt: number | null;
  endedAt: number | null;
  winners: string[];
  winReason: string | null;
  me: { id: string; role: Role; status: PlayerStatus; catchCode: string | null };
  players: PlayerView[];
  pings: Ping[];
  nextPingAt: number | null;
  serverNow: number;
}

export type ClientMsg =
  | { t: "hello"; playerId: string; secret: string; name: string }
  | { t: "config"; config: Partial<GameConfig> }
  | { t: "setRole"; playerId: string; role: Role }
  | { t: "kick"; playerId: string }
  | { t: "start" }
  | { t: "loc"; lat: number; lng: number; acc: number }
  | { t: "catch"; code: string }
  | { t: "surrender" }
  | { t: "sos" }
  | { t: "sosClear" }
  | { t: "end" }
  | { t: "reset" };

export type EventKind = "info" | "zone" | "ping" | "catch" | "elim" | "warn" | "end" | "sos";

export interface GameEvent {
  kind: EventKind;
  text: string;
  /** Restrict delivery to these players; undefined means everybody. */
  to?: string[];
}

export type ServerMsg =
  | { t: "state"; view: GameView }
  | { t: "event"; event: Omit<GameEvent, "to">; at: number }
  | { t: "error"; message: string };
