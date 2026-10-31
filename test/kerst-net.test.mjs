// Tests voor de multiplayer-laag van KERSTDROOM (kerst/net.js): pure functies + sessies tegen een lokale aedes-broker
// op een willekeurige poort. Draai met: node --test test/kerst-net.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startBroker } from "../tools/broker.mjs";

const require = createRequire(import.meta.url);
const mqtt = require("mqtt");
const DVNet = require("../online/net.js");
const KN = require("../kerst/net.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlOf = (b) => `ws://127.0.0.1:${b.wss.address().port}`;

// Wacht tot pred() waar is (pollend), anders een duidelijke time-out
async function until(pred, ms = 5000, label = "voorwaarde") {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await pred(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${label}`);
    await sleep(40);
  }
}

const sessions = [];
const brokers = [];
let codeN = 0;
const freshCode = () => "K" + String.fromCharCode(65 + (codeN++ % 26)) + "ST";
async function broker() { const b = await startBroker(0, { quiet: true }); brokers.push(b); return b; }
async function session(opts) {
  const s = await KN.createSession(Object.assign({ mqtt, findTimeoutMs: 600, joinTimeoutMs: 6000 }, opts));
  sessions.push(s);
  return s;
}
test.after(async () => {
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  await Promise.all(brokers.map((b) => b.close().catch(() => {})));
});

// ---------- pure: topics, lobby, reducer ----------
test("topics volgen het dva/v1/<CODE>/ voorvoegsel", () => {
  const T = KN.topics("bako");
  assert.equal(T.state, "dva/v1/BAKO/state");
  assert.equal(T.host, "dva/v1/BAKO/host");
  assert.equal(T.pos("p1"), "dva/v1/BAKO/pos/p1");
  assert.equal(T.posAll, "dva/v1/BAKO/pos/+");
  assert.equal(T.evt, "dva/v1/BAKO/evt");
  assert.equal(T.done("p1"), "dva/v1/BAKO/done/p1");
  assert.ok(DVNet.topicMatch(T.posAll, T.pos("abc")));
  assert.deepEqual(KN.FAMILY, ["Luke", "Viola", "Rifka", "Zarah"]);
});

test("newLobby + reduce: join/set/ready/leave/presence, zelfde referentie als er niets verandert", () => {
  const st0 = KN.newLobby({ code: "BAKO", hostPid: "h", host: { name: "Luke", animal: "vos", difficulty: "stoer" }, seed: 42, now: 1000 });
  assert.equal(st0.phase, "lobby");
  assert.equal(st0.players.h.ready, true, "de host is altijd klaar");
  assert.equal(st0.updatedAt, 1000);
  assert.equal(st0.durationSec, KN.DURATION_SEC, "standaard een run van 90 s");
  assert.equal(KN.newLobby({ code: "BAKO", hostPid: "h", host: {}, durationSec: 25 }).durationSec, 25, "testruns (?dur=) mogen korter");
  assert.equal(KN.newLobby({ code: "BAKO", hostPid: "h", host: {}, durationSec: -3 }).durationSec, KN.DURATION_SEC, "onzin → standaard");
  const st1 = KN.reduce(st0, { t: "join", pid: "r", d: { name: "  Rifka  ", animal: "hert", difficulty: "makkelijk" } }, 2000);
  assert.notEqual(st1, st0);
  assert.equal(st0.players.r, undefined, "input niet gemuteerd");
  assert.deepEqual(st1.players.r, { name: "Rifka", animal: "hert", difficulty: "makkelijk", ready: false, online: true, joinedAt: 2000 });
  assert.equal(st1.updatedAt, 2000);
  // onbekende waarden worden schoongemaakt
  const st2 = KN.reduce(st1, { t: "join", pid: "z", d: { name: "Zarah\u0007<b>", animal: "draak", difficulty: "onmogelijk" } }, 2100);
  assert.equal(st2.players.z.name, "Zarah<b>");
  assert.equal(st2.players.z.animal, "hert");
  assert.equal(st2.players.z.difficulty, "normaal");
  // set zonder verandering → zelfde referentie
  assert.equal(KN.reduce(st2, { t: "set", pid: "r", d: { animal: "hert" } }, 2200), st2);
  assert.equal(KN.reduce(st2, { t: "set", pid: "onbekend", d: { ready: true } }, 2200), st2);
  assert.equal(KN.reduce(st2, { t: "dansje", pid: "r", d: {} }, 2200), st2);
  const st3 = KN.reduce(st2, { t: "set", pid: "r", d: { ready: true, animal: "konijn" } }, 2300);
  assert.equal(st3.players.r.ready, true);
  assert.equal(st3.players.r.animal, "konijn");
  assert.equal(KN.reduce(st3, { t: "set", pid: "h", d: { ready: false } }, 2400), st3, "de host kan niet 'niet klaar' zijn");
  // naam wijzigen in de lobby
  assert.equal(KN.reduce(st3, { t: "set", pid: "z", d: { name: "Zaartje" } }, 2500).players.z.name, "Zaartje");
  // presence
  const st4 = KN.reduce(st3, { t: "presence", pid: "z", d: { online: false } }, 2600);
  assert.equal(st4.players.z.online, false);
  assert.equal(KN.reduce(st4, { t: "presence", pid: "z", d: { online: false } }, 2700), st4);
  // opnieuw joinen zet weer online
  assert.equal(KN.reduce(st4, { t: "join", pid: "z", d: {} }, 2800).players.z.online, true);
  // leave
  const st5 = KN.reduce(st4, { t: "leave", pid: "z", d: {} }, 2900);
  assert.equal(st5.players.z, undefined);
  assert.equal(KN.reduce(st5, { t: "leave", pid: "h", d: {} }, 3000), st5, "de host kan de kamer niet 'verlaten'");
  // volgorde: host eerst, dan op volgorde van binnenkomst
  assert.deepEqual(KN.playerList(st3).map((p) => p.pid), ["h", "r", "z"]);
  // maximum aantal spelers
  let big = st0;
  for (let i = 0; i < 12; i++) big = KN.reduce(big, { t: "join", pid: "p" + i, d: { name: "P" + i } }, 5000 + i);
  assert.equal(Object.keys(big.players).length, KN.MAX_PLAYERS);
});

test("canStart / startRun / againState / finishRun", () => {
  const st0 = KN.newLobby({ code: "BAKO", hostPid: "h", host: { name: "Luke" }, seed: 1, now: 1000 });
  assert.equal(KN.canStart(st0).ok, true, "alleen de host → solo starten mag");
  assert.equal(KN.canStart(st0).solo, true);
  const st1 = KN.reduce(st0, { t: "join", pid: "r", d: { name: "Rifka" } }, 2000);
  assert.equal(KN.canStart(st1).ok, false, "iemand anders in de kamer maar niemand klaar");
  const st2 = KN.reduce(st1, { t: "set", pid: "r", d: { ready: true } }, 2100);
  assert.equal(KN.canStart(st2).ok, true);
  const run = KN.startRun(st2, { now: 5000, seed: 777 });
  assert.equal(run.phase, "run");
  assert.equal(run.seed, 777);
  assert.equal(run.round, 1);
  assert.equal(run.startAt, 5000 + KN.START_DELAY_MS);
  assert.equal(KN.canStart(run).ok, false);
  const fin = KN.finishRun(run, { h: { stars: 10, meters: 300 }, r: { stars: 30, meters: 200, candies: 4 } }, { sum: 40, target: 100, frac: 0.4 }, 9000);
  assert.equal(fin.phase, "results");
  assert.equal(fin.ranking[0].pid, "r");
  assert.equal(fin.ranking[0].name, "Rifka", "naam uit de spelerslijst");
  assert.equal(fin.total.stars, 40);
  assert.deepEqual(fin.droomster, { sum: 40, target: 100, frac: 0.4 });
  const again = KN.againState(fin, { seed: 888, now: 9500 });
  assert.equal(again.phase, "lobby");
  assert.equal(again.seed, 888);
  assert.equal(again.results, null);
  assert.equal(again.players.r.ready, false, "klaar-vinkjes gaan uit");
  assert.equal(again.players.h.ready, true);
  assert.equal(again.round, 1, "de ronde telt pas bij de volgende start op");
});

// ---------- pure: host-tijd ----------
test("host-time offset: max van de samples zit binnen de kleinste latency van de echte offset", () => {
  const TRUE = 5321; // host loopt 5,3 s voor
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const est = KN.OffsetEstimator(12);
  let local = 1_000_000;
  for (let i = 0; i < 40; i++) {
    const latency = 20 + Math.floor(rnd() * 380); // 20..400 ms, soms stale
    local += 200;
    const hostAt = local - latency + TRUE; // verstuurd op host-tijd, ontvangen op `local`
    est.sample(hostAt, local);
  }
  const err = est.offset - TRUE;
  assert.ok(err <= 0 && err >= -150, `offset-fout ${err} ms (verwacht 0 … −150)`);
  assert.equal(est.count, 40);
  assert.equal(est.hostNow(local), local + est.offset);
  assert.equal(est.toLocal(local + est.offset), local);
  // een oud (retained) bericht maakt de schatting niet slechter
  const before = est.offset;
  est.sample(local - 600000 + TRUE, local);
  assert.equal(est.offset, before);
  // pure variant
  assert.equal(KN.estimateOffset([-120, -30, -400]), -30);
  assert.equal(KN.estimateOffset([]), 0);
  assert.equal(KN.estimateOffset([NaN, 5, "x"]), 5);
});

// ---------- pure: Droomster, medailles, pos-codec ----------
test("Droomster: doel schaalt met spelers, som van sterren uit pos-berichten", () => {
  assert.equal(KN.droomsterTarget(1), KN.STARS_PER_PLAYER);
  assert.equal(KN.droomsterTarget(4), 4 * KN.STARS_PER_PLAYER);
  const d = KN.aggregateDroomster({ a: { stars: 30 }, b: { s: 20 }, c: { stars: -5 }, d: null }, 100);
  assert.deepEqual(d, { sum: 50, target: 100, frac: 0.5, full: false });
  const m = new Map([["a", { pos: { stars: 70 } }], ["b", { pos: { stars: 40 } }]]);
  const d2 = KN.aggregateDroomster(m, 100);
  assert.equal(d2.sum, 110);
  assert.equal(d2.frac, 1, "nooit boven 1");
  assert.equal(d2.full, true);
});

test("assignMedals: ranking op sterren, dense medailles, iedereen een unieke titel", () => {
  const res = {
    luke: { name: "Luke", stars: 40, meters: 900, candies: 2, maxHeight: 300, bells: 3, gifts: 1, jumps: 50, hearts: 3 },
    viola: { name: "Viola", stars: 40, meters: 700, candies: 9, maxHeight: 200, bells: 0, gifts: 0, jumps: 30, hearts: 2 },
    rivka: { name: "Rifka", stars: 55, meters: 500, candies: 3, maxHeight: 420, bells: 7, gifts: 2, wishes: 1, jumps: 60, hearts: 1, revived: true },
    zara: { name: "Zarah", stars: 12, meters: 300, candies: 0, maxHeight: 100, bells: 0, gifts: 0, jumps: 10, hearts: 3 },
  };
  const r = KN.assignMedals(res);
  assert.deepEqual(r.map((p) => p.pid), ["rivka", "luke", "viola", "zara"]);
  assert.deepEqual(r.map((p) => p.rank), [1, 2, 2, 4]);
  assert.deepEqual(r.map((p) => p.medal), ["🥇", "🥈", "🥈", "🌟"]);
  const titles = r.map((p) => p.title);
  assert.equal(new Set(titles).size, 4, "unieke titels: " + titles.join(", "));
  assert.equal(r[0].title, "Sterrenverzamelaar");
  assert.equal(r.find((p) => p.pid === "luke").title, "Droomrenner");
  assert.equal(r.find((p) => p.pid === "viola").title, "Zuurstokkampioen");
  assert.ok(r.every((p) => p.emoji && p.title), "iedereen heeft emoji + titel");
  // zelfs met allemaal nullen krijgt iedereen een titel
  const zeros = KN.assignMedals([{ pid: "a", name: "A" }, { pid: "b", name: "B" }, { pid: "c", name: "C" }, { pid: "d", name: "D" }, { pid: "e", name: "E" }]);
  assert.equal(zeros.length, 5);
  assert.ok(zeros.every((p) => p.title));
  assert.ok(zeros.every((p) => p.rank === 1 && p.medal === "🥇"), "allemaal gelijk → allemaal goud");
  // namen uit de spelerslijst als het resultaat er geen heeft
  const named = KN.assignMedals({ x: { stars: 3 } }, { x: { name: "Zarah", animal: "uil" } });
  assert.equal(named[0].name, "Zarah");
  assert.equal(named[0].animal, "uil");
  const tot = KN.familyTotal(res);
  assert.deepEqual(tot, { players: 4, stars: 147, meters: 2400, candies: 14, bells: 10, gifts: 3 });
});

test("pos-codec: compact heen en terug", () => {
  const pos = { x: 1234.6, y: 12.2, anim: "jump", stars: 17, hearts: 2, pw: "magneet", meters: 38.7, t: 12.345 };
  const enc = KN.encodePos(pos, { ds: 0.25, r: 2, at: 99 });
  assert.deepEqual(enc, { x: 1235, y: 12, a: "jump", s: 17, h: 2, m: 39, p: "magneet", t: 12.3, ds: 0.25, r: 2, at: 99 });
  assert.ok(JSON.stringify(enc).length < 120);
  const dec = KN.decodePos(JSON.stringify(enc));
  assert.deepEqual(dec, { x: 1235, y: 12, anim: "jump", stars: 17, hearts: 2, meters: 39, pw: "magneet", t: 12.3, ds: 0.25, at: 99, round: 2 });
  assert.equal(KN.decodePos("{geen json"), null);
  assert.equal(KN.decodePos(null), null);
  assert.equal(KN.decodePos({}).hearts, 3);
  assert.equal(KN.encodePos({}).p, undefined);
});

test("shareUrl: ?join=CODE&b=i (+broker)", () => {
  assert.equal(KN.shareUrl("bako", 1, "https://x.y/app/kerst/index.html?oud=1#frag"), "https://x.y/app/kerst/index.html?join=BAKO&b=1");
  assert.equal(KN.shareUrl("BAKO", null, "https://x.y/kerst/"), "https://x.y/kerst/?join=BAKO");
  assert.equal(KN.shareUrl("BAKO", 0, "https://x.y/kerst/", "ws://localhost:8883"), "https://x.y/kerst/?join=BAKO&b=0&broker=ws%3A%2F%2Flocalhost%3A8883");
});

// ---------- sessies tegen een echte broker ----------
test("lobby: host maakt kamer, spelers joinen, state gaat rond (retained) en ready/animal komen aan", async () => {
  const b = await broker();
  const brokers = [urlOf(b)];
  const code = freshCode();
  const host = await session({ role: "host", code, pid: "luke", profile: { name: "Luke", animal: "vos", difficulty: "stoer" }, brokers });
  assert.equal(host.isHost, true);
  assert.equal(host.code, code);
  assert.equal(host.state.phase, "lobby");
  assert.equal(host.state.hostPid, "luke");
  assert.equal(host.players.length, 1);

  const rivka = await session({ role: "join", code, pid: "rivka", profile: { name: "Rifka", animal: "hert", difficulty: "makkelijk" }, brokers });
  assert.equal(rivka.isHost, false);
  assert.ok(rivka.state.players.rivka, "Rifka staat na createSession in de state");
  assert.equal(rivka.state.players.rivka.ready, false);
  assert.equal(host.state.players.rivka.name, "Rifka");

  const zara = await session({ role: "join", code, pid: "zara", profile: { name: "Zarah", animal: "uil" }, brokers });
  await until(() => rivka.state.players.zara && host.state.players.zara, 4000, "Zarah zichtbaar bij iedereen");
  assert.deepEqual(KN.playerList(rivka.state).map((p) => p.pid), ["luke", "rivka", "zara"]);
  assert.equal(KN.canStart(host.state).ok, false, "niemand is nog klaar");

  // ready + dier wijzigen → bij de host en terug bij de anderen
  await rivka.send("set", { ready: true, animal: "konijn" });
  await until(() => host.state.players.rivka.ready && zara.state.players.rivka.animal === "konijn", 4000, "ready/konijn rond");
  assert.equal(KN.canStart(host.state).ok, true);

  // state is retained: een late waarnemer krijgt de lobby direct
  const found = await DVNet.findRoom(code, { mqtt, brokers, timeoutMs: 1500 });
  assert.ok(found && found.state.phase === "lobby" && found.state.players.zara, "retained lobby-state gevonden");
  assert.equal(found.state.players.rivka.ready, true);

  // verlaten → weg uit de lijst
  await zara.close();
  await until(() => !host.state.players.zara, 4000, "Zarah weg na leave");
  await until(() => !rivka.state.players.zara, 4000, "Zarah ook weg bij Rifka");
});

test("join: onbekende kamer en foute code geven een duidelijke fout", async () => {
  const b = await broker();
  await assert.rejects(session({ role: "join", code: "QQQQ", profile: { name: "X" }, brokers: [urlOf(b)] }), (e) => e.code === "not_found");
  await assert.rejects(session({ role: "join", code: "AB", profile: { name: "X" }, brokers: [urlOf(b)] }), (e) => e.code === "bad_code");
});

test("pos: QoS 0 fan-out naar de anderen, niet naar jezelf, niet retained; done wél retained", async () => {
  const b = await broker();
  const brokers = [urlOf(b)];
  const code = freshCode();
  const host = await session({ role: "host", code, pid: "luke", profile: { name: "Luke" }, brokers });
  const rivka = await session({ role: "join", code, pid: "rivka", profile: { name: "Rifka" }, brokers });
  const viola = await session({ role: "join", code, pid: "viola", profile: { name: "Viola" }, brokers });
  await until(() => host.state.players.viola && rivka.state.players.viola, 4000, "allemaal in de lobby");
  await rivka.send("set", { ready: true });
  await until(() => host.state.players.rivka.ready, 4000, "Rifka klaar");
  host.startRun(4242);
  await until(() => rivka.state.phase === "run" && viola.state.phase === "run", 4000, "run-state bij iedereen");
  assert.equal(rivka.state.seed, 4242);
  assert.equal(rivka.state.round, 1);
  assert.ok(rivka.state.startAt > Date.now() + 2000, "startAt ligt ~4 s vooruit");
  // host-tijd → lokale performance-tijd: zonder echte klokverschillen is het verschil klein
  const perfAt = rivka.toPerf(rivka.state.startAt);
  assert.ok(Math.abs((perfAt - performance.now()) - (rivka.state.startAt - Date.now())) < 500, "toPerf is consistent");

  const gotR = [], gotV = [], gotH = [];
  rivka.on("pos", (pid, pos) => gotR.push([pid, pos]));
  viola.on("pos", (pid, pos) => gotV.push([pid, pos]));
  host.on("pos", (pid, pos) => gotH.push([pid, pos]));
  await rivka.publishPos({ x: 500, y: 0, anim: "run", stars: 7, hearts: 3, pw: null, meters: 15, t: 3.0 });
  await until(() => gotV.length && gotH.length, 4000, "pos van Rifka bij Viola en host");
  assert.equal(gotV[0][0], "rivka");
  assert.equal(gotV[0][1].x, 500);
  assert.equal(gotV[0][1].stars, 7);
  assert.equal(gotV[0][1].round, 1);
  await sleep(150);
  assert.equal(gotR.length, 0, "je eigen pos komt niet terug als ghost");
  // ghosts(): Rifka is zichtbaar voor Viola, wakker
  const gh = viola.ghosts();
  assert.equal(gh.length, 1);
  assert.equal(gh[0].name, "Rifka");
  assert.equal(gh[0].asleep, false);
  assert.equal(viola.ghosts(Date.now() + KN.ASLEEP_MS + 1)[0].asleep, true, "zonder pos 5 s → ingedut");

  // niet retained: een nieuwe client die nu pas op pos/+ abonneert krijgt niets
  const probe = mqtt.connect(brokers[0], { protocolVersion: 4 });
  const seen = [];
  probe.on("message", (t, p) => seen.push([t, p.toString()]));
  await new Promise((r) => probe.once("connect", r));
  const T = KN.topics(code);
  await new Promise((r) => probe.subscribe([T.posAll, T.doneAll], { qos: 1 }, r));
  // done is retained: publiceer en kijk of de probe het (als retained) ziet
  await viola.publishDone({ stars: 9, meters: 120 });
  await until(() => seen.some(([t]) => t === T.done("viola")), 4000, "retained done zichtbaar");
  await sleep(250);
  assert.ok(!seen.some(([t]) => t.indexOf("/pos/") >= 0), "geen retained pos-bericht");
  const doneMsg = JSON.parse(seen.find(([t]) => t === T.done("viola"))[1]);
  assert.equal(doneMsg.stars, 9);
  assert.equal(doneMsg.r, 1);
  await new Promise((r) => probe.end(true, r));
});

test("Droomster: host telt sterren, verspreidt de fractie via zijn pos en stuurt de finale als hij vol is", async () => {
  const b = await broker();
  const brokers = [urlOf(b)];
  const code = freshCode();
  const host = await session({ role: "host", code, pid: "luke", profile: { name: "Luke" }, brokers });
  const rivka = await session({ role: "join", code, pid: "rivka", profile: { name: "Rifka" }, brokers });
  await rivka.send("set", { ready: true });
  await until(() => host.state.players.rivka && host.state.players.rivka.ready, 4000, "Rifka klaar");
  host.startRun(1);
  await until(() => rivka.state.phase === "run", 4000, "run");
  const target = KN.droomsterTarget(2);
  const fracsR = [], evtsR = [], evtsH = [];
  rivka.on("droomster", (f) => fracsR.push(f));
  rivka.on("evt", (e) => evtsR.push(e));
  host.on("evt", (e) => evtsH.push(e));
  await rivka.publishPos({ x: 100, y: 0, anim: "run", stars: Math.floor(target * 0.6), hearts: 3, meters: 3 });
  await until(() => host.droomster().sum >= target * 0.6 - 1, 4000, "host telt Rifka's sterren");
  await host.publishPos({ x: 90, y: 0, anim: "run", stars: 10, hearts: 3, meters: 3 });
  await until(() => fracsR.length, 4000, "Rifka krijgt de Droomster-fractie van de host");
  assert.ok(Math.abs(fracsR[fracsR.length - 1] - (Math.floor(target * 0.6) + 10) / target) < 0.01, "fractie klopt: " + fracsR);
  assert.equal(evtsR.length, 0, "nog geen finale");
  // vol → finale-event bij iedereen (ook lokaal bij de host), precies één keer
  await host.publishPos({ x: 120, y: 0, anim: "run", stars: target, hearts: 3, meters: 4 });
  await until(() => evtsR.some((e) => e.ev === "finale"), 4000, "finale bij Rifka");
  assert.ok(evtsH.some((e) => e.ev === "finale" && e.reason === "droomster"), "finale ook lokaal bij de host");
  await host.publishPos({ x: 130, y: 0, anim: "run", stars: target + 5, hearts: 3, meters: 4 });
  await sleep(200);
  assert.equal(evtsH.filter((e) => e.ev === "finale").length, 1, "finale maar één keer");
  // team-event van een speler komt bij de host (en bij de speler zelf, lokaal)
  await rivka.publishEvt({ ev: "snoepregen" });
  await until(() => evtsH.some((e) => e.ev === "snoepregen" && e.by === "rivka" && e.name === "Rifka"), 4000, "snoepregen bij host");
  assert.ok(evtsR.some((e) => e.ev === "snoepregen"), "lokaal ook");
  assert.ok(!evtsR.some((e) => e.ev === "ping"), "pings worden niet als event doorgegeven");
  assert.ok(rivka.offset.count > 0, "offset-samples uit host-berichten");
});

test("resultaten: host verzamelt done, publiceert results met medailles; herladen tijdens results ziet ze; Nog een keer → lobby", async () => {
  const b = await broker();
  const brokers = [urlOf(b)];
  const code = freshCode();
  const host = await session({ role: "host", code, pid: "luke", profile: { name: "Luke", animal: "vos" }, brokers });
  const rivka = await session({ role: "join", code, pid: "rivka", profile: { name: "Rifka", animal: "hert" }, brokers });
  const zara = await session({ role: "join", code, pid: "zara", profile: { name: "Zarah", animal: "uil" }, brokers });
  await rivka.send("set", { ready: true });
  await until(() => host.state.players.zara && host.state.players.rivka.ready, 4000, "lobby compleet");
  host.startRun(5);
  await until(() => zara.state.phase === "run" && rivka.state.phase === "run", 4000, "run");
  // iedereen geeft een positie door (dan weet de host wie er actief is)
  await Promise.all([host, rivka, zara].map((s) => s.publishPos({ x: 10, y: 0, anim: "run", stars: 1, hearts: 3, meters: 1 })));
  await until(() => host.ghosts().length === 2, 4000, "host ziet 2 ghosts");
  await rivka.publishDone({ stars: 33, meters: 410, candies: 5, maxHeight: 300 });
  await zara.publishDone({ stars: 12, meters: 220, candies: 1, bells: 4 });
  await sleep(300);
  assert.equal(host.state.phase, "run", "host wacht op zijn eigen resultaat");
  await host.publishDone({ stars: 20, meters: 650, candies: 0, gifts: 2 });
  await until(() => host.state.phase === "results", 4000, "results bij host");
  await until(() => rivka.state.phase === "results" && zara.state.phase === "results", 4000, "results bij allen");
  const rk = zara.state.ranking;
  assert.deepEqual(rk.map((p) => p.pid), ["rivka", "luke", "zara"]);
  assert.deepEqual(rk.map((p) => p.medal), ["🥇", "🥈", "🥉"]);
  assert.equal(rk[0].name, "Rifka");
  assert.equal(rk[0].animal, "hert");
  assert.equal(new Set(rk.map((p) => p.title)).size, 3);
  assert.equal(zara.state.total.stars, 65);
  assert.ok(zara.state.droomster && zara.state.droomster.target === KN.droomsterTarget(3));

  // Zarah herlaadt haar telefoon tijdens de uitslag: opnieuw joinen met dezelfde pid → results-state
  await zara.close();
  const zara2 = await session({ role: "join", code, pid: "zara", profile: { name: "Zarah", animal: "uil" }, brokers });
  assert.equal(zara2.state.phase, "results");
  assert.equal(zara2.state.ranking.length, 3);
  assert.ok(zara2.state.players.zara, "Zarah staat (weer) in de lijst");

  // Nog een keer → lobby met een nieuwe seed, klaar-vinkjes uit, done-topics gewist
  const oldSeed = host.state.seed;
  host.again();
  await until(() => zara2.state.phase === "lobby" && rivka.state.phase === "lobby", 4000, "terug in de lobby");
  assert.notEqual(zara2.state.seed, oldSeed);
  assert.equal(zara2.state.players.rivka.ready, false);
  assert.equal(zara2.state.results, null);
  const probe = mqtt.connect(brokers[0], { protocolVersion: 4 });
  const seen = [];
  probe.on("message", (t, p) => seen.push([t, p.toString()]));
  await new Promise((r) => probe.once("connect", r));
  await new Promise((r) => probe.subscribe(KN.topics(code).doneAll, { qos: 1 }, r));
  await sleep(400);
  assert.ok(seen.every(([, p]) => p === ""), "geen oude retained resultaten meer: " + JSON.stringify(seen));
  await new Promise((r) => probe.end(true, r));

  // host herstart (zelfde pid, zelfde code) → neemt zijn eigen kamer weer over
  await host.close();
  const host2 = await session({ role: "host", code, pid: "luke", profile: { name: "Luke", animal: "vos" }, brokers });
  assert.equal(host2.state.phase, "lobby");
  assert.ok(host2.state.players.rivka, "spelers blijven staan na herstart van de host");
  // iemand anders kan de kamer niet 'overnemen'
  await assert.rejects(session({ role: "host", code, pid: "indringer", profile: { name: "X" }, brokers }), (e) => e.code === "occupied");
  // host sluit de kamer → phase closed → joinen lukt niet meer
  await host2.closeRoom();
  await until(async () => { const f = await DVNet.findRoom(code, { mqtt, brokers, timeoutMs: 800 }); return f === null; }, 5000, "kamer gesloten");
});
