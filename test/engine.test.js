// Tests voor de pure Infiltrant-engine (online/engine.js). Draai met: node --test test/engine.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../online/engine.js");

// ---------- Hulpjes ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
const WORDS = [
  { c: "eten", a: "Koffie", b: "Thee" },
  { c: "eten", a: "Pannenkoek", b: "Wafel" },
  { c: "dieren", a: "Hond", b: "Kat" },
  { c: "dieren", a: "Olifant", b: "Neushoorn" },
  { c: "plekken", a: "Café", b: "Restaurant" },
];
const keyOf = (pid) => "key-" + pid + "-secret";
const hasAck = (s, pid) => Object.prototype.hasOwnProperty.call(s.acks, pid);

// Kamer met n spelers (p0 = host). Elke state wordt diep bevroren → engine mag niets muteren.
function room(n = 4, opts = {}) {
  const rng = mulberry32(opts.seed || 1);
  let now = 1000;
  const words = opts.words || WORDS;
  const ctx = () => ({ rng, now: (now += 10), words });
  let state = deepFreeze(E.createState({
    code: "BAKO", host: { pid: "p0", key: keyOf("p0"), name: "Host", avatar: "😎", color: "#ff2e93" }, settings: opts.settings, now,
  }));
  const r = {
    get s() { return state; },
    set s(v) { state = deepFreeze(v); },
    ctx,
    env(pid, t, d = {}, extra = {}) {
      const seq = extra.seq != null ? extra.seq : (hasAck(state, pid) ? state.acks[pid] : 0) + 1;
      return { pid, key: extra.key != null ? extra.key : keyOf(pid), seq, t, d };
    },
    act(pid, t, d, extra) {
      const prev = state;
      const before = JSON.stringify(prev);
      const next = E.reduce(prev, r.env(pid, t, d, extra), ctx());
      assert.equal(JSON.stringify(prev), before, "input state mutated");
      state = deepFreeze(next);
      return next;
    },
    join(pid, name = "Speler " + pid) { return r.act(pid, "join", { name, avatar: "🐸", color: "#22e6ff" }); },
    p(pid) { return state.players.find((x) => x.pid === pid); },
    alive() { return state.players.filter((x) => x.alive && !x.left).map((x) => x.pid); },
    infs() { return Object.keys(state.roles).filter((p) => state.roles[p] === "infiltrant"); },
    burgers() { return Object.keys(state.roles).filter((p) => state.roles[p] === "burger"); },
    start() { r.act("p0", "start"); assert.equal(state.phase, "reveal"); },
    revealAll() { for (const pid of r.alive()) r.act(pid, "revealed"); assert.equal(state.phase, "hints"); },
    hintsAll() { let guard = 100; while (state.phase === "hints" && guard--) r.act(state.turn.pid, "hint", { text: "hint" }); },
    voteAll(pick) { for (const v of r.alive()) if (state.phase === "vote" && !state.voted.includes(v)) r.act(v, "vote", { target: pick(v) }); },
    // Alle stemmen op target (target zelf stemt op een ander levend)
    voteOut(target) {
      const other = (v) => r.alive().find((x) => x !== v && x !== target);
      r.voteAll((v) => (v === target ? other(v) : target));
    },
  };
  for (let i = 1; i < n; i++) r.join("p" + i);
  return r;
}
const noAcks = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.acks; return c; };
function assertAckOnly(prev, next, pid, seq) {
  assert.notEqual(next, prev);
  assert.equal(next.acks[pid], seq);
  assert.deepEqual(noAcks(next), noAcks(prev));
}

// ---------- Basis ----------
test("createState: host auto-joined, defaults, acks 0", () => {
  const r = room(1);
  const s = r.s;
  assert.equal(s.hostPid, "p0");
  assert.equal(s.phase, "lobby");
  assert.equal(s.acks.p0, 0);
  assert.equal(s.scores.p0, 0);
  assert.deepEqual(s.settings, { mode: "woord", infiltrants: 1, hintRounds: 1, timer: 0, categories: [] });
  assert.deepEqual(s.players[0], { pid: "p0", name: "Host", avatar: "😎", color: "#ff2e93", alive: true, spectator: false, left: false });
  assert.equal(E.MIN_PLAYERS, 3);
  assert.equal(E.MAX_PLAYERS, 12);
  assert.ok(Object.isFrozen(E.DEFAULT_SETTINGS));
  const pub = E.publicView(s);
  assert.equal(pub.v, 1);
  assert.equal(pub.code, "BAKO");
  assert.ok(!JSON.stringify(pub).includes(keyOf("p0")));
  assert.equal(E.privateView(s, "p0"), null);
});

