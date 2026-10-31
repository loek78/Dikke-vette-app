// node --test online/minis/__tests__/snel.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const DVMini = require("../core.js");
const def = require("../snel.js");

const PLAYERS = [{ pid: "p0", name: "Loek" }, { pid: "p1", name: "Jacques" }, { pid: "p2", name: "Sanne" }, { pid: "p3", name: "Mo" }];
const info = (d, n) => ({ difficulty: d, players: PLAYERS.slice(0, n) });
const checkScore = (sc) => {
  assert.ok(Number.isInteger(sc.logs) && sc.logs >= -2 && sc.logs <= 4, "logs " + sc.logs);
  assert.ok(Array.isArray(sc.lines) && sc.lines.length >= 1);
  sc.lines.forEach((l) => assert.ok(typeof l === "string" && l.length > 0 && l.length <= 140, "regel: " + l));
};

test("registreert als lokale minigame met het volledige contract", () => {
  assert.strictEqual(DVMini.get("snel"), def);
  assert.strictEqual(def.kind, "local");
  ["mount", "score", "bot"].forEach((k) => assert.strictEqual(typeof def[k], "function"));
  assert.ok(def.howto && def.title && def.icon);
  assert.ok(def.duration >= 15 && def.duration <= 45);
});

test("moeilijkheid: Vorst sneller (350/300/260) en meer schijnbewegingen", () => {
  assert.deepStrictEqual([1, 2, 3].map((d) => def.CFG[d].vorst), [350, 300, 260]);
  const fakes = (d) => Array.from({ length: 40 }, (_, s) => def.plan(s + 1, d)).flat().reduce((n, r) => n + r.fakes.length, 0);
  assert.strictEqual(fakes(1), 0);
  assert.ok(fakes(3) > fakes(2) && fakes(2) > 0);
});

test("plan: 3 rondes, deterministisch per seed, knal na 2–6 s, schijnbewegingen vóór de knal", () => {
  for (const d of [1, 2, 3]) {
    for (let s = 0; s < 60; s++) {
      const p = def.plan(s, d);
      assert.deepStrictEqual(p, def.plan(s, d));
      assert.strictEqual(p.length, 3);
      p.forEach((r) => {
        assert.ok(r.delay >= 2000 && r.delay <= 6000, "delay " + r.delay);
        r.fakes.forEach((f) => { assert.ok(f.t >= 500 && f.t <= r.delay - 500, "fake " + f.t + " / " + r.delay); assert.ok(def.CFG[d].kinds.includes(f.kind)); });
      });
    }
  }
  assert.notDeepStrictEqual(def.plan(1, 2), def.plan(2, 2));
});

test("score(): altijd een geheel getal in [-2, 4] voor willekeurige resultaten", () => {
  const r = DVMini.rng(99);
  const junk = [undefined, null, 5, "x", {}, { times: "nee" }, { times: [-5, NaN, 1e9] }, { times: [200] }];
  for (let i = 0; i < 1500; i++) {
    const n = 1 + Math.floor(r() * 4), d = 1 + Math.floor(r() * 3), res = {};
    PLAYERS.slice(0, n).forEach((p) => {
      const k = r();
      if (k < 0.12) return; // afwezig
      if (k < 0.2) { res[p.pid] = junk[Math.floor(r() * junk.length)]; return; }
      res[p.pid] = { times: [0, 1, 2].map(() => (r() < 0.2 ? null : Math.round(80 + r() * 900))) };
    });
    const sc = def.score(res, info(d, n));
    checkScore(sc);
    if (sc.mvp) assert.ok(PLAYERS.slice(0, n).some((p) => p.pid === sc.mvp));
    Object.keys(sc.perPlayer).forEach((pid) => assert.ok(PLAYERS.slice(0, n).some((p) => p.pid === pid)));
  }
  checkScore(def.score(null, null));
  checkScore(def.score({}, info(2, 2)));
});

