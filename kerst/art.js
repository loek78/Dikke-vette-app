/*! kerst/art.js — KerstArt: procedural storybook vector art for KERSTDROOM (Vlok & friends). No deps, no assets.
 * UMD-light: browser global `window.KerstArt` + CommonJS `module.exports`. DOM access only inside functions,
 * so Node can require() it for tests (pre()/blit()/background() need a canvas and are browser-only).
 *
 * Coordinates are logical px at scale 1; the caller sets the ctx transform for camera / DPR.
 *
 *   KerstArt.ANIMALS = ["hert","konijn","vos","uil"]   KerstArt.NAMES = { hert:"Vlok", konijn:"Pluis", vos:"Snuf", uil:"Oeki" }
 *   KerstArt.animal(ctx, kind, anim, t, opts)
 *       FEET at (0,0), facing right (+x), ~100 px tall at scale 1. anim ∈ idle run jump fall slide stumble fly happy,
 *       t = seconds (drives run cycle, blinks, ear wiggles). opts { scale=1, facing=1|-1, hat=null|"kerstmuts", alpha=1, blush=false }
 *   KerstArt.animalBox(kind, anim) → { x, y, w, h }   bounding box relative to the feet (reused object) — hitbox hint
 *   KerstArt.sprite(ctx, name, t, opts)   opts { scale=1, alpha=1, facing=1, theme="nacht", variant=0, lit=true, wink=false }
 *       names: tree1 tree2 tree3 giantTree house log icicles snowman gift candyCane star bell moon sleigh pondTile groundTile
 *              gingerGroundTile bauble pinecone signpost snowdrift
 *       anchors (also in sizes[name].anchor):
 *         "base"    base/feet at (0,0), sprite extends upward:  tree1 tree2 tree3 giantTree house log snowman signpost snowdrift
 *         "center"  centred on (0,0):                           gift candyCane star bell moon sleigh bauble pinecone icicles
 *         "topleft" tiles: (0,0) = top-left, surface at y=0, extends right w / down h:  groundTile gingerGroundTile pondTile
 *   KerstArt.sizes[name] = { w, h, anchor }   logical size at scale 1 (use for hitboxes)
 *   KerstArt.background(ctx, layer, scrollX, w, h, t, theme)
 *       paints parallax layer 0 (sky) … 4 (near ground deco) for a w×h viewport; scrollX is already multiplied by the
 *       layer's parallax factor by the caller; theme ∈ "nacht" | "aurora" | "peperkoek".
 *       Ground line: y = KerstArt.groundY(h) = KerstArt.groundPx ?? h * KerstArt.horizon (horizon default .74).
 *   KerstArt.moonAt(w, h) → { x, y, r }   where layer 0 paints the moon (reused object; for the tap-the-moon secret)
 *   KerstArt.moonWink = true             the moon in layer 0 winks (Geheimpje); sprite "moon" takes opts.wink
 *   KerstArt.pre(name, scale, opts) → HTMLCanvasElement   cached static render (t = 0, lights off); .ox/.oy = anchor
 *       offset in canvas px, .scale; draw with ctx.drawImage(c, x - c.ox, y - c.oy). Null in Node (no DOM).
 *   KerstArt.blit(ctx, name, x, y, scale, opts)   draws pre(name, scale*KerstArt.dpr) crisp at (x,y) in CSS px,
 *       assuming the ctx transform already includes the DPR (set KerstArt.dpr to the game's DPR).
 *   KerstArt.dpr (default min(2, devicePixelRatio))   KerstArt.clearCache()   KerstArt.THEMES   KerstArt.ANIMS
 *   KerstArt.SPRITE_NAMES   KerstArt.hash(i, j) → 0..1 deterministic
 *
 * Everything draws relative to the current transform (never setTransform/clearRect on the caller's ctx), so the game can
 * mirror the world for the Droomflip. globalAlpha of the caller is respected and restored; nothing allocates per frame
 * except the cached offscreen canvases created on first use.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KerstArt = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const M = Math, TAU = M.PI * 2, PI = M.PI, sin = M.sin, cos = M.cos, abs = M.abs, max = M.max, min = M.min;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, k) => a + (b - a) * k;
  const ss = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  // deterministic hash → 0..1 (same on every phone, used for background placement)
  function hash(i, j) {
    let x = (i * 374761393 + (j | 0) * 668265263 + 1274126177) | 0;
    x = ((x ^ (x >>> 13)) * 1274126177) | 0; x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }
  const EMPTY = [];
  const NOOPTS = {};

  // ---------- palette ----------
  const OUT = "#3a2826";          // warm dark outline
  const OUT_ICE = "#5f8fc4";      // outline for ice / snow things
  const SNOW = "#fbfdff", SNOW2 = "#dfe9ff", SNOW3 = "#b9c9f0";
  const GOLD = "#ffd14f", GOLD2 = "#f2a83a", RED = "#d9383f", RED2 = "#f06a6a", GREEN = "#2f8f5b", GREEN2 = "#246f45", GREEN3 = "#49b075";
  const CANDY = ["#e8465a", "#ffd14f", "#4fa3e8", "#9b6be8", "#4fcf9f", "#ff8ad6"];
  const LW = 2.4;

  const THEMES = ["nacht", "aurora", "peperkoek"];
  const TH = {
    nacht: {
      sky: ["#070d2a", "#182666", "#3b4a9a", "#8d86cc", "#c9a6dc"],
      hillFar: "#9db1e8", hillNear: "#7d93d9", hillSnow: "#eef3ff", mist: "rgba(160,180,235,",
      forest: "#2a3a7c", forest2: "#344a92", near: ["#2f8f5b", "#246f45", "#49b075"], moundTop: "#f7faff", mound: "#dfe9ff",
      bush: "#2b6a48", star: "#fff6d8", cloud: "rgba(190,200,255,.08)"
    },
    aurora: {
      sky: ["#04101f", "#0b2a46", "#1e4f72", "#5d8bb0", "#9fc3cf"],
      hillFar: "#9fc2e6", hillNear: "#7ea7d2", hillSnow: "#eefaff", mist: "rgba(150,210,220,",
      forest: "#173a56", forest2: "#1f4b6a", near: ["#2f8f5b", "#246f45", "#49b075"], moundTop: "#f6fdff", mound: "#d8f0f5",
      bush: "#255f4f", star: "#eafff6", cloud: "rgba(170,230,230,.08)"
    },
    peperkoek: {
      sky: ["#f9c1d5", "#fbd5dc", "#fde6cf", "#ffe9c2", "#ffd9ad"],
      hillFar: "#d9a06a", hillNear: "#c4844a", hillSnow: "#fff7ee", mist: "rgba(255,230,210,",
      forest: "#d98fae", forest2: "#9fd3c0", near: ["#7fd9bf", "#f3a0c6", "#ffd27a"], moundTop: "#fffaf3", mound: "#ffeedd",
      bush: "#e86a8a", star: "#ffffff", cloud: "rgba(255,255,255,.55)"
    }
  };

  // ---------- tiny drawing helpers (no allocations) ----------
  function ell(ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }
  function circ(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
  function fillOut(ctx, fill, out, lw) {
    ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = out || OUT; ctx.lineWidth = lw || LW; ctx.stroke();
  }
  function fillOnly(ctx, fill) { ctx.fillStyle = fill; ctx.fill(); }
  function dot(ctx, x, y, r, col) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = col; ctx.fill(); }
  function rr(ctx, x, y, w, h, r) {
    r = min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function line(ctx, x0, y0, x1, y1, col, w) {
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
  }
  // 4-point sparkle (twinkle glint)
  function glint(ctx, x, y, r, col, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0);
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.quadraticCurveTo(0, 0, r, 0); ctx.quadraticCurveTo(0, 0, 0, r);
    ctx.quadraticCurveTo(0, 0, -r, 0); ctx.quadraticCurveTo(0, 0, 0, -r); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.restore();
  }
  // 5-point star path (unit radius), outer r, inner r*.47
  function starPath(ctx, x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (rot || 0) - PI / 2 + i * PI / 5, rad = i % 2 ? r * .47 : r;
      if (i) ctx.lineTo(x + cos(a) * rad, y + sin(a) * rad); else ctx.moveTo(x + cos(a) * rad, y + sin(a) * rad);
    }
    ctx.closePath();
  }
  // scalloped bottom edge from (x0,y) to (x1,y) with n bumps of depth d (used for snow caps / icing)
  function scallops(ctx, x0, x1, y, n, d) {
    const w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) ctx.quadraticCurveTo(x0 + w * (i + .5), y + d, x0 + w * (i + 1), y);
  }
  // cached gradients (CanvasGradient is not bound to a context, so one object serves all canvases)
  const GRADS = new Map();
  function grad(ctx, key, make) { let g = GRADS.get(key); if (!g) { g = make(ctx); GRADS.set(key, g); } return g; }
  // cached soft glow images (radial falloff) — far cheaper than a radial gradient fill per sprite per frame
  const GLOWS = new Map();
  function glowImg(key, rgb) {
    let c = GLOWS.get(key);
    if (c || typeof document === "undefined") return c || null;
    c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), gg = g.createRadialGradient(32, 32, 3, 32, 32, 32);
    gg.addColorStop(0, "rgba(" + rgb + ",.75)"); gg.addColorStop(.35, "rgba(" + rgb + ",.3)"); gg.addColorStop(1, "rgba(" + rgb + ",0)");
    g.fillStyle = gg; g.fillRect(0, 0, 64, 64); GLOWS.set(key, c); return c;
  }
  function glow(ctx, x, y, r, key, rgb, a) {
    const im = glowImg(key, rgb); if (!im) return;
    if (a != null) ctx.globalAlpha *= a;
    ctx.drawImage(im, x - r, y - r, r * 2, r * 2);
    if (a != null) ctx.globalAlpha /= a;
  }

  // ---------- face parts ----------
  const EYE_OPEN = 0, EYE_BLINK = 1, EYE_HAPPY = 2, EYE_DIZZY = 3, EYE_WIDE = 4;
  function eye(ctx, x, y, r, st, col) {
    col = col || "#2a1a1a";
    if (st === EYE_BLINK) {
      ctx.beginPath(); ctx.arc(x, y - r * .5, r, PI * .2, PI * .8); ctx.strokeStyle = col; ctx.lineWidth = r * .55; ctx.lineCap = "round"; ctx.stroke();
    } else if (st === EYE_HAPPY) {
      ctx.beginPath(); ctx.arc(x, y + r * .55, r * .95, PI * 1.18, PI * 1.82); ctx.strokeStyle = col; ctx.lineWidth = r * .6; ctx.lineCap = "round"; ctx.stroke();
    } else if (st === EYE_DIZZY) {
      ctx.beginPath();
      for (let k = 0; k <= 26; k++) { const a = k * .42, rad = r * 1.05 * k / 26; const px = x + cos(a) * rad, py = y + sin(a) * rad; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.strokeStyle = col; ctx.lineWidth = r * .32; ctx.lineCap = "round"; ctx.stroke();
    } else {
      const rr2 = st === EYE_WIDE ? r * 1.18 : r;
      dot(ctx, x, y, rr2, col);
      dot(ctx, x - rr2 * .32, y - rr2 * .34, rr2 * .4, "#ffffff");
      dot(ctx, x + rr2 * .3, y + rr2 * .3, rr2 * .16, "#ffffff");
    }
  }
  const MOUTH_SMILE = 0, MOUTH_BIG = 1, MOUTH_O = 2, MOUTH_TONGUE = 3;
  function mouth(ctx, x, y, w, st, col) {
    col = col || OUT;
    if (st === MOUTH_BIG || st === MOUTH_TONGUE) {
      ctx.beginPath(); ctx.arc(x, y, w, 0.05, PI - 0.05); ctx.closePath(); fillOut(ctx, "#6e2a33", col, w * .22);
      dot(ctx, x + (st === MOUTH_TONGUE ? w * .3 : 0), y + w * .55, w * .45, "#f28ca0");
    } else if (st === MOUTH_O) {
      ell(ctx, x, y, w * .55, w * .7); fillOut(ctx, "#6e2a33", col, w * .22);
    } else {
      ctx.beginPath(); ctx.arc(x, y - w * .3, w, PI * .25, PI * .75); ctx.strokeStyle = col; ctx.lineWidth = w * .3; ctx.lineCap = "round"; ctx.stroke();
    }
  }
  function blush(ctx, x, y, r, k) {
    ctx.globalAlpha *= .35 + .4 * k; dot(ctx, x, y, r, "#f58fa1"); ctx.globalAlpha /= .35 + .4 * k;
  }
  // leaf / ear shape pointing up from (x,y), rotated by ang
  function ear(ctx, x, y, len, w, ang, col, inner, out) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-w, -len * .35, -w * .7, -len * 1.05, 0, -len);
    ctx.bezierCurveTo(w * .7, -len * 1.05, w, -len * .35, 0, 0); ctx.closePath(); fillOut(ctx, col, out);
    ctx.beginPath(); ctx.moveTo(0, -len * .12); ctx.bezierCurveTo(-w * .5, -len * .35, -w * .35, -len * .85, 0, -len * .82);
    ctx.bezierCurveTo(w * .35, -len * .85, w * .5, -len * .35, 0, -len * .12); ctx.closePath(); fillOnly(ctx, inner);
    ctx.restore();
  }
  // Santa hat on a head of radius r (head-local coords, head centre at 0,0). flop = bobble sway (-1..1)
  function kerstmuts(ctx, r, flop) {
    r *= 1.1;
    const tipx = -r * 1.4 + flop * r * .22, tipy = -r * 1.7 + abs(flop) * r * .1;
    ctx.beginPath(); ctx.moveTo(-r * 1.02, -r * .42);
    ctx.quadraticCurveTo(-r * .7, -r * 1.6, tipx, tipy);
    ctx.quadraticCurveTo(r * .2, -r * 1.55, r * 1.02, -r * .42); ctx.closePath(); fillOut(ctx, RED);
    ell(ctx, -r * .1, -r * 1.0, r * .32, r * .2, -.4); ctx.globalAlpha *= .35; fillOnly(ctx, "#ffffff"); ctx.globalAlpha /= .35;
    rr(ctx, -r * 1.16, -r * .68, r * 2.32, r * .5, r * .25); fillOut(ctx, "#ffffff");
    circ(ctx, tipx, tipy, r * .32); fillOut(ctx, "#ffffff");
  }
  // knitted beanie (Oeki) — teal with pink stripes + bobble
  function muts(ctx, r, flop) {
    ctx.beginPath(); ctx.moveTo(-r * 1.0, -r * .5); ctx.quadraticCurveTo(-r * .95, -r * 1.75, 0, -r * 1.78);
    ctx.quadraticCurveTo(r * .95, -r * 1.75, r * 1.0, -r * .5); ctx.closePath(); fillOut(ctx, "#3fb3a3");
    ctx.save(); ctx.beginPath(); ctx.moveTo(-r * 1.0, -r * .5); ctx.quadraticCurveTo(-r * .95, -r * 1.75, 0, -r * 1.78);
    ctx.quadraticCurveTo(r * .95, -r * 1.75, r * 1.0, -r * .5); ctx.closePath(); ctx.clip();
    ctx.fillStyle = "#f28bb0"; ctx.fillRect(-r * 1.1, -r * 1.3, r * 2.2, r * .18); ctx.fillRect(-r * 1.1, -r * .95, r * 2.2, r * .18);
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.fillRect(-r * 1.1, -r * 1.55, r * 2.2, r * .1);
    ctx.restore();
    rr(ctx, -r * 1.1, -r * .72, r * 2.2, r * .4, r * .12); fillOut(ctx, "#f6e7c8");
    // ribbing on the brim
    ctx.strokeStyle = "rgba(90,60,40,.35)"; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = -4; i <= 4; i++) { ctx.moveTo(i * r * .24, -r * .7); ctx.lineTo(i * r * .24, -r * .34); } ctx.stroke();
    circ(ctx, flop * r * .15, -r * 1.85, r * .26); fillOut(ctx, "#f6e7c8");
  }

  // ---------- animal pose ----------
  // Shared pose record (mutated per call; never allocated per frame)
  const P = {
    bob: 0, tilt: 0, sx: 1, sy: 1, fx: [0, 0, 0, 0], fy: [0, 0, 0, 0],
    earL: 0, earR: 0, tail: 0, hx: 0, hy: 0, hrot: 0, eye: 0, mouth: 0, blush: 0, wing: 0, tuck: 0, lying: 0, flop: 0
  };
  const HX = [0, 0, 0, 0], HY = [0, 0, 0, 0];
  function resetPose() {
    P.bob = 0; P.tilt = 0; P.sx = 1; P.sy = 1; P.earL = 0; P.earR = 0; P.tail = 0; P.hx = 0; P.hy = 0; P.hrot = 0;
    P.eye = EYE_OPEN; P.mouth = MOUTH_SMILE; P.blush = 0; P.wing = 0; P.tuck = 0; P.lying = 0; P.flop = 0;
  }
  // Quadruped pose. S = animal spec (geometry + cycle params). Legs: 0 front near, 1 front far, 2 back near, 3 back far.
  function poseQuad(anim, t, S) {
    resetPose();
    const p = P, blink = ((t + S.ph0) % 3.9) < 0.12;
    for (let i = 0; i < 4; i++) { p.fx[i] = S.foot[i]; p.fy[i] = -2; }
    switch (anim) {
      case "run": {
        const ph = t * TAU / S.per;
        for (let i = 0; i < 4; i++) {
          const q = ph + S.off[i];
          p.fx[i] = S.foot[i] - S.stride * cos(q); p.fy[i] = -2 - S.lift * max(0, sin(q));
        }
        p.bob = -2.2 + 2.8 * S.bounce * sin(ph + 1.3); p.tilt = .07 * sin(ph + .5);
        p.sx = 1 + .03 * sin(ph); p.sy = 1 - .025 * sin(ph);
        p.earL = -.6 + .14 * sin(ph * 2); p.earR = -.48 + .14 * sin(ph * 2 + 1);
        p.tail = .55 + .3 * sin(ph * 2); p.hrot = -.06; p.eye = blink ? EYE_BLINK : EYE_OPEN; p.mouth = MOUTH_SMILE; p.flop = sin(ph);
        break;
      }
      case "jump": {
        const f = sin(t * 9);
        p.tilt = -.3; p.sy = 1.09; p.sx = .94;
        p.fx[0] = S.foot[0] + 12; p.fy[0] = -28; p.fx[1] = S.foot[1] + 8; p.fy[1] = -24;
        p.fx[2] = S.foot[2] - 16; p.fy[2] = -12; p.fx[3] = S.foot[3] - 12; p.fy[3] = -16;
        p.earL = -.55 + .08 * f; p.earR = -.4 + .08 * f; p.tail = .8; p.eye = EYE_WIDE; p.mouth = MOUTH_BIG; p.hrot = -.12; p.flop = -.8;
        break;
      }
      case "fall": {
        const f = sin(t * 14);
        p.tilt = .17; p.sy = .96; p.sx = 1.04;
        p.fx[0] = S.foot[0] + 8; p.fy[0] = -8; p.fx[1] = S.foot[1] + 4; p.fy[1] = -12;
        p.fx[2] = S.foot[2] - 4; p.fy[2] = -18; p.fx[3] = S.foot[3] - 8; p.fy[3] = -14;
        p.earL = .55 + .15 * f; p.earR = .45 - .15 * f; p.tail = .9; p.eye = EYE_WIDE; p.mouth = MOUTH_O; p.hrot = .1; p.flop = .9;
        break;
      }
      case "slide": {
        p.lying = 1; p.bob = S.lieDrop; p.tilt = -.1; p.sx = 1.08; p.sy = .9;
        p.fx[0] = S.foot[0] + 34; p.fy[0] = -3; p.fx[1] = S.foot[1] + 28; p.fy[1] = -4;
        p.fx[2] = S.foot[2] - 30; p.fy[2] = -3; p.fx[3] = S.foot[3] - 26; p.fy[3] = -4;
        p.hx = S.lieHead[0]; p.hy = S.lieHead[1]; p.hrot = -.22;
        p.earL = -1.05; p.earR = -.95; p.tail = .9; p.eye = EYE_HAPPY; p.mouth = MOUTH_BIG; p.flop = -1;
        break;
      }
      case "stumble": {
        const w = sin(t * 21);
        p.tilt = .52 + .06 * w; p.bob = 7;
        p.fx[0] = S.foot[0] + 16; p.fy[0] = -5; p.fx[1] = S.foot[1] + 4; p.fy[1] = -16 + 3 * w;
        p.fx[2] = S.foot[2] - 10; p.fy[2] = -3; p.fx[3] = S.foot[3] - 24; p.fy[3] = -12 - 3 * w;
        p.earL = -1.1 + .2 * w; p.earR = .9 - .2 * w; p.tail = -.7; p.eye = EYE_DIZZY; p.mouth = MOUTH_TONGUE; p.hrot = .3; p.flop = w;
        break;
      }
      case "fly": {
        const f = sin(t * TAU * 1.7);
        p.tilt = -.14; p.bob = -3 + 2 * f; p.tuck = 1; p.wing = f;
        for (let i = 0; i < 4; i++) { p.fx[i] = S.hip[i * 2] + (i < 2 ? 4 : -4); p.fy[i] = S.hip[i * 2 + 1] + 20; }
        p.earL = -.1 + .55 * f; p.earR = .05 + .55 * f; p.tail = .7; p.eye = EYE_HAPPY; p.mouth = MOUTH_BIG; p.hrot = -.1; p.flop = f;
        break;
      }
      case "happy": {
        const h = abs(sin(t * TAU / .62));
        p.bob = -10 * h * S.spring; p.sx = 1 - .05 * h; p.sy = 1 + .07 * h;
        for (let i = 0; i < 4; i++) { p.fy[i] = -2 + p.bob * .85; p.fx[i] += (i < 2 ? 1 : -1) * 2 * h; }
        p.earL = .3 * sin(t * 14); p.earR = -.3 * sin(t * 14); p.tail = .7 * sin(t * 17);
        p.eye = EYE_HAPPY; p.mouth = MOUTH_BIG; p.blush = 1; p.hrot = -.14 + .08 * sin(t * 7); p.flop = sin(t * 8);
        break;
      }
      default: { // idle: breathing, wobbly legs, ear wiggle, tail wag, blink
        const b = sin(t * 2.1);
        p.bob = b * 1.3; p.sy = 1 + .013 * b; p.sx = 1 - .007 * b;
        for (let i = 0; i < 4; i++) p.fx[i] += sin(t * 7 + i * 1.7) * .7;
        const e = (t + S.ph0 * 3) % 2.7, env = e < .45 ? sin(e / .45 * PI) : 0;
        p.earR = .35 * sin(t * 26) * env; p.earL = .15 * sin(t * 26 + 1) * env;
        p.tail = .4 * sin(t * 5.5); p.hrot = .07 * sin(t * .8); p.hy = .8 * sin(t * 2.1 + 1);
        p.eye = blink ? EYE_BLINK : EYE_OPEN; p.flop = .3 * b;
      }
    }
  }
  // 2-segment leg with IK knee (dir -1 = knee forward, +1 = hock backward), tapered, outlined, with hoof/paw
  function leg(ctx, hx, hy, fx, fy, S, i, far) {
    let dx = fx - hx, dy = fy - hy, d = M.hypot(dx, dy) || .001;
    const L1 = S.L1, L2 = S.L2, maxd = L1 + L2 - .6, mind = abs(L1 - L2) + 1;
    if (d > maxd) { const s = maxd / d; dx *= s; dy *= s; d = maxd; fx = hx + dx; fy = hy + dy; }
    else if (d < mind) { const s = mind / d; dx *= s; dy *= s; d = mind; fx = hx + dx; fy = hy + dy; }
    const a = M.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const ka = M.atan2(dy, dx) + S.dir[i] * a, kx = hx + cos(ka) * L1, ky = hy + sin(ka) * L1;
    const w1 = S.legW[0], w2 = S.legW[1];
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = OUT;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineWidth = w1 + LW * 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.lineWidth = w2 + LW * 2; ctx.stroke();
    ctx.strokeStyle = far ? S.col.shade : S.col.leg || S.col.body;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.lineWidth = w1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.lineWidth = w2; ctx.stroke();
    // hoof / sock / paw
    if (S.hoof) { ell(ctx, fx + .5, fy - .5, w2 * .78, w2 * .6, 0); fillOut(ctx, far ? S.col.hoofShade || S.col.hoof : S.col.hoof, OUT, 1.6); }
    else if (S.hindFoot && i >= 2) { ell(ctx, fx + S.hindFoot[2], fy, S.hindFoot[0], S.hindFoot[1], 0); fillOut(ctx, far ? S.col.shade : S.col.paw || S.col.body, OUT, 1.6); }
    else if (S.paw) { ell(ctx, fx + 1.5, fy, w2 * 1.05, w2 * .72, 0); fillOut(ctx, far ? S.col.shade : S.col.paw || S.col.body, OUT, 1.6); }
  }
  // body transform for the current pose, applied around S.pivot
  function bodyXf(ctx, S) {
    const px = S.pivot[0], py = S.pivot[1];
    ctx.translate(px, py + P.bob); ctx.rotate(P.tilt); ctx.scale(P.sx, P.sy); ctx.translate(-px, -py);
  }
  function hipsWorld(S) {
    const px = S.pivot[0], py = S.pivot[1], c = cos(P.tilt), s = sin(P.tilt);
    for (let i = 0; i < 4; i++) {
      const lx = (S.hip[i * 2] - px) * P.sx, ly = (S.hip[i * 2 + 1] - py) * P.sy;
      HX[i] = px + lx * c - ly * s; HY[i] = py + lx * s + ly * c + P.bob;
    }
  }
  function drawQuad(ctx, t, o, S, anim) {
    poseQuad(anim, t, S); hipsWorld(S);
    leg(ctx, HX[1], HY[1], P.fx[1], P.fy[1], S, 1, true);
    leg(ctx, HX[3], HY[3], P.fx[3], P.fy[3], S, 3, true);
    ctx.save(); bodyXf(ctx, S);
    S.tail(ctx, P, t);
    ell(ctx, S.body.x, S.body.y, S.body.rx, S.body.ry, S.body.rot); fillOut(ctx, S.col.body);
    // soft shade under belly + highlight on back (inset, so no clipping needed); skipped for see-through ghosts
    if (!(o.alpha < 1)) {
      ctx.globalAlpha *= .22; ell(ctx, S.body.x - 2, S.body.y + S.body.ry * .45, S.body.rx * .72, S.body.ry * .38, S.body.rot); fillOnly(ctx, S.col.shade);
      ell(ctx, S.body.x - 3, S.body.y - S.body.ry * .42, S.body.rx * .55, S.body.ry * .3, S.body.rot); fillOnly(ctx, "#ffffff"); ctx.globalAlpha /= .22;
    }
    S.marks(ctx, P, t);
    S.head(ctx, P, t, o);
    ctx.restore();
    leg(ctx, HX[0], HY[0], P.fx[0], P.fy[0], S, 0, false);
    leg(ctx, HX[2], HY[2], P.fx[2], P.fy[2], S, 2, false);
  }
  // neck as a thick outlined stroke from body point to head centre
  function neck(ctx, x0, y0, x1, y1, w, col) {
    ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.strokeStyle = OUT; ctx.lineWidth = w + LW * 2; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
  }

  // ---------- Vlok, the fawn ----------
  const HERT = {
    ph0: 0.4, per: .46, stride: 14, lift: 13, bounce: 1, spring: 1, off: [0, .4, PI, PI + .4],
    hip: [14, -48, 8, -47, -19, -47, -25, -46], foot: [17, 9, -17, -26],
    L1: 25, L2: 24, legW: [5.8, 4.3], dir: [-1, -1, 1, 1], hoof: true,
    body: { x: -3, y: -58, rx: 27, ry: 15.5, rot: -.07 }, pivot: [0, -56], lieDrop: 42, lieHead: [10, 22],
    col: { body: "#e3a86f", shade: "#c4844a", cream: "#fdf3e1", hoof: "#4a3029", hoofShade: "#3d2822", inner: "#f6c1c8", nose: "#ea8ea0" },
    tail(ctx, p) {
      ctx.save(); ctx.translate(-29, -61); ctx.rotate(-.9 - p.tail * .8);
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.quadraticCurveTo(-7, -4, -3, -11); ctx.quadraticCurveTo(2, -7, 2, 2); ctx.closePath();
      fillOut(ctx, "#fdf3e1"); ctx.restore();
    },
    marks(ctx) {
      const c = HERT.col;
      ell(ctx, -1, -47, 17, 5.5, -.05); fillOnly(ctx, c.cream);                       // belly
      ctx.fillStyle = "#fff8ea";                                                         // white spots on the back
      for (let i = 0; i < 7; i++) {
        const a = -PI * .32 - i * .19, rad = i % 2 ? .72 : .5;
        ell(ctx, -3 + cos(a) * 27 * rad, -58 + sin(a) * 15.5 * rad, 2.6, 1.9, 0); ctx.fill();
      }
    },
    head(ctx, p, t, o) {
      const c = HERT.col, hx = 26 + p.hx, hy = -83 + p.hy, R = 15.5;
      neck(ctx, 10, -60, hx - 4, hy + 7, 13, c.body);
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(p.hrot);
      ear(ctx, -9, -10, 19, 7.2, -.8 + p.earL, c.body, c.inner); ear(ctx, 8, -11, 19, 7.2, .55 + p.earR, c.body, c.inner);
      circ(ctx, 0, 0, R); fillOut(ctx, c.body);
      ctx.globalAlpha *= .25; ell(ctx, -4, -5, 8, 5.5, 0); fillOnly(ctx, "#ffffff"); ctx.globalAlpha /= .25;
      ell(ctx, 11, 6.5, 9.5, 7.5, -.1); fillOut(ctx, c.cream);                          // muzzle
      ell(ctx, 17.5, 4, 4.2, 3.2, 0); fillOut(ctx, c.nose, OUT, 1.6); dot(ctx, 16.3, 3, 1.2, "#ffd7df");
      mouth(ctx, 12, 9.8, p.mouth === MOUTH_SMILE ? 2.6 : 3.2, p.mouth);
      blush(ctx, 3.5, 6.5, 3.8, p.blush + (o.blush ? 1 : 0)); blush(ctx, -10.5, .5, 2.6, p.blush + (o.blush ? 1 : 0));
      eye(ctx, 3.8, -2.2, 5.3, p.eye); eye(ctx, -7.2, -2.8, 4.3, p.eye);
      // eyelashes: one little flick on the outer upper edge of each eye
      if (p.eye !== EYE_BLINK && p.eye !== EYE_HAPPY && p.eye !== EYE_DIZZY) {
        const r1 = p.eye === EYE_WIDE ? 6.2 : 5.3, r2 = p.eye === EYE_WIDE ? 5 : 4.3;
        line(ctx, 3.8 + cos(-.75) * r1, -2.2 + sin(-.75) * r1, 3.8 + cos(-.75) * (r1 + 2.6), -2.2 + sin(-.75) * (r1 + 2.6), OUT, 1.5);
        line(ctx, -7.2 + cos(-2.3) * r2, -2.8 + sin(-2.3) * r2, -7.2 + cos(-2.3) * (r2 + 2.2), -2.8 + sin(-2.3) * (r2 + 2.2), OUT, 1.4);
      }
      if (o.hat === "kerstmuts") kerstmuts(ctx, R, p.flop);
      ctx.restore();
    }
  };
  // ---------- Pluis, the rabbit ----------
  const KONIJN = {
    ph0: 1.7, per: .5, stride: 15, lift: 15, bounce: 1.5, spring: 1.35, off: [PI, PI + .2, 0, .2],
    hip: [9, -28, 4, -27, -13, -26, -19, -25], foot: [12, 6, -8, -15],
    L1: 14.5, L2: 13.5, legW: [7.5, 5.5], dir: [-1, -1, 1, 1], paw: true, hindFoot: [9.5, 4.3, 4.5],
    body: { x: -3, y: -37, rx: 23.5, ry: 17.5, rot: -.14 }, pivot: [0, -37], lieDrop: 18, lieHead: [4, 14],
    col: { body: "#eef0f6", shade: "#c5cde0", paw: "#f6f7fb", inner: "#f7b9cb", nose: "#ea8aa0", cream: "#ffffff" },
    tail(ctx, p) {
      ctx.save(); ctx.translate(-25, -35 + p.tail * 2); circ(ctx, 0, 0, 7); fillOut(ctx, "#ffffff");
      ctx.globalAlpha *= .4; dot(ctx, -1.5, -2, 3, "#ffffff"); ctx.globalAlpha /= .4; ctx.restore();
    },
    marks(ctx) {
      ell(ctx, 0, -27, 14, 6.5, -.05); fillOnly(ctx, "#ffffff");
    },
    head(ctx, p, t, o) {
      const c = KONIJN.col, hx = 16 + p.hx, hy = -58 + p.hy, R = 16.5;
      neck(ctx, 6, -44, hx - 3, hy + 8, 19, c.body);
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(p.hrot);
      // one ear up, one floppy ear (Pluis' signature)
      ear(ctx, -5, -12, 31, 7.5, -.28 + p.earL, c.body, c.inner);
      ctx.save(); ctx.translate(9, -11); ctx.rotate(1.7 + p.earR * .6 + p.flop * .08);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-7, -9, -5, -28, 0, -28); ctx.bezierCurveTo(6, -28, 7, -9, 0, 0); ctx.closePath(); fillOut(ctx, c.body);
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.bezierCurveTo(-4, -9, -3, -23, 0, -23); ctx.bezierCurveTo(3.5, -23, 4, -9, 0, -3); ctx.closePath(); fillOnly(ctx, c.inner);
      ctx.restore();
      circ(ctx, 0, 0, R); fillOut(ctx, c.body);
      ctx.globalAlpha *= .3; ell(ctx, -4, -6, 8, 5.5, 0); fillOnly(ctx, "#ffffff"); ctx.globalAlpha /= .3;
      // cheeks
      ell(ctx, 8, 7, 8, 6, 0); fillOnly(ctx, "#ffffff"); ell(ctx, -3, 8, 6.5, 5, 0); fillOnly(ctx, "#ffffff");
      ell(ctx, 14, 2.5, 3.4, 2.6, 0); fillOut(ctx, c.nose, OUT, 1.5);
      // buck teeth
      ctx.fillStyle = "#ffffff"; ctx.strokeStyle = OUT; ctx.lineWidth = 1.2;
      rr(ctx, 9, 8, 3.4, 5, 1); ctx.fill(); ctx.stroke(); rr(ctx, 12.6, 8, 3.4, 5, 1); ctx.fill(); ctx.stroke();
      if (p.mouth !== MOUTH_SMILE) { mouth(ctx, 11, 7.5, 2.6, MOUTH_SMILE); }
      // whisker dots
      dot(ctx, 4.5, 7, .9, OUT); dot(ctx, 1.5, 9.5, .9, OUT);
      blush(ctx, 2, 4.5, 3.4, p.blush + (o.blush ? 1 : 0)); blush(ctx, -12, 1.5, 2.5, p.blush + (o.blush ? 1 : 0));
      eye(ctx, 6, -3.5, 5, p.eye); eye(ctx, -7.5, -3.8, 4.2, p.eye);
      if (o.hat === "kerstmuts") kerstmuts(ctx, R, p.flop);
      ctx.restore();
    }
  };
  // ---------- Snuf, the fox ----------
  const VOS = {
    ph0: 2.9, per: .44, stride: 15, lift: 12, bounce: .9, spring: .95, off: [0, .4, PI, PI + .4],
    hip: [13, -44, 7, -43, -18, -43, -24, -42], foot: [16, 8, -16, -25],
    L1: 23, L2: 22, legW: [6.5, 5], dir: [-1, -1, 1, 1], paw: true,
    body: { x: -4, y: -54, rx: 27, ry: 15, rot: -.08 }, pivot: [0, -52], lieDrop: 38, lieHead: [8, 18],
    col: { body: "#f08d3d", shade: "#cf6d28", cream: "#fff3e0", paw: "#3f2b2a", inner: "#fbd3b8", nose: "#3a2826", scarf: RED, scarf2: RED2 },
    tail(ctx, p) {
      ctx.save(); ctx.translate(-28, -56); ctx.rotate(-p.tail * .35);
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.bezierCurveTo(-18, 6, -32, -2, -30, -18); ctx.bezierCurveTo(-29, -26, -20, -27, -16, -20);
      ctx.bezierCurveTo(-13, -12, -8, -8, 2, -6); ctx.closePath(); fillOut(ctx, VOS.col.body);
      ctx.beginPath(); ctx.moveTo(-24, -10); ctx.bezierCurveTo(-31, -10, -31, -22, -26, -24); ctx.bezierCurveTo(-21, -26, -17, -20, -18, -14); ctx.closePath(); fillOnly(ctx, VOS.col.cream);
      ctx.restore();
    },
    marks(ctx, p) {
      ell(ctx, -1, -44, 16, 5.5, -.05); fillOnly(ctx, VOS.col.cream);
      // scarf tails streaming behind the neck
      ctx.save(); ctx.translate(14, -66); ctx.rotate(-.2 + p.flop * .1);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-14, 2 + p.flop * 3, -24, -2 + p.flop * 4); ctx.lineTo(-22, 6 + p.flop * 4); ctx.quadraticCurveTo(-12, 8, 0, 7); ctx.closePath(); fillOut(ctx, VOS.col.scarf);
      ctx.beginPath(); ctx.moveTo(-2, 5); ctx.quadraticCurveTo(-12, 10 - p.flop * 2, -18, 16 - p.flop * 3); ctx.lineTo(-13, 18 - p.flop * 3); ctx.quadraticCurveTo(-6, 12, 2, 10); ctx.closePath(); fillOut(ctx, VOS.col.scarf2);
      ctx.restore();
    },
    head(ctx, p, t, o) {
      const c = VOS.col, hx = 30 + p.hx, hy = -78 + p.hy;
      neck(ctx, 12, -58, hx - 5, hy + 6, 15, c.body);
      // scarf band around the neck
      ctx.save(); ctx.translate(18, -65); ctx.rotate(-.9); rr(ctx, -11, -4.5, 22, 9, 4.5); fillOut(ctx, c.scarf); ctx.restore();
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(p.hrot);
      // pointy ears with dark tips
      ctx.save(); ctx.translate(-8, -8); ctx.rotate(-.55 + p.earL); ctx.beginPath(); ctx.moveTo(-6, 2); ctx.lineTo(0, -18); ctx.lineTo(6, 2); ctx.closePath(); fillOut(ctx, c.body);
      ctx.beginPath(); ctx.moveTo(-2.5, -9); ctx.lineTo(0, -18); ctx.lineTo(2.5, -9); ctx.closePath(); fillOnly(ctx, "#3f2b2a"); ctx.restore();
      ctx.save(); ctx.translate(7, -9); ctx.rotate(.45 + p.earR); ctx.beginPath(); ctx.moveTo(-6, 2); ctx.lineTo(0, -18); ctx.lineTo(6, 2); ctx.closePath(); fillOut(ctx, c.body);
      ctx.beginPath(); ctx.moveTo(-2.5, -9); ctx.lineTo(0, -18); ctx.lineTo(2.5, -9); ctx.closePath(); fillOnly(ctx, "#3f2b2a"); ctx.restore();
      circ(ctx, 0, 0, 14); fillOut(ctx, c.body);
      ctx.globalAlpha *= .25; ell(ctx, -3, -5, 7, 5, 0); fillOnly(ctx, "#ffffff"); ctx.globalAlpha /= .25;
      // white muzzle wedge to the pointy nose
      ctx.beginPath(); ctx.moveTo(2, -1); ctx.quadraticCurveTo(14, -2, 19, 4); ctx.quadraticCurveTo(12, 12, 1, 9); ctx.closePath(); fillOut(ctx, c.cream);
      ell(ctx, 18.5, 4, 3, 2.4, 0); fillOut(ctx, c.nose, OUT, 1.4);
      mouth(ctx, 10, 8.5, p.mouth === MOUTH_SMILE ? 2.8 : 3.2, p.mouth);
      blush(ctx, 1, 6, 3, p.blush + (o.blush ? 1 : 0)); blush(ctx, -10, 1, 2.3, p.blush + (o.blush ? 1 : 0));
      eye(ctx, 4.5, -3, 4.3, p.eye); eye(ctx, -7, -3.5, 3.6, p.eye);
      if (o.hat === "kerstmuts") kerstmuts(ctx, 14, p.flop);
      ctx.restore();
    }
  };
  // ---------- Oeki, the owl (biped) ----------
  const UIL = { col: { body: "#b17b45", shade: "#8f6034", belly: "#f6e6c6", feather: "#dcbf8f", beak: "#f0a241", feet: "#f0a241", eye: "#fff9ec" } };
  function poseUil(anim, t) {
    resetPose();
    const p = P, blink = ((t + 2.3) % 4.1) < 0.12;
    p.fx[0] = 9; p.fy[0] = -1; p.fx[1] = -9; p.fy[1] = -1; p.wing = 0;
    switch (anim) {
      case "run": {
        const ph = t * TAU / .42;
        p.tilt = .13 * sin(ph); p.bob = -2 * abs(sin(ph)); p.sx = 1 + .03 * sin(ph * 2);
        p.fx[0] = 9 - 7 * cos(ph); p.fy[0] = -1 - 9 * max(0, sin(ph)); p.fx[1] = -9 - 7 * cos(ph + PI); p.fy[1] = -1 - 9 * max(0, sin(ph + PI));
        p.wing = .35 * sin(ph * 2) - .2; p.eye = blink ? EYE_BLINK : EYE_OPEN; p.mouth = MOUTH_SMILE; p.flop = sin(ph);
        break;
      }
      case "jump": p.tilt = -.2; p.sy = 1.1; p.sx = .92; p.fx[0] = 11; p.fy[0] = -12; p.fx[1] = -7; p.fy[1] = -8; p.wing = -1; p.eye = EYE_WIDE; p.mouth = MOUTH_BIG; p.flop = -.8; break;
      case "fall": p.tilt = .12; p.sy = .95; p.sx = 1.05; p.fx[0] = 12; p.fy[0] = -4; p.fx[1] = -12; p.fy[1] = -4; p.wing = .9; p.eye = EYE_WIDE; p.mouth = MOUTH_O; p.flop = .9; break;
      case "slide": p.lying = 1; p.bob = 13; p.tilt = -1.42; p.sx = 1.05; p.sy = .92; p.fx[0] = -27; p.fy[0] = -3; p.fx[1] = -33; p.fy[1] = -6; p.wing = -1; p.eye = EYE_HAPPY; p.mouth = MOUTH_BIG; p.hx = 2; p.hy = 2; p.hrot = 1.1; p.flop = -1; break;
      case "stumble": { const w = sin(t * 21); p.tilt = .6 + .07 * w; p.bob = 8; p.fx[0] = 18; p.fy[0] = -4; p.fx[1] = -14; p.fy[1] = -14 + 3 * w; p.wing = .8 * w; p.eye = EYE_DIZZY; p.mouth = MOUTH_TONGUE; p.hrot = .2; p.flop = w; break; }
      case "fly": { const f = sin(t * TAU * 2.4); p.tilt = -.18; p.bob = -4 + 2.5 * f; p.tuck = 1; p.wing = f; p.fx[0] = 4; p.fy[0] = -14; p.fx[1] = -8; p.fy[1] = -14; p.eye = EYE_HAPPY; p.mouth = MOUTH_BIG; p.flop = f; break; }
      case "happy": { const h = abs(sin(t * TAU / .62)); p.bob = -10 * h; p.sx = 1 - .05 * h; p.sy = 1 + .07 * h; p.fy[0] = p.fy[1] = -1 + p.bob * .85; p.wing = -.7 - .3 * sin(t * 15); p.eye = EYE_HAPPY; p.mouth = MOUTH_BIG; p.blush = 1; p.hrot = .1 * sin(t * 7); p.flop = sin(t * 8); break; }
      default: { const b = sin(t * 1.9); p.bob = b * 1.2; p.sy = 1 + .015 * b; p.sx = 1 - .01 * b; p.wing = .05 * b; p.hrot = .12 * sin(t * .6); p.eye = blink ? EYE_BLINK : 5 /* sleepy */; p.flop = .3 * b; }
    }
  }
  function uilFoot(ctx, x, y) {
    ctx.strokeStyle = OUT; ctx.lineWidth = 4.2 + LW * 2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y - 1); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 1); ctx.lineTo(x, y + .5); ctx.stroke();
    ctx.strokeStyle = UIL.col.feet; ctx.lineWidth = 4.2;
    ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y - 1); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.stroke();
  }
  function wing(ctx, side, w, col) {
    // side -1 = far/left wing, +1 = near/right; w -1 (up) .. +1 (down)
    ctx.save(); ctx.translate(side * 20, -46); ctx.rotate(side * (.35 + w * .95));
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.bezierCurveTo(side * 14, -2, side * 20, 18, side * 6, 34); ctx.bezierCurveTo(side * -2, 30, side * -6, 10, 0, -6); ctx.closePath(); fillOut(ctx, col);
    ctx.strokeStyle = "rgba(60,35,25,.35)"; ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(side * 5, 12); ctx.quadraticCurveTo(side * 12, 18, side * 8, 26); ctx.moveTo(side * 2, 18); ctx.quadraticCurveTo(side * 8, 24, side * 5, 31); ctx.stroke();
    ctx.restore();
  }
  function drawUil(ctx, t, o, anim) {
    poseUil(anim, t);
    const p = P, c = UIL.col;
    uilFoot(ctx, p.fx[1], p.fy[1]);
    ctx.save(); ctx.translate(0, -40 + p.bob); ctx.rotate(p.tilt); ctx.scale(p.sx, p.sy); ctx.translate(0, 40);
    wing(ctx, -1, p.wing, c.shade);
    // egg body
    ctx.beginPath(); ctx.moveTo(0, -78); ctx.bezierCurveTo(26, -78, 30, -40, 26, -18); ctx.bezierCurveTo(22, -2, -22, -2, -26, -18); ctx.bezierCurveTo(-30, -40, -26, -78, 0, -78); ctx.closePath(); fillOut(ctx, c.body);
    // belly with feather scallops
    ctx.beginPath(); ctx.moveTo(0, -48); ctx.bezierCurveTo(16, -48, 20, -32, 17, -18); ctx.bezierCurveTo(14, -8, -14, -8, -17, -18); ctx.bezierCurveTo(-20, -32, -16, -48, 0, -48); ctx.closePath(); fillOnly(ctx, c.belly);
    ctx.strokeStyle = c.feather; ctx.lineWidth = 1.8; ctx.lineCap = "round";
    for (let row = 0; row < 3; row++) {
      const y = -36 + row * 8, n = 3 + (row & 1);
      ctx.beginPath(); for (let i = 0; i < n; i++) { const x = -(n - 1) * 4.5 + i * 9; ctx.moveTo(x - 4, y); ctx.quadraticCurveTo(x, y + 5, x + 4, y); } ctx.stroke();
    }
    // face disc + eyes
    ctx.save(); ctx.translate(p.hx, -56 + p.hy); ctx.rotate(p.hrot);
    ell(ctx, 0, 0, 22, 15, 0); ctx.globalAlpha *= .55; fillOnly(ctx, c.belly); ctx.globalAlpha /= .55;
    // ear tufts
    ctx.beginPath(); ctx.moveTo(-14, -14); ctx.lineTo(-19, -27 + p.flop); ctx.lineTo(-8, -17); ctx.closePath(); fillOut(ctx, c.body);
    ctx.beginPath(); ctx.moveTo(14, -14); ctx.lineTo(19, -27 - p.flop); ctx.lineTo(8, -17); ctx.closePath(); fillOut(ctx, c.body);
    for (let s = -1; s <= 1; s += 2) {
      const ex = s * 10 + 1.5, ey = 0;
      circ(ctx, ex, ey, 9.5); fillOut(ctx, c.eye);
      if (p.eye === EYE_HAPPY || p.eye === EYE_BLINK || p.eye === EYE_DIZZY) eye(ctx, ex, ey, 5, p.eye);
      else {
        eye(ctx, ex + 1, ey + .5, p.eye === EYE_WIDE ? 5.4 : 4.6, EYE_OPEN);
        if (p.eye === 5) { // sleepy lids
          ctx.beginPath(); ctx.arc(ex, ey, 9.5, PI, TAU); ctx.lineTo(ex + 9.5, ey - 1); ctx.quadraticCurveTo(ex, ey + 2, ex - 9.5, ey - 1); ctx.closePath(); fillOut(ctx, c.body);
        }
      }
    }
    // beak
    ctx.beginPath(); ctx.moveTo(-3.5, 6); ctx.lineTo(3.5, 6); ctx.lineTo(0.5, 13.5); ctx.closePath(); fillOut(ctx, c.beak, OUT, 1.6);
    if (p.mouth === MOUTH_BIG) { ctx.beginPath(); ctx.arc(.5, 12, 2.6, 0, PI); ctx.closePath(); fillOnly(ctx, "#6e2a33"); }
    blush(ctx, -16, 9, 3, p.blush + (o.blush ? 1 : 0)); blush(ctx, 17, 9, 3, p.blush + (o.blush ? 1 : 0));
    if (o.hat === "kerstmuts") kerstmuts(ctx, 17, p.flop); else muts(ctx, 17, p.flop);
    ctx.restore();
    wing(ctx, 1, p.wing, c.body);
    ctx.restore();
    uilFoot(ctx, p.fx[0], p.fy[0]);
  }

  const ANIMALS = ["hert", "konijn", "vos", "uil"];
  const NAMES = { hert: "Vlok", konijn: "Pluis", vos: "Snuf", uil: "Oeki" };
  const SPECS = { hert: HERT, konijn: KONIJN, vos: VOS };
  function animal(ctx, kind, anim, t, o) {
    o = o || NOOPTS;
    const sc = o.scale || 1, fc = o.facing || 1;
    ctx.save();
    if (o.alpha != null && o.alpha !== 1) ctx.globalAlpha *= o.alpha;
    ctx.scale(sc * fc, sc); ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (kind === "uil") drawUil(ctx, t || 0, o, anim);
    else drawQuad(ctx, t || 0, o, SPECS[kind] || HERT, anim);
    ctx.restore();
  }
  const BOX = { x: 0, y: 0, w: 0, h: 0 };
  function animalBox(kind, anim) {
    if (anim === "slide") { BOX.x = -44; BOX.y = kind === "uil" ? -54 : -46; BOX.w = 100; BOX.h = -BOX.y; }
    else if (anim === "fly") { BOX.x = -40; BOX.y = -100; BOX.w = 94; BOX.h = 70; }
    else { BOX.x = kind === "uil" ? -30 : -34; BOX.y = kind === "uil" ? -100 : -104; BOX.w = kind === "uil" ? 60 : 88; BOX.h = -BOX.y; }
    return BOX;
  }

  // ---------- sprites ----------
  // lights: glowing dots along the tiers of a pine; drawn live (pulse with t) when opts.lit
  function treeLights(ctx, tiers, w, h, t, n) {
    const tierH = h / (tiers + .6);
    for (let k = 0; k < tiers; k++) {
      const y0 = -tierH * (k + .95), hw = w * .5 * (1 - k / (tiers + 1));
      for (let i = 0; i < n; i++) {
        const u = (i + .5) / n, x = -hw + 2 * hw * u, y = y0 + tierH * .55 * (1 - abs(u * 2 - 1)) * .5 + 2 * sin(u * 9 + k);
        const col = CANDY[(i + k) % 6], a = .55 + .45 * sin(t * 3 + i * 1.7 + k * 2.1);
        ctx.globalAlpha *= a * .5; dot(ctx, x, y, 6.5, col); ctx.globalAlpha /= .5;
        dot(ctx, x, y, 3.6, col); ctx.globalAlpha /= a;
      }
    }
  }
  // generic storybook pine: `tiers` stacked rounded triangles with scalloped snow caps, trunk, baubles
  function pine(ctx, tiers, w, h, o, t, variant) {
    const th = o.theme === "peperkoek", cols = TH[o.theme] ? TH[o.theme].near : TH.nacht.near;
    const tierH = h / (tiers + .6), trunkW = w * .14;
    rr(ctx, -trunkW / 2, -tierH * .9, trunkW, tierH * .95, 3); fillOut(ctx, th ? "#f4f4f4" : "#6b4a2e");
    if (th) { ctx.save(); rr(ctx, -trunkW / 2, -tierH * .9, trunkW, tierH * .95, 3); ctx.clip(); ctx.fillStyle = RED; for (let i = 0; i < 6; i++) { ctx.save(); ctx.translate(0, -tierH * .9 + i * 7); ctx.rotate(-.6); ctx.fillRect(-trunkW, -2, trunkW * 2, 3.2); ctx.restore(); } ctx.restore(); }
    for (let k = 0; k < tiers; k++) {
      const yb = -tierH * (k + .6), hw = w * .5 * (1 - k / (tiers + 1)), hh = tierH * 1.45;
      const col = th ? cols[(k + variant) % 3] : cols[(k + variant) % 2];
      ctx.beginPath(); ctx.moveTo(-hw, yb); scallops(ctx, -hw, hw, yb, 4, tierH * .22);
      ctx.quadraticCurveTo(hw * .35, yb - hh * .55, 0, yb - hh); ctx.quadraticCurveTo(-hw * .35, yb - hh * .55, -hw, yb); ctx.closePath();
      fillOut(ctx, col);
      // snow / icing cap on the tier
      const sw = hw * .62, sy = yb - hh * .36;
      ctx.beginPath(); ctx.moveTo(-sw, sy); scallops(ctx, -sw, sw, sy, 3, tierH * .17);
      ctx.quadraticCurveTo(sw * .3, yb - hh * .72, 0, yb - hh + 1); ctx.quadraticCurveTo(-sw * .3, yb - hh * .72, -sw, sy); ctx.closePath();
      fillOut(ctx, th ? "#fffaf2" : SNOW, th ? "#d9a8a0" : OUT_ICE, 1.6);
      // baubles at the scallop valleys
      for (let i = 0; i < 3; i++) {
        const x = -hw + 2 * hw * (i + .5) / 4 + (i - 1) * 2, y = yb + tierH * .05;
        const c = CANDY[(i + k * 2 + variant) % 6];
        circ(ctx, x, y, 3.4); fillOut(ctx, c, OUT, 1.4); dot(ctx, x - 1, y - 1.2, 1.1, "rgba(255,255,255,.9)");
      }
    }
    if (tiers >= 4) { const sy = -tierH * (tiers - 1 + .6) - tierH * 1.45 + 2; starPath(ctx, 0, sy, w * .11, 0); fillOut(ctx, GOLD, "#a86f12", 1.6); dot(ctx, -w * .03, sy - w * .03, w * .025, "#fff6cf"); }
    if (o.lit !== false) treeLights(ctx, tiers, w, h, t, 3);
  }
  function giantTree(ctx, t, o) {
    const w = 300, h = 520, tiers = 7, th = o.theme === "peperkoek", tierH = h / (tiers + .8);
    // soft glow behind
    glow(ctx, 0, -h * .5, h * .62, "warm", "255,230,150", .6);
    rr(ctx, -20, -tierH, 40, tierH + 2, 6); fillOut(ctx, "#6b4a2e");
    for (let k = 0; k < tiers; k++) {
      const yb = -tierH * (k + .75), hw = w * .5 * (1 - k / (tiers + 1.2)), hh = tierH * 1.6;
      ctx.beginPath(); ctx.moveTo(-hw, yb); scallops(ctx, -hw, hw, yb, 5, tierH * .2);
      ctx.quadraticCurveTo(hw * .35, yb - hh * .55, 0, yb - hh); ctx.quadraticCurveTo(-hw * .35, yb - hh * .55, -hw, yb); ctx.closePath();
      fillOut(ctx, th ? TH.peperkoek.near[k % 3] : k % 2 ? GREEN2 : GREEN, OUT, 3);
      const sw = hw * .6, sy = yb - hh * .4;
      ctx.beginPath(); ctx.moveTo(-sw, sy); scallops(ctx, -sw, sw, sy, 4, tierH * .15);
      ctx.quadraticCurveTo(sw * .3, yb - hh * .74, 0, yb - hh + 1.5); ctx.quadraticCurveTo(-sw * .3, yb - hh * .74, -sw, sy); ctx.closePath();
      fillOut(ctx, th ? "#fffaf2" : SNOW, th ? "#d9a8a0" : OUT_ICE, 2);
      // garland (gold ribbon) swaying gently
      ctx.beginPath(); ctx.moveTo(-hw * .85, yb - hh * .18); ctx.quadraticCurveTo(0, yb + tierH * .18 + sin(t * 1.3 + k) * 3, hw * .85, yb - hh * .18);
      ctx.strokeStyle = GOLD2; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.stroke(); ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const x = -hw + 2 * hw * (i + .5) / 5 + (i & 1 ? 4 : -4), y = yb + tierH * .06;
        circ(ctx, x, y, 8); fillOut(ctx, CANDY[(i + k) % 6], OUT, 2.2); dot(ctx, x - 2.5, y - 3, 2.6, "rgba(255,255,255,.9)");
        ctx.fillStyle = "#6b4a2e"; ctx.fillRect(x - 2, y - 11, 4, 4);
      }
    }
    const sy = -tierH * (tiers - 1 + .75) - tierH * 1.6;
    const pulse = 1 + .08 * sin(t * 4);
    glow(ctx, 0, sy, 60 * pulse, "gold", "255,225,130", .7 + .3 * sin(t * 4));
    starPath(ctx, 0, sy, 30 * pulse, 0); fillOut(ctx, GOLD, "#a86f12", 2.6); dot(ctx, -8, -8 + sy, 5, "#fff6cf");
    if (o.lit !== false) treeLights(ctx, tiers, w * .9, h * .96, t, 6);
  }
  function house(ctx, t, o) {
    const w = 160, h = 150, bw = 120, bh = 78;
    ctx.save(); ctx.translate(-bw / 2, 0);
    // chimney + smoke
    rr(ctx, 86, -bh - 50, 18, 36, 3); fillOut(ctx, "#8e5529");
    const ga = ctx.globalAlpha;
    for (let i = 0; i < 3; i++) { const k = ((t * .35 + i / 3) % 1); ctx.globalAlpha = ga * (1 - k); dot(ctx, 95 + sin(k * 6 + i) * 6, -bh - 56 - k * 42, 5 + k * 9, "rgba(255,255,255,.7)"); }
    ctx.globalAlpha = ga;
    // body
    rr(ctx, 0, -bh, bw, bh, 6); fillOut(ctx, "#b4713a");
    // roof
    ctx.beginPath(); ctx.moveTo(-14, -bh + 4); ctx.lineTo(bw / 2, -h + 6); ctx.lineTo(bw + 14, -bh + 4); ctx.closePath(); fillOut(ctx, "#8e5529");
    // snow on the roof: a thick band along both slopes with icing drips on its lower edge
    const ax = bw / 2, ay = -h + 6, lx = -14, rx = bw + 14, ey = -bh + 4, n = 5;
    ctx.beginPath(); ctx.moveTo(lx - 5, ey - 2); ctx.lineTo(ax, ay - 12); ctx.lineTo(rx + 5, ey - 2); ctx.lineTo(rx, ey + 10);
    for (let i = 1; i <= n; i++) { const u0 = (i - 1) / n, u1 = i / n; const x0 = lerp(rx, ax, u0), y0 = lerp(ey, ay, u0) + 10, x1 = lerp(rx, ax, u1), y1 = lerp(ey, ay, u1) + 10; ctx.quadraticCurveTo((x0 + x1) / 2 + 3, (y0 + y1) / 2 + 9, x1, y1); }
    for (let i = 1; i <= n; i++) { const u0 = (i - 1) / n, u1 = i / n; const x0 = lerp(ax, lx, u0), y0 = lerp(ay, ey, u0) + 10, x1 = lerp(ax, lx, u1), y1 = lerp(ay, ey, u1) + 10; ctx.quadraticCurveTo((x0 + x1) / 2 - 3, (y0 + y1) / 2 + 9, x1, y1); }
    ctx.closePath(); fillOut(ctx, SNOW, OUT_ICE, 1.6);
    // door
    ctx.beginPath(); ctx.moveTo(48, 0); ctx.lineTo(48, -30); ctx.arc(60, -30, 12, PI, 0); ctx.lineTo(72, 0); ctx.closePath(); fillOut(ctx, "#7a2f36");
    ctx.beginPath(); ctx.moveTo(52, 0); ctx.lineTo(52, -29); ctx.arc(60, -29, 8, PI, 0); ctx.lineTo(68, 0); ctx.closePath(); fillOnly(ctx, "#a8434a"); dot(ctx, 65, -14, 1.8, GOLD);
    // windows (warm light)
    for (let i = 0; i < 2; i++) {
      const x = 12 + i * 76;
      rr(ctx, x, -58, 22, 22, 4); fillOut(ctx, "#ffd36b"); ctx.globalAlpha *= .5 + .2 * sin(t * 2 + i); rr(ctx, x + 3, -55, 16, 16, 3); fillOnly(ctx, "#fff0b8"); ctx.globalAlpha /= .5 + .2 * sin(t * 2 + i);
      line(ctx, x + 11, -58, x + 11, -36, OUT, 1.6); line(ctx, x, -47, x + 22, -47, OUT, 1.6);
      // icing window frame
      rr(ctx, x - 3, -61, 28, 5, 2); fillOnly(ctx, "#fff5e8");
    }
    // gumdrop buttons + peppermint corners
    for (let i = 0; i < 5; i++) { const x = 12 + i * 24; circ(ctx, x, -70 + (i & 1) * 6, 4); fillOut(ctx, CANDY[i % 6], OUT, 1.3); }
    for (let s = 0; s < 2; s++) { const x = s ? bw - 2 : 2; circ(ctx, x, -bh * .3, 7); fillOut(ctx, "#ffffff", OUT, 1.5); ctx.strokeStyle = RED; ctx.lineWidth = 2; ctx.beginPath(); for (let k = 0; k < 4; k++) { ctx.moveTo(x, -bh * .3); ctx.lineTo(x + cos(k * PI / 2 + .4) * 6, -bh * .3 + sin(k * PI / 2 + .4) * 6); } ctx.stroke(); }
    // icing along the base
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-6, -6); scallops(ctx, -6, bw + 6, -6, 6, 5); ctx.lineTo(bw + 6, 0); ctx.closePath(); fillOut(ctx, "#fff5e8", OUT_ICE, 1.4);
    ctx.restore();
  }
  function log(ctx) {
    rr(ctx, -36, -30, 64, 28, 13); fillOut(ctx, "#7c4b2a");
    ctx.strokeStyle = "rgba(60,30,15,.45)"; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(-26, -22); ctx.quadraticCurveTo(-10, -20, 4, -23); ctx.moveTo(-28, -10); ctx.quadraticCurveTo(-8, -12, 10, -9); ctx.moveTo(-6, -16); ctx.lineTo(8, -15); ctx.stroke();
    // end face with rings
    ell(ctx, 26, -16, 9, 13, 0); fillOut(ctx, "#dcae74");
    ctx.strokeStyle = "#a9754a"; ctx.lineWidth = 1.6; ell(ctx, 26, -16, 5.5, 8.5, 0); ctx.stroke(); ell(ctx, 26, -16, 2.2, 4, 0); ctx.stroke();
    // snow cap
    ctx.beginPath(); ctx.moveTo(-32, -28); ctx.quadraticCurveTo(-30, -36, -16, -35); ctx.quadraticCurveTo(-4, -37, 6, -34); ctx.quadraticCurveTo(14, -34, 18, -30);
    scallops(ctx, 18, -32, -27, 5, 4); ctx.closePath(); fillOut(ctx, SNOW, OUT_ICE, 1.6);
  }
  function icicles(ctx, t) {
    // snowy ledge at the top (center anchor: spans y -30..+30)
    rr(ctx, -45, -30, 90, 14, 5); fillOut(ctx, "#6b4a2e");
    ctx.beginPath(); ctx.moveTo(-46, -22); ctx.quadraticCurveTo(-44, -34, -30, -33); ctx.quadraticCurveTo(-10, -37, 10, -34); ctx.quadraticCurveTo(30, -36, 46, -24); ctx.lineTo(46, -20); ctx.lineTo(-46, -20); ctx.closePath(); fillOut(ctx, SNOW, OUT_ICE, 1.6);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const x = -38 + i * 76 / (n - 1), len = 22 + 24 * hash(i, 7) * (i % 2 ? 1 : .6), hw = 5.5 + 2 * hash(i, 3);
      ctx.beginPath(); ctx.moveTo(x - hw, -18); ctx.quadraticCurveTo(x - hw * .3, -18 + len * .6, x, -18 + len); ctx.quadraticCurveTo(x + hw * .3, -18 + len * .6, x + hw, -18); ctx.closePath();
      fillOut(ctx, "#d6f1ff", OUT_ICE, 1.8);
      line(ctx, x - hw * .35, -14, x - hw * .12, -18 + len * .55, "rgba(255,255,255,.9)", 1.6);
      // drip sparkle
      if (hash(i, 9) > .5) { const k = (t * .6 + hash(i, 2)) % 1, ga = ctx.globalAlpha; ctx.globalAlpha = ga * (1 - k); glint(ctx, x, -18 + len + 2 + k * 8, 2.2 * (1 - k), "#ffffff", 0); ctx.globalAlpha = ga; }
    }
  }
  function snowman(ctx, t) {
    const rock = .07 * sin(t * TAU * .8);
    ctx.save(); ctx.rotate(rock);
    circ(ctx, 0, -22, 23); fillOut(ctx, SNOW); ctx.globalAlpha *= .35; ell(ctx, 4, -12, 14, 7, 0); fillOnly(ctx, SNOW3); ctx.globalAlpha /= .35;
    circ(ctx, 0, -55, 17.5); fillOut(ctx, SNOW);
    for (let i = 0; i < 3; i++) dot(ctx, 1, -65 + i * 9, 2.1, OUT);
    // stick arms (waving)
    ctx.strokeStyle = "#6b4a2e"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.beginPath();
    ctx.moveTo(-14, -56); ctx.lineTo(-30, -70 + 3 * sin(t * 5)); ctx.moveTo(-26, -66 + 3 * sin(t * 5)); ctx.lineTo(-32, -62 + 3 * sin(t * 5));
    ctx.moveTo(14, -54); ctx.lineTo(30, -44); ctx.moveTo(25, -47); ctx.lineTo(30, -52); ctx.stroke();
    // scarf
    ctx.save(); ctx.translate(0, -72); rr(ctx, -16, -4, 32, 9, 4); fillOut(ctx, RED); ctx.beginPath(); ctx.moveTo(8, 3); ctx.quadraticCurveTo(16, 10, 14, 22); ctx.lineTo(7, 20); ctx.quadraticCurveTo(6, 10, 2, 5); ctx.closePath(); fillOut(ctx, RED2); ctx.restore();
    // head
    circ(ctx, 0, -84, 13.5); fillOut(ctx, SNOW);
    eye(ctx, 4.5, -87, 2.2, EYE_OPEN); eye(ctx, -4, -87, 2.2, EYE_OPEN);
    ctx.beginPath(); ctx.moveTo(1, -83); ctx.lineTo(16, -80); ctx.lineTo(1, -78); ctx.closePath(); fillOut(ctx, "#f58b2e", OUT, 1.4);
    for (let i = 0; i < 4; i++) dot(ctx, -5 + i * 3.4, -75 + abs(i - 1.5) * -1.2 + 1.5, 1.1, OUT);
    blush(ctx, -8, -80, 2.6, .4); blush(ctx, 9, -80, 2.6, .4);
    // knitted purple hat
    ctx.save(); ctx.translate(0, -84); ctx.rotate(-.1);
    ctx.beginPath(); ctx.moveTo(-13, -5); ctx.quadraticCurveTo(-12, -24, 0, -25); ctx.quadraticCurveTo(12, -24, 13, -5); ctx.closePath(); fillOut(ctx, "#8a63d8");
    rr(ctx, -14.5, -9, 29, 6, 2); fillOut(ctx, "#f6e7c8"); circ(ctx, 1, -26, 4); fillOut(ctx, "#f6e7c8"); ctx.restore();
    ctx.restore();
  }
  function gift(ctx, t, variant) {
    const box = CANDY[variant % 6], rib = variant % 2 ? "#ffffff" : GOLD;
    rr(ctx, -18, -10, 36, 28, 4); fillOut(ctx, box);
    rr(ctx, -20, -16, 40, 10, 3); fillOut(ctx, box);
    ctx.fillStyle = rib; ctx.fillRect(-4.5, -16, 9, 34); ctx.fillRect(-18, 0, 36, 7);
    ctx.strokeStyle = OUT; ctx.lineWidth = 1.2; ctx.strokeRect(-4.5, -16, 9, 34);
    // bow
    ell(ctx, -8, -20, 7, 4.5, -.4); fillOut(ctx, rib, OUT, 1.6); ell(ctx, 8, -20, 7, 4.5, .4); fillOut(ctx, rib, OUT, 1.6); circ(ctx, 0, -18, 3.2); fillOut(ctx, rib, OUT, 1.6);
    ctx.globalAlpha *= .35; ell(ctx, -10, -4, 4, 8, .2); fillOnly(ctx, "#ffffff"); ctx.globalAlpha /= .35;
    glint(ctx, 14, -14, 4 + 1.5 * sin(t * 5), "rgba(255,255,255,.95)", t);
  }
  const DASH = [7, 7];
  function candyCane(ctx) {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(-5, 28); ctx.lineTo(-5, -12); ctx.arc(4, -12, 9, PI, 0); ctx.lineTo(13, -6);
    ctx.strokeStyle = OUT; ctx.lineWidth = 9 + LW * 2; ctx.stroke();
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 9; ctx.stroke();
    ctx.setLineDash(DASH); ctx.lineDashOffset = 2; ctx.strokeStyle = RED; ctx.stroke(); ctx.setLineDash(EMPTY);
    ctx.globalAlpha *= .45; ctx.beginPath(); ctx.moveTo(-7, 24); ctx.lineTo(-7, -10); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.8; ctx.stroke(); ctx.globalAlpha /= .45;
  }
  function star(ctx, t, variant) {
    const ph = t * 3 + variant * 1.3, s = 1 + .07 * sin(ph);
    glow(ctx, 0, 0, 26, "gold", "255,225,130", .65 + .35 * sin(ph));
    starPath(ctx, 0, 1, 16 * s, 0); fillOut(ctx, GOLD, "#a86f12", 2);
    starPath(ctx, -1.5, -1, 8 * s, 0); fillOnly(ctx, "#fff2b8");
    glint(ctx, 9, -9, 5 * (.6 + .4 * sin(ph * 1.7)), "rgba(255,255,255,.95)", ph * .3);
  }
  function bell(ctx, t, variant) {
    const sw = .22 * sin(t * 5 + variant);
    ctx.save(); ctx.translate(0, -18); ctx.rotate(sw);
    // bow
    ell(ctx, -6, 0, 5.5, 3.5, -.5); fillOut(ctx, RED, OUT, 1.5); ell(ctx, 6, 0, 5.5, 3.5, .5); fillOut(ctx, RED, OUT, 1.5); circ(ctx, 0, 1, 2.6); fillOut(ctx, RED2, OUT, 1.5);
    // bell body
    ctx.beginPath(); ctx.moveTo(-4, 3); ctx.bezierCurveTo(-14, 8, -14, 22, -16, 28); ctx.quadraticCurveTo(0, 33, 16, 28); ctx.bezierCurveTo(14, 22, 14, 8, 4, 3); ctx.closePath(); fillOut(ctx, GOLD);
    ctx.beginPath(); ctx.moveTo(-16, 28); ctx.quadraticCurveTo(0, 36, 16, 28); ctx.quadraticCurveTo(0, 33, -16, 28); ctx.closePath(); fillOut(ctx, GOLD2);
    dot(ctx, 0, 33, 3.4, OUT); ctx.globalAlpha *= .5; ell(ctx, -6, 14, 2.5, 7, .15); fillOnly(ctx, "#ffffff"); ctx.globalAlpha /= .5;
    ctx.restore();
    glint(ctx, 10, -8, 3.5, "rgba(255,255,255,.9)", t);
  }
  const MOON_R = 46, MOON_C = 17, MOON_r = 41;
  const MOON_IX = (MOON_R * MOON_R - MOON_r * MOON_r + MOON_C * MOON_C) / (2 * MOON_C), MOON_IY = M.sqrt(MOON_R * MOON_R - MOON_IX * MOON_IX);
  const MOON_TH = M.atan2(MOON_IY, MOON_IX), MOON_PH = M.atan2(MOON_IY, MOON_IX - MOON_C);
  function moon(ctx, t, o) {
    const th = o.theme === "peperkoek";
    glow(ctx, 0, 0, 100, "moon", "255,240,190", .75);
    ctx.save(); ctx.rotate(-.35);
    if (th) { // koekjesmaan: round gingerbread cookie with icing smile
      circ(ctx, -10, 0, 44); fillOut(ctx, "#c98747", "#8a5a2a", 3); ctx.strokeStyle = "#fff5e8"; ctx.lineWidth = 4; circ(ctx, -10, 0, 37); ctx.stroke();
      ctx.restore(); ctx.save(); ctx.rotate(-.35); ctx.translate(-10, 0);
    } else {
      ctx.beginPath(); ctx.arc(0, 0, MOON_R, -MOON_TH, MOON_TH, true); ctx.arc(MOON_C, 0, MOON_r, MOON_PH, -MOON_PH, false); ctx.closePath();
      fillOut(ctx, "#fff0b8", "#c9a24a", 2.6);
      ctx.globalAlpha *= .35; dot(ctx, -22, -18, 5, "#ffffff"); dot(ctx, -30, 8, 3, "#ffffff"); dot(ctx, -16, 22, 4, "#e7c97a"); ctx.globalAlpha /= .35;
      ctx.translate(-22, 0);
    }
    // sleepy smiling face (wink = one eye open and a bigger grin)
    const wink = !!o.wink;
    eye(ctx, -2, -8, 3.4, wink ? EYE_OPEN : EYE_HAPPY, "#8a5a2a");
    eye(ctx, 12, -9, 3, EYE_HAPPY, "#8a5a2a");
    mouth(ctx, 5, 6, wink ? 5 : 3.4, wink ? MOUTH_BIG : MOUTH_SMILE, "#8a5a2a");
    blush(ctx, -8, 1, 3.2, .6); blush(ctx, 18, 0, 3, .6);
    if (wink) { glint(ctx, -14, -16, 5, "#ffffff", t); glint(ctx, 24, 6, 4, "#ffffff", t + 1); }
    ctx.restore();
  }
  function reindeer(ctx, x, y, t, k) {
    const ph = t * TAU * 1.4 + k;
    ctx.save(); ctx.translate(x, y + 1.5 * sin(ph));
    ctx.strokeStyle = "#4a2d22"; ctx.lineWidth = 3.5; ctx.lineCap = "round"; ctx.beginPath();
    for (let i = 0; i < 4; i++) { const q = ph + (i < 2 ? 0 : PI) + (i & 1) * .5, lx = (i < 2 ? 10 : -10) - 5 * cos(q); ctx.moveTo(lx, -2); ctx.lineTo(lx + 3 * sin(q), 10 - 5 * max(0, sin(q))); }
    ctx.stroke();
    ell(ctx, 0, -6, 17, 8.5, -.08); fillOut(ctx, "#8a5a3a", "#4a2d22", 2);
    circ(ctx, 18, -17, 7); fillOut(ctx, "#8a5a3a", "#4a2d22", 2); dot(ctx, 24, -16, 2.6, k ? "#e8343a" : "#3a2826");
    ctx.strokeStyle = "#4a2d22"; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(15, -23); ctx.lineTo(10, -34); ctx.lineTo(5, -30); ctx.moveTo(10, -34); ctx.lineTo(12, -38); ctx.moveTo(20, -23); ctx.lineTo(24, -34); ctx.lineTo(28, -31); ctx.stroke();
    dot(ctx, 20, -18.5, 1.3, "#fff");
    ctx.restore();
  }
  function sleigh(ctx, t) {
    // reins
    ctx.strokeStyle = "#6b4a2e"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-30, -14); ctx.quadraticCurveTo(10, -6, 36, -14); ctx.quadraticCurveTo(60, -6, 84, -14); ctx.stroke();
    reindeer(ctx, 44, 0, t, 0); reindeer(ctx, 84, 0, t, 1.2);
    // sleigh body
    ctx.beginPath(); ctx.moveTo(-96, -4); ctx.quadraticCurveTo(-104, -30, -84, -34); ctx.lineTo(-30, -30); ctx.quadraticCurveTo(-18, -30, -22, -16); ctx.lineTo(-24, 2); ctx.quadraticCurveTo(-60, 8, -96, -4); ctx.closePath(); fillOut(ctx, RED, "#4a2d22", 2.4);
    ctx.beginPath(); ctx.moveTo(-100, 8); ctx.quadraticCurveTo(-60, 14, -20, 6); ctx.quadraticCurveTo(-10, 2, -8, -8); ctx.strokeStyle = GOLD2; ctx.lineWidth = 4; ctx.stroke();
    // sack of gifts + driver silhouette
    ell(ctx, -78, -40, 16, 12, -.2); fillOut(ctx, "#8a63d8", "#4a2d22", 2.2);
    ell(ctx, -46, -40, 10, 11, 0); fillOut(ctx, RED, "#4a2d22", 2.2); circ(ctx, -46, -55, 8); fillOut(ctx, "#f3cfae", "#4a2d22", 2.2);
    ctx.beginPath(); ctx.moveTo(-54, -58); ctx.quadraticCurveTo(-50, -74, -36, -70); ctx.lineTo(-38, -58); ctx.closePath(); fillOut(ctx, RED, "#4a2d22", 2); circ(ctx, -36, -70, 3.5); fillOut(ctx, "#fff", "#4a2d22", 1.5);
    rr(ctx, -56, -59, 20, 4.5, 2); fillOnly(ctx, "#fff");
    // sparkle trail
    const ga = ctx.globalAlpha;
    for (let i = 0; i < 5; i++) { const k = (t * .7 + i / 5) % 1; ctx.globalAlpha = ga * (1 - k); glint(ctx, -100 - k * 60, -10 + sin(i * 2.1 + t) * 12, 4 * (1 - k), "#ffe68c", t + i); }
    ctx.globalAlpha = ga;
  }
  function pondTile(ctx, t) {
    const w = 128, h = 40;
    ctx.fillStyle = "#b9ddf7"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#d9f1ff"; ctx.fillRect(0, 0, w, 14);
    ctx.fillStyle = "#9cc8ee"; ctx.fillRect(0, h - 10, w, 10);
    ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(w, 2); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(18, 8); ctx.lineTo(44, 14); ctx.lineTo(52, 26); ctx.moveTo(84, 6); ctx.lineTo(96, 16); ctx.lineTo(118, 20); ctx.stroke();
    const ga = ctx.globalAlpha;
    for (let i = 0; i < 4; i++) { const a = .5 + .5 * sin(t * 2.5 + i * 2); ctx.globalAlpha = ga * a; glint(ctx, 16 + i * 32, 5 + hash(i, 4) * 8, 3 * a, "#ffffff", 0); }
    ctx.globalAlpha = ga;
  }
  function groundTile(ctx, t) {
    const w = 128, h = 80;
    const g = grad(ctx, "ground", (c) => { const gg = c.createLinearGradient(0, 0, 0, h); gg.addColorStop(0, "#eef4ff"); gg.addColorStop(.3, "#d9e5ff"); gg.addColorStop(1, "#a9bbe8"); return gg; });
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.beginPath(); ctx.moveTo(0, 0); for (let i = 0; i <= 8; i++) ctx.lineTo(i * 16, 1.5 - 1.5 * cos(i * 16 / w * TAU * 2)); ctx.lineTo(w, 16); ctx.quadraticCurveTo(w / 2, 20, 0, 16); ctx.closePath(); fillOnly(ctx, SNOW);
    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 1); ctx.lineTo(w, 1); ctx.stroke();
    const ga = ctx.globalAlpha;
    for (let i = 0; i < 5; i++) { const a = .4 + .6 * abs(sin(t * 2 + i * 1.3)); ctx.globalAlpha = ga * a; glint(ctx, 10 + i * 26 + hash(i, 1) * 8, 4 + hash(i, 2) * 9, 2.6 * a, "#ffffff", 0); }
    ctx.globalAlpha = ga;
    ctx.fillStyle = "rgba(255,255,255,.35)"; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(8 + i * 22, 30 + hash(i, 5) * 40, 1.5, 0, TAU); ctx.fill(); }
  }
  function gingerGroundTile(ctx, t) {
    const w = 128, h = 80;
    const g = grad(ctx, "ginger", (c) => { const gg = c.createLinearGradient(0, 0, 0, h); gg.addColorStop(0, "#c67a42"); gg.addColorStop(1, "#8a4f27"); return gg; });
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // icing with drips
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, 10);
    for (let i = 4; i > 0; i--) { const x1 = i * 32, x0 = x1 - 32; ctx.quadraticCurveTo(x1 - 8, 24, x1 - 16, 22); ctx.quadraticCurveTo(x0 + 8, 20, x0, 10); }
    ctx.closePath(); fillOut(ctx, "#fff7ec", "#d9a8a0", 1.5);
    for (let i = 0; i < 6; i++) { ctx.save(); ctx.translate(10 + i * 21, 6 + hash(i, 8) * 8); ctx.rotate(hash(i, 9) * 3); rr(ctx, -3, -1.2, 6, 2.4, 1.2); fillOnly(ctx, CANDY[i % 6]); ctx.restore(); }
    ctx.fillStyle = "rgba(255,230,200,.25)"; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(12 + i * 20, 40 + hash(i, 6) * 32, 2, 0, TAU); ctx.fill(); }
  }
  function bauble(ctx, t, variant) {
    const col = CANDY[variant % 6];
    ctx.fillStyle = "#8a8f9a"; ctx.strokeStyle = OUT; ctx.lineWidth = 1.5; rr(ctx, -4, -20, 8, 7, 1.5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -21, 2.6, 0, TAU); ctx.lineWidth = 1.8; ctx.strokeStyle = OUT; ctx.stroke();
    circ(ctx, 0, 2, 16); fillOut(ctx, col);
    ctx.globalAlpha *= .45; ell(ctx, -6, -4, 4, 7, .4); fillOnly(ctx, "#ffffff"); ctx.globalAlpha /= .45;
    ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(0, 2, 10, 2.4, 3.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 2, 16, .2, .9); ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.stroke();
    glint(ctx, 7, -6, 3 + sin(t * 4 + variant), "rgba(255,255,255,.9)", t);
  }
  function pinecone(ctx) {
    ctx.fillStyle = "#6b4a2e"; ctx.fillRect(-1.5, -22, 3, 6);
    ell(ctx, 0, 2, 13, 18, 0); fillOut(ctx, "#8e5a33");
    ctx.strokeStyle = "#5a371f"; ctx.lineWidth = 1.8; ctx.lineCap = "round";
    for (let row = 0; row < 5; row++) { const y = -12 + row * 7, hw = 11 * M.sqrt(1 - ((y - 2) / 18) ** 2); const n = 2 + (row & 1); ctx.beginPath(); for (let i = 0; i < n; i++) { const x = -hw + 2 * hw * (i + .5) / n; ctx.moveTo(x - 4, y); ctx.quadraticCurveTo(x, y + 5, x + 4, y); } ctx.stroke(); }
    ctx.globalAlpha *= .3; ell(ctx, -5, -6, 3, 6, .3); fillOnly(ctx, "#ffffff"); ctx.globalAlpha /= .3;
  }
  function signpost(ctx, o) {
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -98); ctx.strokeStyle = OUT; ctx.lineWidth = 10 + LW * 2; ctx.stroke(); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 10; ctx.stroke();
    ctx.setLineDash(DASH); ctx.strokeStyle = RED; ctx.stroke(); ctx.setLineDash(EMPTY);
    circ(ctx, 0, -100, 6); fillOut(ctx, "#ffffff");
    // arrow sign pointing right
    ctx.beginPath(); ctx.moveTo(-24, -84); ctx.lineTo(18, -84); ctx.lineTo(30, -72); ctx.lineTo(18, -60); ctx.lineTo(-24, -60); ctx.closePath(); fillOut(ctx, o.theme === "peperkoek" ? "#f3a0c6" : "#c98747");
    starPath(ctx, -8, -72, 7, 0); fillOut(ctx, GOLD, "#a86f12", 1.4); dot(ctx, 8, -72, 3, "#fff6cf"); dot(ctx, 16, -72, 2, "#fff6cf");
    // snow caps
    ctx.beginPath(); ctx.moveTo(-26, -84); ctx.quadraticCurveTo(-10, -92, 10, -88); ctx.quadraticCurveTo(20, -88, 20, -84); ctx.closePath(); fillOut(ctx, SNOW, OUT_ICE, 1.4);
    // second small sign pointing left
    ctx.beginPath(); ctx.moveTo(14, -50); ctx.lineTo(-18, -50); ctx.lineTo(-26, -42); ctx.lineTo(-18, -34); ctx.lineTo(14, -34); ctx.closePath(); fillOut(ctx, o.theme === "peperkoek" ? "#7fd9bf" : "#a8713f");
    dot(ctx, -8, -42, 2.5, "#fff6cf"); dot(ctx, 2, -42, 2.5, "#fff6cf"); dot(ctx, 10, -42, 2.5, "#fff6cf");
  }
  function snowdrift(ctx, t, o) {
    const th = o.theme === "peperkoek";
    ctx.beginPath(); ctx.moveTo(-70, 2); ctx.bezierCurveTo(-62, -22, -40, -46, -8, -46); ctx.bezierCurveTo(16, -46, 22, -30, 34, -28);
    ctx.bezierCurveTo(50, -26, 62, -14, 70, 2); ctx.closePath(); fillOut(ctx, th ? "#fff7ec" : SNOW, th ? "#d9a8a0" : OUT_ICE, 1.8);
    ctx.globalAlpha *= .45; ell(ctx, 4, 4, 48, 18, 0); fillOnly(ctx, th ? "#ffe6d6" : SNOW2); ctx.globalAlpha /= .45;
    if (th) for (let i = 0; i < 7; i++) { ctx.save(); ctx.translate(-50 + i * 17, -22 + hash(i, 11) * 14); ctx.rotate(hash(i, 12) * 3); rr(ctx, -3.5, -1.3, 7, 2.6, 1.3); fillOnly(ctx, CANDY[i % 6]); ctx.restore(); }
    else { const ga = ctx.globalAlpha; for (let i = 0; i < 4; i++) { const a = .4 + .6 * abs(sin(t * 1.8 + i * 1.9)); ctx.globalAlpha = ga * a; glint(ctx, -40 + i * 27, -28 + hash(i, 13) * 14, 3 * a, "#ffffff", 0); } ctx.globalAlpha = ga; }
  }

  // name → { w, h, anchor, pad, draw(ctx, t, opts) }
  const SPRITES = {
    tree1: { w: 70, h: 120, anchor: "base", pad: 14, draw: (c, t, o) => pine(c, 3, 70, 120, o, t, 0) },
    tree2: { w: 90, h: 160, anchor: "base", pad: 16, draw: (c, t, o) => pine(c, 4, 90, 160, o, t, 1) },
    tree3: { w: 80, h: 200, anchor: "base", pad: 16, draw: (c, t, o) => pine(c, 5, 80, 200, o, t, 2) },
    giantTree: { w: 300, h: 520, anchor: "base", pad: 70, draw: giantTree },
    house: { w: 160, h: 150, anchor: "base", pad: 24, draw: house },
    log: { w: 70, h: 34, anchor: "base", pad: 8, draw: (c) => log(c) },
    icicles: { w: 90, h: 60, anchor: "center", pad: 10, draw: (c, t) => icicles(c, t) },
    snowman: { w: 70, h: 95, anchor: "base", pad: 12, draw: (c, t) => snowman(c, t) },
    gift: { w: 44, h: 44, anchor: "center", pad: 8, draw: (c, t, o) => gift(c, t, o.variant | 0) },
    candyCane: { w: 30, h: 60, anchor: "center", pad: 6, draw: (c) => candyCane(c) },
    star: { w: 36, h: 36, anchor: "center", pad: 10, draw: (c, t, o) => star(c, t, o.variant | 0) },
    bell: { w: 36, h: 40, anchor: "center", pad: 8, draw: (c, t, o) => bell(c, t, o.variant | 0) },
    moon: { w: 120, h: 120, anchor: "center", pad: 40, draw: moon },
    sleigh: { w: 200, h: 90, anchor: "center", pad: 40, draw: (c, t) => sleigh(c, t) },
    pondTile: { w: 128, h: 40, anchor: "topleft", pad: 0, draw: (c, t) => pondTile(c, t) },
    groundTile: { w: 128, h: 80, anchor: "topleft", pad: 0, draw: (c, t) => groundTile(c, t) },
    gingerGroundTile: { w: 128, h: 80, anchor: "topleft", pad: 0, draw: (c, t) => gingerGroundTile(c, t) },
    bauble: { w: 36, h: 44, anchor: "center", pad: 8, draw: (c, t, o) => bauble(c, t, o.variant | 0) },
    pinecone: { w: 30, h: 40, anchor: "center", pad: 4, draw: (c) => pinecone(c) },
    signpost: { w: 60, h: 110, anchor: "base", pad: 8, draw: (c, t, o) => signpost(c, o) },
    snowdrift: { w: 140, h: 50, anchor: "base", pad: 6, draw: snowdrift }
  };
  const sizes = {};
  for (const k in SPRITES) sizes[k] = { w: SPRITES[k].w, h: SPRITES[k].h, anchor: SPRITES[k].anchor };
  // sleigh anchor is its centre; the tile anchors are top-left (surface at y=0)
  function sprite(ctx, name, t, o) {
    const s = SPRITES[name]; if (!s) return;
    o = o || NOOPTS;
    const sc = o.scale || 1, fc = o.facing || 1;
    ctx.save();
    if (o.alpha != null && o.alpha !== 1) ctx.globalAlpha *= o.alpha;
    if (sc !== 1 || fc !== 1) ctx.scale(sc * fc, sc);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    s.draw(ctx, t || 0, o);
    ctx.restore();
  }

  // ---------- pre-render cache ----------
  const CACHE = new Map(); // name → Map(numericKey → canvas)
  const api = {};
  function themeIndex(th) { return th === "aurora" ? 1 : th === "peperkoek" ? 2 : 0; }
  function pre(name, scale, o) {
    const s = SPRITES[name]; if (!s || typeof document === "undefined") return null;
    o = o || NOOPTS; scale = scale || 1;
    const vkey = themeIndex(o.theme) * 64 + ((o.variant | 0) & 15) * 4 + (o.lit === false ? 1 : 0) + (o.wink ? 2 : 0);
    const key = vkey * 65536 + M.round(scale * 100);
    let m = CACHE.get(name); if (!m) { m = new Map(); CACHE.set(name, m); }
    let c = m.get(key); if (c) return c;
    const pad = s.pad, W = (s.w + pad * 2) * scale, H = (s.h + pad * 2) * scale;
    c = document.createElement("canvas"); c.width = M.ceil(W); c.height = M.ceil(H);
    const ox = s.anchor === "topleft" ? pad : s.w / 2 + pad, oy = s.anchor === "center" ? s.h / 2 + pad : s.anchor === "topleft" ? pad : s.h + pad;
    c.ox = ox * scale; c.oy = oy * scale; c.scale = scale; c.name = name;
    const g = c.getContext("2d"); g.scale(scale, scale); g.translate(ox, oy);
    // pre-renders are static: lights are drawn live by the caller when needed
    PRE_OPTS.theme = o.theme; PRE_OPTS.variant = o.variant | 0; PRE_OPTS.wink = !!o.wink; PRE_OPTS.lit = false;
    sprite(g, name, o.t || 0, PRE_OPTS);
    m.set(key, c); return c;
  }
  const PRE_OPTS = { theme: "nacht", variant: 0, wink: false, lit: false, scale: 1 };
  function blit(ctx, name, x, y, scale, o) {
    const d = api.dpr || 1, c = pre(name, (scale || 1) * d, o); if (!c) return;
    ctx.drawImage(c, x - c.ox / d, y - c.oy / d, c.width / d, c.height / d);
  }
  function clearCache() { CACHE.clear(); GRADS.clear(); GLOWS.clear(); AUR[0] = AUR[1] = null; AURC = null; for (const k in TH) { TH[k]._sky = null; TH[k]._mist = TH[k]._mist2 = null; } }

  // ---------- backgrounds ----------
  function groundY(h) { return api.groundPx != null ? api.groundPx : h * api.horizon; }
  const MOON = { x: 0, y: 0, r: 46 };
  function moonAt(w, h) { MOON.x = w * .78; MOON.y = groundY(h) * .2; MOON.r = 46 * .85; return MOON; }
  // aurora curtain textures (pre-rendered once; sliced + rippled per frame)
  const AUR = [null, null];
  function auroraTex(i) {
    if (AUR[i] || typeof document === "undefined") return AUR[i];
    const W = 512, H = 220, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    const lg = g.createLinearGradient(0, 0, 0, H);
    if (i === 0) { lg.addColorStop(0, "rgba(140,90,255,0)"); lg.addColorStop(.25, "rgba(150,100,255,.55)"); lg.addColorStop(.55, "rgba(70,230,150,.75)"); lg.addColorStop(.8, "rgba(140,255,200,.35)"); lg.addColorStop(1, "rgba(140,255,200,0)"); }
    else { lg.addColorStop(0, "rgba(255,120,200,0)"); lg.addColorStop(.3, "rgba(200,110,255,.45)"); lg.addColorStop(.6, "rgba(90,220,210,.6)"); lg.addColorStop(1, "rgba(90,220,210,0)"); }
    // vertical streaks as an alpha mask first, then the gradient through it (source-in keeps the gradient where streaks are)
    for (let x = 0; x < W; x += 2) { const a = .3 + .7 * (.5 + .5 * sin(x * .07 + i)) * (.55 + .45 * sin(x * .013 + i * 2)); g.fillStyle = "rgba(0,0,0," + a + ")"; g.fillRect(x, 0, 2, H); }
    g.globalCompositeOperation = "source-in";
    g.fillStyle = lg; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "source-over";
    AUR[i] = c; return c;
  }
  // sky gradient as a cached 1×h strip, stretched over the viewport (much cheaper than a gradient fill per frame)
  function skyStrip(T, h, gy) {
    const H = M.ceil(h);
    if (T._sky && T._skyH === H && T._skyGy === gy) return T._sky;
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas"); c.width = 1; c.height = H;
    const g = c.getContext("2d"), gg = g.createLinearGradient(0, 0, 0, gy + 40);
    for (let i = 0; i < 5; i++) gg.addColorStop(i / 4, T.sky[i]);
    g.fillStyle = gg; g.fillRect(0, 0, 1, H);
    T._sky = c; T._skyH = H; T._skyGy = gy; return c;
  }
  let AURC = null; // low-res aurora compose canvas
  function auroraDraw(ctx, sx, w, gy, t) {
    const S = 3, cw = M.ceil(w / S), ch = M.ceil(gy * .82 / S);
    if (!AURC || AURC.width !== cw || AURC.height !== ch) { if (typeof document === "undefined") return; AURC = document.createElement("canvas"); AURC.width = cw; AURC.height = ch; }
    const g = AURC.getContext("2d");
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.clearRect(0, 0, cw, ch); g.globalCompositeOperation = "lighter";
    for (let L = 0; L < 2; L++) {
      const tex = auroraTex(L); if (!tex) break;
      const sw = 8, cols = M.ceil(cw / sw) + 1, base = gy * (L ? .16 : .08) / S, hgt = gy * (L ? .5 : .62) / S, sp = L ? .18 : .3, off = sx * sp + t * (L ? 22 : 14);
      g.globalAlpha = L ? .5 : .72;
      for (let c = 0; c < cols; c++) {
        const x = c * sw, u = x * S + off, texX = ((u % 512) + 512) % 512;
        const dy = (26 * sin(u * .0045 + t * .8 + L) + 10 * sin(u * .013 - t * 1.6)) / S, hs = 1 + .14 * sin(u * .006 - t * .7 + L * 2);
        g.drawImage(tex, texX, 0, min(sw * S, 512 - texX), 220, x, base + dy, sw, hgt * hs);
      }
    }
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.drawImage(AURC, 0, 0, cw * S, ch * S); ctx.restore();
  }
  function skyLayer(ctx, sx, w, h, t, th, T) {
    const gy = groundY(h);
    const strip = skyStrip(T, h, gy), ga = ctx.globalAlpha;
    if (strip) ctx.drawImage(strip, 0, 0, w, h); else { ctx.fillStyle = T.sky[1]; ctx.fillRect(0, 0, w, h); }
    // dreamy clouds (very soft)
    const per = 1400;
    for (let k = -1; k <= M.ceil(w / per); k++) for (let i = 0; i < 4; i++) {
      const cx = ((i * 350 + hash(i, 20) * 200 - sx * (1 + i * .1) - t * (4 + i)) % per + per) % per + k * per, cy = gy * (.25 + hash(i, 21) * .45), r = 50 + hash(i, 22) * 60;
      if (cx + r * 1.8 < 0 || cx - r * 1.8 > w) continue;
      ctx.fillStyle = T.cloud;
      ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.6, r * .32, 0, 0, TAU); ctx.ellipse(cx - r * .5, cy - r * .1, r * .7, r * .3, 0, 0, TAU); ctx.ellipse(cx + r * .5, cy - r * .12, r * .6, r * .28, 0, 0, TAU); ctx.fill();
    }
    // stars (sprinkles in peperkoek)
    const sper = 1024, n = 70;
    for (let k = -1; k <= M.ceil(w / sper); k++) for (let i = 0; i < n; i++) {
      const x = ((i * 53 + hash(i, 1) * 48 - sx) % sper + sper) % sper + k * sper;
      if (x < -6 || x > w + 6) continue;
      const y = hash(i, 2) * gy * .88, big = hash(i, 3) > .86, tw = .55 + .45 * sin(t * (1.2 + hash(i, 4) * 2.2) + hash(i, 5) * TAU);
      if (th === "peperkoek") { ctx.save(); ctx.translate(x, y); ctx.rotate(hash(i, 6) * 3); rr(ctx, -3, -1.2, 6, 2.4, 1.2); fillOnly(ctx, CANDY[i % 6]); ctx.restore(); continue; }
      ctx.globalAlpha = ga * tw;
      if (big) { glint(ctx, x, y, 5.5 + 2 * tw, T.star, t * .3 + i); dot(ctx, x, y, 1.6, "#ffffff"); }
      else dot(ctx, x, y, .9 + hash(i, 7) * 1.3, T.star);
    }
    ctx.globalAlpha = ga;
    // aurora curtains (composed at 1/3 resolution → soft, then blended once)
    if (th === "aurora") auroraDraw(ctx, sx, w, gy, t);
    // moon
    const m = moonAt(w, h);
    ctx.save(); ctx.translate(m.x, m.y); ctx.scale(.85, .85); sprite(ctx, "moon", t, BG_OPTS(th, 0)); ctx.restore();
  }
  const _BGO = { theme: "nacht", variant: 0, lit: true, wink: false };
  function BG_OPTS(th, v) { _BGO.theme = th; _BGO.variant = v; _BGO.wink = !!api.moonWink; return _BGO; }
  function hillsLayer(ctx, sx, w, h, t, th, T) {
    const gy = groundY(h), per = 1800, ga = ctx.globalAlpha;
    // two rows of rounded hills: snow/icing colour first, then the hill colour shifted down → a bright rim on every top
    for (let row = 0; row < 2; row++) {
      const step = row ? 300 : 380, lift = row ? 1 : 1.35, scroll = sx * (row ? 1 : .8);
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass ? (row ? T.hillNear : T.hillFar) : T.hillSnow;
        ctx.globalAlpha = ga * (pass ? 1 : (th === "peperkoek" ? .95 : .7));
        const dy = pass ? (th === "peperkoek" ? 16 : 11) : 0;
        ctx.beginPath();
        for (let k = -1; k <= M.ceil(w / per) + 1; k++) for (let i = 0; i < per / step; i++) {
          const x = ((i * step + hash(i, 30 + row) * step * .6 - scroll) % per + per) % per + k * per - per * .5;
          const r = step * (.38 + hash(i, 32 + row) * .3), top = (50 + hash(i, 34 + row) * 120) * lift;
          if (x + r < -20 || x - r > w + 20) continue;
          ctx.moveTo(x + r, gy + 40 + dy); ctx.ellipse(x, gy + 40 + dy, r, top + 40, 0, 0, TAU);
        }
        ctx.fill();
      }
      ctx.globalAlpha = ga;
    }
    // mist at the base
    if (!T._mist || T._mistGy !== gy) { T._mist = ctx.createLinearGradient(0, gy - 90, 0, gy + 10); T._mist.addColorStop(0, T.mist + "0)"); T._mist.addColorStop(1, T.mist + ".75)"); T._mistGy = gy; }
    ctx.fillStyle = T._mist; ctx.fillRect(0, gy - 90, w, 100);
  }
  function forestLayer(ctx, sx, w, h, t, th, T) {
    const gy = groundY(h), step = 46, per = step * 32, ga = ctx.globalAlpha;
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? T.forest2 : T.forest;
      ctx.beginPath();
      for (let k = -1; k <= M.ceil(w / per); k++) for (let i = pass; i < 32; i += 2) {
        const x = ((i * step + hash(i, 40) * 20 - sx) % per + per) % per + k * per, th0 = 70 + hash(i, 41) * 110, hw = 20 + hash(i, 42) * 10;
        if (x + hw < 0 || x - hw > w) continue;
        if (th === "peperkoek") { // lollipop trees
          ctx.moveTo(x - 3, gy + 20); ctx.lineTo(x - 3, gy - th0 * .5); ctx.lineTo(x + 3, gy - th0 * .5); ctx.lineTo(x + 3, gy + 20); ctx.closePath();
          ctx.moveTo(x + hw, gy - th0 * .5 - hw * .3); ctx.arc(x, gy - th0 * .5 - hw * .3, hw * 1.05, 0, TAU);
          continue;
        }
        const yb = gy + 20;
        ctx.moveTo(x - hw, yb); ctx.lineTo(x - hw * .9, yb - th0 * .3); ctx.lineTo(x - hw * .55, yb - th0 * .33); ctx.lineTo(x - hw * .6, yb - th0 * .6);
        ctx.lineTo(x - hw * .3, yb - th0 * .62); ctx.lineTo(x, yb - th0); ctx.lineTo(x + hw * .3, yb - th0 * .62); ctx.lineTo(x + hw * .6, yb - th0 * .6);
        ctx.lineTo(x + hw * .55, yb - th0 * .33); ctx.lineTo(x + hw * .9, yb - th0 * .3); ctx.lineTo(x + hw, yb); ctx.closePath();
      }
      ctx.fill();
    }
    // a few warm window lights deep in the forest (cosy)
    if (th !== "peperkoek") for (let k = -1; k <= M.ceil(w / per); k++) for (let i = 0; i < 4; i++) {
      const x = ((i * 370 + hash(i, 44) * 120 - sx) % per + per) % per + k * per; if (x < 0 || x > w) continue;
      const a = .5 + .3 * sin(t * 1.5 + i); ctx.globalAlpha = ga * a; dot(ctx, x, gy - 14, 2.2, "#ffd36b"); ctx.globalAlpha = ga * a * .4; dot(ctx, x, gy - 14, 6, "#ffd36b"); ctx.globalAlpha = ga;
    }
    if (!T._mist2 || T._mist2Gy !== gy) { T._mist2 = ctx.createLinearGradient(0, gy - 40, 0, gy + 20); T._mist2.addColorStop(0, T.mist + "0)"); T._mist2.addColorStop(1, T.mist + ".55)"); T._mist2Gy = gy; }
    ctx.fillStyle = T._mist2; ctx.fillRect(0, gy - 40, w, 60);
  }
  function nearLayer(ctx, sx, w, h, t, th, T) {
    const gy = groundY(h), per = 2400, n = 10;
    for (let k = -1; k <= M.ceil(w / per); k++) for (let i = 0; i < n; i++) {
      const x = ((i * per / n + hash(i, 50) * 120 - sx) % per + per) % per + k * per;
      if (x < -200 || x > w + 200) continue;
      const r = hash(i, 51), sc = .8 + hash(i, 52) * .5;
      ctx.save(); ctx.translate(x, gy + 8);
      if (r > .86) { ctx.scale(.85, .85); blit(ctx, "house", 0, 0, 1, BG_OPTS(th, 0)); }
      else if (r > .78) { ctx.scale(.9, .9); sprite(ctx, "snowman", t, BG_OPTS(th, 0)); }
      else {
        const v = (i % 3) + 1, name = v === 1 ? "tree1" : v === 2 ? "tree2" : "tree3";
        ctx.scale(sc, sc); blit(ctx, name, 0, 0, 1, BG_OPTS(th, i));
        treeLights(ctx, v + 2, v === 1 ? 70 : v === 2 ? 90 : 80, v === 1 ? 120 : v === 2 ? 160 : 200, t + i, 3);
      }
      ctx.restore();
    }
  }
  function groundDecoLayer(ctx, sx, w, h, t, th, T) {
    const gy = groundY(h), per = 1600, ga = ctx.globalAlpha;
    // mounds
    for (let k = -1; k <= M.ceil(w / per); k++) for (let i = 0; i < 9; i++) {
      const x = ((i * per / 9 + hash(i, 60) * 100 - sx) % per + per) % per + k * per; if (x < -120 || x > w + 120) continue;
      const sc = .45 + hash(i, 61) * .45;
      ctx.save(); ctx.translate(x, gy + 6); ctx.scale(sc * (hash(i, 65) > .5 ? 1 : -1), sc * .8); sprite(ctx, "snowdrift", t + i, BG_OPTS(th, 0)); ctx.restore();
    }
    // bushes / gumdrops + candy canes
    for (let k = -1; k <= M.ceil(w / per); k++) for (let i = 0; i < 7; i++) {
      const x = ((i * per / 7 + hash(i, 62) * 160 - sx) % per + per) % per + k * per; if (x < -80 || x > w + 80) continue;
      const r = 14 + hash(i, 63) * 14;
      if (th === "peperkoek") {
        ctx.beginPath(); ctx.moveTo(x - r, gy + 4); ctx.quadraticCurveTo(x - r, gy - r * 1.5, x, gy - r * 1.5); ctx.quadraticCurveTo(x + r, gy - r * 1.5, x + r, gy + 4); ctx.closePath(); fillOut(ctx, CANDY[i % 6]);
        ctx.fillStyle = "rgba(255,255,255,.7)"; for (let j = 0; j < 5; j++) { ctx.beginPath(); ctx.arc(x - r * .6 + j * r * .3, gy - r * .3 - hash(j, i) * r * .8, 1.6, 0, TAU); ctx.fill(); }
      } else {
        ctx.beginPath(); ctx.moveTo(x - r, gy + 4); ctx.quadraticCurveTo(x - r * 1.05, gy - r * 1.3, x - r * .3, gy - r * 1.25); ctx.quadraticCurveTo(x, gy - r * 1.6, x + r * .35, gy - r * 1.3); ctx.quadraticCurveTo(x + r * 1.05, gy - r * 1.2, x + r, gy + 4); ctx.closePath(); fillOut(ctx, T.bush);
        ctx.beginPath(); ctx.moveTo(x - r * .75, gy - r * .85); ctx.quadraticCurveTo(x - r * .3, gy - r * 1.55, x + r * .1, gy - r * 1.3); ctx.quadraticCurveTo(x + r * .5, gy - r * 1.55, x + r * .75, gy - r * .9); ctx.quadraticCurveTo(x, gy - r * .55, x - r * .75, gy - r * .85); ctx.closePath(); fillOut(ctx, SNOW, OUT_ICE, 1.4);
        // berries
        dot(ctx, x - r * .4, gy - r * .45, 2.2, RED); dot(ctx, x + r * .3, gy - r * .35, 2.2, RED);
      }
      if (hash(i, 64) > .55) { ctx.save(); ctx.translate(x + r + 12, gy - 22); ctx.scale(.8, .8); ctx.rotate(.15); sprite(ctx, "candyCane", t, BG_OPTS(th, 0)); ctx.restore(); }
    }
    // sparkle on the ground line
    for (let i = 0; i < 12; i++) {
      const x = ((i * 130 + hash(i, 66) * 60 - sx) % per + per) % per; if (x > w) continue;
      const a = max(0, sin(t * 2.4 + i * 1.1)); if (a < .05) continue;
      ctx.globalAlpha = ga * a; glint(ctx, x, gy - 2 - hash(i, 67) * 6, 3.5 * a, "#ffffff", 0); ctx.globalAlpha = ga;
    }
  }
  function background(ctx, layer, scrollX, w, h, t, theme) {
    const th = TH[theme] ? theme : "nacht", T = TH[th]; t = t || 0; scrollX = scrollX || 0;
    ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (layer === 0) skyLayer(ctx, scrollX, w, h, t, th, T);
    else if (layer === 1) hillsLayer(ctx, scrollX, w, h, t, th, T);
    else if (layer === 2) forestLayer(ctx, scrollX, w, h, t, th, T);
    else if (layer === 3) nearLayer(ctx, scrollX, w, h, t, th, T);
    else groundDecoLayer(ctx, scrollX, w, h, t, th, T);
    ctx.restore();
  }

  api.ANIMALS = ANIMALS; api.NAMES = NAMES; api.THEMES = THEMES;
  api.animal = animal; api.animalBox = animalBox; api.sprite = sprite; api.sizes = sizes;
  api.background = background; api.groundY = groundY; api.moonAt = moonAt; api.pre = pre; api.blit = blit; api.clearCache = clearCache;
  api.horizon = .74; api.groundPx = null; api.moonWink = false;
  api.dpr = typeof window !== "undefined" && window.devicePixelRatio ? min(2, window.devicePixelRatio) : 1;
  api.ANIMS = ["idle", "run", "jump", "fall", "slide", "stumble", "fly", "happy"];
  api.SPRITE_NAMES = Object.keys(SPRITES);
  api.hash = hash;
  return api;
});
