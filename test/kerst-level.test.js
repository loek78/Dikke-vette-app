// Tests voor de KERSTDROOM-levelgenerator (kerst/level.js). Draai met: node --test test/kerst-level.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../kerst/level.js");

const DIFFS = ["makkelijk", "normaal", "stoer"];
const SEEDS = 500;
const UNTIL = 30000; // ≈ 100 s spelen

// Compacte vingerafdruk van een gegenereerd level (voor determinisme-vergelijking)
function fingerprint(level, untilX) {
  level.ensure(untilX);
  return JSON.stringify({
    chunks: level.chunks.map((c) => [c.id, Math.round(c.x0 * 1000), Math.round(c.colW * 1000)]),
    obst: level.obstacles.map((o) => [o.type, Math.round(o.x * 1000), Math.round(o.w * 1000), o.n]),
    items: level.items.map((i) => [i.kind, Math.round(i.x * 1000), i.y, !!i.optional]),
    grounds: level.grounds.map((g) => [g.kind, Math.round(g.x0 * 1000), Math.round(g.x1 * 1000)]),
    decos: level.decos.map((d) => [d.name, Math.round(d.x * 1000), Math.round(d.scale * 1000), d.back, d.flip]),
  });
}

test("exports en constanten", () => {
  assert.equal(L.TILE, 64);
  assert.equal(L.METER, 32);
  assert.equal(L.V_BASE, 240);
  assert.equal(L.JUMP.height, 170);
  assert.equal(L.JUMP.airTime, 0.8);
  assert.ok(Math.abs(L.JUMP.range - L.JUMP.airTime * L.V_BASE) < 1e-9, "range = luchttijd × basissnelheid");
  assert.ok(Math.abs(L.JUMP.v0 * L.JUMP.v0 / (2 * L.JUMP.g) - L.JUMP.height) < 1e-6, "v0²/2g = hoogte");
  assert.equal(L.MAX_GAP_TILES, Math.floor((L.JUMP.range * 0.85) / L.TILE));
  assert.equal(L.MAX_GAP_TILES, 2);
  for (const d of DIFFS) assert.ok(L.DIFFS[d] && L.DIFFS[d].v0 < L.DIFFS[d].vmax, d);
  assert.ok(L.DIFFS.makkelijk.v0 < L.DIFFS.normaal.v0 && L.DIFFS.normaal.v0 < L.DIFFS.stoer.v0);
  for (const t of ["log", "icicles", "snowman", "pinecone"]) assert.ok(L.OBST[t].w > 0 && L.OBST[t].h > 0 && ["jump", "slide"].includes(L.OBST[t].needs), t);
  assert.equal(L.OBST.icicles.needs, "slide");
  assert.equal(L.OBST.snowman.alt, "slide");
  assert.equal(typeof L.generate, "function");
});

test("mulberry32 en hashSeed zijn deterministisch", () => {
  const a = L.mulberry32(123), b = L.mulberry32(123), c = L.mulberry32(124);
  const sa = Array.from({ length: 50 }, () => a()), sb = Array.from({ length: 50 }, () => b()), sc = Array.from({ length: 50 }, () => c());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
  assert.equal(L.hashSeed("BAKO"), L.hashSeed("BAKO"));
  assert.notEqual(L.hashSeed("BAKO"), L.hashSeed("BAKU"));
  assert.equal(L.hashSeed(42), 42);
  assert.equal(L.hashSeed(42.9), 42);
  assert.equal(typeof L.hashSeed(undefined), "number");
  assert.equal(L.hashSeed("7"), L.hashSeed("7"));
});

test("snelheidscurve: start op v0, monotoon, eindigt op vmax", () => {
  for (const d of DIFFS) {
    const D = L.DIFFS[d];
    assert.equal(L.speedAt(0, d), D.v0);
    assert.equal(L.speedAt(-50, d), D.v0);
    assert.equal(L.speedAt(D.ramp, d), D.vmax);
    assert.equal(L.speedAt(D.ramp * 3, d), D.vmax);
    let prev = 0;
    for (let x = 0; x <= D.ramp; x += D.ramp / 50) { const v = L.speedAt(x, d); assert.ok(v >= prev); prev = v; }
  }
  assert.equal(L.speedAt(1000, "onbekend"), L.speedAt(1000, "normaal"));
});

