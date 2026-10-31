// node --test online/minis/__tests__/verhaal.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const DVMini = require("../core.js");
const def = require("../verhaal.js");

const PLAYERS = [{ pid: "p0", name: "Loek" }, { pid: "p1", name: "Jacques" }, { pid: "p2", name: "Sanne" }, { pid: "p3", name: "Mo" }, { pid: "p4", name: "Iris" }, { pid: "p5", name: "Daan" }];
const freeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const setup = (seed, d, n) => def.init({ seed, rng: DVMini.rng(seed), difficulty: d, players: PLAYERS.slice(0, n) });
const ctx = { rng: DVMini.rng(1), now: 1000 };

// Speelt een hele ronde met bots (deterministisch per seed). Controleert onderweg zuiverheid.
function playOut(seed, d, n, botSeed) {
  let s = setup(seed, d, n);
  const pids = PLAYERS.slice(0, n).map((p) => p.pid);
  const rng = DVMini.rng(botSeed || seed);
  let guard = 0;
  while (!def.result(s) && guard++ < 200) {
    let moved = false;
    for (const pid of pids) {
      const a = def.bot(def.view(s, pid), rng);
      if (!a) continue;
      const before = clone(s);
      freeze(s);
      const next = def.reduce(s, pid, a, ctx);
      assert.deepStrictEqual(clone(s), before, "reduce muteert de input niet");
      if (next !== s) { s = next; moved = true; }
    }
    assert.ok(moved, "bots komen nooit vast te zitten");
  }
  return s;
}

test("registreert als net-minigame met het volledige contract", () => {
  assert.strictEqual(DVMini.get("verhaal"), def);
  assert.strictEqual(def.kind, "net");
  ["init", "reduce", "view", "result", "score", "mount", "bot"].forEach((k) => assert.strictEqual(typeof def[k], "function", k));
  assert.ok(def.howto && def.title && def.icon);
});

test("init: deterministisch per seed, beurten = spelers (2–3) anders 4, ieder hooguit één keer", () => {
  for (const d of [1, 2, 3]) {
    for (let n = 1; n <= 6; n++) {
      for (let seed = 1; seed <= 25; seed++) {
        const s = setup(seed, d, n);
        assert.deepStrictEqual(s, setup(seed, d, n));
        assert.strictEqual(s.turns, n <= 3 ? n : 4);
        assert.strictEqual(new Set(s.tellers).size, s.tellers.length);
        assert.strictEqual(s.order.length, n);
        assert.strictEqual(s.deck.length, s.turns * (1 + def.CFG[d].swaps));
        s.twists.forEach((t) => assert.strictEqual(t.length, def.CFG[d].twists));
        s.openers.forEach((o) => assert.strictEqual(!!o, def.CFG[d].opener));
      }
    }
  }
  const orders = new Set(Array.from({ length: 20 }, (_, i) => setup(i + 1, 1, 3).order.join()));
  assert.ok(orders.size > 1, "volgorde wisselt per seed");
  assert.deepStrictEqual(setup(1, 1, 0).done, { ratings: {}, log: [] });
});

test("kaarten komen uit VUUR_DECKS vuurpraat als die er is, anders de reservelijst", () => {
  const prev = globalThis.VUUR_DECKS;
  try {
    delete globalThis.VUUR_DECKS;
    setup(3, 1, 3).deck.forEach((q) => assert.ok(def.FALLBACK.includes(q)));
    const data = require("../../../data-vuur.js");
    globalThis.VUUR_DECKS = data.VUUR_DECKS;
    const items = data.VUUR_DECKS.find((x) => x.id === "vuurpraat").items;
    setup(3, 2, 4).deck.forEach((q) => assert.ok(items.includes(q)));
  } finally {
    if (prev === undefined) delete globalThis.VUUR_DECKS; else globalThis.VUUR_DECKS = prev;
  }
});

