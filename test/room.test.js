// Tests voor DVRoom (online/room.js): pariteit met DVInfiltrant, carry-over en de minigame-orkestratie.
// Draai met: node --test test/room.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../online/room.js");
const E = require("../online/engine.js");
const S = require("../online/story-engine.js");
const A = require("../online/arcade.js");
const DVMini = require("../online/minis/core.js");
["blaasbalg", "bijl", "vonken", "slot", "echo", "snel", "verhaal"].forEach((id) => require("../online/minis/" + id + ".js"));
const story = require("../online/story.js");

// ---------- Hulpjes ----------
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
const keyOf = (pid) => "key-" + pid + "-secret";
const WORDS = [{ c: "eten", a: "Koffie", b: "Thee" }, { c: "eten", a: "Pannenkoek", b: "Wafel" }, { c: "dieren", a: "Hond", b: "Kat" }];
const HOST = { pid: "p0", key: keyOf("p0"), name: "Host", avatar: "😎", color: "#ff2e93" };
const PROF = (i) => ({ name: "Speler " + i, avatar: "🐸", color: "#22e6ff" });
// Alleen de kamervelden (die bij alle engines gelijk moeten zijn).
const roomFields = (s) => JSON.parse(JSON.stringify({ phase: s.phase, updatedAt: s.updatedAt, acks: s.acks, keys: s.keys, removed: s.removed, scores: s.scores, players: s.players }));

// Drie engines naast elkaar in de lobby: elke envelop gaat naar allemaal; gedrag en kamervelden moeten gelijk blijven.
function trio() {
  const list = [
    { name: "DVInfiltrant", E, s: E.createState({ code: "BAKO", host: HOST, now: 1000 }) },
    { name: "DVStory", E: S, s: S.createState({ code: "BAKO", host: HOST, now: 1000 }) },
    { name: "DVArcade", E: A, s: A.createState({ code: "BAKO", host: HOST, now: 1000 }) },
  ];
  list.forEach((x) => deepFreeze(x.s));
  let now = 1000;
  const rng = DVMini.rng(5);
  return {
    list,
    ack: (pid) => (Object.prototype.hasOwnProperty.call(list[0].s.acks, pid) ? list[0].s.acks[pid] : null),
    send(env) {
      now += 10;
      const ctx = { rng, now, words: WORDS, story, minis: DVMini };
      const results = list.map((x) => {
        const before = JSON.stringify(x.s);
        const next = x.E.reduce(x.s, env, ctx);
        assert.equal(JSON.stringify(x.s), before, x.name + ": input state gemuteerd");
        const changed = next !== x.s;
        x.s = deepFreeze(next);
        return changed;
      });
      const ref = results[0];
      list.forEach((x, i) => assert.equal(results[i], ref, x.name + " wijkt af (zelfde referentie?) bij " + JSON.stringify(env)));
      const fields = roomFields(list[0].s);
      list.slice(1).forEach((x) => assert.deepEqual(roomFields(x.s), fields, x.name + " kamervelden wijken af na " + JSON.stringify(env)));
      return ref;
    },
    env(pid, t, d, extra = {}) {
      const a = this.ack(pid);
      return { pid, key: extra.key !== undefined ? extra.key : keyOf(pid), seq: extra.seq !== undefined ? extra.seq : (a === null ? 1 : a + 1), t, d: d === undefined ? {} : d };
    },
  };
}

