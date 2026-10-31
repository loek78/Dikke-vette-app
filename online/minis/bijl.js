// Minigame "bijl" — lokaal timingspel: hout kloven in de sneeuw (SPEC-3 §5, hoofdstuk "Hout halen").
// Een naald zwaait over een gietijzeren meter; tik als hij in het gloeiende vak staat en de bijl klooft het blok.
// Elke treffer op rij maakt het vak smaller; het midden is PERFECT. Knoestige blokken (moeilijkheid 2+) vragen twee klappen.
(function () {
  "use strict";
  const M = typeof DVMini !== "undefined" ? DVMini : require("./core.js");

  const DURATION = 20000; // ms speeltijd
  // Per moeilijkheid: naaldperiode (heen+terug, ms), sinus-beweging, vakbreedte (halve breedte, 0..1) en krimp per treffer,
  // waar het vak mag staan, kans op een knoest en "par" (wat een goede houthakker haalt, voor de score).
  const CFG = {
    1: { name: "Handbijl", period: 1800, wave: false, base: 0.15, min: 0.06, shrink: 0.9, lo: 0.3, hi: 0.7, knot: 0, par: 15 },
    2: { name: "Kloofbijl", period: 1300, wave: false, base: 0.12, min: 0.045, shrink: 0.89, lo: 0.16, hi: 0.84, knot: 0.2, par: 12 },
    3: { name: "Grote bijl", period: 1050, wave: true, base: 0.1, min: 0.035, shrink: 0.88, lo: 0.1, hi: 0.9, knot: 0.35, par: 9 },
  };
  const SWING = 110, HIT_BUSY = 400, MISS_BUSY = 680; // ms vanaf de tik
  const PERFECT_K = 0.36; // deel van het vak dat als perfect telt

  const dl = (d) => Math.max(1, Math.min(3, Math.round(d) || 1));
  const cfg = (d) => CFG[dl(d)];

  // Naaldstand 0..1 op tijdstip t (ms). 1–2: heen en weer met gelijke snelheid; 3: sinus (traag aan de randen, snel in het midden).
  function needle(t, d) {
    const c = cfg(d), ph = (((t % c.period) + c.period) % c.period) / c.period;
    if (c.wave) return 0.5 - 0.5 * Math.cos(ph * 2 * Math.PI);
    return ph < 0.5 ? ph * 2 : 2 - ph * 2;
  }
  const halfWidth = (streak, d) => { const c = cfg(d); return Math.max(c.min, c.base * Math.pow(c.shrink, Math.max(0, streak || 0))); };
  // Geseede blokkenreeks: waar het vak staat en of het blok knoestig is.
  function plan(seed, d, n = 80) {
    const c = cfg(d), r = M.rng((seed >>> 0) ^ 0xb17e);
    return Array.from({ length: n }, (_, i) => { const at = c.lo + r() * (c.hi - c.lo), k = r(); return { c: at, knot: i > 1 && k < c.knot }; });
  }
  function judge(p, center, w) {
    const a = Math.abs(p - center);
    return a <= Math.max(0.016, w * PERFECT_K) ? "perfect" : a <= w ? "good" : "miss";
  }

  // ---------- Scoren ----------
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(99, Math.floor(v)) : null);
  function valid(r) {
    if (!r || typeof r !== "object") return null;
    const logs = num(r.logs), perfect = num(r.perfect), misses = num(r.misses);
    if (logs === null || perfect === null || misses === null) return null;
    return { logs, perfect, misses, combo: num(r.combo) || 0 };
  }
  // Houthakkerspunten: gekloofde blokken, perfect geeft een bonusje, missers kosten wat.
  const points = (v) => Math.max(0, v.logs + 0.4 * v.perfect - 0.5 * v.misses);

  function score(results, info) {
    results = results && typeof results === "object" ? results : {};
    info = info || {};
    const c = cfg(info.difficulty);
    const players = Array.isArray(info.players) && info.players.length ? info.players : Object.keys(results).map((pid) => ({ pid, name: pid }));
    const nameOf = (p) => (p && p.name) || "Iemand";
    const rows = players.map((p) => { const v = valid(results[p.pid]); return { p, v, pts: v ? points(v) : null }; });
    const played = rows.filter((x) => x.v);
    // Wie niet meedeed, telt als een paar twijgjes.
    const avg = rows.length ? rows.reduce((s, x) => s + (x.v ? x.pts : c.par * 0.15), 0) / rows.length : 0;
    const ratio = avg / c.par;
    const logs = M.clampLogs(ratio >= 1.3 ? 4 : ratio >= 1 ? 3 : ratio >= 0.72 ? 2 : ratio >= 0.45 ? 1 : ratio >= 0.22 ? 0 : -1);
    const head = {
      4: "Houthakkers van de bovenste plank! De houtmand puilt uit.",
      3: "Strak gekloofd. Gloei likt binnen al aan het raam.",
      2: "Een nette stapel. Daar komt het vuur wel mee de nacht door.",
      1: "Een paar blokken. Beter dan niks.",
      0: "Veel gezwaai, weinig hout.",
      "-1": "Meer splinters dan blokken… Gloei: \"Is dit een grap?\"",
    }[logs];
    const lines = [head];
    let mvp = null;
    if (played.length >= 2) {
      const best = played.slice().sort((a, b) => b.pts - a.pts || b.v.perfect - a.v.perfect)[0];
      if (best.v.logs > 0) {
        mvp = best.p.pid;
        lines.push(nameOf(best.p) + " kloofde er " + best.v.logs + (best.v.perfect ? ", " + best.v.perfect + "× perfect" : "") + ". Echte houthakker.");
      }
    } else if (played.length === 1) {
      const v = played[0].v;
      lines.push(nameOf(played[0].p) + " kloofde " + v.logs + " " + (v.logs === 1 ? "blok" : "blokken") + (v.perfect ? " (" + v.perfect + "× perfect)" : "") + ".");
    }
    const streak = played.slice().sort((a, b) => b.v.combo - a.v.combo)[0];
    if (streak && streak.v.combo >= 8) lines.push(nameOf(streak.p) + " hakte " + streak.v.combo + " keer op rij raak. Machine.");
    const clumsy = played.slice().sort((a, b) => b.v.misses - a.v.misses)[0];
    if (played.length >= 2 && clumsy && clumsy.v.misses >= 6 && clumsy.p.pid !== mvp) lines.push(nameOf(clumsy.p) + " sloeg " + clumsy.v.misses + "× mis. De stronk heeft het zwaar.");
    rows.filter((x) => !x.v).forEach((x) => lines.push(nameOf(x.p) + " bleef binnen bij de kachel. Verdacht."));
    const total = played.reduce((s, x) => s + x.v.logs, 0);
    if (played.length >= 2) lines.push("Samen " + total + " blokken op de stapel.");
    const perPlayer = {};
    rows.forEach((x) => {
      perPlayer[x.p.pid] = x.v ? x.v.logs + " " + (x.v.logs === 1 ? "blok" : "blokken") + " · " + x.v.perfect + "× perfect · " + x.v.misses + " mis" : "—";
    });
    return { logs, lines, mvp, perPlayer };
  }

  // Geloofwaardige bot: simuleert wachten op de naald, raak/mis (moeilijker naarmate het vak krimpt) en knoesten.
  function bot(rng, difficulty) {
    const d = dl(difficulty), c = CFG[d];
    const blocks = plan(Math.floor(rng() * 4294967296), d);
    const skill = Math.max(0.3, Math.min(0.97, 0.58 + rng() * 0.38 - (d - 1) * 0.05));
    let t = 0, i = 0, cracked = false, logs = 0, perfect = 0, misses = 0, streak = 0, combo = 0;
    for (;;) {
      t += c.period * (0.2 + rng() * 0.32) * (1.6 - skill * 0.6);
      if (t >= DURATION) break;
      const w = halfWidth(streak, d);
      if (rng() < Math.min(0.97, skill * (0.62 + w * 2.6))) {
        streak++; combo = Math.max(combo, streak);
        if (rng() < skill * 0.5) perfect++;
        if (blocks[i % blocks.length].knot && !cracked) cracked = true;
        else { logs++; i++; cracked = false; }
        t += HIT_BUSY;
      } else { misses++; streak = 0; t += MISS_BUSY; }
    }
    return { logs, perfect, misses, combo };
  }

  // ---------- UI ----------
  const CSS = `
.bj{position:relative;width:100%;height:100%;min-height:520px;overflow:hidden;color:var(--glow,#ffe7b8);background:#06070b;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.bj *{box-sizing:border-box}
.bj-cv{position:absolute;inset:0;width:100%;height:100%;display:block}
.bj-disp{font-family:"Unbounded",system-ui,sans-serif;font-weight:900;letter-spacing:-.02em}
.bj-scr{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:4;
  padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom));text-align:center}
.bj-howto{gap:14px;justify-content:flex-end;padding-bottom:max(34px,env(safe-area-inset-bottom));
  background:linear-gradient(180deg,rgba(6,7,11,0) 18%,rgba(11,7,5,.82) 52%,rgba(11,7,5,.96))}
.bj-kicker{font:800 12px/1 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:var(--ember,#ff6a1a)}
.bj-title{font-size:clamp(40px,13vw,58px);line-height:1;margin:0;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 45%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 18px rgba(255,106,26,.45))}
.bj-text{font-size:17px;line-height:1.4;max-width:330px;margin:0;color:var(--glow,#ffe7b8)}
.bj-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-width:340px}
.bj-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:99px;font-size:13px;color:var(--ash,#b8a99a);
  background:rgba(255,231,184,.06);border:1px solid rgba(255,194,71,.18)}
.bj-chip i{width:16px;height:8px;border-radius:3px;flex:none;background:linear-gradient(90deg,var(--ember,#ff6a1a),var(--flame,#ffc247),var(--ember,#ff6a1a))}
.bj-chip i.p{width:8px;background:#fff3d0;box-shadow:0 0 8px var(--flame,#ffc247)}
.bj-chip i.k{width:9px;height:9px;border-radius:50%;background:radial-gradient(circle,#2a160a 40%,var(--wood,#8a5a36))}
.bj-chip b{color:var(--glow,#ffe7b8)}
.bj-btn{appearance:none;border:0;cursor:pointer;margin-top:6px;min-width:200px;min-height:58px;padding:0 34px;border-radius:99px;
  font:900 19px/1 "Unbounded",system-ui,sans-serif;color:#2a0d02;letter-spacing:.02em;
  background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a) 70%,var(--blaze,#e8401c));
  box-shadow:0 0 0 1px rgba(255,231,184,.35) inset,0 10px 30px rgba(232,64,28,.45),0 0 60px rgba(255,106,26,.25)}
.bj-btn:active{transform:scale(.97)}
.bj-hud{position:absolute;left:0;right:0;top:0;z-index:3;pointer-events:none;padding:max(12px,env(safe-area-inset-top)) 16px 0;
  display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;transition:opacity .4s}
.bj-cnt{justify-self:start;display:flex;align-items:center;gap:8px;font:900 24px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);
  text-shadow:0 0 14px rgba(255,106,26,.55)}
.bj-cnt i{width:24px;height:24px;border-radius:50%;flex:none;transition:transform .12s;
  background:radial-gradient(circle at 50% 50%,#f3c98f 0 18%,#c8894c 19% 32%,#e4ae70 33% 48%,#b8763e 49% 66%,#5a3519 67% 100%);
  box-shadow:0 0 0 1px #2a160a,0 0 12px rgba(255,140,50,.4)}
.bj-cnt i.bump{transform:scale(1.35)}
.bj-cnt small{font:700 11px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--ash,#b8a99a);text-shadow:none}
.bj-bar{width:min(32vw,130px);height:6px;border-radius:9px;background:rgba(255,231,184,.1);overflow:hidden}
.bj-bar i{display:block;height:100%;width:100%;border-radius:9px;transform-origin:left;
  background:linear-gradient(90deg,var(--blaze,#e8401c),var(--flame,#ffc247));box-shadow:0 0 10px var(--ember,#ff6a1a)}
.bj-time{justify-self:end;font:900 22px/1 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8);min-width:2ch;text-align:right}
.bj-time.hot{color:var(--blaze,#e8401c);animation:bj-tick .5s ease-out}
@keyframes bj-tick{0%{transform:scale(1.35)}100%{transform:scale(1)}}
.bj-hint{position:absolute;left:0;right:0;z-index:3;text-align:center;font-size:13px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--glow,#ffe7b8);pointer-events:none;transition:opacity .6s;text-shadow:0 1px 6px #000}
.bj-pop{position:absolute;left:50%;transform:translate(-50%,-50%);pointer-events:none;white-space:nowrap;z-index:3;
  font:900 32px/1 "Unbounded",system-ui,sans-serif;animation:bj-pop .75s cubic-bezier(.2,.9,.3,1.2) forwards}
.bj-pop.p{color:#fff3d0;font-size:36px;text-shadow:0 0 22px rgba(255,194,71,.95),0 0 4px #ffc247,0 3px 0 #8a3a06}
.bj-pop.g{color:var(--ember,#ff6a1a);font-size:28px;text-shadow:0 0 14px rgba(255,106,26,.6),0 2px 0 #4a1503}
.bj-pop.m{color:#cfe3ff;font-size:26px;text-shadow:0 0 14px rgba(90,169,255,.6),0 2px 0 #10203a}
.bj-pop.k{color:var(--flame,#ffc247);font-size:18px;font-family:system-ui,sans-serif;font-weight:800;letter-spacing:.08em}
.bj-pop.c{color:var(--glow,#ffe7b8);font-size:15px;font-family:system-ui,sans-serif;font-weight:700;letter-spacing:.02em;
  background:rgba(23,16,11,.78);border:1px solid rgba(255,194,71,.35);padding:8px 13px;border-radius:14px;animation-duration:1.9s}
@keyframes bj-pop{0%{transform:translate(-50%,-30%) scale(.5);opacity:0}16%{transform:translate(-50%,-50%) scale(1.15);opacity:1}
  70%{opacity:1}100%{transform:translate(-50%,-120%) scale(1);opacity:0}}
.bj .mini-countdown{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font:900 96px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);text-shadow:0 0 30px rgba(255,106,26,.9),0 4px 0 #6a1c04;
  background:radial-gradient(circle at 50% 45%,rgba(6,7,11,.15),rgba(6,7,11,.6))}
.bj .mini-countdown.pop{animation:bj-cd .7s ease-out}
@keyframes bj-cd{0%{transform:scale(1.6);opacity:0}25%{transform:scale(1);opacity:1}100%{transform:scale(.92);opacity:.85}}
.bj-res{gap:10px;background:radial-gradient(95% 62% at 50% 40%,rgba(60,24,10,.82),rgba(8,7,9,.9) 72%,rgba(8,7,9,.5));
  -webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);animation:bj-fade .5s ease-out both}
@keyframes bj-fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.bj-big{font-size:clamp(72px,24vw,108px);line-height:.9;margin:4px 0 0;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 50%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 22px rgba(255,106,26,.5))}
.bj-unit{font:800 13px/1 system-ui,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:var(--ash,#b8a99a);margin-top:-2px}
.bj-rank{font:900 18px/1.2 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8);margin-top:6px}
.bj-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;max-width:330px;margin-top:8px}
.bj-stat{padding:12px 6px;border-radius:16px;background:linear-gradient(180deg,rgba(255,231,184,.08),rgba(255,231,184,.03));
  border:1px solid rgba(255,194,71,.18);box-shadow:inset 0 1px 0 rgba(255,231,184,.08)}
.bj-stat b{display:block;font:900 24px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247)}
.bj-stat:nth-child(2) b{color:var(--ember,#ff6a1a)}
.bj-stat:nth-child(3) b{color:#9fc7ff}
.bj-stat span{display:block;margin-top:6px;font-size:12px;color:var(--ash,#b8a99a);letter-spacing:.06em;text-transform:uppercase}
.bj-sub{font-size:14px;color:var(--ash,#b8a99a)}
.bj-wait{margin-top:14px;display:inline-flex;align-items:center;gap:10px;font-size:15px;color:var(--glow,#ffe7b8);
  padding:10px 16px;border-radius:99px;background:rgba(23,16,11,.7);border:1px solid rgba(255,231,184,.12)}
.bj-wait i{width:10px;height:10px;border-radius:50%;background:var(--ember,#ff6a1a);box-shadow:0 0 12px var(--ember,#ff6a1a);animation:bj-breathe 1s ease-in-out infinite}
@keyframes bj-breathe{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.7);opacity:.6}}
@media (prefers-reduced-motion:reduce){.bj-wait i,.bj-time.hot{animation:none}}
`;

  function injectCss() {
    if (document.getElementById("mini-bijl-css")) return;
    const s = document.createElement("style");
    s.id = "mini-bijl-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const lerp = (a, b, k) => a + (b - a) * k;
  const TAU = Math.PI * 2;

  const QUIPS = {
    5: "Gloei (binnen): \"Ik hoor het kraken. Heerlijk.\"",
    10: "Gloei: \"Meer! MEER! Ik heb honger!\"",
    15: "Gloei: \"Houthakker van het jaar, dit.\"",
    20: "Gloei: \"Ik ga huilen. Van vreugde. Sissend.\"",
  };
  const RANKS = [[1.3, "Bijlbaas"], [1, "Echte houthakker"], [0.72, "Stevige kloover"], [0.45, "Twijgjesverzamelaar"], [0, "Stronkenkietelaar"]];

  function mount(el, ctx) {
    injectCss();
    const d = dl(ctx.difficulty), c = CFG[d];
    const blocks = plan(ctx.seed >>> 0, d);
    const sfx = ctx.sfx || {};
    const beep = (...a) => { try { sfx.beep && sfx.beep(...a); } catch (e) { /* geen geluid */ } };
    const buzz = (ms) => { try { sfx.buzz && sfx.buzz(ms); } catch (e) { /* geen tril */ } };
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    const root = h("div", "bj");
    el.appendChild(root);
    const cv = h("canvas", "bj-cv");
    root.appendChild(cv);
    const g = cv.getContext("2d");
    let dead = false, raf = 0, ro = null, phase = "howto";
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms); timers.add(id); };

    // --- HUD ---
    const hud = h("div", "bj-hud");
    const cnt = h("div", "bj-cnt");
    const cntIco = h("i"), cntNum = h("span", null, "0");
    cnt.append(cntIco, cntNum, h("small", null, "blokken"));
    const bar = h("div", "bj-bar"), barFill = h("i");
    bar.appendChild(barFill);
    const timeEl = h("div", "bj-time", String(DURATION / 1000));
    hud.append(cnt, bar, timeEl);
    hud.style.opacity = "0";
    root.appendChild(hud);
    const hint = h("div", "bj-hint", "Tik als de naald in het vak staat");
    hint.style.opacity = "0";
    root.appendChild(hint);

    // --- Howto ---
    const how = h("div", "bj-scr bj-howto");
    how.appendChild(h("div", "bj-kicker", "Hout halen · " + c.name + " · 20 s"));
    how.appendChild(h("h2", "bj-title bj-disp", "Bijl"));
    how.appendChild(h("p", "bj-text", "Tik als de zwaaiende naald in het gloeiende vak staat: elke treffer klooft een blok voor de kachel."));
    const leg = h("div", "bj-legend");
    const chip = (cls, txt, bold) => { const x = h("span", "bj-chip"); x.appendChild(h("i", cls)); x.appendChild(document.createTextNode(txt + " ")); if (bold) x.appendChild(h("b", null, bold)); leg.appendChild(x); };
    chip("p", "midden =", "PERFECT");
    chip("", "reeks = smaller vak", null);
    if (d >= 2) chip("k", "knoest =", "2 klappen");
    how.appendChild(leg);
    const startBtn = h("button", "bj-btn", "Start");
    startBtn.type = "button";
    how.appendChild(startBtn);
    root.appendChild(how);

    // --- Decor (geseed) ---
    const drng = M.rng((ctx.seed >>> 0) ^ 0xa3e);
    const stars = Array.from({ length: 46 }, () => ({ x: drng(), y: drng() * 0.5, r: 0.4 + drng() * 1.1, ph: drng() * TAU }));
    const treesFar = Array.from({ length: 16 }, (_, i) => ({ x: (i + drng() * 0.8) / 15 - 0.05, h: 0.1 + drng() * 0.08, w: 0.06 + drng() * 0.03 }));
    const treesNear = Array.from({ length: 7 }, (_, i) => ({ x: (i + drng() * 0.7) / 6 - 0.08, h: 0.14 + drng() * 0.1, w: 0.09 + drng() * 0.04 }));
    const flakes = Array.from({ length: reduced ? 25 : 70 }, () => ({ x: drng(), y: drng(), r: 0.6 + drng() * 1.8, sp: 0.03 + drng() * 0.05, ph: drng() * TAU }));
    const slotJit = Array.from({ length: 120 }, () => ({ r: 0.86 + drng() * 0.14, a: (drng() - 0.5) * 0.5, tone: drng() }));

    // --- Layout ---
    let W = 0, H = 0, dpr = 1, L = null, bg = null, logImg = null, knotImg = null;
    function layout() {
      const r = root.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(2, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const cx = W / 2;
      const horizon = H * 0.57, ground = H * 0.68;
      const srx = Math.min(W * 0.24, 104), sry = srx * 0.28;
      const stumpTop = ground - H * 0.03;
      const lrx = Math.min(W * 0.12, 52), lry = lrx * 0.3, lh = Math.min(H * 0.16, 130);
      const logTop = stumpTop - lh;
      const mR = Math.min(W * 0.37, H * 0.165, 150);
      const mY = Math.max(H * 0.255, 58 + mR + 18);
      const axeLen = Math.min(W * 0.31, 128), blade = axeLen * 0.3;
      const pr = Math.max(15, Math.min(W / 18, 23));
      const pileB = H - Math.max(12, H * 0.02), pileL = 16 + pr * 0.4, pileR = W - 16 - pr * 0.4;
      const perRow = Math.max(4, Math.floor((pileR - pileL) / (pr * 2)));
      L = { cx, horizon, ground, srx, sry, stumpTop, lrx, lry, lh, logTop, mR, mY, axeLen, blade, pr, pileB, pileL, pileR, perRow,
        rowH: pr * 1.74, maxRows: Math.max(2, Math.min(5, Math.floor((pileB - (ground + H * 0.05)) / (pr * 1.74)))),
        lanX: cx - Math.min(W * 0.36, 160), lanY: ground - H * 0.17 };
      L.strike = { x: cx, y: logTop + 2 };
      L.pivS = { x: cx + axeLen, y: logTop + 2 - blade };
      L.pivR = { x: cx + axeLen + 4, y: logTop + 14 - blade };
      hint.style.top = Math.round(L.mY + 30) + "px";
      bg = renderBg();
      logImg = renderLog(false);
      knotImg = renderLog(true);
    }
    if (typeof ResizeObserver === "function") { ro = new ResizeObserver(() => layout()); ro.observe(root); }

    const off = (w, hh) => { const o = document.createElement("canvas"); o.width = Math.max(1, Math.round(w * dpr)); o.height = Math.max(1, Math.round(hh * dpr)); const x = o.getContext("2d"); x.scale(dpr, dpr); return [o, x]; };

    // Statische achtergrond: nachtlucht, maan, dennen, het huisje met de kachelpijp, sneeuw.
    function renderBg() {
      const [o, x] = off(W, H);
      const { horizon, cx } = L;
      const sky = x.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, "#04050a"); sky.addColorStop(0.55, "#0a0d18"); sky.addColorStop(1, "#1a1418");
      x.fillStyle = sky; x.fillRect(0, 0, W, horizon + 2);
      stars.forEach((s) => { x.fillStyle = "rgba(255,231,184," + (0.25 + 0.5 * Math.abs(Math.sin(s.ph))) + ")"; x.beginPath(); x.arc(s.x * W, s.y * horizon, s.r, 0, TAU); x.fill(); });
      // maan
      const mx = W * 0.16, my = H * 0.12, mr = Math.min(W, H) * 0.045;
      const halo = x.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 5);
      halo.addColorStop(0, "rgba(220,230,255,.18)"); halo.addColorStop(1, "rgba(220,230,255,0)");
      x.fillStyle = halo; x.beginPath(); x.arc(mx, my, mr * 5, 0, TAU); x.fill();
      x.fillStyle = "#e9eefc"; x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.fill();
      x.fillStyle = "rgba(160,170,200,.35)"; [[-0.3, -0.2, 0.25], [0.25, 0.2, 0.18], [0.1, -0.4, 0.12]].forEach(([a, b, r]) => { x.beginPath(); x.arc(mx + a * mr, my + b * mr, r * mr, 0, TAU); x.fill(); });
      // warme gloed aan de horizon (het huisje)
      const hg = x.createRadialGradient(W * 0.86, horizon, 0, W * 0.86, horizon, W * 0.7);
      hg.addColorStop(0, "rgba(255,106,26,.22)"); hg.addColorStop(1, "rgba(255,106,26,0)");
      x.fillStyle = hg; x.fillRect(0, 0, W, horizon + 2);
      const tree = (tx, base, th, tw, col, snow) => {
        x.fillStyle = col; x.beginPath();
        const tiers = 4;
        for (let i = 0; i < tiers; i++) {
          const y0 = base - th * (i / tiers) * 0.85, y1 = base - th * ((i + 1.6) / tiers) * 0.85, ww = tw * (1 - i / (tiers + 0.6));
          x.moveTo(tx - ww, y0); x.lineTo(tx, Math.max(base - th, y1)); x.lineTo(tx + ww, y0);
        }
        x.fill();
        if (snow) {
          x.fillStyle = "rgba(200,214,240,.16)";
          for (let i = 0; i < 4; i++) { const y0 = base - th * (i / 4) * 0.85, ww = tw * (1 - i / 4.6); x.beginPath(); x.moveTo(tx - ww * 0.9, y0 - 1); x.lineTo(tx - ww * 0.3, y0 - th * 0.08); x.lineTo(tx, y0 - th * 0.05); x.lineTo(tx - ww * 0.5, y0); x.fill(); }
        }
      };
      treesFar.forEach((t) => tree(t.x * W, horizon + 2, t.h * H, t.w * W * 0.5, "#0c1019", false));
      // huisje rechts: donker hout, verlicht raam, schoorsteen
      const hx = W * 0.7, hw = W * 0.36, hy = horizon + 2, hh = H * 0.075;
      x.fillStyle = "#0b0807"; x.fillRect(hx, hy - hh, hw, hh);
      x.beginPath(); x.moveTo(hx - 10, hy - hh); x.lineTo(hx + hw * 0.42, hy - hh - H * 0.06); x.lineTo(hx + hw + 10, hy - hh); x.fill();
      x.fillStyle = "rgba(220,230,250,.22)"; x.beginPath(); x.moveTo(hx - 10, hy - hh); x.lineTo(hx + hw * 0.42, hy - hh - H * 0.06); x.lineTo(hx + hw * 0.42, hy - hh - H * 0.052); x.lineTo(hx - 2, hy - hh + 1); x.fill();
      x.fillStyle = "#0b0807"; x.fillRect(hx + hw * 0.62, hy - hh - H * 0.07, W * 0.035, H * 0.05);
      L.chim = { x: hx + hw * 0.62 + W * 0.0175, y: hy - hh - H * 0.07 };
      L.win = { x: hx + hw * 0.18, y: hy - hh * 0.72, w: hw * 0.26, h: hh * 0.5 };
      treesNear.forEach((t) => { if (t.x > 0.62 && t.x < 0.98) return; tree(t.x * W, horizon + H * 0.02, t.h * H, t.w * W * 0.5, "#06070b", true); });
      // sneeuwveld
      const sn = x.createLinearGradient(0, horizon, 0, H);
      sn.addColorStop(0, "#1b2130"); sn.addColorStop(0.35, "#2a3243"); sn.addColorStop(1, "#1a1f2b");
      x.fillStyle = sn; x.fillRect(0, horizon + 1, W, H - horizon);
      // zachte sneeuwbulten
      x.fillStyle = "rgba(190,205,235,.06)";
      for (let i = 0; i < 6; i++) { x.beginPath(); x.ellipse((i + 0.5) / 6 * W, horizon + H * (0.03 + (i % 2) * 0.02), W * 0.2, H * 0.012, 0, 0, TAU); x.fill(); }
      // glinsteringen in de sneeuw
      for (let i = 0; i < 70; i++) { const gy = horizon + 4 + Math.pow(drng(), 0.8) * (H - horizon); x.fillStyle = "rgba(220,232,255," + (0.08 + drng() * 0.25) + ")"; x.fillRect(drng() * W, gy, 1.2, 1.2); }
      // voetsporen naar het huisje
      x.fillStyle = "rgba(8,10,16,.35)";
      for (let i = 0; i < 9; i++) { const k = i / 9, px = lerp(cx + W * 0.12, W * 0.78, k) + (i % 2 ? 5 : -5) * (1 - k), py = lerp(L.ground + H * 0.04, horizon + H * 0.01, k); x.beginPath(); x.ellipse(px, py, 4 * (1 - k * 0.7), 2 * (1 - k * 0.7), 0, 0, TAU); x.fill(); }
      // houtstapel: palen + schaduw
      const { pileL, pileR, pileB, rowH, maxRows, pr } = L;
      x.fillStyle = "rgba(0,0,0,.35)"; x.beginPath(); x.ellipse(W / 2, pileB + 2, (pileR - pileL) / 2 + 16, 8, 0, 0, TAU); x.fill();
      const ptop = pileB - rowH * maxRows - pr * 0.4;
      [pileL - pr * 0.5, pileR + pr * 0.5].forEach((px) => {
        const pg = x.createLinearGradient(px - 4, 0, px + 4, 0);
        pg.addColorStop(0, "#2a180c"); pg.addColorStop(0.5, "#6b4426"); pg.addColorStop(1, "#24140a");
        x.fillStyle = pg; x.fillRect(px - 4, ptop, 8, pileB - ptop + 2);
        x.fillStyle = "rgba(220,230,250,.5)"; x.beginPath(); x.ellipse(px, ptop, 5, 2.4, 0, 0, TAU); x.fill();
      });
      x.fillStyle = "#1d130c"; x.fillRect(pileL - pr * 0.5, pileB - 3, pileR - pileL + pr, 5);
      return o;
    }

    // Een rechtopstaand blok (zijkant met schors + bovenkant met jaarringen) als losse afbeelding: wordt in tweeën gedeeld.
    function renderLog(knot) {
      const { lrx, lry, lh } = L;
      const pw = lrx * 2 + 4, ph = lh + lry * 2 + 4;
      const [o, x] = off(pw, ph);
      const cx = pw / 2, top = lry + 2, bot = top + lh;
      const side = x.createLinearGradient(cx - lrx, 0, cx + lrx, 0);
      side.addColorStop(0, knot ? "#1f130a" : "#2a1a0e"); side.addColorStop(0.3, knot ? "#4a3220" : "#5a3a20");
      side.addColorStop(0.55, knot ? "#5a3d26" : "#6e4826"); side.addColorStop(1, "#1d1209");
      x.fillStyle = side;
      x.beginPath(); x.moveTo(cx - lrx, top); x.lineTo(cx - lrx, bot); x.ellipse(cx, bot, lrx, lry, 0, Math.PI, 0, true); x.lineTo(cx + lrx, top); x.closePath(); x.fill();
      // schorsgroeven
      const br = M.rng(knot ? 77 : 33);
      x.strokeStyle = "rgba(12,7,4,.55)"; x.lineCap = "round";
      for (let i = 0; i < 9; i++) {
        const u = -0.85 + (i / 8) * 1.7, bx = cx + u * lrx, y0 = top + lry * Math.sqrt(1 - u * u) + br() * 6;
        x.lineWidth = 1 + br() * 1.4;
        x.beginPath(); x.moveTo(bx, y0); x.bezierCurveTo(bx + (br() - 0.5) * 5, y0 + lh * 0.3, bx + (br() - 0.5) * 5, y0 + lh * 0.6, bx + (br() - 0.5) * 3, bot + lry * Math.sqrt(1 - u * u) - 2); x.stroke();
      }
      x.strokeStyle = "rgba(255,190,120,.12)"; x.lineWidth = 1;
      for (let i = 0; i < 5; i++) { const bx = cx - lrx * 0.1 + i * lrx * 0.12; x.beginPath(); x.moveTo(bx, top + lry + 4); x.lineTo(bx + 1, bot - 4); x.stroke(); }
      if (knot) { // knoest op de zijkant
        const kx = cx - lrx * 0.15, ky = top + lh * 0.55;
        const kg = x.createRadialGradient(kx, ky, 1, kx, ky, lrx * 0.32);
        kg.addColorStop(0, "#120a05"); kg.addColorStop(0.5, "#3a2412"); kg.addColorStop(0.8, "#6b4426"); kg.addColorStop(1, "rgba(60,36,18,0)");
        x.fillStyle = kg; x.beginPath(); x.ellipse(kx, ky, lrx * 0.32, lrx * 0.24, 0, 0, TAU); x.fill();
      }
      // bovenkant: kopshout met jaarringen en schorsrand
      x.fillStyle = "#3a2414"; x.beginPath(); x.ellipse(cx, top, lrx, lry, 0, 0, TAU); x.fill();
      const tg = x.createRadialGradient(cx - lrx * 0.1, top - lry * 0.1, 1, cx, top, lrx * 0.9);
      tg.addColorStop(0, knot ? "#c79560" : "#f0c88e"); tg.addColorStop(0.6, knot ? "#a87644" : "#d9a46a"); tg.addColorStop(1, knot ? "#7e5330" : "#b07a46");
      x.fillStyle = tg; x.beginPath(); x.ellipse(cx, top, lrx * 0.9, lry * 0.84, 0, 0, TAU); x.fill();
      x.strokeStyle = "rgba(120,70,34,.45)"; x.lineWidth = 1;
      for (let i = 1; i <= 5; i++) { x.beginPath(); x.ellipse(cx + (knot ? lrx * 0.08 : 0), top, lrx * 0.16 * i, lry * 0.16 * i, 0, 0, TAU); x.stroke(); }
      x.strokeStyle = "rgba(70,40,18,.5)";
      x.beginPath(); x.moveTo(cx, top); x.lineTo(cx + lrx * 0.55, top - lry * 0.3); x.stroke();
      return { img: o, w: pw, h: ph, top };
    }

    // --- Spelstatus ---
    let t0 = 0, lastFrame = 0, now0 = 0;
    let idx = 0, cracked = false, streak = 0, best = 0, logs = 0, perfect = 0, misses = 0, swings = 0;
    let logGone = false, busyUntil = 0, swingAt = -1, swingRes = null, dropAt = -1e9, wobble = 0, shake = 0, flash = 0, gold = 0, lastSec = 99;
    let zoneC = blocks[0].c, zoneW = halfWidth(0, d), visC = zoneC, visW = zoneW, glow = 0;
    const trail = [];
    const parts = [], pieces = [], stack = [];

    const needleNow = (t) => needle(t, d);
    const playT = () => (phase === "play" || phase === "end" ? performance.now() - t0 : 0);

    function popup(text, cls, y) {
      const p = h("div", "bj-pop " + cls, text);
      p.style.top = Math.round(y != null ? y : L.logTop - 34) + "px";
      p.addEventListener("animationend", () => p.remove());
      root.appendChild(p);
      if (cls !== "c") root.querySelectorAll(".bj-pop:not(.c)").forEach((x) => { if (x !== p && !x.classList.contains("k")) x.remove(); });
    }
    function bumpCount() {
      cntNum.textContent = String(logs);
      cntIco.classList.remove("bump"); void cntIco.offsetWidth; cntIco.classList.add("bump");
    }

    function chips(n, power, hot) {
      const { strike } = L;
      for (let i = 0; i < n && parts.length < 320; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.8, v = power * (0.35 + Math.random() * 0.9);
        const col = ["#f3c98f", "#e4ae70", "#c8894c", "#8a5a36", "#5a3519"][Math.floor(Math.random() * 5)];
        parts.push({ k: "chip", x: strike.x + (Math.random() - 0.5) * L.lrx, y: strike.y + 4, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 24, w: 2 + Math.random() * 5, h: 1.5 + Math.random() * 2.5, col, life: 0, max: 1.3 + Math.random() * 0.8 });
      }
      if (hot) for (let i = 0; i < n * 0.8 && parts.length < 360; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = power * (0.6 + Math.random() * 1.1);
        parts.push({ k: "spark", x: strike.x, y: strike.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.4 + Math.random() * 0.6, s: 1 + Math.random() * 2 });
      }
    }
    function puff(x, y, n) {
      for (let i = 0; i < n && parts.length < 360; i++) {
        const a = Math.PI + Math.random() * Math.PI;
        parts.push({ k: "snow", x: x + (Math.random() - 0.5) * L.srx * 1.6, y, vx: Math.cos(a) * 60 * Math.random(), vy: Math.sin(a) * 50 * Math.random(), life: 0, max: 0.7 + Math.random() * 0.5, s: 2 + Math.random() * 4 });
      }
    }

    // Twee helften vliegen omhoog, draaien en landen daarna op de stapel.
    function split(img, perfectHit) {
      const { strike, lrx, lh } = L;
      const slot = stack.length;
      const target = slotPos(slot);
      [-1, 1].forEach((s) => {
        const p = perfectHit ? 1.25 : 1;
        pieces.push({ img, side: s, x: strike.x + s * lrx * 0.5, y: strike.y + lh * 0.5, vx: s * (150 + Math.random() * 90) * p, vy: -(330 + Math.random() * 120) * p,
          rot: 0, vr: s * (5 + Math.random() * 4) * p, life: 0, sx: 0, sy: 0, target, gold: perfectHit ? 1 : 0 });
      });
      if (target) stack.push({ x: target.x, y: target.y, pop: -1, j: slotJit[slot % slotJit.length], gold: perfectHit });
    }

    // Stapelplek n: rijen van onder naar boven, oneven rijen half verschoven (zoals een echte houtmijt).
    function slotPos(n) {
      const { pr, pileB, pileL, perRow, rowH, maxRows } = L;
      for (let row = 0; row < maxRows; row++) {
        const cnt = perRow - (row % 2);
        if (n < cnt) return { x: pileL + pr + (row % 2 ? pr : 0) + n * pr * 2, y: pileB - pr - row * rowH };
        n -= cnt;
      }
      return null;
    }

    function swing() {
      if (phase !== "play") return;
      const t = playT();
      if (t < busyUntil) return;
      const p = needleNow(t);
      const res = judge(p, zoneC, zoneW);
      swings++;
      swingAt = t; swingRes = res;
      busyUntil = t + (res === "miss" ? MISS_BUSY : HIT_BUSY);
      beep(260, 0.05, "sine", 0.04); // zoef
      later(() => impact(res), SWING);
    }

    function impact(res) {
      const b = blocks[idx % blocks.length];
      if (res === "miss") {
        misses++; streak = 0;
        zoneW = halfWidth(0, d);
        wobble = 1; shake = reduced ? 0 : 0.35;
        chips(5, 140, false);
        popup("MIS", "m");
        beep(150, 0.12, "triangle", 0.09); beep(95, 0.16, "square", 0.04);
        buzz(40);
        return;
      }
      const perf = res === "perfect";
      streak++; best = Math.max(best, streak);
      if (perf) perfect++;
      if (b.knot && !cracked) { // knoest: eerst een barst
        cracked = true;
        shake = reduced ? 0 : 0.6; wobble = 0.6;
        chips(perf ? 16 : 10, 220, perf);
        popup("KRAK! nog één", "k", L.logTop - 30);
        beep(200, 0.08, "square", 0.07);
        buzz(18);
        zoneW = halfWidth(streak, d);
        zoneC = Math.max(zoneW, Math.min(1 - zoneW, 1 - b.c)); // vak springt naar de overkant
        return;
      }
      logs++;
      split(b.knot ? knotImg : logImg, perf);
      shake = reduced ? 0 : perf ? 1 : 0.65;
      chips(perf ? 34 : 18, perf ? 360 : 260, perf);
      puff(L.cx, L.stumpTop + L.sry, perf ? 10 : 5);
      if (perf) { flash = 1; gold = 1; popup("PERFECT!", "p"); beep(880 + Math.min(streak, 20) * 30, 0.1, "triangle", 0.1); beep(1320 + Math.min(streak, 20) * 40, 0.14, "sine", 0.06); buzz(28); }
      else { popup("RAAK", "g"); beep(520 + Math.min(streak, 20) * 20, 0.07, "triangle", 0.08); buzz(16); }
      beep(110, 0.09, "square", 0.06); // de klap
      bumpCount();
      if (QUIPS[streak]) later(() => popup(QUIPS[streak], "c", L.ground + H * 0.075), 160);
      if (logs >= 3) hint.style.opacity = "0";
      idx++; cracked = false;
      zoneW = halfWidth(streak, d);
      zoneC = Math.max(zoneW, Math.min(1 - zoneW, blocks[idx % blocks.length].c));
      logGone = true;
      later(() => { dropAt = performance.now(); logGone = false; }, 90);
    }

    const onDown = (e) => { if (e.button > 0 || phase !== "play") return; e.preventDefault(); swing(); };
    const onKey = (e) => { if ((e.code === "Space" || e.key === "Enter") && phase === "play" && !e.repeat) { e.preventDefault(); swing(); } };
    root.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);

    // --- Tekenen ---
    const mAng = (p) => Math.PI * (1.12 + 0.76 * p); // meterboog: van links-boven naar rechts-boven

    function drawMeter(t, ts) {
      const { cx, mY, mR } = L;
      const tw = Math.max(14, mR * 0.13);
      g.save();
      // ijzeren plaat achter de boog
      const plate = g.createRadialGradient(cx, mY, mR * 0.2, cx, mY, mR + tw * 1.4);
      plate.addColorStop(0, "rgba(23,16,11,.0)"); plate.addColorStop(0.75, "rgba(23,16,11,.55)"); plate.addColorStop(1, "rgba(23,16,11,0)");
      g.fillStyle = plate; g.beginPath(); g.arc(cx, mY, mR + tw * 1.4, Math.PI, TAU); g.fill();
      // baan
      g.lineCap = "round";
      g.lineWidth = tw + 6; g.strokeStyle = "rgba(4,3,2,.9)";
      g.beginPath(); g.arc(cx, mY, mR, mAng(0), mAng(1)); g.stroke();
      const tg = g.createLinearGradient(0, mY - mR - tw, 0, mY);
      tg.addColorStop(0, "#3a2c22"); tg.addColorStop(1, "#1a120c");
      g.lineWidth = tw; g.strokeStyle = tg;
      g.beginPath(); g.arc(cx, mY, mR, mAng(0), mAng(1)); g.stroke();
      // klinknagels aan de uiteinden
      [0, 1].forEach((q) => {
        const a = mAng(q) + (q ? 0.09 : -0.09);
        const rx = cx + Math.cos(a) * mR, ry = mY + Math.sin(a) * mR;
        const rg = g.createRadialGradient(rx - 1.5, ry - 1.5, 0.5, rx, ry, tw * 0.42);
        rg.addColorStop(0, "#8a7a6a"); rg.addColorStop(0.5, "#3a2c22"); rg.addColorStop(1, "#120c08");
        g.fillStyle = rg; g.beginPath(); g.arc(rx, ry, tw * 0.42, 0, TAU); g.fill();
      });
      // streepjes
      g.lineCap = "butt"; g.strokeStyle = "rgba(255,231,184,.18)"; g.lineWidth = 1.5;
      for (let i = 0; i <= 20; i++) {
        const a = mAng(i / 20), r0 = mR + tw * 0.5 + 3, r1 = r0 + (i % 5 ? 4 : 8);
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, mY + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, mY + Math.sin(a) * r1); g.stroke();
      }
      // gloeiend vak + perfect-kern
      const a0 = mAng(Math.max(0, visC - visW)), a1 = mAng(Math.min(1, visC + visW));
      const pk = Math.max(0.016, visW * PERFECT_K);
      const live = phase === "play" || phase === "howto" || phase === "count";
      const pulse = 0.75 + 0.25 * Math.sin(ts * 6) + glow * 0.4;
      g.globalAlpha = live ? 1 : 0.5;
      g.shadowColor = "rgba(255,106,26,.95)"; g.shadowBlur = 16 + 10 * pulse;
      g.lineCap = "round";
      g.lineWidth = tw - 2; g.strokeStyle = "#c2300f";
      g.beginPath(); g.arc(cx, mY, mR, a0, a1); g.stroke();
      g.shadowBlur = 0;
      g.lineWidth = tw * 0.5; g.strokeStyle = "rgba(255," + Math.round(106 + 40 * pulse) + ",26,1)";
      g.beginPath(); g.arc(cx, mY, mR, a0, a1); g.stroke();
      g.lineWidth = tw * 0.16; g.strokeStyle = "rgba(255,194,71,.8)";
      g.beginPath(); g.arc(cx, mY, mR - tw * 0.05, a0, a1); g.stroke();
      g.shadowColor = "rgba(255,194,71,1)"; g.shadowBlur = 12 + 10 * pulse;
      const k0 = mAng(Math.max(0, visC - pk)), k1 = mAng(Math.min(1, visC + pk));
      g.lineCap = "butt";
      g.lineWidth = tw + 3; g.strokeStyle = "#ffc247";
      g.beginPath(); g.arc(cx, mY, mR, k0, k1); g.stroke();
      g.shadowBlur = 0;
      g.lineWidth = tw * 0.45; g.strokeStyle = "#fff6dc";
      g.beginPath(); g.arc(cx, mY, mR, k0, k1); g.stroke();
      g.shadowBlur = 0; g.globalAlpha = 1;
      // naald (met spoor)
      const p = phase === "howto" ? needle(ts * 1000, d) : needleNow(t);
      trail.push(p); if (trail.length > 6) trail.shift();
      g.lineCap = "round";
      trail.forEach((q, i) => {
        if (i === trail.length - 1) return;
        const a = mAng(q);
        g.strokeStyle = "rgba(255,231,184," + (0.05 + i * 0.04) + ")"; g.lineWidth = 3;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * mR * 0.35, mY + Math.sin(a) * mR * 0.35); g.lineTo(cx + Math.cos(a) * (mR + tw * 0.6), mY + Math.sin(a) * (mR + tw * 0.6)); g.stroke();
      });
      const a = mAng(p);
      const inZone = Math.abs(p - zoneC) <= zoneW;
      g.shadowColor = inZone ? "rgba(255,243,208,1)" : "rgba(255,194,71,.7)"; g.shadowBlur = inZone ? 16 : 8;
      g.strokeStyle = inZone ? "#fff6dc" : "#ffd98a"; g.lineWidth = 4;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * mR * 0.3, mY + Math.sin(a) * mR * 0.3); g.lineTo(cx + Math.cos(a) * (mR + tw * 0.75), mY + Math.sin(a) * (mR + tw * 0.75)); g.stroke();
      g.shadowBlur = 0;
      // naaf
      const hub = g.createRadialGradient(cx - 3, mY - 3, 1, cx, mY, 13);
      hub.addColorStop(0, "#ffd98a"); hub.addColorStop(0.35, "#ff6a1a"); hub.addColorStop(0.7, "#3a1c0c"); hub.addColorStop(1, "#120a06");
      g.fillStyle = hub; g.beginPath(); g.arc(cx, mY, 12, 0, TAU); g.fill();
      g.strokeStyle = "rgba(255,194,71,.35)"; g.lineWidth = 1; g.stroke();
      // reeks onder de naaf
      if (phase !== "howto") {
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        g.font = "900 " + Math.round(mR * 0.26) + "px Unbounded, system-ui, sans-serif";
        g.fillStyle = streak ? "#ffc247" : "rgba(184,169,154,.5)";
        g.shadowColor = "rgba(255,106,26,.7)"; g.shadowBlur = streak ? 14 : 0;
        g.fillText("×" + streak, cx, mY + mR * 0.42);
        g.shadowBlur = 0;
        g.font = "700 " + Math.max(10, Math.round(mR * 0.075)) + "px system-ui, sans-serif";
        g.fillStyle = "rgba(184,169,154,.8)";
        g.fillText("REEKS", cx, mY + mR * 0.42 + Math.max(14, mR * 0.12));
      }
      g.restore();
    }

    function drawLantern(ts) {
      const { lanX, lanY, ground } = L;
      const fl = 0.85 + 0.15 * Math.sin(ts * 9.1) * Math.sin(ts * 3.7);
      const lg = g.createRadialGradient(lanX, lanY, 4, lanX, lanY + H * 0.08, Math.min(W, H) * 0.55);
      lg.addColorStop(0, "rgba(255,150,60," + 0.3 * fl + ")"); lg.addColorStop(0.4, "rgba(255,106,26," + 0.1 * fl + ")"); lg.addColorStop(1, "rgba(255,106,26,0)");
      g.fillStyle = lg; g.fillRect(0, L.horizon - H * 0.2, W, H);
      // paal
      g.fillStyle = "#1a100a"; g.fillRect(lanX - 3, lanY - 6, 6, ground - lanY + 16);
      g.fillRect(lanX - 3, lanY - 14, 16, 4);
      // lantaarn aan de arm
      const x = lanX + 10, y = lanY - 8;
      g.strokeStyle = "#140c07"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y - 2); g.lineTo(x, y + 4); g.stroke();
      const gg = g.createRadialGradient(x, y + 13, 1, x, y + 13, 10);
      gg.addColorStop(0, "#fff3d0"); gg.addColorStop(0.4, "rgba(255,194,71," + fl + ")"); gg.addColorStop(1, "rgba(255,106,26,.25)");
      g.fillStyle = gg; g.fillRect(x - 6, y + 5, 12, 16);
      g.strokeStyle = "#140c07"; g.lineWidth = 2; g.strokeRect(x - 6, y + 5, 12, 16);
      g.fillStyle = "#140c07"; g.beginPath(); g.moveTo(x - 8, y + 5); g.lineTo(x, y); g.lineTo(x + 8, y + 5); g.fill();
      g.save(); g.globalCompositeOperation = "lighter";
      const hg = g.createRadialGradient(x, y + 13, 0, x, y + 13, 30);
      hg.addColorStop(0, "rgba(255,194,71," + 0.35 * fl + ")"); hg.addColorStop(1, "rgba(255,194,71,0)");
      g.fillStyle = hg; g.beginPath(); g.arc(x, y + 13, 30, 0, TAU); g.fill();
      g.restore();
    }

    function drawStump() {
      const { cx, stumpTop, srx, sry, ground } = L;
      const bottom = ground + H * 0.025;
      g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.ellipse(cx + 10, bottom, srx * 1.35, sry * 1.1, 0, 0, TAU); g.fill();
      const sg = g.createLinearGradient(cx - srx, 0, cx + srx, 0);
      sg.addColorStop(0, "#1a0f08"); sg.addColorStop(0.25, "#4a2e18"); sg.addColorStop(0.5, "#5c3a1f"); sg.addColorStop(1, "#140b06");
      g.fillStyle = sg;
      g.beginPath(); g.moveTo(cx - srx, stumpTop); g.lineTo(cx - srx * 1.08, bottom); g.ellipse(cx, bottom, srx * 1.08, sry, 0, Math.PI, 0, true); g.lineTo(cx + srx, stumpTop); g.closePath(); g.fill();
      g.strokeStyle = "rgba(10,6,3,.6)"; g.lineWidth = 2;
      for (let i = 0; i < 8; i++) { const u = -0.8 + i * 0.23, x = cx + u * srx; g.beginPath(); g.moveTo(x, stumpTop + sry * Math.sqrt(1 - u * u)); g.lineTo(x * 1 + u * 3, bottom + sry * Math.sqrt(1 - u * u) - 2); g.stroke(); }
      // bovenkant
      g.fillStyle = "#2e1c0f"; g.beginPath(); g.ellipse(cx, stumpTop, srx, sry, 0, 0, TAU); g.fill();
      const tg = g.createRadialGradient(cx - srx * 0.2, stumpTop - sry * 0.2, 2, cx, stumpTop, srx);
      tg.addColorStop(0, "#a8744a"); tg.addColorStop(0.7, "#8a5a36"); tg.addColorStop(1, "#5e3c22");
      g.fillStyle = tg; g.beginPath(); g.ellipse(cx, stumpTop, srx * 0.92, sry * 0.86, 0, 0, TAU); g.fill();
      g.strokeStyle = "rgba(60,34,16,.35)"; g.lineWidth = 1;
      for (let i = 1; i <= 7; i++) { g.beginPath(); g.ellipse(cx + srx * 0.04, stumpTop, srx * 0.13 * i, sry * 0.13 * i, 0, 0, TAU); g.stroke(); }
      g.strokeStyle = "rgba(30,16,8,.5)"; g.lineWidth = 1.5; // oude bijlkerven
      [[-0.55, -0.1, -0.2, 0.3], [0.3, -0.4, 0.6, 0.1], [0.1, 0.35, 0.45, 0.5]].forEach(([a, b, e, f]) => { g.beginPath(); g.moveTo(cx + a * srx, stumpTop + b * sry); g.lineTo(cx + e * srx, stumpTop + f * sry); g.stroke(); });
      // sneeuwrandje + sneeuw tegen de voet
      const cap = g.createRadialGradient(cx - srx * 0.62, stumpTop - sry * 0.45, 1, cx - srx * 0.62, stumpTop - sry * 0.45, srx * 0.3);
      cap.addColorStop(0, "rgba(230,238,252,.9)"); cap.addColorStop(0.7, "rgba(210,222,245,.6)"); cap.addColorStop(1, "rgba(210,222,245,0)");
      g.fillStyle = cap; g.beginPath(); g.ellipse(cx - srx * 0.62, stumpTop - sry * 0.45, srx * 0.3, sry * 0.42, -0.2, 0, TAU); g.fill();
      g.fillStyle = "#3a4558";
      g.beginPath(); g.ellipse(cx, bottom + sry * 0.4, srx * 1.3, sry * 0.75, 0, Math.PI, TAU); g.fill();
      g.fillStyle = "rgba(220,230,250,.18)";
      g.beginPath(); g.ellipse(cx - srx * 0.3, bottom + sry * 0.05, srx * 0.8, sry * 0.25, 0, Math.PI, TAU); g.fill();
    }

    function drawLog(now) {
      if (phase === "result") return;
      const { cx, stumpTop, lrx, lry } = L;
      const b = blocks[idx % blocks.length];
      const im = b.knot ? knotImg : logImg;
      const dk = Math.min(1, (now - dropAt) / 260);
      let dy = 0;
      if (dk < 1) dy = dk < 0.7 ? -H * 0.09 * (1 - Math.pow(dk / 0.7, 2)) : -6 * Math.sin(((dk - 0.7) / 0.3) * Math.PI);
      if (logGone) return;
      g.save();
      if (dk < 0.5) g.globalAlpha = dk * 2;
      g.translate(cx, stumpTop + dy);
      if (wobble > 0.01) g.rotate(Math.sin(now / 30) * 0.06 * wobble);
      g.fillStyle = "rgba(0,0,0,.4)"; g.beginPath(); g.ellipse(4, 2, lrx * 1.1, lry * 1.1, 0, 0, TAU); g.fill();
      g.drawImage(im.img, -im.w / 2, -(im.h - lry - 2), im.w, im.h);
      if (cracked) { // barst
        const top = -(im.h - lry - 2) + im.top;
        g.strokeStyle = "#0e0704"; g.lineWidth = 2.2; g.lineJoin = "round";
        g.beginPath(); g.moveTo(-lrx * 0.7, top); g.lineTo(-lrx * 0.2, top + 2); g.lineTo(lrx * 0.1, top - 1); g.lineTo(lrx * 0.7, top + 1);
        g.moveTo(-lrx * 0.05, top + lry); g.lineTo(lrx * 0.05, top + L.lh * 0.35); g.lineTo(-lrx * 0.05, top + L.lh * 0.6); g.stroke();
      }
      g.restore();
    }

    function axePose(now) {
      const { pivS, pivR } = L;
      const raised = -Math.PI / 2 + 0.38, hitA = -Math.PI;
      const t = playT();
      let k = 0, extra = 0;
      if (swingAt >= 0 && phase !== "howto") {
        const e = t - swingAt;
        if (e < SWING) k = Math.pow(Math.max(0, e) / SWING, 2.2);
        else {
          const hold = swingRes === "miss" ? 300 : 60, back = (swingRes === "miss" ? MISS_BUSY : HIT_BUSY) - SWING - hold;
          if (e < SWING + hold) { k = 1; if (swingRes === "miss") extra = -Math.sin((e - SWING) / hold * Math.PI * 3) * 0.12 * (1 - (e - SWING) / hold); }
          else if (e < SWING + hold + back) { const q = (e - SWING - hold) / back; k = 1 - (1 - Math.pow(1 - q, 3)); }
        }
      }
      const idle = k === 0 ? Math.sin(now / 420) * 0.035 : 0;
      return { a: lerp(raised, hitA, k) + extra + idle, x: lerp(pivR.x, pivS.x, k), y: lerp(pivR.y, pivS.y, k), k };
    }

    function drawAxe(pose, alpha, glint) {
      const { axeLen: len, blade: B } = L;
      g.save();
      g.globalAlpha = alpha;
      g.translate(pose.x, pose.y); g.rotate(pose.a);
      // steel
      const hg = g.createLinearGradient(0, -5, 0, 5);
      hg.addColorStop(0, "#c48a52"); hg.addColorStop(0.45, "#8a5a36"); hg.addColorStop(1, "#3e2412");
      g.fillStyle = hg;
      g.beginPath(); g.moveTo(-len * 0.35, -4); g.quadraticCurveTo(len * 0.3, -6.5, len + 6, -4.5); g.lineTo(len + 6, 4.5); g.quadraticCurveTo(len * 0.3, 6.5, -len * 0.35, 5); g.closePath(); g.fill();
      g.fillStyle = "#2a160a"; g.beginPath(); g.ellipse(-len * 0.35, 0.5, 4, 6, 0, 0, TAU); g.fill();
      g.fillStyle = "rgba(30,14,6,.9)"; // greep
      for (let i = 0; i < 4; i++) g.fillRect(-len * 0.3 + i * 7, -5.5, 4, 11);
      // kop
      const sg = g.createLinearGradient(0, -B - 2, 0, 12);
      sg.addColorStop(0, glint ? "#fff3d0" : "#eef3f7"); sg.addColorStop(0.18, glint ? "#ffc247" : "#a9b3bd"); sg.addColorStop(0.55, "#4c545d"); sg.addColorStop(1, "#22272d");
      g.fillStyle = sg;
      g.beginPath();
      g.moveTo(len - 9, 13); g.lineTo(len + 11, 13); g.lineTo(len + 12, -4);
      g.quadraticCurveTo(len + 16, -B * 0.6, len + 24, -B + 7);
      g.quadraticCurveTo(len + 2, -B - 8, len - 22, -B + 7);
      g.quadraticCurveTo(len - 12, -B * 0.6, len - 9, -4);
      g.closePath(); g.fill();
      g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = 1.2; g.stroke();
      // snede
      g.strokeStyle = glint ? "rgba(255,243,208,1)" : "rgba(255,210,150,.75)"; g.lineWidth = 2;
      if (glint) { g.shadowColor = "#ffc247"; g.shadowBlur = 18; }
      g.beginPath(); g.moveTo(len - 20, -B + 6.2); g.quadraticCurveTo(len + 2, -B - 7, len + 22, -B + 6.2); g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(len - 4, -B * 0.55, 4, B * 0.5);
      g.restore();
    }

    function drawStack(now) {
      const { pr } = L;
      stack.forEach((s) => {
        if (s.pop < 0) return;
        const e = Math.min(1, (now - s.pop) / 260);
        const sc = e < 1 ? 1 + 0.35 * Math.sin(e * Math.PI) : 1;
        const r = pr * s.j.r * sc;
        g.save(); g.translate(s.x, s.y); g.rotate(s.j.a);
        [-1, 1].forEach((side) => {
          g.save(); g.translate(side * 1.2, 0);
          g.beginPath(); g.arc(0, 0, r, side < 0 ? Math.PI / 2 : -Math.PI / 2, side < 0 ? Math.PI * 1.5 : Math.PI / 2); g.closePath();
          g.fillStyle = "#3a2414"; g.fill();
          g.beginPath(); g.arc(0, 0, r * 0.84, side < 0 ? Math.PI / 2 : -Math.PI / 2, side < 0 ? Math.PI * 1.5 : Math.PI / 2); g.closePath();
          const wg = g.createRadialGradient(0, 0, 0, 0, 0, r);
          const tone = s.j.tone;
          wg.addColorStop(0, tone > 0.5 ? "#f0c88e" : "#e2b47a"); wg.addColorStop(1, tone > 0.5 ? "#b07a46" : "#9c6a3e");
          g.fillStyle = wg; g.fill();
          g.strokeStyle = "rgba(120,70,34,.4)"; g.lineWidth = 0.8;
          for (let i = 1; i <= 3; i++) { g.beginPath(); g.arc(0, 0, r * 0.22 * i, side < 0 ? Math.PI / 2 : -Math.PI / 2, side < 0 ? Math.PI * 1.5 : Math.PI / 2); g.stroke(); }
          g.restore();
        });
        if (s.gold && e < 1) { g.globalCompositeOperation = "lighter"; g.fillStyle = "rgba(255,194,71," + (1 - e) * 0.7 + ")"; g.beginPath(); g.arc(0, 0, r * 1.3, 0, TAU); g.fill(); }
        g.restore();
        // sneeuwtje bovenop de stapel
      });
    }

    function drawPieces() {
      pieces.forEach((p) => {
        const im = p.img;
        g.save();
        g.translate(p.x, p.y); g.rotate(p.rot);
        const sc = p.scale == null ? 1 : p.scale;
        g.scale(sc, sc);
        const hw = im.w / 2;
        const sx = p.side < 0 ? 0 : hw;
        g.drawImage(im.img, sx * dpr, 0, hw * dpr, im.h * dpr, p.side < 0 ? -hw : 0, -im.h / 2, hw, im.h);
        // binnenkant: vers, licht hout
        g.fillStyle = "#e9be86";
        g.fillRect(p.side < 0 ? -2 : 0, -im.h / 2 + im.top, 2, im.h - im.top - L.lry);
        if (p.gold > 0.02) {
          g.globalCompositeOperation = "lighter"; g.globalAlpha = p.gold * 0.7;
          g.drawImage(im.img, sx * dpr, 0, hw * dpr, im.h * dpr, p.side < 0 ? -hw : 0, -im.h / 2, hw, im.h);
        }
        g.restore();
      });
    }

    function drawParts() {
      parts.forEach((p) => {
        const a = Math.max(0, 1 - p.life / p.max);
        if (p.k === "chip") {
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, a * 2);
          g.fillStyle = p.col; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore();
        } else if (p.k === "spark") {
          g.save(); g.globalCompositeOperation = "lighter";
          g.fillStyle = a > 0.5 ? "rgba(255,236,170," + a + ")" : "rgba(255,150,40," + a * 1.6 + ")";
          g.beginPath(); g.arc(p.x, p.y, p.s, 0, TAU); g.fill(); g.restore();
        } else if (p.k === "snow") {
          g.fillStyle = "rgba(225,234,250," + a * 0.5 + ")";
          g.beginPath(); g.arc(p.x, p.y, p.s * (1 + p.life), 0, TAU); g.fill();
        } else if (p.k === "smoke") {
          g.fillStyle = "rgba(150,140,140," + a * 0.13 + ")";
          g.beginPath(); g.arc(p.x, p.y, p.s * (1 + p.life * 1.5), 0, TAU); g.fill();
        } else if (p.k === "ember") {
          g.save(); g.globalCompositeOperation = "lighter";
          g.fillStyle = "rgba(255,140,40," + a + ")"; g.beginPath(); g.arc(p.x, p.y, 1.2, 0, TAU); g.fill(); g.restore();
        }
      });
    }

    function drawSnow(dt, ts) {
      g.fillStyle = "rgba(230,238,252,.75)";
      flakes.forEach((f) => {
        f.y += f.sp * dt; f.x += Math.sin(ts * 0.8 + f.ph) * 0.004 * dt * 10 - 0.006 * dt;
        if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
        if (f.x < -0.02) f.x = 1.02;
        g.globalAlpha = 0.35 + f.r / 4;
        g.beginPath(); g.arc(f.x * W, f.y * H, f.r, 0, TAU); g.fill();
      });
      g.globalAlpha = 1;
    }

    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (!L || !W) layout();
      const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
      lastFrame = now;
      const ts = (now - now0) / 1000, t = playT();

      if (phase === "play") {
        const left = Math.max(0, DURATION - t);
        barFill.style.transform = "scaleX(" + (left / DURATION).toFixed(4) + ")";
        const sec = Math.ceil(left / 1000);
        if (sec !== lastSec) {
          lastSec = sec; timeEl.textContent = String(sec);
          if (sec <= 3 && sec > 0) { timeEl.classList.remove("hot"); void timeEl.offsetWidth; timeEl.classList.add("hot"); beep(660, 0.04, "square", 0.03); }
        }
        if (left <= 0 && t >= busyUntil) finish();
      }

      // uitdempen
      shake *= Math.pow(0.0015, dt); flash *= Math.pow(0.02, dt); gold *= Math.pow(0.05, dt); wobble *= Math.pow(0.01, dt); glow *= Math.pow(0.1, dt);
      visC += (zoneC - visC) * Math.min(1, dt * 18); visW += (zoneW - visW) * Math.min(1, dt * 14);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.k === "chip") {
          p.vy += 900 * dt; p.rot += p.vr * dt;
          const floor = L.ground + H * 0.02 + (p.x % 7);
          if (p.y > floor && p.vy > 0) { p.y = floor; p.vy *= -0.25; p.vx *= 0.5; p.vr *= 0.4; }
        } else if (p.k === "spark") { p.vy += 500 * dt; p.vx *= 0.97; }
        else if (p.k === "snow") { p.vy += 60 * dt; p.vx *= 0.95; }
        else if (p.k === "smoke" || p.k === "ember") { p.vx += 6 * dt; }
        if (p.life >= p.max) parts.splice(i, 1);
      }
      // rook + vonkjes uit de schoorsteen van het huisje
      if (L.chim && Math.random() < dt * 5) parts.push({ k: "smoke", x: L.chim.x, y: L.chim.y, vx: 4 + Math.random() * 6, vy: -18 - Math.random() * 10, life: 0, max: 3.5, s: 5 + Math.random() * 4 });
      if (L.chim && Math.random() < dt * 1.2) parts.push({ k: "ember", x: L.chim.x, y: L.chim.y, vx: Math.random() * 10, vy: -30 - Math.random() * 20, life: 0, max: 1.6 });
      for (let i = pieces.length - 1; i >= 0; i--) {
        const p = pieces[i];
        p.life += dt; p.gold *= Math.pow(0.1, dt);
        if (p.life < 0.42 || !p.target) {
          p.vy += 1500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
          if (!p.target && (p.y > H + 80 || p.life > 1.6)) { pieces.splice(i, 1); continue; }
          if (p.target) { p.sx = p.x; p.sy = p.y; p.sr = p.rot; }
        } else {
          const q = Math.min(1, (p.life - 0.42) / 0.36), e = q * q * (3 - 2 * q);
          p.x = lerp(p.sx, p.target.x + p.side * 2, e); p.y = lerp(p.sy, p.target.y, e) - Math.sin(q * Math.PI) * 40;
          p.rot = lerp(p.sr, p.side * Math.PI / 2 + Math.round(p.sr / Math.PI) * Math.PI, e);
          p.scale = lerp(1, (L.pr * 2) / L.lh, e);
          if (q >= 1) {
            pieces.splice(i, 1);
            const s = stack.find((s) => s.x === p.target.x && s.y === p.target.y);
            if (s && s.pop < 0) { s.pop = now; beep(300 + Math.random() * 60, 0.05, "triangle", 0.04); puffAt(s.x, s.y - L.pr); }
          }
        }
      }

      // tekenen
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (shake > 0.01) g.translate((Math.random() - 0.5) * 16 * shake, (Math.random() - 0.5) * 12 * shake);
      g.drawImage(bg, 0, 0, W, H);
      // raam van het huisje flikkert
      if (L.win) {
        const w = L.win, fl = 0.7 + 0.3 * Math.sin(ts * 5.3) * Math.sin(ts * 2.1 + 1);
        g.save(); g.globalCompositeOperation = "lighter";
        const wg = g.createRadialGradient(w.x + w.w / 2, w.y + w.h / 2, 0, w.x + w.w / 2, w.y + w.h / 2, w.w * 1.6);
        wg.addColorStop(0, "rgba(255,150,50," + 0.35 * fl + ")"); wg.addColorStop(1, "rgba(255,150,50,0)");
        g.fillStyle = wg; g.fillRect(w.x - w.w * 1.6, w.y - w.w * 1.6, w.w * 4.2, w.w * 4.2);
        g.restore();
        g.fillStyle = "rgb(255," + Math.round(150 + 50 * fl) + ",70)"; g.fillRect(w.x, w.y, w.w, w.h);
        g.fillStyle = "#0b0807"; g.fillRect(w.x + w.w / 2 - 1, w.y, 2, w.h); g.fillRect(w.x, w.y + w.h / 2 - 1, w.w, 2);
      }
      drawLantern(ts);
      drawStump();
      drawStack(now);
      drawLog(now);
      // bijl met bewegingsonscherpte
      const pose = axePose(now);
      if (pose.k > 0.05 && pose.k < 0.999) {
        const prevA = lerp(-Math.PI / 2 + 0.38, -Math.PI, Math.max(0, pose.k - 0.25));
        drawAxe({ a: prevA, x: pose.x, y: pose.y }, 0.14, false);
        drawAxe({ a: (prevA + pose.a) / 2, x: pose.x, y: pose.y }, 0.22, false);
      }
      drawAxe(pose, 1, gold > 0.15);
      drawPieces();
      drawParts();
      drawSnow(dt, ts);
      if (phase !== "result") drawMeter(t, ts);
      if (flash > 0.01) {
        g.save(); g.globalCompositeOperation = "lighter";
        const fg = g.createRadialGradient(L.cx, L.logTop, 0, L.cx, L.logTop, Math.max(W, H) * 0.8);
        fg.addColorStop(0, "rgba(255,226,140," + flash * 0.75 + ")"); fg.addColorStop(0.4, "rgba(255,170,60," + flash * 0.3 + ")"); fg.addColorStop(1, "rgba(255,106,26,0)");
        g.fillStyle = fg; g.fillRect(-20, -20, W + 40, H + 40);
        g.restore();
      }
      // koude rand
      const vg = g.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.45, W / 2, H * 0.5, Math.max(W, H) * 0.75);
      vg.addColorStop(0, "rgba(6,8,14,0)"); vg.addColorStop(1, "rgba(6,8,14,.65)");
      g.fillStyle = vg; g.fillRect(-20, -20, W + 40, H + 40);
    }
    function puffAt(x, y) {
      for (let i = 0; i < 4 && parts.length < 360; i++) parts.push({ k: "snow", x: x + (Math.random() - 0.5) * 10, y, vx: (Math.random() - 0.5) * 60, vy: -40 * Math.random(), life: 0, max: 0.5, s: 1.5 + Math.random() * 2 });
    }

    function result() { return { logs, perfect, misses, combo: best }; }

    function finish() {
      if (phase !== "play") return;
      phase = "result";
      const r = result();
      const v = valid(r), ratio = points(v) / c.par;
      hint.style.opacity = "0"; hud.style.opacity = "0";
      if (ratio >= 0.72) { try { sfx.fanfare && sfx.fanfare(); } catch (e) { /* stil */ } }
      const res = h("div", "bj-scr bj-res");
      res.appendChild(h("div", "bj-kicker", "Tijd! Bijl neer."));
      res.appendChild(h("div", "bj-big bj-disp", String(logs)));
      res.appendChild(h("div", "bj-unit", logs === 1 ? "blok gekloofd" : "blokken gekloofd"));
      res.appendChild(h("div", "bj-rank", RANKS.find((x) => ratio >= x[0])[1]));
      const st = h("div", "bj-stats");
      [[perfect, "Perfect"], [best, "Beste reeks"], [misses, "Mis"]].forEach(([n, lbl]) => {
        const s = h("div", "bj-stat"); s.appendChild(h("b", null, String(n))); s.appendChild(h("span", null, lbl)); st.appendChild(s);
      });
      res.appendChild(st);
      res.appendChild(h("div", "bj-sub", swings + " klappen · " + c.name));
      const w = h("div", "bj-wait"); w.appendChild(h("i")); w.appendChild(document.createTextNode("Klaar! Wachten op de rest…"));
      res.appendChild(w);
      root.appendChild(res);
      if (typeof ctx.done === "function") ctx.done(r);
    }

    startBtn.addEventListener("click", () => {
      if (phase !== "howto") return;
      phase = "count";
      beep(1, 0.001, "sine", 0.0001); // audio ontgrendelen binnen het gebaar
      how.remove();
      hud.style.opacity = "1"; hint.style.opacity = "1";
      ctx.countdown(root).then(() => {
        if (dead) return;
        t0 = performance.now();
        phase = "play";
      });
    });

    layout();
    now0 = performance.now();
    raf = requestAnimationFrame(frame);

    // Testhaakje (alleen voor Playwright): leesbare speltoestand, geen globale variabele.
    Object.defineProperty(root, "_bijl", { value: {
      get phase() { return phase; }, get t() { return playT(); }, get needle() { return needleNow(playT()); },
      get zone() { return { c: zoneC, w: zoneW }; }, get busy() { return playT() < busyUntil; }, cfg: c, result,
    }, enumerable: false });

    return {
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        timers.forEach(clearTimeout); timers.clear();
        if (ro) ro.disconnect();
        root.removeEventListener("pointerdown", onDown);
        document.removeEventListener("keydown", onKey);
        root.remove();
      },
    };
  }

  const def = {
    id: "bijl", title: "Bijl", icon: "🪓", kind: "local", duration: 20,
    howto: "Tik als de zwaaiende naald in het gloeiende vak staat: elke treffer klooft een blok voor de kachel.",
    mount, score, bot, plan, needle, halfWidth, judge, points, CFG, DURATION,
  };
  M.register(def);
  if (typeof module === "object" && module.exports) module.exports = def;
})();