test("reduce: verloop vertellen → beoordelen → volgende verteller → klaar", () => {
  let s = setup(7, 1, 3);
  const [t0, t1, t2] = s.tellers;
  const others = (t) => s.order.filter((p) => p !== t);
  s = def.reduce(s, t0, { t: "klaar" }, ctx);
  assert.strictEqual(s.stage, "rate");
  const [r1, r2] = others(t0);
  s = def.reduce(s, r1, { t: "rate", n: 3 }, ctx);
  assert.strictEqual(s.stage, "rate");
  s = def.reduce(s, r2, { t: "rate", n: 2 }, ctx);
  assert.strictEqual(s.stage, "tell");
  assert.strictEqual(s.turn, 1);
  assert.strictEqual(s.log[0].avg, 2.5);
  assert.deepStrictEqual(s.log[0].flames, [3, 2]);
  for (const t of [t1, t2]) {
    s = def.reduce(s, t, { t: "klaar" }, ctx);
    others(t).forEach((p) => { s = def.reduce(s, p, { t: "rate", n: 1 }, ctx); });
  }
  const r = def.result(s);
  assert.ok(r);
  assert.deepStrictEqual(r.ratings, { [t0]: 2.5, [t1]: 1, [t2]: 1 });
  assert.strictEqual(r.log.length, 3);
  assert.strictEqual(def.reduce(s, t0, { t: "klaar" }, ctx), s, "na afloop alles genegeerd");
});

test("reduce: ongeldige acties geven dezelfde referentie terug", () => {
  const s = freeze(setup(11, 1, 3));
  const [t, r] = [s.tellers[0], s.tellers[1]];
  const bad = [
    [r, { t: "klaar" }], // niet de verteller
    ["vreemd", { t: "klaar" }], // geen speler
    [t, { t: "rate", n: 3 }], // nog niet beoordelen
    [t, null], [t, "klaar"], [t, { t: "boe" }], [t, {}],
  ];
  bad.forEach(([pid, a]) => assert.strictEqual(def.reduce(s, pid, a, ctx), s, JSON.stringify(a)));
  const rs = freeze(def.reduce(s, t, { t: "klaar" }, ctx));
  [[t, { t: "rate", n: 3 }], [r, { t: "rate", n: 0 }], [r, { t: "rate", n: 4 }], [r, { t: "rate", n: 2.5 }], [r, { t: "rate", n: "3" }],
    [r, { t: "rate" }], [t, { t: "klaar" }], [t, { t: "swap" }], [t, { t: "next" }], [r, { t: "next" }]]
    .forEach(([pid, a]) => assert.strictEqual(def.reduce(rs, pid, a, ctx), rs, JSON.stringify(a)));
  const once = freeze(def.reduce(rs, r, { t: "rate", n: 2 }, ctx));
  assert.notStrictEqual(once, rs);
  assert.strictEqual(def.reduce(once, r, { t: "rate", n: 3 }, ctx), once, "maar één keer stemmen");
  assert.strictEqual(def.reduce(null, t, { t: "klaar" }, ctx), null);
});

test("ruilen: aantal per moeilijkheid, alleen de verteller, nieuwe kaart", () => {
  for (const d of [1, 2, 3]) {
    let s = setup(21, d, 2);
    const t = s.tellers[0], r = s.tellers[1];
    assert.strictEqual(def.reduce(s, r, { t: "swap" }, ctx), s);
    const seen = [s.deck[s.cur]];
    for (let i = 0; i < def.CFG[d].swaps; i++) {
      const n = def.reduce(s, t, { t: "swap" }, ctx);
      assert.notStrictEqual(n, s);
      s = n;
      seen.push(s.deck[s.cur]);
      assert.strictEqual(def.view(s, t).swapsLeft, def.CFG[d].swaps - i - 1);
    }
    assert.strictEqual(def.reduce(s, t, { t: "swap" }, ctx), s, "op is op");
    // volgende beurt krijgt weer verse ruilen
    s = def.reduce(s, t, { t: "klaar" }, ctx);
    s = def.reduce(s, r, { t: "rate", n: 2 }, ctx);
    assert.strictEqual(s.swaps, def.CFG[d].swaps);
    assert.ok(s.deck[s.cur]);
  }
});