// ---------- Pariteit met DVInfiltrant ----------
test("pariteit: join/profile/leave/kick/onbekende actie, duplicaat, gat, verkeerde key, removed", () => {
  const T = trio();
  assert.equal(T.send(T.env("p1", "join", PROF(1))), true);
  assert.equal(T.send(T.env("p1", "join", PROF(1), { seq: 1 })), false, "duplicaat → zelfde referentie");
  assert.equal(T.send(T.env("p1", "profile", { name: "Gat" }, { seq: 5 })), false, "gat → zelfde referentie");
  assert.equal(T.send(T.env("p1", "profile", { name: "Fout" }, { key: "nope" })), false, "verkeerde key");
  assert.equal(T.send(T.env("p1", "profile", { name: "Jacques", avatar: "🪵", color: "#5aa9ff" })), true);
  assert.equal(T.list[1].s.players[1].name, "Jacques");
  assert.equal(T.send(T.env("p1", "bogus", { x: 1 })), true, "onbekende actie → alleen ack (nieuwe state)");
  assert.equal(T.list[1].s.acks.p1, 3);
  assert.equal(T.send(T.env("zz", "profile", { name: "x" })), false, "onbekende pid: alleen join");
  assert.equal(T.send(T.env("zz", "join", PROF(9), { key: "" })), false, "join zonder key");
  assert.equal(T.send(T.env("zz", "join", PROF(9), { seq: 7 })), true);
  assert.equal(T.list[2].s.acks.zz, 7);
  assert.equal(T.send(T.env("zz", "leave")), true, "lobby leave: speler weg");
  assert.ok(!T.list[1].s.players.some((p) => p.pid === "zz") && !("zz" in T.list[1].s.scores));
  assert.equal(T.send(T.env("zz", "join", PROF(9))), true, "en weer terug (bekende pid zonder speler)");
  assert.equal(T.send(T.env("p0", "leave")), true, "host kan niet weg → alleen ack");
  assert.equal(T.list[0].s.players.length, 3);
  assert.equal(T.send(T.env("p1", "kick", { target: "zz" })), true, "kick door niet-host → alleen ack");
  assert.equal(T.list[0].s.removed.length, 0);
  assert.equal(T.send(T.env("p0", "kick", { target: "p0" })), true, "host kickt zichzelf niet");
  assert.equal(T.send(T.env("p0", "kick", { target: "p1" })), true);
  assert.deepEqual(T.list[1].s.removed, ["p1"]);
  assert.ok(!T.list[2].s.players.some((p) => p.pid === "p1"));
  assert.equal(T.send(T.env("p1", "join", PROF(1))), false, "removed pid wordt genegeerd");
  assert.equal(T.send(T.env("p0", "kick", { target: "p1" })), true, "nog eens kicken → alleen ack");
  assert.equal(T.list[0].s.removed.length, 1);
  // vreemde enveloppen
  for (const env of [null, 5, {}, { pid: "", key: "k", seq: 1, t: "join" }, { pid: "p0", key: keyOf("p0"), seq: 1.5, t: "profile" }, { pid: "p0", key: keyOf("p0"), seq: -1, t: "profile" }, { pid: 7, key: "k", seq: 1, t: "join" }]) {
    assert.equal(T.send(env), false, JSON.stringify(env));
  }
});

test("pariteit: max 12 spelers, 13e alleen ack en later alsnog binnen; d geen object → {}", () => {
  const T = trio();
  for (let i = 1; i <= 11; i++) assert.equal(T.send(T.env("p" + i, "join", PROF(i))), true);
  assert.equal(T.list[0].s.players.length, 12);
  assert.equal(T.send(T.env("p12", "join", PROF(12))), true, "13e: wel ack");
  assert.equal(T.list[1].s.players.length, 12);
  assert.equal(T.list[1].s.acks.p12, 1);
  assert.equal(T.send(T.env("p3", "leave")), true);
  assert.equal(T.send(T.env("p12", "join", "geen object")), true);
  assert.equal(T.list[2].s.players.length, 12);
  assert.equal(T.list[2].s.players.find((p) => p.pid === "p12").name, "Speler");
});

