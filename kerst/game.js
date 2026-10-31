/*
 * KerstGame — the KERSTDROOM runner (SPEC-4 §2/§3): physics, collectibles, power-ups, surprise events, ghosts, rendering.
 * UMD: browser global `window.KerstGame` + CommonJS `module.exports`. DOM only inside create() (Node can require() it).
 * Needs KerstLevel (kerst/level.js). KerstArt / KerstFX / KerstAudio are optional: without them the game draws simple
 * shapes, shows no particle effects and makes no sound.
 *
 * API
 *   KerstGame.create(canvas, opts) → game
 *     opts = { seed, difficulty: makkelijk|normaal|stoer, animal: hert|konijn|vos|uil, name, hat: null|"kerstmuts",
 *              fawnName, durationSec: null|90, hooks: { onPos(pos), onEvent(id, data), onEnd(result), onStats(stats),
 *              onCandyRain() }, drawText?: false, haptics?: true, autoPause?: true }
 *     game.start(atPerfNow|null)   null = start now; a performance.now() timestamp = countdown until then (phase "countdown")
 *     game.pause() / game.resume()  resume counts down 3-2-1 (state.countdown) before the world moves again
 *     game.input(type, detail?)    type ∈ tap | swipeDown | swipeUp | tapMoon   (detail {x,y} canvas px, optional: with
 *                                  KerstFX a tap on a big falling star = wish via fx.hitTest; without coordinates any tap
 *                                  while a star is catchable counts). tapMoon ×3 before the start = kerstmuts (+ fx "geheimpje").
 *     game.setGhosts([{ pid, name, animal, x, y, anim, stars, hearts }])   positions in WORLD units (x, y = height)
 *     game.setDroomster(frac)      0..1, shown by the HUD (state.droomster); the finale itself comes via triggerEvent
 *     game.triggerEvent(id, data)  start an event from outside (multiplayer): snoepregen / finale / any §3 id
 *     game.destroy()
 *     game.state                   read-only snapshot: { x, y, speed, stars, hearts, meters, phase, powerup, event, ghosts,
 *                                  obstaclesAhead:[{type,x,w,h,y0,needs,alt,dist,state}], combo, maxCombo, paused, countdown, prompt,
 *                                  t, anim, onGround, flip, theme, candies, bells, gifts, revived, wishWindow, droomster,
 *                                  candyRain, name, animal, difficulty, seed }
 *     game.advance(seconds)        test hook: run the fixed-step simulation without rAF/rendering
 *     game.grantPowerup(id)        test/debug hook: as if a gift with that power-up was picked up
 *     game.level, game.fx          the level instance and the KerstFX instance (or null)
 *   opts.drawText (default false): the game itself draws the countdown / "Tik om verder te dromen" / "Pauze" text in the
 *   canvas; ui.js normally renders these from state.countdown / state.prompt / state.paused instead.
 *   With KerstFX present the game delegates to it: candy rain + parachute gift are FX collectables (fx.collectables()),
 *   the catchable shooting stars are fx.wishes/fx.hitTest, the sleigh is drawn by FX; the game still draws the giant tree,
 *   the singing snowman, baubles, bells and the melody bells. Without FX the game draws simple versions of all of these.
 *   Phases: ready → countdown → run → (fading: 0 hearts, "Tik om verder te dromen") → run … → finale → end
 *   hooks.onEvent ids: the §3 ids (external ones carry data.external = true) plus powerup {id}, wens {stars}, revive,
 *   melodie {powerup}. hooks.onPos every 200 ms of game time: { x, y, anim, stars, hearts, pw, meters, t }.
 *   hooks.onEnd(result): { stars, meters, maxCombo, powerups, powerupList, events, candies, bells, gifts, hearts, revived,
 *   jumps, maxHeight, wishes, duration, name, animal, difficulty, seed }   (medals are assigned by the results screen)
 *   World units: see level.js. y = height above the ground. The fawn's feet are at (x, y).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KerstGame = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const G = root || {};

  function levelModule() {
    if (G.KerstLevel) return G.KerstLevel;
    if (typeof require === "function") { try { return require("./level.js"); } catch (e) { /* geen Node */ } }
    return null;
  }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const TAU = Math.PI * 2;

  // ---------- Constants (world units, seconds) ----------
  const DT = 1 / 120;
  const PHYS = {
    g: 2125, jumpV: 850, doubleV: 760, coyote: 0.1, buffer: 0.12, slideDur: 0.8, stumbleDur: 0.5, invuln: 1.5,
    gapDepth: 80, flyG: 450, flapV: 380, flyMinY: 120, flyMaxY: 480, assist: 0.25, stumbleSlow: 0.85, pondBoost: 1.12,
    sledBoost: 1.4, sledHover: 46, magnetR: 220, pickR: 56, scatterMax: 5, fadeTimeout: 8, glide: 0.45,
  };
  const PLAYER_BOX = { w: 56, h: 90, pad: 6 };
  const SLIDE_BOX = { w: 70, h: 44, pad: 6 };
  const POWERUPS = {
    sneeuwbol: { dur: 10, icon: "🛡️", color: "#8fd7ff", label: "Sneeuwbol" },
    sleetje: { dur: 8, icon: "🛷", color: "#ff7b7b", label: "Sleetje" },
    rendiervlucht: { dur: 10, icon: "🦌", color: "#ffd166", label: "Rendiervlucht" },
    magneet: { dur: 10, icon: "🧲", color: "#ff9bd3", label: "Magneet" },
    dubbelsterren: { dur: 10, icon: "✨", color: "#fff27a", label: "Dubbelsterren" },
    snoepregen: { dur: 6, icon: "🍬", color: "#ff8ac4", label: "Snoepregen" },
  };
  const POWERUP_IDS = Object.keys(POWERUPS);
  const EVENTS = {
    noorderlicht: 10, sterrenregen: 10, snoepregen: 6, peperkoek: 15, droomflip: 8, sneeuwbol: 5, rendiervlucht: 10,
    reuzenboom: 12, schaatsbaan: 8, kerstman: 8, sneeuwpop: 10, finale: 10,
  };
  const EVENT_POOL = ["noorderlicht", "sterrenregen", "peperkoek", "droomflip", "sneeuwbol", "rendiervlucht", "reuzenboom", "kerstman", "sneeuwpop"];
  // Vaste verrassingen op afstand; de rest komt (geseed) willekeurig uit EVENT_POOL, elk event eerst één keer.
  const MILESTONES = [{ m: 80, id: "noorderlicht" }, { m: 400, id: "reuzenboom" }, { m: 800, id: "droomflip" }];
  const EVENT_GAP = 10;
  const SCORE = { star: 1, candy: 3, gift: 5, bell: 2, bauble: 5, drop: 1, chute: 5, wish: 25, melody: 20, spin: 5 };
  const ANIMALS = ["hert", "konijn", "vos", "uil"];
  const NAMES = { hert: "Vlok", konijn: "Pluis", vos: "Snuf", uil: "Oeki" };
  // Sprite-ankers zoals KerstArt ze definieert (sizes[name].anchor): base = voeten op (0,0), center = midden, topleft = tegel
  const ANCHOR = { tree1: "base", tree2: "base", tree3: "base", giantTree: "base", house: "base", log: "base", snowman: "base", signpost: "base", snowdrift: "base", pondTile: "topleft", groundTile: "topleft", gingerGroundTile: "topleft" };
  const SIZES = { // fallback logical sizes (w, h) at scale 1
    tree1: { w: 110, h: 190 }, tree2: { w: 130, h: 230 }, tree3: { w: 90, h: 160 }, giantTree: { w: 520, h: 900 }, house: { w: 150, h: 150 },
    log: { w: 60, h: 36 }, icicles: { w: 90, h: 60 }, snowman: { w: 56, h: 78 }, gift: { w: 44, h: 44 }, candyCane: { w: 30, h: 60 },
    star: { w: 36, h: 36 }, bell: { w: 34, h: 40 }, moon: { w: 90, h: 90 }, sleigh: { w: 160, h: 70 }, pondTile: { w: 128, h: 40 },
    groundTile: { w: 128, h: 40 }, gingerGroundTile: { w: 128, h: 40 }, bauble: { w: 40, h: 46 }, pinecone: { w: 30, h: 40 },
    signpost: { w: 40, h: 120 }, snowdrift: { w: 120, h: 40 },
  };

  // ---------- Collision math (exported for tests) ----------
  function overlaps(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  function playerBox(x, y, sliding) {
    const B = sliding ? SLIDE_BOX : PLAYER_BOX;
    return { x: x - B.w / 2 + B.pad, y: y + 2, w: B.w - 2 * B.pad, h: B.h - B.pad - 2 };
  }
  function obstacleBox(o, wob) { return { x: o.x + (wob || 0) - o.w / 2, y: o.y0 || 0, w: o.w, h: o.h }; }
  function playerCenter(x, y, sliding) { return { x, y: y + (sliding ? 22 : 45) }; }

  // ---------- Fallback art (used when KerstArt is absent or lacks a sprite) ----------
  const FB = {
    colors: { hert: "#c4844a", konijn: "#dcdce6", vos: "#ef7d2d", uil: "#8b6a4e" },
    animal(ctx, kind, anim, t, o) {
      const s = (o && o.scale) || 1, col = FB.colors[kind] || "#c4844a";
      ctx.save();
      ctx.scale(s * ((o && o.facing) || 1), s);
      if (o && o.alpha != null) ctx.globalAlpha *= o.alpha;
      const run = anim === "run", slide = anim === "slide", fly = anim === "fly";
      const bob = run ? Math.sin(t * 14) * 3 : 0;
      const bodyY = slide ? -24 : -58 + bob;
      ctx.lineWidth = 3; ctx.strokeStyle = "#3a2418"; ctx.fillStyle = col;
      // Poten
      if (!slide) {
        for (let i = 0; i < 4; i++) {
          const ph = run ? Math.sin(t * 14 + i * 1.7) * 14 : anim === "jump" || fly ? -8 : 0;
          const lx = -22 + i * 14;
          ctx.beginPath(); ctx.moveTo(lx, bodyY + 10); ctx.lineTo(lx + ph * 0.5, -2); ctx.stroke();
        }
      }
      // Lijf
      const rot = anim === "stumble" ? -0.5 : fly ? -0.25 : 0;
      ctx.save(); ctx.translate(0, bodyY); ctx.rotate(rot);
      ctx.beginPath(); ctx.ellipse(0, 0, slide ? 44 : 34, slide ? 18 : 24, 0, 0, TAU); ctx.fill(); ctx.stroke();
      if (kind === "hert") { ctx.fillStyle = "#fff"; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(-16 + i * 8, -6 + (i % 2) * 8, 3, 0, TAU); ctx.fill(); } }
      if (fly) { ctx.fillStyle = "#f3e9d2"; ctx.beginPath(); ctx.ellipse(-6, -14, 24, 8, Math.sin(t * 20) * 0.6, 0, TAU); ctx.fill(); ctx.stroke(); }
      // Kop
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(30, -22, 17, 0, TAU); ctx.fill(); ctx.stroke();
      if (kind === "konijn") { ctx.beginPath(); ctx.ellipse(26, -46, 5, 16, -0.2, 0, TAU); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.ellipse(36, -44, 5, 16, 0.4, 0, TAU); ctx.fill(); ctx.stroke(); }
      else if (kind === "uil") { ctx.beginPath(); ctx.moveTo(20, -36); ctx.lineTo(24, -46); ctx.lineTo(30, -36); ctx.moveTo(34, -36); ctx.lineTo(40, -46); ctx.lineTo(42, -36); ctx.stroke(); }
      else { ctx.beginPath(); ctx.ellipse(22, -36, 5, 9, -0.6, 0, TAU); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.ellipse(38, -36, 5, 9, 0.6, 0, TAU); ctx.fill(); ctx.stroke(); }
      // Ogen & neus
      const blink = Math.sin(t * 1.3) > 0.97 ? 0.15 : 1;
      ctx.fillStyle = "#2b1a12"; ctx.beginPath(); ctx.ellipse(36, -24, 3.5, 4.5 * blink, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(37, -26, 1.3, 0, TAU); ctx.fill();
      ctx.fillStyle = kind === "uil" ? "#f2b134" : "#f28ca0"; ctx.beginPath(); ctx.arc(46, -18, 3.2, 0, TAU); ctx.fill();
      if (o && o.blush) { ctx.fillStyle = "rgba(255,120,140,.45)"; ctx.beginPath(); ctx.arc(40, -16, 5, 0, TAU); ctx.fill(); }
      if (o && o.hat === "kerstmuts") { ctx.fillStyle = "#e23b3b"; ctx.beginPath(); ctx.moveTo(16, -34); ctx.lineTo(44, -34); ctx.lineTo(24, -62); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(24, -62, 5, 0, TAU); ctx.fill(); }
      // Staart
      ctx.fillStyle = kind === "vos" ? "#fff" : col; ctx.beginPath(); ctx.arc(-34, -4, kind === "vos" ? 10 : 6, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.restore();
    },
    sprite(ctx, name, t, o) {
      const s = (o && o.scale) || 1;
      ctx.save(); ctx.scale(s, s);
      if (o && o.alpha != null) ctx.globalAlpha *= o.alpha;
      ctx.lineWidth = 3; ctx.strokeStyle = "#2b2a3a";
      const tri = (w, h, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(0, -h); ctx.lineTo(w / 2, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); };
      switch (name) {
        case "tree1": case "tree2": case "tree3": {
          const z = SIZES[name]; ctx.fillStyle = "#4a2f1c"; ctx.fillRect(-8, -30, 16, 30);
          tri(z.w, z.h, "#1f6b4a"); tri(z.w * 0.75, z.h * 0.72, "#2a8a5e");
          ctx.fillStyle = "#fff"; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(-z.w * 0.3 + i * z.w * 0.12, -z.h * 0.3 - (i % 3) * z.h * 0.15, 3, 0, TAU); ctx.fill(); }
          break;
        }
        case "giantTree": { tri(520, 900, "#1d6a48"); tri(420, 760, "#2a8a5e"); tri(300, 560, "#36a070");
          for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 60 + i * 24; ctx.fillStyle = ["#ff5c7a", "#ffd166", "#6fd3ff", "#ff9ad5"][i % 4]; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.5, -120 - i * 48 + Math.sin(a) * 20, 14 + 6 * Math.sin(t * 3 + i), 0, TAU); ctx.fill(); }
          ctx.fillStyle = "#fff27a"; ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * TAU / 5; ctx.lineTo(Math.cos(a) * 50, -900 + Math.sin(a) * 50); ctx.lineTo(Math.cos(a + TAU / 10) * 20, -900 + Math.sin(a + TAU / 10) * 20); } ctx.closePath(); ctx.fill();
          break; }
        case "house": ctx.fillStyle = "#b5713a"; ctx.fillRect(-60, -100, 120, 100); ctx.strokeRect(-60, -100, 120, 100); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(-72, -100); ctx.lineTo(0, -150); ctx.lineTo(72, -100); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#ffd98a"; ctx.fillRect(-40, -70, 26, 26); ctx.fillRect(14, -70, 26, 26); break;
        case "log": ctx.fillStyle = "#7a4a26"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-35, -34, 70, 34, 12) : ctx.rect(-35, -34, 70, 34); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(0, -32, 30, 5, 0, 0, TAU); ctx.fill(); break;
        case "icicles": ctx.fillStyle = "#5a3b22"; ctx.fillRect(-45, -30, 90, 14); ctx.fillStyle = "#cfefff"; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(-36 + i * 18, -16); ctx.lineTo(-24 + i * 18, -16); ctx.lineTo(-30 + i * 18, 30 - (i % 2) * 14); ctx.closePath(); ctx.fill(); ctx.stroke(); } break;
        case "snowman": ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, -22, 22, 0, TAU); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -58, 16, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#ff8f3c"; ctx.beginPath(); ctx.moveTo(4, -58); ctx.lineTo(18, -55); ctx.lineTo(4, -53); ctx.fill(); ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(-4, -62, 2, 0, TAU); ctx.arc(8, -62, 2, 0, TAU); ctx.fill(); break;
        case "pinecone": ctx.fillStyle = "#6b4423"; ctx.beginPath(); ctx.ellipse(0, 0, 14, 20, 0, 0, TAU); ctx.fill(); ctx.stroke(); break;
        case "star": { ctx.fillStyle = "#ffe36e"; ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * TAU / 5; ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18); ctx.lineTo(Math.cos(a + TAU / 10) * 8, Math.sin(a + TAU / 10) * 8); } ctx.closePath(); ctx.fill(); ctx.stroke(); break; }
        case "candyCane": ctx.lineWidth = 10; ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.moveTo(6, 30); ctx.lineTo(6, -10); ctx.arc(-4, -10, 10, 0, Math.PI, true); ctx.stroke(); ctx.strokeStyle = "#e23b3b"; ctx.setLineDash([6, 6]); ctx.stroke(); break;
        case "gift": ctx.fillStyle = "#e23b3b"; ctx.fillRect(-22, -22, 44, 44); ctx.strokeRect(-22, -22, 44, 44); ctx.fillStyle = "#ffd166"; ctx.fillRect(-5, -22, 10, 44); ctx.fillRect(-22, -4, 44, 8); break;
        case "bell": ctx.fillStyle = "#ffcf4a"; ctx.beginPath(); ctx.moveTo(-16, 14); ctx.quadraticCurveTo(-16, -20, 0, -20); ctx.quadraticCurveTo(16, -20, 16, 14); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#7a4a26"; ctx.beginPath(); ctx.arc(0, 16, 5, 0, TAU); ctx.fill(); break;
        case "bauble": ctx.fillStyle = (o && o.color) || "#ff5c7a"; ctx.beginPath(); ctx.arc(0, 4, 18, 0, TAU); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#ffd166"; ctx.fillRect(-5, -22, 10, 8); break;
        case "moon": ctx.fillStyle = "#fff4c2"; ctx.beginPath(); ctx.arc(0, 0, 44, 0, TAU); ctx.fill(); ctx.fillStyle = "#3a3450"; ctx.beginPath(); ctx.arc(-14, -8, 4, 0, TAU); ctx.fill(); if (o && o.wink) { ctx.lineWidth = 3; ctx.strokeStyle = "#3a3450"; ctx.beginPath(); ctx.moveTo(8, -8); ctx.lineTo(20, -8); ctx.stroke(); } else { ctx.beginPath(); ctx.arc(14, -8, 4, 0, TAU); ctx.fill(); } ctx.lineWidth = 3; ctx.strokeStyle = "#3a3450"; ctx.beginPath(); ctx.arc(0, 6, 14, 0.2, Math.PI - 0.2); ctx.stroke(); break;
        case "sleigh": ctx.fillStyle = "#2a2340"; ctx.beginPath(); ctx.moveTo(-80, 0); ctx.lineTo(-60, -30); ctx.lineTo(-10, -30); ctx.lineTo(0, -10); ctx.lineTo(80, -10); ctx.lineTo(80, 0); ctx.closePath(); ctx.fill(); for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(20 + i * 24, -24, 10, 6, 0, 0, TAU); ctx.fill(); } break;
        case "snowdrift": ctx.fillStyle = "#f4f9ff"; ctx.beginPath(); ctx.ellipse(0, 0, 60, 22, 0, Math.PI, TAU); ctx.fill(); break;
        case "signpost": ctx.fillStyle = "#7a4a26"; ctx.fillRect(-4, -110, 8, 110); ctx.fillStyle = "#e23b3b"; ctx.fillRect(-26, -104, 52, 22); ctx.fillStyle = "#fff"; ctx.fillRect(-26, -82, 52, 8); break;
        case "groundTile": case "pondTile": case "gingerGroundTile": ctx.fillStyle = name === "pondTile" ? "#b9e8ff" : name === "gingerGroundTile" ? "#b5713a" : "#f6fbff"; ctx.fillRect(0, 0, 128, 40); break;
        default: ctx.fillStyle = "#c9c"; ctx.fillRect(-16, -16, 32, 32);
      }
      ctx.restore();
    },
  };

  // ---------- Game ----------
  function create(canvas, opts) {
    opts = opts || {};
    const L = levelModule();
    if (!L) throw new Error("KerstLevel ontbreekt (laad kerst/level.js eerst)");
    const A = G.KerstArt || null;
    const FXM = G.KerstFX || null;
    const AU = G.KerstAudio || null;
    const hooks = Object.assign({}, opts.hooks || {});
    const seed = opts.seed == null ? 1 : opts.seed;
    const difficulty = L.DIFFS[opts.difficulty] ? opts.difficulty : "normaal";
    const animal = ANIMALS.indexOf(opts.animal) >= 0 ? opts.animal : "hert";
    const fawnName = opts.fawnName || "Vlok";
    const name = opts.name || (animal === "hert" ? fawnName : NAMES[animal]);
    let hat = opts.hat || null;
    const durationSec = opts.durationSec > 0 ? +opts.durationSec : null;
    const drawText = !!opts.drawText;
    const METER = L.METER;
    const level = L.generate(seed, difficulty);
    const rngEv = L.mulberry32(L.hashSeed(seed) ^ 0x5eed1e);
    const rngGame = L.mulberry32(L.hashSeed(seed) ^ 0x6a3e ^ (difficulty === "stoer" ? 7 : difficulty === "makkelijk" ? 3 : 0));
    const ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    let fx = null;
    if (FXM && typeof FXM.create === "function" && canvas) { try { fx = FXM.create(canvas); } catch (e) { fx = null; } }
    const reducedMotion = (() => { try { return !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } })();

    // Speler
    const P = { x: 0, y: 0, vy: 0, prevX: 0, prevY: 0, onGround: true, jumps: 0, coyote: 0, slide: 0, slideOnLand: false, stumble: 0, invuln: 0, anim: "idle", blush: 0, glide: 0, spin: 0, flap: false };
    // Run-status
    const S = {
      phase: "ready", t: 0, paused: false, countdown: null, startAt: null, resumeAt: null, speed: level.speedAt(0), meters: 0,
      stars: 0, hearts: 3, combo: 0, maxCombo: 0, bellCombo: 0, candies: 0, bells: 0, gifts: 0, wishes: 0, jumps: 0, maxHeight: 0,
      powerup: null, powerups: [], event: null, events: [], lastEventEnd: -Infinity, nextRandomAt: 16 + rngEv() * 10, milestones: {},
      revived: false, fade: 0, ending: 0, flipOwn: false, flipDelay: 0, flipT: 0, eventTheme: null, fly: null, sled: false,
      candyRain: 0, candyBy: null, rainAcc: 0, shootT: 0, shooters: [], wishWindow: false, drops: [], loose: [], extra: [],
      giant: null, singer: null, sleigh: null, droomster: 0, posTimer: 0, statsTimer: 0, statsKey: "", prompt: null,
      finaleStarted: false, finaleMarks: {}, onPond: false, ownShake: 0, moonTaps: 0, moonWink: 0, zoom: 1, camY: 0, ended: false,
      inputs: [], sfxAt: {}, pruneAt: 0, assistT: 0, result: null,
    };
    const ghosts = []; // { pid, name, animal, x, y, anim, stars, hearts, rx, ry, vx, at, trail:[] }
    let destroyed = false, raf = 0, lastNow = 0, acc = 0, dpr = 1, W = 0, H = 0, lastRenderNow = 0; // W=0 → eerste render meet het canvas
    const particles = []; // fallback particles when no FX

    // ---------- Helpers ----------
    const safe = (fn) => { try { return fn(); } catch (e) { return undefined; } };
    const sfx = (nm) => { if (!AU) return; const at = S.sfxAt[nm]; if (at != null && S.t - at < 0.05) return; S.sfxAt[nm] = S.t; safe(() => AU.play(nm)); };
    const vib = (p) => { if (opts.haptics === false) return; safe(() => { if (G.navigator && typeof G.navigator.vibrate === "function") G.navigator.vibrate(p); }); };
    const burst = (kind, x, y, n) => {
      if (fx && typeof fx.burst === "function") { safe(() => fx.burst(kind, x, y, n)); return; }
      for (let i = 0; i < Math.min(n || 6, 12); i++) particles.push({ x, y, vx: (Math.random() - 0.5) * 300, vy: 100 + Math.random() * 300, life: 0.6 + Math.random() * 0.4, kind });
    };
    const emit = (fn, a, b) => { if (typeof hooks[fn] === "function") { try { hooks[fn](a, b); } catch (e) { safe(() => console.error("[kerst] hook " + fn, e)); } } };
    const onPond = () => level.groundAt(P.x) === "pond";
    const theme = () => S.eventTheme || (fx && typeof fx.theme === "string" && fx.theme) || "nacht";
    const running = () => S.phase === "run" || S.phase === "finale";
    const active = () => running() || S.phase === "fading" || S.phase === "ending";
    const allNames = () => [name].concat(ghosts.map((g) => g.name).filter(Boolean));
    const setMusic = (m) => { if (AU && typeof AU.setMusic === "function") safe(() => AU.setMusic(m)); };

    // ---------- Input ----------
    function input(type, detail) {
      if (destroyed) return;
      if (AU && typeof AU.init === "function") safe(() => AU.init());
      if (type === "tapMoon") {
        S.moonWink = 1.2;
        if (S.phase === "ready" || S.phase === "countdown") { S.moonTaps++; if (S.moonTaps >= 3) { hat = "kerstmuts"; S.moonTaps = 0; if (fx) safe(() => fx.trigger("geheimpje", {})); sfx("twinkle"); } }
        return;
      }
      if (type !== "tap" && type !== "swipeDown" && type !== "swipeUp") return;
      S.inputs.push({ type, at: S.t, detail: detail || null });
      if (S.inputs.length > 8) S.inputs.shift();
    }

    function tryJump() {
      if (S.fly) { P.vy = PHYS.flapV; P.anim = "fly"; sfx("jump"); return true; }
      if (S.sled) return true; // sleetje zweeft: tikken doet niets, maar is niet 'mislukt'
      if (P.onGround || P.coyote > 0) {
        P.vy = PHYS.jumpV; P.onGround = false; P.coyote = 0; P.jumps = 1; P.slide = 0; P.anim = "jump";
        S.jumps++; sfx("jump"); burst("jump", P.x, 0, 5);
        return true;
      }
      if (P.jumps === 1) {
        P.vy = PHYS.doubleV; P.jumps = 2;
        if (animal === "uil") { P.anim = "fly"; P.glide = PHYS.glide; P.flap = true; } else P.anim = "jump";
        sfx("doubleJump"); burst("sparkle", P.x, P.y + 40, 6);
        if (onPond()) { P.spin = 0.6; addStars(SCORE.spin, "spin"); }
        return true;
      }
      return false;
    }
    function trySlide() {
      if (S.fly || S.sled) return true;
      if (P.onGround) { if (P.slide <= 0) sfx("whoosh"); P.slide = PHYS.slideDur; P.anim = "slide"; } // opnieuw vegen = langer glijden
      else { P.vy = Math.min(P.vy, -600); P.slideOnLand = true; }
      return true;
    }
    // Blijf laag zolang er iets boven je hangt (anders sta je midden onder een ijspegelrij op)
    function somethingOverhead(near) {
      const standing = playerBox(P.x, P.y, false);
      for (const o of near) if (o.needs === "slide" && overlaps(standing, obstacleBox(o, 0))) return true;
      return false;
    }
    function processInputs() {
      const keep = [];
      for (const inp of S.inputs) {
        let done = true;
        if (S.phase === "fading") { if (inp.type === "tap" || inp.type === "swipeUp") revive(); }
        else if (!running()) done = S.t - inp.at > PHYS.buffer;
        else if (inp.type === "swipeDown") trySlide();
        else {
          if (S.wishWindow && inp.type === "tap") grantWish(inp.detail);
          done = tryJump() || S.t - inp.at > PHYS.buffer; // bufferen tot de landing
        }
        if (!done) keep.push(inp);
      }
      S.inputs = keep;
    }

    // ---------- Scoring, items, power-ups ----------
    function addStars(n, why) { S.stars += n; S.statsKey = ""; return why; }
    function collect(it) {
      it.taken = true;
      const mult = (S.powerup && S.powerup.id === "dubbelsterren" ? 2 : 1) * (S.onPond ? 3 : 1);
      if (!it.optional) { S.combo++; if (S.combo > S.maxCombo) S.maxCombo = S.combo; }
      P.blush = 0.4;
      switch (it.kind) {
        case "star": addStars(SCORE.star * mult); sfx("star"); burst("star", it.x, it.y, 6); break;
        case "candy": S.candies++; addStars(SCORE.candy * mult); sfx("candy"); burst("candy", it.x, it.y, 6); break;
        case "drop": S.candies++; addStars(SCORE.drop); sfx("candy"); burst("candy", it.x, it.y, 4); break;
        case "gift": case "chute": S.gifts++; addStars(SCORE.gift); sfx("gift"); burst("confetti", it.x, it.y, 16); vib(20); grantPowerup(randomPowerup()); break;
        case "bell":
          S.bells++; S.bellCombo++; addStars(SCORE.bell * mult); sfx("bell"); burst("bell", it.x, it.y, 5);
          if (AU && typeof AU.melodyNote === "function") safe(() => AU.melodyNote(S.bellCombo - 1));
          if (S.bellCombo >= 5) melody();
          break;
        case "bauble": addStars(SCORE.bauble); sfx("twinkle"); burst("bauble", it.x, it.y, 10); break;
        default: addStars(1);
      }
    }
    function melody() {
      S.bellCombo = 0;
      addStars(SCORE.melody);
      sfx("fanfare"); burst("confetti", P.x, P.y + 60, 20);
      const pw = randomPowerup();
      grantPowerup(pw);
      emit("onEvent", "melodie", { powerup: pw });
    }
    function randomPowerup() {
      const cur = S.powerup && S.powerup.id;
      const pool = POWERUP_IDS.filter((id) => id !== cur && !(id === "rendiervlucht" && S.fly));
      return pool[Math.floor(rngGame() * pool.length)];
    }
    function grantPowerup(id, external) {
      if (!POWERUPS[id]) return;
      if (S.powerup) endPowerup(true);
      const dur = POWERUPS[id].dur;
      S.powerup = { id, left: dur, total: dur };
      S.powerups.push(id);
      sfx("powerup"); vib([15, 30, 15]); burst("powerup", P.x, P.y + 50, 12);
      if (id === "snoepregen") { startCandyRain(dur, name); if (!external) emit("onCandyRain"); if (fx) safe(() => fx.trigger("snoepregen", { by: name })); }
      else if (id === "rendiervlucht") startFly(dur);
      else if (id === "sleetje") { S.sled = true; P.slide = 0; P.anim = "slide"; }
      emit("onEvent", "powerup", { id, label: POWERUPS[id].label });
    }
    function endPowerup(replaced) {
      const pw = S.powerup; if (!pw) return;
      if (pw.id === "sleetje") { S.sled = false; P.onGround = false; P.vy = 0; P.invuln = Math.max(P.invuln, 1.2); } // zachte landing
      if (pw.id === "rendiervlucht" && S.fly && !replaced) endFly();
      if (pw.id === "rendiervlucht" && S.fly && replaced) endFly();
      S.powerup = null;
    }
    function startFly(dur) { if (S.sled) { S.sled = false; } S.fly = { left: dur, trail: 0 }; P.vy = 480; P.onGround = false; P.anim = "fly"; P.slide = 0; sfx("whoosh"); }
    function endFly() { S.fly = null; P.invuln = Math.max(P.invuln, 2.2); P.glide = 0; }
    function startCandyRain(dur, by) { S.candyRain = Math.max(S.candyRain, dur); S.candyBy = by || null; sfx("candy"); }

    function grantWish(detail) {
      if (fx && typeof fx.hitTest === "function") { // KerstFX tekent de grote vallende sterren zelf
        let hit = null;
        if (detail && typeof detail.x === "number" && typeof detail.y === "number") hit = safe(() => fx.hitTest(detail.x, detail.y));
        if (!hit) { const ws = safe(() => fx.wishes) || []; if (ws.length) hit = safe(() => fx.hitTest(ws[0].x, ws[0].y)); } // tik waar dan ook = wens (kindvriendelijk)
        if (!hit) return;
      } else {
        let sh = null;
        for (const s of S.shooters) if (!s.caught && s.window) { sh = s; break; }
        if (!sh) return;
        sh.caught = true;
      }
      S.wishWindow = false; S.wishes++;
      addStars(SCORE.wish); sfx("wish"); sfx("twinkle"); vib([10, 20, 10]); burst("wish", P.x, P.y + 160, 18);
      emit("onEvent", "wens", { stars: SCORE.wish, detail: detail || null });
    }

    // ---------- Hurt / revive / end ----------
    function scatter() {
      const n = Math.min(S.stars, PHYS.scatterMax);
      if (n <= 0) return;
      S.stars -= n;
      for (let i = 0; i < n; i++) {
        S.loose.push({ kind: "star", x: P.x + 10, y: P.y + 50, vx: S.speed * (0.7 + rngGame() * 0.7), vy: 250 + rngGame() * 350, cool: 0.5, life: 5, taken: false, optional: true });
      }
    }
    function hurt(reason) {
      if (P.invuln > 0 || !running()) return;
      if (S.powerup && S.powerup.id === "sneeuwbol") { endPowerup(); P.invuln = 1.0; sfx("powerup"); burst("shield", P.x, P.y + 50, 14); return; }
      S.hearts--; P.stumble = PHYS.stumbleDur; P.invuln = PHYS.invuln; P.slide = 0; S.combo = 0; S.bellCombo = 0;
      if (P.onGround) P.anim = "stumble";
      scatter(); sfx("hurt"); vib(40); burst("hurt", P.x, P.y + 40, 8);
      if (S.hearts <= 0) {
        S.hearts = 0;
        if (!S.revived) { S.phase = "fading"; S.fade = 0; S.prompt = "Tik om verder te dromen"; }
        else { S.phase = "ending"; S.ending = 1.6; S.prompt = "Goedemorgen!"; }
      }
      emit("onEvent", "hurt", { reason, hearts: S.hearts });
    }
    function revive() {
      if (S.phase !== "fading") return;
      S.hearts = 3; S.revived = true; S.prompt = null; P.invuln = 2.5; P.stumble = 0;
      S.phase = durationSec && S.finaleStarted ? "finale" : "run";
      sfx("revive"); burst("revive", P.x, P.y + 50, 20); vib([20, 40, 20]);
      emit("onEvent", "revive", {});
    }
    function result() {
      return {
        stars: S.stars, meters: Math.round(S.meters), maxCombo: S.maxCombo, powerups: S.powerups.length, powerupList: S.powerups.slice(),
        events: S.events.slice(), candies: S.candies, bells: S.bells, gifts: S.gifts, hearts: S.hearts, revived: S.revived,
        jumps: S.jumps, maxHeight: Math.round(S.maxHeight), wishes: S.wishes, duration: Math.round(S.t * 10) / 10,
        name, animal, difficulty, seed,
      };
    }
    function endRun() {
      if (S.ended) return;
      S.ended = true; S.phase = "end"; S.prompt = null; P.anim = "happy"; S.inputs = [];
      S.result = result();
      emit("onEnd", S.result);
    }

    // ---------- Events ----------
    function startEvent(id, data, external) {
      if (!EVENTS[id]) return false;
      if (S.event) { if (id === "finale" || external) endEvent(true); else return false; }
      data = Object.assign({}, data || {});
      if (external) data.external = true;
      let dur = EVENTS[id];
      if (id === "schaatsbaan") { const g = level.gapAt(P.x) ? null : level.nextPond(P.x - 1); dur = g ? Math.max(3, (g.x1 - P.x) / Math.max(1, S.speed)) : dur; }
      if (id === "finale") { if (durationSec) { S.phase = S.phase === "fading" ? "fading" : "finale"; S.finaleStarted = true; } else dur = data.duration || 5; data.names = data.names || allNames(); }
      S.event = { id, left: dur, total: dur, data };
      S.events.push(id);
      if (fx) safe(() => fx.trigger(id, Object.assign({ names: allNames(), by: name }, data)));
      if (AU && typeof AU.duck === "function") safe(() => AU.duck(700));
      switch (id) {
        case "noorderlicht": S.eventTheme = "aurora"; setMusic("aurora"); break;
        case "sterrenregen": S.shootT = 0.3; S.shooters = []; break;
        case "snoepregen": startCandyRain(dur, data.by || name); break;
        case "peperkoek": S.eventTheme = "peperkoek"; setMusic("peperkoek"); sfx("twinkle"); break;
        case "droomflip": S.flipDelay = 0.8; sfx("whoosh"); break;
        case "sneeuwbol": S.hearts = Math.min(3, S.hearts + 1); S.ownShake = 4; sfx("revive"); break;
        case "rendiervlucht": if (!S.fly) startFly(dur); else S.fly.left = Math.max(S.fly.left, dur); break;
        case "reuzenboom": S.giant = { x: P.x + 900, px0: P.x, life: 40 }; // parallax ½: komt in ~3 s in beeld en schuift ~5 s voorbij
          for (let i = 0; i < 6; i++) S.extra.push({ kind: "bauble", x: P.x + 700 + i * 170, y: 160 + ((i * 2) % 3) * 60, taken: false, optional: true, variant: i, color: ["#ff5c7a", "#ffd166", "#6fd3ff", "#ff9ad5"][i % 4] });
          break;
        case "schaatsbaan": sfx("twinkle"); break;
        case "kerstman": S.sleigh = { t: 0, dur, dropped: false }; sfx("bell"); break;
        case "sneeuwpop": S.singer = { x: P.x + 420, life: 14, note: 0 };
          for (let i = 0; i < 5; i++) S.extra.push({ kind: "bell", x: P.x + 820 + i * S.speed * 0.6, y: 90 + i * 22, taken: false, melody: true });
          S.bellCombo = 0; break;
        case "finale": sfx("fanfare"); vib([30, 60, 30, 60, 30]); break;
      }
      emit("onEvent", id, data);
      return true;
    }
    function endEvent(replaced) {
      const ev = S.event; if (!ev) return;
      switch (ev.id) {
        case "noorderlicht": case "peperkoek": S.eventTheme = null; setMusic("nacht"); break;
        case "droomflip": S.flipOwn = false; S.flipDelay = 0; break;
        case "finale": if (durationSec && S.phase === "finale" && !replaced) endRun(); break;
      }
      S.event = null;
      if (ev.id !== "schaatsbaan") { // de schaatsbaan is terrein: telt niet mee voor de 10 s rust tussen verrassingen
        S.lastEventEnd = S.t;
        S.nextRandomAt = S.t + EVENT_GAP + 2 + rngEv() * 6;
      }
    }
    // Mag er nu een nieuw event beginnen? Nooit twee tegelijk, minstens EVENT_GAP s na het vorige, niet vlak voor de finale.
    function canStartEvent(ignoreGap) {
      if (S.event || S.phase !== "run" || S.t < 6) return false;
      if (durationSec && S.t > durationSec - 22) return false;
      return ignoreGap || S.t - S.lastEventEnd >= EVENT_GAP;
    }
    // Seconden tot de volgende vijver (de schaatsbaan krijgt voorrang: start niets dat dan nog bezig zou zijn)
    function pondIn() {
      const pond = level.nextPond(P.x);
      if (!pond) return Infinity;
      return pond.x0 > P.x ? (pond.x0 - P.x) / Math.max(1, S.speed) : 0; // 0 = we staan er al op (deze stap ingestapt)
    }
    function maybeStartEvent() {
      if (!canStartEvent()) return;
      const tp = pondIn();
      for (const ms of MILESTONES) {
        if (!S.milestones[ms.m] && S.meters >= ms.m) {
          if (EVENTS[ms.id] + 1 > tp) return; // wacht tot na de vijver
          if (startEvent(ms.id, { milestone: ms.m })) { S.milestones[ms.m] = true; return; }
        }
      }
      if (S.t >= S.nextRandomAt) {
        const fits = (id) => EVENTS[id] + 1 <= tp && !(id === "rendiervlucht" && (S.fly || S.sled));
        let pool = EVENT_POOL.filter((id) => S.events.indexOf(id) < 0 && fits(id)); // eerst alles één keer
        if (!pool.length) { const last = S.events.slice(-2); pool = EVENT_POOL.filter((id) => last.indexOf(id) < 0 && fits(id)); }
        if (pool.length) startEvent(pool[Math.floor(rngEv() * pool.length)], { random: true });
      }
    }
    function startFinale(data) {
      if (!durationSec && S.event) return; // solo: alleen als er niets anders aan de hand is
      S.finaleStarted = true;
      startEvent("finale", Object.assign({ names: allNames() }, data || {}), !!(data && data.external));
    }
    function triggerEvent(id, data) {
      if (destroyed || !active()) return false;
      data = Object.assign({}, data || {}, { external: true });
      if (id === "snoepregen") { startCandyRain(EVENTS.snoepregen, data.by || null); if (fx) safe(() => fx.trigger("snoepregen", data)); emit("onEvent", "snoepregen", data); return true; }
      if (id === "finale") { startFinale(data); return true; }
      return startEvent(id, data, true);
    }

    // ---------- Simulation step ----------
    function step(dt) {
      const ts = S.phase === "fading" ? 0.3 : S.phase === "ending" ? 0.4 : 1;
      const h = dt * ts;
      S.t += dt;
      P.prevX = P.x; P.prevY = P.y;
      level.ensure(P.x + Math.max(4000, S.speed * 18)); // ver genoeg vooruit voor de vijver-planning (langste event 15 s)
      if (S.t > S.pruneAt) { S.pruneAt = S.t + 2; level.prune(P.x - 200); }

      processInputs();
      if (S.phase === "fading") { S.fade += dt; if (S.fade > PHYS.fadeTimeout) endRun(); }
      if (S.phase === "ending") { S.ending -= dt; if (S.ending <= 0) endRun(); }
      if (S.phase === "end") return;

      // Snelheid
      S.onPond = onPond();
      let target = level.speedAt(P.x);
      if (S.sled) target *= PHYS.sledBoost;
      if (S.onPond) target *= PHYS.pondBoost;
      if (P.stumble > 0) target *= PHYS.stumbleSlow;
      S.speed += (target - S.speed) * Math.min(1, h * 6);
      P.x += S.speed * h;
      S.meters = P.x / METER;

      // Verticaal
      if (S.fly) {
        const vy0 = P.vy; P.vy -= PHYS.flyG * h; P.y += (vy0 + P.vy) / 2 * h;
        if (P.y < PHYS.flyMinY) { P.y = PHYS.flyMinY; P.vy = Math.max(P.vy, 0); }
        if (P.y > PHYS.flyMaxY) { P.y = PHYS.flyMaxY; P.vy = Math.min(P.vy, 0); }
        P.onGround = false; P.anim = "fly";
        S.fly.left -= h; S.fly.trail -= h;
        if (S.fly.trail <= 0) {
          S.fly.trail = 0.45;
          const by = clamp(P.y + Math.sin(S.t * 1.7) * 140, 120, 460);
          for (let i = 0; i < 5; i++) S.extra.push({ kind: "star", x: P.x + S.speed * 1.5 + i * 64, y: clamp(by + Math.sin(i * 0.9) * 50, 100, 480), taken: false, optional: true });
        }
        if (S.fly.left <= 0) { endFly(); if (S.powerup && S.powerup.id === "rendiervlucht") S.powerup = null; }
      } else if (S.sled) {
        P.y += (PHYS.sledHover - P.y) * Math.min(1, h * 8); P.vy = 0; P.onGround = false; P.anim = "slide";
      } else {
        if (P.onGround) {
          const gap = level.gapAt(P.x);
          if (gap && P.x > gap.x0 + 6 && P.x < gap.x1 - 6) { P.onGround = false; P.coyote = PHYS.coyote; P.vy = 0; }
        }
        if (!P.onGround) {
          const g = PHYS.g * (P.glide > 0 && P.vy < 0 ? 0.45 : 1);
          const vy0 = P.vy; P.vy -= g * h; P.y += (vy0 + P.vy) / 2 * h; // exact voor constante versnelling
          if (P.coyote > 0) P.coyote -= h;
          if (P.glide > 0) P.glide -= h;
          if (P.y > S.maxHeight) S.maxHeight = P.y;
          if (P.y <= 0 && P.vy <= 0) {
            const g2 = level.gapAt(P.x);
            if (!g2 || P.x <= g2.x0 + 6 || P.x >= g2.x1 - 6) land();
            else if (P.y < -PHYS.gapDepth) splash(g2);
          }
          if (!P.onGround) P.anim = P.flap || (P.glide > 0 && P.vy < 0) ? "fly" : P.vy > 0 ? "jump" : "fall";
        } else {
          P.y = 0; P.vy = 0;
          if (P.slide > 0) { P.slide -= h; P.anim = "slide"; if (P.slide <= 0 && somethingOverhead(level.query(P.x - 200, P.x + 200).obstacles)) P.slide = 0.05; }
          else P.anim = P.stumble > 0 ? "stumble" : "run";
        }
      }
      if (P.stumble > 0) { P.stumble -= h; if (P.onGround && !S.sled) P.anim = "stumble"; }
      if (P.invuln > 0) P.invuln -= h;
      if (P.blush > 0) P.blush -= h;
      if (P.spin > 0) P.spin -= h;
      if (S.ownShake > 0) S.ownShake -= h;
      if (S.moonWink > 0) S.moonWink -= dt;

      // Hindernissen: dennenappels, sneeuwpoppen, botsingen, auto-spring hulp
      const near = level.query(P.x - 200, P.x + S.speed * 2.6 + 200).obstacles;
      let assistTarget = null;
      for (const o of near) {
        if (o.type === "pinecone") {
          if (!o.state) o.state = "hang";
          const dist = o.x - P.x;
          if (o.state === "hang" && dist < S.speed * 1.0) { o.state = "fall"; o.fy = L.OBST.pinecone.dropY; o.fvy = 0; }
          if (o.state === "fall") { o.fvy -= PHYS.g * h; o.fy += o.fvy * h; if (o.fy <= 0) { o.fy = 0; o.state = "landed"; burst("snow", o.x, 0, 6); } }
        }
        if (difficulty === "makkelijk" && !assistTarget) {
          const edge = o.x - o.w / 2 - P.x;
          if (edge > 0 && edge < S.speed * PHYS.assist) assistTarget = o;
        }
      }
      // Makkelijk: hulpje als het kind nog niets deed — springen voor stam/dennenappel/gat, bukken voor de sneeuwpop.
      if (difficulty === "makkelijk" && running() && !S.fly && !S.sled && P.onGround && P.slide <= 0 && S.inputs.length === 0 && S.assistT <= 0) {
        const gap = level.gapAt(P.x) ? null : nextGap(P.x, S.speed * PHYS.assist);
        if (assistTarget && assistTarget.needs === "slide") { /* ijspegels: zelf vegen */ }
        else if (assistTarget && assistTarget.alt === "slide") { trySlide(); S.assistT = 0.3; }
        else if (assistTarget || gap) { tryJump(); S.assistT = 0.3; }
      }
      if (S.assistT > 0) S.assistT -= h;
      if (running() && !S.fly && !S.sled && P.invuln <= 0) {
        const pb = playerBox(P.x, P.y, P.slide > 0);
        for (const o of near) {
          if (o.type === "pinecone" && o.state !== "landed") continue;
          const wob = o.type === "snowman" ? Math.sin(S.t * 2 + o.phase) * L.OBST.snowman.wobble : 0;
          if (overlaps(pb, obstacleBox(o, wob))) { hurt(o.type); break; }
        }
      }

      // Verzamelen
      pickups(h);

      // Timers: power-up, event, snoepregen, sterrenregen, kerstman, flip
      if (S.powerup) { S.powerup.left -= h; if (S.powerup.left <= 0) endPowerup(); }
      if (S.event) { S.event.left -= h; if (S.event.left <= 0) endEvent(); }
      // Snoepregen, vallende sterren en het parachute-cadeau: KerstFX tekent ze zelf (fx.collectables / fx.wishes);
      // zonder FX doet het spel het met eigen eenvoudige vormen.
      if (S.candyRain > 0) {
        S.candyRain -= h; S.rainAcc += h * 7;
        while (S.rainAcc >= 1) { S.rainAcc -= 1; if (!fx) S.drops.push({ kind: "drop", x: P.x - 60 + rngGame() * 820, y: 520 + rngGame() * 160, vy: -(240 + rngGame() * 160), sway: rngGame() * TAU, taken: false, optional: true }); }
      }
      if (S.event && S.event.id === "sterrenregen" && !fx) {
        S.shootT -= h;
        if (S.shootT <= 0) { S.shootT = 2.2; S.shooters.push({ t: 0, caught: false, window: false, side: rngGame() < 0.5 ? -1 : 1 }); }
      }
      S.wishWindow = false;
      for (const sh of S.shooters) { sh.t += h; sh.window = !sh.caught && sh.t > 0.9 && sh.t < 1.9; if (sh.window) S.wishWindow = true; }
      S.shooters = S.shooters.filter((sh) => sh.t < 2.6);
      if (fx) { const ws = safe(() => fx.wishes); S.wishWindow = !!(ws && ws.length); }
      if (S.sleigh) {
        S.sleigh.t += h;
        if (!S.sleigh.dropped && S.sleigh.t > 2.4) { S.sleigh.dropped = true; if (!fx) S.extra.push({ kind: "chute", x: P.x + S.speed * 2.6, y: 470, vy: -95, sway: 0, taken: false, optional: true }); }
        if (S.sleigh.t > S.sleigh.dur + 2) S.sleigh = null;
      }
      if (S.giant) { S.giant.life -= h; if (S.giant.life <= 0) S.giant = null; }
      if (S.singer) { S.singer.life -= h; if (S.singer.life <= 0) S.singer = null; }
      if (S.flipDelay > 0) { S.flipDelay -= h; if (S.flipDelay <= 0 && S.event && S.event.id === "droomflip") S.flipOwn = true; }
      const flipWanted = (fx && fx.gravityFlip === true) || S.flipOwn;
      S.flipT += ((flipWanted ? 1 : 0) - S.flipT) * Math.min(1, dt * (reducedMotion ? 8 : 3));
      if (Math.abs(S.flipT - (flipWanted ? 1 : 0)) < 0.002) S.flipT = flipWanted ? 1 : 0;

      // Schaatsbaan: begint bij het betreden van de vijver
      if (S.onPond && !S.wasPond && canStartEvent(true)) startEvent("schaatsbaan", {}); // terrein-event: alleen 'nooit twee tegelijk'
      S.wasPond = S.onPond;

      // Vuurwerk: multiplayer laatste 10 s, solo elke 500 m
      if (durationSec) {
        if (!S.finaleStarted && S.t >= durationSec - 10) startFinale();
        if (S.t >= durationSec) endRun();
      } else {
        const mark = Math.floor(S.meters / 500);
        if (mark > 0 && !S.finaleMarks[mark] && canStartEvent() && pondIn() > EVENTS.finale + 1) { S.finaleMarks[mark] = true; startEvent("finale", { names: allNames(), solo: true, meters: mark * 500 }); }
      }
      maybeStartEvent();

      // Hooks
      S.posTimer += dt;
      if (S.posTimer >= 0.2) { S.posTimer -= 0.2; emit("onPos", { x: P.x, y: P.y, anim: P.anim, stars: S.stars, hearts: S.hearts, pw: S.powerup ? S.powerup.id : null, meters: Math.round(S.meters), t: S.t }); }
      S.statsTimer += dt;
      if (S.statsTimer >= 0.1) {
        S.statsTimer = 0;
        const key = [S.stars, S.hearts, S.powerup && S.powerup.id, S.combo, S.phase, Math.floor(S.meters / 10), S.event && S.event.id].join("|");
        if (key !== S.statsKey) { S.statsKey = key; emit("onStats", stats()); }
      }
    }
    function nextGap(x, within) {
      const gs = level.grounds;
      for (let i = 0; i < gs.length; i++) { const g = gs[i]; if (g.x1 < x) continue; if (g.x0 > x + within) break; if (g.kind === "gap" && g.x0 >= x) return g; }
      return null;
    }
    function land() {
      P.y = 0; P.vy = 0; P.onGround = true; P.jumps = 0; P.glide = 0; P.coyote = 0; P.flap = false;
      if (P.slideOnLand) { P.slide = PHYS.slideDur; P.slideOnLand = false; P.anim = "slide"; }
      sfx("land"); burst("land", P.x, 0, 4);
    }
    function splash(gap) {
      P.x = gap.x1 + 40; P.y = 0; P.vy = 0; P.onGround = true; P.jumps = 0; P.slideOnLand = false;
      burst("splash", gap.x1, 0, 12);
      hurt("gap");
    }
    function pickups(h) {
      const sliding = P.slide > 0;
      const c = playerCenter(P.x, P.y, sliding);
      const magnet = !!(S.powerup && S.powerup.id === "magneet");
      const lists = [level.query(P.x - 140, P.x + 300).items, S.extra, S.drops, S.loose];
      for (const list of lists) {
        for (const it of list) {
          if (it.taken) continue;
          if (it.kind === "drop") { it.y += it.vy * h; it.x += Math.sin(S.t * 3 + it.sway) * 40 * h; if (it.y < 8) { it.y = 8; it.vy = 0; } }
          else if (it.kind === "chute") { it.y += it.vy * h; it.x += Math.sin(S.t * 2) * 25 * h; if (it.y < 30) { it.y = 30; it.vy = 0; } }
          else if (it.vx !== undefined) { // losse ster
            it.vy -= PHYS.g * h; it.x += it.vx * h; it.y += it.vy * h;
            if (it.y < 12) { it.y = 12; it.vy = -it.vy * 0.4; it.vx *= 0.7; }
            it.cool -= h; it.life -= h;
          }
          const dx = it.x - c.x, dy = it.y - c.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (magnet && d < PHYS.magnetR && d > 1) { const k = Math.min(1, h * 9); it.x -= dx * k; it.y -= dy * k; }
          if (d < PHYS.pickR && !(it.cool > 0)) { collect(it); continue; }
          if (!it.missed && it.x < P.x - 90) {
            it.missed = true;
            if (!it.optional && (it.kind === "star" || it.kind === "candy" || it.kind === "bell")) S.combo = 0;
            if (it.kind === "bell") S.bellCombo = 0;
          }
        }
      }
      // Snoep/cadeau dat KerstFX laat vallen (wereld-coördinaten, take() = opgepakt)
      if (fx && typeof fx.collectables === "function") {
        const cols = safe(() => fx.collectables()) || [];
        for (const it of cols) {
          const dx = it.x - c.x, dy = it.y - c.y;
          if (dx * dx + dy * dy < (PHYS.pickR + (it.r || 0) * 0.5) ** 2) { safe(() => it.take()); collect({ kind: it.kind === "gift" ? "chute" : "drop", x: it.x, y: it.y, optional: true }); }
        }
      }
      const behind = P.x - 600;
      if (S.extra.length) S.extra = S.extra.filter((it) => !it.taken && it.x > behind);
      if (S.drops.length) S.drops = S.drops.filter((it) => !it.taken && it.x > behind);
      if (S.loose.length) S.loose = S.loose.filter((it) => !it.taken && it.x > behind && it.life > 0);
    }

    // ---------- Public state ----------
    function obstaclesAhead() {
      const out = [];
      const x0 = P.x - 60, x1 = P.x + S.speed * 2.5 + 200;
      for (const o of level.query(x0 - 100, x1 + 100).obstacles) {
        const wob = o.type === "snowman" ? Math.sin(S.t * 2 + o.phase) * L.OBST.snowman.wobble : 0;
        const b = obstacleBox(o, wob);
        if (b.x + b.w < P.x - 10 || b.x > x1) continue;
        out.push({ type: o.type, x: b.x, w: b.w, h: b.h, y0: b.y, needs: o.needs, alt: o.alt || null, dist: b.x - P.x, state: o.state || null });
      }
      for (const g of level.grounds) {
        if (g.kind !== "gap" || g.x1 < P.x - 10 || g.x0 > x1) continue;
        out.push({ type: "gap", x: g.x0, w: g.x1 - g.x0, h: 0, y0: 0, needs: "jump", alt: null, dist: g.x0 - P.x, state: null });
      }
      out.sort((a, b) => a.x - b.x);
      return out;
    }
    function ghostList() { return ghosts.map((g) => ({ pid: g.pid, name: g.name, animal: g.animal, x: g.rx, y: g.ry, anim: g.anim, stars: g.stars, hearts: g.hearts })); }
    function stats() {
      return {
        stars: S.stars, hearts: S.hearts, meters: Math.round(S.meters), combo: S.combo, maxCombo: S.maxCombo, phase: S.phase,
        powerup: S.powerup ? { id: S.powerup.id, left: S.powerup.left, total: S.powerup.total, icon: POWERUPS[S.powerup.id].icon, label: POWERUPS[S.powerup.id].label } : null,
        event: S.event ? { id: S.event.id, left: S.event.left, total: S.event.total } : null,
        candies: S.candies, bells: S.bells, gifts: S.gifts, revived: S.revived, droomster: S.droomster,
      };
    }
    function state() {
      const st = stats();
      st.x = P.x; st.y = P.y; st.speed = S.speed; st.paused = S.paused; st.countdown = S.countdown; st.prompt = S.prompt; st.t = S.t;
      st.anim = P.anim; st.onGround = P.onGround; st.flip = S.flipT; st.theme = theme(); st.wishWindow = S.wishWindow;
      st.candyRain = S.candyRain > 0; st.ghosts = ghostList(); st.obstaclesAhead = obstaclesAhead();
      st.name = name; st.animal = animal; st.difficulty = difficulty; st.seed = seed; st.hat = hat; st.invuln = P.invuln > 0;
      st.flying = !!S.fly; st.sled = S.sled; st.onPond = S.onPond; st.bellCombo = S.bellCombo; st.result = S.result;
      return st;
    }

    // ---------- Ghosts ----------
    function setGhosts(list) {
      list = Array.isArray(list) ? list : [];
      const seen = {};
      for (const g of list) {
        if (!g || g.pid == null) continue;
        seen[g.pid] = true;
        let gh = ghosts.find((x) => x.pid === g.pid);
        const x = +g.x || 0, y = +g.y || 0;
        if (!gh) { gh = { pid: g.pid, rx: x, ry: y, vx: 0, trail: [] }; ghosts.push(gh); }
        else { const age = Math.max(0.05, S.t - gh.at); gh.vx = clamp((x - gh.x) / age, 0, 900); }
        gh.name = g.name || "?"; gh.animal = ANIMALS.indexOf(g.animal) >= 0 ? g.animal : "hert"; gh.x = x; gh.y = y; gh.anim = g.anim || "run";
        gh.stars = g.stars | 0; gh.hearts = g.hearts == null ? 3 : g.hearts | 0; gh.at = S.t;
      }
      for (let i = ghosts.length - 1; i >= 0; i--) if (!seen[ghosts[i].pid]) ghosts.splice(i, 1);
    }
    function updateGhosts(dt) {
      for (const gh of ghosts) {
        const age = clamp(S.t - gh.at, 0, 0.6);
        const tx = gh.x + gh.vx * age;
        gh.rx += (tx - gh.rx) * Math.min(1, dt * 8);
        gh.ry += (gh.y - gh.ry) * Math.min(1, dt * 10);
        gh.trail.push({ x: gh.rx, y: gh.ry });
        if (gh.trail.length > 10) gh.trail.shift();
      }
    }

    // ---------- Loop / lifecycle ----------
    function now() { return G.performance && typeof G.performance.now === "function" ? G.performance.now() : Date.now(); }
    function begin() {
      S.phase = "run"; S.countdown = null; P.anim = "run";
      setMusic(theme());
    }
    function start(atPerfNow) {
      if (destroyed || S.phase !== "ready") return;
      const nw = now();
      if (typeof atPerfNow === "number" && atPerfNow > nw) { S.startAt = atPerfNow; S.phase = "countdown"; S.countdown = (atPerfNow - nw) / 1000; }
      else { begin(); if (typeof atPerfNow === "number") acc = clamp((nw - atPerfNow) / 1000, 0, 1); }
      lastNow = nw;
      if (ctx && typeof G.requestAnimationFrame === "function" && !raf) raf = G.requestAnimationFrame(frame);
    }
    function pause() { if (destroyed || !active() || S.paused) return; S.paused = true; S.resumeAt = null; S.countdown = null; if (AU && typeof AU.duck === "function") safe(() => AU.duck(400)); }
    function resume() {
      if (destroyed || !S.paused) return;
      S.paused = false; S.resumeAt = now() + 3000; S.countdown = 3; lastNow = now(); acc = 0;
      sfx("countdown");
    }
    let lastTick = -1;
    function frame(tNow) {
      if (destroyed) return;
      raf = G.requestAnimationFrame(frame);
      let d = (tNow - lastNow) / 1000;
      lastNow = tNow;
      if (!(d >= 0)) d = 0;
      d = Math.min(d, 0.1);
      if (S.phase === "countdown") {
        const left = (S.startAt - tNow) / 1000;
        S.countdown = Math.max(0, left);
        const tick = Math.ceil(left);
        if (tick !== lastTick && tick > 0 && tick <= 3) { lastTick = tick; sfx("tick"); }
        if (left <= 0) { begin(); acc = clamp(-left, 0, 1); }
      } else if (S.resumeAt) {
        const left = (S.resumeAt - tNow) / 1000;
        S.countdown = Math.max(0, left);
        const tick = Math.ceil(left);
        if (tick !== lastTick && tick > 0) { lastTick = tick; sfx("tick"); }
        if (left <= 0) { S.resumeAt = null; S.countdown = null; }
      }
      let alpha = 1;
      if (active() && !S.paused && !S.resumeAt && S.phase !== "countdown") {
        acc += d;
        let n = 0;
        while (acc >= DT && n++ < 60) { step(DT); acc -= DT; }
        alpha = clamp(acc / DT, 0, 1);
      }
      updateGhosts(d);
      if (fx && typeof fx.update === "function") safe(() => fx.update(d, world()));
      render(alpha, tNow / 1000);
    }
    function advance(seconds) {
      const n = Math.max(0, Math.round(seconds / DT));
      if (S.phase === "ready") begin();
      if (S.phase === "countdown") begin();
      for (let i = 0; i < n && !destroyed; i++) {
        if (S.paused) break;
        if (S.resumeAt) { S.resumeAt = null; S.countdown = null; }
        step(DT);
        updateGhosts(DT);
      }
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf && typeof G.cancelAnimationFrame === "function") G.cancelAnimationFrame(raf);
      raf = 0;
      if (fx && typeof fx.destroy === "function") safe(() => fx.destroy());
      if (G.removeEventListener) { safe(() => G.removeEventListener("resize", onResize)); if (G.document) safe(() => G.document.removeEventListener("visibilitychange", onVis)); }
    }
    function onResize() { W = 0; }
    function onVis() { if (G.document && G.document.hidden && opts.autoPause !== false && running()) pause(); }
    if (ctx && G.addEventListener) { safe(() => G.addEventListener("resize", onResize)); if (G.document) safe(() => G.document.addEventListener("visibilitychange", onVis)); }

    // ---------- Rendering ----------
    let camX = 0, Z = 1, gy = 0, psx = 0, px = 0;
    function resize() {
      const cw = canvas.clientWidth || canvas.width || 390, ch = canvas.clientHeight || canvas.height || 844;
      dpr = Math.min(2, (G.devicePixelRatio > 0 && G.devicePixelRatio) || 1);
      const bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      W = cw; H = ch;
    }
    function world() { return { cam: { x: camX, y: S.camY }, w: W, h: H, player: { x: P.x, y: P.y }, speed: S.speed, t: S.t, z: Z, groundY: gy, playerScreenX: psx, theme: theme(), flip: S.flipT, phase: S.phase }; }
    const sx = (wx) => psx + (wx - px) * Z;
    const sy = (wy) => gy - (wy - S.camY) * Z;
    const PAR = [0, 0.12, 0.3, 0.55, 0.85];
    const artHas = {};
    function drawSprite(name, x, y, t, o) {
      // x, y = world position of the sprite's ANCHOR (base for ground things, center for floating things)
      ctx.save(); ctx.translate(sx(x), sy(y));
      if (o && o.flip) ctx.scale(-1, 1);
      const so = { scale: Z * ((o && o.scale) || 1), alpha: o && o.alpha, wink: o && o.wink, color: o && o.color, variant: (o && o.variant) | 0, theme: theme() };
      let ok = false;
      if (A && typeof A.sprite === "function" && artHas[name] !== false) {
        try { A.sprite(ctx, name, t, so); ok = true; } catch (e) { artHas[name] = false; }
      }
      if (!ok) FB.sprite(ctx, name, t, so);
      ctx.restore();
    }
    const anchorOf = (name) => (A && A.sizes && A.sizes[name] && A.sizes[name].anchor) || ANCHOR[name] || "center";
    // Draw a sprite centered at (x, y) regardless of its anchor convention
    function drawCentered(name, x, y, t, o) {
      const z = (A && A.sizes && A.sizes[name]) || SIZES[name] || { w: 40, h: 40 };
      const s = (o && o.scale) || 1, a = anchorOf(name);
      drawSprite(name, a === "topleft" ? x - (z.w * s) / 2 : x, a === "base" ? y - (z.h * s) / 2 : a === "topleft" ? y + (z.h * s) / 2 : y, t, o);
    }
    function drawAnimal(kind, anim, x, y, t, o) {
      ctx.save(); ctx.translate(sx(x), sy(y));
      const ao = Object.assign({ scale: Z, facing: 1 }, o || {});
      let ok = false;
      if (A && typeof A.animal === "function" && artHas.__animal !== false) { try { A.animal(ctx, kind, anim, t, ao); ok = true; } catch (e) { artHas.__animal = false; } }
      if (!ok) FB.animal(ctx, kind, anim, t, ao);
      ctx.restore();
    }
    function drawBackground(t, th) {
      if (A && typeof A.background === "function" && artHas.__bg !== false) {
        try {
          A.groundPx = gy; A.dpr = dpr; A.moonWink = S.moonWink > 0; // horizon van de tekenmodule = onze grondlijn
          for (let l = 0; l <= 4; l++) A.background(ctx, l, camX * Z * PAR[l], W, H, t, th);
          return;
        } catch (e) { artHas.__bg = false; }
      }
      // Fallback: lucht, sterren, maan, heuvels, bomen
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      if (th === "peperkoek") { sky.addColorStop(0, "#5a2d1a"); sky.addColorStop(1, "#c98a5a"); }
      else if (th === "aurora") { sky.addColorStop(0, "#071a2e"); sky.addColorStop(0.5, "#0f4d4a"); sky.addColorStop(1, "#2a1d4f"); }
      else { sky.addColorStop(0, "#0b1030"); sky.addColorStop(0.6, "#262a5c"); sky.addColorStop(1, "#4a3f7a"); }
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
      if (th === "aurora") { for (let i = 0; i < 4; i++) { ctx.fillStyle = `hsla(${130 + i * 40 + Math.sin(t + i) * 20},80%,60%,.18)`; ctx.beginPath(); for (let x = 0; x <= W; x += 20) { const y = H * 0.12 + i * 30 + Math.sin(x * 0.01 + t * 1.5 + i) * 40; x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.lineTo(W, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill(); } }
      ctx.fillStyle = "rgba(255,255,255,.85)";
      for (let i = 0; i < 40; i++) { const xx = ((i * 971 + 37) % 1000) / 1000 * W * 1.2 - (camX * Z * 0.05) % (W * 1.2); const yy = ((i * 613 + 11) % 1000) / 1000 * H * 0.5; const r = 1 + (i % 3) * 0.6 + (Math.sin(t * 3 + i) > 0.9 ? 1 : 0); ctx.beginPath(); ctx.arc(((xx % (W * 1.2)) + W * 1.2) % (W * 1.2) - W * 0.1, yy, r, 0, TAU); ctx.fill(); }
      ctx.save(); ctx.translate(W * 0.8, H * 0.14); ctx.scale(Z, Z); FB.sprite(ctx, "moon", t, { wink: S.moonWink > 0 }); ctx.restore();
      ctx.fillStyle = th === "peperkoek" ? "#7a4a2c" : "#1a1f4a";
      ctx.beginPath(); ctx.moveTo(0, gy); for (let x = 0; x <= W; x += 16) ctx.lineTo(x, gy - 60 * Z - Math.abs(Math.sin((x + camX * Z * 0.12) * 0.004)) * 120 * Z); ctx.lineTo(W, gy); ctx.closePath(); ctx.fill();
      ctx.fillStyle = th === "peperkoek" ? "#9c6a3f" : "#12203e";
      for (let k = -1; k < 12; k++) { const bx = ((k * 90 - (camX * Z * 0.3) % 90) + 90 * 13) % (90 * 13) - 90; ctx.beginPath(); ctx.moveTo(bx - 32 * Z, gy); ctx.lineTo(bx, gy - 150 * Z); ctx.lineTo(bx + 32 * Z, gy); ctx.closePath(); ctx.fill(); }
    }
    function drawGround(t, th) {
      const x0 = camX - 100, x1 = camX + W / Z + 100;
      const tileName = th === "peperkoek" ? "gingerGroundTile" : "groundTile";
      const useTiles = !!(A && A.sizes && A.sizes[tileName]);
      for (const g of level.grounds) {
        if (g.x1 < x0 || g.x0 > x1) continue;
        const a = sx(Math.max(g.x0, x0)), b = sx(Math.min(g.x1, x1));
        if (g.kind === "gap") {
          ctx.fillStyle = th === "peperkoek" ? "#3b1f12" : "#0e1a3c"; ctx.fillRect(a, gy + 18 * Z, b - a, H);
          ctx.fillStyle = th === "peperkoek" ? "#7cc4e8" : "#3f7fd8"; ctx.fillRect(a, gy + 18 * Z, b - a, 10 * Z);
          ctx.fillStyle = "rgba(255,255,255,.5)"; for (let x = a + 10; x < b - 10; x += 26) ctx.fillRect(x + Math.sin(t * 4 + x) * 4, gy + 20 * Z, 10, 3);
          continue;
        }
        const top = g.kind === "pond" ? "#bfe9ff" : th === "peperkoek" ? "#f7e6d2" : "#f6fbff";
        const body = g.kind === "pond" ? "#79c3ea" : th === "peperkoek" ? "#9a5a2e" : "#c9ddf5";
        ctx.fillStyle = body; ctx.fillRect(a, gy, b - a, H - gy);
        ctx.fillStyle = top; ctx.fillRect(a, gy - 6 * Z, b - a, 20 * Z);
        if (g.kind === "pond") { ctx.fillStyle = "rgba(255,255,255,.35)"; for (let x = a + 20; x < b; x += 90) ctx.fillRect(x + Math.sin(t + x) * 6, gy + 6 * Z, 36 * Z, 3 * Z); }
        if (useTiles) { // tegels: anker linksboven op de grondlijn, lopen naar rechts/omlaag
          const nm = g.kind === "pond" ? "pondTile" : tileName;
          const tw = (A.sizes[nm].w || 128), thh = (A.sizes[nm].h || 40);
          ctx.save(); ctx.beginPath(); ctx.rect(a, gy - 2, b - a, thh * Z + 4); ctx.clip();
          for (let x = Math.floor(Math.max(g.x0, x0) / tw) * tw; x < Math.min(g.x1, x1); x += tw) drawSprite(nm, x, 0, t);
          ctx.restore();
        }
      }
    }
    function drawItem(it, t, th) {
      const name = it.kind === "star" ? "star" : it.kind === "candy" || it.kind === "drop" ? "candyCane" : it.kind === "gift" || it.kind === "chute" ? "gift" : it.kind === "bell" ? "bell" : it.kind === "bauble" ? "bauble" : "star";
      const bob = it.kind === "star" || it.kind === "candy" ? Math.sin(t * 3 + it.x * 0.02) * 4 : 0;
      if (it.kind === "star" && S.event && S.event.id === "noorderlicht") {
        ctx.save(); ctx.fillStyle = `hsla(${(t * 120 + it.x * 0.3) % 360},90%,65%,.55)`; ctx.beginPath(); ctx.arc(sx(it.x), sy(it.y + bob), 26 * Z, 0, TAU); ctx.fill(); ctx.restore();
      }
      if (it.kind === "chute") {
        ctx.save(); ctx.fillStyle = "#ff8ac4"; ctx.strokeStyle = "#2b2a3a"; ctx.lineWidth = 2;
        const cx = sx(it.x), cy = sy(it.y + 70);
        ctx.beginPath(); ctx.arc(cx, cy, 36 * Z, Math.PI, TAU); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - 36 * Z, cy); ctx.lineTo(cx, sy(it.y + 22)); ctx.lineTo(cx + 36 * Z, cy); ctx.stroke(); ctx.restore();
      }
      const o = { scale: it.kind === "drop" ? 0.7 : it.kind === "star" && it.optional && it.y > 250 ? 1.1 : 1, color: it.color, variant: it.variant || 0 };
      if (it.kind === "bell") { ctx.save(); const bx = sx(it.x), by = sy(it.y + 20); ctx.translate(bx, by); ctx.rotate(Math.sin(t * 4 + it.x) * 0.25); ctx.translate(-bx, -by); drawCentered(name, it.x, it.y, t, o); ctx.restore(); }
      else drawCentered(name, it.x, it.y + bob, t, o);
    }
    function drawPlayer(t) {
      const ipx = px, ipy = lerp(P.prevY, P.y, renderAlpha);
      const blink = P.invuln > 0 && !S.fly && Math.floor(t * 12) % 2 === 1;
      if (S.sled) { ctx.save(); ctx.fillStyle = "#d33c3c"; ctx.strokeStyle = "#2b2a3a"; ctx.lineWidth = 3; const bx = sx(ipx), by = sy(ipy - 6); ctx.beginPath(); ctx.moveTo(bx - 44 * Z, by); ctx.lineTo(bx + 40 * Z, by); ctx.lineTo(bx + 52 * Z, by - 14 * Z); ctx.lineWidth = 6 * Z; ctx.stroke(); ctx.restore(); }
      if (P.spin > 0) { ctx.save(); const cx = sx(ipx), cy = sy(ipy + 50); ctx.translate(cx, cy); ctx.rotate(-(0.6 - P.spin) / 0.6 * TAU); ctx.translate(-cx, -cy); }
      drawAnimal(animal, P.anim, ipx, ipy, t, { hat, alpha: blink ? 0.45 : 1, blush: P.blush > 0 });
      if (P.spin > 0) ctx.restore();
      if (S.powerup) {
        const pw = S.powerup, spec = POWERUPS[pw.id];
        const cx = sx(ipx), cy = sy(ipy + 50), r = 72 * Z;
        ctx.save(); ctx.lineWidth = 5 * Z; ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
        ctx.strokeStyle = spec.color; ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(pw.left / pw.total, 0, 1)); ctx.stroke();
        if (pw.id === "sneeuwbol") { ctx.fillStyle = "rgba(143,215,255,.22)"; ctx.beginPath(); ctx.arc(cx, cy, r - 6 * Z, 0, TAU); ctx.fill(); }
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy - r, 16 * Z, 0, TAU); ctx.fill();
        ctx.font = `${Math.round(18 * Z)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(spec.icon, cx, cy - r + 1); ctx.restore();
      }
    }
    function drawGhosts(t) {
      for (const gh of ghosts) {
        if (gh.rx < camX - 200 || gh.rx > camX + W / Z + 200) continue;
        ctx.save(); ctx.globalAlpha = 0.25;
        for (let i = 0; i < gh.trail.length; i += 2) { const p = gh.trail[i]; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y + 40), (2 + i * 0.5) * Z, 0, TAU); ctx.fill(); }
        ctx.restore();
        drawAnimal(gh.animal, gh.anim || "run", gh.rx, gh.ry, t, { alpha: 0.6 });
        ctx.save(); ctx.globalAlpha = 0.85; ctx.font = `bold ${Math.round(15 * Math.max(Z, 0.8))}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        const tx = sx(gh.rx), ty = sy(gh.ry + 118);
        const tw = ctx.measureText(gh.name).width + 16;
        ctx.fillStyle = "rgba(20,20,50,.55)"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(tx - tw / 2, ty - 22, tw, 24, 12) : ctx.rect(tx - tw / 2, ty - 22, tw, 24); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillText(gh.name, tx, ty - 3); ctx.restore();
      }
    }
    function drawShooters(t) {
      for (const sh of S.shooters) {
        if (sh.caught) continue;
        const k = sh.t / 2.6;
        const x = sh.side > 0 ? W * (1.1 - k * 0.9) : W * (-0.1 + k * 0.9);
        const y = H * 0.05 + k * (gy - 220 * Z - H * 0.05);
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 3 * Z; ctx.beginPath(); ctx.moveTo(x - sh.side * 60 * Z, y - 40 * Z); ctx.lineTo(x, y); ctx.stroke();
        if (sh.window) { // groot, warm tik-gebied: "wens!"
          const r = 70 * Z + Math.sin(t * 10) * 6;
          const gr = ctx.createRadialGradient(x, y, 4, x, y, r); gr.addColorStop(0, "rgba(255,245,180,.85)"); gr.addColorStop(0.6, "rgba(255,220,120,.35)"); gr.addColorStop(1, "rgba(255,200,80,0)");
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.arc(x, y, r - 4, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.translate(x, y); ctx.scale(Z * 1.6, Z * 1.6); FB.sprite(ctx, "star", t, {}); ctx.restore();
      }
    }
    function drawParticles(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.life -= dt; p.vy -= 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.fillStyle = p.kind === "hurt" ? "#ff8a8a" : p.kind === "candy" ? "#ff8ac4" : "#fff27a"; ctx.globalAlpha = clamp(p.life, 0, 1);
        ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 4 * Z, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    let renderAlpha = 1;
    function render(alpha, t) {
      if (!ctx) return;
      if (!W) resize();
      const dt = lastRenderNow ? clamp(t - lastRenderNow, 0, 0.1) : 0; lastRenderNow = t;
      renderAlpha = alpha;
      px = lerp(P.prevX, P.x, alpha);
      const th = theme();
      // Camera
      const zoomWanted = clamp(300 / Math.max(1, S.speed), 0.72, 1);
      S.zoom += (zoomWanted - S.zoom) * Math.min(1, dt * 2);
      Z = clamp(Math.min(W / 640, H / 700), 0.4, 1.15) * S.zoom;
      gy = H * (H > W ? 0.68 : 0.74);
      psx = W * 0.26;
      const camYWanted = Math.max(0, lerp(P.prevY, P.y, alpha) - 260) * 0.6;
      S.camY += (camYWanted - S.camY) * Math.min(1, dt * 4);
      camX = px - psx / Z;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      if (S.flipT > 0) { const k = Math.cos(S.flipT * Math.PI); ctx.translate(0, H / 2); ctx.scale(1, Math.abs(k) < 0.04 ? 0.04 : k); ctx.translate(0, -H / 2); }
      const sh = (fx && fx.shake) || null;
      if (sh && !reducedMotion) ctx.translate(sh.x || 0, sh.y || 0);
      else if (S.ownShake > 0 && !reducedMotion) ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 8);

      drawBackground(t, th);
      if (S.ownShake > 0 && !fx) { ctx.fillStyle = "rgba(255,255,255,.8)"; for (let i = 0; i < 80; i++) ctx.fillRect(((i * 733 + t * 60) % W + W) % W, ((i * 311 + t * 240 * (1 + (i % 3) * 0.3)) % H + H) % H, 3, 3); }
      if (fx && typeof fx.drawBack === "function") safe(() => fx.drawBack(ctx, world()));

      // Reuzenboom (parallax 0.5) & zingende sneeuwpop achter alles
      if (S.giant) { const gx = S.giant.x + (px - S.giant.px0) * 0.5; drawSprite("giantTree", gx, 0, t, { scale: A ? 1.8 : 1 }); } // parallax ½: schuift op halve snelheid voorbij
      const vis = level.query(camX - 300, camX + W / Z + 300);
      for (const d of vis.decos) if (d.back) drawSprite(d.name, d.x, 0, t, { scale: d.scale, flip: d.flip });
      if (S.singer) { drawSprite("snowman", S.singer.x, 0, t, { scale: 1.1 }); ctx.save(); ctx.fillStyle = "#fff"; ctx.font = `${Math.round(22 * Z)}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.fillText("♪", sx(S.singer.x + 30), sy(100 + ((t * 40) % 60))); ctx.fillText("♫", sx(S.singer.x - 20), sy(120 + ((t * 30 + 20) % 60))); ctx.restore(); }
      drawGround(t, th);
      for (const d of vis.decos) if (!d.back) drawSprite(d.name, d.x, 0, t, { scale: d.scale, flip: d.flip });
      // Obstakels
      for (const o of vis.obstacles) {
        if (o.type === "log") { for (let i = 0; i < o.n; i++) drawSprite("log", o.x - ((o.n - 1) / 2 - i) * ((o.w - 60) / Math.max(1, o.n - 1) || 0), 0, t); }
        else if (o.type === "icicles") { for (let i = 0; i < o.n; i++) drawCentered("icicles", o.x - ((o.n - 1) / 2 - i) * 150, o.y0 + o.h / 2, t, { scale: 2 }); } // 90×60 op 2× = de band van 120 hoog
        else if (o.type === "snowman") { const wob = Math.sin(S.t * 2 + o.phase) * L.OBST.snowman.wobble; drawSprite("snowman", o.x + wob, 0, t, { flip: wob < 0 }); }
        else if (o.type === "pinecone") {
          const fy = o.state === "landed" ? 0 : o.state === "fall" ? o.fy : L.OBST.pinecone.dropY;
          if (o.state !== "landed") { ctx.save(); ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(sx(o.x), sy(0) + 4 * Z, (24 - fy * 0.04) * Z, 7 * Z, 0, 0, TAU); ctx.fill(); ctx.restore(); }
          drawCentered("pinecone", o.x, fy + o.h / 2, t);
        }
      }
      // Items
      for (const it of vis.items) if (!it.taken) drawItem(it, t, th);
      for (const it of S.extra) if (!it.taken) drawItem(it, t, th);
      for (const it of S.loose) if (!it.taken) drawItem(it, t, th);
      for (const it of S.drops) if (!it.taken) drawItem(it, t, th);
      // Kerstman-slee (fallback zonder FX)
      if (S.sleigh && !fx) { const k = S.sleigh.t / S.sleigh.dur; drawSpriteScreen("sleigh", W * (1.2 - k * 1.4), H * 0.16 + Math.sin(k * 6) * 10, t); }
      drawGhosts(t);
      if (!fx) drawShooters(t);
      drawPlayer(t);
      drawParticles(dt);
      if (fx && typeof fx.drawFront === "function") safe(() => fx.drawFront(ctx, world()));
      ctx.restore();

      if (drawText) {
        ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 6;
        if (S.countdown != null && S.countdown > 0) { ctx.font = `bold ${Math.round(Math.min(W, H) * 0.3)}px system-ui, sans-serif`; const n = String(Math.ceil(S.countdown)); ctx.strokeText(n, W / 2, H * 0.4); ctx.fillText(n, W / 2, H * 0.4); }
        if (S.prompt) { ctx.font = `bold ${Math.round(Math.min(W, H) * 0.07)}px system-ui, sans-serif`; ctx.strokeText(S.prompt, W / 2, H * 0.4); ctx.fillText(S.prompt, W / 2, H * 0.4); }
        if (S.paused) { ctx.font = `bold ${Math.round(Math.min(W, H) * 0.1)}px system-ui, sans-serif`; ctx.strokeText("Pauze", W / 2, H * 0.4); ctx.fillText("Pauze", W / 2, H * 0.4); }
        ctx.restore();
      }
    }
    function drawSpriteScreen(name, x, y, t) { ctx.save(); ctx.translate(x, y); let ok = false; if (A && typeof A.sprite === "function" && artHas[name] !== false) { try { A.sprite(ctx, name, t, { scale: Z }); ok = true; } catch (e) { artHas[name] = false; } } if (!ok) FB.sprite(ctx, name, t, { scale: Z }); ctx.restore(); }

    const game = {
      start, pause, resume, input, setGhosts, triggerEvent, destroy, advance,
      setDroomster(frac) { S.droomster = clamp(+frac || 0, 0, 1); },
      get state() { return state(); },
      get level() { return level; },
      get fx() { return fx; },
      get opts() { return { seed, difficulty, animal, name, hat, fawnName, durationSec }; },
      grantPowerup(id) { grantPowerup(id, false); }, // test/debug hook: alsof je het cadeau zelf pakte
    };
    return game;
  }

  return {
    create, overlaps, playerBox, obstacleBox, playerCenter, FB,
    PHYS, PLAYER_BOX, SLIDE_BOX, POWERUPS, EVENTS, EVENT_POOL, MILESTONES, EVENT_GAP, SCORE, ANIMALS, NAMES, DT, VERSION: 1,
  };
});
