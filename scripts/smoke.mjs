// End-to-end smoke test against a running `npm run dev` (worker on :8787).
// Creates a room, joins 3 players over WebSockets, plays a short game and checks the outcome.
const BASE = process.env.BASE ?? "http://127.0.0.1:8787";

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/rooms/AAAAA`);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server not reachable");
}

function player(code, name) {
  const id = { playerId: crypto.randomUUID().replace(/-/g, ""), secret: crypto.randomUUID().replace(/-/g, "") };
  const ws = new WebSocket(`${BASE.replace("http", "ws")}/ws/${code}`);
  const p = { name, ws, id, view: null, events: [], errors: [] };
  p.ready = new Promise((res) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "hello", ...id, name }));
      res();
    };
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === "state") p.view = m.view;
    if (m.t === "event") p.events.push(m.event.msg.key);
    if (m.t === "error") p.errors.push(m.error.key);
  };
  p.send = (m) => ws.send(JSON.stringify(m));
  return p;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("ok -", msg);
};

await waitForServer();
const { code } = await (await fetch(`${BASE}/api/rooms`, { method: "POST" })).json();
assert(/^[A-Z2-9]{5}$/.test(code), `room created ${code}`);

const host = player(code, "Cazador");
await host.ready;
await wait(300);
const ana = player(code, "Ana");
const bea = player(code, "Bea");
await Promise.all([ana.ready, bea.ready]);
await wait(500);
assert(host.view?.players.length === 3, "3 players in lobby");
assert(host.view.hostId === host.id.playerId, "first player is host");

const center = { lat: 39.4699, lng: -0.3763 };
host.send({ t: "config", config: { hideSeconds: 0, pingIntervalSeconds: 0, zone: { center, radius: 500 } } });
for (const p of [host, ana, bea]) p.send({ t: "loc", ...center, acc: 5 });
await wait(300);
ana.send({ t: "start" });
await wait(300);
assert(ana.errors.includes("err.hostOnly"), "non-host cannot start");
host.send({ t: "start" });
await wait(4000); // one alarm tick moves hiding -> seeking
assert(host.view.phase === "seeking", "game is in seeking phase");
assert(!host.view.players.find((p) => p.name === "Ana").loc, "seeker cannot see Ana's location");
const anaCode = ana.view.me.catchCode;
assert(/^\d{4}$/.test(anaCode), "Ana has a catch code");
host.send({ t: "catch", code: "0000" === anaCode ? "1111" : "0000" });
host.send({ t: "catch", code: anaCode });
await wait(500);
assert(host.view.phase === "ended", "game ended after catching Ana");
assert(host.view.winners.length === 1 && bea.view.winners[0] === bea.id.playerId, "Bea wins as last survivor");
console.log("events seen by Bea:", bea.events);
for (const p of [host, ana, bea]) p.ws.close();
console.log("SMOKE OK");
