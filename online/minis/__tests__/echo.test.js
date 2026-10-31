// node --test online/minis/__tests__/echo.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const DVMini = require("../core.js");
const def = require("../echo.js");

const PLAYERS = [{ pid: "p0", name: "Loek" }, { pid: "p1", name: "Jacques" }, { pid: "p2", name: "Sanne" }, { pid: "p3", name: "Mo" }, { pid: "p4", name: "Iris" }, { pid: "p5", name: "Daan" }];
const freeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
const setup = (seed, d, n, extra) => {
  const players = PLAYERS.slice(0, n || 2);
  return { players, shared: def.init(Object.assign({ seed, rng: DVMini.rng(seed), difficulty: d, players }, extra || {})) };
};
const ctx = { rng: DVMini.rng(1), now: 1000 };
const act = (s, pid, a) => def.reduce(s, pid, a, ctx);
const words = (s, map) => Object.keys(map).reduce((x, pid) => act(x, pid, { t: "word", w: map[pid] }), s);

// Speel een heel potje met bots; geeft { result, shared, steps }.
function botGame(seed, d, n, extra) {
  let { shared, players } = setup(seed, d, n, extra);
  const rngs = {};
  players.forEach((p, i) => { rngs[p.pid] = DVMini.rng(seed * 31 + i); });
  let steps = 0;
  while (!def.result(shared) && steps < 500) {
    let moved = false;
    for (const p of players) {
      const a = def.bot(def.view(shared, p.pid), rngs[p.pid]);
      if (!a) continue;
      const next = act(shared, p.pid, a);
      assert.notStrictEqual(next, shared, "bot-actie moet geldig zijn: " + JSON.stringify(a));
      shared = next; moved = true; steps++;
      if (def.result(shared)) break;
    }
    if (!moved) break;
  }
  return { result: def.result(shared), shared, steps, players };
}

test("registreert als net-minigame met het volledige contract", () => {
  assert.strictEqual(DVMini.get("echo"), def);
  assert.strictEqual(def.kind, "net");
  ["init", "reduce", "view", "result", "score", "mount", "bot", "normalize"].forEach((k) => assert.strictEqual(typeof def[k], "function", k));
  assert.ok(def.howto && def.title && def.icon);
});

test("normalize + same: hoofdletters, accenten, leestekens, meervoud en verkleinwoord", () => {
  assert.strictEqual(def.normalize("  Crème Brûlée! "), "cremebrulee");
  assert.strictEqual(def.normalize("auto's"), "autos");
  const yes = [["Kaarsen", "kaars"], ["bomen", "boom"], ["balletje", "bal"], ["huisjes", "huis"], ["wolven", "wolf"], ["vuren", "vuur"],
    ["kinderen", "kind"], ["auto's", "auto"], ["stoeltje", "stoel"], ["boompje", "boom"], ["vuurtje", "vuur"], ["VUUR", "vuur."], ["Sint-Maarten", "sint maarten"]];
  yes.forEach(([a, b]) => { assert.ok(def.same(a, b, false), a + " ~ " + b); assert.ok(def.same(b, a, false), b + " ~ " + a); });
  const no = [["kaars", "kaart"], ["man", "maan"], ["bbq", "barbecue"], ["vuur", "hout"], ["", "vuur"], ["!!", "?"]];
  no.forEach(([a, b]) => assert.ok(!def.same(a, b, false), a + " ≁ " + b));
  // tikfout-tolerantie alleen bij fuzzy (makkelijk) en alleen voor lange woorden
  assert.ok(!def.same("barbecue", "barbeque", false));
  assert.ok(def.same("barbecue", "barbeque", true));
  assert.ok(!def.same("kaars", "kaart", true));
});

test("init: deterministisch per seed, prompt uit de lijst, rondes per moeilijkheid", () => {
  for (let seed = 1; seed < 40; seed++) {
    const a = setup(seed, 2).shared, b = setup(seed, 2).shared;
    assert.deepStrictEqual(a, b);
    assert.ok(def.FALLBACK.includes(a.prompt));
    assert.deepStrictEqual(a.pids, ["p0", "p1"]);
    assert.deepStrictEqual(a.rounds, []);
  }
  const prompts = new Set(Array.from({ length: 40 }, (_, i) => setup(i + 1, 1).shared.prompt));
  assert.ok(prompts.size > 8, "verschillende prompts");
  assert.ok(def.FALLBACK.length >= 20);
  // window.SYNC_PROMPTS gaat voor
  globalThis.SYNC_PROMPTS = ["Alleen deze"];
  try { assert.strictEqual(setup(5, 2).shared.prompt, "Alleen deze"); } finally { delete globalThis.SYNC_PROMPTS; }
  // expliciet aantal rondes (arcade: 0 = onbeperkt)
  assert.strictEqual(setup(1, 2, 2, { rounds: 0 }).shared.max, 0);
  assert.strictEqual(setup(1, 2, 2, { rounds: 3 }).shared.max, 3);
});