test("pariteit: 3000 willekeurige enveloppen in de lobby", () => {
  const T = trio();
  const rnd = DVMini.rng(42);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const pids = Array.from({ length: 15 }, (_, i) => "p" + i);
  const TYPES = ["join", "join", "join", "profile", "leave", "kick", "bogus", "vote", "ready", "settings_nope"];
  let changed = 0, ignored = 0;
  for (let i = 0; i < 3000; i++) {
    const pid = pick(pids), t = pick(TYPES);
    const a = T.ack(pid);
    const roll = rnd();
    const seq = a === null ? (roll < 0.8 ? 1 + Math.floor(rnd() * 3) : 0) : roll < 0.7 ? a + 1 : roll < 0.85 ? a : a + 2;
    const key = rnd() < 0.9 ? keyOf(pid) : rnd() < 0.5 ? "" : "wrong";
    const d = t === "kick" ? { target: pick(pids) } : t === "join" || t === "profile" ? { name: "N" + Math.floor(rnd() * 99), avatar: pick(["🐸", "🦊", 7, ""]), color: pick(["#123456", "rood", "#abc"]) } : pick([{}, null, "x"]);
    if (T.send({ pid, key, seq, t, d })) changed++; else ignored++;
  }
  assert.ok(changed > 500 && ignored > 300, "mix van geldige en genegeerde enveloppen: " + changed + "/" + ignored);
  for (const x of T.list) {
    assert.equal(x.s.phase, "lobby");
    assert.ok(x.s.players.filter((p) => !p.left).length <= 12);
    for (const pid of Object.keys(x.s.acks)) assert.ok(Object.prototype.hasOwnProperty.call(x.s.keys, pid), "elke ack heeft een key");
  }
});

// ---------- Basis & validate ----------
test("createBase: host auto-joined, acks 0, standaardwaarden; validate geeft base met alleen acks/keys", () => {
  const b = R.createBase({ code: "BAKO", host: HOST, now: 5 });
  assert.deepEqual(b.players, [{ pid: "p0", name: "Host", avatar: "😎", color: "#ff2e93", alive: true, spectator: false, left: false }]);
  assert.deepEqual([b.acks, b.scores, b.keys, b.removed, b.phase, b.updatedAt, b.fire, b.stats], [{ p0: 0 }, { p0: 0 }, { p0: keyOf("p0") }, [], "lobby", 5, null, {}]);
  const v = R.validate(b, { pid: "p1", key: "k1", seq: 4, t: "join", d: 3 });
  assert.deepEqual([v.pid, v.t, v.d], ["p1", "join", {}]);
  assert.deepEqual(v.base.acks, { p0: 0, p1: 4 });
  assert.deepEqual(v.base.keys, { p0: keyOf("p0"), p1: "k1" });
  assert.equal(v.base.players, b.players, "ondiep: alleen acks/keys vervangen");
  assert.equal(R.validate(b, { pid: "p1", key: "k1", seq: 4, t: "profile" }), null);
  assert.equal(R.validate(Object.assign({}, b, { phase: "closed" }), { pid: "p0", key: keyOf("p0"), seq: 1, t: "profile" }), null);
  const w = R.validate(b, { pid: "p0", key: keyOf("p0"), seq: 1, t: "x", d: { a: 1 } });
  assert.deepEqual([w.base.acks, w.d], [{ p0: 1 }, { a: 1 }]);
  // reduce: ctx-fallbacks zoals DVInfiltrant (now ← updatedAt bij alleen-ack, ctx.now bij geldig)
  const acts = R.actions({});
  const s1 = R.reduce(b, { pid: "p0", key: keyOf("p0"), seq: 1, t: "x" }, undefined, acts);
  assert.equal(s1.updatedAt, 5);
  const s2 = R.reduce(s1, { pid: "p0", key: keyOf("p0"), seq: 2, t: "profile", d: { name: "Loek" } }, { now: 99 }, acts);
  assert.deepEqual([s2.updatedAt, s2.players[0].name], [99, "Loek"]);
  assert.equal(R.profile({ name: "  Jan   de  Vries met een hele lange naam ", avatar: 5, color: "x" }).name, "Jan de Vries met");
  assert.deepEqual(R.profile({}, { name: "A", avatar: "B", color: "#abc" }), { name: "A", avatar: "B", color: "#abc" });
  assert.deepEqual(R.profile(null), { name: "Speler", avatar: "🙂", color: "#8b5cff" });
  assert.equal(R.normalize(" Crème Brûlée! "), "cremebrulee");
});