test("join: registreert key/ack, schoont naam op, fallback", () => {
  const r = room(1);
  r.act("p1", "join", { name: "   Jan   de   Vries met een hele lange naam ", avatar: "🦊", color: "#9dff3d" }, { seq: 5 });
  assert.equal(r.s.acks.p1, 5);
  assert.equal(r.s.keys.p1, keyOf("p1"));
  const p = r.p("p1");
  assert.equal(p.name, "Jan de Vries met");
  assert.equal([...p.name].length <= 16, true);
  assert.equal(p.avatar, "🦊");
  assert.equal(r.s.scores.p1, 0);
  r.act("p2", "join", { name: "   ", avatar: 5, color: "red" });
  assert.equal(r.p("p2").name, "Speler");
  assert.equal(typeof r.p("p2").avatar, "string");
  assert.match(r.p("p2").color, /^#/);
  // tweede join van bekende pid (seq 6) = profiel updaten, geen dubbele speler
  r.act("p1", "join", { name: "Jan", avatar: "🐼", color: "#ffe03d" }, { seq: 6 });
  assert.equal(r.s.players.filter((x) => x.pid === "p1").length, 1);
  assert.equal(r.p("p1").name, "Jan");
  assert.equal(r.p("p1").avatar, "🐼");
});

test("unknown pid: alleen join wordt geaccepteerd", () => {
  const r = room(2);
  const prev = r.s;
  assert.equal(E.reduce(prev, { pid: "x", key: "k", seq: 1, t: "vote", d: { target: "p0" } }, r.ctx()), prev);
  assert.equal(E.reduce(prev, { pid: "x", key: "", seq: 1, t: "join", d: {} }, r.ctx()), prev);
  assert.equal(E.reduce(prev, { pid: "", key: "k", seq: 1, t: "join", d: {} }, r.ctx()), prev);
  assert.equal(E.reduce(prev, { pid: "x", key: "k", seq: 1.5, t: "join", d: {} }, r.ctx()), prev);
  assert.equal(E.reduce(prev, null, r.ctx()), prev);
});

test("profile: update eigen profiel, ongeldige velden behouden oude waarde", () => {
  const r = room(2);
  r.act("p1", "profile", { name: "Nieuw", avatar: "🐙", color: "#123456" });
  assert.deepEqual([r.p("p1").name, r.p("p1").avatar, r.p("p1").color], ["Nieuw", "🐙", "#123456"]);
  r.act("p1", "profile", { name: "", color: "nope" });
  assert.deepEqual([r.p("p1").name, r.p("p1").avatar, r.p("p1").color], ["Nieuw", "🐙", "#123456"]);
});

test("max 12 spelers: 13e wordt genegeerd maar ge-ackt, later alsnog binnen", () => {
  const r = room(12);
  assert.equal(r.s.players.length, 12);
  const prev = r.s;
  r.join("p12");
  assert.equal(r.s.players.length, 12);
  assert.equal(r.s.acks.p12, 1);
  assert.equal(r.s.keys.p12, keyOf("p12"));
  assert.equal(r.s.updatedAt, prev.updatedAt);
  r.act("p5", "leave");
  assert.equal(r.s.players.length, 11);
  r.join("p12");
  assert.equal(r.s.acks.p12, 2);
  assert.ok(r.p("p12"));
  assert.equal(r.s.players.length, 12);
});

test("leave in lobby: speler helemaal weg; host kan niet vertrekken; rejoin werkt", () => {
  const r = room(4);
  r.act("p2", "leave");
  assert.equal(r.p("p2"), undefined);
  assert.equal(r.s.scores.p2, undefined);
  assert.equal(r.s.acks.p2, 2);
  const prev = r.s;
  r.act("p0", "leave");
  assertAckOnly(prev, r.s, "p0", 1);
  r.join("p2");
  assert.ok(r.p("p2"));
  assert.equal(r.s.players.at(-1).pid, "p2");
});

test("kick: host only, removed, envelopes van removed genegeerd, rejoin met nieuwe pid", () => {
  const r = room(4);
  let prev = r.s;
  r.act("p1", "kick", { target: "p2" });
  assertAckOnly(prev, r.s, "p1", 2);
  prev = r.s;
  r.act("p0", "kick", { target: "p0" });
  assertAckOnly(prev, r.s, "p0", 1);
  prev = r.s;
  r.act("p0", "kick", { target: "nobody" });
  assertAckOnly(prev, r.s, "p0", 2);
  r.act("p0", "kick", { target: "p2" });
  assert.deepEqual(r.s.removed, ["p2"]);
  assert.equal(r.p("p2"), undefined);
  prev = r.s;
  assert.equal(E.reduce(prev, r.env("p2", "join", { name: "Terug" }), r.ctx()), prev);
  assert.equal(E.reduce(prev, r.env("p2", "join", { name: "Terug" }, { seq: 1 }), r.ctx()), prev);
  r.join("p2b", "Terug");
  assert.ok(r.p("p2b"));
  assert.ok(E.publicView(r.s).removed.includes("p2"));
});

test("kick in game: zelfde als leave, plus removed", () => {
  const r = room(5, { seed: 3 });
  r.start(); r.revealAll();
  const target = r.burgers().find((p) => p !== "p0");
  r.act("p0", "kick", { target });
  assert.equal(r.p(target).left, true);
  assert.equal(r.p(target).alive, false);
  assert.ok(r.s.removed.includes(target));
  assert.equal(E.privateView(r.s, target), null);
});

// ---------- Instellingen ----------
test("settings: valideren, mergen, host & lobby only", () => {
  const r = room(3);
  r.act("p0", "settings", { mode: "blind", hintRounds: 3 }, {});
  assert.equal(r.s.settings.mode, "blind");
  assert.equal(r.s.settings.hintRounds, 3);
  assert.equal(r.s.settings.timer, 0);
  r.act("p0", "settings", { mode: "evil", infiltrants: 3, hintRounds: 0, timer: 45, categories: "x", extra: 1 });
  assert.deepEqual(r.s.settings, { mode: "blind", infiltrants: 1, hintRounds: 3, timer: 0, categories: [] });
  r.act("p0", "settings", { timer: 60, infiltrants: 2, categories: ["dieren", "dieren", "onbekend", 7] });
  assert.deepEqual(r.s.settings, { mode: "blind", infiltrants: 2, hintRounds: 3, timer: 60, categories: ["dieren"] });
  let prev = r.s;
  r.act("p0", "settings", { timer: 60 });
  assertAckOnly(prev, r.s, "p0", r.s.acks.p0);
  prev = r.s;
  r.act("p1", "settings", { mode: "woord" });
  assertAckOnly(prev, r.s, "p1", 2);
  r.act("p0", "settings", { categories: [] });
  r.start();
  prev = r.s;
  r.act("p0", "settings", { mode: "woord" });
  assertAckOnly(prev, r.s, "p0", r.s.acks.p0);
});

test("effectieve infiltrant-telling", () => {
  assert.equal(E.effectiveInfiltrants(2, 3), 1);
  assert.equal(E.effectiveInfiltrants(2, 4), 1);
  assert.equal(E.effectiveInfiltrants(2, 5), 2);
  assert.equal(E.effectiveInfiltrants(1, 9), 1);
  assert.equal(E.effectiveInfiltrants(2, 12), 2);
  const r = room(4);
  r.act("p0", "settings", { infiltrants: 2 });
  assert.equal(E.publicView(r.s).infiltrantCount, 1);
  r.join("p4");
  assert.equal(E.publicView(r.s).infiltrantCount, 2);
  r.start();
  assert.equal(r.s.infiltrantCount, 2);
  assert.equal(r.infs().length, 2);
  assert.equal(r.burgers().length, 3);
});

// ---------- Start ----------
test("start: minimaal 3 spelers, host only", () => {
  const r = room(2);
  let prev = r.s;
  r.act("p0", "start");
  assertAckOnly(prev, r.s, "p0", 1);
  r.join("p2");
  prev = r.s;
  r.act("p1", "start");
  assertAckOnly(prev, r.s, "p1", 2);
  r.start();
  const s = r.s;
  assert.equal(s.gameNo, 1);
  assert.equal(s.round, 1);
  assert.deepEqual([...s.order].sort(), ["p0", "p1", "p2"]);
  assert.equal(Object.keys(s.roles).length, 3);
  assert.equal(r.infs().length, 1);
  assert.ok(s.words.burger && s.words.infiltrant && s.words.burger !== s.words.infiltrant);
  assert.deepEqual(s.hints, []);
  assert.equal(s.lastVote, null);
  assert.equal(s.result, null);
  // geen woordenlijst → kan niet starten
  const r2 = room(3, { words: [] });
  prev = r2.s;
  r2.act("p0", "start");
  assertAckOnly(prev, r2.s, "p0", 1);
});

test("start: usedPairs vermijden en resetten, categoriefilter, a/b swap", () => {
  const words = WORDS.slice(0, 3);
  const r = room(3, { words, seed: 7 });
  const seen = [];
  for (let g = 0; g < 3; g++) {
    r.start();
    seen.push(r.s.words.pairId);
    r.act("p0", "next"); // in reveal: geen geldige next → alleen ack
    assert.equal(r.s.phase, "reveal");
    const inf = r.infs()[0];
    r.revealAll(); r.hintsAll(); r.voteOut(inf);
    r.act("p0", "next");
    assert.equal(r.s.phase, "over");
  }
  assert.equal(new Set(seen).size, 3);
  r.start();
  assert.equal(r.s.usedPairs.length, 1);

  const rc = room(3, { seed: 11, settings: { categories: ["dieren"] } });
  for (let g = 0; g < 4; g++) {
    rc.start();
    assert.equal(rc.s.words.category, "dieren");
    const inf = rc.infs()[0];
    rc.revealAll(); rc.hintsAll(); rc.voteOut(inf); rc.act("p0", "next");
  }

  // Swap: over veel seeds komen beide richtingen voor
  const burgerWords = new Set();
  for (let seed = 1; seed < 40; seed++) {
    const rr = room(3, { seed, words: [WORDS[0]] });
    rr.start();
    burgerWords.add(rr.s.words.burger);
    assert.ok(["Koffie", "Thee"].includes(rr.s.words.infiltrant));
  }
  assert.deepEqual([...burgerWords].sort(), ["Koffie", "Thee"]);
});

test("start vanuit over: toeschouwers meegenomen, vertrokken spelers opgeruimd", () => {
  const r = room(4, { seed: 5 });
  r.start();
  r.join("p4");
  assert.equal(r.p("p4").spectator, true);
  assert.equal(r.p("p4").alive, false);
  assert.equal(E.privateView(r.s, "p4"), null);
  const leaver = r.burgers().find((p) => p !== "p0");
  r.act(leaver, "leave");
  r.revealAll();
  const inf = r.infs()[0];
  r.hintsAll(); r.voteOut(inf);
  r.act("p0", "next");
  assert.equal(r.s.phase, "over");
  r.start();
  assert.equal(r.s.gameNo, 2);
  assert.equal(r.p("p4").spectator, false);
  assert.equal(r.p("p4").alive, true);
  assert.equal(r.p(leaver), undefined);
  assert.equal(r.s.order.length, 4);
  assert.ok(r.s.order.includes("p4"));
  assert.ok(E.privateView(r.s, "p4"));
});

test("next vanuit over → lobby; result weg, scores blijven", () => {
  const r = room(3, { seed: 2 });
  r.start(); r.revealAll(); r.hintsAll(); r.voteOut(r.infs()[0]); r.act("p0", "next");
  assert.equal(r.s.phase, "over");
  const scores = { ...r.s.scores };
  r.act("p0", "next");
  assert.equal(r.s.phase, "lobby");
  assert.equal(r.s.result, null);
  assert.deepEqual(r.s.scores, scores);
  assert.deepEqual(r.s.roles, {});
  assert.equal(r.s.words, null);
  assert.ok(r.s.players.every((p) => p.alive && !p.spectator));
  assert.equal(E.privateView(r.s, "p1"), null);
});

// ---------- Reveal & hints ----------
test("reveal → hints: alleen levende spelers, dubbel = alleen ack", () => {
  const r = room(4, { seed: 9 });
  r.start();
  r.join("p9");
  let prev = r.s;
  r.act("p9", "revealed");
  assertAckOnly(prev, r.s, "p9", 2);
  r.act("p1", "revealed");
  prev = r.s;
  r.act("p1", "revealed");
  assertAckOnly(prev, r.s, "p1", r.s.acks.p1);
  prev = r.s;
  r.act("p1", "hint", { text: "te vroeg" });
  assertAckOnly(prev, r.s, "p1", r.s.acks.p1);
  for (const pid of ["p0", "p2"]) r.act(pid, "revealed");
  assert.equal(r.s.phase, "reveal");
  r.act("p3", "revealed");
  assert.equal(r.s.phase, "hints");
  assert.deepEqual(r.s.turn, { pid: r.s.order[0], hintRound: 1, startedAt: r.s.updatedAt });
});

test("hints: volgorde, alleen wie aan de beurt is, tekst trim/max 32, meerdere hint-rondes", () => {
  const r = room(4, { seed: 4, settings: { hintRounds: 2 } });
  r.start(); r.revealAll();
  const order = r.s.order;
  const wrong = order[1];
  const prev = r.s;
  r.act(wrong, "hint", { text: "niet mijn beurt" });
  assertAckOnly(prev, r.s, wrong, r.s.acks[wrong]);
  const spoken = [];
  for (let i = 0; i < 8; i++) {
    const pid = r.s.turn.pid;
    spoken.push([pid, r.s.turn.hintRound]);
    r.act(pid, "hint", { text: i === 0 ? "   een hele lange hint die echt veel te lang is   " : i === 1 ? "" : "h" + i });
  }
  assert.deepEqual(spoken, [...order.map((p) => [p, 1]), ...order.map((p) => [p, 2])]);
  assert.equal(r.s.phase, "vote");
  assert.equal(r.s.turn, null);
  assert.equal(r.s.hints.length, 8);
  assert.equal(r.s.hints[0].text, "een hele lange hint die echt vee");
  assert.equal([...r.s.hints[0].text].length, 32);
  assert.equal(r.s.hints[1].text, "");
  assert.deepEqual(r.s.hints.map((h) => h.hintRound), [1, 1, 1, 1, 2, 2, 2, 2]);
  assert.ok(r.s.hints.every((h) => h.round === 1));
});

test("skip & forceVote: host only", () => {
  const r = room(4, { seed: 8 });
  r.start(); r.revealAll();
  const cur = r.s.turn.pid;
  let prev = r.s;
  const nonHost = ["p1", "p2", "p3"].find((p) => p !== cur) || "p1";
  r.act(nonHost, "skip");
  assertAckOnly(prev, r.s, nonHost, r.s.acks[nonHost]);
  r.act("p0", "skip");
  assert.deepEqual(r.s.hints[0], { pid: cur, text: "", round: 1, hintRound: 1, skipped: true });
  assert.equal(r.s.turn.pid, r.s.order[1]);
  prev = r.s;
  r.act(nonHost, "forceVote");
  assertAckOnly(prev, r.s, nonHost, r.s.acks[nonHost]);
  r.act("p0", "forceVote");
  assert.equal(r.s.phase, "vote");
  prev = r.s;
  r.act("p0", "skip");
  assertAckOnly(prev, r.s, "p0", r.s.acks.p0);
});

test("rondes: uitgeschakelde spelers overgeslagen, starter schuift door", () => {
  const r = room(6, { seed: 21 });
  r.start(); r.revealAll();
  const order = r.s.order;
  assert.equal(r.s.turn.pid, order[0]);
  r.hintsAll();
  // gooi de tweede spreker eruit (als die burger is anders een andere burger)
  const victim = r.burgers().includes(order[1]) ? order[1] : r.burgers().find((p) => p !== order[0] && p !== order[2]);
  r.voteOut(victim);
  assert.equal(r.s.phase, "elim");
  assert.equal(r.s.lastVote.eliminated, victim);
  assert.equal(r.s.lastVote.role, "burger");
  r.act("p0", "next");
  assert.equal(r.s.phase, "hints");
  assert.equal(r.s.round, 2);
  const nextStarter = order.slice(1).find((p) => p !== victim);
  assert.equal(r.s.turn.pid, nextStarter);
  const spoken = [];
  while (r.s.phase === "hints") { spoken.push(r.s.turn.pid); r.act(r.s.turn.pid, "hint", { text: "x" }); }
  assert.ok(!spoken.includes(victim));
  assert.equal(spoken.length, 5);
  const i = order.indexOf(nextStarter);
  const expected = order.slice(i).concat(order.slice(0, i)).filter((p) => p !== victim);
  assert.deepEqual(spoken, expected);
  assert.ok(r.s.hints.filter((h) => h.round === 2).length === 5);
});

// ---------- Stemmen ----------
test("stemregels: niet op jezelf, dood kan niet stemmen, stemmen zijn definitief, voted ≠ wie", () => {
  const r = room(5, { seed: 31 });
  r.start(); r.revealAll(); r.hintsAll();
  assert.equal(r.s.phase, "vote");
  let prev = r.s;
  r.act("p1", "vote", { target: "p1" });
  assertAckOnly(prev, r.s, "p1", r.s.acks.p1);
  prev = r.s;
  r.act("p1", "vote", { target: "ghost" });
  assertAckOnly(prev, r.s, "p1", r.s.acks.p1);
  r.act("p1", "vote", { target: "p2" });
  assert.deepEqual(r.s.voted, ["p1"]);
  prev = r.s;
  r.act("p1", "vote", { target: "p3" });
  assertAckOnly(prev, r.s, "p1", r.s.acks.p1);
  assert.equal(r.s.votes.p1, "p2");
  const pub = E.publicView(r.s);
  assert.deepEqual(pub.voted, ["p1"]);
  assert.equal(pub.votes, undefined);
  // spectator kan niet stemmen
  r.join("p7");
  prev = r.s;
  r.act("p7", "vote", { target: "p2" });
  assertAckOnly(prev, r.s, "p7", r.s.acks.p7);
  // rest stemt p2 eruit (p2 stemt p3)
  for (const v of ["p0", "p3", "p4"]) r.act(v, "vote", { target: "p2" });
  assert.equal(r.s.phase, "vote");
  r.act("p2", "vote", { target: "p3" });
  assert.notEqual(r.s.phase, "vote");
  assert.equal(r.p("p2").alive, false);
  if (r.s.phase === "elim" && !r.s.pendingWinner) {
    r.act("p0", "next");
    r.hintsAll();
    prev = r.s;
    r.act("p2", "vote", { target: "p1" });
    assertAckOnly(prev, r.s, "p2", r.s.acks.p2);
    prev = r.s;
    r.act("p1", "vote", { target: "p2" });
    assertAckOnly(prev, r.s, "p1", r.s.acks.p1);
  }
});

test("gelijkspel → revote met kandidaten → dubbel gelijkspel: niemand eruit", () => {
  const r = room(4, { seed: 41 });
  r.start(); r.revealAll(); r.hintsAll();
  const [a, b, c, d] = ["p0", "p1", "p2", "p3"];
  r.act(a, "vote", { target: b });
  r.act(b, "vote", { target: a });
  r.act(c, "vote", { target: a });
  r.act(d, "vote", { target: b });
  assert.equal(r.s.phase, "vote");
  assert.equal(r.s.revote, true);
  assert.deepEqual([...r.s.candidates].sort(), [a, b]);
  assert.deepEqual(r.s.voted, []);
  assert.deepEqual(r.s.votes, {});
  assert.ok(Object.values(r.s.scores).every((x) => x === 0), "geen punten bij eerste gelijkspel");
  let prev = r.s;
  r.act(c, "vote", { target: d });
  assertAckOnly(prev, r.s, c, r.s.acks[c]);
  // revote: a op b, b op a, c op a, d op b → weer gelijk
  r.act(a, "vote", { target: b });
  r.act(b, "vote", { target: a });
  r.act(c, "vote", { target: a });
  r.act(d, "vote", { target: b });
  assert.equal(r.s.phase, "elim");
  assert.equal(r.s.lastVote.eliminated, null);
  assert.equal(r.s.lastVote.tie, true);
  assert.equal(r.s.lastVote.revote, true);
  assert.equal(r.s.lastVote.role, null);
  assert.deepEqual(r.s.lastVote.tally, { [a]: 2, [b]: 2 });
  assert.equal(r.alive().length, 4);
  // +1 voor iedereen die op een infiltrant stemde, ook bij dubbel gelijkspel
  const inf = r.infs()[0];
  const votes = { [a]: b, [b]: a, [c]: a, [d]: b };
  for (const v of Object.keys(votes)) assert.equal(r.s.scores[v], votes[v] === inf ? 1 : 0);
  assert.deepEqual(r.s.lastVote.votes, votes);
  r.act("p0", "next");
  assert.equal(r.s.phase, "hints");
  assert.equal(r.s.round, 2);
});

test("gelijkspel en daarna winnaar in revote", () => {
  const r = room(4, { seed: 42 });
  r.start(); r.revealAll(); r.hintsAll();
  r.act("p0", "vote", { target: "p1" });
  r.act("p1", "vote", { target: "p0" });
  r.act("p2", "vote", { target: "p0" });
  r.act("p3", "vote", { target: "p1" });
  assert.equal(r.s.revote, true);
  r.act("p0", "vote", { target: "p1" });
  r.act("p1", "vote", { target: "p0" });
  r.act("p2", "vote", { target: "p1" });
  r.act("p3", "vote", { target: "p1" });
  assert.equal(r.s.lastVote.eliminated, "p1");
  assert.equal(r.s.lastVote.revote, true);
  assert.equal(r.s.lastVote.tie, false);
  assert.equal(r.s.revote, false);
  assert.equal(r.s.candidates, null);
});

test("closeVote: host only, minstens 1 stem", () => {
  const r = room(4, { seed: 51 });
  r.start(); r.revealAll(); r.hintsAll();
  let prev = r.s;
  r.act("p0", "closeVote");
  assertAckOnly(prev, r.s, "p0", r.s.acks.p0);
  r.act("p1", "vote", { target: "p2" });
  prev = r.s;
  r.act("p1", "closeVote");
  assertAckOnly(prev, r.s, "p1", r.s.acks.p1);
  r.act("p0", "closeVote");
  assert.ok(["elim", "guess"].includes(r.s.phase));
  assert.equal(r.s.lastVote.eliminated, "p2");
  assert.deepEqual(r.s.lastVote.tally, { p2: 1 });
  assert.equal(r.p("p2").alive, false);
});

// ---------- Winnen & scores ----------
test("woord-modus: burgers winnen, +2 per burger, +1 voor juiste stem", () => {
  const r = room(5, { seed: 61 });
  r.start(); r.revealAll(); r.hintsAll();
  const inf = r.infs()[0];
  const burgers = r.burgers();
  const wrongVoter = burgers[0];
  // 3 burgers stemmen inf, wrongVoter stemt burgers[1], inf stemt burgers[1] → inf eruit (3 vs 2)
  for (const v of r.alive()) r.act(v, "vote", { target: v === inf || v === wrongVoter ? burgers[1] : inf });
  assert.equal(r.s.phase, "elim");
  assert.equal(r.s.lastVote.eliminated, inf);
  assert.equal(r.s.lastVote.role, "infiltrant");
  assert.equal(r.s.pendingWinner, "burgers");
  r.act("p0", "next");
  assert.equal(r.s.phase, "over");
  const res = r.s.result;
  assert.equal(res.winner, "burgers");
  assert.deepEqual(res.roles, r.s.roles);
  assert.ok(res.words.burger && res.words.infiltrant);
  for (const b of burgers) assert.equal(res.delta[b], b === wrongVoter ? 2 : 3, "burger +2, +1 voor juiste stem");
  assert.equal(res.delta[inf], 0);
  for (const pid of Object.keys(res.delta)) assert.equal(r.s.scores[pid], res.delta[pid]);
  const pub = E.publicView(r.s);
  assert.deepEqual(pub.result, res);
});

test("woord-modus: infiltranten winnen bij gelijk aantal", () => {
  const r = room(4, { seed: 62 });
  r.start(); r.revealAll(); r.hintsAll();
  const inf = r.infs()[0];
  const [b1, b2] = r.burgers();
  r.voteOut(b1);
  assert.equal(r.s.lastVote.eliminated, b1);
  assert.equal(r.s.pendingWinner, null);
  r.act("p0", "next");
  r.hintsAll();
  r.voteOut(b2);
  assert.equal(r.s.phase, "elim");
  assert.equal(r.s.pendingWinner, "infiltranten");
  r.act("p0", "next");
  assert.equal(r.s.result.winner, "infiltranten");
  assert.equal(r.s.result.delta[inf], 4);
  assert.ok(r.burgers().every((b) => r.s.result.delta[b] === 0));
  assert.equal(r.s.scores[inf], 4);
});

test("twee infiltranten: allebei weg → burgers winnen", () => {
  const r = room(5, { seed: 63, settings: { infiltrants: 2 } });
  r.start();
  assert.equal(r.infs().length, 2);
  r.revealAll(); r.hintsAll();
  const [i1, i2] = r.infs();
  r.voteOut(i1);
  assert.equal(r.s.pendingWinner, null);
  r.act("p0", "next"); r.hintsAll();
  r.voteOut(i2);
  r.act("p0", "next");
  assert.equal(r.s.result.winner, "burgers");
});

function blindToGuess(seed, words) {
  const r = room(4, { seed, words: words || [WORDS[4]], settings: { mode: "blind" } });
  r.start(); r.revealAll(); r.hintsAll();
  const inf = r.infs()[0];
  r.voteOut(inf);
  assert.equal(r.s.phase, "guess");
  assert.deepEqual(r.s.guess, { pid: inf, text: null, correct: null });
  return { r, inf };
}

test("blind: juiste gok (accent/hoofdletters) → infiltranten winnen, +4 +1", () => {
  const { r, inf } = blindToGuess(71);
  const word = r.s.words.burger; // Café of Restaurant
  const other = r.alive()[0];
  let prev = r.s;
  r.act(other, "guess", { text: word });
  assertAckOnly(prev, r.s, other, r.s.acks[other]);
  const guess = word === "Café" ? "  CAFE! " : "restaurant";
  r.act(inf, "guess", { text: guess });
  assert.equal(r.s.phase, "elim");
  assert.equal(r.s.guess.correct, true);
  assert.equal(r.s.guess.text, guess.trim());
  prev = r.s;
  r.act(inf, "guess", { text: "nog eens" });
  assertAckOnly(prev, r.s, inf, r.s.acks[inf]);
  r.act("p0", "next");
  assert.equal(r.s.result.winner, "infiltranten");
  assert.equal(r.s.result.delta[inf], 5);
  assert.equal(r.s.result.words.infiltrant, null);
});

test("blind: Levenshtein ≤ 1 alleen bij woord ≥ 5 tekens; foute gok → burgers", () => {
  const long = blindToGuess(72, [{ c: "eten", a: "Pannenkoek", b: "Pannenkoek" }]);
  long.r.act(long.inf, "guess", { text: "pannekoek" });
  assert.equal(long.r.s.guess.correct, true);

  const short = blindToGuess(73, [{ c: "dieren", a: "Hond", b: "Hond" }]);
  short.r.act(short.inf, "guess", { text: "hon" });
  assert.equal(short.r.s.guess.correct, false);
  assert.equal(short.r.s.phase, "elim");
  short.r.act("p0", "next");
  assert.equal(short.r.s.result.winner, "burgers");
  assert.equal(short.r.s.result.delta[short.inf], 0);

  const far = blindToGuess(74, [{ c: "dieren", a: "Olifant", b: "Olifant" }]);
  far.r.act(far.inf, "guess", { text: "olifnat" });
  assert.equal(far.r.s.guess.correct, false);
  const empty = blindToGuess(75, [{ c: "dieren", a: "Olifant", b: "Olifant" }]);
  empty.r.act(empty.inf, "guess", { text: "   " });
  assert.equal(empty.r.s.guess.correct, false);
});

test("blind: burger eruit → geen gok-fase; foute gok met 2 infiltranten → spel gaat door", () => {
  const r = room(6, { seed: 76, settings: { mode: "blind", infiltrants: 2 } });
  r.start(); r.revealAll(); r.hintsAll();
  const [i1] = r.infs();
  r.voteOut(r.burgers()[0]);
  assert.equal(r.s.phase, "elim");
  assert.equal(r.s.guess, null);
  r.act("p0", "next"); r.hintsAll();
  r.voteOut(i1);
  assert.equal(r.s.phase, "guess");
  r.act(i1, "guess", { text: "zzzzzz" });
  assert.equal(r.s.guess.correct, false);
  assert.equal(r.s.phase, "elim");
  // 2 inf + 4 burgers → burger eruit (2 vs 3) → inf eruit (1 vs 3) → geen winnaar
  assert.equal(r.s.pendingWinner, null);
  r.act("p0", "next");
  assert.equal(r.s.phase, "hints");
  assert.equal(r.s.guess, null);
});

test("normalize & levenshtein", () => {
  assert.equal(E.normalize("  Crème Brûlée! "), "cremebrulee");
  assert.equal(E.normalize("IJs-thee"), "ijsthee");
  assert.equal(E.normalize(null), "");
  assert.equal(E.levenshtein("kitten", "sitting"), 3);
  assert.equal(E.levenshtein("", "abc"), 3);
  assert.equal(E.levenshtein("café", "cafe"), 1);
});

// ---------- Vertrekken tijdens het spel ----------
// Zoek een seed waarvoor cond(r) geldt (spellen zijn deterministisch per seed)
function findRoom(n, opts, setup, cond) {
  for (let seed = 1; seed < 500; seed++) {
    const r = room(n, Object.assign({ seed }, opts));
    setup(r);
    if (cond(r)) return r;
  }
  throw new Error("geen geschikte seed");
}

test("leave tijdens eigen beurt → beurt schuift door (burger)", () => {
  const r = findRoom(5, {}, (r) => { r.start(); r.revealAll(); r.act(r.s.turn.pid, "hint", { text: "a" }); },
    (r) => r.s.turn.pid !== "p0" && r.s.roles[r.s.turn.pid] === "burger");
  const cur = r.s.turn.pid;
  assert.equal(cur, r.s.order[1]);
  r.act(cur, "leave");
  assert.equal(r.p(cur).left, true);
  assert.equal(r.p(cur).alive, false);
  assert.equal(r.s.phase, "hints");
  assert.equal(r.s.turn.pid, r.s.order[2]);
  // rest van de ronde: vertrekker wordt overgeslagen
  const spoken = [];
  while (r.s.phase === "hints") { spoken.push(r.s.turn.pid); r.act(r.s.turn.pid, "hint", { text: "b" }); }
  assert.deepEqual(spoken, r.s.order.slice(2));
});

test("leave van de infiltrant tijdens hints → burgers winnen direct", () => {
  const r = findRoom(4, {}, (r) => { r.start(); r.revealAll(); }, (r) => r.infs()[0] !== "p0");
  const inf = r.infs()[0];
  r.act(inf, "leave");
  assert.equal(r.s.phase, "over");
  assert.equal(r.s.result.winner, "burgers");
  assert.equal(r.s.result.delta[inf], 0);
  for (const b of r.burgers()) assert.equal(r.s.result.delta[b], 2);
});

test("leave van een burger bij 3 spelers → infiltrant wint direct", () => {
  const r = findRoom(3, {}, (r) => { r.start(); r.revealAll(); }, (r) => r.infs()[0] !== "p0");
  const b = r.burgers().find((p) => p !== "p0");
  r.act(b, "leave");
  assert.equal(r.s.phase, "over");
  assert.equal(r.s.result.winner, "infiltranten");
  assert.equal(r.s.result.delta[b], 0);
  assert.equal(r.s.result.delta[r.infs()[0]], 4);
});

test("kick tijdens elim herberekent de winnaar", () => {
  const r = findRoom(4, {}, (r) => { r.start(); r.revealAll(); r.hintsAll(); r.voteOut(r.burgers().find((p) => p !== "p0")); },
    (r) => r.s.phase === "elim" && r.infs()[0] !== "p0");
  assert.equal(r.s.pendingWinner, null);
  r.act("p0", "kick", { target: r.infs()[0] });
  assert.equal(r.s.phase, "elim");
  assert.equal(r.s.pendingWinner, "burgers");
  r.act("p0", "next");
  assert.equal(r.s.result.winner, "burgers");
});

test("leave tijdens stemmen maakt stemming compleet; stemmen op vertrekker vervallen", () => {
  for (let seed = 90; seed < 120; seed++) {
    const r = room(5, { seed });
    r.start(); r.revealAll(); r.hintsAll();
    const leaver = r.burgers().find((p) => p !== "p0");
    const others = r.alive().filter((p) => p !== leaver);
    const target = others.find((p) => p !== "p0");
    // iedereen behalve leaver stemt; één stem gaat naar leaver
    const voters = others.filter((p) => p !== target);
    r.act(voters[0], "vote", { target: leaver });
    for (const v of voters.slice(1)) r.act(v, "vote", { target });
    r.act(target, "vote", { target: voters[0] });
    assert.equal(r.s.phase, "vote");
    r.act(leaver, "leave");
    if (r.s.phase === "over") continue; // winst door vertrek kan ook
    // voters[0] stemde op de vertrekker → mag opnieuw
    assert.equal(r.s.phase, "vote");
    assert.ok(!r.s.voted.includes(voters[0]));
    r.act(voters[0], "vote", { target });
    assert.notEqual(r.s.phase, "vote");
    assert.equal(r.s.lastVote.eliminated, target);
    return;
  }
  assert.fail("geen geschikte seed");
});

test("leave tijdens stemmen door laatste stemmer → resolve", () => {
  const r = room(5, { seed: 123 });
  r.start(); r.revealAll(); r.hintsAll();
  const leaver = r.burgers().find((p) => p !== "p0");
  const others = r.alive().filter((p) => p !== leaver);
  const t = others.find((p) => p !== "p0");
  for (const v of others) r.act(v, "vote", { target: v === t ? "p0" : t });
  assert.equal(r.s.phase, "vote");
  r.act(leaver, "leave");
  assert.notEqual(r.s.phase, "vote");
});

test("leave tijdens reveal; rejoin wist left (blijft uitgeschakeld)", () => {
  const r = room(5, { seed: 130 });
  r.start();
  const leaver = r.burgers().find((p) => p !== "p0");
  for (const p of r.alive().filter((x) => x !== leaver)) r.act(p, "revealed");
  assert.equal(r.s.phase, "reveal");
  r.act(leaver, "leave");
  assert.equal(r.s.phase, "hints");
  assert.ok(!r.s.order.filter((p) => p !== leaver).includes(leaver));
  r.join(leaver);
  assert.equal(r.p(leaver).left, false);
  assert.equal(r.p(leaver).alive, false);
  assert.ok(E.privateView(r.s, leaver), "terugkomer ziet zijn woord weer");
});

test("leave van de gokker → gok fout, naar elim", () => {
  let seed = 140, g;
  while ((g = blindToGuess(seed)).inf === "p0") seed++;
  const { r, inf } = g;
  r.act(inf, "leave");
  assert.equal(r.s.phase, "elim");
  assert.equal(r.s.guess.correct, false);
  r.act("p0", "next");
  assert.equal(r.s.result.winner, "burgers");
});

// ---------- Views ----------
test("publicView lekt geen woorden/rollen/keys tijdens het spel", () => {
  for (const mode of ["woord", "blind"]) {
    const r = room(5, { seed: 150, settings: { mode } });
    r.start();
    const secrets = [r.s.words.burger, r.s.words.infiltrant, ...Object.values(r.s.keys)].map((x) => JSON.stringify(x));
    const check = () => {
      const json = JSON.stringify(E.publicView(r.s));
      for (const sec of secrets) assert.ok(!json.includes(sec), `${r.s.phase}: lekt ${sec}`);
      const pub = E.publicView(r.s);
      for (const k of ["keys", "roles", "words", "votes", "usedPairs", "pendingWinner", "starter", "gameDelta"]) assert.equal(pub[k], undefined, k);
      if (r.s.phase !== "over") assert.equal(pub.result, null);
    };
    check(); r.revealAll(); check();
    r.hintsAll(); check();
    r.voteOut(r.burgers()[0]); check();
    r.act("p0", "next"); check();
    r.hintsAll();
    r.voteOut(r.infs()[0]); check();
    if (r.s.phase === "guess") { r.act(r.infs()[0], "guess", { text: "nope" }); check(); }
    r.act("p0", "next");
    assert.equal(r.s.phase, "over");
    assert.ok(JSON.stringify(E.publicView(r.s)).includes(JSON.stringify(r.s.words.burger)));
    const pub = E.publicView(r.s);
    assert.deepEqual(Object.keys(pub).sort(), ["acks", "candidates", "code", "gameNo", "guess", "hints", "hostPid", "infiltrantCount",
      "lastVote", "order", "phase", "players", "ready", "removed", "result", "revote", "round", "scores", "settings", "turn",
      "updatedAt", "v", "voted"].sort());
    for (const p of pub.players) assert.deepEqual(Object.keys(p).sort(), ["alive", "avatar", "color", "left", "name", "pid", "spectator"]);
  }
});

test("publicView is een kopie (mutatie raakt state niet)", () => {
  const r = room(3);
  const pub = E.publicView(r.s);
  pub.players[0].name = "Hacker";
  pub.settings.mode = "blind";
  assert.equal(r.s.players[0].name, "Host");
  assert.equal(r.s.settings.mode, "woord");
});

test("privateView per modus", () => {
  const w = room(4, { seed: 160 });
  assert.equal(E.privateView(w.s, "p1"), null);
  w.start();
  const inf = w.infs()[0];
  for (const pid of w.alive()) {
    const pv = E.privateView(w.s, pid);
    assert.deepEqual(Object.keys(pv), ["v", "gameNo", "word", "category", "role", "knowsRole"]);
    assert.equal(pv.v, 1);
    assert.equal(pv.gameNo, 1);
    assert.equal(pv.role, null);
    assert.equal(pv.knowsRole, false);
    assert.equal(pv.category, w.s.words.category);
    assert.equal(pv.word, pid === inf ? w.s.words.infiltrant : w.s.words.burger);
  }
  assert.equal(E.privateView(w.s, "nobody"), null);

  const b = room(4, { seed: 161, settings: { mode: "blind" } });
  b.start();
  const binf = b.infs()[0];
  for (const pid of b.alive()) {
    const pv = E.privateView(b.s, pid);
    assert.equal(pv.knowsRole, true);
    assert.equal(pv.category, b.s.words.category);
    if (pid === binf) assert.deepEqual([pv.word, pv.role], [null, "infiltrant"]);
    else assert.deepEqual([pv.word, pv.role], [b.s.words.burger, "burger"]);
  }
  // uitgeschakelde speler ziet zijn woord nog
  b.revealAll(); b.hintsAll();
  const out = b.burgers()[0];
  b.voteOut(out);
  assert.equal(E.privateView(b.s, out).word, b.s.words.burger);
});

// ---------- Betrouwbaarheid ----------
test("seq/ack: duplicaat, gat, verkeerde key → zelfde referentie", () => {
  const r = room(3);
  const prev = r.s;
  assert.equal(r.s.acks.p1, 1);
  assert.equal(E.reduce(prev, r.env("p1", "profile", { name: "X" }, { seq: 1 }), r.ctx()), prev, "duplicaat");
  assert.equal(E.reduce(prev, r.env("p1", "profile", { name: "X" }, { seq: 0 }), r.ctx()), prev, "oud");
  assert.equal(E.reduce(prev, r.env("p1", "profile", { name: "X" }, { seq: 3 }), r.ctx()), prev, "gat");
  assert.equal(E.reduce(prev, r.env("p1", "profile", { name: "X" }, { seq: 2, key: "fout" }), r.ctx()), prev, "key");
  assert.equal(E.reduce(prev, r.env("p1", "join", { name: "X" }, { seq: 2, key: "fout" }), r.ctx()), prev, "join met andere key");
  const next = E.reduce(prev, r.env("p1", "profile", { name: "X" }, { seq: 2 }), r.ctx());
  assert.notEqual(next, prev);
  assert.equal(next.acks.p1, 2);
  assert.equal(next.p1, undefined);
  assert.equal(next.players[1].name, "X");
  assert.ok(next.updatedAt > prev.updatedAt);
  // na verwerking is dezelfde seq een duplicaat
  assert.equal(E.reduce(next, r.env("p1", "profile", { name: "Y" }, { seq: 2 }), r.ctx()), next);
  // onbekende actie → alleen ack
  const unk = E.reduce(next, r.env("p1", "dans", {}, { seq: 3 }), r.ctx());
  assertAckOnly(next, unk, "p1", 3);
  assert.equal(unk.updatedAt, next.updatedAt);
  // d geen object → behandeld als {}
  const bad = E.reduce(unk, { pid: "p1", key: keyOf("p1"), seq: 4, t: "profile", d: "rommel" }, r.ctx());
  assert.equal(bad.acks.p1, 4);
});

test("zuiverheid: input onveranderd over een heel spel (diep bevroren states)", () => {
  // room() bevriest elke state diep en checkt JSON voor/na — elke mutatie zou hier gooien
  const r = room(6, { seed: 170, settings: { hintRounds: 2, mode: "blind", infiltrants: 2 } });
  const snapshot = structuredClone(r.s);
  const first = r.s;
  r.start(); r.revealAll(); r.hintsAll();
  r.voteOut(r.burgers()[0]);
  assert.deepEqual(first, snapshot);
  const ctxA = { rng: mulberry32(5), now: 1, words: WORDS };
  const ctxB = { rng: mulberry32(5), now: 1, words: WORDS };
  const s0 = deepFreeze(E.createState({ code: "ABCD", host: { pid: "h", key: "kk", name: "H" } }));
  const env = { pid: "h", key: "kk", seq: 1, t: "settings", d: { mode: "blind" } };
  assert.deepEqual(E.reduce(s0, env, ctxA), E.reduce(s0, env, ctxB), "deterministisch");
});

test("engine gebruikt geen Math.random / Date.now", () => {
  const origR = Math.random, origD = Date.now;
  Math.random = () => { throw new Error("Math.random gebruikt"); };
  Date.now = () => { throw new Error("Date.now gebruikt"); };
  try {
    const r = room(5, { seed: 180 });
    r.start(); r.revealAll(); r.hintsAll(); r.voteOut(r.infs()[0]); r.act("p0", "next");
    E.publicView(r.s); E.privateView(r.s, "p1");
  } finally { Math.random = origR; Date.now = origD; }
  const src = require("node:fs").readFileSync(require.resolve("../online/engine.js"), "utf8");
  assert.ok(!/Math\.random|Date\.now|document\.|window\./.test(src.replace(/\/\*[\s\S]*?\*\//, "")));
});

// ---------- Simulatie ----------
test("simulatie: 300 random spellen met legale en illegale acties", () => {
  const TYPES = ["join", "profile", "leave", "kick", "settings", "start", "revealed", "hint", "skip", "forceVote", "vote", "closeVote", "guess", "next", "rare"];
  const HINTS = ["rood", "groot", "lekker", "warm", "snel", "", "hmm", "zeker weten"];
  let finished = 0;
  const seen = { revote: 0, doubleTie: 0, guess: 0, correctGuess: 0, burgers: 0, infiltranten: 0, blindWins: 0, woordWins: 0, leftPlayers: 0 };
  for (let g = 0; g < 300; g++) {
    const rnd = mulberry32(1000 + g);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const n = 3 + Math.floor(rnd() * 7);
    const r = room(n, {
      seed: 5000 + g,
      settings: { mode: pick(["woord", "blind"]), infiltrants: pick([1, 2]), hintRounds: pick([1, 2, 3]), categories: rnd() < 0.2 ? ["dieren"] : [] },
    });
    r.start();
    const secrets = [r.s.words.burger, r.s.words.infiltrant, ...Object.values(r.s.keys)].map((x) => JSON.stringify(x));
    const pids = r.s.players.map((p) => p.pid);
    let steps = 0;
    while (r.s.phase !== "over" && steps < 5000) {
      steps++;
      const s = r.s;
      const prevAcks = { ...s.acks };
      const roll = rnd();
      if (roll < 0.25) {
        // Willekeurige (meestal illegale) envelope
        const pid = pick([...pids, "x" + Math.floor(rnd() * 3)]);
        const t = pick(TYPES);
        const d = { target: pick([...pids, "zz", pid]), text: pick(HINTS), name: "N", mode: pick(["woord", "blind", "x"]) };
        const seq = (s.acks[pid] || 0) + pick([1, 1, 1, 0, 2, -1]);
        const key = rnd() < 0.1 ? "fout" : keyOf(pid);
        if (t === "leave" || t === "kick") { if (rnd() < 0.7) continue; }
        if (t === "join" && pid.startsWith("x") && r.s.players.length >= 12) continue;
        const next = E.reduce(s, { pid, key, seq, t, d }, r.ctx());
        if (next !== s) {
          assert.equal(next.acks[pid], seq);
          if (next.phase === s.phase && next.phase !== "over") assert.equal(next.result, null);
        }
        r.s = next;
      } else if (roll < 0.27 && s.phase !== "over") {
        const victim = pick(pids.filter((p) => p !== "p0" && !s.removed.includes(p)));
        if (victim) r.act(victim, r.p(victim) && r.p(victim).left ? "join" : rnd() < 0.5 ? "leave" : "profile", { name: "Z" });
      } else {
        // Legale voortgang
        const alive = r.alive();
        switch (s.phase) {
          case "reveal": { const p = pick(alive.filter((x) => !s.ready.includes(x))); if (p) r.act(p, "revealed"); break; }
          case "hints":
            if (rnd() < 0.05) r.act("p0", rnd() < 0.5 ? "skip" : "forceVote");
            else r.act(s.turn.pid, "hint", { text: pick(HINTS) });
            break;
          case "vote": {
            if (rnd() < 0.05 && Object.keys(s.votes).length) { r.act("p0", "closeVote"); break; }
            const v = pick(alive.filter((x) => !s.voted.includes(x)));
            if (!v) { r.act("p0", "closeVote"); break; }
            const targets = alive.filter((t) => t !== v && (!s.candidates || s.candidates.includes(t)));
            if (targets.length) r.act(v, "vote", { target: pick(targets) });
            break;
          }
          case "guess": r.act(s.guess.pid, "guess", { text: rnd() < 0.3 ? s.words.burger : "fout" }); break;
          case "elim": r.act("p0", "next"); break;
          default: assert.fail("onverwachte fase " + s.phase);
        }
      }
      // Invarianten
      const st = r.s;
      for (const pid of Object.keys(prevAcks)) assert.ok(st.acks[pid] >= prevAcks[pid], "acks dalen nooit");
      const pub = E.publicView(st);
      if (st.phase !== "over") {
        const json = JSON.stringify(pub);
        const leakOk = st.guess && st.guess.correct; // juiste gok staat publiek in guess.text
        for (const sec of secrets) {
          if (leakOk && sec === JSON.stringify(st.words.burger)) continue;
          assert.ok(!json.includes(sec), "lek: " + sec + " in " + st.phase);
        }
        assert.equal(pub.result, null);
      }
      assert.ok(Object.values(st.scores).every((x) => Number.isInteger(x) && x >= 0), "scores ≥ 0");
      if (st.phase === "hints") assert.ok(r.alive().includes(st.turn.pid), "beurt bij levende speler");
      if (st.phase === "vote") for (const v of st.voted) assert.ok(r.alive().includes(v));
      assert.ok(st.players.filter((p) => !p.left).length <= 12);
      if (st !== s) {
        if (st.revote && !s.revote) seen.revote++;
        if (st.lastVote && st.lastVote !== s.lastVote && st.lastVote.tie && st.lastVote.revote && st.phase === "elim" && s.phase === "vote") seen.doubleTie++;
        if (st.phase === "guess" && s.phase !== "guess") seen.guess++;
        if (st.guess && st.guess.correct && !(s.guess && s.guess.correct)) seen.correctGuess++;
      }
    }
    assert.equal(r.s.phase, "over", `spel ${g} eindigt niet`);
    const res = r.s.result;
    assert.ok(["burgers", "infiltranten"].includes(res.winner));
    assert.ok(Object.values(res.delta).every((x) => x >= 0));
    for (const pid of Object.keys(res.delta)) assert.ok(r.s.scores[pid] >= res.delta[pid]);
    seen[res.winner]++;
    seen[r.s.settings.mode + "Wins"]++;
    if (r.s.players.some((p) => p.left)) seen.leftPlayers++;
    // Na afloop: volgende potje kan
    r.act("p0", "next");
    assert.equal(r.s.phase, "lobby");
    finished++;
  }
  assert.equal(finished, 300);
  // De simulatie moet de interessante paden ook echt raken
  for (const k of Object.keys(seen)) assert.ok(seen[k] > 0, "simulatie raakt " + k + " niet: " + JSON.stringify(seen));
});