test("moeilijkheid 1–3 is duidelijk anders", () => {
  const s = [1, 2, 3].map((d) => setup(1, d).shared);
  assert.ok(s[0].max > s[1].max && s[1].max > s[2].max);
  assert.strictEqual(s[1].max, 5, "verhaal-standaard: 5 rondes");
  assert.deepStrictEqual(s.map((x) => x.fuzzy), [true, false, false]);
  assert.deepStrictEqual(s.map((x) => !!x.limit), [false, false, true]);
  assert.deepStrictEqual(s.map((x) => x.fog), [false, false, true]);
});

test("reduce is puur: invoer niet gemuteerd; ongeldige acties geven dezelfde referentie", () => {
  const { shared } = setup(7, 2, 3);
  freeze(shared);
  const bad = [null, undefined, 5, "x", {}, { t: "nope" }, { t: "word" }, { t: "word", w: 12 }, { t: "word", w: "   " }, { t: "word", w: "!!!" },
    { t: "word", w: "x".repeat(25) }, { t: "unword" }, { t: "telt" }, { t: "quit" }];
  bad.forEach((a) => assert.strictEqual(def.reduce(shared, "p0", a, ctx), shared, JSON.stringify(a)));
  assert.strictEqual(act(shared, "vreemde", { t: "word", w: "vuur" }), shared, "geen speler");
  const s1 = act(shared, "p0", { t: "word", w: "  Vuur  " });
  assert.notStrictEqual(s1, shared);
  assert.deepStrictEqual(shared.cur, {}, "origineel ongewijzigd");
  assert.strictEqual(s1.cur.p0, "Vuur");
  freeze(s1);
  assert.strictEqual(act(s1, "p0", { t: "word", w: "hout" }), s1, "twee keer inleveren mag niet");
  const s2 = act(s1, "p0", { t: "unword" });
  assert.deepStrictEqual(s2.cur, {});
  assert.strictEqual(s1.cur.p0, "Vuur");
  // 24 tekens mag nog
  assert.notStrictEqual(act(shared, "p1", { t: "word", w: "x".repeat(24) }), shared);
});

test("onthulling, match, volgende ronde en eigen woorden niet herhalen", () => {
  let { shared } = setup(3, 2, 2);
  shared = words(shared, { p0: "kaars", p1: "haard" });
  assert.strictEqual(shared.rounds.length, 1);
  assert.strictEqual(shared.rounds[0].match, false);
  assert.deepStrictEqual(shared.cur, {});
  assert.strictEqual(def.result(shared), null);
  freeze(shared);
  assert.strictEqual(act(shared, "p0", { t: "word", w: "Kaarsen" }), shared, "eigen eerdere woord (meervoud) telt niet als nieuw");
  assert.notStrictEqual(act(shared, "p0", { t: "word", w: "haard" }), shared, "het woord van de ander mag wel");
  const s = words(shared, { p0: "Vuurtje", p1: "vuur" });
  const r = def.result(s);
  assert.ok(r && r.success === true && r.rounds === 2 && r.telt === false);
  assert.strictEqual(r.word, "Vuurtje");
  assert.deepStrictEqual(r.trail, [{ p0: "kaars", p1: "haard" }, { p0: "Vuurtje", p1: "vuur" }]);
  freeze(s);
  assert.strictEqual(act(s, "p0", { t: "word", w: "x" }), s, "na afloop gebeurt er niks meer");
  // eerste ronde raak
  const one = def.result(words(setup(3, 2, 2).shared, { p0: "VUUR!", p1: "vuur" }));
  assert.deepStrictEqual([one.success, one.rounds], [true, 1]);
});

test("3+ spelers: alleen succes als iedereen gelijk is; groepjes worden gemarkeerd", () => {
  let { shared } = setup(4, 2, 3);
  shared = words(shared, { p0: "vuur", p1: "Vuren", p2: "hout" });
  assert.strictEqual(shared.rounds[0].match, false);
  assert.deepStrictEqual(shared.rounds[0].groups, [["p0", "p1"]]);
  shared = words(shared, { p0: "haard", p1: "haard", p2: "haardje" });
  assert.strictEqual(def.result(shared).success, true);
});

