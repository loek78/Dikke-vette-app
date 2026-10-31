/*! kerst/effects.js — KerstFX: de verrassende effecten van KERSTDROOM (SPEC-4 §3). Geen deps, geen assets.
 * UMD-light: browser global `window.KerstFX` + CommonJS `module.exports`. DOM alleen binnen functies, zodat Node het
 * kan require()-en voor tests (create() zonder document werkt ook: dan zonder pre-rendered sprites).
 *
 *   KerstFX.create(canvas, opts) → fx
 *     opts { standalone=false   fx tekent dan zélf de reuzenboom- en sneeuwpop-sprites (via KerstArt) — in het spel doet
 *                               game.js dat, fx voegt daar alleen gloed, lichtjes en nootjes aan toe
 *            reducedMotion=null  null = volg prefers-reduced-motion; true/false = forceer
 *            ambientSnow=true    zachte sneeuwval die altijd valt
 *            maxParticles=1400   grootte van de deeltjes-pool (gepoold, geen allocaties per frame)
 *            seed=1 }
 *   fx.trigger(id, opts)   id ∈ noorderlicht sterrenregen snoepregen peperkoek droomflip sneeuwbol rendiervlucht reuzenboom
 *                          schaatsbaan kerstman sneeuwpop finale geheimpje     opts { names:[..], by, x, y, duration }
 *   fx.update(dt, world)   dt in seconden. world = { cam:{x,y}, w, h, player:{x,y}, speed, t,
 *                          z?, groundY?, playerScreenX?, flip?, phase? }  (de optionele velden komen uit game.js)
 *   fx.drawBack(ctx, w)    direct ná de achtergrond: aurora-banden, gloed, kleine vallende sterren, ijsglinsters
 *   fx.drawFront(ctx, w)   over alles: deeltjes, snoep, parachute-cadeau, slee, vuurwerk + namen, tints, sneeuwbol-rand
 *                          (ctx in CSS-px; de aanroeper heeft de DPR/flip/shake-transform al gezet)
 *   fx.shake → {x,y}       screen-shake offset in px (altijd 0,0 bij reduced motion)
 *   fx.theme → "nacht"|"aurora"|"peperkoek"      fx.themeMix → 0..1 (hoe ver de overgang naar fx.theme is)
 *   fx.gravityFlip → bool  true tijdens de Droomflip: na 0.8 s duizel-swirl tot 0.2 s voor het einde
 *   fx.burst(kind, x, y, n)  WERELD-coördinaten (y = hoogte boven de grond): star candy gift confetti bell bauble land jump
 *                          hurt revive heart powerup shield wish snow sparkle splash (onbekend → sparkles)
 *   fx.hitTest(x, y) → wens|null   canvas-px; raakt een GROTE vallende ster (hitstraal 60 px) → { wish:true, stars:25, x, y }
 *   fx.collectables() → [{ id, kind:"candy"|"gift", x, y, r, take() }]   wereld-coördinaten; take() = opgepakt (met burst)
 *   fx.wishes → [{x,y,r}]   de nu tikbare sterren (canvas-px), voor hints/tests
 *   fx.active(id) → 0..1 voortgang (0 = niet actief)     fx.events → [actieve ids]     fx.destroy()
 *
 * Wereld → scherm: X = (x − cam.x)·z, Y = groundY − (y − cam.y)·z (zelfde afspraak als game.js).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KerstFX = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const G = root || {};
  const M = Math, TAU = M.PI * 2, sin = M.sin, cos = M.cos;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const ss = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = M.imul(a ^ (a >>> 15), 1 | a);
      t = (t + M.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Duur per effect in seconden (gelijk aan game.js EVENTS)
  const EVENTS = {
    noorderlicht: 10, sterrenregen: 10, snoepregen: 6, peperkoek: 15, droomflip: 8, sneeuwbol: 5, rendiervlucht: 10,
    reuzenboom: 12, schaatsbaan: 8, kerstman: 8, sneeuwpop: 10, finale: 10, geheimpje: 2.5,
  };
  const EVENT_IDS = Object.keys(EVENTS);
  const THEME_OF = { noorderlicht: "aurora", peperkoek: "peperkoek" };
  const CANDY = ["#e8465a", "#ffd14f", "#4fa3e8", "#9b6be8", "#4fcf9f", "#ff8ad6"];
  const FIRE = ["#ffd14f", "#ff6b8a", "#6fd3ff", "#b58cff", "#7bf2b0", "#ffffff", "#ffa94d", "#ff8ad6"];
  const AURORA = ["#4dffb0", "#4fe3ff", "#c48bff", "#ff8ad6"];
  const WISH = 25;

  // deeltjes-soorten
  const K = { SPARK: 0, SNOW: 1, CONF: 2, CANDY: 3, STAR: 4, HEART: 5, NOTE: 6, RING: 7, PUFF: 8, STREAK: 9, FIRE: 10, GLINT: 11, CANE: 12, FLAKE: 13 };

  // ---------- pre-rendered mini-sprites (één keer per fx) ----------
  function makeCanvas(w, h) {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }
  function spriteSet() {
    const S = { ok: false };
    const probe = makeCanvas(2, 2);
    if (!probe || !probe.getContext) return S;
    const SS = 2; // supersample
    const draw = (w, h, fn) => { const c = makeCanvas(w * SS, h * SS); const x = c.getContext("2d"); x.scale(SS, SS); x.lineJoin = x.lineCap = "round"; fn(x, w, h); c.lw = w; c.lh = h; return c; };
    // zachte gloed-bol per kleur
    S.glow = {};
    const glow = (col) => draw(32, 32, (x) => { const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, "#ffffff"); g.addColorStop(0.25, col); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; x.fillRect(0, 0, 32, 32); });
    for (const c of CANDY.concat(FIRE, AURORA, ["#ffffff", "#ffe9a8", "#8fd7ff", "#ff7b9c", "#b9c9f0"])) if (!S.glow[c]) S.glow[c] = glow(c);
    S.glowOf = (c) => S.glow[c] || (S.glow[c] = glow(c));
    // sneeuwvlok: zacht bolletje, grote vlok met 6 armen
    S.snow = draw(16, 16, (x) => { const g = x.createRadialGradient(8, 8, 0, 8, 8, 8); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.5, "rgba(255,255,255,.85)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(0, 0, 16, 16); });
    S.flake = draw(28, 28, (x) => { x.translate(14, 14); x.strokeStyle = "#ffffff"; x.lineWidth = 2; for (let i = 0; i < 6; i++) { x.rotate(TAU / 6); x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -12); x.moveTo(0, -7); x.lineTo(-3.5, -10); x.moveTo(0, -7); x.lineTo(3.5, -10); x.stroke(); } x.fillStyle = "#fff"; x.beginPath(); x.arc(0, 0, 2.2, 0, TAU); x.fill(); });
    // snoepje in papiertje + zuurstok, per kleur
    S.candy = CANDY.map((col) => draw(36, 22, (x) => {
      x.fillStyle = col; x.strokeStyle = "#3a2826"; x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(5, 6); x.lineTo(11, 9); x.lineTo(5, 16); x.lineTo(8, 11); x.closePath(); x.fill(); x.stroke();
      x.beginPath(); x.moveTo(31, 6); x.lineTo(25, 9); x.lineTo(31, 16); x.lineTo(28, 11); x.closePath(); x.fill(); x.stroke();
      x.beginPath(); x.ellipse(18, 11, 8.5, 7, 0, 0, TAU); x.fill(); x.stroke();
      x.strokeStyle = "rgba(255,255,255,.75)"; x.lineWidth = 2; x.beginPath(); x.moveTo(14, 5.5); x.quadraticCurveTo(12, 11, 14, 16.5); x.stroke();
      x.beginPath(); x.moveTo(20, 5); x.quadraticCurveTo(18, 11, 20, 17); x.stroke();
      x.fillStyle = "rgba(255,255,255,.8)"; x.beginPath(); x.ellipse(15, 8, 2.2, 1.4, -0.6, 0, TAU); x.fill();
    }));
    S.cane = draw(18, 34, (x) => {
      x.lineCap = "round"; x.lineWidth = 6; x.strokeStyle = "#ffffff";
      const path = () => { x.beginPath(); x.moveTo(13, 30); x.lineTo(13, 10); x.arc(9, 10, 4, 0, M.PI, true); };
      path(); x.stroke();
      x.lineWidth = 8; x.strokeStyle = "#3a2826"; x.globalCompositeOperation = "destination-over"; path(); x.stroke(); x.globalCompositeOperation = "source-over";
      x.strokeStyle = "#e8465a"; x.lineWidth = 6; x.setLineDash([3.5, 3.5]); path(); x.stroke();
    });
    // voorgedraaide varianten (12 hoeken) → geen save/rotate/restore per snoepje
    const ROT = 12;
    const rotated = (im) => { const out = []; const d = M.ceil(M.hypot(im.lw, im.lh)); for (let i = 0; i < ROT; i++) out.push(draw(d, d, (x) => { x.translate(d / 2, d / 2); x.rotate((i / ROT) * TAU); x.drawImage(im, -im.lw / 2, -im.lh / 2, im.lw, im.lh); })); return out; };
    S.candyRot = S.candy.map(rotated); S.caneRot = rotated(S.cane); S.ROT = ROT;
    // ster, hartje, muzieknootje, glinster
    S.star = {};
    const star = (col) => draw(24, 24, (x) => { x.translate(12, 12); x.fillStyle = col; x.strokeStyle = "rgba(58,40,38,.9)"; x.lineWidth = 1.5; x.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 4.6 : 10.5, a = -M.PI / 2 + (i * M.PI) / 5; x.lineTo(cos(a) * r, sin(a) * r); } x.closePath(); x.fill(); x.stroke(); x.fillStyle = "rgba(255,255,255,.85)"; x.beginPath(); x.arc(-3, -3.5, 1.8, 0, TAU); x.fill(); });
    S.starOf = (c) => S.star[c] || (S.star[c] = star(c));
    S.heart = draw(22, 20, (x) => { x.fillStyle = "#ff6b8a"; x.strokeStyle = "#3a2826"; x.lineWidth = 1.5; x.beginPath(); x.moveTo(11, 18); x.bezierCurveTo(-4, 8, 3, -3, 11, 5); x.bezierCurveTo(19, -3, 26, 8, 11, 18); x.fill(); x.stroke(); x.fillStyle = "rgba(255,255,255,.8)"; x.beginPath(); x.ellipse(6.5, 6, 2, 1.3, -0.7, 0, TAU); x.fill(); });
    S.note = CANDY.map((col) => draw(18, 26, (x) => { x.fillStyle = col; x.strokeStyle = "#3a2826"; x.lineWidth = 1.6; x.beginPath(); x.ellipse(6.5, 20, 5, 3.6, -0.4, 0, TAU); x.fill(); x.stroke(); x.beginPath(); x.moveTo(11, 19.5); x.lineTo(11, 4); x.quadraticCurveTo(13, 8, 16.5, 9); x.quadraticCurveTo(13, 6, 11, 3); x.stroke(); x.fill(); }));
    S.glint = draw(24, 24, (x) => { x.translate(12, 12); x.fillStyle = "#ffffff"; x.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 2.2 : 11, a = (i * M.PI) / 4; x.lineTo(cos(a) * r, sin(a) * r); } x.closePath(); x.fill(); });
    S.gift = draw(30, 30, (x) => { x.fillStyle = "#e8465a"; x.strokeStyle = "#3a2826"; x.lineWidth = 1.8; x.beginPath(); x.roundRect ? x.roundRect(3, 8, 24, 20, 3) : x.rect(3, 8, 24, 20); x.fill(); x.stroke(); x.fillStyle = "#ffd14f"; x.fillRect(13, 8, 4, 20); x.fillRect(3, 16, 24, 4); x.strokeStyle = "#ffd14f"; x.lineWidth = 2.5; x.beginPath(); x.ellipse(11, 6, 4, 3, 0, 0, TAU); x.ellipse(19, 6, 4, 3, 0, 0, TAU); x.stroke(); });
    S.ok = true;
    return S;
  }

  // ---------- deeltjes-pool ----------
  function makeParticle() { return { x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, g: 0, drag: 0, age: 0, life: 1, size: 4, kind: 0, c: 0, col: "#fff", rot: 0, vr: 0, sp: 0, fr: 1, a: 1, ph: 0, w: 1 }; }

  function create(canvas, opts) {
    opts = opts || {};
    const SP = spriteSet();
    const CAP = opts.maxParticles > 0 ? opts.maxParticles | 0 : 1400;
    const pool = new Array(CAP);
    for (let i = 0; i < CAP; i++) pool[i] = makeParticle();
    let count = 0;
    const rng = mulberry32((opts.seed | 0) || 1);
    const rnd = (a, b) => a + (b - a) * rng();
    const pick = (arr) => arr[(rng() * arr.length) | 0];
    let reduced = opts.reducedMotion;
    if (reduced == null) { try { reduced = !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { reduced = false; } }
    const standalone = !!opts.standalone;
    const A = G.KerstArt || null;

    // view (uit world) — in CSS px
    const V = { cx: 0, cy: 0, z: 1, gy: 600, psx: 100, w: 390, h: 844, px: 0, py: 0, speed: 0, t: 0, flip: 0 };
    const sx = (wx) => (wx - V.cx) * V.z;
    const sy = (wy) => V.gy - (wy - V.cy) * V.z;
    function setView(w) {
      if (!w) return;
      if ((w.w && w.w !== V.w) || (w.h && w.h !== V.h)) OV.clear();
      V.w = w.w || V.w; V.h = w.h || V.h;
      V.z = w.z > 0 ? w.z : clamp(M.min(V.w / 640, V.h / 700), 0.4, 1.15);
      V.gy = w.groundY > 0 ? w.groundY : V.h * (V.h > V.w ? 0.68 : 0.74);
      V.psx = w.playerScreenX > 0 ? w.playerScreenX : V.w * 0.26;
      if (w.player) { V.px = w.player.x || 0; V.py = w.player.y || 0; }
      if (w.cam) { V.cx = w.cam.x != null ? w.cam.x : V.px - V.psx / V.z; V.cy = w.cam.y || 0; } else V.cx = V.px - V.psx / V.z;
      V.speed = w.speed || 0; V.t = w.t || 0; V.flip = w.flip || 0;
    }

    // staat
    const evs = {};            // id → { id, t, dur, data, ... }
    const shooters = [];       // vallende sterren (schermruimte)
    const drops = [];          // snoepjes (wereld), collectables
    const rockets = [];        // vuurwerkpijlen (scherm)
    const blooms = [];         // vuurwerk-knallen (typed arrays, gebatcht getekend)
    const OV = new Map();      // gecachte full-screen overlays (vignetten, stralen, sneeuwbol-rand) per w×h
    const names = [];          // getoonde namen bij de finale
    let chute = null;          // parachute-cadeau (wereld)
    let sleigh = null;
    let giant = null, singer = null;
    let themeTarget = "nacht", themeMix = 1, themeFrom = "nacht";
    let sweep = 0, sweepDir = 0; // peperkoek icing-veeg 0..1 (dir 0 = stil)
    let flash = 0, flashCol = "#ffd14f";
    let shakeAmt = 0, shakeT = 0;
    const shakeOut = { x: 0, y: 0 };
    let flipFlag = false;
    let idSeq = 1, destroyed = false, tLocal = 0, flakeSeed = 0;
    const colOut = [];
    const activeIds = [];
    const flakes = [];         // ambient sneeuw (schermruimte, wrap)
    if (opts.ambientSnow !== false) for (let i = 0; i < 56; i++) flakes.push({ x: rng(), y: rng(), s: 1.4 + rng() * 2.2, v: 0.03 + rng() * 0.05, ph: rng() * TAU, a: 0.45 + rng() * 0.45 });

    // ---------- deeltjes ----------
    function spawn(kind, x, y, sp, fr) {
      let p;
      if (count < CAP) p = pool[count++];
      else { p = pool[(rng() * CAP) | 0]; } // vol: hergebruik een willekeurig deeltje
      p.kind = kind; p.x = p.px = x; p.y = p.py = y; p.sp = sp; p.fr = fr == null ? 1 : fr;
      p.vx = p.vy = 0; p.g = 0; p.drag = 0; p.age = 0; p.life = 1; p.size = 4; p.c = 0; p.col = "#ffffff"; p.rot = 0; p.vr = 0; p.a = 1; p.ph = rng() * TAU; p.w = 1;
      return p;
    }
    function kill(i) { count--; if (i !== count) { const t = pool[i]; pool[i] = pool[count]; pool[count] = t; } }
    const n = (k) => (reduced ? M.ceil(k * 0.5) : k);

    // Burst in wereldcoördinaten
    function burst(kind, x, y, cnt) {
      if (destroyed) return;
      x = +x || 0; y = +y || 0;
      const N = n(cnt || 8);
      switch (kind) {
        case "star": case "bauble": case "sparkle": case "wish": {
          const big = kind === "wish" || kind === "bauble";
          for (let i = 0; i < N; i++) { const p = spawn(K.SPARK, x, y, 0); const a = rng() * TAU, v = rnd(60, big ? 260 : 170); p.vx = cos(a) * v; p.vy = sin(a) * v + 60; p.g = -500; p.drag = 2; p.life = rnd(0.4, big ? 1 : 0.7); p.size = rnd(5, big ? 13 : 9); p.col = kind === "bauble" ? pick(CANDY) : pick(["#ffd14f", "#ffe9a8", "#ffffff"]); }
          if (big) { const r = spawn(K.RING, x, y, 0); r.size = kind === "wish" ? 120 : 70; r.life = 0.5; r.col = "#ffe9a8"; }
          if (kind === "wish") for (let i = 0; i < 6; i++) { const p = spawn(K.STAR, x, y, 0); const a = rng() * TAU; p.vx = cos(a) * 200; p.vy = sin(a) * 200 + 120; p.g = -600; p.life = 1; p.size = 18; p.vr = rnd(-6, 6); p.col = "#ffd14f"; }
          break;
        }
        case "candy": for (let i = 0; i < N; i++) { const p = spawn(K.SPARK, x, y, 0); const a = rng() * TAU, v = rnd(80, 200); p.vx = cos(a) * v; p.vy = sin(a) * v + 80; p.g = -600; p.drag = 1.5; p.life = rnd(0.35, 0.7); p.size = rnd(5, 9); p.col = pick(CANDY); } break;
        case "gift": case "confetti":
          for (let i = 0; i < N; i++) { const p = spawn(K.CONF, x, y, 0); const a = rng() * TAU, v = rnd(120, 320); p.vx = cos(a) * v; p.vy = M.abs(sin(a)) * v + 150; p.g = -700; p.drag = 1.6; p.life = rnd(0.9, 1.6); p.size = rnd(6, 11); p.w = rnd(0.45, 0.8); p.vr = rnd(-9, 9); p.col = pick(CANDY); }
          { const r = spawn(K.RING, x, y, 0); r.size = 80; r.life = 0.45; r.col = "#ffffff"; }
          break;
        case "bell": for (let i = 0; i < N; i++) { const p = spawn(K.SPARK, x, y, 0); const a = rng() * TAU, v = rnd(50, 160); p.vx = cos(a) * v; p.vy = sin(a) * v + 90; p.g = -400; p.life = rnd(0.4, 0.8); p.size = rnd(5, 9); p.col = "#ffd14f"; }
          { const r = spawn(K.RING, x, y, 0); r.size = 56; r.life = 0.6; r.col = "#ffd14f"; const r2 = spawn(K.RING, x, y, 0); r2.size = 90; r2.life = 0.9; r2.col = "#ffe9a8"; } break;
        case "land": case "snow": case "splash":
          for (let i = 0; i < N; i++) { const p = spawn(K.PUFF, x + rnd(-14, 14), y + 2, 0); p.vx = rnd(-110, 110) + (kind === "land" ? -40 : 0); p.vy = rnd(30, kind === "splash" ? 260 : 120); p.g = kind === "splash" ? -500 : -140; p.drag = 2.5; p.life = rnd(0.35, 0.6); p.size = rnd(5, kind === "land" ? 12 : 9); p.col = kind === "splash" ? "#bfe6ff" : "#ffffff"; } break;
        case "jump": for (let i = 0; i < N; i++) { const p = spawn(K.PUFF, x + rnd(-12, 12), y, 0); p.vx = rnd(-60, 60); p.vy = rnd(-30, 20); p.drag = 3; p.life = rnd(0.25, 0.45); p.size = rnd(4, 9); p.col = "#ffffff"; } break;
        case "hurt": // zacht: grijze wolkjes + een paar dizzy sterretjes
          for (let i = 0; i < N; i++) { const p = spawn(K.PUFF, x, y + 40, 0); const a = rng() * TAU; p.vx = cos(a) * rnd(40, 120); p.vy = sin(a) * rnd(40, 120); p.drag = 2; p.life = rnd(0.4, 0.7); p.size = rnd(8, 14); p.col = "#cfd6ea"; }
          for (let i = 0; i < 4; i++) { const p = spawn(K.STAR, x, y + 95, 0); p.ph = i * (TAU / 4); p.kind = K.STAR; p.life = 1.1; p.size = 14; p.col = "#ffe9a8"; p.c = 1; /* c=1: draai in een cirkeltje */ } break;
        case "revive": case "heart":
          for (let i = 0; i < N; i++) { const p = spawn(K.HEART, x + rnd(-30, 30), y + rnd(20, 90), 0); p.vx = rnd(-40, 40); p.vy = rnd(90, 190); p.g = -40; p.life = rnd(0.9, 1.5); p.size = rnd(12, 22); p.vr = rnd(-2, 2); }
          { const r = spawn(K.RING, x, y + 50, 0); r.size = 140; r.life = 0.8; r.col = "#ff9ad5"; } break;
        case "powerup": case "shield":
          for (let i = 0; i < N; i++) { const p = spawn(K.SPARK, x, y + 50, 0); const a = (i / N) * TAU; p.vx = cos(a) * 180; p.vy = sin(a) * 180; p.drag = 2; p.life = 0.8; p.size = rnd(7, 12); p.col = kind === "shield" ? "#8fd7ff" : pick(["#ffd14f", "#ff8ad6", "#6fd3ff"]); }
          { const r = spawn(K.RING, x, y + 50, 0); r.size = 130; r.life = 0.7; r.col = kind === "shield" ? "#8fd7ff" : "#ffd14f"; const r2 = spawn(K.RING, x, y + 50, 0); r2.size = 90; r2.life = 0.5; r2.col = "#ffffff"; } break;
        default: for (let i = 0; i < N; i++) { const p = spawn(K.SPARK, x, y, 0); const a = rng() * TAU, v = rnd(60, 160); p.vx = cos(a) * v; p.vy = sin(a) * v + 40; p.g = -400; p.life = rnd(0.4, 0.7); p.size = rnd(5, 9); p.col = "#ffe9a8"; }
      }
    }

    function updateParticles(dt) {
      for (let i = count - 1; i >= 0; i--) {
        const p = pool[i];
        p.age += dt;
        if (p.age >= p.life) { kill(i); continue; }
        p.px = p.x; p.py = p.y;
        if (p.c === 1 && p.kind === K.STAR) { // dizzy sterretjes draaien rond het hoofd
          p.ph += dt * 5; p.x = p.px + 0; continue;
        }
        if (p.drag) { const d = M.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
        p.vy += p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.kind === K.SNOW || p.kind === K.FLAKE || p.kind === K.CONF) p.x += sin(p.age * 3 + p.ph) * (p.kind === K.CONF ? 60 : 30) * dt;
        if (p.sp === 0 && p.kind !== K.STAR && p.g < 0 && p.y < 0) { // op de grond: zacht uitdoven
          p.y = 0; p.vy = 0; p.vx *= 0.6; if (p.life - p.age > 0.25) p.life = p.age + 0.25;
        }
      }
    }

    function drawParticles(ctx, front) {
      const w = V.w, h = V.h;
      for (let i = 0; i < count; i++) {
        const p = pool[i];
        if (p.fr !== front) continue;
        let X, Y, s;
        if (p.sp === 0) {
          if (p.c === 1 && p.kind === K.STAR) { X = sx(p.x + cos(p.ph) * 34); Y = sy(p.y + sin(p.ph) * 10); }
          else { X = sx(p.x); Y = sy(p.y); }
          s = p.size * V.z;
        } else { X = p.x; Y = p.y; s = p.size; }
        if (X < -90 || X > w + 90 || Y < -140 || Y > h + 90) continue;
        const k = p.age / p.life, fade = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        ctx.globalAlpha = clamp(fade * p.a, 0, 1);
        switch (p.kind) {
          case K.SPARK: { const im = SP.ok ? SP.glowOf(p.col) : null; const r = s * (1 + (1 - k) * 0.4); if (im) ctx.drawImage(im, X - r, Y - r, r * 2, r * 2); else { ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(X, Y, r * 0.5, 0, TAU); ctx.fill(); } break; }
          case K.SNOW: { const im = SP.ok ? SP.snow : null; if (im) ctx.drawImage(im, X - s, Y - s, s * 2, s * 2); else { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(X, Y, s * 0.7, 0, TAU); ctx.fill(); } break; }
          case K.FLAKE: if (SP.ok) { ctx.save(); ctx.translate(X, Y); ctx.rotate(p.rot); ctx.drawImage(SP.flake, -s, -s, s * 2, s * 2); ctx.restore(); } break;
          case K.CONF: ctx.save(); ctx.translate(X, Y); ctx.rotate(p.rot); ctx.scale(1, M.max(0.2, M.abs(cos(p.rot * 1.7 + p.ph)))); ctx.fillStyle = p.col; ctx.fillRect(-s * 0.5, -s * p.w * 0.5, s, s * p.w); ctx.restore(); break;
          case K.CANDY: case K.CANE: { if (!SP.ok) { ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(X, Y, s * 0.5, 0, TAU); ctx.fill(); break; } const set = p.kind === K.CANDY ? SP.candyRot[p.c % 6] : SP.caneRot; const im = set[(((p.rot / TAU) * SP.ROT) % SP.ROT + SP.ROT) % SP.ROT | 0]; const d = im.lw * (s / 12); ctx.drawImage(im, X - d / 2, Y - d / 2, d, d); break; }
          case K.STAR: case K.HEART: case K.NOTE: case K.GLINT: {
            if (!SP.ok) { ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(X, Y, s * 0.5, 0, TAU); ctx.fill(); break; }
            const im = p.kind === K.STAR ? SP.starOf(p.col) : p.kind === K.HEART ? SP.heart : p.kind === K.NOTE ? SP.note[p.c % 6] : SP.glint;
            const sc = s / 12, ww = im.lw * sc, hh = im.lh * sc;
            if (p.kind === K.GLINT) ctx.globalAlpha *= 0.55 + 0.45 * sin(p.age * 14 + p.ph);
            if (p.rot || p.vr) { ctx.save(); ctx.translate(X, Y); ctx.rotate(p.rot); ctx.drawImage(im, -ww / 2, -hh / 2, ww, hh); ctx.restore(); }
            else ctx.drawImage(im, X - ww / 2, Y - hh / 2, ww, hh);
            break;
          }
          case K.RING: ctx.strokeStyle = p.col; ctx.lineWidth = M.max(1, 4 * (1 - k)) * (p.sp ? 1 : V.z); ctx.globalAlpha = (1 - k) * 0.9 * p.a; ctx.beginPath(); ctx.arc(X, Y, s * (0.2 + k * 0.8), 0, TAU); ctx.stroke(); break;
          case K.PUFF: ctx.fillStyle = p.col; ctx.globalAlpha = (1 - k) * 0.65 * p.a; ctx.beginPath(); ctx.arc(X, Y, s * (0.6 + k * 0.7), 0, TAU); ctx.fill(); break;
          case K.STREAK: { const f = p.sp ? 1 : V.z; ctx.strokeStyle = p.col; ctx.lineWidth = s; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - p.vx * 0.05 * f, Y + (p.sp ? -p.vy : p.vy) * 0.05 * f); ctx.stroke(); break; }
          case K.FIRE: {
            let PX, PY; if (p.sp === 0) { PX = sx(p.px); PY = sy(p.py); } else { PX = p.px; PY = p.py; }
            ctx.strokeStyle = p.col; ctx.lineWidth = s; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(PX, PY); ctx.lineTo(X, Y); ctx.stroke();
            if (p.c === 2 && (((p.age * 20) | 0) & 1)) { const im = SP.ok ? SP.glow["#ffffff"] : null; if (im) ctx.drawImage(im, X - s * 2, Y - s * 2, s * 4, s * 4); }
            break;
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---------- events ----------
    function trigger(id, data) {
      if (destroyed || !EVENTS[id]) return false;
      data = data || {};
      const dur = data.duration > 0 ? +data.duration : EVENTS[id];
      const ev = { id, t: 0, dur, data, acc: 0, k: 0 };
      evs[id] = ev;
      switch (id) {
        case "noorderlicht": setTheme("aurora"); break;
        case "peperkoek": setTheme("peperkoek"); sweep = 0; sweepDir = 1; ev.acc = 0; break;
        case "sterrenregen": shooters.length = 0; ev.acc = 0.2; break;
        case "snoepregen": flashCol = "#ff8ad6"; flash = M.max(flash, 0.35); for (let i = 0; i < n(14); i++) spawnCandy(V.cx + rnd(0, V.w / V.z), rnd(380, 620)); break;
        case "droomflip": ev.flipped = false; flipFlag = false; break;
        case "sneeuwbol": shakeAmt = M.max(shakeAmt, 1); ev.shake = 1; burst("revive", V.px, V.py, 10); flashCol = "#ffffff"; flash = M.max(flash, 0.5); break;
        case "rendiervlucht": ev.acc = 0; break;
        case "reuzenboom": giant = { x0: data.x != null ? +data.x : V.px + 1400, px0: V.px }; break;
        case "schaatsbaan": break;
        case "kerstman": sleigh = { t: 0, dur: M.min(dur, 7), dropped: false, dir: -1 }; break;
        case "sneeuwpop": singer = { x: data.x != null ? +data.x : V.px + 560, acc: 0, note: 0 }; break;
        case "finale": ev.names = Array.isArray(data.names) && data.names.length ? data.names.filter(Boolean).slice(0, 8) : []; ev.acc = 0.1; ev.ni = 0; ev.nameT = 0.6; flashCol = "#ffd14f"; flash = M.max(flash, 0.9); names.length = 0; rockets.length = 0; break;
        case "geheimpje": { const mx = data.x != null ? +data.x : V.w * 0.8, my = data.y != null ? +data.y : V.h * 0.14; for (let i = 0; i < n(18); i++) { const p = spawn(K.SPARK, mx, my, 1); const a = rng() * TAU, v = rnd(60, 220); p.vx = cos(a) * v; p.vy = sin(a) * v; p.drag = 1.5; p.life = rnd(0.5, 1); p.size = rnd(6, 12); p.col = pick(["#ffd14f", "#ffe9a8", "#ffffff"]); } for (let i = 0; i < n(6); i++) { const p = spawn(K.STAR, mx, my, 1); const a = rng() * TAU; p.vx = cos(a) * 160; p.vy = sin(a) * 160 - 60; p.g = 300; p.life = 1.4; p.size = rnd(12, 18); p.vr = rnd(-5, 5); p.col = pick(["#ffd14f", "#e8465a"]); } break; }
      }
      return true;
    }
    function endEvent(id) {
      const ev = evs[id]; if (!ev) return;
      delete evs[id];
      if (THEME_OF[id] && themeTarget === THEME_OF[id]) { let other = null; for (const k in evs) if (THEME_OF[k]) other = THEME_OF[k]; setTheme(other || "nacht"); }
      if (id === "droomflip") flipFlag = false;
      if (id === "reuzenboom") giant = null;
      if (id === "sneeuwpop") singer = null;
      if (id === "peperkoek") { sweepDir = -1; sweep = 1; }
    }
    function setTheme(th) {
      if (th === themeTarget) return;
      themeFrom = themeTarget; themeTarget = th; themeMix = 0;
    }

    function spawnCandy(x, y) {
      const cane = rng() < 0.3;
      drops.push({ id: idSeq++, kind: "candy", cane, x, y, vx: rnd(-20, 20), vy: -rnd(230, 380), rot: rng() * TAU, vr: rnd(-4, 4), c: (rng() * 6) | 0, state: 0, t: 0, taken: false, r: 30 });
    }
    function takeDrop(d) {
      if (d.taken) return; d.taken = true;
      burst(d.kind === "gift" ? "confetti" : "candy", d.x, d.y, d.kind === "gift" ? 16 : 7);
    }

    function update(dt, world) {
      if (destroyed) return;
      dt = clamp(+dt || 0, 0, 0.1);
      setView(world);
      tLocal += dt;
      // thema-overgang
      if (themeMix < 1) themeMix = M.min(1, themeMix + dt / 1.1);
      if (sweepDir > 0 && sweep < 1) sweep = M.min(1, sweep + dt / 0.9); else if (sweepDir < 0 && sweep > 0) sweep = M.max(0, sweep - dt / 0.9);
      if (flash > 0) flash = M.max(0, flash - dt * 1.6);
      // shake: impuls dooft uit; sneeuwbol stuurt zelf
      shakeAmt *= M.exp(-dt * 2.2);
      let evShake = 0;
      for (const id in evs) {
        const ev = evs[id];
        ev.t += dt; ev.k = ev.t / ev.dur;
        if (ev.t >= ev.dur) { endEvent(id); continue; }
        updateEvent(ev, dt);
        if (ev.shake) evShake = M.max(evShake, ev.shake);
      }
      const amt = M.max(shakeAmt * 12, evShake * 14);
      if (reduced || amt < 0.05) { shakeOut.x = shakeOut.y = 0; }
      else { shakeT += dt; shakeOut.x = sin(shakeT * 41) * amt + sin(shakeT * 17) * amt * 0.4; shakeOut.y = cos(shakeT * 33) * amt * 0.8; }
      // snoepjes (wereld)
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.t += dt;
        if (d.taken || d.x < V.cx - 250 / V.z || d.t > 9) { drops.splice(i, 1); continue; }
        if (d.state === 0) {
          d.vy = M.max(-520, d.vy - 420 * dt); d.y += d.vy * dt; d.x += d.vx * dt + sin(d.t * 4 + d.rot) * 18 * dt; d.rot += d.vr * dt;
          if (d.y <= 0) { d.y = 0; if (d.vy < -160 && !d.bounced) { d.bounced = true; d.vy = -d.vy * 0.32; d.vr *= 0.5; burst("land", d.x, 0, 3); } else { d.state = 1; d.t = 0; d.vy = 0; } }
        } else if (d.t > 1.4) { // op de grond: smelt weg met een glinster
          d.taken = true; const p = spawn(K.GLINT, d.x, 8, 0); p.life = 0.5; p.size = 10; p.vy = 40; drops.splice(i, 1);
        }
      }
      // parachute-cadeau
      if (chute) {
        chute.t += dt;
        if (chute.taken || chute.x < V.cx - 300 / V.z || chute.t > 16) chute = null;
        else if (!chute.landed) { chute.y += chute.vy * dt; chute.x += sin(chute.t * 1.8) * 26 * dt; chute.sway = sin(chute.t * 1.8) * 0.18; if (chute.y <= 30) { chute.y = 30; chute.landed = true; chute.t = 0; burst("land", chute.x, 0, 5); } }
        else if (chute.t > 3) { burst("sparkle", chute.x, chute.y, 10); chute = null; }
      }
      // slee
      if (sleigh) { sleigh.t += dt; if (sleigh.t > sleigh.dur + 1) sleigh = null; else if (!sleigh.dropped && sleigh.t > 2.4) { sleigh.dropped = true; chute = { id: idSeq++, kind: "gift", x: V.px + V.speed * 2.6, y: 470, vy: -95, sway: 0, t: 0, landed: false, taken: false, r: 44 }; } }
      // vallende sterren (scherm)
      for (let i = shooters.length - 1; i >= 0; i--) {
        const s = shooters[i]; s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt;
        if (s.caught || s.t > s.life || s.y > V.h * 0.62 || s.x < -120 || s.x > V.w + 120) { shooters.splice(i, 1); continue; }
        if (s.big && rng() < dt * 30) { const p = spawn(K.SPARK, s.x, s.y, 1); p.vx = -s.vx * 0.1 + rnd(-30, 30); p.vy = -s.vy * 0.1 + rnd(-30, 30); p.life = rnd(0.3, 0.7); p.size = rnd(5, 10); p.col = pick(["#ffd14f", "#ffffff", "#ffe9a8"]); }
      }
      // vuurwerk
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.t += dt; r.px = r.x; r.py = r.y; r.vy += 260 * dt; r.x += r.vx * dt; r.y += r.vy * dt;
        if (rng() < dt * 40) { const p = spawn(K.SPARK, r.x, r.y, 1); p.vx = rnd(-20, 20); p.vy = rnd(20, 80); p.life = rnd(0.2, 0.5); p.size = rnd(3, 6); p.col = "#ffe9a8"; }
        if (r.t >= r.fuse || r.vy > -40) { explode(r); rockets.splice(i, 1); }
      }
      updateBlooms(dt);
      for (let i = names.length - 1; i >= 0; i--) { names[i].t += dt; if (names[i].t > 2.4) names.splice(i, 1); }
      // ambient sneeuw
      if (flakes.length) { const wind = sin(tLocal * 0.4) * 0.02; for (const f of flakes) { f.y += f.v * dt * (1 + f.s * 0.15); f.x += (wind + sin(tLocal * 1.3 + f.ph) * 0.012) * dt; if (f.y > 1.02) { f.y = -0.02; f.x = rng(); } if (f.x > 1.02) f.x = -0.02; else if (f.x < -0.02) f.x = 1.02; } }
      updateParticles(dt);
      activeIds.length = 0; for (const id in evs) activeIds.push(id);
    }

    function updateEvent(ev, dt) {
      const w = V.w, h = V.h;
      switch (ev.id) {
        case "noorderlicht": // regenboog-glinsters in de lucht
          ev.acc += dt * n(7); while (ev.acc >= 1) { ev.acc--; const p = spawn(K.GLINT, rng() * w, rng() * h * 0.5, 1, 0); p.life = rnd(0.8, 1.6); p.size = rnd(6, 12); p.vy = rnd(-8, 8); p.col = "#ffffff"; }
          break;
        case "sterrenregen": {
          ev.acc -= dt;
          if (ev.acc <= 0) {
            ev.cnt = (ev.cnt || 0) + 1;
            let big = ev.cnt % 3 === 0 && ev.t < ev.dur - 3;
            if (big) for (const s of shooters) if (s.big && !s.caught) { big = false; break; } // één wens-ster tegelijk
            const side = rng() < 0.5 ? -1 : 1;
            const x = big ? w * rnd(0.25, 0.75) : side > 0 ? w * rnd(0.55, 1.1) : w * rnd(-0.1, 0.45); // de wens-ster blijft in beeld
            const sp = big ? rnd(110, 150) : rnd(260, 420);
            shooters.push({ x, y: -20 - rng() * 60, vx: -side * sp * (big ? 0.35 : 0.7), vy: sp * (big ? 0.6 : 0.75), t: 0, life: big ? 5 : 2.6, big, caught: false, size: big ? 1 : rnd(0.5, 0.9), col: big ? "#ffd14f" : pick(["#ffffff", "#ffe9a8", "#bfe6ff"]) });
            ev.acc = big ? 0.6 : rnd(0.25, 0.55);
          }
          break;
        }
        case "snoepregen":
          ev.acc += dt * n(ev.t < ev.dur - 1 ? 20 : 0);
          while (ev.acc >= 1) { ev.acc--; const top = V.cy + V.gy / V.z; spawnCandy(V.cx + rnd(80, (w + 60) / V.z), top + rnd(20, 260)); }
          if (rng() < dt * 40) { const p = spawn(K.SPARK, rng() * w, -10, 1); p.vy = rnd(180, 320); p.vx = rnd(-20, 20); p.life = h / 250; p.size = rnd(3, 6); p.col = pick(CANDY); p.a = 0.8; }
          break;
        case "peperkoek": // suiker-sprenkels
          if (rng() < dt * 12) { const p = spawn(K.CONF, rng() * w, -10, 1); p.vy = rnd(60, 110); p.life = h / 70; p.size = rnd(4, 7); p.w = 0.5; p.vr = rnd(-4, 4); p.col = pick(CANDY); p.a = 0.9; }
          break;
        case "droomflip": {
          const pre = 0.8;
          if (ev.t < pre) { // duizel-swirl rond de speler (schermruimte: draait mee met Vlok)
            const k = ev.t / pre; ev.shake = (1 - k) * 0.25;
            const cx = V.psx, cy = sy(V.py + 55), z = V.z;
            for (let i = 0; i < 3; i++) { const a = tLocal * 10 + i * (TAU / 3), r = (70 + k * 60) * z; const p = spawn(K.STAR, cx + cos(a) * r, cy + sin(a) * r * 0.45, 1); p.life = 0.3; p.size = (16 + k * 10) * z; p.col = pick(["#c48bff", "#ff8ad6", "#ffd14f"]); p.vr = 9; p.vy = -20; }
            for (let i = 0; i < 2; i++) { const a = -tLocal * 8 + i * M.PI, r = (110 + k * 70) * z; const p = spawn(K.SPARK, cx + cos(a) * r, cy + sin(a) * r * 0.45, 1); p.life = 0.3; p.size = 12 * z; p.col = "#b58cff"; }
            if (rng() < dt * 12) { const p = spawn(K.RING, cx, cy, 1); p.size = (120 + k * 100) * z; p.life = 0.5; p.col = "#c48bff"; }
          } else { ev.shake = 0; if (!ev.flipped) { ev.flipped = true; flipFlag = true; burst("powerup", V.px, V.py, 14); flashCol = "#c48bff"; flash = M.max(flash, 0.45); } }
          if (flipFlag && ev.t > ev.dur - 0.25) { flipFlag = false; burst("powerup", V.px, V.py, 10); }
          if (flipFlag && rng() < dt * 10) { const p = spawn(K.SPARK, rng() * w, rng() * h, 1, 0); p.life = 1; p.size = rnd(4, 8); p.col = "#c48bff"; p.a = 0.6; p.vy = -30; }
          break;
        }
        case "sneeuwbol": {
          const k = ev.k; ev.shake = k < 0.55 ? M.pow(1 - k / 0.55, 1.4) : 0;
          const rate = k < 0.75 ? n(90) : 0;
          ev.acc += dt * rate;
          while (ev.acc >= 1) { ev.acc--; const big = rng() < 0.2; const p = spawn(big ? K.FLAKE : K.SNOW, rng() * (w + 100) - 50, -20 - rng() * 60, 1); p.vy = rnd(140, 320) * (big ? 0.6 : 1); p.vx = rnd(-120, 120); p.drag = 0.4; p.life = rnd(2.5, 4.5); p.size = big ? rnd(10, 16) : rnd(3, 8); p.vr = rnd(-2, 2); p.a = rnd(0.6, 1); }
          break;
        }
        case "rendiervlucht": // ster-spoor achter de speler + snelheidsstrepen
          ev.acc += dt * n(44); while (ev.acc >= 1) { ev.acc--; const p = spawn(K.SPARK, V.px - 24 + rnd(-10, 10), V.py + 45 + rnd(-18, 18), 0); p.vx = -V.speed * 0.3 + rnd(-40, 40); p.vy = rnd(-40, 40); p.g = -30; p.life = rnd(0.6, 1.3); p.size = rnd(8, 16); p.col = pick(["#ffd14f", "#ffe9a8", "#ffffff", "#ff8ad6"]); }
          if (rng() < dt * 12) { const p = spawn(K.STAR, V.px + rnd(-40, 20), V.py + 60 + rnd(-30, 30), 0); p.vx = -V.speed * 0.45; p.life = 1.2; p.size = rnd(12, 20); p.vr = rnd(-4, 4); p.col = pick(["#ffd14f", "#ffffff"]); }
          if (!reduced && rng() < dt * 14) { const p = spawn(K.STREAK, w + 20, rnd(0, h * 0.75), 1, 0); p.vx = -rnd(900, 1500); p.life = (w + 100) / -p.vx; p.size = rnd(1.5, 3); p.col = "#ffffff"; p.a = 0.45; }
          break;
        case "reuzenboom": if (rng() < dt * n(10)) { const gx = giantX(); const p = spawn(K.GLINT, gx + rnd(-150, 150), rnd(40, 520), 0, 0); p.life = rnd(0.8, 1.6); p.size = rnd(6, 12); p.vy = -40; p.col = "#fff"; } break;
        case "schaatsbaan": // ijsspray bij de voeten en glinsters op het ijs
          if (V.py < 4) { ev.acc += dt * n(30); while (ev.acc >= 1) { ev.acc--; const p = spawn(K.SPARK, V.px - 18, 4, 0); p.vx = -V.speed * 0.5 + rnd(-60, 20); p.vy = rnd(60, 220); p.g = -700; p.life = rnd(0.3, 0.55); p.size = rnd(4, 8); p.col = pick(["#ffffff", "#bfe6ff", "#8fd7ff"]); } }
          if (rng() < dt * 22) { const p = spawn(K.GLINT, V.cx + rnd(0, w / V.z), rnd(2, 14), 0, 1); p.life = rnd(0.5, 1.1); p.size = rnd(12, 22); p.col = "#fff"; }
          if (rng() < dt * 4) { const p = spawn(K.FLAKE, rng() * w, -20, 1); p.vy = rnd(25, 50); p.vx = rnd(-10, 10); p.life = h / 30; p.size = rnd(12, 20); p.vr = rnd(-1, 1); p.a = 0.6; }
          break;
        case "kerstman": break;
        case "sneeuwpop": if (singer) { singer.acc += dt; if (singer.acc >= 0.28) { singer.acc = 0; singer.note++; const p = spawn(K.NOTE, singer.x + rnd(-6, 30), 112, 0); p.vx = V.speed * 0.95 + rnd(-20, 30); /* het liedje zweeft met je mee */ p.vy = rnd(70, 120); p.g = -8; p.life = rnd(2.4, 3.2); p.size = rnd(26, 38); p.c = singer.note; p.vr = rnd(-1.2, 1.2); p.a = 0.95; if (singer.note % 4 === 0) { const q = spawn(K.HEART, singer.x + 10, 118, 0); q.vy = 90; q.vx = 12; q.life = 2; q.size = 24; } if (singer.note % 2) { const s = spawn(K.SPARK, singer.x + rnd(-30, 30), rnd(20, 110), 0); s.vy = 40; s.life = 0.6; s.size = 8; s.col = "#ffe9a8"; } } } break;
        case "finale": {
          ev.acc -= dt;
          if (ev.acc <= 0) { launch(); ev.acc = rnd(0.3, 0.6) * (reduced ? 1.6 : 1); }
          ev.nameT -= dt;
          if (ev.nameT <= 0 && ev.names.length) { names.push({ txt: ev.names[ev.ni % ev.names.length], x: w * rnd(0.3, 0.7), y: h * rnd(0.18, 0.42), t: 0, col: FIRE[ev.ni % FIRE.length] }); ev.ni++; ev.nameT = 1.3; }
          if (rng() < dt * 10) { const p = spawn(K.CONF, rng() * w, -10, 1); p.vy = rnd(90, 160); p.life = h / 90; p.size = rnd(6, 10); p.w = 0.5; p.vr = rnd(-6, 6); p.col = pick(CANDY); }
          break;
        }
      }
    }
    function giantX() { return giant ? giant.x0 - (V.px - giant.px0) * 0.5 : V.px + 1400; }
    function launch() {
      const w = V.w, h = V.h;
      const x = w * rnd(0.15, 0.85), ty = h * rnd(0.12, 0.45);
      const fuse = rnd(0.8, 1.1);
      const vy = -(h - ty + 0.5 * 260 * fuse * fuse) / fuse;
      rockets.push({ x, y: h + 10, px: x, py: h + 10, vx: rnd(-30, 30), vy, t: 0, fuse, col: pick(FIRE), style: (rng() * 3) | 0 });
    }
    // vuurwerk-bloem: alle vonken van één knal in typed arrays → één stroke per kleur i.p.v. per vonk
    function explode(r) {
      const N = n(r.style === 2 ? 90 : 64), col2 = pick(FIRE);
      const cols = r.style === 0 ? [r.col] : r.style === 1 ? [r.col, col2] : FIRE.slice(0, 4);
      const b = { n: N, x: new Float32Array(N), y: new Float32Array(N), px: new Float32Array(N), py: new Float32Array(N), vx: new Float32Array(N), vy: new Float32Array(N), glit: new Uint8Array(N), age: 0, life: rnd(1.3, 1.9), cols, width: rnd(2.4, 3.6) };
      for (let i = 0; i < N; i++) { const a = rng() * TAU, v = r.style === 1 ? rnd(170, 260) : rnd(60, 250); b.x[i] = b.px[i] = r.x; b.y[i] = b.py[i] = r.y; b.vx[i] = cos(a) * v; b.vy[i] = sin(a) * v; b.glit[i] = rng() < 0.15 ? 1 : 0; }
      blooms.push(b);
      const g = spawn(K.SPARK, r.x, r.y, 1); g.life = 0.35; g.size = 70; g.col = r.col;
      flashCol = r.col; flash = M.max(flash, 0.18);
      if (!reduced) shakeAmt = M.max(shakeAmt, 0.3);
    }
    function updateBlooms(dt) {
      const d = M.max(0, 1 - 1.3 * dt), g = 170 * dt;
      for (let k = blooms.length - 1; k >= 0; k--) {
        const b = blooms[k]; b.age += dt; if (b.age >= b.life) { blooms.splice(k, 1); continue; }
        for (let i = 0; i < b.n; i++) { b.px[i] = b.x[i]; b.py[i] = b.y[i]; b.vx[i] *= d; b.vy[i] = b.vy[i] * d + g; b.x[i] += b.vx[i] * dt; b.y[i] += b.vy[i] * dt; }
      }
    }
    function drawBlooms(ctx) {
      if (!blooms.length) return;
      ctx.lineCap = "round";
      const im = SP.ok ? SP.glow["#ffffff"] : null;
      for (const b of blooms) {
        const k = b.age / b.life, fade = k > 0.55 ? 1 - (k - 0.55) / 0.45 : 1;
        ctx.globalAlpha = fade; ctx.lineWidth = b.width * (1 - k * 0.4);
        const nc = b.cols.length;
        for (let c = 0; c < nc; c++) { ctx.strokeStyle = b.cols[c]; ctx.beginPath(); for (let i = c; i < b.n; i += nc) { ctx.moveTo(b.px[i], b.py[i]); ctx.lineTo(b.x[i], b.y[i]); } ctx.stroke(); }
        if (im) { const on = ((b.age * 18) | 0) & 1; for (let i = on; i < b.n; i += 2) if (b.glit[i]) ctx.drawImage(im, b.x[i] - 7, b.y[i] - 7, 14, 14); }
      }
      ctx.globalAlpha = 1;
    }

    // ---------- tekenen ----------
    // full-screen overlay (radiale/lineaire verlopen zijn duur per frame → één keer renderen, daarna één drawImage)
    function overlay(key, maker) {
      let c = OV.get(key); if (c) return c;
      c = makeCanvas(M.max(1, V.w | 0), M.max(1, V.h | 0)); if (!c) return null;
      const x = c.getContext("2d"); maker(x, V.w, V.h); OV.set(key, c); return c;
    }
    const vignette = (key, rgb, a0, a1) => overlay(key, (x, w, h) => { const g = x.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.78); g.addColorStop(0, `rgba(${rgb},${a0})`); g.addColorStop(1, `rgba(${rgb},${a1})`); x.fillStyle = g; x.fillRect(0, 0, w, h); });
    function blitOverlay(ctx, c, alpha, comp) { if (!c || alpha <= 0.003) return; ctx.globalAlpha = alpha; if (comp) ctx.globalCompositeOperation = comp; ctx.drawImage(c, 0, 0, V.w, V.h); if (comp) ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; }

    function drawBack(ctx, world) {
      if (destroyed || !ctx) return;
      if (world) setView(world);
      const w = V.w, h = V.h, t = tLocal;
      ctx.save();
      ctx.lineJoin = ctx.lineCap = "round";
      // Noorderlicht: shader-achtige golvende banden (additief)
      const au = evs.noorderlicht;
      if (au) {
        const env = ss(0, 1, au.t) * ss(au.dur, au.dur - 1.5, au.t);
        ctx.globalCompositeOperation = "lighter";
        if (!au.grads || au.gradH !== h) { // verlopen per band zijn vast voor deze hoogte → één keer maken
          au.gradH = h; au.grads = [];
          for (let b = 0; b < 4; b++) { const baseY = h * (0.07 + b * 0.075), amp = h * 0.045, th = h * (0.11 - b * 0.012); const g = ctx.createLinearGradient(0, baseY - amp, 0, baseY + th + amp); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.35, AURORA[b]); g.addColorStop(0.7, AURORA[b]); g.addColorStop(1, "rgba(0,0,0,0)"); au.grads.push(g); }
        }
        for (let b = 0; b < 4; b++) {
          const baseY = h * (0.07 + b * 0.075), amp = h * 0.045, th = h * (0.11 - b * 0.012);
          ctx.fillStyle = au.grads[b]; ctx.globalAlpha = env * (0.22 + 0.08 * sin(t * 0.9 + b));
          ctx.beginPath();
          const N = 18, step = w / N;
          for (let i = 0; i <= N; i++) { const x = i * step; const y = baseY + sin(x * 0.012 + t * 0.9 + b * 1.7) * amp + sin(x * 0.027 - t * 1.4 + b) * amp * 0.5; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          for (let i = N; i >= 0; i--) { const x = i * step; const y = baseY + th + sin(x * 0.012 + t * 0.9 + b * 1.7 + 0.8) * amp * 0.8 + sin(x * 0.02 + t * 1.1) * amp * 0.4; ctx.lineTo(x, y); }
          ctx.closePath(); ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      }
      // Reuzenboom: gloed + lichtjes die op de maat pulseren
      if (giant) {
        const gx = sx(giantX()), gy = sy(0), z = V.z, ev = evs.reuzenboom;
        const env = ev ? ss(0, 1.2, ev.t) * ss(ev.dur, ev.dur - 1, ev.t) : 1;
        const beat = 0.5 + 0.5 * M.pow(M.max(0, sin(t * TAU * (84 / 60) - 1.2)), 2);
        if (standalone && A && typeof A.sprite === "function") { ctx.save(); ctx.translate(gx, gy); try { A.sprite(ctx, "giantTree", t, { scale: z, lit: true }); } catch (e) { /* geen sprite */ } ctx.restore(); }
        ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = env * (0.25 + 0.2 * beat);
        const glow = SP.ok ? SP.glowOf("#ffb060") : null; const R = 330 * z; // gecachte gloed-bol i.p.v. een verloop per frame
        if (glow) ctx.drawImage(glow, gx - R, gy - 240 * z - R, R * 2, R * 2);
        ctx.globalCompositeOperation = "source-over";
        for (let i = 0; i < 26; i++) { // lichtsnoer in een kegel
          const k = i / 26, yy = 70 + k * 420, half = 18 + k * 125, xx = sin(i * 2.4) * half;
          const pulse = 0.55 + 0.45 * sin(t * 4 + i * 0.9) * beat;
          ctx.globalAlpha = env * pulse;
          const im = SP.ok ? SP.glowOf(CANDY[i % 6]) : null; const r = (7 + 4 * pulse) * z;
          if (im) ctx.drawImage(im, gx + xx * z - r, gy - yy * z - r, r * 2, r * 2);
        }
        ctx.globalAlpha = 1;
      }
      // Zingende sneeuwpop: warme spot
      if (singer) {
        const X = sx(singer.x), Y = sy(0), z = V.z;
        if (standalone && A && typeof A.sprite === "function") { ctx.save(); ctx.translate(X, Y); try { A.sprite(ctx, "snowman", t, { scale: z * 1.1 }); } catch (e) { /* geen sprite */ } ctx.restore(); }
        ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.3 + 0.08 * sin(t * 3);
        const glow = SP.ok ? SP.glowOf("#ffe9a8") : null; const R = 170 * z;
        if (glow) ctx.drawImage(glow, X - R, Y - 60 * z - R, R * 2, R * 2);
        ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
      }
      // Schaatsbaan: koele ijsglans over de grond
      const sk = evs.schaatsbaan;
      if (sk) {
        const env = ss(0, 0.8, sk.t) * ss(sk.dur, sk.dur - 1, sk.t);
        const ice = overlay("ice" + (V.gy | 0), (x, w2, h2) => { const y0 = V.gy - 40 * V.z; const g = x.createLinearGradient(0, y0, 0, h2); g.addColorStop(0, "rgba(143,215,255,0)"); g.addColorStop(0.4, "rgba(143,215,255,.5)"); g.addColorStop(1, "rgba(80,160,255,.35)"); x.fillStyle = g; x.fillRect(0, y0, w2, h2 - y0); });
        blitOverlay(ctx, ice, env);
      }
      // kleine vallende sterren (achter de bomen)
      if (shooters.length) {
        for (const s of shooters) if (!s.big) drawShooter(ctx, s, t);
      }
      drawParticles(ctx, 0);
      ctx.restore();
    }

    function drawShooter(ctx, s, t) {
      const len = s.big ? 110 : 70 * s.size;
      const nx = s.vx, ny = s.vy, L = M.hypot(nx, ny) || 1;
      const tx = s.x - (nx / L) * len, ty = s.y - (ny / L) * len;
      const g = ctx.createLinearGradient(tx, ty, s.x, s.y); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, s.col);
      ctx.strokeStyle = g; ctx.lineWidth = s.big ? 5 : 2.5 * s.size; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(s.x, s.y); ctx.stroke();
      if (s.big) {
        const pulse = 1 + 0.12 * sin(t * 9);
        ctx.globalAlpha = 0.28 + 0.1 * sin(t * 9); // grote hit-halo: 'tik mij!'
        ctx.fillStyle = "#ffe9a8"; ctx.beginPath(); ctx.arc(s.x, s.y, 54 * pulse, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        const im = SP.ok ? SP.glowOf("#ffd14f") : null; if (im) ctx.drawImage(im, s.x - 46, s.y - 46, 92, 92);
        const st = SP.ok ? SP.starOf("#ffd14f") : null; const r = 24 * pulse;
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(t * 1.5);
        if (st) ctx.drawImage(st, -r, -r, r * 2, r * 2); else { ctx.fillStyle = "#ffd14f"; ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, TAU); ctx.fill(); }
        ctx.restore();
        // hint voor kinderen: TIK!
        if (s.t > 0.4) {
          const a = M.min(1, (s.t - 0.4) / 0.3), bob = sin(t * 6) * 3;
          ctx.save(); ctx.globalAlpha = a; ctx.translate(s.x, s.y + 62 + bob);
          ctx.fillStyle = "#3a2826"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-34, -15, 68, 30, 15) : ctx.rect(-34, -15, 68, 30); ctx.fill();
          ctx.fillStyle = "#ffd14f"; ctx.font = "900 17px system-ui, -apple-system, 'Segoe UI', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("TIK!", 0, 1);
          ctx.restore();
        }
      } else { const im = SP.ok ? SP.glowOf("#ffffff") : null; const r = 9 * s.size; if (im) ctx.drawImage(im, s.x - r, s.y - r, r * 2, r * 2); }
    }

    function drawFront(ctx, world) {
      if (destroyed || !ctx) return;
      if (world) setView(world);
      const w = V.w, h = V.h, t = tLocal, z = V.z;
      ctx.save();
      ctx.lineJoin = ctx.lineCap = "round";
      // slee + rendieren als silhouet voor de maan
      if (sleigh) drawSleigh(ctx, t);
      // snoepjes (wereld) — collectables
      for (const d of drops) {
        if (d.taken) continue;
        const X = sx(d.x), Y = sy(d.y); if (X < -40 || X > w + 40) continue;
        if (d.state === 1) ctx.globalAlpha = clamp(1 - (d.t - 0.9) / 0.5, 0, 1);
        const cy = Y - (d.cane ? 14 : 8) * z, sc = (d.cane ? 1.15 : 1.2) * z;
        if (SP.ok) { const set = d.cane ? SP.caneRot : SP.candyRot[d.c]; const im = set[d.state ? 0 : (((d.rot / TAU) * SP.ROT) % SP.ROT + SP.ROT) % SP.ROT | 0]; const dd = im.lw * sc; ctx.drawImage(im, X - dd / 2, cy - dd / 2, dd, dd); }
        else { ctx.fillStyle = CANDY[d.c]; ctx.beginPath(); ctx.arc(X, cy, 10 * z, 0, TAU); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
      if (chute && !chute.taken) drawChute(ctx, t);
      drawParticles(ctx, 1);
      drawBlooms(ctx);
      // ambient sneeuw
      if (flakes.length && !evs.sneeuwbol) { const im = SP.ok ? SP.snow : null; for (const f of flakes) { const X = f.x * w, Y = f.y * h; ctx.globalAlpha = f.a * 0.85; if (im) ctx.drawImage(im, X - f.s, Y - f.s, f.s * 2, f.s * 2); else { ctx.fillStyle = "#fff"; ctx.fillRect(X, Y, f.s, f.s); } } ctx.globalAlpha = 1; }
      // grote (tikbare) vallende sterren
      for (const s of shooters) if (s.big) drawShooter(ctx, s, t);
      // vuurwerk-namen
      for (const nm of names) drawName(ctx, nm);
      // tints & overlays
      const pk = evs.peperkoek;
      if (pk || sweep > 0) {
        if (pk) blitOverlay(ctx, vignette("warm", "255,150,120", 0, 0.3), ss(0, 1, pk.t) * ss(pk.dur, pk.dur - 1.2, pk.t)); // warme suikergloed
        if (sweep > 0 && sweep < 1) drawSweep(ctx, sweep, t);
      }
      const df = evs.droomflip;
      if (df && flipFlag) blitOverlay(ctx, vignette("droom", "120,80,200", 0, 0.38), 0.6 + 0.2 * sin(t * 3)); // dromerige paarse rand
      const rv = evs.rendiervlucht;
      if (rv) { // lichtstraal van boven
        const ray = overlay("ray", (x, w2, h2) => { const g = x.createLinearGradient(0, 0, 0, h2 * 0.8); g.addColorStop(0, "#ffe9a8"); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; x.fillRect(0, 0, w2, h2 * 0.8); });
        blitOverlay(ctx, ray, ss(0, 1, rv.t) * ss(rv.dur, rv.dur - 1, rv.t) * 0.14, "lighter");
      }
      const sk = evs.schaatsbaan;
      if (sk) blitOverlay(ctx, vignette("ijs", "160,220,255", 0, 0.32), ss(0, 0.8, sk.t) * ss(sk.dur, sk.dur - 1, sk.t)); // ijzige randen
      const sb = evs.sneeuwbol;
      if (sb) drawGlobe(ctx, sb, t);
      if (flash > 0) { ctx.globalAlpha = M.min(reduced ? 0.25 : 0.55, flash) * 0.9; ctx.fillStyle = flashCol; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
      ctx.restore();
    }

    function drawSweep(ctx, k, t) {
      const w = V.w, h = V.h;
      const y = lerp(-h * 0.2, h * 1.2, k), edge = ss(0, 0.5, k) * ss(1, 0.5, k) * 0.7 + 0.3;
      ctx.save();
      // glazuur-golf: roze → wit → doorzichtig, met een dikke donkere storybook-rand en druppels
      const g = ctx.createLinearGradient(0, y - h * 0.26, 0, y + 8); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.45, "rgba(255,245,250,.95)"); g.addColorStop(0.85, "#ffd6e4"); g.addColorStop(1, "#ffb3c6");
      const N = 10, edgePath = () => { ctx.beginPath(); for (let i = 0; i <= N; i++) { const x = (i / N) * w; const yy = y + sin(i * 2.1 + t * 3) * 10 + (i % 2 ? 26 : 0); if (i === 0) ctx.moveTo(x - 10, yy); else ctx.quadraticCurveTo(x - w / N / 2, yy + 22, x, yy); } };
      edgePath(); ctx.lineTo(w + 10, y - h * 0.35); ctx.lineTo(-10, y - h * 0.35); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.globalAlpha = edge; ctx.strokeStyle = "#8a4b2a"; ctx.lineWidth = 5; ctx.lineJoin = "round"; edgePath(); ctx.stroke();
      ctx.globalAlpha = 1;
      // druppels + sprenkels op de rand
      for (let i = 0; i <= N; i++) { const x = (i / N) * w - w / N / 2, yy = y + 22 + sin(i * 2.1 + t * 3) * 10 + ((i % 2) ? 26 : 0); ctx.fillStyle = "#ffd6e4"; ctx.strokeStyle = "#8a4b2a"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, yy + 10, 8, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = CANDY[i % 6]; ctx.beginPath(); ctx.arc(x + 16, yy - 14, 4, 0, TAU); ctx.fill(); ctx.fillStyle = CANDY[(i + 3) % 6]; ctx.beginPath(); ctx.arc(x - 14, yy - 22, 3.5, 0, TAU); ctx.fill(); }
      ctx.restore();
    }
    function drawGlobe(ctx, ev, t) {
      const w = V.w, h = V.h, env = ss(0, 0.4, ev.t) * ss(ev.dur, ev.dur - 1.2, ev.t);
      // glazen bol: rand + highlight (gecacht), plus een glans-streep die voorbij veegt (smalle rotated rect)
      const rim = overlay("globe", (x, w2, h2) => {
        x.globalAlpha = 0.55; x.strokeStyle = "#ffffff"; x.lineWidth = 14; x.beginPath(); x.ellipse(w2 / 2, h2 / 2, w2 * 0.56, h2 * 0.53, 0, 0, TAU); x.stroke();
        x.globalAlpha = 0.35; x.lineWidth = 26; x.strokeStyle = "#dfe9ff"; x.beginPath(); x.ellipse(w2 / 2, h2 / 2, w2 * 0.5, h2 * 0.48, 0, M.PI * 1.15, M.PI * 1.5); x.stroke();
      });
      blitOverlay(ctx, rim, env);
      const gk = (ev.t * 0.5) % 1;
      ctx.save(); ctx.globalAlpha = env * 0.16 * (1 - M.abs(gk - 0.5) * 2); ctx.translate(lerp(-w * 0.3, w * 1.3, gk), h / 2); ctx.rotate(-0.5); ctx.fillStyle = "#ffffff"; ctx.fillRect(-w * 0.1, -h, w * 0.2, h * 2); ctx.restore();
    }
    function drawName(ctx, nm) {
      const w = V.w, h = V.h, k = nm.t / 2.4, pop = ss(0, 0.25, k) * (1 + 0.15 * (1 - ss(0, 0.5, k)));
      const fs = M.round(clamp(M.min(w, h) * 0.13, 26, 64) * pop), a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.save(); ctx.globalAlpha = a; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `900 ${fs}px "Unbounded", system-ui, -apple-system, "Segoe UI", sans-serif`;
      const y = nm.y - k * 30;
      ctx.lineWidth = M.max(6, fs * 0.22); ctx.strokeStyle = "rgba(40,20,60,.85)"; ctx.strokeText(nm.txt, nm.x, y);
      ctx.fillStyle = nm.col; ctx.fillText(nm.txt, nm.x, y);
      ctx.globalAlpha = a * 0.7; ctx.fillStyle = "#ffffff"; ctx.font = `900 ${M.round(fs * 0.9)}px "Unbounded", system-ui, -apple-system, "Segoe UI", sans-serif`; ctx.fillText(nm.txt, nm.x, y - fs * 0.04);
      ctx.restore();
    }
    function drawSleigh(ctx, t) {
      const w = V.w, h = V.h, k = clamp(sleigh.t / sleigh.dur, 0, 1);
      let mx = w * 0.8, my = h * 0.14;
      if (A && typeof A.moonAt === "function") { try { const m = A.moonAt(w, h); if (m) { mx = m.x; my = m.y; } } catch (e) { /* standaard */ } }
      const x = lerp(w + 160, -260, k), y = my + 10 + sin(k * TAU * 1.5) * 14 + (x - mx) * 0.08;
      const s = clamp(w / 390, 0.8, 1.6) * 0.9;
      // sterrenstof-spoor
      if (rng() < 0.9) { const p = spawn(K.SPARK, x + 110 * s, y + 6 + rnd(-6, 6), 1); p.vx = 40; p.vy = rnd(10, 40); p.life = rnd(0.5, 1.1); p.size = rnd(4, 9); p.col = pick(["#ffd14f", "#ffe9a8", "#ffffff"]); }
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      const sil = "#1a1340";
      ctx.fillStyle = sil; ctx.strokeStyle = sil; ctx.lineWidth = 3; ctx.lineCap = "round";
      // slee
      ctx.beginPath(); ctx.moveTo(70, -2); ctx.quadraticCurveTo(110, -4, 118, -28); ctx.quadraticCurveTo(100, -20, 100, -6); ctx.lineTo(96, -22); ctx.lineTo(74, -22); ctx.quadraticCurveTo(60, -22, 62, -4); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(56, 6); ctx.quadraticCurveTo(90, 10, 124, 2); ctx.stroke(); // glij-ijzer
      // kerstman (bolletje + muts)
      ctx.beginPath(); ctx.arc(84, -30, 9, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.moveTo(76, -34); ctx.lineTo(90, -48); ctx.lineTo(93, -32); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#e8465a"; ctx.beginPath(); ctx.arc(91, -48, 3, 0, TAU); ctx.fill(); ctx.fillStyle = sil;
      // zak met cadeaus
      ctx.beginPath(); ctx.ellipse(104, -30, 11, 9, 0.3, 0, TAU); ctx.fill();
      // teugels
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(70, -14); ctx.quadraticCurveTo(20, -24, -40, -16); ctx.stroke(); ctx.lineWidth = 3;
      // 3 rendieren
      for (let i = 0; i < 3; i++) {
        const rx = 30 - i * 54, leg = sin(t * 9 + i) * 8;
        ctx.save(); ctx.translate(rx, -14);
        ctx.beginPath(); ctx.ellipse(0, 0, 17, 8, 0, 0, TAU); ctx.fill();            // lijf
        ctx.beginPath(); ctx.ellipse(-20, -9, 7, 5.5, -0.5, 0, TAU); ctx.fill();     // kop
        ctx.beginPath(); ctx.moveTo(-10, 5); ctx.lineTo(-14 + leg, 20); ctx.moveTo(-4, 6); ctx.lineTo(-4 - leg, 20); ctx.moveTo(8, 5); ctx.lineTo(12 + leg, 19); ctx.moveTo(14, 4); ctx.lineTo(16 - leg, 18); ctx.stroke(); // benen
        ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-22, -13); ctx.lineTo(-27, -26); ctx.moveTo(-25, -20); ctx.lineTo(-31, -22); ctx.moveTo(-19, -14); ctx.lineTo(-16, -26); ctx.moveTo(-17, -20); ctx.lineTo(-12, -24); ctx.stroke(); ctx.lineWidth = 3; // gewei
        ctx.beginPath(); ctx.moveTo(16, -2); ctx.lineTo(24, -8); ctx.stroke(); // staartje
        if (i === 2) { ctx.fillStyle = "#ff4d4d"; ctx.globalAlpha = 0.7 + 0.3 * sin(t * 8); ctx.beginPath(); ctx.arc(-27, -8, 3.2, 0, TAU); ctx.fill(); const im = SP.ok ? SP.glowOf("#ff6b8a") : null; if (im) ctx.drawImage(im, -37, -18, 20, 20); ctx.globalAlpha = 1; ctx.fillStyle = sil; }
        ctx.restore();
      }
      ctx.restore();
    }
    function drawChute(ctx, t) {
      const X = sx(chute.x), Y = sy(chute.y), z = V.z;
      if (X < -80 || X > V.w + 80) return;
      ctx.save(); ctx.translate(X, Y); ctx.rotate(chute.landed ? 0 : chute.sway); ctx.scale(z, z);
      if (!chute.landed) {
        ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-14, -16); ctx.lineTo(-40, -66); ctx.moveTo(14, -16); ctx.lineTo(40, -66); ctx.moveTo(0, -18); ctx.lineTo(0, -70); ctx.stroke();
        ctx.fillStyle = "#e8465a"; ctx.strokeStyle = "#3a2826"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-48, -66); ctx.quadraticCurveTo(0, -130, 48, -66); ctx.quadraticCurveTo(32, -58, 16, -66); ctx.quadraticCurveTo(0, -58, -16, -66); ctx.quadraticCurveTo(-32, -58, -48, -66); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.moveTo(-16, -66); ctx.quadraticCurveTo(-8, -118, 0, -120); ctx.quadraticCurveTo(8, -118, 16, -66); ctx.quadraticCurveTo(0, -58, -16, -66); ctx.fill();
      }
      ctx.globalAlpha = 0.25; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(0, chute.y + 2, 22, 6, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; // schaduw op de grond
      let drawn = false;
      if (A && typeof A.sprite === "function") { try { A.sprite(ctx, "gift", t, { scale: 1.1 }); drawn = true; } catch (e) { drawn = false; } }
      if (!drawn && SP.ok) ctx.drawImage(SP.gift, -16, -16, 32, 32);
      const halo = 0.25 + 0.15 * sin(t * 6); ctx.globalAlpha = halo; const im = SP.ok ? SP.glowOf("#ffd14f") : null; if (im) ctx.drawImage(im, -40, -40, 80, 80);
      ctx.restore();
    }

    // ---------- publieke extra's ----------
    function hitTest(x, y) {
      if (destroyed) return null;
      let best = null, bd = 1e9;
      for (const s of shooters) { if (!s.big || s.caught) continue; const d = M.hypot(s.x - x, s.y - y); if (d < 60 && d < bd) { best = s; bd = d; } }
      if (!best) return null;
      best.caught = true;
      for (let i = 0; i < n(26); i++) { const p = spawn(K.SPARK, best.x, best.y, 1); const a = rng() * TAU, v = rnd(80, 320); p.vx = cos(a) * v; p.vy = sin(a) * v; p.drag = 1.8; p.life = rnd(0.5, 1.1); p.size = rnd(6, 14); p.col = pick(["#ffd14f", "#ffe9a8", "#ffffff", "#ff8ad6"]); }
      for (let i = 0; i < n(7); i++) { const p = spawn(K.STAR, best.x, best.y, 1); const a = rng() * TAU; p.vx = cos(a) * 200; p.vy = sin(a) * 200 - 80; p.g = 420; p.life = 1.2; p.size = rnd(12, 20); p.vr = rnd(-6, 6); p.col = "#ffd14f"; }
      const r = spawn(K.RING, best.x, best.y, 1); r.size = 160; r.life = 0.6; r.col = "#ffe9a8";
      flashCol = "#ffe9a8"; flash = M.max(flash, 0.3);
      return { wish: true, stars: WISH, x: best.x, y: best.y };
    }
    function collectables() {
      colOut.length = 0;
      for (const d of drops) if (!d.taken && (d.state === 0 || d.t < 0.9)) colOut.push(d.api || (d.api = { id: d.id, kind: "candy", get x() { return d.x; }, get y() { return d.y; }, r: d.r, take() { takeDrop(d); } }));
      if (chute && !chute.taken) colOut.push(chute.api || (chute.api = { id: chute.id, kind: "gift", get x() { return chute.x; }, get y() { return chute.y; }, r: chute.r, take() { chute.taken = true; burst("confetti", chute.x, chute.y, 18); chute = null; } }));
      return colOut;
    }
    function destroy() { destroyed = true; count = 0; drops.length = 0; shooters.length = 0; rockets.length = 0; blooms.length = 0; names.length = 0; OV.clear(); for (const k in evs) delete evs[k]; chute = sleigh = giant = singer = null; }

    const fx = {
      trigger, update, drawBack, drawFront, burst, hitTest, collectables, destroy,
      active(id) { const ev = evs[id]; return ev ? clamp(ev.k, 0, 1) : 0; },
      get events() { return activeIds; },
      get wishes() { const out = []; for (const s of shooters) if (s.big && !s.caught) out.push({ x: s.x, y: s.y, r: 60 }); return out; }, // tikbare sterren (canvas-px)
      get shake() { return shakeOut; },
      get theme() { return themeTarget; },
      get themeMix() { return themeMix; },
      get themeFrom() { return themeFrom; },
      get gravityFlip() { return flipFlag; },
      get particleCount() { return count; },
      get reducedMotion() { return reduced; },
      set reducedMotion(v) { reduced = !!v; },
      get canvas() { return canvas || null; },
    };
    return fx;
  }

  return { create, EVENTS, EVENT_IDS, CANDY, WISH, version: "1.0.0" };
});