test("next: verteller kan na minstens één stem verder zonder treuzelaar", () => {
  let s = setup(5, 1, 3);
  const t = s.tellers[0];
  const [a] = s.order.filter((p) => p !== t);
  s = def.reduce(s, t, { t: "klaar" }, ctx);
  assert.strictEqual(def.reduce(s, t, { t: "next" }, ctx), s, "zonder stemmen niet");
  s = def.reduce(s, a, { t: "rate", n: 3 }, ctx);
  s = def.reduce(s, t, { t: "next" }, ctx);
  assert.strictEqual(s.turn, 1);
  assert.strictEqual(s.log[0].avg, 3);
  assert.strictEqual(s.log[0].n, 1);
});

test("solo: zonder luisteraars geeft Gloei zelf twee vlammen", () => {
  let s = setup(2, 2, 1);
  s = def.reduce(s, "p0", { t: "klaar" }, ctx);
  assert.deepStrictEqual(def.result(s).ratings, { p0: 2 });
});

test("bots: spelen elk spel af, geldig resultaat, deterministisch per seed", () => {
  for (const d of [1, 2, 3]) {
    for (let n = 1; n <= 6; n++) {
      for (let seed = 1; seed <= 12; seed++) {
        const s = playOut(seed, d, n, seed * 31);
        const r = def.result(s);
        assert.ok(r, "klaar");
        assert.deepStrictEqual(r, def.result(playOut(seed, d, n, seed * 31)), "deterministisch");
        assert.strictEqual(Object.keys(r.ratings).length, n <= 3 ? n : 4);
        Object.values(r.ratings).forEach((x) => assert.ok(x >= 1 && x <= 3));
        assert.ok(Object.keys(r.ratings).every((pid) => PLAYERS.some((p) => p.pid === pid)));
      }
    }
  }
});

test("view: geheimen blijven geheim (stemmen van anderen, kaarten van straks)", () => {
  for (let seed = 1; seed <= 15; seed++) {
    let s = setup(seed, 2, 4);
    const t = s.tellers[0];
    const [a, b, c] = s.order.filter((p) => p !== t);
    const future = s.deck.filter((_, i) => i !== s.cur);
    const futureTw = s.twists.slice(1).flat();
    s.order.forEach((pid) => {
      const j = JSON.stringify(def.view(s, pid));
      future.forEach((q) => { if (q !== s.deck[s.cur]) assert.ok(!j.includes(q), "toekomstige kaart lekt"); });
      futureTw.forEach((w) => { if (!s.twists[0].includes(w)) assert.ok(!j.includes('"' + w + '"'), "toekomstig woord lekt"); });
    });
    s = def.reduce(s, t, { t: "klaar" }, ctx);
    s = def.reduce(s, a, { t: "rate", n: 3 }, ctx);
    s = def.reduce(s, b, { t: "rate", n: 1 }, ctx);
    const va = def.view(s, a), vb = def.view(s, b), vc = def.view(s, c), vt = def.view(s, t);
    assert.strictEqual(va.myVote, 3);
    assert.strictEqual(vb.myVote, 1);
    assert.strictEqual(vc.myVote, null);
    assert.strictEqual(vt.myVote, null);
    [va, vb, vc, vt].forEach((vw) => {
      assert.deepStrictEqual(vw.voted.slice().sort(), [a, b].sort());
      assert.ok(!("votes" in vw));
      assert.ok(!("deck" in vw));
      assert.strictEqual(vw.history.length, 0, "nog niets onthuld");
    });
    assert.ok(!/"myVote":1/.test(JSON.stringify(va)) && !/"myVote":3/.test(JSON.stringify(vb)));
    // na de laatste stem: onthuld als geanonimiseerde rij
    s = def.reduce(s, c, { t: "rate", n: 2 }, ctx);
    const h = def.view(s, t).history[0];
    assert.deepStrictEqual(h.flames, [3, 2, 1]);
    assert.strictEqual(h.avg, 2);
    assert.strictEqual(def.view(s, t).myVote, null);
    assert.ok(!("swapsLeft" in def.view(s, a)) || def.view(s, a).swapsLeft === 0);
  }
});

