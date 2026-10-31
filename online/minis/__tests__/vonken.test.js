// node --test online/minis/__tests__/vonken.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const DVMini = require("../core.js");
const def = require("../vonken.js");

const PLAYERS = [{ pid: "p0", name: "Loek" }, { pid: "p1", name: "Jacques" }, { pid: "p2", name: "Sanne" }, { pid: "p3", name: "Mo" }];

test("registreert als lokale minigame met het volledige contract", () => {
  assert.strictEqual(DVMini.get("vonken"), def);
  assert.strictEqual(def.kind, "local");
  ["mount", "score", "bot"].forEach((k) => assert.strictEqual(typeof def[k], "function"));
  assert.ok(def.howto && def.title && def.icon);
  assert.ok(def.duration >= 15 && def.duration <= 45);
  assert.strictEqual(def.DURATION, def.duration * 1000);
});

test("plan: deterministisch per seed, alles binnen het kleed en geland vóór het einde", () => {
  for (const d of [1, 2, 3]) {
    assert.deepStrictEqual(def.plan(42, d), def.plan(42, d));
    assert.notDeepStrictEqual(def.plan(1, d), def.plan(2, d));
    for (let seed = 1; seed < 40; seed++) {
      const p = def.plan(seed, d);
      assert.strictEqual(p.length, def.CFG[d].n);
      p.forEach((s, i) => {
        assert.strictEqual(s.id, i);
        if (i) assert.ok(s.t >= p[i - 1].t, "gesorteerd op tijd");
        assert.ok(s.t >= 500 && s.dur > 600, "start " + s.t + " duur " + s.dur);
        assert.ok(s.t + s.dur <= def.DURATION, "landt op tijd: " + (s.t + s.dur));
        assert.ok(s.lu >= 0.1 && s.lu <= 0.9 && s.lv >= 0.1 && s.lv <= 0.92);
        assert.ok(Math.abs(s.du) <= 0.5 && s.ah > 0);
      });
      // de regen gebruikt de hele speeltijd
      assert.ok(Math.max(...p.map((s) => s.t + s.dur)) > def.DURATION * 0.8);
    }
  }
});

test("moeilijkheid 1–3 is duidelijk anders: meer vonken, sneller, meer sintels en zijwind", () => {
  const C = def.CFG;
  assert.ok(C[1].n < C[2].n && C[2].n < C[3].n);
  assert.ok(C[1].fly[0] > C[2].fly[0] && C[2].fly[1] > C[3].fly[1]);
  assert.ok(C[1].sway === 0 && C[3].sway > C[2].sway);
  [1, 2, 3].forEach((d) => assert.ok(C[d].radius >= 22, "tikdoel ≥ 44 px breed"));
  const stat = (d) => {
    let dur = 0, n = 0, big = 0;
    for (let s = 1; s < 60; s++) def.plan(s, d).forEach((x) => { dur += x.dur; n++; big += x.big ? 1 : 0; });
    return { dur: dur / n, big: big / n };
  };
  const a = stat(1), b = stat(2), c = stat(3);
  assert.ok(a.dur > b.dur && b.dur > c.dur, JSON.stringify([a, b, c]));
  assert.ok(a.big < c.big);
});

test("bez: begint bij p0, eindigt bij p1 en gaat via de boog omhoog", () => {
  const p0 = { x: 0, y: 100 }, c = { x: 50, y: -100 }, p1 = { x: 100, y: 300 };
  assert.deepStrictEqual(def.bez(p0, c, p1, 0), p0);
  assert.deepStrictEqual(def.bez(p0, c, p1, 1), p1);
  assert.ok(def.bez(p0, c, p1, 0.25).y < p0.y);
});

test("bot: geldig resultaat, deterministisch per seed, moeilijker = lager vangpercentage", () => {
  const avg = {};
  for (const d of [1, 2, 3]) {
    let sum = 0;
    for (let s = 1; s < 150; s++) {
      const a = def.bot(DVMini.rng(s), d), b = def.bot(DVMini.rng(s), d);
      assert.deepStrictEqual(a, b);
      ["caught", "missed", "big", "combo"].forEach((k) => assert.ok(Number.isInteger(a[k]) && a[k] >= 0, k));
      assert.ok(a.big <= a.caught && a.big % 2 === 0 && a.combo <= a.caught);
      assert.ok(a.caught + a.missed >= def.CFG[d].n, "elke vonk telt (sintels dubbel)");
      assert.ok(def.valid(a), "bot-resultaat is geldig");
      const sc = def.score({ p0: a }, { difficulty: d, players: PLAYERS.slice(0, 1) });
      assert.ok(Number.isInteger(sc.logs) && sc.logs >= -2 && sc.logs <= 3);
      sum += a.caught / (a.caught + a.missed);
    }
    avg[d] = sum / 149;
  }
  assert.ok(avg[1] > avg[2] && avg[2] > avg[3], JSON.stringify(avg));
  assert.ok(avg[1] > 0.6 && avg[3] > 0.35, "bot is geloofwaardig, geen kneus");
});

