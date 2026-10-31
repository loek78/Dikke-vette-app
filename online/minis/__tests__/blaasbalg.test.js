// node --test online/minis/__tests__/blaasbalg.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const DVMini = require("../core.js");
const def = require("../blaasbalg.js");

const PLAYERS = [{ pid: "p0", name: "Loek" }, { pid: "p1", name: "Jacques" }, { pid: "p2", name: "Sanne" }];

test("registreert als lokale minigame met het volledige contract", () => {
  assert.strictEqual(DVMini.get("blaasbalg"), def);
  assert.strictEqual(def.kind, "local");
  ["mount", "score", "bot"].forEach((k) => assert.strictEqual(typeof def[k], "function"));
  assert.ok(def.howto && def.title && def.icon);
});

test("patroon is deterministisch per seed en verschilt per moeilijkheid", () => {
  for (const d of [1, 2, 3]) {
    assert.deepStrictEqual(def.pattern(42, d), def.pattern(42, d));
    const n = def.pattern(42, d);
    for (let i = 1; i < n.length; i++) assert.ok(n[i].t > n[i - 1].t, "tijden oplopend");
    assert.ok(n[n.length - 1].big, "eindigt met een grote puf");
    const dur = n[n.length - 1].t / 1000;
    assert.ok(dur >= 14 && dur <= 30, "duur " + dur + "s");
  }
  // Moeilijkheid 1: alleen op de tel; 3: syncopen (tussen de tellen) aanwezig, sneller tempo.
  for (let s = 1; s < 40; s++) {
    assert.ok(def.pattern(s, 1).every((x) => !x.off));
    assert.ok(def.pattern(s, 3).some((x) => x.off));
  }
  assert.ok(def.CFG[1].bpm < def.CFG[2].bpm && def.CFG[2].bpm < def.CFG[3].bpm);
  assert.ok(def.CFG[1].good > def.CFG[3].good);
  assert.notDeepStrictEqual(def.pattern(1, 3), def.pattern(2, 3));
});

test("bot: geldig resultaat, deterministisch per seed", () => {
  for (const d of [1, 2, 3]) {
    for (let s = 1; s < 60; s++) {
      const a = def.bot(DVMini.rng(s), d), b = def.bot(DVMini.rng(s), d);
      assert.deepStrictEqual(a, b);
      assert.strictEqual(a.hits + a.misses, a.total);
      assert.ok(a.perfect <= a.hits && a.combo <= a.hits && a.total > 5);
      assert.ok(Number.isInteger(a.hits) && Number.isInteger(a.stray));
      const acc = def.accuracy(a);
      assert.ok(acc >= 0 && acc <= 1);
    }
  }
});

test("score: logs geheel in [-1,3] (binnen [-2,4]) voor veel willekeurige resultaten", () => {
  const rnd = DVMini.rng(7);
  for (let i = 0; i < 3000; i++) {
    const n = 1 + Math.floor(rnd() * 3);
    const players = PLAYERS.slice(0, n);
    const results = {};
    players.forEach((p) => {
      const k = rnd();
      if (k < 0.1) results[p.pid] = null;
      else if (k < 0.15) results[p.pid] = { hits: "x", total: -3 }; // rommel
      else {
        const total = 5 + Math.floor(rnd() * 40), hits = Math.floor(rnd() * (total + 1));
        results[p.pid] = { hits, perfect: Math.floor(rnd() * (hits + 1)), misses: total - hits, stray: Math.floor(rnd() * 8), total, combo: Math.floor(rnd() * (hits + 1)) };
      }
    });
    const difficulty = 1 + Math.floor(rnd() * 3);
    const s = def.score(results, { difficulty, players });
    assert.ok(Number.isInteger(s.logs) && s.logs >= -1 && s.logs <= 3, "logs " + s.logs);
    assert.ok(Array.isArray(s.lines) && s.lines.length >= 1 && s.lines.every((l) => typeof l === "string" && l.length && l.length <= 140));
    if (s.mvp !== null) assert.ok(players.some((p) => p.pid === s.mvp));
    players.forEach((p) => assert.strictEqual(typeof s.perPlayer[p.pid], "string"));
  }
});

test("score: perfect spel = +3 met namen, niks = -1, leeg/kapot = geldig", () => {
  const perfect = { hits: 30, perfect: 30, misses: 0, stray: 0, total: 30, combo: 30 };
  const zero = { hits: 0, perfect: 0, misses: 30, stray: 5, total: 30, combo: 0 };
  const top = def.score({ p0: perfect, p1: { ...perfect, perfect: 25 } }, { difficulty: 3, players: PLAYERS.slice(0, 2) });
  assert.strictEqual(top.logs, 3);
  assert.strictEqual(top.mvp, "p0");
  assert.ok(top.lines.join(" ").includes("Loek"));
  assert.strictEqual(def.score({ p0: zero, p1: zero }, { difficulty: 1, players: PLAYERS.slice(0, 2) }).logs, -1);
  const absent = def.score({ p0: perfect, p1: null }, { difficulty: 2, players: PLAYERS.slice(0, 2) });
  assert.ok(absent.logs < 3 && absent.lines.join(" ").includes("Jacques"));
  assert.strictEqual(def.score({}, { difficulty: 2, players: [] }).logs, -1);
  assert.ok(Number.isInteger(def.score(null, {}).logs));
  // meer gemiste noten → nooit meer blokken
  let prev = 9;
  for (let hits = 30; hits >= 0; hits -= 3) {
    const r = { hits, perfect: hits, misses: 30 - hits, stray: 0, total: 30, combo: hits };
    const l = def.score({ p0: r, p1: r }, { difficulty: 2, players: PLAYERS.slice(0, 2) }).logs;
    assert.ok(l <= prev); prev = l;
  }
});

test("score muteert de invoer niet", () => {
  const results = { p0: def.bot(DVMini.rng(1), 2), p1: def.bot(DVMini.rng(2), 2) };
  const copy = JSON.parse(JSON.stringify(results));
  def.score(results, { difficulty: 2, players: PLAYERS.slice(0, 2) });
  assert.deepStrictEqual(results, copy);
});