test("score: logs altijd een geheel getal in 1..3 (nooit negatief), Nederlandse regels met namen", () => {
  const rng = DVMini.rng(99);
  for (let i = 0; i < 3000; i++) {
    const n = 1 + Math.floor(rng() * 6);
    const players = PLAYERS.slice(0, n);
    const ratings = {};
    players.slice(0, Math.min(4, n)).forEach((p) => { if (rng() < 0.9) ratings[p.pid] = Math.round((1 + rng() * 2) * 100) / 100; });
    const d = 1 + Math.floor(rng() * 3);
    const sc = def.score({ ratings, log: Object.keys(ratings).map((pid) => ({ teller: pid, avg: ratings[pid], n: 1 })) }, { difficulty: d, players });
    assert.ok(Number.isInteger(sc.logs) && sc.logs >= 1 && sc.logs <= 3, "logs " + sc.logs);
    assert.ok(sc.logs >= -2 && sc.logs <= 4);
    assert.ok(Array.isArray(sc.lines) && sc.lines.length >= 1 && sc.lines.every((l) => typeof l === "string" && l.length > 3));
    assert.ok(!sc.lines.some((l) => /undefined|NaN|null/.test(l)));
    Object.keys(ratings).forEach((pid) => assert.ok(sc.lines.join(" ").includes(players.find((p) => p.pid === pid).name)));
    if (sc.mvp) assert.ok(ratings[sc.mvp] !== undefined);
    assert.ok(sc.perPlayer && typeof sc.perPlayer === "object");
  }
  // rommel en lege resultaten: toch 1 blok
  [null, undefined, {}, { ratings: null }, { ratings: { p0: "x" } }, 5, "boe"].forEach((r) => {
    const sc = def.score(r, { difficulty: 2, players: PLAYERS.slice(0, 2) });
    assert.strictEqual(sc.logs, 1);
    assert.ok(sc.lines.length);
  });
  // uitschieters worden afgekapt
  assert.ok(def.score({ ratings: { p0: 99, p1: -5 } }, { difficulty: 1, players: PLAYERS }).logs <= 3);
});

test("score: hogere moeilijkheid is milder, mvp = beste verteller, gelijkspel zonder mvp", () => {
  const players = PLAYERS.slice(0, 2);
  const at = (avg, d) => def.score({ ratings: { p0: avg, p1: avg } }, { difficulty: d, players }).logs;
  assert.strictEqual(at(3, 1), 3);
  assert.strictEqual(at(1, 1), 1);
  assert.ok(at(2.35, 3) > at(2.35, 1), "pittig rekent gunstiger");
  [1, 1.5, 2, 2.5, 3].forEach((x) => assert.ok(at(x, 3) >= at(x, 2) && at(x, 2) >= at(x, 1)));
  const sc = def.score({ ratings: { p0: 3, p1: 2 } }, { difficulty: 2, players });
  assert.strictEqual(sc.mvp, "p0");
  assert.ok(sc.lines.some((l) => l.includes("Loek vertelde het verhaal van de nacht")));
  assert.match(sc.perPlayer.p0, /3 vlammen/);
  const tie = def.score({ ratings: { p0: 2, p1: 2 } }, { difficulty: 2, players });
  assert.strictEqual(tie.mvp, null);
  assert.ok(tie.lines.some((l) => /Gelijkspel/.test(l)));
  assert.ok(def.score({ ratings: { p0: 2.5 } }, { difficulty: 1, players }).lines.some((l) => l.includes("2,5 vlammen")));
});
