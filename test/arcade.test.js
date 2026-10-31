// Tests voor de arcade-engine (online/arcade.js). Draai met: node --test test/arcade.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const DVMini = require("../online/minis/core.js");
const MINI_IDS = ["blaasbalg", "bijl", "vonken", "slot", "echo", "snel", "verhaal"];
MINI_IDS.forEach((id) => require("../online/minis/" + id + ".js"));
const R = require("../online/room.js");
const A = require("../online/arcade.js");
const S = require("../online/story-engine.js");

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
const NAMES = ["Loek", "Jacques", "Sanne", "Mo", "Iris", "Daan", "Fem"];
const keyOf = (pid) => "key-" + pid + "-secret";
const hasAck = (s, pid) => Object.prototype.hasOwnProperty.call(s.acks, pid);

function room(n = 2, opts = {}) {
  const rng = DVMini.rng(opts.seed || 1);
  let now = 1000;
  const ctx = () => ({ rng, now: (now += 10), minis: DVMini });
  let state = deepFreeze(A.createState({ code: "BAKO", host: { pid: "p0", key: keyOf("p0"), name: NAMES[0], avatar: "🔥", color: "#ff6a1a" }, settings: opts.settings, carry: opts.carry, now }));
  const r = {
    get s() { return state; },
    get now() { return now; },
    set now(v) { now = v; },
    env(pid, t, d = {}, extra = {}) {
      const seq = extra.seq != null ? extra.seq : (hasAck(state, pid) ? state.acks[pid] : 0) + 1;
      return { pid, key: extra.key != null ? extra.key : keyOf(pid), seq, t, d };
    },
    act(pid, t, d, extra) {
      const prev = state, before = JSON.stringify(prev);
      const next = A.reduce(prev, r.env(pid, t, d, extra), ctx());
      assert.equal(JSON.stringify(prev), before, "input state mutated");
      state = deepFreeze(next);
      return next !== prev;
    },
    join(pid) { return r.act(pid, "join", { name: NAMES[+pid.slice(1)] || pid, avatar: "🪵", color: "#5aa9ff" }); },
    p(pid) { return state.players.find((x) => x.pid === pid); },
    active() { return state.players.filter((p) => !p.left && !p.spectator).map((p) => p.pid); },
    pub() { return A.publicView(state); },
    priv(pid) { return A.privateView(state, pid, { minis: DVMini }); },
    submitAll(result) { const m = state.mini; for (const pid of m.pids) if (state.phase === "mini") r.act(pid, "mini", { k: "result", nonce: m.nonce, r: typeof result === "function" ? result(pid) : result }); },
  };
  for (let i = 1; i < n; i++) r.join("p" + i);
  return r;
}

test("createState: lobby, arcade-velden, standaard moeilijkheid 2, vuur 4; publicView zonder geheimen", () => {
  const r = room(2);
  const s = r.s;
  assert.deepEqual([s.game, s.phase, s.settings, s.fire, s.maxFire, s.mini, s.miniResult, s.lastMini], ["arcade", "lobby", { difficulty: 2 }, 4, 10, null, null, null]);
  assert.deepEqual([A.MIN_PLAYERS, A.MAX_PLAYERS, A.DEFAULT_SETTINGS], [1, 6, { difficulty: 2 }]);
  const pub = r.pub();
  assert.equal(pub.game, "arcade");
  assert.ok(!("keys" in pub) && !("miniResults" in pub) && !("miniShared" in pub));
  assert.ok(!JSON.stringify(pub).includes("-secret"));
  assert.equal(r.priv("p0"), null);
});