// ---------- Carry-over ----------
test("carryFrom: uit een DVInfiltrant-state (midden in een spel) naar DVStory en terug via DVArcade", () => {
  const rng = DVMini.rng(3);
  let e = E.createState({ code: "BAKO", host: HOST, now: 1 });
  const ctx = { rng, now: 2, words: WORDS };
  const env = (pid, seq, t, d = {}) => ({ pid, key: keyOf(pid), seq, t, d });
  for (let i = 1; i <= 3; i++) e = E.reduce(e, env("p" + i, 10 + i, "join", PROF(i)), ctx);
  e = E.reduce(e, env("p0", 1, "start"), ctx);
  assert.equal(e.phase, "reveal");
  e = E.reduce(e, env("p3", 14, "leave"), ctx);
  e = E.reduce(e, env("p0", 2, "kick", { target: "p2" }), ctx);
  e = Object.assign({}, e, { scores: Object.assign({}, e.scores, { p1: 7 }) });
  const c = R.carryFrom(e);
  assert.deepEqual(c.players.map((p) => p.pid), ["p0", "p1"], "vertrokken en gekickte spelers vallen weg");
  assert.deepEqual(c.keys, e.keys, "keys van álle bekende pids blijven");
  assert.deepEqual(c.acks, { p0: 2, p1: 11, p2: 12, p3: 14 });
  assert.deepEqual(c.scores, { p0: e.scores.p0, p1: 7 }, "scores van de overgebleven spelers (het potje eindigde door het vertrek)");
  assert.deepEqual([c.removed, c.hostPid, c.stats, c.fire], [["p2"], "p0", {}, null]);
  const s = S.createState({ code: "BAKO", host: HOST, carry: c, now: 50 });
  assert.deepEqual(s.players.map((p) => [p.pid, p.name, p.alive, p.spectator, p.left]), [["p0", "Host", true, false, false], ["p1", "Speler 1", true, false, false]]);
  assert.deepEqual([s.acks, s.keys, s.scores, s.removed, s.phase, s.game], [c.acks, c.keys, { p0: e.scores.p0, p1: 7 }, ["p2"], "lobby", "story"]);
  // seq loopt naadloos door: p1 zit op 11
  const sctx = { rng, now: 60, story, minis: DVMini };
  assert.equal(S.reduce(s, env("p1", 11, "profile", { name: "Dup" }), sctx), s, "oude seq → zelfde referentie");
  assert.equal(S.reduce(s, env("p1", 13, "profile", { name: "Gat" }), sctx), s);
  const s2 = S.reduce(s, env("p1", 12, "profile", { name: "Jacques" }), sctx);
  assert.equal(s2.players[1].name, "Jacques");
  assert.equal(S.reduce(s2, env("p2", 13, "join", PROF(2)), sctx), s2, "gekickte pid blijft buiten");
  // stats reizen mee: story → arcade → story
  const withStats = Object.assign({}, s2, { stats: { story: { runs: 3, finished: 2, fails: 1, endings: { legende: 1 }, bestEnding: "legende", bestRank: 18, bestFire: 9 } }, fire: 7 });
  const a = A.createState({ code: "BAKO", host: HOST, carry: R.carryFrom(withStats), now: 70 });
  assert.deepEqual([a.game, a.fire, a.stats.story.runs, a.players.length, a.acks], ["arcade", 7, 3, 2, withStats.acks]);
  const back = S.createState({ code: "BAKO", host: HOST, carry: R.carryFrom(Object.assign({}, a, { stats: Object.assign({}, a.stats, { arcade: { records: { snel: { best: 4, plays: 1, last: 4 } }, plays: 1 } }) })), now: 80 });
  assert.deepEqual(back.stats.story.bestEnding, "legende");
  assert.deepEqual(back.stats.arcade.records.snel.best, 4);
  assert.equal(back.fire, 7);
  // zonder carry-host: host uit het host-argument; met carry zonder host erin wordt de host toegevoegd
  const odd = S.createState({ code: "X", host: { pid: "h", key: "hk" }, carry: { players: [{ pid: "q", name: "Q" }], keys: { q: "qk" }, acks: { q: 4 } } });
  assert.deepEqual(odd.players.map((p) => p.pid), ["h", "q"]);
  assert.deepEqual([odd.acks, odd.keys], [{ q: 4, h: 0 }, { q: "qk", h: "hk" }]);
  assert.equal(R.carryFrom(null), null);
});