test("≥24 handgemaakte chunks, allemaal geldig", () => {
  assert.ok(L.CHUNKS.length >= 24, `chunks: ${L.CHUNKS.length}`);
  assert.deepEqual(L.validateAll(), []);
  for (const c of L.CHUNKS) {
    assert.deepEqual(L.validateChunk(c), [], c[0]);
    const p = L.parseChunk(c);
    assert.ok(p.n >= 8 && p.n <= 16);
    assert.equal(p.cols.length, p.n);
    assert.ok(["snow", "pond"].includes(p.kind));
  }
  const ids = new Set(L.CHUNKS.map((c) => c[0]));
  assert.equal(ids.size, L.CHUNKS.length, "unieke ids");
  for (const d of [1, 2, 3]) assert.ok(L.CHUNKS.filter((c) => c[1] === d).length >= 5, `diff ${d}`);
  assert.ok(L.CHUNKS.some((c) => c[4] === "pond"), "minstens één vijver");
});

test("validateChunk vangt onmogelijke patronen", () => {
  const bad = (t, i, kind) => L.validateChunk(["x", 2, t, i || " ".repeat(t.length), kind]);
  assert.ok(bad("..___.......").some((e) => /gat van 3/.test(e)), "gat te breed");
  assert.ok(bad("..LL........").some((e) => /dubbel/.test(e)), "dubbele stam");
  assert.ok(bad("..SS........").some((e) => /dubbel/.test(e)), "dubbele sneeuwpop");
  assert.ok(bad("..III.......").some((e) => /ijspegelrij van 3/.test(e)), "ijspegelrij te lang");
  assert.ok(bad("..__.I......").some((e) => /vrije kolommen/.test(e)), "glijden direct na gat");
  assert.ok(bad("..__..I.....").some((e) => /vrije kolommen/.test(e)), "glijden 2 kolommen na gat");
  assert.deepEqual(bad("..__...I...."), [], "glijden 3 kolommen na gat mag");
  assert.ok(bad("..L..L......").some((e) => /vrije kolommen/.test(e)), "stammen te dicht");
  assert.deepEqual(bad("..L...L....."), [], "stammen 3 kolommen uit elkaar mag");
  assert.ok(bad("..L.I.......").some((e) => /vrije kolommen/.test(e)), "stam → ijspegel te dicht");
  assert.deepEqual(bad("..L..I......"), [], "stam → ijspegel 2 kolommen mag");
  assert.ok(bad("..I.L.......").some((e) => /vrije kolommen/.test(e)), "ijspegel → stam te dicht");
  assert.ok(bad("L...........").some((e) => /vrije kolom beginnen/.test(e)), "begin niet vrij");
  assert.ok(bad("...........L").some((e) => /2 vrije kolommen eindigen/.test(e)), "einde niet vrij");
  assert.ok(bad("..........L.").some((e) => /2 vrije kolommen eindigen/.test(e)), "einde 1 vrij");
  assert.ok(bad(".......").some((e) => /lengte/.test(e)), "te kort");
  assert.ok(bad(".................").some((e) => /lengte/.test(e)), "te lang");
  assert.ok(bad("..X.........").some((e) => /onbekend terrein/.test(e)), "onbekend teken");
  assert.ok(bad("............", "  q         ").some((e) => /onbekend item/.test(e)), "onbekend item");
  assert.ok(bad("............", "  *        ").some((e) => /items-rij/.test(e)), "items-rij te kort");
  assert.ok(bad("....I.......", "    '       ").some((e) => /ijspegelband/.test(e)), "hoge ster in ijspegelband");
  assert.deepEqual(bad("....I.......", "    *       "), [], "lage ster onder ijspegels mag");
  assert.ok(bad("..__........", "  g         ").some((e) => /boven een gat/.test(e)), "cadeau boven gat");
  assert.ok(bad("..L.........", null, "pond").some((e) => /vijver/.test(e)), "obstakel in vijver");
  assert.ok(L.validateChunk(["x", 4, "............", "            "]).some((e) => /diff/.test(e)));
  assert.ok(L.validateChunk("nope").length > 0);
  assert.ok(L.validateAll([["a", 1, "..........", "          "]]).some((e) => /min 24/.test(e)));
});