test("lobby → pick → mini → miniResult → pick: punten (logs + mvp), records, vuur, next/end", () => {
  const r = room(2);
  assert.equal(r.act("p1", "start"), true);
  assert.equal(r.s.phase, "lobby", "niet-host");
  assert.equal(r.act("p0", "start"), true);
  assert.equal(r.s.phase, "pick");
  assert.equal(r.act("p0", "pick", { id: "bestaatniet" }), true, "ack");
  assert.equal(r.s.phase, "pick");
  assert.equal(r.act("p0", "pick", { id: "snel", difficulty: 3 }), true);
  assert.deepEqual([r.s.phase, r.s.mini.id, r.s.mini.difficulty, r.s.settings.difficulty, r.s.mini.pids, r.s.lastMini], ["mini", "snel", 3, 3, ["p0", "p1"], "snel"]);
  assert.equal(r.act("p0", "pick", { id: "bijl" }), true, "tijdens een mini niet kiezen: alleen ack");
  assert.equal(r.s.mini.id, "snel");
  // p0 sneller dan de Vorst in alle rondes, p1 ook → sweep = 4 blokken; mvp = snelste
  r.submitAll((pid) => ({ times: pid === "p0" ? [180, 190, 200] : [230, 240, 250] }));
  const mr = r.s.miniResult;
  assert.deepEqual([r.s.phase, mr.id, mr.logs, mr.verdict, mr.mvp, mr.fireBefore, mr.fireAfter, r.s.fire], ["miniResult", "snel", 4, "win", "p0", 4, 8, 8]);
  assert.deepEqual(mr.points, { p0: 5, p1: 4 });
  assert.deepEqual(r.s.scores, { p0: 5, p1: 4 });
  assert.deepEqual([mr.record, mr.best, r.s.stats.arcade.records.snel, r.s.stats.arcade.plays], [true, 4, { best: 4, plays: 1, last: 4 }, 1]);
  assert.equal(r.s.mini, null);
  assert.equal(r.pub().miniResult.points.p0, 5);
  assert.equal(r.act("p1", "next"), true);
  assert.equal(r.s.phase, "miniResult", "next is voor de host");
  assert.equal(r.act("p0", "next"), true);
  assert.equal(r.s.phase, "pick");
  // tweede keer slechter: geen record, punten 0 bij negatieve logs
  r.act("p0", "pick", { id: "snel" });
  assert.equal(r.s.mini.nonce, 2);
  r.submitAll({ times: [null, null, null] });
  assert.deepEqual([r.s.miniResult.logs, r.s.miniResult.record, r.s.miniResult.best, r.s.miniResult.points, r.s.fire], [-2, false, 4, { p0: 0, p1: 0 }, 6]);
  assert.deepEqual(r.s.stats.arcade.records.snel, { best: 4, plays: 2, last: -2 });
  assert.deepEqual(r.s.scores, { p0: 5, p1: 4 });
  // direct opnieuw kiezen vanuit miniResult mag ook
  assert.equal(r.act("p0", "pick", { id: "vonken", difficulty: 1 }), true);
  assert.equal(r.s.phase, "mini");
  assert.equal(r.act("p0", "skipMini"), true);
  assert.deepEqual([r.s.phase, r.s.miniResult.skipped, r.s.miniResult.perPlayer.p1], ["miniResult", true, "—"]);
  assert.equal(r.act("p0", "end"), true);
  assert.deepEqual([r.s.phase, r.s.mini, r.s.miniResult, r.s.scores.p0], ["lobby", null, null, 5]);
  assert.equal(r.act("p0", "end"), true, "end in de lobby: alleen ack");
  // pick mag ook meteen vanuit de lobby
  assert.equal(r.act("p0", "pick", { id: "blaasbalg" }), true);
  assert.equal(r.s.phase, "mini");
});