test("Telt!: alleen na een onthulling zonder match, iedereen moet tikken; aan/uit", () => {
  let { shared } = setup(5, 2, 2);
  assert.strictEqual(act(shared, "p0", { t: "telt" }), shared, "nog niks onthuld");
  shared = words(shared, { p0: "bbq", p1: "barbecue" });
  shared = act(shared, "p0", { t: "telt" });
  assert.deepStrictEqual(shared.telt, ["p0"]);
  assert.strictEqual(def.result(shared), null);
  freeze(shared);
  assert.strictEqual(act(shared, "p0", { t: "telt" }), shared, "dubbel tikken = zelfde");
  const off = act(shared, "p0", { t: "telt", on: false });
  assert.deepStrictEqual(off.telt, []);
  const done = act(shared, "p1", { t: "telt", on: true });
  const r = def.result(done);
  assert.ok(r.success && r.telt && r.rounds === 1);
  // een nieuwe onthulling wist de stemmen
  let s2 = act(words(setup(5, 2, 2).shared, { p0: "a1", p1: "b1" }), "p0", { t: "telt" });
  s2 = words(s2, { p0: "a2", p1: "b2" });
  assert.deepStrictEqual(s2.telt, []);
});

test("max rondes → laatste kans op Telt!, anders mislukt; opgeven met z'n allen", () => {
  let { shared } = setup(6, 3, 2); // dikke mist: 4 rondes
  for (let i = 0; i < 4; i++) shared = words(shared, { p0: "a" + i + "x", p1: "b" + i + "y" });
  assert.strictEqual(shared.final, true);
  assert.strictEqual(def.result(shared), null);
  freeze(shared);
  assert.strictEqual(act(shared, "p0", { t: "word", w: "nogeen" }), shared, "geen vijfde ronde");
  const fail = act(act(shared, "p0", { t: "telt" }), "p1", { t: "quit" });
  assert.deepStrictEqual([def.result(fail).success, def.result(fail).rounds], [false, 4]);
  const saved = act(act(shared, "p0", { t: "telt" }), "p1", { t: "telt" });
  assert.ok(def.result(saved).success && def.result(saved).telt);
  // opgeven (onbeperkt): pas als iedereen opgeeft
  let a = words(setup(6, 2, 2, { rounds: 0 }).shared, { p0: "x", p1: "y" });
  a = act(a, "p0", { t: "quit" });
  assert.strictEqual(def.result(a), null);
  a = act(a, "p1", { t: "quit" });
  assert.deepStrictEqual([def.result(a).success, def.result(a).gaveUp], [false, true]);
  // onbeperkt: geen laatste ronde
  let u = setup(6, 2, 2, { rounds: 0 }).shared;
  for (let i = 0; i < 12; i++) u = words(u, { p0: "a" + i, p1: "b" + i });
  assert.strictEqual(u.final, false);
});

test("view: geheimen van anderen blijven geheim tot de onthulling", () => {
  let { shared } = setup(8, 2, 3);
  shared = act(shared, "p1", { t: "word", w: "Geheimwoordje" });
  shared = act(shared, "p2", { t: "word", w: "Stiekemerd" });
  const v0 = def.view(shared, "p0"), v1 = def.view(shared, "p1");
  const j0 = JSON.stringify(v0);
  assert.ok(!/geheim/i.test(j0) && !/stiekem/i.test(j0), "p0 ziet de woorden van p1/p2 niet");
  assert.deepStrictEqual(v0.submitted, ["p1", "p2"]);
  assert.strictEqual(v0.mine, null);
  assert.strictEqual(v1.mine, "Geheimwoordje");
  assert.ok(!/stiekem/i.test(JSON.stringify(v1)));
  assert.ok(!/geheim/i.test(JSON.stringify(def.view(shared, "kijker"))));
  // na de onthulling ziet iedereen alles
  shared = act(shared, "p0", { t: "word", w: "vuur" });
  assert.ok(/Geheimwoordje/.test(JSON.stringify(def.view(shared, "p0"))));
  // view is een kopie
  const v = def.view(shared, "p0");
  v.rounds[0].words.p0 = "x"; v.pids.push("zz");
  assert.strictEqual(shared.rounds[0].words.p0, "vuur");
  assert.strictEqual(shared.pids.length, 3);
});

test("dikke mist: oude rondes alleen met je eigen woord in de view", () => {
  let { shared } = setup(9, 3, 2);
  shared = words(shared, { p0: "eersteA", p1: "eersteB" });
  shared = words(shared, { p0: "tweedeA", p1: "tweedeB" });
  const v = def.view(shared, "p0");
  assert.strictEqual(v.rounds[0].fogged, true);
  assert.deepStrictEqual(v.rounds[0].words, { p0: "eersteA" });
  assert.deepStrictEqual(v.rounds[1].words, { p0: "tweedeA", p1: "tweedeB" });
  assert.deepStrictEqual(v.used, ["eersteA", "tweedeA"]);
  assert.ok(!/eersteB/.test(JSON.stringify(v)));
});

