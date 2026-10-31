// node --test online/minis/__tests__/slot.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const DVMini = require("../core.js");
const def = require("../slot.js");

const PLAYERS = [{ pid: "p0", name: "Loek" }, { pid: "p1", name: "Jacques" }, { pid: "p2", name: "Sanne" }, { pid: "p3", name: "Mo" }, { pid: "p4", name: "Iris" }, { pid: "p5", name: "Daan" }];
const freeze = (o) => { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
function setup(seed, d, n) {
  const players = PLAYERS.slice(0, n || 2);
  const roles = def.roles(players, DVMini.rng(seed));
  const shared = def.init({ seed, rng: DVMini.rng(seed), difficulty: d, players, roles });
  return { players, roles, shared };
}
const ctxAt = (now) => ({ rng: DVMini.rng(1), now });

test("registreert als net-minigame met het volledige contract", () => {
  assert.strictEqual(DVMini.get("slot"), def);
  assert.strictEqual(def.kind, "net");
  ["init", "reduce", "view", "result", "score", "mount", "roles", "bot", "_solution"].forEach((k) => assert.strictEqual(typeof def[k], "function", k));
  assert.ok(def.howto && def.title && def.icon);
});

test("roles: precies één slot, de rest gids, deterministisch per rng", () => {
  for (let n = 1; n <= 6; n++) {
    for (let s = 1; s < 20; s++) {
      const r = def.roles(PLAYERS.slice(0, n), DVMini.rng(s));
      assert.deepStrictEqual(r, def.roles(PLAYERS.slice(0, n), DVMini.rng(s)));
      const vals = Object.values(r);
      assert.strictEqual(vals.length, n);
      assert.strictEqual(vals.filter((x) => x === "slot").length, 1);
      assert.strictEqual(vals.filter((x) => x === "gids").length, n - 1);
    }
  }
});

test("init: aanwijzingen geven met brute kracht precies één oplossing = de code; deterministisch per seed", () => {
  for (const d of [1, 2, 3]) {
    const C = def.CFG[d];
    for (let seed = 1; seed <= 80; seed++) {
      const n = 2 + (seed % 5);
      const { shared } = setup(seed, d, n);
      assert.deepStrictEqual(shared, setup(seed, d, n).shared, "deterministisch");
      const sols = def.solve(shared.clues.map((c) => c.spec), shared.rep);
      assert.strictEqual(sols.length, 1, "d" + d + " seed " + seed);
      assert.deepStrictEqual(sols[0], shared.code);
      assert.ok(shared.clues.length >= C.min && shared.clues.length >= shared.gids.length, "genoeg aanwijzingen");
      assert.ok(shared.clues.length <= Math.max(C.max, shared.gids.length));
      if (!C.rep) assert.strictEqual(new Set(shared.code).size, 4);
      assert.ok(shared.clues.every((c) => C.types.includes(c.spec.t)), "alleen toegestane soorten");
      assert.ok(shared.clues.every((c) => typeof c.text === "string" && c.text.length > 10 && !/undefined|\?/.test(c.text)), "leesbare tekst");
      // verdeeld: elke aanwijzing bij precies één gids, iedere gids minstens één
      const all = Object.values(shared.hold).flat().sort((a, b) => a - b);
      assert.deepStrictEqual(all, shared.clues.map((c) => c.id));
      shared.gids.forEach((g) => assert.ok(shared.hold[g].length >= 1));
      assert.notDeepStrictEqual(shared.rings, shared.code);
    }
  }
  assert.notDeepStrictEqual(setup(1, 2).shared.code, setup(2, 2).shared.code);
});

test("moeilijkheid 1–3 is duidelijk anders", () => {
  const C = def.CFG;
  assert.ok(C[1].limit > C[2].limit && C[2].limit > C[3].limit);
  assert.deepStrictEqual([C[1].fb, C[2].fb, C[3].fb], ["ring", "count", "none"]);
  assert.ok(!C[1].rep && !C[2].rep && C[3].rep);
  assert.ok(!C[3].types.includes("is"));
  const avg = (d) => { let s = 0; for (let i = 1; i <= 40; i++) s += setup(i, d).shared.clues.length; return s / 40; };
  assert.ok(avg(1) < avg(2) && avg(2) < avg(3));
  for (let s = 1; s < 30; s++) assert.ok(new Set(setup(s, 3).shared.code).size < 4, "vorstslot heeft een dubbel teken");
});

test("reduce is puur: invoer niet gemuteerd; ongeldige acties geven dezelfde referentie", () => {
  const { shared } = setup(5, 2, 3);
  freeze(shared);
  const slot = shared.slot, gids = shared.gids[0];
  // vóór de start mag het slot niet draaien of proberen
  assert.strictEqual(def.reduce(shared, slot, { t: "rot", ring: 0, dir: 1 }, ctxAt(1000)), shared);
  assert.strictEqual(def.reduce(shared, slot, { t: "try" }, ctxAt(1000)), shared);
  const s1 = def.reduce(shared, slot, { t: "go" }, ctxAt(1000));
  assert.notStrictEqual(s1, shared);
  assert.strictEqual(s1.t0, 1000);
  assert.strictEqual(def.reduce(s1, slot, { t: "go" }, ctxAt(2000)), s1, "dubbele go");
  freeze(s1);
  const bad = [null, undefined, 5, "x", {}, { t: "nope" }, { t: "rot" }, { t: "rot", ring: 4, dir: 1 }, { t: "rot", ring: -1, dir: 1 },
    { t: "rot", ring: 0, dir: 0 }, { t: "rot", ring: 0, dir: 9 }, { t: "rot", ring: 1.5, dir: 1 }, { t: "rot", ring: "0", dir: 1 },
    { t: "try", code: [1, 2, 3] }, { t: "try", code: [1, 2, 3, 6] }, { t: "try", code: "abcd" }, { t: "timeout" }];
  bad.forEach((a) => assert.strictEqual(def.reduce(s1, slot, a, ctxAt(3000)), s1, JSON.stringify(a)));
  // gidsen en vreemden kunnen niet draaien of proberen
  assert.strictEqual(def.reduce(s1, gids, { t: "rot", ring: 0, dir: 1 }, ctxAt(3000)), s1);
  assert.strictEqual(def.reduce(s1, gids, { t: "try", code: def._solution(s1) }, ctxAt(3000)), s1);
  assert.strictEqual(def.reduce(s1, "pX", { t: "go" }, ctxAt(3000)), s1);
  const s2 = def.reduce(s1, slot, { t: "rot", ring: 2, dir: -1 }, ctxAt(3000));
  assert.strictEqual(s2.rings[2], (s1.rings[2] + 5) % 6);
  assert.notStrictEqual(s2.rings, s1.rings);
  // gids start: t0 blijft van het slot
  const s3 = def.reduce(s2, gids, { t: "go" }, ctxAt(4000));
  assert.strictEqual(s3.t0, 1000);
  assert.ok(s3.started.includes(gids));
});

test("try: fout kost een poging met feedback per moeilijkheid; dezelfde code opnieuw is genegeerd; goed = klaar", () => {
  for (const d of [1, 2, 3]) {
    const { shared } = setup(11 + d, d);
    let s = def.reduce(shared, shared.slot, { t: "go" }, ctxAt(0));
    const sol = def._solution(s);
    const wrong = sol.map((x, i) => (i === 0 ? (x + 1) % 6 : x));
    if (!def.CFG[d].rep && new Set(wrong).size < 4) wrong[0] = [0, 1, 2, 3, 4, 5].find((x) => !sol.includes(x));
    s = freeze(def.reduce(s, s.slot, { t: "try", code: wrong }, ctxAt(5000)));
    assert.strictEqual(s.tries.length, 1);
    assert.strictEqual(def.result(s), null);
    const fb = s.tries[0].fb;
    if (d === 1) assert.deepStrictEqual(fb, [false, true, true, true]);
    if (d === 2) assert.strictEqual(fb, 3);
    if (d === 3) assert.strictEqual(fb, null);
    assert.strictEqual(def.reduce(s, s.slot, { t: "try", code: wrong }, ctxAt(6000)), s, "zelfde code nog eens");
    s = def.reduce(s, s.slot, { t: "try", code: sol }, ctxAt(65000));
    const r = def.result(s);
    assert.ok(r && r.solved);
    assert.strictEqual(r.tries, 2);
    assert.strictEqual(r.ms, 65000);
    assert.strictEqual(r.slot, s.slot);
    assert.strictEqual(def.reduce(s, s.slot, { t: "rot", ring: 0, dir: 1 }, ctxAt(70000)), s, "na afloop alles genegeerd");
  }
});

test("drie keer fout = klaar (niet opgelost); time-out alleen na de limiet", () => {
  const { shared } = setup(21, 1);
  let s = def.reduce(shared, shared.slot, { t: "go" }, ctxAt(0));
  const sol = def._solution(s);
  const others = def.solve([], false).filter((c) => c.join() !== sol.join()).slice(0, 3);
  others.forEach((c, i) => { assert.strictEqual(def.result(s), null); s = def.reduce(s, s.slot, { t: "try", code: c }, ctxAt(1000 * (i + 1))); });
  assert.deepStrictEqual(Object.assign({}, def.result(s), { clues: undefined }), { solved: false, tries: 3, ms: 3000, slot: s.slot, clues: undefined });

  let t = def.reduce(shared, shared.slot, { t: "go" }, ctxAt(0));
  const gids = t.gids[0];
  assert.strictEqual(def.reduce(t, gids, { t: "timeout" }, ctxAt(60000)), t, "te vroeg");
  t = def.reduce(t, gids, { t: "timeout" }, ctxAt(def.CFG[1].limit * 1000));
  const r = def.result(t);
  assert.ok(r && !r.solved && r.timeout && r.tries === 0 && r.ms === def.CFG[1].limit * 1000);
});

test("view: geheimen blijven geheim tot het einde", () => {
  for (const n of [2, 3, 6]) {
    const { shared } = setup(31 + n, 2, n);
    const s = def.reduce(shared, shared.slot, { t: "go" }, ctxAt(0));
    const codeStr = JSON.stringify(s.code);
    const sv = def.view(s, s.slot), svJ = JSON.stringify(sv);
    assert.strictEqual(sv.role, "slot");
    assert.ok(!("clues" in sv) && !("solution" in sv) && !("code" in sv));
    s.clues.forEach((c) => assert.ok(!svJ.includes(c.text), "slot ziet geen aanwijzingen"));
    s.gids.forEach((g) => {
      const gv = def.view(s, g), gJ = JSON.stringify(gv);
      assert.strictEqual(gv.role, "gids");
      assert.ok(!("rings" in gv) && !("solution" in gv) && !("code" in gv) && !("hold" in gv));
      assert.ok(!gJ.includes('"code":' + codeStr));
      assert.deepStrictEqual(gv.clues.map((c) => c.id), s.hold[g]);
      s.clues.filter((c) => !s.hold[g].includes(c.id)).forEach((c) => assert.ok(!gJ.includes(JSON.stringify(c.text)), "geen aanwijzingen van een andere gids"));
      assert.strictEqual(gv.holders.reduce((a, x) => a + x.n, 0), s.clues.length);
    });
    const kv = def.view(s, "vreemde");
    assert.strictEqual(kv.role, "kijker");
    assert.ok(!("clues" in kv) && !("rings" in kv) && !("solution" in kv));
    // views zijn kopieën: muteren raakt de gedeelde toestand niet
    sv.rings[0] = 99;
    assert.notStrictEqual(s.rings[0], 99);
    // na afloop krijgt iedereen de code te zien
    const done = def.reduce(s, s.slot, { t: "try", code: def._solution(s) }, ctxAt(1));
    assert.deepStrictEqual(def.view(done, s.gids[0]).solution, s.code);
  }
});

test("score: logs geheel getal in [-2,4] (en −1..4) voor veel willekeurige resultaten, met namen", () => {
  const r = DVMini.rng(99);
  for (let i = 0; i < 3000; i++) {
    const d = 1 + Math.floor(r() * 3);
    const solved = r() < 0.6;
    const res = { solved, tries: solved ? 1 + Math.floor(r() * 3) : Math.floor(r() * 4), ms: Math.floor(r() * 200000), slot: "p" + Math.floor(r() * 2), clues: {} };
    res.clues[res.slot === "p0" ? "p1" : "p0"] = 1 + Math.floor(r() * 6);
    if (!solved && r() < 0.3) res.timeout = true;
    const sc = def.score(res, { difficulty: d, players: PLAYERS.slice(0, 2) });
    assert.ok(Number.isInteger(sc.logs) && sc.logs >= -1 && sc.logs <= 4, JSON.stringify([res, sc.logs]));
    assert.strictEqual(sc.logs, DVMini.clampLogs(sc.logs));
    assert.ok(Array.isArray(sc.lines) && sc.lines.length >= 2 && sc.lines.every((l) => typeof l === "string" && l.length && !/undefined/.test(l)));
    assert.ok(sc.lines.join(" ").includes(res.slot === "p0" ? "Loek" : "Jacques"));
    assert.ok(solved ? sc.logs >= 1 && sc.mvp === res.slot : sc.logs === -1 && sc.mvp === null);
    assert.ok(sc.perPlayer.p0 && sc.perPlayer.p1);
  }
  // rare invoer → nooit een crash, altijd −1
  [null, undefined, {}, { solved: "ja" }, { solved: true, tries: 0, ms: 1 }, { solved: true, tries: 7, ms: 1 }, { solved: false, tries: 1, ms: -5 }]
    .forEach((x) => { const sc = def.score(x, { difficulty: 2, players: PLAYERS }); assert.strictEqual(sc.logs, -1); assert.ok(sc.lines.length); });
  // sneller en in minder pogingen = meer blokken
  const L = (tries, ms, d) => def.score({ solved: true, tries, ms, slot: "p0", clues: { p1: 4 } }, { difficulty: d, players: PLAYERS }).logs;
  assert.ok(L(1, 20000, 2) > L(1, 100000, 2));
  assert.ok(L(1, 100000, 2) > L(2, 100000, 2) && L(2, 100000, 2) > L(3, 100000, 2));
  assert.strictEqual(L(1, 10000, 3), 4);
});

test("bot: geldige acties, deterministisch per seed, en een volledig potje met _solution eindigt", () => {
  for (const d of [1, 2, 3]) {
    for (let seed = 1; seed < 25; seed++) {
      const play = () => {
        let { shared: s } = setup(seed, d, 3);
        const rng = DVMini.rng(seed * 7);
        const log = [];
        for (let step = 0; step < 20 && !def.result(s); step++) {
          [s.slot].concat(s.gids).forEach((pid) => {
            const a = def.bot(def.view(s, pid), rng);
            if (pid !== s.slot) assert.strictEqual(a, null, "gidsen doen niks");
            if (!a) return;
            log.push(a);
            const next = def.reduce(s, pid, a, ctxAt(1000 * step));
            assert.notStrictEqual(next, s, "bot-actie is geldig: " + JSON.stringify(a));
            s = next;
          });
        }
        return { log, res: def.result(s) };
      };
      const a = play(), b = play();
      assert.deepStrictEqual(a, b);
      assert.ok(a.res, "bot maakt het potje af");
      assert.ok(a.res.tries >= 1 && a.res.tries <= 3);
    }
  }
  // spelen met de testhaak: meteen goed
  const { shared } = setup(3, 3, 2);
  let s = def.reduce(shared, shared.slot, { t: "go" }, ctxAt(0));
  s = def.reduce(s, s.slot, { t: "try", code: def._solution(s) }, ctxAt(9000));
  assert.deepStrictEqual([def.result(s).solved, def.result(s).tries], [true, 1]);
  assert.strictEqual(def.score(def.result(s), { difficulty: 3, players: PLAYERS }).logs, 4);
});

test("aanwijzingen: elke soort heeft nette tekst", () => {
  const specs = [{ t: "is", i: 0, r: 2 }, { t: "not", i: 1, r: 0 }, { t: "grp", i: 2, g: "bos" }, { t: "ngrp", i: 3, g: "lucht" }, { t: "absent", r: 2 },
    { t: "left", a: 3, b: 5 }, { t: "next", a: 0, b: 1 }, { t: "apart", a: 0, b: 1 }, { t: "even", r: 4 }, { t: "odd", r: 1 }, { t: "fam", i: 0, j: 3 },
    { t: "nfam", i: 1, j: 2 }, { t: "cnt", g: "vuur", n: 0 }, { t: "cnt", g: "bos", n: 2 }, { t: "dup", i: 0, j: 2 }, { t: "ndup", i: 1, j: 3 }, { t: "once", r: 3 }, { t: "twice", r: 5 }];
  specs.forEach((s) => {
    const txt = def.textOf(def.partsOf(s));
    assert.ok(/^[A-Z]/.test(txt) && txt.endsWith(".") && !/undefined|\?/.test(txt), txt);
  });
  assert.strictEqual(def.textOf(def.partsOf({ t: "is", i: 1, r: 2 })), "Op ring 2 staat het ijs.");
  assert.strictEqual(def.textOf(def.partsOf({ t: "apart", a: 0, b: 1 })), "De vlam en de maan staan nooit naast elkaar.");
});
