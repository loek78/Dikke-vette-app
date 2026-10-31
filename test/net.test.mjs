// Tests voor de MQTT-transportlaag (online/net.js) tegen lokale aedes-brokers op willekeurige poorten.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startBroker } from "../tools/broker.mjs";

const require = createRequire(import.meta.url);
const mqtt = require("mqtt");
const DVNet = require("../online/net.js");

const DEAD = "ws://127.0.0.1:1"; // niemand luistert → connection refused
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOf = (b) => `ws://127.0.0.1:${b.wss.address().port}`;

// Verzamelt callback-waarden; `until(pred)` wacht tot er een passende binnen is.
function collector() {
  const items = [];
  const waiters = [];
  return {
    items,
    push(v) {
      items.push(v);
      for (const w of [...waiters]) if (w.pred(v)) { clearTimeout(w.timer); waiters.splice(waiters.indexOf(w), 1); w.resolve(v); }
    },
    until(pred, ms = 4000, label = "waarde") {
      const hit = items.find(pred);
      if (hit !== undefined) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve, timer: setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timeout: ${label}`)); }, ms) };
        waiters.push(w);
      });
    },
  };
}

// Gemeenschappelijke opruiming: rooms en brokers sluiten, zodat het proces netjes stopt
const rooms = [];
const brokers = [];
async function openRoom(opts) {
  const room = await DVNet.open({ mqtt, ...opts });
  rooms.push(room);
  return room;
}
async function broker(port = 0) {
  const b = await startBroker(port, { quiet: true });
  brokers.push(b);
  return b;
}
test.after(async () => {
  await Promise.all(rooms.map((r) => r.close()));
  await Promise.all(brokers.map((b) => b.close().catch(() => {})));
});

let codeN = 0;
const freshCode = () => "T" + String.fromCharCode(65 + (codeN++ % 26)) + "ST";

test("randomCode is CVCV, randomId heeft de juiste lengte", () => {
  for (let i = 0; i < 200; i++) assert.match(DVNet.randomCode(), /^[BDFGHJKLMNPRSTVZ][AEIOU][BDFGHJKLMNPRSTVZ][AEIOU]$/);
  assert.match(DVNet.randomId(), /^[a-z2-9]{16}$/);
  assert.equal(DVNet.randomId(24).length, 24);
  assert.notEqual(DVNet.randomId(), DVNet.randomId());
  assert.deepEqual(DVNet.brokerList(), DVNet.BROKERS); // Node: geen override
  assert.equal(DVNet.brokerOverride(), null);
});

test("topicMatch met wildcards", () => {
  assert.ok(DVNet.topicMatch("dva/v1/BAKO/presence/+", "dva/v1/BAKO/presence/p1"));
  assert.ok(!DVNet.topicMatch("dva/v1/BAKO/presence/+", "dva/v1/BAKO/presence/p1/x"));
  assert.ok(!DVNet.topicMatch("dva/v1/BAKO/presence/+", "dva/v1/BAKO/state"));
  assert.ok(DVNet.topicMatch("dva/v1/#", "dva/v1/BAKO/state"));
  assert.ok(!DVNet.topicMatch("dva/v1/BAKO/state", "dva/v1/BAKO/statex"));
});

test("open + publishState: late joiner krijgt retained state; leeg retained → null", async () => {
  const b = await broker();
  const code = freshCode();
  const statuses = [];
  const host = await openRoom({ code, pid: "host1", brokers: [urlOf(b)], onStatus: (s) => statuses.push(s) });
  assert.deepEqual(statuses, ["connecting", "online"]);
  assert.equal(host.brokerIndex, 0);
  assert.equal(host.brokerUrl, urlOf(b));
  assert.equal(host.connected, true);
  assert.equal(await host.publishState({ v: 1, code, phase: "lobby", updatedAt: Date.now() }), true);

  const joiner = await openRoom({ code, pid: "p2", brokerUrl: urlOf(b), brokers: [urlOf(b)] });
  const got = collector();
  joiner.subscribeState((s) => got.push(s));
  const st = await got.until((s) => s && s.phase === "lobby", 3000, "retained state");
  assert.equal(st.code, code);

  // retained wissen (lege payload) → cb(null)
  await new Promise((r) => host.client.publish(DVNet.topics(code).state, "", { qos: 1, retain: true }, r));
  await got.until((s) => s === null, 3000, "null na wissen");
  // ongeldige JSON wordt genegeerd
  await new Promise((r) => host.client.publish(DVNet.topics(code).state, "{kapot", { qos: 1 }, r));
  await host.publishState({ v: 1, code, phase: "reveal", updatedAt: Date.now() });
  await got.until((s) => s && s.phase === "reveal", 3000, "reveal");
  assert.equal(got.items.length, 3);
});

test("private alleen naar die key; host ontvangt send(); unsubscribe werkt", async () => {
  const b = await broker();
  const code = freshCode();
  const list = [urlOf(b)];
  const host = await openRoom({ code, pid: "h", brokers: list });
  const a = await openRoom({ code, pid: "a", brokers: list });
  const c = await openRoom({ code, pid: "c", brokers: list });
  const gotA = collector(), gotC = collector(), gotHost = collector();
  a.subscribePrivate("keyAAAAAAAAAAAAA", (p) => gotA.push(p));
  c.subscribePrivate("keyCCCCCCCCCCCCC", (p) => gotC.push(p));
  host.subscribeHost((env) => gotHost.push(env));
  await sleep(150); // subscriptions actief

  await host.publishPrivate("keyAAAAAAAAAAAAA", { v: 1, gameNo: 1, word: "Pizza" });
  const pa = await gotA.until((p) => p && p.word === "Pizza", 3000, "privé A");
  assert.equal(pa.gameNo, 1);
  await a.send({ pid: "a", key: "k", seq: 1, t: "join", d: { name: "Anna" } });
  const env = await gotHost.until((e) => e.t === "join", 3000, "envelope");
  assert.equal(env.d.name, "Anna");
  await sleep(250);
  assert.equal(gotC.items.length, 0, "C mag het bericht van A niet zien");

  // retained: wie later abonneert krijgt het ook
  const a2 = collector();
  const unsub = a.subscribePrivate("keyAAAAAAAAAAAAA", (p) => a2.push(p));
  await a2.until((p) => p && p.word === "Pizza", 3000, "retained privé");
  unsub();
  unsub(); // idempotent

  await host.clearPrivate("keyAAAAAAAAAAAAA");
  await gotA.until((p) => p === null, 3000, "privé gewist");
  assert.ok(!a2.items.includes(null), "afgemelde handler krijgt niets meer");
});

test("presence: \"1\" bij connect, LWT \"0\" bij abrupt wegvallen", async () => {
  const b = await broker();
  const code = freshCode();
  const list = [urlOf(b)];
  const obs = await openRoom({ code, brokers: list }); // zonder pid: geen presence/will
  const pres = collector();
  obs.subscribePresence((pid, online) => pres.push({ pid, online }));
  await sleep(100);

  const p = await openRoom({ code, pid: "lwt1", brokers: list });
  await pres.until((x) => x.pid === "lwt1" && x.online, 3000, "presence 1");
  p.client.options.reconnectPeriod = 0; // simuleer dode telefoon: niet opnieuw verbinden
  p.client.stream.destroy(); // geen DISCONNECT → broker publiceert de will
  await pres.until((x) => x.pid === "lwt1" && !x.online, 3000, "LWT 0");
  assert.ok(!pres.items.some((x) => x.pid !== "lwt1"), "observer zonder pid publiceert geen presence");

  // retained: een nieuwe observer ziet ook "0"
  const late = collector();
  const obs2 = await openRoom({ code, brokers: list });
  obs2.subscribePresence((pid, online) => late.push({ pid, online }));
  await late.until((x) => x.pid === "lwt1" && x.online === false, 3000, "retained 0");
});

test("presence: nette close publiceert \"0\"; setPresence", async () => {
  const b = await broker();
  const code = freshCode();
  const list = [urlOf(b)];
  const obs = await openRoom({ code, brokers: list });
  const pres = collector();
  obs.subscribePresence((pid, online) => pres.push({ pid, online }));
  await sleep(100);

  const statuses = [];
  const p = await openRoom({ code, pid: "nice1", brokers: list, onStatus: (s) => statuses.push(s) });
  await pres.until((x) => x.pid === "nice1" && x.online, 3000, "presence 1");
  await p.setPresence(false);
  await pres.until((x) => x.pid === "nice1" && !x.online, 3000, "setPresence(false)");
  await p.setPresence(true);
  await pres.until((x, i) => x.pid === "nice1" && x.online && pres.items.filter((y) => y.pid === "nice1").length >= 3, 3000, "weer 1");

  const n = pres.items.length;
  const closing = p.close();
  assert.equal(p.close(), closing, "close is idempotent");
  await closing;
  assert.equal(statuses.at(-1), "offline");
  assert.equal(p.connected, false);
  await pres.until((x) => x.pid === "nice1" && !x.online && pres.items.indexOf(x) >= n, 3000, "presence 0 na close");
  assert.equal(await p.publishState({ x: 1 }), false, "na close wordt niets meer gepubliceerd");
});

test("findRoom over twee brokers (kamer alleen op de tweede), dode broker ertussen", async () => {
  const b1 = await broker(), b2 = await broker();
  const list = [DEAD, urlOf(b1), urlOf(b2)];
  const code = freshCode();
  const host = await openRoom({ code, pid: "h", brokerIndex: 2, brokers: list });
  assert.equal(host.brokerUrl, urlOf(b2));
  await host.publishState({ v: 1, code, phase: "lobby", updatedAt: Date.now() });

  const r = await DVNet.findRoom(code, { mqtt, brokers: list, timeoutMs: 600, connectTimeout: 2000 });
  assert.ok(r);
  assert.equal(r.brokerIndex, 2);
  assert.equal(r.brokerUrl, urlOf(b2));
  assert.equal(r.state.phase, "lobby");

  // kleine letters + preferIndex werken ook
  const t0 = Date.now();
  const r2 = await DVNet.findRoom(code.toLowerCase(), { mqtt, brokers: list, preferIndex: 2, timeoutMs: 2000 });
  assert.equal(r2.brokerIndex, 2);
  assert.ok(Date.now() - t0 < 1500, "voorkeursbroker meteen raak, niet op de anderen wachten");
});

test("findRoom → null als de kamer nergens is", async () => {
  const b1 = await broker(), b2 = await broker();
  const t0 = Date.now();
  const r = await DVNet.findRoom("ZUZU", { mqtt, brokers: [urlOf(b1), DEAD, urlOf(b2)], timeoutMs: 300 });
  assert.equal(r, null);
  assert.ok(Date.now() - t0 < 2500);
  assert.equal(await DVNet.findRoom("ZUZU", { mqtt, brokers: [DEAD], timeoutMs: 300, connectTimeout: 500 }), null);
});

test("findRoom negeert gesloten (en oude) kamers", async () => {
  const b1 = await broker(), b2 = await broker();
  const list = [urlOf(b1), urlOf(b2)];
  const code = freshCode();
  const h1 = await openRoom({ code, pid: "h1", brokerIndex: 0, brokers: list });
  await h1.publishState({ v: 1, code, phase: "closed", updatedAt: Date.now() });
  assert.equal(await DVNet.findRoom(code, { mqtt, brokers: list, timeoutMs: 300 }), null);

  const h2 = await openRoom({ code, pid: "h2", brokerIndex: 1, brokers: list });
  await h2.publishState({ v: 1, code, phase: "vote", updatedAt: Date.now() });
  const r = await DVNet.findRoom(code, { mqtt, brokers: list, timeoutMs: 300 });
  assert.equal(r.brokerIndex, 1);
  assert.equal(r.state.phase, "vote");

  const code2 = freshCode();
  const h3 = await openRoom({ code: code2, pid: "h3", brokers: list });
  await h3.publishState({ v: 1, code: code2, phase: "lobby", updatedAt: Date.now() - 13 * 3600e3 });
  assert.equal(await DVNet.findRoom(code2, { mqtt, brokers: list, timeoutMs: 300 }), null, "ouder dan 12 uur");
});

test("claimCode ontwijkt bezette codes en valt terug op de volgende broker", async () => {
  const b = await broker();
  const list = [urlOf(b)];
  const busy = await openRoom({ code: "BAKO", pid: "x", brokers: list });
  await busy.publishState({ v: 1, code: "BAKO", phase: "lobby", updatedAt: Date.now() });
  const closed = await openRoom({ code: "FIPA", pid: "y", brokers: list });
  await closed.publishState({ v: 1, code: "FIPA", phase: "closed", updatedAt: Date.now() });
  const old = await openRoom({ code: "DUKE", pid: "z", brokers: list });
  await old.publishState({ v: 1, code: "DUKE", phase: "hints", updatedAt: Date.now() - 7 * 3600e3 });

  const seq = (arr) => { let i = 0; return () => arr[Math.min(i++, arr.length - 1)]; };
  let r = await DVNet.claimCode({ mqtt, brokers: list, waitMs: 300, genCode: seq(["BAKO", "BAKO", "FIPA"]) });
  assert.deepEqual(r, { code: "FIPA", brokerIndex: 0, brokerUrl: urlOf(b) });
  r = await DVNet.claimCode({ mqtt, brokers: list, waitMs: 300, genCode: seq(["BAKO", "DUKE"]) });
  assert.equal(r.code, "DUKE", "kamer ouder dan 6 uur telt als vrij");

  // eerste broker dood → tweede
  r = await DVNet.claimCode({ mqtt, brokers: [DEAD, urlOf(b)], waitMs: 300, genCode: seq(["BAKO", "GOMI"]) });
  assert.deepEqual(r, { code: "GOMI", brokerIndex: 1, brokerUrl: urlOf(b) });

  // alles bezet → nette fout
  await assert.rejects(DVNet.claimCode({ mqtt, brokers: list, waitMs: 200, maxTries: 2, genCode: () => "BAKO" }), /vrije/);
  // geen broker bereikbaar → nette fout
  await assert.rejects(DVNet.claimCode({ mqtt, brokers: [DEAD], waitMs: 200, connectTimeout: 500 }), /verbinding/);
  // standaardgenerator geeft een geldige code
  r = await DVNet.claimCode({ mqtt, brokers: list, waitMs: 200 });
  assert.match(r.code, /^[BDFGHJKLMNPRSTVZ][AEIOU][BDFGHJKLMNPRSTVZ][AEIOU]$/);
});

test("open() faalt netjes als de broker onbereikbaar is", async () => {
  const statuses = [];
  await assert.rejects(
    DVNet.open({ mqtt, code: "NOPE", pid: "q", brokers: [DEAD], timeoutMs: 800, reconnectPeriod: 200, onStatus: (s) => statuses.push(s) }),
    /verbinding/,
  );
  assert.equal(statuses[0], "connecting");
  assert.equal(statuses.at(-1), "offline");
});

test("reconnect na broker-herstart: presence opnieuw en subscriptions hersteld", async () => {
  let b = await broker();
  const port = b.wss.address().port;
  const list = [urlOf(b)];
  const code = freshCode();
  const statuses = [];
  let reconnects = 0;
  const room = await openRoom({ code, pid: "rc1", brokers: list, reconnectPeriod: 200, onStatus: (s) => statuses.push(s) });
  room.onReconnect(() => reconnects++);
  const got = collector();
  room.subscribeState((s) => got.push(s));
  await sleep(100);

  await b.close();
  brokers.splice(brokers.indexOf(b), 1);
  await sleep(500);
  assert.notEqual(room.status, "online");
  assert.equal(room.connected, false);

  b = await broker(port); // zelfde poort, lege broker (geen retained meer)
  const obs = await openRoom({ code, brokers: list });
  const pres = collector();
  obs.subscribePresence((pid, online) => pres.push({ pid, online }));
  await pres.until((x) => x.pid === "rc1" && x.online, 5000, "presence 1 na reconnect");
  assert.equal(room.status, "online");
  assert.ok(statuses.includes("reconnecting") || statuses.includes("offline"));
  assert.equal(reconnects, 1);

  await obs.publishState({ v: 1, code, phase: "lobby", updatedAt: Date.now() });
  await got.until((s) => s && s.phase === "lobby", 5000, "state na resubscribe");
});

test("offline-event: verbinding parkeren (LWT \"0\", geen pogingen) en bij online meteen terug", async () => {
  const b = await broker();
  const code = freshCode();
  const list = [urlOf(b)];
  const obs = await openRoom({ code, brokers: list }); // waarnemer zonder (nep-)window: blijft gewoon verbonden
  const pres = collector();
  obs.subscribePresence((pid, online) => pres.push({ pid, online }));
  await sleep(100);

  // Nep-browser: window met online/offline-events en navigator.onLine
  const win = new EventTarget();
  const nav = { onLine: true };
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.window = win;
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true, writable: true });
  try {
    const statuses = [];
    let reconnects = 0;
    const p = await openRoom({ code, pid: "off1", brokers: list, onStatus: (s) => statuses.push(s) });
    p.onReconnect(() => reconnects++);
    const got = collector();
    p.subscribeState((s) => got.push(s));
    await pres.until((x) => x.pid === "off1" && x.online, 3000, "presence 1");

    nav.onLine = false;
    win.dispatchEvent(new Event("offline"));
    assert.equal(p.status, "offline");
    await pres.until((x) => x.pid === "off1" && !x.online, 3000, "LWT 0 na offline");
    await sleep(700); // geen herverbind-pogingen zolang het netwerk weg is
    assert.equal(p.status, "offline");
    assert.equal(p.connected, false);
    assert.equal(await p.send({ t: "x" }), false, "versturen tijdens offline → false (outbox in ui.js houdt het vast)");

    const back = collector();
    obs.subscribePresence((pid, online) => back.push({ pid, online }));
    nav.onLine = true;
    win.dispatchEvent(new Event("online"));
    await back.until((x) => x.pid === "off1" && x.online, 5000, "presence 1 na online");
    assert.equal(p.status, "online");
    assert.equal(reconnects, 1);
    assert.deepEqual(statuses.slice(-3), ["offline", "reconnecting", "online"]);
    await obs.publishState({ v: 1, code, phase: "lobby", updatedAt: Date.now() });
    await got.until((s) => s && s.phase === "lobby", 5000, "state na herverbinden");

    // Al offline bij het openen: wacht met verbinden tot het netwerk er is
    nav.onLine = false;
    const opening = DVNet.open({ mqtt, code, pid: "off2", brokers: list, timeoutMs: 6000 });
    await sleep(500);
    assert.ok(!back.items.some((x) => x.pid === "off2" && x.online), "geen verbinding zolang offline");
    nav.onLine = true;
    win.dispatchEvent(new Event("online"));
    const p2 = await opening;
    rooms.push(p2);
    assert.equal(p2.status, "online");
  } finally {
    delete globalThis.window;
    if (prevNav) Object.defineProperty(globalThis, "navigator", prevNav); else delete globalThis.navigator;
  }
});