// ---------- Minigame-orkestratie ----------
function miniState(n = 3) {
  const s = R.createBase({ code: "BAKO", host: HOST, now: 1 });
  for (let i = 1; i < n; i++) s.players.push({ pid: "p" + i, name: "Speler " + i, avatar: "🐸", color: "#22e6ff", alive: true, spectator: false, left: false });
  s.phase = "mini";
  return Object.assign(s, { mini: null, miniResults: {}, miniShared: null, miniNonce: 0 });
}
const mctx = (seed = 1, now = 1000) => ({ rng: DVMini.rng(seed), now, minis: DVMini });

test("mini: begin/submit/done/finish (lokaal), ontbrekende resultaten null, vertrokken spelers tellen niet mee", () => {
  const s = miniState(3), ctx = mctx();
  assert.equal(R.mini.begin(s, ctx, { id: "bestaatniet", difficulty: 2 }), false);
  assert.equal(R.mini.begin(s, ctx, { id: "blaasbalg", difficulty: 7 }), true);
  assert.deepEqual([s.mini.id, s.mini.kind, s.mini.nonce, s.mini.difficulty, s.mini.pids, s.mini.submitted, s.mini.roles], ["blaasbalg", "local", 1, 3, ["p0", "p1", "p2"], [], null]);
  assert.ok(Number.isInteger(s.mini.seed) && s.mini.seed >= 0);
  const r = DVMini.get("blaasbalg").bot(DVMini.rng(2), 3);
  assert.equal(R.mini.submit(s, "p0", { k: "result", nonce: 2, r }, ctx), false, "verkeerde nonce");
  assert.equal(R.mini.submit(s, "px", { k: "result", nonce: 1, r }, ctx), false, "geen deelnemer");
  assert.equal(R.mini.act(s, "p0", { k: "act", nonce: 1, a: { t: "x" } }, ctx), false, "act op een lokale mini");
  assert.equal(R.mini.submit(s, "p0", { k: "result", nonce: 1, r }, ctx), true);
  assert.equal(R.mini.submit(s, "p0", { k: "result", nonce: 1, r }, ctx), false, "één keer inleveren");
  assert.equal(R.mini.done(s, ctx), false);
  // p1 vertrekt: niet meer nodig
  s.players[1].left = true;
  assert.equal(R.mini.done(s, ctx), false);
  assert.equal(R.mini.submit(s, "p1", { k: "result", nonce: 1, r }, ctx), false, "vertrokken speler kan niet meer inleveren");
  assert.equal(R.mini.submit(s, "p2", { k: "result", nonce: 1, r: null }, ctx), true, "null = niets ingeleverd maar wel klaar");
  assert.equal(R.mini.done(s, ctx), true);
  const out = R.mini.finish(s, ctx, { skipped: false });
  assert.deepEqual(out.pids, ["p0", "p2"]);
  assert.ok(Number.isInteger(out.logs) && out.logs >= -2 && out.logs <= 4);
  assert.deepEqual(Object.keys(out.perPlayer).sort(), ["p0", "p2"]);
  assert.equal(out.perPlayer.p2, "—", "geen resultaat → streepje uit de minigame");
  assert.ok(out.lines.length >= 1 && out.lines.every((l) => typeof l === "string"));
  assert.ok(out.mvp === null || out.mvp === "p0");
  assert.deepEqual([out.verdict, R.mini.verdict(2), R.mini.verdict(1), R.mini.verdict(0), R.mini.verdict(-1)], [R.mini.verdict(out.logs), "win", "meh", "meh", "lose"]);
  assert.deepEqual([s.mini, s.miniResults, s.miniShared], [null, {}, null]);
  // tweede mini: nonce 2
  R.mini.begin(s, ctx, { id: "snel", difficulty: 1 });
  assert.equal(s.mini.nonce, 2);
  assert.deepEqual(s.mini.pids, ["p0", "p2"]);
  const sk = R.mini.finish(s, ctx, { skipped: true });
  assert.deepEqual([sk.skipped, sk.logs, sk.verdict], [true, -2, "lose"], "snel zonder enige tik: -2");
});