test("score(): rondes gewonnen → blokken, met namen in de regels", () => {
  const two = info(2, 2); // Vorst = 300 ms, met 2 spelers is 1 snellere tik per ronde genoeg
  const s4 = def.score({ p0: { times: [210, 230, 250] }, p1: { times: [240, 260, 280] } }, two);
  assert.strictEqual(s4.logs, 4);
  assert.strictEqual(s4.mvp, "p0");
  assert.ok(s4.lines.some((l) => l.includes("Loek is sneller dan de Vorst")));
  assert.strictEqual(def.score({ p0: { times: [210, 230, 250] }, p1: { times: [340, 360, null] } }, two).logs, 3);
  assert.strictEqual(def.score({ p0: { times: [210, 330, null] }, p1: { times: [340, 290, 400] } }, two).logs, 2);
  assert.strictEqual(def.score({ p0: { times: [210, 330, null] }, p1: { times: [340, 310, 400] } }, two).logs, 1);
  const lose = def.score({ p0: { times: [310, 330, null] }, p1: { times: [340, 310, 400] } }, two);
  assert.strictEqual(lose.logs, -1);
  assert.strictEqual(lose.mvp, "p0");
  assert.ok(lose.lines.some((l) => l.includes("Loek was het snelst")));
  assert.strictEqual(def.score({ p0: { times: [null, null, null] }, p1: { times: [null, null, null] } }, two).logs, -2);
  const absent = def.score({ p0: { times: [250, 260, 270] } }, two);
  assert.strictEqual(absent.perPlayer.p1, "—");
  assert.ok(absent.lines.some((l) => l.startsWith("Jacques")));
  assert.notStrictEqual(absent.logs, 4, "afwezige speler verhindert een sweep");
  // moeilijkheid telt: 280 ms wint van de Vorst op 1 (350) maar niet op 3 (260)
  const same = { p0: { times: [280, 280, 280] }, p1: { times: [290, 290, 290] } };
  assert.strictEqual(def.score(same, info(1, 2)).logs, 4);
  assert.strictEqual(def.score(same, info(3, 2)).logs, -1);
  // 3 spelers: 2 van de 3 moeten sneller zijn
  const three = info(2, 3);
  assert.strictEqual(def.score({ p0: { times: [200, 200, 200] }, p1: { times: [400, 400, 400] }, p2: { times: [400, 400, 400] } }, three).logs, -1);
  assert.strictEqual(def.score({ p0: { times: [200, 200, 200] }, p1: { times: [290, 290, 400] }, p2: { times: [400, 400, 400] } }, three).logs, 2);
});

test("valid(): ruis wordt null, tijden worden gehele ms", () => {
  assert.strictEqual(def.valid(null), null);
  assert.strictEqual(def.valid({}), null);
  assert.deepStrictEqual(def.valid({ times: [250.6, -1, "300", 99999] }), { times: [251, null, null] });
  assert.deepStrictEqual(def.valid({ times: [] }), { times: [null, null, null] });
});

test("bot: geldig resultaat, deterministisch per seed, meer missers bij hogere moeilijkheid", () => {
  const nulls = {};
  for (const d of [1, 2, 3]) {
    let n = 0;
    for (let s = 1; s < 400; s++) {
      const a = def.bot(DVMini.rng(s), d), b = def.bot(DVMini.rng(s), d);
      assert.deepStrictEqual(a, b);
      assert.ok(Array.isArray(a.times) && a.times.length === 3);
      a.times.forEach((t) => assert.ok(t === null || (Number.isInteger(t) && t >= 150 && t <= 1200), "t " + t));
      assert.deepStrictEqual(def.valid(a), a);
      checkScore(def.score({ p0: a, p1: def.bot(DVMini.rng(s + 1000), d) }, info(d, 2)));
      n += a.times.filter((t) => t === null).length;
    }
    nulls[d] = n;
  }
  assert.ok(nulls[1] < nulls[2] && nulls[2] < nulls[3], JSON.stringify(nulls));
  assert.notDeepStrictEqual(def.bot(DVMini.rng(1), 2), def.bot(DVMini.rng(2), 2));
});

test("bots tegen de Vorst: moeilijkheid 1 makkelijker dan 3", () => {
  const avg = (d) => {
    let sum = 0;
    for (let s = 1; s < 300; s++) sum += def.score({ p0: def.bot(DVMini.rng(s), d), p1: def.bot(DVMini.rng(s + 7777), d) }, info(d, 2)).logs;
    return sum / 299;
  };
  const a1 = avg(1), a3 = avg(3);
  assert.ok(a1 > a3 + 1, a1 + " vs " + a3);
});

test("modules lekken geen globals", () => {
  assert.strictEqual(typeof globalThis.DVMini, "undefined");
  assert.strictEqual(typeof globalThis.def, "undefined");
});