test("settings: 1..3, host, lobby/pick; grenzen 1–6 spelers; toeschouwers doen mee bij de volgende pick", () => {
  const r = room(1);
  assert.equal(r.act("p0", "settings", { difficulty: 4 }), true);
  assert.equal(r.s.settings.difficulty, 2);
  assert.equal(r.act("p0", "settings", { difficulty: 1 }), true);
  assert.equal(r.s.settings.difficulty, 1);
  assert.equal(r.act("p0", "start"), true, "arcade kan solo");
  assert.equal(r.s.phase, "pick");
  r.act("p0", "pick", { id: "verhaal" });
  assert.deepEqual(r.s.mini.pids, ["p0"]);
  r.join("p1");
  assert.equal(r.p("p1").spectator, true);
  assert.equal(r.act("p1", "mini", { k: "act", nonce: r.s.mini.nonce, a: { t: "klaar" } }), true, "toeschouwer: alleen ack");
  assert.equal(r.s.phase, "mini");
  // solo verhaal: verteller zegt klaar, Gloei geeft zelf 2 vlammen
  assert.equal(r.act("p0", "mini", { k: "act", nonce: r.s.mini.nonce, a: { t: "klaar" } }), true);
  assert.equal(r.s.phase, "miniResult");
  assert.ok(r.s.miniResult.logs >= 1);
  r.act("p0", "next");
  assert.equal(r.p("p1").spectator, false, "na next doet p1 mee");
  for (let i = 2; i <= 6; i++) r.join("p" + i);
  assert.equal(r.s.players.length, 7);
  assert.equal(r.act("p0", "pick", { id: "bijl" }), true);
  assert.equal(r.s.phase, "pick", "7 spelers: te veel");
  r.act("p6", "leave");
  assert.equal(r.s.players.length, 7, "in pick-fase blijft hij staan als left");
  assert.equal(r.act("p0", "pick", { id: "bijl" }), true);
  assert.deepEqual([r.s.phase, r.s.players.length, r.s.mini.pids.length], ["mini", 6, 6]);
  assert.equal(r.act("p0", "settings", { difficulty: 3 }), true);
  assert.equal(r.s.settings.difficulty, 1, "tijdens een mini niet");
});

test("echo in de arcade is onbeperkt (rounds 0) met opgeven; privateView per speler; vertrek tijdens net-mini", () => {
  const r = room(3);
  r.act("p0", "pick", { id: "echo", difficulty: 2 });
  assert.equal(r.s.miniShared.max, 0);
  const act = (pid, a) => r.act(pid, "mini", { k: "act", nonce: r.s.mini.nonce, a });
  for (let i = 0; i < 7; i++) for (const pid of r.s.mini.pids) assert.equal(act(pid, { t: "word", w: pid + "w" + i }), true);
  assert.equal(r.s.miniShared.final, false, "geen laatste ronde in de arcade");
  const pv = r.priv("p0");
  assert.deepEqual([pv.v, pv.game, pv.nonce, pv.miniId, pv.miniView.round], [1, "arcade", 1, "echo", 8]);
  assert.equal(A.privateView(r.s, "p0").miniView.round, 8, "zonder ctx: registry uit de laatste reduce");
  assert.equal(r.priv("zz"), null);
  assert.equal(r.act("p2", "leave"), true);
  assert.deepEqual([r.s.phase, r.p("p2").left], ["mini", true]);
  assert.ok(typeof r.s.miniShared.cur.p2 === "string", "de bot van p2 heeft al een woord ingeleverd");
  assert.equal(act("p0", { t: "quit", on: true }), true);
  assert.equal(act("p1", { t: "quit", on: true }), true);
  assert.equal(r.s.phase, "mini", "p2's bot moet ook opgeven (of Telt! tikken)");
  for (const pid of ["p0", "p1"]) if (r.s.phase === "mini") act(pid, { t: "word", w: pid + "x" });
  // na deze onthulling stemt de bot van p2 niet vanzelf (geen final): host maakt er een eind aan
  if (r.s.phase === "mini") assert.equal(r.act("p0", "skipMini"), true);
  assert.deepEqual([r.s.phase, r.s.miniResult.pids], ["miniResult", ["p0", "p1"]]);
  assert.ok(r.s.miniResult.logs >= -2);
});