test("determinisme per seed en moeilijkheid", () => {
  for (const d of DIFFS) {
    for (const seed of [0, 1, 42, "BAKO", "Rifka", 2 ** 31 - 1, -7]) {
      const a = fingerprint(L.generate(seed, d), 12000), b = fingerprint(L.generate(seed, d), 12000);
      assert.equal(a, b, `seed ${seed} ${d}`);
    }
    assert.notEqual(fingerprint(L.generate(1, d), 12000), fingerprint(L.generate(2, d), 12000), `${d}: andere seed → ander level`);
    assert.notEqual(fingerprint(L.generate("BAKO", d), 12000), fingerprint(L.generate("BAKU", d), 12000));
  }
  assert.notEqual(fingerprint(L.generate(5, "makkelijk"), 12000), fingerprint(L.generate(5, "normaal"), 12000), "moeilijkheid verandert het level");
  // ensure() in andere stappen geeft hetzelfde resultaat
  const a = L.generate(9, "stoer"); a.ensure(3000); a.ensure(9000); a.ensure(12000);
  assert.equal(fingerprint(a, 12000), fingerprint(L.generate(9, "stoer"), 12000));
  // onbekende moeilijkheid → normaal
  assert.equal(L.generate(3, "???").difficulty, "normaal");
  assert.equal(fingerprint(L.generate(3, "???"), 6000), fingerprint(L.generate(3, "normaal"), 6000));
});

test(`passeerbaar: ${SEEDS} seeds × 3 moeilijkheden (samengesteld level)`, () => {
  const t0 = Date.now();
  for (const d of DIFFS) {
    for (let s = 0; s < SEEDS; s++) {
      const lv = L.generate(s, d);
      const err = L.validateLayout(lv, UNTIL);
      assert.deepEqual(err, [], `${d} seed ${s}: ${err.slice(0, 3).join(" | ")}`);
    }
  }
  assert.ok(Date.now() - t0 < 30000, "validatie binnen 30 s");
});

test("validateLayout vangt een kapot level", () => {
  const lv = L.generate(1, "normaal"); lv.ensure(3000);
  // Een te breed gat erin smokkelen
  const g = lv.grounds[0];
  lv.grounds.splice(1, 0, { kind: "gap", x0: g.x1, x1: g.x1 + 400 });
  assert.ok(L.validateLayout(lv, 3000).some((e) => /gat/.test(e)));
  const lv2 = L.generate(1, "normaal"); lv2.ensure(8000);
  const o = lv2.obstacles[0];
  lv2.obstacles.push({ id: 9999, type: "log", x: o.x + 70, w: 60, h: 44, y0: 0, needs: "jump", n: 1, phase: 0 });
  lv2.obstacles.sort((a, b) => a.x - b.x);
  assert.ok(L.validateLayout(lv2, 8000).some((e) => /log @/.test(e)));
});

test("rustige start: intro1 eerst, daarna intro-chunk zonder gat", () => {
  for (const d of DIFFS) for (let s = 0; s < 40; s++) {
    const lv = L.generate(s, d); lv.ensure(100);
    assert.equal(lv.chunks[0].id, "intro1");
    assert.equal(lv.chunks[0].x0, 0);
    lv.ensure(3000);
    assert.ok(L.INTRO_IDS.includes(lv.chunks[1].id), `${d} ${s}: ${lv.chunks[1].id}`);
    assert.equal(lv.chunks[1].diff, 1);
    for (const g of lv.grounds) if (g.x0 < lv.chunks[1].x1) assert.notEqual(g.kind, "gap");
    assert.equal(lv.groundAt(0), "snow");
    assert.equal(lv.gapAt(0), null);
  }
});

