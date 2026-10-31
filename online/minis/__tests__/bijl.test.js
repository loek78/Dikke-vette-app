// node --test online/minis/__tests__/bijl.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const DVMini = require("../core.js");
const def = require("../bijl.js");

const PLAYERS = [{ pid: "p0", name: "Loek" }, { pid: "p1", name: "Jacques" }, { pid: "p2", name: "Sanne" }, { pid: "p3", name: "Mo" }];

test("registreert als lokale minigame met het volledige contract", () => {
  assert.strictEqual(DVMini.get("bijl"), def);
  assert.strictEqual(def.kind, "local");
  ["mount", "score", "bot"].forEach((k) => assert.strictEqual(typeof def[k], "function"));
  assert.ok(def.howto && def.title && def.icon);
  assert.ok(def.duration >= 15 && def.duration <= 45);
});

test("naald blijft binnen 0..1 en moeilijkheid maakt hem sneller", () => {
  for (const d of [1, 2, 3]) {
    for (let t = -500; t < 8000; t += 37) {
      const p = def.needle(t, d);
      assert.ok(p >= 0 && p <= 1, "naald " + p);
    }
  }
  assert.ok(def.CFG[1].period > def.CFG[2].period && def.CFG[2].period > def.CFG[3].period);
  assert.ok(def.CFG[3].wave && !def.CFG[1].wave);
});

test("vak krimpt per treffer tot een minimum, en is smaller bij hogere moeilijkheid", () => {
  for (const d of [1, 2, 3]) {
    let prev = Infinity;
    for (let s = 0; s < 40; s++) {
      const w = def.halfWidth(s, d);
      assert.ok(w <= prev && w >= def.CFG[d].min);
      prev = w;
    }
    assert.strictEqual(def.halfWidth(100, d), def.CFG[d].min);
  }
  assert.ok(def.halfWidth(0, 1) > def.halfWidth(0, 2) && def.halfWidth(0, 2) > def.halfWidth(0, 3));
});

test("judge: midden = perfect, binnen vak = goed, erbuiten = mis", () => {
  assert.strictEqual(def.judge(0.5, 0.5, 0.1), "perfect");
  assert.strictEqual(def.judge(0.58, 0.5, 0.1), "good");
  assert.strictEqual(def.judge(0.42, 0.5, 0.1), "good");
  assert.strictEqual(def.judge(0.61, 0.5, 0.1), "miss");
  assert.strictEqual(def.judge(0, 1, 0.1), "miss");
});

test("plan: deterministisch per seed, vak binnen het bereik, knoesten alleen vanaf moeilijkheid 2", () => {
  for (const d of [1, 2, 3]) {
    assert.deepStrictEqual(def.plan(42, d), def.plan(42, d));
    const c = def.CFG[d];
    def.plan(7, d).forEach((b) => {
      assert.ok(b.c >= c.lo && b.c <= c.hi);
      assert.ok(b.c - def.halfWidth(0, d) >= 0 && b.c + def.halfWidth(0, d) <= 1, "vak past op de meter");
    });
  }
  for (let s = 1; s < 30; s++) assert.ok(def.plan(s, 1).every((b) => !b.knot));
  const knots = (d) => [1, 2, 3, 4, 5, 6].reduce((n, s) => n + def.plan(s, d).filter((b) => b.knot).length, 0);
  assert.ok(knots(3) > knots(2) && knots(2) > 0);
  assert.notDeepStrictEqual(def.plan(1, 3), def.plan(2, 3));
});

test("bot: geldig resultaat, deterministisch per seed, moeilijker = minder blokken", () => {
  const avg = {};
  for (const d of [1, 2, 3]) {
    let sum = 0;
    for (let s = 1; s < 120; s++) {
      const a = def.bot(DVMini.rng(s), d), b = def.bot(DVMini.rng(s), d);
      assert.deepStrictEqual(a, b);
      ["logs", "perfect", "misses", "combo"].forEach((k) => assert.ok(Number.isInteger(a[k]) && a[k] >= 0, k));
      assert.ok(a.logs <= 40 && a.combo <= a.logs * 2 + 1);
      const sc = def.score({ p0: a }, { difficulty: d, players: PLAYERS.slice(0, 1) });
      assert.ok(Number.isInteger(sc.logs) && sc.logs >= -2 && sc.logs <= 4);
      sum += a.logs;
    }
    avg[d] = sum / 119;
  }
  assert.ok(avg[1] > avg[2] && avg[2] > avg[3], JSON.stringify(avg));
});