test("carry: vanuit DVStory met stats en vuur; scores blijven het scorebord van de kamer", () => {
  const story = require("../online/story.js");
  let st = S.createState({ code: "BAKO", host: { pid: "p0", key: keyOf("p0"), name: "Loek" }, now: 1 });
  st = S.reduce(st, { pid: "p1", key: keyOf("p1"), seq: 2, t: "join", d: { name: "Jacques" } }, { rng: DVMini.rng(1), now: 2, story, minis: DVMini });
  st = Object.assign({}, st, { fire: 9, scores: { p0: 3, p1: 1 }, stats: { story: { runs: 2, finished: 1, fails: 0, endings: { legende: 1 }, bestEnding: "legende", bestRank: 18, bestFire: 9 } } });
  const r = room(1, { carry: R.carryFrom(st) });
  assert.deepEqual([r.s.players.map((p) => p.name), r.s.acks, r.s.scores, r.s.fire, r.s.stats.story.bestEnding], [["Loek", "Jacques"], { p0: 0, p1: 2 }, { p0: 3, p1: 1 }, 9, "legende"]);
  assert.equal(A.reduce(r.s, r.env("p1", "profile", { name: "x" }, { seq: 2 }), { minis: DVMini }), r.s, "oude seq → zelfde referentie");
  r.act("p0", "pick", { id: "blaasbalg", difficulty: 1 });
  r.submitAll({ total: 50, hits: 50, perfect: 50, misses: 0, stray: 0, combo: 20 });
  assert.deepEqual([r.s.miniResult.logs, r.s.fire, r.s.miniResult.mvp], [3, 10, "p0"], "gelijk spel → eerste speler is mvp");
  assert.deepEqual(r.s.scores, { p0: 7, p1: 4 }, "3 blokken elk, mvp +1");
  const back = S.createState({ code: "BAKO", host: { pid: "p0", key: keyOf("p0") }, carry: R.carryFrom(r.s), now: 5 });
  assert.deepEqual([back.scores, back.fire, back.stats.arcade.records.blaasbalg.best, back.stats.story.runs, back.acks], [{ p0: 7, p1: 4 }, 10, 3, 2, r.s.acks]);
});

test("seq/ack en zuiverheid: duplicaat/gat/verkeerde key → zelfde referentie; ongeldig → alleen ack; geen Math.random", () => {
  const r = room(2);
  const prev = r.s;
  assert.equal(A.reduce(prev, r.env("p1", "profile", { name: "x" }, { seq: prev.acks.p1 }), { minis: DVMini }), prev);
  assert.equal(A.reduce(prev, r.env("p1", "profile", { name: "x" }, { seq: prev.acks.p1 + 2 }), { minis: DVMini }), prev);
  assert.equal(A.reduce(prev, r.env("p1", "profile", { name: "x" }, { key: "k" }), { minis: DVMini }), prev);
  const ackOnly = A.reduce(prev, r.env("p1", "pick", { id: "snel" }), { minis: DVMini, now: 5 });
  assert.notEqual(ackOnly, prev);
  const strip = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.acks; return c; };
  assert.deepEqual(strip(ackOnly), strip(prev));
  assert.equal(ackOnly.acks.p1, prev.acks.p1 + 1);
  // 300 willekeurige acties zonder crash, vuur binnen bereik, publicView zonder geheimen
  const rnd = DVMini.rng(8);
  const T = ["start", "pick", "mini", "skipMini", "next", "end", "settings", "leave", "join", "bogus"];
  for (let i = 0; i < 300; i++) {
    const pid = rnd() < 0.6 ? "p0" : "p1";
    const t = T[Math.floor(rnd() * T.length)];
    const m = r.s.mini;
    const d = t === "pick" ? { id: MINI_IDS[Math.floor(rnd() * 7)], difficulty: 1 + Math.floor(rnd() * 3) } : t === "mini" && m ? (m.kind === "local" ? { k: "result", nonce: m.nonce, r: DVMini.get(m.id).bot(rnd, m.difficulty) } : { k: "act", nonce: m.nonce, a: DVMini.get(m.id).bot(DVMini.get(m.id).view(r.s.miniShared, pid), rnd) || { t: "go" } }) : t === "join" ? { name: "N" } : { difficulty: 2 };
    r.act(pid, t, d);
    assert.ok(r.s.fire >= 0 && r.s.fire <= 10);
    assert.ok(["lobby", "pick", "mini", "miniResult"].includes(r.s.phase));
    assert.ok(!JSON.stringify(r.pub()).includes("-secret"));
  }
  assert.ok(r.s.stats.arcade && r.s.stats.arcade.plays > 0, "er is gespeeld");
});