test("moeilijkheid bepaalt de chunk-mix en obstakeldichtheid", () => {
  const maxDiff = { makkelijk: 2, normaal: 2, stoer: 3 };
  const density = {};
  for (const d of DIFFS) {
    let obst = 0, len = 0, sawHard = false;
    for (let s = 0; s < 20; s++) {
      const lv = L.generate(s, d); lv.ensure(UNTIL);
      for (const c of lv.chunks) { assert.ok(c.diff <= maxDiff[d], `${d}: chunk ${c.id} diff ${c.diff}`); if (c.diff === 3) sawHard = true; }
      // Eerste chunks nooit het zwaarst
      for (const c of lv.chunks.slice(0, 3)) assert.ok(c.diff <= 1, `${d}: ${c.id} te vroeg`);
      obst += lv.obstacles.filter((o) => o.x < UNTIL).length;
      len += UNTIL / L.speedAt(UNTIL / 2, d); // seconden spelen
    }
    density[d] = obst / len; // obstakels per seconde
    if (d === "stoer") assert.ok(sawHard, "stoer krijgt diff-3 chunks");
  }
  assert.ok(density.makkelijk < density.normaal, `makkelijk ${density.makkelijk.toFixed(2)} < normaal ${density.normaal.toFixed(2)}`);
  assert.ok(density.normaal < density.stoer, `normaal ${density.normaal.toFixed(2)} < stoer ${density.stoer.toFixed(2)}`);
});

test("kolombreedte rekt mee met de basissnelheid (timing blijft gelijk)", () => {
  for (const d of DIFFS) {
    const lv = L.generate(3, d); lv.ensure(UNTIL);
    let prev = 0;
    for (const c of lv.chunks) {
      assert.ok(Math.abs(c.colW - L.TILE * L.speedAt(c.x0, d) / L.V_BASE) < 1e-9, `${d} ${c.id}`);
      assert.ok(c.colW >= prev, "breder naarmate het sneller gaat");
      prev = c.colW;
      assert.ok(c.x1 > c.x0 && c.x1 - c.x0 <= 16 * c.colW + 1e-9);
    }
    // chunks sluiten aan (eventueel met ademruimte)
    for (let i = 1; i < lv.chunks.length; i++) {
      const gap = lv.chunks[i].x0 - lv.chunks[i - 1].x1;
      assert.ok(Math.abs(gap - L.DIFFS[d].breather * lv.chunks[i - 1].colW) < 1e-6, `${d}: ademruimte ${gap}`);
    }
  }
});

test("vijvers: aanwezig, zonder obstakels, driedubbele sterren-rijen", () => {
  for (const d of DIFFS) {
    let ponds = 0;
    for (let s = 0; s < 10; s++) {
      const lv = L.generate(s, d); lv.ensure(UNTIL);
      const pondChunks = lv.chunks.filter((c) => c.kind === "pond");
      ponds += pondChunks.length;
      for (const c of pondChunks) {
        assert.ok(c.idx >= 4, "niet in de eerste 4 chunks");
        assert.equal(lv.groundAt((c.x0 + c.x1) / 2), "pond");
        assert.ok(!lv.obstacles.some((o) => o.x > c.x0 && o.x < c.x1), "geen obstakels op het ijs");
        assert.ok(lv.items.filter((i) => i.x > c.x0 && i.x < c.x1 && i.kind === "star").length >= 6);
        assert.equal(lv.nextPond(c.x0 - 10).x0, c.x0);
      }
      for (let i = 1; i < pondChunks.length; i++) assert.ok(pondChunks[i].idx - pondChunks[i - 1].idx >= L.DIFFS[d].pondEvery[0], "vijvers niet te dicht op elkaar");
    }
    assert.ok(ponds >= 10, `${d}: ${ponds} vijvers in 10 levels`);
  }
});