test("score: logs geheel getal in [-2, 4], formule max(1, 5−N) / −1, Nederlandse regels met namen", () => {
  const rng = DVMini.rng(99);
  for (let i = 0; i < 600; i++) {
    const n = 2 + Math.floor(rng() * 5), players = PLAYERS.slice(0, n), N = 1 + Math.floor(rng() * 9);
    const success = rng() < 0.6;
    const trail = Array.from({ length: N }, (_, k) => Object.fromEntries(players.map((p) => [p.pid, "w" + k + p.pid])));
    const res = { success, rounds: N, telt: rng() < 0.3, gaveUp: !success && rng() < 0.3, word: success ? "vuur" : null, trail, pids: players.map((p) => p.pid) };
    const sc = def.score(res, { difficulty: 1 + (i % 3), players });
    assert.ok(Number.isInteger(sc.logs) && sc.logs >= -2 && sc.logs <= 4, "logs " + sc.logs);
    assert.strictEqual(sc.logs, success ? Math.max(1, 5 - N) : -1);
    assert.ok(Array.isArray(sc.lines) && sc.lines.length >= 2 && sc.lines.every((l) => typeof l === "string" && l.length > 5));
    assert.ok(Object.keys(sc.perPlayer).every((p) => players.some((x) => x.pid === p)));
  }
  // rommel → geen crash, geldig bereik
  [null, undefined, {}, { success: "ja" }, { success: true, rounds: 0 }, { success: true, rounds: -1 }, { success: false, rounds: "x" }].forEach((r) => {
    const sc = def.score(r, { difficulty: 2, players: PLAYERS.slice(0, 2) });
    assert.ok(Number.isInteger(sc.logs) && sc.logs >= -2 && sc.logs <= 4);
    assert.ok(sc.lines.length >= 1);
  });
  // namen + mvp: wie het woord een ronde eerder al zei
  const sc = def.score({ success: true, rounds: 2, word: "vuur", trail: [{ p0: "vuur", p1: "kaars" }, { p0: "hout", p1: "vuur" }], pids: ["p0", "p1"] }, { difficulty: 2, players: PLAYERS.slice(0, 2) });
  assert.strictEqual(sc.logs, 3);
  assert.ok(sc.lines.some((l) => /Loek en Jacques/.test(l) && /«vuur»/.test(l)));
  assert.strictEqual(sc.mvp, "p0");
  assert.strictEqual(sc.perPlayer.p1, "kaars → vuur");
  assert.strictEqual(def.score({ success: true, rounds: 1, word: "x", trail: [{ p0: "x", p1: "x" }], pids: ["p0", "p1"] }, { players: PLAYERS }).logs, 4);
});

test("bots: geldige acties, deterministisch per seed, komen op één lijn", () => {
  for (const d of [1, 2, 3]) {
    for (let seed = 1; seed <= 30; seed++) {
      const n = 2 + (seed % 5);
      const a = botGame(seed, d, n), b = botGame(seed, d, n);
      assert.ok(a.result, "bot-potje eindigt (d" + d + " seed " + seed + ")");
      assert.deepStrictEqual(a.result, b.result, "deterministisch");
      assert.ok(a.result.success, "bots convergeren");
      assert.ok(a.result.rounds <= 2);
      const sc = def.score(a.result, { difficulty: d, players: a.players });
      assert.ok(sc.logs >= 1 && sc.logs <= 4);
    }
  }
  assert.strictEqual(def.bot(null, DVMini.rng(1)), null);
  // in de laatste-kans-fase stemmen bots (telt of opgeven), daarna niets meer
  let { shared } = setup(2, 3, 2);
  for (let i = 0; i < 4; i++) shared = words(shared, { p0: "q" + i, p1: "z" + i });
  const a0 = def.bot(def.view(shared, "p0"), DVMini.rng(3));
  assert.ok(a0 && (a0.t === "telt" || a0.t === "quit"));
  const after = act(shared, "p0", a0);
  assert.strictEqual(def.bot(def.view(after, "p0"), DVMini.rng(3)), null);
});

test("bots herhalen hun eigen woorden niet", () => {
  // forceer een situatie waarin het verbindingswoord al gebruikt is: bot kiest een ander, geldig woord
  let { shared } = setup(11, 2, 2, { rounds: 0 });
  for (let i = 0; i < 25; i++) {
    const v0 = def.view(shared, "p0");
    const a = def.bot(v0, DVMini.rng(i));
    assert.ok(a && a.t === "word");
    const next = act(shared, "p0", a);
    assert.notStrictEqual(next, shared, "ronde " + i + ": " + a.w);
    shared = act(next, "p1", { t: "word", w: "anders" + i });
    if (def.result(shared)) break;
  }
});