test("mini: net-minigame (slot) — rollen, view per speler, act, vertrokken slot-speler wordt door de bot afgemaakt", () => {
  const s = miniState(3), ctx = mctx(4);
  assert.equal(R.mini.begin(s, ctx, { id: "slot", difficulty: 1 }), true);
  const def = DVMini.get("slot");
  assert.equal(s.mini.kind, "net");
  const slotPid = Object.keys(s.mini.roles).find((p) => s.mini.roles[p] === "slot");
  const gids = s.mini.pids.filter((p) => p !== slotPid);
  assert.equal(gids.length, 2);
  assert.ok(s.miniShared && s.miniShared.code);
  assert.equal(R.mini.view(s, slotPid, ctx).role, "slot");
  assert.equal(R.mini.view(s, gids[0], ctx).role, "gids");
  assert.equal(R.mini.view(s, "vreemde", ctx).role, "kijker");
  assert.equal(R.mini.submit(s, slotPid, { k: "result", nonce: 1, r: {} }, ctx), false, "result op een net-mini");
  assert.equal(R.mini.act(s, slotPid, { k: "act", nonce: 1, a: { t: "rot", ring: 0, dir: 1 } }, ctx), false, "ongeldig (nog niet gestart) → zelfde referentie → false");
  assert.equal(R.mini.act(s, slotPid, { k: "act", nonce: 1, a: "go" }, ctx), false);
  assert.equal(R.mini.act(s, slotPid, { k: "act", nonce: 1, a: { t: "go" } }, ctx), true);
  assert.equal(R.mini.done(s, ctx), false);
  // slot-speler vertrekt → bot probeert (max 3) → klaar
  s.players.find((p) => p.pid === slotPid).left = true;
  R.mini.drop(s, slotPid, ctx);
  assert.ok(def.result(s.miniShared), "bot heeft de kist afgemaakt: " + JSON.stringify(s.miniShared.tries));
  assert.equal(R.mini.done(s, ctx), true);
  const out = R.mini.finish(s, ctx, {});
  assert.deepEqual(out.pids, gids);
  assert.ok(out.logs >= -1 && out.logs <= 4);
  assert.equal(out.mvp, null, "mvp (het slot) is vertrokken → geen mvp");
});

test("mini: begin met init-extra's (echo onbeperkt) en spelersfilter", () => {
  const s = miniState(2), ctx = mctx(9);
  assert.equal(R.mini.begin(s, ctx, { id: "echo", difficulty: 2, pids: ["p1", "zz"], init: { rounds: 0 } }), true);
  assert.deepEqual(s.mini.pids, ["p1"]);
  assert.equal(s.miniShared.max, 0);
  assert.equal(R.mini.publicOf(s).roles, null);
  assert.ok(!("submitted" in R.mini.publicOf(s)) || Array.isArray(R.mini.publicOf(s).submitted));
  assert.equal(R.mini.begin(s, ctx, { id: "echo", difficulty: 2, pids: ["zz"] }), false, "geen enkele deelnemer");
});