test("score: logs geheel in [-1,4] (binnen [-2,4]) voor veel willekeurige resultaten, met namen in de regels", () => {
  const rnd = DVMini.rng(11);
  const seen = new Set();
  for (let i = 0; i < 4000; i++) {
    const n = 1 + Math.floor(rnd() * 4);
    const players = PLAYERS.slice(0, n);
    const results = {};
    players.forEach((p) => {
      const k = rnd();
      if (k < 0.08) results[p.pid] = null;
      else if (k < 0.12) results[p.pid] = { logs: "x", perfect: -1 }; // rommel
      else if (k < 0.14) results[p.pid] = { logs: 1e9, perfect: 1e9, misses: 0 }; // valsspeler
      else {
        const logs = Math.floor(rnd() * 26);
        results[p.pid] = { logs, perfect: Math.floor(rnd() * (logs + 1)), misses: Math.floor(rnd() * 15), combo: Math.floor(rnd() * (logs + 1)) };
      }
    });
    const d = 1 + Math.floor(rnd() * 3);
    const sc = def.score(results, { difficulty: d, players });
    assert.ok(Number.isInteger(sc.logs) && sc.logs >= -1 && sc.logs <= 4, "logs " + sc.logs);
    seen.add(sc.logs);
    assert.ok(Array.isArray(sc.lines) && sc.lines.length >= 1 && sc.lines.every((l) => typeof l === "string" && l.length > 0 && l.length <= 140));
    if (sc.mvp !== null) assert.ok(players.some((p) => p.pid === sc.mvp));
    assert.deepStrictEqual(Object.keys(sc.perPlayer).sort(), players.map((p) => p.pid).sort());
  }
  assert.deepStrictEqual([...seen].sort(), [-1, 0, 1, 2, 3, 4]);
});

test("score: meer hout = meer blokken op het vuur; mvp en namen kloppen", () => {
  const players = PLAYERS.slice(0, 2);
  const weak = def.score({ p0: { logs: 2, perfect: 0, misses: 9 }, p1: { logs: 1, perfect: 0, misses: 8 } }, { difficulty: 2, players });
  const strong = def.score({ p0: { logs: 20, perfect: 12, misses: 1, combo: 12 }, p1: { logs: 17, perfect: 8, misses: 2, combo: 6 } }, { difficulty: 2, players });
  assert.ok(strong.logs > weak.logs);
  assert.strictEqual(strong.logs, 4);
  assert.strictEqual(weak.logs, -1);
  assert.strictEqual(strong.mvp, "p0");
  assert.ok(strong.lines.some((l) => l.includes("Loek") && l.includes("20")));
  assert.ok(strong.lines.some((l) => l.includes("12 keer op rij")));
  assert.ok(strong.lines.some((l) => l.includes("Samen 37 blokken")));
  // Hetzelfde resultaat telt zwaarder op een hogere moeilijkheid.
  const r = { p0: { logs: 10, perfect: 3, misses: 3 } };
  const one = [PLAYERS[0]];
  assert.ok(def.score(r, { difficulty: 3, players: one }).logs >= def.score(r, { difficulty: 1, players: one }).logs);
});

test("score: ontbrekende speler wordt genoemd en drukt de score", () => {
  const players = PLAYERS.slice(0, 2);
  const good = { logs: 16, perfect: 6, misses: 1, combo: 9 };
  const both = def.score({ p0: good, p1: good }, { difficulty: 1, players });
  const alone = def.score({ p0: good, p1: null }, { difficulty: 1, players });
  assert.ok(alone.logs < both.logs);
  assert.ok(alone.lines.some((l) => l.includes("Jacques") && l.includes("binnen")));
  assert.strictEqual(alone.perPlayer.p1, "—");
  const none = def.score({}, { difficulty: 1, players });
  assert.ok(none.logs >= -2 && none.logs <= 4 && none.mvp === null);
  const empty = def.score(null, {});
  assert.ok(Number.isInteger(empty.logs));
});

test("eerlijk vak: nooit een kleiner tijdvenster dan winMs/perfMs, perfect-kern binnen het vak, vak past op de meter", () => {
  for (const d of [1, 2, 3]) {
    const c = def.CFG[d];
    for (let s = 0; s <= 40; s += 1) {
      for (let at = c.lo; at <= c.hi + 1e-9; at += 0.01) {
        const z = def.zone(s, d, at), v = def.speedAt(z.c, d);
        assert.ok(z.c - z.w >= -1e-9 && z.c + z.w <= 1 + 1e-9, "past");
        assert.ok(z.pk > 0 && z.pk <= z.w + 1e-12, "kern binnen vak");
        // het vak duurt minstens ±winMs voor de naald (op de plek waar hij het snelst gaat binnen het vak niet ver af)
        assert.ok(z.w / def.speedAt(at, d) >= c.winMs - 1e-6, "venster d" + d + " s" + s + " at" + at.toFixed(2));
        assert.ok(z.pk >= Math.min(z.w, v * c.perfMs) - 1e-9, "perfect-venster");
      }
    }
  }
});

