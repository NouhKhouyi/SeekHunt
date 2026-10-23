import { DurableObject } from "cloudflare:workers";
import {
  type ClientMsg,
  createGame,
  disconnect,
  GameError,
  type GameEvent,
  type GameState,
  handle,
  hello,
  type ServerMsg,
  tick,
  viewFor,
} from "@seekhunt/shared";

interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
}

/** No 0/O, 1/I to keep codes easy to read aloud. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-Z2-9]{5}$/;
const TICK_MS = 3000;
const IDLE_CLEANUP_MS = 12 * 60 * 60 * 1000;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const [, kind, code] = url.pathname.split("/");

    if (req.method === "POST" && url.pathname === "/api/rooms") {
      for (let i = 0; i < 5; i++) {
        const candidate = randomCode();
        const res = await env.ROOMS.get(env.ROOMS.idFromName(candidate)).fetch("https://room/init", { method: "POST" });
        if (res.ok) return json({ code: candidate });
      }
      return json({ error: "err.createFailed" }, 503);
    }

    if ((kind === "ws" || kind === "api") && code) {
      const roomCode = (kind === "api" ? url.pathname.split("/")[3] : code)?.toUpperCase() ?? "";
      if (!CODE_RE.test(roomCode)) return json({ error: "err.invalidCode" }, 400);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomCode));
      if (kind === "ws") {
        if (req.headers.get("Upgrade") !== "websocket") return json({ error: "Expected websocket" }, 426);
        return stub.fetch(req);
      }
      if (url.pathname.startsWith("/api/rooms/")) return stub.fetch("https://room/info");
    }

    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  playerId: string | null;
}

/** One Durable Object per room: authoritative game state, WebSockets (hibernatable) and timers (alarms). */
export class GameRoom extends DurableObject<Env> {
  private game: GameState | null = null;
  private lastActivity = Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.game = (await ctx.storage.get<GameState>("game")) ?? null;
      this.lastActivity = (await ctx.storage.get<number>("lastActivity")) ?? Date.now();
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/init") {
      if (this.game) return json({ error: "exists" }, 409);
      // The DO name is the room code, but DOs don't expose their name; the worker passes it on the first websocket.
      this.game = createGame("");
      await this.save();
      await this.ctx.storage.setAlarm(Date.now() + IDLE_CLEANUP_MS);
      return json({ ok: true });
    }
    if (url.pathname === "/info") {
      return json({ exists: !!this.game, phase: this.game?.phase ?? null, players: this.game?.order.length ?? 0 });
    }
    if (!this.game) return json({ error: "err.noRoom" }, 404);
    if (!this.game.code) {
      this.game.code = url.pathname.split("/")[2]!.toUpperCase();
      await this.save();
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const game = this.game;
    if (!game || typeof raw !== "string" || raw.length > 4096) return;
    const att = ws.deserializeAttachment() as Attachment;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const now = Date.now();
    const events: GameEvent[] = [];
    try {
      if (msg.t === "hello") {
        events.push(...hello(game, msg));
        ws.serializeAttachment({ playerId: msg.playerId } satisfies Attachment);
      } else {
        if (!att.playerId) throw new GameError("err.helloFirst");
        events.push(...handle(game, att.playerId, msg, now));
      }
      events.push(...tick(game, now));
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      this.send(ws, { t: "error", error: err instanceof GameError ? err.msg : { key: "err.unexpected" } });
      return;
    }
    this.lastActivity = now;
    await this.save();
    await this.scheduleTick();

    // Location updates are frequent: answer the sender only and let the tick fan out to everybody else.
    if (msg.t === "loc" && events.length === 0) {
      this.sendState(ws, now);
    } else {
      this.broadcast(events, now);
    }
  }

  async webSocketClose(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    const game = this.game;
    if (!game || !att?.playerId) return;
    const stillConnected = this.ctx.getWebSockets().some((s) => s !== ws && (s.deserializeAttachment() as Attachment)?.playerId === att.playerId);
    if (!stillConnected) {
      disconnect(game, att.playerId);
      await this.save();
      this.broadcast([], Date.now());
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    const now = Date.now();
    if (now - this.lastActivity > IDLE_CLEANUP_MS) {
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, "Sala cerrada por inactividad");
      await this.ctx.storage.deleteAll();
      this.game = null;
      return;
    }
    if (!this.game) return;
    const events = tick(this.game, now);
    await this.save();
    this.broadcast(events, now);
    // The fired alarm is consumed, so always arm the next one: a game tick or the idle cleanup.
    await this.ctx.storage.setAlarm(this.inGame() ? now + TICK_MS : this.lastActivity + IDLE_CLEANUP_MS + 1000);
  }

  private inGame() {
    return this.game?.phase === "hiding" || this.game?.phase === "seeking";
  }

  /** Ensures a tick alarm is pending while a game runs; otherwise keeps the idle-cleanup alarm. */
  private async scheduleTick() {
    const current = await this.ctx.storage.getAlarm();
    if (this.inGame()) {
      if (current === null || current > Date.now() + TICK_MS) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    } else if (current === null) {
      await this.ctx.storage.setAlarm(this.lastActivity + IDLE_CLEANUP_MS + 1000);
    }
  }

  private async save() {
    await this.ctx.storage.put({ game: this.game, lastActivity: this.lastActivity });
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already closing; the close handler will clean up.
    }
  }

  private sendState(ws: WebSocket, now: number) {
    const att = ws.deserializeAttachment() as Attachment;
    if (this.game && att?.playerId && this.game.players[att.playerId]) {
      this.send(ws, { t: "state", view: viewFor(this.game, att.playerId, now) });
    }
  }

  private broadcast(events: GameEvent[], now: number) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment;
      if (!att?.playerId) continue;
      if (!this.game?.players[att.playerId]) {
        // Kicked.
        this.send(ws, { t: "error", error: { key: "err.kicked" } });
        ws.close(4001, "kicked");
        continue;
      }
      for (const e of events) {
        if (!e.to || e.to.includes(att.playerId)) this.send(ws, { t: "event", event: { kind: e.kind, msg: e.msg }, at: now });
      }
      this.sendState(ws, now);
    }
  }
}