test("objecten: geldige soorten, posities, gesorteerd; items nooit in de ijspegelband", () => {
  const types = new Set(["log", "icicles", "snowman", "pinecone"]);
  const kinds = new Set(["star", "candy", "gift", "bell"]);
  const ys = new Set([L.ITEM_Y.low, L.ITEM_Y.high, L.ITEM_Y.sky, L.ITEM_Y.candy, L.ITEM_Y.gift, L.ITEM_Y.bell, ...L.ITEM_Y.stack]);
  const spriteNames = new Set(["tree1", "tree2", "tree3", "house", "snowdrift", "signpost", "candyCane", "pinecone", "snowman"]);
  for (const d of DIFFS) {
    const lv = L.generate(11, d); lv.ensure(UNTIL);
    const sorted = (arr, key) => arr.every((v, i) => i === 0 || arr[i - 1][key] <= v[key]);
    assert.ok(sorted(lv.obstacles, "x") && sorted(lv.items, "x") && sorted(lv.decos, "x") && sorted(lv.grounds, "x0") && sorted(lv.chunks, "x0"));
    const ids = new Set();
    for (const o of lv.obstacles) {
      assert.ok(types.has(o.type), o.type);
      assert.equal(o.needs, L.OBST[o.type].needs);
      assert.equal(o.h, L.OBST[o.type].h);
      assert.equal(o.y0, L.OBST[o.type].y0);
      assert.ok(!ids.has(o.id)); ids.add(o.id);
      assert.ok(o.n === 1 || (o.type === "icicles" && o.n === 2));
      assert.notEqual(lv.groundAt(o.x), "gap", "obstakel nooit boven een gat");
    }
    for (const it of lv.items) {
      assert.ok(kinds.has(it.kind), it.kind);
      assert.ok(ys.has(it.y), `y ${it.y}`);
      assert.equal(it.taken, false);
      if (it.y === L.ITEM_Y.sky) assert.equal(it.optional, true);
      assert.ok(!ids.has(it.id)); ids.add(it.id);
      for (const o of lv.obstacles) {
        if (o.type !== "icicles" || Math.abs(o.x - it.x) > o.w / 2) continue;
        assert.ok(it.y <= o.y0 - 10, `item ${it.kind}@${Math.round(it.x)} y=${it.y} in ijspegelband`); // midden ruim onder de band
      }
      if (it.kind === "gift" || it.kind === "bell") assert.notEqual(lv.groundAt(it.x), "gap");
    }
    for (const dc of lv.decos) {
      assert.ok(spriteNames.has(dc.name), dc.name);
      assert.ok(dc.scale > 0.5 && dc.scale < 1.6);
      assert.equal(typeof dc.back, "boolean");
      assert.notEqual(lv.groundAt(dc.x), "gap", "geen decor boven een gat");
    }
    // grond is aaneengesloten vanaf 0
    assert.equal(lv.grounds[0].x0, 0);
    for (let i = 1; i < lv.grounds.length; i++) assert.ok(Math.abs(lv.grounds[i].x0 - lv.grounds[i - 1].x1) < 1e-6);
    assert.ok(lv.grounds.every((g) => ["snow", "pond", "gap"].includes(g.kind)));
    for (const g of lv.grounds) if (g.kind === "gap") {
      assert.deepEqual(lv.gapAt((g.x0 + g.x1) / 2), g);
      assert.equal(lv.groundAt(g.x0 - 1), lv.grounds[lv.grounds.indexOf(g) - 1].kind);
      assert.ok(g.x1 - g.x0 <= L.JUMP.airTime * lv.speedAt(g.x0) * 0.85 + 1e-6, "gat ≤ 85% van de sprongwijdte");
    }
  }
});

test("query / chunksAt / prune", () => {
  const lv = L.generate("BAKO", "normaal"); lv.ensure(8000);
  for (let x = 0; x < 8000; x += 97) {
    const c = lv.chunksAt(x);
    if (c) assert.ok(x >= c.x0 && x < c.x1, `chunksAt(${x})`); else assert.equal(lv.groundAt(x), "snow", "tussen chunks = ademruimte");
  }
  assert.equal(lv.chunksAt(-1), null);
  const q = lv.query(1000, 3000);
  assert.ok(q.obstacles.every((o) => o.x >= 1000 && o.x <= 3000));
  assert.ok(q.items.every((i) => i.x >= 1000 && i.x <= 3000));
  assert.deepEqual(q.items, lv.items.filter((i) => i.x >= 1000 && i.x <= 3000));
  assert.deepEqual(lv.query(5, 4), { obstacles: [], items: [], decos: [] });
  const before = lv.items.length;
  lv.prune(4000);
  assert.ok(lv.items.length < before && lv.items.every((i) => i.x >= 3600 - 1e-9));
  assert.ok(lv.obstacles.every((o) => o.x >= 3600 - 1e-9));
  assert.ok(lv.chunks[0].x1 >= 3600 - 1e-9 && lv.chunks.length > 0);
  assert.ok(lv.grounds[0].x1 >= 3600 - 1e-9);
  assert.equal(lv.chunksAt(100), null, "gepruned");
  // nieuwe generatie na prune blijft deterministisch
  lv.ensure(16000);
  const other = L.generate("BAKO", "normaal"); other.ensure(16000);
  assert.deepEqual(lv.chunks.map((c) => c.id), other.chunks.filter((c) => c.x1 >= 3600).map((c) => c.id));
  assert.equal(lv.endX, other.endX);
});
