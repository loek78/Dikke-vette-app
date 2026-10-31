/*
 * KerstLevel — deterministic level generator for KERSTDROOM (kerst/game.js).
 * UMD: browser global `window.KerstLevel` + CommonJS `module.exports`. Pure: no DOM, no Date, no Math.random.
 *
 * World units = logical px at animal scale 1 (the fawn is ~100 units tall). y is HEIGHT above the ground (up = +).
 * One authored column is TILE (64) units wide at the base speed V_BASE (240 u/s). A chunk placed where the base
 * speed is higher is stretched (colW = TILE · v / V_BASE) so every pattern keeps the same TIMING at any speed, and the
 * validator can reason in columns ("beats"). METER = 32 units → distance shown in meters.
 *
 * Chunks are hand-authored arrays [id, diff, terrain, items(, kind)] — see CHUNKS. Same length strings:
 *   terrain  .  ground          d  snowdrift (deco)      _  gap (frozen stream, jump)
 *            L  log (jump)      I  icicles / low branch (slide)   S  snowman (jump)   P  pinecone drop (jump)
 *   items    ' ' none   *  low star   '  high star (jump)   ^  sky star (double jump, optional)   |  3 stacked stars
 *            c  candy cane (arc height)   g  gift (→ power-up)   b  bell (melody combo)
 * Rules (validateChunk): 8–16 columns; starts with ≥1 plain column and ends with ≥2 (so chunk joints are always safe);
 * gap ≤ MAX_GAP_TILES (gap width ≤ JUMP.range · 0.85); log/snowman/pinecone never doubled (a 2-wide log is not clearable
 * with one jump at base speed), icicle runs ≤ 2 (the game keeps you sliding while something hangs above you);
 * after a gap ≥3 plain columns (so a slide obstacle is never right after a gap landing); after a jump obstacle ≥3 plain
 * columns before the next jump obstacle or gap and ≥2 before a slide; after a slide ≥2. Pond chunks (kind "pond") have
 * no obstacles and triple stars (the "schaatsbaan" event). validateLayout() re-checks the COMPOSED level in seconds.
 *
 * API
 *   KerstLevel.generate(seed, difficulty) → level           seed: number | string, difficulty: makkelijk|normaal|stoer
 *     level.ensure(x)            generate chunks until the level covers x
 *     level.chunksAt(x)          placed chunk covering x | null:  { id, diff, kind, x0, x1, colW, idx }
 *     level.chunks               placed chunks (sorted; pruned ones are dropped)
 *     level.query(x0, x1)        { obstacles, items, decos } with anchor x in [x0, x1] (sorted by x, fresh arrays)
 *     level.groundAt(x)          "snow" | "pond" | "gap"
 *     level.gapAt(x)             { kind:"gap", x0, x1 } | null
 *     level.nextPond(x)          first pond segment with x1 > x (generated so far) | null
 *     level.speedAt(x)           base run speed (units/s) for this difficulty at distance x
 *     level.prune(x)             forget everything that ends before x − 400 (call as the camera moves on)
 *     level.obstacles / items / decos / grounds   sorted arrays (the game may set item.taken, obstacle state, …)
 *     level.seed, level.difficulty, level.endX, level.count
 *   obstacle: { id, type: log|icicles|snowman|pinecone, x (center), w, h, y0 (bottom), needs: "jump"|"slide", alt?, n, phase }
 *   item:     { id, kind: star|candy|gift|bell, x, y, taken:false, optional?:true }
 *   deco:     { name, x, scale, back:true|false, flip }  (names are KerstArt sprite names)
 *   ground:   { kind: snow|pond|gap, x0, x1 }
 *   KerstLevel.speedAt(x, difficulty), KerstLevel.mulberry32(seed), KerstLevel.hashSeed(any)
 *   KerstLevel.parseChunk(chunk) → { id, diff, kind, cols:[{t, i}], n }
 *   KerstLevel.validateChunk(chunk) → string[] (empty = ok), KerstLevel.validateAll() → string[]
 *   KerstLevel.validateLayout(level, untilX) → string[]
 *   KerstLevel.CHUNKS, TILE, METER, V_BASE, JUMP { height, range, airTime, v0, g }, DIFFS, MAX_GAP_TILES, OBST, ITEM_Y
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KerstLevel = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TILE = 64;
  const METER = 32;
  const V_BASE = 240;
  // Sprong: hoogte 170 (1,7× het dier), 0,8 s in de lucht. range = enkele sprong op basissnelheid.
  const JUMP = (function () {
    const height = 170, airTime = 0.8;
    const g = (8 * height) / (airTime * airTime);
    return { height, airTime, g, v0: (g * airTime) / 2, range: airTime * V_BASE };
  })();
  const MAX_GAP_TILES = Math.floor((JUMP.range * 0.85) / TILE); // 2

  // Per moeilijkheid: snelheidscurve (units/s over afstand), moeilijkheidsgraad van chunks, ademruimte tussen chunks.
  const DIFFS = {
    makkelijk: { v0: 240, vmax: 330, ramp: 60000, breather: 2, salt: 0x11, maxDiff: (n) => (n < 14 ? 1 : 2), pondEvery: [9, 13] },
    normaal: { v0: 280, vmax: 440, ramp: 50000, breather: 1, salt: 0x22, maxDiff: (n) => (n < 3 ? 1 : 2), pondEvery: [9, 13] },
    stoer: { v0: 330, vmax: 560, ramp: 40000, breather: 0, salt: 0x33, maxDiff: (n) => (n < 3 ? 1 : n < 8 ? 2 : 3), pondEvery: [10, 14] },
  };

  // Hitboxen (world units) — gameplay hoort niet af te hangen van de tekenmodule.
  // Iets kleiner dan de tekening (KerstArt: stam 70×34, ijspegelrij 90×60 op 2×, sneeuwpop 70×95, dennenappel 30×40) → eerlijk.
  const OBST = {
    log: { w: 60, h: 36, y0: 0, needs: "jump" },
    icicles: { w: 64, h: 120, y0: 70, needs: "slide" }, // band 70–190: staand raak je hem, glijdend (≤ 40) niet, één sprong komt er niet overheen
    snowman: { w: 56, h: 50, y0: 42, needs: "jump", alt: "slide", wobble: 10 }, // hoofd + buik: eroverheen óf eronderdoor
    pinecone: { w: 32, h: 40, y0: 0, needs: "jump", dropY: 320 },
  };
  const ITEM_Y = { low: 60, high: 200, sky: 270, candy: 140, gift: 70, bell: 95, stack: [60, 110, 160] };

  const OBS_CHARS = "LISP";
  const JUMP_CHARS = "LSP";
  const isPlain = (c) => c === "." || c === "d";
  const isObs = (c) => OBS_CHARS.indexOf(c) >= 0;

  // ---------- Hand-authored chunks: [id, diff, terrain, items, kind?] ----------
  const CHUNKS = [
    // diff 1 — rustig
    ["intro1", 1, "..........", "  * * *   "],
    ["log1", 1, "...L......", "  *   ' * "],
    ["log2", 1, "..L....L....", "  '  *  '   "],
    ["drift", 1, "..d..d..d...", " *  *  *  * "],
    ["gap1", 1, "...__......", "   cc  *   "],
    ["icicle1", 1, "....I.......", "  * *  *    "],
    ["snowman1", 1, "....S.......", "   '   *    "],
    ["stars-arc", 1, "............", "  *''^''*   "],
    ["bells1", 1, "............", " b  b  b  b "],
    ["log-stars", 1, "..L.....L.....", "  '  * * '    "],
    ["gift1", 1, "...........", "    *g*    "],
    ["pond-a", 1, "............", " *|*  *|*   ", "pond"],
    // diff 2 — normaal
    ["log-log", 2, "..L...L....", "  '   '  * "],
    ["log-gap", 2, "..L...__......", "  '   cc  *   "],
    ["icicle-log", 2, "...I...L......", "   *   '  *   "],
    ["log-icicle", 2, "..L...I.......", "  '   *   *   "],
    ["snowman-gap", 2, "...S....__......", "   '    cc  *   "],
    ["gift-logs", 2, "..L....L...L....", "  '  g '  *'    "],
    ["icicles2", 2, "...II.....I.....", "   **     *     "],
    ["pinecone1", 2, "....P.........", "    '   *  *  "],
    ["bells-logs", 2, "..L....L......", "  'b  b '  b  "],
    ["gap-gap", 2, "..__....__......", "  cc  * cc  *   "],
    ["pond-b", 2, "...............", " *|* '' *|* '' ", "pond"],
    // diff 3 — stoer
    ["triple-log", 3, "..L...L...L.....", "  '  *'  *'     "],
    ["log-ice-log", 3, ".L...I..L.......", " '   * ' *      "],
    ["gap-log", 3, ".__...L........", " cc  '  *      "],
    ["snowman-ice", 3, "..S...I.......", "  '   *  *    "],
    ["pinecones", 3, "..P....P......", "  '  *  ' *   "],
    ["ice-gap", 3, "..I...__......", "  *   cc  *   "],
    ["big-combo", 3, ".L...__...I....", " '   cc   *    "],
    ["logs-gift", 3, "..L...S...L.....", "  '  g'  *'     "],
    ["double-ice", 3, "..II....II......", "  **    **  *   "],
    ["pond-c", 3, "................", " *|*^*|*^*|*^   ", "pond"],
  ];
  // Rustige start: eerste chunk altijd intro1, tweede uit deze lijst (geen gaten, diff 1).
  const INTRO_IDS = ["log1", "drift", "stars-arc", "bells1", "icicle1"];

  // ---------- RNG ----------
  function mulberry32(a) {
    a |= 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Seed → 32-bit int (FNV-1a voor strings, |0 voor getallen)
  function hashSeed(seed) {
    if (typeof seed === "number" && Number.isFinite(seed)) return Math.floor(seed) | 0;
    const s = String(seed == null ? "kerst" : seed);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h | 0;
  }

  function diffOf(difficulty) { return DIFFS[difficulty] || DIFFS.normaal; }
  function speedAt(x, difficulty) {
    const D = diffOf(difficulty);
    const f = Math.min(1, Math.max(0, x) / D.ramp);
    return D.v0 + (D.vmax - D.v0) * f;
  }

  // ---------- Chunk parsing & validation ----------
  function parseChunk(c) {
    const [id, diff, t, i, kind] = c;
    const cols = [];
    for (let k = 0; k < t.length; k++) cols.push({ t: t[k], i: i[k] === undefined ? " " : i[k] });
    return { id, diff, kind: kind || "snow", cols, n: t.length };
  }

  function validateChunk(c) {
    const err = [];
    if (!Array.isArray(c) || c.length < 4) return ["chunk is geen [id, diff, terrain, items]"];
    const [id, diff, t, i, kind] = c;
    const tag = `chunk ${id}`;
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) err.push(`${tag}: ongeldig id`);
    if (![1, 2, 3].includes(diff)) err.push(`${tag}: diff moet 1, 2 of 3 zijn`);
    if (typeof t !== "string" || typeof i !== "string") return err.concat(`${tag}: terrain/items geen string`);
    if (t.length < 8 || t.length > 16) err.push(`${tag}: lengte ${t.length} (8–16)`);
    if (i.length !== t.length) err.push(`${tag}: items-rij (${i.length}) ≠ terrain (${t.length})`);
    if (kind && kind !== "snow" && kind !== "pond") err.push(`${tag}: kind ${kind}`);
    for (const ch of t) if (".d_LISP".indexOf(ch) < 0) err.push(`${tag}: onbekend terrein-teken "${ch}"`);
    for (const ch of i) if (" *'^|cgb".indexOf(ch) < 0) err.push(`${tag}: onbekend item-teken "${ch}"`);
    if (!isPlain(t[0])) err.push(`${tag}: moet met een vrije kolom beginnen`);
    if (!(isPlain(t[t.length - 1]) && isPlain(t[t.length - 2]))) err.push(`${tag}: moet met 2 vrije kolommen eindigen`);
    if (kind === "pond" && /[_LISP]/.test(t)) err.push(`${tag}: vijver mag geen obstakels/gaten hebben`);
    // Runs van gelijke tekens
    const runs = [];
    for (let k = 0; k < t.length;) {
      let e = k; while (e < t.length && t[e] === t[k]) e++;
      runs.push({ ch: t[k], s: k, e: e - 1, len: e - k });
      k = e;
    }
    for (const r of runs) {
      if (r.ch === "_" && r.len > MAX_GAP_TILES) err.push(`${tag}: gat van ${r.len} kolommen (max ${MAX_GAP_TILES})`);
      if (r.ch === "I" && r.len > 2) err.push(`${tag}: ijspegelrij van ${r.len} (max 2)`);
      if ((r.ch === "L" || r.ch === "S" || r.ch === "P") && r.len > 1) err.push(`${tag}: ${r.ch} mag niet dubbel (niet met één sprong te halen)`);
    }
    // Afstand tussen opeenvolgende hindernissen (gat telt als hindernis)
    const obsRuns = runs.filter((r) => r.ch === "_" || isObs(r.ch));
    for (let k = 1; k < obsRuns.length; k++) {
      const a = obsRuns[k - 1], b = obsRuns[k];
      const plain = b.s - a.e - 1;
      let need;
      if (a.ch === "_") need = 3;
      else if (a.ch === "I") need = 2;
      else need = b.ch === "I" ? 2 : 3;
      if (plain < need) err.push(`${tag}: ${a.ch}@${a.e} → ${b.ch}@${b.s}: ${plain} vrije kolommen (min ${need})`);
    }
    // Items: niet in de ijspegelband (hoge sterren onder ijspegels), geen cadeau boven een gat
    for (let k = 0; k < t.length; k++) {
      if (t[k] === "I" && ("'^|".indexOf(i[k]) >= 0)) err.push(`${tag}: item "${i[k]}" in ijspegelband @${k}`);
      if (t[k] === "_" && (i[k] === "g" || i[k] === "b")) err.push(`${tag}: ${i[k]} boven een gat @${k}`);
    }
    return err;
  }

  function validateAll(chunks) {
    chunks = chunks || CHUNKS;
    const err = [];
    if (chunks.length < 24) err.push(`slechts ${chunks.length} chunks (min 24)`);
    const ids = new Set();
    const perDiff = { 1: 0, 2: 0, 3: 0 };
    for (const c of chunks) {
      err.push(...validateChunk(c));
      if (ids.has(c[0])) err.push(`dubbel id ${c[0]}`);
      ids.add(c[0]);
      if (perDiff[c[1]] !== undefined) perDiff[c[1]]++;
    }
    for (const d of [1, 2, 3]) if (perDiff[d] < 5) err.push(`diff ${d}: ${perDiff[d]} chunks (min 5)`);
    for (const id of INTRO_IDS) {
      const c = chunks.find((x) => x[0] === id);
      if (!c) err.push(`intro-chunk ${id} ontbreekt`);
      else if (c[1] !== 1 || c[2].indexOf("_") >= 0) err.push(`intro-chunk ${id} moet diff 1 zonder gat zijn`);
    }
    return err;
  }

  // ---------- Generator ----------
  const PRUNE_MARGIN = 400;

  function lowerBound(arr, x, key) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid][key] < x) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function generate(seed, difficulty) {
    const D = diffOf(difficulty);
    const diffName = DIFFS[difficulty] ? difficulty : "normaal";
    const rng = mulberry32(hashSeed(seed) ^ (D.salt * 0x9e3779b1));
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const pool = CHUNKS.map(parseChunk);
    const byId = {};
    for (const c of pool) byId[c.id] = c;

    const chunks = [], obstacles = [], items = [], decos = [], grounds = [];
    let cursor = 0, count = 0, nextId = 1;
    const recent = [];
    let sincePond = 0;
    let pondIn = D.pondEvery[0] + Math.floor(rng() * (D.pondEvery[1] - D.pondEvery[0] + 1));
    let lastGroundKind = null;

    function ground(kind, x0, x1) {
      const last = grounds[grounds.length - 1];
      if (last && last.kind === kind && Math.abs(last.x1 - x0) < 1e-6) last.x1 = x1;
      else grounds.push({ kind, x0, x1 });
      lastGroundKind = kind;
    }
    function addDeco(name, x, scale, back, flip) { decos.push({ name, x, scale, back, flip: !!flip }); }

    function chooseChunk() {
      if (count === 0) return byId.intro1;
      if (count === 1) return byId[pick(INTRO_IDS)];
      if (count >= 4 && sincePond >= pondIn) {
        const ponds = pool.filter((c) => c.kind === "pond" && c.diff <= Math.max(1, D.maxDiff(count)));
        sincePond = 0;
        pondIn = D.pondEvery[0] + Math.floor(rng() * (D.pondEvery[1] - D.pondEvery[0] + 1));
        return pick(ponds.length ? ponds : pool.filter((c) => c.kind === "pond"));
      }
      const maxDiff = D.maxDiff(count);
      let elig = pool.filter((c) => c.kind !== "pond" && c.diff <= maxDiff && recent.indexOf(c.id) < 0);
      // Liever de huidige moeilijkheid dan steeds de makkelijkste (maar houd afwisseling)
      if (maxDiff > 1 && rng() < 0.7) { const hard = elig.filter((c) => c.diff === maxDiff); if (hard.length) elig = hard; }
      return pick(elig.length ? elig : pool.filter((c) => c.kind !== "pond" && c.diff <= maxDiff));
    }

    function place(c) {
      const x0 = cursor;
      const colW = TILE * speedAt(x0, diffName) / V_BASE;
      const idx = count;
      const kind = c.kind;
      const groundKind = kind === "pond" ? "pond" : "snow";
      const cols = c.cols;
      // Terrein-runs → obstakels/gaten (samengevoegd per run)
      for (let k = 0; k < cols.length;) {
        const ch = cols[k].t;
        let e = k; while (e < cols.length && cols[e].t === ch) e++;
        const n = e - k;
        const cx0 = x0 + k * colW, cx1 = x0 + e * colW;
        if (ch === "_") {
          ground("gap", cx0, cx1);
        } else {
          ground(groundKind, cx0, cx1);
          if (isObs(ch)) {
            const type = ch === "L" ? "log" : ch === "I" ? "icicles" : ch === "S" ? "snowman" : "pinecone";
            const spec = OBST[type];
            obstacles.push({
              id: nextId++, type, x: (cx0 + cx1) / 2, w: spec.w + (n - 1) * colW, h: spec.h, y0: spec.y0,
              needs: spec.needs, alt: spec.alt || null, n, phase: rng() * Math.PI * 2, chunk: idx,
            });
          }
        }
        k = e;
      }
      // Items & deco per kolom
      for (let k = 0; k < cols.length; k++) {
        const col = cols[k];
        const cx = x0 + (k + 0.5) * colW;
        const ic = col.i;
        const star = (y, optional) => items.push({ id: nextId++, kind: "star", x: cx, y, taken: false, optional: !!optional, chunk: idx });
        if (ic === "*") star(ITEM_Y.low);
        else if (ic === "'") star(ITEM_Y.high);
        else if (ic === "^") star(ITEM_Y.sky, true);
        else if (ic === "|") for (const y of ITEM_Y.stack) star(y);
        else if (ic === "c") items.push({ id: nextId++, kind: "candy", x: cx, y: ITEM_Y.candy, taken: false, chunk: idx });
        else if (ic === "g") items.push({ id: nextId++, kind: "gift", x: cx, y: ITEM_Y.gift, taken: false, chunk: idx });
        else if (ic === "b") items.push({ id: nextId++, kind: "bell", x: cx, y: ITEM_Y.bell, taken: false, chunk: idx });
        // Decor: nooit boven een gat; bomen/huisjes achter, kleine dingen voor
        if (col.t === "d") addDeco("snowdrift", cx, 0.9 + rng() * 0.4, false, rng() < 0.5);
        if (col.t !== "_") {
          const r = rng();
          if (kind === "pond") {
            if (r < 0.12) addDeco("snowman", cx + (rng() - 0.5) * colW, 0.8, true, rng() < 0.5);
          } else if (r < 0.30) addDeco(pick(["tree1", "tree2", "tree3"]), cx + (rng() - 0.5) * colW, 0.8 + rng() * 0.5, true, rng() < 0.5);
          else if (r < 0.36) addDeco("house", cx, 0.9 + rng() * 0.2, true, rng() < 0.5);
          else if (r < 0.40 && !isObs(col.t)) addDeco("signpost", cx, 1, false, false);
          else if (r < 0.44 && !isObs(col.t)) addDeco("candyCane", cx + colW * 0.3, 1, false, rng() < 0.5);
          else if (r < 0.47 && !isObs(col.t)) addDeco("pinecone", cx - colW * 0.3, 0.7, false, false);
        }
      }
      const x1 = x0 + cols.length * colW;
      chunks.push({ id: c.id, diff: c.diff, kind, x0, x1, colW, idx });
      cursor = x1;
      // Ademruimte tussen chunks (makkelijk: 2 kolommen, normaal: 1)
      if (D.breather > 0) {
        const bx1 = cursor + D.breather * colW;
        ground("snow", cursor, bx1);
        cursor = bx1;
      }
      recent.push(c.id);
      if (recent.length > 6) recent.shift();
      if (kind !== "pond") sincePond++;
      count++;
    }

    function ensure(x) {
      let guard = 0;
      while (cursor <= x && guard++ < 10000) place(chooseChunk());
    }
    function chunksAt(x) {
      const i = lowerBound(chunks, x, "x1"); // eerste chunk met x1 >= x
      const c = chunks[i] || (chunks[i - 1] && x >= chunks[i - 1].x0 ? chunks[i - 1] : null);
      return c && x >= c.x0 && x < c.x1 ? c : null;
    }
    function groundSeg(x) {
      // segments gesorteerd op x0, aaneengesloten
      let lo = 0, hi = grounds.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (grounds[mid].x1 <= x) lo = mid + 1; else hi = mid; }
      const g = grounds[lo];
      return g && x >= g.x0 ? g : null;
    }
    function groundAt(x) { const g = groundSeg(x); return g ? g.kind : "snow"; }
    function gapAt(x) { const g = groundSeg(x); return g && g.kind === "gap" ? g : null; }
    function nextPond(x) {
      for (let i = Math.max(0, lowerBound(grounds, x, "x1")); i < grounds.length; i++) if (grounds[i].kind === "pond" && grounds[i].x1 > x) return grounds[i];
      return null;
    }
    function query(x0, x1) {
      const slice = (arr) => arr.slice(lowerBound(arr, x0, "x"), lowerBound(arr, x1 + 1e-9, "x"));
      return { obstacles: slice(obstacles), items: slice(items), decos: slice(decos) };
    }
    function prune(x) {
      const lim = x - PRUNE_MARGIN;
      const cut = (arr, key) => { const i = lowerBound(arr, lim, key); if (i > 0) arr.splice(0, i); };
      cut(obstacles, "x"); cut(items, "x"); cut(decos, "x");
      let i = 0; while (i < chunks.length - 1 && chunks[i].x1 < lim) i++;
      if (i > 0) chunks.splice(0, i);
      i = 0; while (i < grounds.length - 1 && grounds[i].x1 < lim) i++;
      if (i > 0) grounds.splice(0, i);
    }

    const level = {
      seed, difficulty: diffName, chunks, obstacles, items, decos, grounds,
      ensure, chunksAt, groundAt, gapAt, nextPond, query, prune,
      speedAt: (x) => speedAt(x, diffName),
      get endX() { return cursor; },
      get count() { return count; },
    };
    return level;
  }

  // ---------- Composed-level validator (seconds, on the real layout) ----------
  function validateLayout(level, untilX) {
    const err = [];
    level.ensure(untilX);
    const v = level.speedAt;
    const T_COL = TILE / V_BASE; // 0.267 s per authored column
    const things = [];
    for (const o of level.obstacles) if (o.x < untilX) things.push({ kind: o.type, needs: o.needs, x0: o.x - o.w / 2, x1: o.x + o.w / 2, o });
    for (const g of level.grounds) if (g.kind === "gap" && g.x0 < untilX) things.push({ kind: "gap", needs: "jump", x0: g.x0, x1: g.x1 });
    things.sort((a, b) => a.x0 - b.x0);
    for (const th of things) {
      const vv = v(th.x0);
      if (th.kind === "gap") {
        const range = JUMP.airTime * vv;
        if (th.x1 - th.x0 > range * 0.85 + 1e-6) err.push(`gat @${Math.round(th.x0)}: ${Math.round(th.x1 - th.x0)} > ${Math.round(range * 0.85)}`);
      } else if (th.kind === "icicles") {
        const colW = TILE * vv / V_BASE;
        if (th.x1 - th.x0 > OBST.icicles.w + colW + 1e-6) err.push(`ijspegels @${Math.round(th.x0)} te breed`);
      } else if (th.x1 - th.x0 > OBST[th.kind].w + 1e-6) err.push(`${th.kind} @${Math.round(th.x0)} te breed`);
    }
    for (let k = 1; k < things.length; k++) {
      const a = things[k - 1], b = things[k];
      const gapS = (b.x0 - a.x1) / v(a.x1); // seconden tussen de twee
      let needCols;
      if (a.kind === "gap") needCols = 3;
      else if (a.kind === "icicles") needCols = 2;
      else needCols = b.kind === "icicles" ? 2 : 3;
      // Hitbox-randen liggen binnen de kolom; reken met kolom-afstand (−1 kolom marge voor sprite-breedte)
      const need = (needCols - 0.5) * T_COL;
      if (gapS < need - 1e-6) err.push(`${a.kind} @${Math.round(a.x1)} → ${b.kind} @${Math.round(b.x0)}: ${gapS.toFixed(2)} s (min ${need.toFixed(2)} s)`);
      if (a.kind === "gap" && b.needs === "slide" && gapS < 2 * T_COL) err.push(`glij-obstakel direct na gat @${Math.round(b.x0)}`);
    }
    // Vijvers: nooit obstakels erin
    for (const g of level.grounds) if (g.kind === "pond") for (const o of level.obstacles) if (o.x > g.x0 && o.x < g.x1) err.push(`obstakel ${o.type} in vijver @${Math.round(o.x)}`);
    return err;
  }

  return {
    TILE, METER, V_BASE, JUMP, DIFFS, MAX_GAP_TILES, OBST, ITEM_Y, CHUNKS, INTRO_IDS,
    mulberry32, hashSeed, speedAt, parseChunk, validateChunk, validateAll, generate, validateLayout,
  };
});