test("score: logs geheel in [-2,3] voor veel willekeurige resultaten, met namen in de regels", () => {
  const rnd = DVMini.rng(11);
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const n = 1 + Math.floor(rnd() * 4);
    const players = PLAYERS.slice(0, n);
    const results = {};
    players.forEach((p) => {
      const k = rnd();
      if (k < 0.08) results[p.pid] = null;
      else if (k < 0.11) results[p.pid] = { caught: "x", missed: -1 }; // rommel
      else if (k < 0.13) results[p.pid] = { caught: 1e9, missed: 0, big: 1e9, combo: 1e9 }; // valsspeler
      else if (k < 0.14) results[p.pid] = { caught: 0, missed: 0 }; // niks gespeeld
      else {
        const tot = 20 + Math.floor(rnd() * 50), caught = Math.floor(rnd() * (tot + 1));
        results[p.pid] = { caught, missed: tot - caught, big: 2 * Math.floor(rnd() * 5), combo: Math.floor(rnd() * (caught + 1)) };
      }
    });
    const d = 1 + Math.floor(rnd() * 3);
    const sc = def.score(results, { difficulty: d, players });
    assert.ok(Number.isInteger(sc.logs) && sc.logs >= -2 && sc.logs <= 3, "logs " + sc.logs);
    seen.add(sc.logs);
    assert.ok(Array.isArray(sc.lines) && sc.lines.length >= 1 && sc.lines.every((l) => typeof l === "string" && l.length > 0 && l.length <= 140), JSON.stringify(sc.lines));
    if (sc.mvp !== null) assert.ok(players.some((p) => p.pid === sc.mvp));
    assert.deepStrictEqual(Object.keys(sc.perPlayer).sort(), players.map((p) => p.pid).sort());
  }
  assert.deepStrictEqual([...seen].sort((a, b) => a - b), [-2, -1, 0, 1, 2, 3]);
});

test("score: meer gevangen = meer blokken; mvp, namen en totalen kloppen", () => {
  const players = PLAYERS.slice(0, 2);
  const weak = def.score({ p0: { caught: 4, missed: 24 }, p1: { caught: 6, missed: 22 } }, { difficulty: 2, players });
  const strong = def.score({ p0: { caught: 40, missed: 1, big: 6, combo: 30 }, p1: { caught: 37, missed: 4, big: 2, combo: 9 } }, { difficulty: 2, players });
  assert.ok(strong.logs > weak.logs);
  assert.strictEqual(strong.logs, 3);
  assert.strictEqual(weak.logs, -2);
  assert.strictEqual(strong.mvp, "p0");
  assert.ok(strong.lines.some((l) => l.includes("Loek") && l.includes("40")));
  assert.ok(strong.lines.some((l) => l.includes("3 dikke sintels")));
  assert.ok(strong.lines.some((l) => l.includes("30 op rij")));
  assert.ok(strong.lines.some((l) => l.includes("Samen 77 vonken") && l.includes("5 op het kleed")));
  assert.strictEqual(strong.perPlayer.p1, "37 gevangen · 4 op het kleed");
  // Hetzelfde percentage telt zwaarder op een hogere moeilijkheid.
  const r = { p0: { caught: 18, missed: 7 } }, one = [PLAYERS[0]];
  assert.ok(def.score(r, { difficulty: 3, players: one }).logs > def.score(r, { difficulty: 1, players: one }).logs);
});

test("score: ontbrekende speler wordt genoemd en drukt de score", () => {
  const players = PLAYERS.slice(0, 2);
  const good = { caught: 38, missed: 2, combo: 20 };
  const both = def.score({ p0: good, p1: good }, { difficulty: 1, players });
  const alone = def.score({ p0: good, p1: null }, { difficulty: 1, players });
  assert.ok(alone.logs < both.logs);
  assert.ok(alone.lines.some((l) => l.includes("Jacques") && l.includes("andere kant")));
  assert.strictEqual(alone.perPlayer.p1, "—");
  const none = def.score({}, { difficulty: 1, players });
  assert.ok(none.logs >= -2 && none.logs <= 3 && none.mvp === null);
  const empty = def.score(null, {});
  assert.ok(Number.isInteger(empty.logs));
});

test("score: 6 spelers (deels afwezig) blijft binnen de grenzen en noemt iedereen", () => {
  const six = ["Loek", "Jacques", "Sanne", "Mo", "Iris", "Daan"].map((name, i) => ({ pid: "p" + i, name }));
  for (const d of [1, 2, 3]) {
    const results = {};
    six.forEach((p, i) => { results[p.pid] = i % 3 === 2 ? null : def.bot(DVMini.rng(100 + i), d); });
    const sc = def.score(results, { difficulty: d, players: six });
    assert.ok(Number.isInteger(sc.logs) && sc.logs >= -2 && sc.logs <= 3);
    assert.ok(sc.lines.every((l) => l.length <= 140));
    assert.ok(sc.lines.some((l) => l.includes("Sanne") && l.includes("andere kant")));
    assert.ok(sc.lines.some((l) => l.includes("Daan") && l.includes("andere kant")));
    assert.deepStrictEqual(Object.keys(sc.perPlayer).sort(), six.map((p) => p.pid).sort());
    assert.ok(six.some((p) => p.pid === sc.mvp));
  }
});

test("teksten kloppen: reeks-regel beweert niet dat er niets landde, niveaunamen botsen niet met de hoofdstuktitel", () => {
  const players = PLAYERS.slice(0, 2);
  const sc = def.score({ p0: { caught: 40, missed: 20, combo: 25 }, p1: { caught: 30, missed: 30 } }, { difficulty: 3, players });
  const line = sc.lines.find((l) => l.includes("25 op rij"));
  assert.ok(line && !/geen vonk/i.test(line), line);
  assert.ok(sc.lines.some((l) => l.includes("Samen 70 vonken gevangen, 50 op het kleed")));
  const names = [1, 2, 3].map((d) => def.CFG[d].name);
  assert.strictEqual(new Set(names).size, 3);
  assert.ok(!names.includes("Vonkenregen"), "kicker toont al 'Vonkenregen · <niveau>'");
});

test("module lekt niets naar de globale scope en mount raakt de DOM pas bij aanroep", () => {
  assert.strictEqual(typeof global.vonken, "undefined");
  assert.strictEqual(typeof global.def, "undefined");
  assert.strictEqual(typeof global.QUIPS, "undefined");
  assert.strictEqual(typeof global.document, "undefined");
});