test("speedAt klopt met de echte naald, earlyLate zegt eerlijk te vroeg/te laat", () => {
  for (const d of [1, 2, 3]) {
    const per = def.CFG[d].period;
    for (let t = 37; t < per; t += 53) {
      const p = def.needle(t, d), num = Math.abs(def.needle(t + 0.5, d) - def.needle(t - 0.5, d));
      if (p < 0.03 || p > 0.97) continue; // omkeerpunt
      assert.ok(Math.abs(def.speedAt(p, d) - num) < num * 0.03 + 1e-6, "d" + d + " t" + t);
    }
  }
  // d1: naald gaat in de eerste halve periode omhoog. Staat hij onder het vak: te vroeg; erboven: te laat.
  assert.strictEqual(def.earlyLate(def.CFG[1].period * 0.1, 1, 0.5), "vroeg"); // p = 0.2
  assert.strictEqual(def.earlyLate(def.CFG[1].period * 0.4, 1, 0.5), "laat"); // p = 0.8
  // terugweg: omgekeerd
  assert.strictEqual(def.earlyLate(def.CFG[1].period * 0.6, 1, 0.5), "vroeg"); // p = 0.8, dalend
  assert.ok(def.INPUT_LAG >= 0 && def.INPUT_LAG <= 60);
});

test("ijking: scherp = +4, geconcentreerd = +3, rammen levert niks op (alle moeilijkheden)", () => {
  const team = (d, sd, seed) => def.score({ p0: def.simulate(DVMini.rng(seed), d, sd), p1: def.simulate(DVMini.rng(seed + 500), d, sd) },
    { difficulty: d, players: PLAYERS.slice(0, 2) }).logs;
  const avg = (d, sd) => { let t = 0; for (let s = 1; s <= 60; s++) t += team(d, sd, s); return t / 60; };
  // wild rammen: tik zodra het mag
  const mash = (d, seed) => {
    const r = DVMini.rng(seed), blocks = def.plan(seed, d);
    let t = 0, i = 0, cr = false, logs = 0, perfect = 0, misses = 0, st = 0, z = def.zone(0, d, blocks[0].c);
    while ((t += 60 + r() * 80) < def.DURATION) {
      const res = def.judge(def.needle(t, d), z.c, z.w, z.pk);
      if (res === "miss") { misses++; st = 0; z = def.zone(0, d, z.c); t += 680; continue; }
      st++; if (res === "perfect") perfect++;
      const b = blocks[i % blocks.length];
      if (b.knot && !cr) { cr = true; z = def.zone(st, d, 1 - b.c); } else { logs++; i++; cr = false; z = def.zone(st, d, blocks[i % blocks.length].c); }
      t += 400;
    }
    return { logs, perfect, misses };
  };
  for (const d of [1, 2, 3]) {
    assert.ok(avg(d, 22) >= 3.6, "scherp d" + d + " " + avg(d, 22));
    const mid = avg(d, 35);
    assert.ok(mid >= 2.5 && mid <= 3.6, "geconcentreerd d" + d + " " + mid);
    const casual = avg(d, 55);
    assert.ok(casual >= 0.5 && casual < mid, "gezellig d" + d + " " + casual);
    let m = 0; for (let s = 1; s <= 30; s++) m += def.score({ p0: mash(d, s), p1: mash(d, s + 99) }, { difficulty: d, players: PLAYERS.slice(0, 2) }).logs;
    assert.ok(m / 30 <= -0.5, "rammen d" + d + " " + m / 30);
  }
});

test("2 tot 6 spelers: score blijft geldig, iedereen in perPlayer, regels kort", () => {
  const six = [...PLAYERS, { pid: "p4", name: "Iris" }, { pid: "p5", name: "Een heel erg lange naam die nergens op slaat" }];
  for (let n = 2; n <= 6; n++) {
    const players = six.slice(0, n), results = {};
    players.forEach((p, i) => { results[p.pid] = i === 1 ? null : def.bot(DVMini.rng(i + n * 10), 2); });
    const sc = def.score(results, { difficulty: 2, players });
    assert.ok(Number.isInteger(sc.logs) && sc.logs >= -1 && sc.logs <= 4);
    assert.strictEqual(Object.keys(sc.perPlayer).length, n);
    assert.ok(sc.lines.every((l) => l.length <= 140), JSON.stringify(sc.lines));
    assert.doesNotThrow(() => JSON.stringify(sc));
  }
});

test("module lekt niets naar de globale scope en mount raakt de DOM pas bij aanroep", () => {
  assert.strictEqual(typeof global.bijl, "undefined");
  assert.strictEqual(typeof global.def, "undefined");
  assert.strictEqual(typeof global.document, "undefined");
});
