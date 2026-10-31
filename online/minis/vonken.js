// Minigame "vonken" — lokaal reflexspel: vonken vangen voor ze op het oude kleed landen (SPEC-3 §5, hoofdstuk "Vonkenregen").
// Een windvlaag uit de schoorsteen: de kachel spuugt gloeiende vonken in een boog over het kleed. Tik ze uit de lucht;
// wat landt, laat een schroeiplek achter. Af en toe een dikke sintel: twee tikken (eerst wegmeppen, dan vangen), telt dubbel.
(function () {
  "use strict";
  const M = typeof DVMini !== "undefined" ? DVMini : require("./core.js");

  const DURATION = 25000; // ms speeltijd
  // Per moeilijkheid: aantal vonken, vliegtijd (ms), kans op een salvo (meerdere tegelijk) en hoe groot, kans op een dikke
  // sintel, zijwind (boog buigt weg), tikstraal (px) en "par" (vangpercentage van een goede vanger).
  const CFG = {
    1: { name: "Knisperen", n: 26, fly: [2300, 3000], salvo: 0.12, salvoMax: 2, big: 0.1, sway: 0, radius: 46, par: 0.86 },
    2: { name: "Spetteren", n: 40, fly: [1750, 2350], salvo: 0.22, salvoMax: 3, big: 0.14, sway: 0.08, radius: 42, par: 0.76 },
    3: { name: "Vuurstorm", n: 56, fly: [1250, 1800], salvo: 0.3, salvoMax: 4, big: 0.18, sway: 0.16, radius: 40, par: 0.66 },
  };
  const FIRST = 700, END_PAD = 400; // eerste vonk na 0,7 s; alles is geland vóór DURATION - END_PAD
  const KNOCK = 950; // ms: zo lang zweeft een weggemepte sintel nog

  const dl = (d) => Math.max(1, Math.min(3, Math.round(d) || 1));
  const cfg = (d) => CFG[dl(d)];

  // Geseed vonkenpatroon (zelfde voor iedereen in de kamer): t = afvuurmoment, dur = vliegtijd, du = waar in de kachelmond,
  // lu/lv = landingsplek op het kleed (0..1), ah = boogtop, sway = zijwind, big = dikke sintel (2 tikken, telt 2).
  function plan(seed, d) {
    const c = cfg(d), r = M.rng((seed >>> 0) ^ 0x5a1c);
    // Eerst de salvo's (groepjes die tegelijk komen), dan over de speeltijd verdelen.
    const groups = [];
    for (let left = c.n; left > 0;) {
      const k = Math.min(left, r() < c.salvo && groups.length > 2 ? 2 + Math.floor(r() * (c.salvoMax - 1)) : 1);
      groups.push(k); left -= k;
    }
    const out = [];
    groups.forEach((k, i) => {
      const dur = Math.round(c.fly[0] + r() * (c.fly[1] - c.fly[0]));
      // De regen zwelt aan: later in het spel komen ze dichter op elkaar.
      const span = DURATION - END_PAD - FIRST - dur * 1.15 - 70 * k;
      const t = Math.round(FIRST + Math.pow((i + 0.15 + r() * 0.7) / groups.length, 0.8) * span);
      for (let j = 0; j < k; j++) {
        const big = out.length > 2 && r() < c.big;
        out.push({
          t: t + j * 70, dur: big ? Math.round(dur * 1.15) : dur, du: r() - 0.5, lu: 0.1 + r() * 0.8, lv: 0.1 + r() * 0.82,
          ah: 0.16 + r() * 0.18, sway: (r() - 0.5) * 2 * c.sway, big, ph: r() * 6.283,
        });
      }
    });
    out.forEach((s) => { s.dur = Math.min(s.dur, DURATION - END_PAD - s.t); });
    return out.sort((a, b) => a.t - b.t).map((s, id) => Object.assign(s, { id }));
  }
  const value = (s) => (s.big ? 2 : 1);
  const total = (p) => p.reduce((n, s) => n + value(s), 0);

  // Punt op een kwadratische bezier: met uniforme tijd is dat precies een worp (constante x-snelheid, vaste valversnelling).
  function bez(p0, c, p1, u) {
    const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), e = u * u;
    return { x: a * p0.x + b * c.x + e * p1.x, y: a * p0.y + b * c.y + e * p1.y };
  }

  // ---------- Scoren ----------
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(999, Math.floor(v)) : null);
  function valid(r) {
    if (!r || typeof r !== "object") return null;
    const caught = num(r.caught), missed = num(r.missed);
    if (caught === null || missed === null || caught + missed === 0) return null;
    return { caught, missed, big: Math.min(num(r.big) || 0, caught), combo: Math.min(num(r.combo) || 0, caught) };
  }
  const ratio = (v) => v.caught / (v.caught + v.missed);
  // Vangpercentage → blokken. Op een hogere moeilijkheid telt hetzelfde percentage zwaarder.
  function logsFor(q, d) {
    const x = q + (dl(d) - 2) * 0.05;
    return x >= 0.9 ? 3 : x >= 0.74 ? 2 : x >= 0.55 ? 1 : x >= 0.36 ? 0 : x >= 0.2 ? -1 : -2;
  }

  function score(results, info) {
    results = results && typeof results === "object" ? results : {};
    info = info || {};
    const d = dl(info.difficulty);
    const players = Array.isArray(info.players) && info.players.length ? info.players : Object.keys(results).map((pid) => ({ pid, name: pid }));
    const nameOf = (p) => (p && p.name) || "Iemand";
    const rows = players.map((p) => { const v = valid(results[p.pid]); return { p, v, q: v ? ratio(v) : null }; });
    const played = rows.filter((x) => x.v);
    // Wie niet meedeed, keek de andere kant op: telt als een matig vangpercentage.
    const avg = rows.length ? rows.reduce((s, x) => s + (x.v ? x.q : 0.25), 0) / rows.length : 0;
    const logs = Math.max(-2, Math.min(3, M.clampLogs(logsFor(avg, d))));
    const head = {
      3: "Geen vonk op het kleed! Gloei: \"Zie je wel, niks aan de hand.\"",
      2: "Bijna alles gevangen. Het kleed overleeft de nacht.",
      1: "Een paar schroeiplekjes. Noem het maar karakter.",
      0: "Het kleed ziet eruit als een gatenkaas. Gloei fluit onschuldig.",
      "-1": "Vonkenregen wint. Het ruikt naar verbrande wol.",
      "-2": "Het kleed is meer gat dan kleed. Gloei: \"Dat was écht niet expres.\"",
    }[logs];
    const lines = [head];
    let mvp = null;
    if (played.length >= 2) {
      const best = played.slice().sort((a, b) => b.q - a.q || b.v.caught - a.v.caught)[0];
      if (best.v.caught > 0) {
        mvp = best.p.pid;
        lines.push(nameOf(best.p) + " ving er " + best.v.caught + " (" + Math.round(best.q * 100) + "%). Vangt vonken als een kat.");
      }
      const worst = played.slice().sort((a, b) => b.v.missed - a.v.missed)[0];
      if (worst.p.pid !== mvp && worst.v.missed >= 4) lines.push(nameOf(worst.p) + " liet er " + worst.v.missed + " op het kleed vallen. Het kleed draagt het met waardigheid.");
    } else if (played.length === 1) {
      const v = played[0].v;
      lines.push(nameOf(played[0].p) + " ving " + v.caught + " " + (v.caught === 1 ? "vonk" : "vonken") + ", " + v.missed + " op het kleed.");
    }
    const bigs = played.slice().sort((a, b) => b.v.big - a.v.big)[0];
    if (bigs && bigs.v.big >= 3) lines.push(nameOf(bigs.p) + " doofde " + (bigs.v.big / 2 | 0) + " dikke sintels met de blote hand. Stoer.");
    const streak = played.slice().sort((a, b) => b.v.combo - a.v.combo)[0];
    if (streak && streak.v.combo >= 12) lines.push(nameOf(streak.p) + " had een reeks van " + streak.v.combo + " op rij. Het kleed hield de adem in.");
    rows.filter((x) => !x.v).forEach((x) => lines.push(nameOf(x.p) + " keek de andere kant op. Gloei: \"Niemand zag het, toch?\""));
    if (played.length >= 2) {
      const c = played.reduce((s, x) => s + x.v.caught, 0), m = played.reduce((s, x) => s + x.v.missed, 0);
      lines.push("Samen " + c + " vonken gevangen, " + m + " op het kleed.");
    }
    const perPlayer = {};
    rows.forEach((x) => { perPlayer[x.p.pid] = x.v ? x.v.caught + " gevangen · " + x.v.missed + " op het kleed" : "—"; });
    return { logs, lines, mvp, perPlayer };
  }

  // Geloofwaardige bot: per vonk een vangkans die zakt als er veel tegelijk in de lucht hangen; sintels vragen twee treffers.
  function bot(rng, difficulty) {
    const d = dl(difficulty);
    const p = plan(Math.floor(rng() * 4294967296), d);
    const skill = Math.max(0.45, Math.min(0.98, 0.8 + rng() * 0.2 - (d - 1) * 0.05));
    let caught = 0, missed = 0, big = 0, streak = 0, combo = 0;
    p.forEach((s) => {
      const busy = p.filter((o) => o !== s && o.t < s.t + s.dur && o.t + o.dur > s.t).length;
      const pc = Math.max(0.1, skill - Math.min(0.22, busy * 0.025) - (d - 1) * 0.03);
      const ok = rng() < pc && (!s.big || rng() < Math.min(0.98, pc + 0.08));
      if (ok) { caught += value(s); if (s.big) big += 2; streak += value(s); combo = Math.max(combo, streak); }
      else { missed += value(s); streak = 0; }
    });
    return { caught, missed, big, combo };
  }

  // ---------- UI ----------
  const CSS = `
.vk{position:relative;width:100%;height:100%;min-height:500px;overflow:hidden;color:var(--glow,#ffe7b8);background:var(--soot,#0b0705);
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.vk *{box-sizing:border-box}
.vk-cv{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.vk-disp{font-family:"Unbounded",system-ui,sans-serif;font-weight:900;letter-spacing:-.02em}
.vk-scr{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:4;
  padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom));text-align:center}
.vk-howto{gap:14px;justify-content:flex-end;padding-bottom:max(34px,env(safe-area-inset-bottom));
  background:linear-gradient(180deg,rgba(11,7,5,0) 30%,rgba(11,7,5,.84) 58%,rgba(11,7,5,.97))}
.vk-kicker{font:800 12px/1 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:var(--ember,#ff6a1a)}
.vk-title{font-size:clamp(40px,13vw,58px);line-height:1;margin:0;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 45%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 18px rgba(255,106,26,.45))}
.vk-text{font-size:17px;line-height:1.4;max-width:330px;margin:0;color:var(--glow,#ffe7b8)}
.vk-hint{font-size:14px;line-height:1.35;max-width:320px;margin:-6px 0 0;color:var(--ash,#b8a99a)}
.vk-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-width:340px}
.vk-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:99px;font-size:13px;color:var(--ash,#b8a99a);
  background:rgba(255,231,184,.06);border:1px solid rgba(255,194,71,.18)}
.vk-chip i{width:9px;height:9px;border-radius:50%;flex:none;background:#fff3d0;box-shadow:0 0 6px 2px var(--flame,#ffc247),0 0 14px 4px rgba(255,106,26,.6)}
.vk-chip i.b{width:13px;height:13px;background:radial-gradient(circle at 40% 40%,#ffe7b8 0 18%,#ff6a1a 30%,#5a1a08 62%,#1a0804);box-shadow:0 0 10px 2px rgba(255,106,26,.55)}
.vk-chip i.s{width:14px;height:8px;border-radius:50%;background:radial-gradient(circle,#0b0402 35%,#3a1608 65%,rgba(90,40,16,0));box-shadow:none}
.vk-chip b{color:var(--glow,#ffe7b8)}
.vk-btn{appearance:none;border:0;cursor:pointer;margin-top:6px;min-width:200px;min-height:58px;padding:0 34px;border-radius:99px;
  font:900 19px/1 "Unbounded",system-ui,sans-serif;color:#2a0d02;letter-spacing:.02em;
  background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a) 70%,var(--blaze,#e8401c));
  box-shadow:0 0 0 1px rgba(255,231,184,.35) inset,0 10px 30px rgba(232,64,28,.45),0 0 60px rgba(255,106,26,.25)}
.vk-btn:active{transform:scale(.97)}
.vk-hud{position:absolute;left:0;right:0;top:0;z-index:3;pointer-events:none;padding:max(12px,env(safe-area-inset-top)) 16px 0;
  display:grid;grid-template-columns:1fr auto 1fr;align-items:start;gap:10px;transition:opacity .4s}
.vk-cnt{justify-self:start;display:flex;align-items:center;gap:9px;font:900 24px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);
  text-shadow:0 0 14px rgba(255,106,26,.55)}
.vk-cnt i{width:12px;height:12px;border-radius:50%;flex:none;background:#fff3d0;transition:transform .12s;
  box-shadow:0 0 6px 2px var(--flame,#ffc247),0 0 16px 5px rgba(255,106,26,.55)}
.vk-cnt i.bump{transform:scale(1.7)}
.vk-combo{position:absolute;left:16px;top:calc(max(12px,env(safe-area-inset-top)) + 32px);z-index:3;pointer-events:none;
  font:900 13px/1 "Unbounded",system-ui,sans-serif;letter-spacing:.04em;color:#2a0d02;padding:5px 9px;border-radius:99px;
  background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a));box-shadow:0 0 16px rgba(255,106,26,.6);
  opacity:0;transform:scale(.6);transition:opacity .2s,transform .2s}
.vk-combo.on{opacity:1;transform:scale(1)}
.vk-combo.bump{animation:vk-tick .3s ease-out}
.vk-combo.lost{opacity:0;transform:translateY(8px) scale(.8);transition:opacity .45s,transform .45s}
.vk-mid{display:flex;flex-direction:column;align-items:center;gap:7px;padding-top:9px}
.vk-bar{width:min(32vw,130px);height:6px;border-radius:9px;background:rgba(255,231,184,.1);overflow:hidden}
.vk-bar i{display:block;height:100%;width:100%;border-radius:9px;transform-origin:left;
  background:linear-gradient(90deg,var(--blaze,#e8401c),var(--flame,#ffc247));box-shadow:0 0 10px var(--ember,#ff6a1a)}
.vk-scorch{font:700 11px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--ash,#b8a99a);transition:color .3s}
.vk-scorch.hit{color:var(--blaze,#e8401c)}
.vk-time{justify-self:end;font:900 22px/1 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8);min-width:2ch;text-align:right}
.vk-time.hot{color:var(--blaze,#e8401c);animation:vk-tick .5s ease-out}
@keyframes vk-tick{0%{transform:scale(1.35)}100%{transform:scale(1)}}
.vk-pop{position:absolute;transform:translate(-50%,0);pointer-events:none;z-index:3;max-width:min(340px,90%);width:max-content;
  color:var(--glow,#ffe7b8);font-size:14px;font-weight:700;line-height:1.3;text-align:center;
  background:rgba(23,16,11,.8);border:1px solid rgba(255,194,71,.35);padding:8px 13px;border-radius:14px;
  box-shadow:0 8px 24px rgba(0,0,0,.4);animation:vk-pop 2.2s cubic-bezier(.2,.9,.3,1.2) forwards}
@keyframes vk-pop{0%{transform:translate(-50%,20%) scale(.6);opacity:0}10%{transform:translate(-50%,0) scale(1.04);opacity:1}
  80%{opacity:1;transform:translate(-50%,0) scale(1)}100%{transform:translate(-50%,-40%);opacity:0}}
.vk .mini-countdown{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font:900 96px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);text-shadow:0 0 30px rgba(255,106,26,.9),0 4px 0 #6a1c04;
  background:radial-gradient(circle at 50% 55%,rgba(11,7,5,.1),rgba(11,7,5,.55))}
.vk .mini-countdown.pop{animation:vk-cd .7s ease-out}
@keyframes vk-cd{0%{transform:scale(1.6);opacity:0}25%{transform:scale(1);opacity:1}100%{transform:scale(.92);opacity:.85}}
.vk-res{gap:10px;justify-content:flex-start;padding-top:max(64px,calc(env(safe-area-inset-top) + 44px));
  background:linear-gradient(180deg,rgba(11,7,5,.92),rgba(11,7,5,.82) 55%,rgba(11,7,5,.35));animation:vk-fade .5s ease-out both}
@keyframes vk-fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.vk-big{font-size:clamp(72px,24vw,108px);line-height:.9;margin:4px 0 0;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 50%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 22px rgba(255,106,26,.5))}
.vk-unit{font:800 13px/1 system-ui,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:var(--ash,#b8a99a);margin-top:-2px}
.vk-rank{font:900 18px/1.2 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8);margin-top:6px}
.vk-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;max-width:330px;margin-top:8px}
.vk-stat{padding:12px 6px;border-radius:16px;background:linear-gradient(180deg,rgba(255,231,184,.08),rgba(255,231,184,.03));
  border:1px solid rgba(255,194,71,.18);box-shadow:inset 0 1px 0 rgba(255,231,184,.08);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
.vk-stat b{display:block;font:900 24px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247)}
.vk-stat:nth-child(2) b{color:var(--blaze,#e8401c)}
.vk-stat:nth-child(3) b{color:var(--ember,#ff6a1a)}
.vk-stat span{display:block;margin-top:6px;font-size:12px;color:var(--ash,#b8a99a);letter-spacing:.06em;text-transform:uppercase}
.vk-sub{font-size:14px;color:var(--ash,#b8a99a)}
.vk-wait{margin-top:14px;display:inline-flex;align-items:center;gap:10px;font-size:15px;color:var(--glow,#ffe7b8);
  padding:10px 16px;border-radius:99px;background:rgba(23,16,11,.75);border:1px solid rgba(255,231,184,.12)}
.vk-wait i{width:10px;height:10px;border-radius:50%;background:var(--ember,#ff6a1a);box-shadow:0 0 12px var(--ember,#ff6a1a);animation:vk-breathe 1s ease-in-out infinite}
@keyframes vk-breathe{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.7);opacity:.6}}
@media (prefers-reduced-motion:reduce){.vk-wait i,.vk-time.hot,.vk-pop,.vk-combo.bump,.vk-res{animation:none}}
`;

  function injectCss() {
    if (document.getElementById("mini-vonken-css")) return;
    const s = document.createElement("style");
    s.id = "mini-vonken-css";
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
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const TAU = Math.PI * 2;

  const QUIPS = {
    6: "Gloei: \"Dat was niet expres, hè.\"",
    12: "Gloei: \"Oké. Die waren een béétje expres.\"",
    20: "Gloei: \"Jullie zijn sneller dan de rookmelder.\"",
    30: "Gloei: \"Ik ga gewoon door. Ik vind dit leuk.\"",
  };
  const RANKS = [[0.92, "Brandweer van het huisje"], [0.78, "Vonkenvanger"], [0.6, "Snelle vingers"], [0.4, "Kleedbewaker in opleiding"], [0, "Gloei's beste vriend"]];

  function mount(el, ctx) {
    injectCss();
    const d = dl(ctx.difficulty), c = CFG[d];
    const sparks = plan(ctx.seed >>> 0, d);
    const sumAll = total(sparks);
    const quips = Object.assign({}, QUIPS);
    const sfx = ctx.sfx || {};
    const beep = (...a) => { try { sfx.beep && sfx.beep(...a); } catch (e) { /* geen geluid */ } };
    const buzz = (ms) => { try { sfx.buzz && sfx.buzz(ms); } catch (e) { /* geen tril */ } };
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    const root = h("div", "vk");
    el.appendChild(root);
    const cv = h("canvas", "vk-cv");
    root.appendChild(cv);
    const g = cv.getContext("2d");
    let dead = false, raf = 0, ro = null, phase = "howto";
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms); timers.add(id); };

    // --- HUD ---
    const hud = h("div", "vk-hud");
    const cnt = h("div", "vk-cnt");
    const cntIco = h("i"), cntNum = h("span", null, "0");
    cnt.append(cntIco, cntNum);
    const mid = h("div", "vk-mid");
    const bar = h("div", "vk-bar"), barFill = h("i");
    bar.appendChild(barFill);
    const scorchEl = h("div", "vk-scorch", "Kleed nog heel");
    mid.append(bar, scorchEl);
    const timeEl = h("div", "vk-time", String(DURATION / 1000));
    hud.append(cnt, mid, timeEl);
    hud.style.opacity = "0";
    root.appendChild(hud);
    const comboEl = h("div", "vk-combo");
    hud.appendChild(comboEl);

    // --- Howto ---
    const how = h("div", "vk-scr vk-howto");
    how.appendChild(h("div", "vk-kicker", "Vonkenregen · " + c.name + " · 25 s"));
    how.appendChild(h("h2", "vk-title vk-disp", "Vonken"));
    how.appendChild(h("p", "vk-text", "Tik de vonken uit de lucht voor ze op het kleed landen."));
    how.appendChild(h("p", "vk-hint", "Hun schaduw op het kleed verraadt waar ze neerkomen."));
    const leg = h("div", "vk-legend");
    const chip = (cls, txt, bold) => { const x = h("span", "vk-chip"); x.appendChild(h("i", cls)); x.appendChild(document.createTextNode(txt + " ")); if (bold) x.appendChild(h("b", null, bold)); leg.appendChild(x); };
    chip("", "vonk =", "1 tik");
    chip("b", "dikke sintel =", "2 tikken");
    chip("s", "geland = schroeiplek", null);
    how.appendChild(leg);
    const startBtn = h("button", "vk-btn", "Start");
    startBtn.type = "button";
    how.appendChild(startBtn);
    root.appendChild(how);

    // --- Decor (geseed) ---
    const drng = M.rng((ctx.seed >>> 0) ^ 0x7e1);
    const coals = Array.from({ length: 26 }, () => ({ x: drng(), y: drng(), r: 0.05 + drng() * 0.07, ph: drng() * TAU, sp: 1 + drng() * 2.5 }));
    const tongues = Array.from({ length: 9 }, (_, i) => ({ x: (i + 0.5) / 9 + (drng() - 0.5) * 0.08, h: 0.45 + drng() * 0.5, w: 0.1 + drng() * 0.08, ph: drng() * TAU, sp: 5 + drng() * 5, blue: drng() < 0.4 }));
    const motes = Array.from({ length: reduced ? 6 : 22 }, () => ({ x: drng(), y: drng(), sp: 0.01 + drng() * 0.025, ph: drng() * TAU, r: 0.6 + drng() * 1.2 }));

    // --- Layout ---
    let W = 0, H = 0, dpr = 1, L = null, bg = null, stoveImg = null, glowImg = null, hotImg = null;
    function layout() {
      const r = root.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(2, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const cx = W / 2;
      const sw = Math.min(W * 0.46, 190, H * 0.27); // kachelbreedte
      const sTop = Math.max(64, H * 0.085), sBody = sw * 1.02, sBot = sTop + sBody;
      const win = { x: cx - sw * 0.33, y: sTop + sw * 0.2, w: sw * 0.66, h: sw * 0.52, k: sw * 0.06 };
      const rugTop = sBot + Math.max(18, H * 0.04), rugBot = H + 6;
      L = { cx, sw, sTop, sBot, win, rugTop, rugBot, wTop: Math.min(W * 0.84, 520), wBot: Math.min(W * 1.12, 640), floorY: sBot - sw * 0.24,
        door: { x: cx, y: win.y + win.h * 0.55 } };
      bg = renderBg();
      stoveImg = renderStove();
      glowImg = sprite("255,170,60", [[0, 1], [0.18, 0.75], [0.45, 0.22], [1, 0]]);
      hotImg = sprite("255,80,30", [[0, 1], [0.25, 0.5], [1, 0]]);
    }
    const onResize = () => { if (!dead) layout(); };
    if (typeof ResizeObserver === "function") { ro = new ResizeObserver(onResize); ro.observe(root); }
    else addEventListener("resize", onResize);

    const off = (w, hh) => { const o = document.createElement("canvas"); o.width = Math.max(1, Math.round(w * dpr)); o.height = Math.max(1, Math.round(hh * dpr)); const x = o.getContext("2d"); x.scale(dpr, dpr); return [o, x]; };
    function sprite(rgb, st) {
      const o = document.createElement("canvas"); o.width = o.height = 64;
      const x = o.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      st.forEach(([p, a]) => gr.addColorStop(p, "rgba(" + rgb + "," + a + ")"));
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      return o;
    }

    // Kleed in perspectief: (u, v) in 0..1 → schermpunt (smaller achteraan).
    function rugPt(u, v) {
      const y = lerp(L.rugTop, L.rugBot, v), w = lerp(L.wTop, L.wBot, v);
      return { x: L.cx + (u - 0.5) * w, y };
    }
    const depth = (y) => lerp(0.82, 1.22, clamp01((y - L.sTop) / (H - L.sTop)));

    function quad(x, pts) { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y))); x.closePath(); }
    const rq = (u0, v0, u1, v1) => [rugPt(u0, v0), rugPt(u1, v0), rugPt(u1, v1), rugPt(u0, v1)];

    // Statisch: houten wand, vloerplanken, de gietijzeren kachel (zonder vuur), de vloerplaat en het oude Perzische kleed.
    function renderBg() {
      const [o, x] = off(W, H);
      const { cx, sw, floorY } = L;
      // wand
      const wall = x.createLinearGradient(0, 0, 0, floorY);
      wall.addColorStop(0, "#080504"); wall.addColorStop(1, "#140c08");
      x.fillStyle = wall; x.fillRect(0, 0, W, floorY + 1);
      const pr = M.rng(91);
      for (let px = -10; px < W; px += 22 + pr() * 18) {
        x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(px, 0, 1.5, floorY);
        x.fillStyle = "rgba(255,200,150," + (0.012 + pr() * 0.02) + ")"; x.fillRect(px + 2, 0, 6 + pr() * 10, floorY);
      }
      // vloer
      const fl = x.createLinearGradient(0, floorY, 0, H);
      fl.addColorStop(0, "#1a100a"); fl.addColorStop(1, "#24150c");
      x.fillStyle = fl; x.fillRect(0, floorY, W, H - floorY);
      x.strokeStyle = "rgba(0,0,0,.45)"; x.lineWidth = 1.2;
      const vy = floorY - H * 0.5;
      for (let i = -8; i <= 8; i++) { const bx = cx + i * W * 0.14; x.beginPath(); x.moveTo(lerp(cx, bx, (floorY - vy) / (H - vy)), floorY); x.lineTo(bx, H); x.stroke(); }
      // vloerplaat onder de kachel
      x.fillStyle = "#16120f";
      quad(x, [{ x: cx - sw * 0.78, y: floorY + 2 }, { x: cx + sw * 0.78, y: floorY + 2 }, { x: cx + sw * 0.95, y: L.rugTop + 8 }, { x: cx - sw * 0.95, y: L.rugTop + 8 }]); x.fill();
      x.strokeStyle = "rgba(255,190,120,.12)"; x.lineWidth = 1; x.stroke();
      // kleed
      renderRug(x);
      return o;
    }

    // De gietijzeren kachel (zonder vuur) op een eigen laag, zodat het licht ervan eronder kan vallen.
    function renderStove() {
      const [o, x] = off(W, H);
      const { cx, sw, sTop, sBot } = L;
      // kachelpijp
      const pw = sw * 0.24;
      const pg = x.createLinearGradient(cx - pw / 2, 0, cx + pw / 2, 0);
      pg.addColorStop(0, "#050404"); pg.addColorStop(0.55, "#1f1a17"); pg.addColorStop(1, "#060505");
      x.fillStyle = pg; x.fillRect(cx - pw / 2, -2, pw, sTop + 4);
      x.fillStyle = "rgba(0,0,0,.5)"; x.fillRect(cx - pw / 2 - 2, sTop * 0.45, pw + 4, 4);
      // ketel: gietijzeren cilinder met deksel en voet
      const bx = cx - sw / 2;
      const body = x.createLinearGradient(bx, 0, bx + sw, 0);
      body.addColorStop(0, "#050404"); body.addColorStop(0.3, "#141110"); body.addColorStop(0.62, "#2a2421"); body.addColorStop(0.8, "#151210"); body.addColorStop(1, "#040303");
      x.fillStyle = body;
      x.beginPath(); x.moveTo(bx, sTop); x.lineTo(bx, sBot - sw * 0.12); x.ellipse(cx, sBot - sw * 0.12, sw / 2, sw * 0.1, 0, Math.PI, 0, true); x.lineTo(bx + sw, sTop); x.closePath(); x.fill();
      x.fillStyle = "#0c0a09"; x.beginPath(); x.ellipse(cx, sTop, sw / 2 + 3, sw * 0.09, 0, 0, TAU); x.fill();
      x.strokeStyle = "rgba(255,210,170,.14)"; x.lineWidth = 1.5; x.beginPath(); x.ellipse(cx, sTop, sw / 2 + 3, sw * 0.09, 0, Math.PI * 0.05, Math.PI * 0.95, true); x.stroke();
      // sierrand onder het raam
      x.strokeStyle = "rgba(0,0,0,.6)"; x.lineWidth = 3;
      x.beginPath(); x.ellipse(cx, sTop + sw * 0.82, sw / 2, sw * 0.08, 0, 0.05, Math.PI - 0.05); x.stroke();
      // contactschaduw
      const cs = x.createRadialGradient(cx, sBot, 2, cx, sBot, sw * 0.7);
      cs.addColorStop(0, "rgba(0,0,0,.7)"); cs.addColorStop(1, "rgba(0,0,0,0)");
      x.save(); x.translate(0, sBot); x.scale(1, 0.22); x.fillStyle = cs; x.beginPath(); x.arc(cx, 0, sw * 0.7, 0, TAU); x.fill(); x.restore();
      // voetjes
      x.fillStyle = "#070505";
      [-0.36, 0.36].forEach((k) => { x.beginPath(); x.ellipse(cx + k * sw, sBot - sw * 0.02, sw * 0.07, sw * 0.04, 0, 0, TAU); x.fill(); });
      // raamsponning (donkere rand, het vuur wordt live erin getekend)
      x.save(); winPath(x, 4); x.fillStyle = "#020101"; x.fill(); x.restore();
      return o;
    }

    function winPath(x, grow) {
      const { win } = L, e = grow || 0;
      const l = win.x - e, r = win.x + win.w + e, t = win.y - e, b = win.y + win.h + e;
      x.beginPath();
      x.moveTo(l, t); x.quadraticCurveTo(L.cx, t + win.k * 2, r, t);
      x.lineTo(r - win.w * 0.04, b); x.quadraticCurveTo(L.cx, b + win.k * 2, l + win.w * 0.04, b);
      x.closePath();
    }

    function renderRug(x) {
      const rr = M.rng(4242);
      // schaduw + rand
      x.fillStyle = "rgba(0,0,0,.5)"; quad(x, rq(-0.02, -0.02, 1.02, 1.02)); x.fill();
      x.fillStyle = "#2a0d08"; quad(x, rq(0, 0, 1, 1)); x.fill();
      // banden: buitenrand indigo met okerpatroon, dan rood veld
      x.fillStyle = "#15131f"; quad(x, rq(0.03, 0.035, 0.97, 0.965)); x.fill();
      x.fillStyle = "#6a4620";
      for (let i = 0; i < 24; i++) { // ruitjes in de rand (boven en onder)
        const u = 0.05 + (i + 0.5) * 0.9 / 24;
        [0.06, 0.94].forEach((v) => { quad(x, [rugPt(u, v - 0.018), rugPt(u + 0.014, v), rugPt(u, v + 0.018), rugPt(u - 0.014, v)]); x.fill(); });
      }
      for (let i = 0; i < 18; i++) { // zijranden
        const v = 0.08 + (i + 0.5) * 0.84 / 18;
        [0.065, 0.935].forEach((u) => { quad(x, [rugPt(u, v - 0.02), rugPt(u + 0.014, v), rugPt(u, v + 0.02), rugPt(u - 0.014, v)]); x.fill(); });
      }
      x.fillStyle = "#4a140d"; quad(x, rq(0.1, 0.11, 0.9, 0.89)); x.fill();
      x.strokeStyle = "#8a5e2c"; x.lineWidth = 1.2; quad(x, rq(0.1, 0.11, 0.9, 0.89)); x.stroke();
      x.strokeStyle = "rgba(176,122,58,.45)"; quad(x, rq(0.12, 0.13, 0.88, 0.87)); x.stroke();
      // veld: kleine motiefjes
      x.fillStyle = "rgba(150,62,26,.35)";
      for (let i = 0; i < 70; i++) { const u = 0.15 + rr() * 0.7, v = 0.15 + rr() * 0.7; quad(x, [rugPt(u, v - 0.012), rugPt(u + 0.008, v), rugPt(u, v + 0.012), rugPt(u - 0.008, v)]); x.fill(); }
      // medaillon in het midden: gelaagde ruiten
      [[0.26, 0.3, "#1a1724"], [0.21, 0.24, "#6a4620"], [0.16, 0.18, "#5e1c10"], [0.1, 0.11, "#1a1724"], [0.05, 0.055, "#9a7440"]].forEach(([du, dv, col]) => {
        x.fillStyle = col; quad(x, [rugPt(0.5, 0.5 - dv), rugPt(0.5 + du, 0.5), rugPt(0.5, 0.5 + dv), rugPt(0.5 - du, 0.5)]); x.fill();
      });
      // hoekmotieven
      [[0.18, 0.2], [0.82, 0.2], [0.18, 0.8], [0.82, 0.8]].forEach(([u, v]) => {
        x.fillStyle = "#1a1724"; quad(x, [rugPt(u, v - 0.06), rugPt(u + 0.05, v), rugPt(u, v + 0.06), rugPt(u - 0.05, v)]); x.fill();
        x.fillStyle = "#6a4620"; quad(x, [rugPt(u, v - 0.03), rugPt(u + 0.025, v), rugPt(u, v + 0.03), rugPt(u - 0.025, v)]); x.fill();
      });
      // franjes aan de achterkant
      x.strokeStyle = "rgba(220,200,160,.5)"; x.lineWidth = 1;
      for (let i = 0; i <= 40; i++) { const p = rugPt(i / 40, 0); x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x + (rr() - 0.5) * 2, p.y - 5 - rr() * 3); x.stroke(); }
      // sleet: oude, versleten plekken en stof
      for (let i = 0; i < 900; i++) {
        const p = rugPt(rr(), rr());
        x.fillStyle = rr() < 0.5 ? "rgba(0,0,0,.18)" : "rgba(255,210,160,.05)";
        x.fillRect(p.x, p.y, 1.5, 1.2);
      }
      const wear = x.createRadialGradient(L.cx, lerp(L.rugTop, L.rugBot, 0.55), 10, L.cx, lerp(L.rugTop, L.rugBot, 0.55), W * 0.6);
      wear.addColorStop(0, "rgba(255,200,150,.04)"); wear.addColorStop(1, "rgba(0,0,0,.3)");
      x.fillStyle = wear; quad(x, rq(0, 0, 1, 1)); x.fill();
      // verder van de kachel = donkerder (alleen het vuur verlicht de kamer)
      const dark = x.createLinearGradient(0, L.rugTop, 0, L.rugBot);
      dark.addColorStop(0, "rgba(11,7,5,.12)"); dark.addColorStop(0.45, "rgba(11,7,5,.38)"); dark.addColorStop(1, "rgba(11,7,5,.7)");
      x.fillStyle = dark; quad(x, rq(-0.03, -0.03, 1.03, 1.03)); x.fill();
    }

    // --- Spelstatus ---
    let t0 = 0, lastFrame = 0, now0 = 0, lastSec = 99;
    let next = 0, caught = 0, missed = 0, big = 0, streak = 0, best = 0, taps = 0;
    let flare = 0, sting = 0, shake = 0, firstScorch = true;
    const live = []; // vonken in de lucht
    const scorches = [], parts = [], rings = [], homing = [], texts = [];

    const playT = () => (phase === "play" ? performance.now() - t0 : 0);

    // Positie + pad van een vonk op speltijd t.
    function geo(s) {
      const p0 = s.from ? { x: s.from.x * W, y: s.from.y * H } : { x: L.door.x + s.du * L.win.w * 0.6, y: L.door.y };
      const p1 = rugPt(s.lu, s.lv);
      const cpt = { x: lerp(p0.x, p1.x, 0.45) + s.sway * W, y: Math.min(p0.y, p1.y) - s.ah * H * (s.from ? 0.6 : 1) };
      return { p0, p1, c: cpt };
    }
    function posAt(s, t) {
      const u = clamp01((t - s.t0) / s.dur), G = geo(s);
      const p = bez(G.p0, G.c, G.p1, u);
      p.x += Math.sin(t / 90 + s.ph) * 2.2 * (1 - u); // vonken fladderen een beetje
      p.u = u; p.land = G.p1;
      return p;
    }

    function popup(text) {
      if (phase !== "play") return;
      const p = h("div", "vk-pop", text);
      const top = root.getBoundingClientRect().top; // bovenrand net onder de HUD, ook met notch/safe-area
      const y = Math.max(comboEl.getBoundingClientRect().bottom, scorchEl.getBoundingClientRect().bottom) - top + 8;
      p.style.left = "50%";
      p.style.top = Math.round(y) + "px";
      p.addEventListener("animationend", () => p.remove());
      root.querySelectorAll(".vk-pop").forEach((x) => x.remove());
      root.appendChild(p);
    }
    function showCombo() {
      if (streak >= 3) {
        comboEl.textContent = streak + " op rij";
        comboEl.className = "vk-combo on"; void comboEl.offsetWidth; comboEl.classList.add("bump");
      } else if (comboEl.classList.contains("on")) comboEl.className = "vk-combo lost";
    }
    function bumpCount() {
      cntNum.textContent = String(caught);
      cntIco.classList.remove("bump"); void cntIco.offsetWidth; cntIco.classList.add("bump");
    }

    function burst(x, y, n, power, hot) {
      for (let i = 0; i < n && parts.length < 400; i++) {
        const a = Math.random() * TAU, v = power * (0.3 + Math.random() * 0.9);
        parts.push({ k: "spark", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - power * 0.25, life: 0, max: 0.35 + Math.random() * 0.5, s: 1 + Math.random() * (hot ? 2.2 : 1.5) });
      }
    }
    function smoke(x, y, n) {
      for (let i = 0; i < n && parts.length < 400; i++) parts.push({ k: "smoke", x: x + (Math.random() - 0.5) * 10, y, vx: (Math.random() - 0.5) * 14, vy: -20 - Math.random() * 25, life: 0, max: 1.4 + Math.random(), s: 4 + Math.random() * 5 });
    }

    function spawn(s) {
      live.push(Object.assign({}, s, { t0: s.t, hp: s.big ? 2 : 1 }));
      flare = Math.min(1.4, flare + (s.big ? 0.7 : 0.35));
      if (s.big) beep(150, 0.12, "sawtooth", 0.05);
      else beep(380 + Math.random() * 220, 0.025, "square", 0.015);
      const dp = { x: L.door.x + s.du * L.win.w * 0.6, y: L.door.y };
      burst(dp.x, dp.y - 4, s.big ? 10 : 4, 120, false);
    }

    function tap(px, py) {
      if (phase !== "play") return;
      const t = playT();
      taps++;
      let bestS = null, bestD = Infinity, bestP = null;
      live.forEach((s) => {
        if (s.dead) return;
        const p = posAt(s, t), dd = Math.hypot(p.x - px, p.y - py), rad = c.radius * (s.big ? 1.1 : 1);
        if (dd < rad && dd < bestD) { bestS = s; bestD = dd; bestP = p; }
      });
      if (!bestS) { rings.push({ x: px, y: py, life: 0, max: 0.35, r: 16, col: "255,231,184", a: 0.25 }); return; }
      const s = bestS, p = bestP;
      if (s.hp === 2) { // dikke sintel: eerst wegmeppen, dan zweeft hij nog even
        s.hp = 1;
        s.from = { x: p.x / W, y: p.y / H };
        s.t0 = t; s.dur = Math.max(450, Math.min(KNOCK, DURATION - t));
        s.lu = clamp01(s.lu + (Math.random() - 0.5) * 0.3) * 0.8 + 0.1; s.lv = Math.min(0.92, clamp01(s.lv + 0.06 + Math.random() * 0.12));
        s.ah = 0.07; s.sway = 0;
        burst(p.x, p.y, 16, 200, true);
        rings.push({ x: p.x, y: p.y, life: 0, max: 0.4, r: 34, col: "255,140,50", a: 0.8 });
        texts.push({ x: p.x, y: p.y - 26, s: "KNAK!", life: 0, max: 0.6, col: "#ffc247", size: 20 });
        beep(240, 0.08, "square", 0.06); buzz(20);
        return;
      }
      s.dead = true;
      const v = value(s);
      caught += v; if (s.big) big += v;
      streak += v; best = Math.max(best, streak);
      bumpCount();
      burst(p.x, p.y, s.big ? 26 : 14, s.big ? 260 : 190, true);
      rings.push({ x: p.x, y: p.y, life: 0, max: 0.45, r: s.big ? 54 : 40, col: "255,210,120", a: 0.9 });
      texts.push({ x: p.x, y: p.y - 24, s: "+" + v, life: 0, max: 0.7, col: "#fff3d0", size: s.big ? 26 : 20 });
      homing.push({ x: p.x, y: p.y, sx: p.x, sy: p.y, life: 0, max: 0.5, big: s.big });
      beep(820 + Math.min(streak, 30) * 22, 0.06, "triangle", 0.07);
      if (s.big) beep(1320, 0.12, "sine", 0.05);
      buzz(s.big ? 26 : 12);
      Object.keys(quips).forEach((k) => { // drempel gepasseerd (sintel telt 2, dus niet alleen ===)
        if (+k > streak - v && +k <= streak) { const q = quips[k]; delete quips[k]; later(() => popup(q), 120); }
      });
      showCombo();
    }

    function land(s) {
      s.dead = true;
      const v = value(s);
      missed += v; streak = 0; showCombo();
      const p = rugPt(s.lu, s.lv);
      const sr = M.rng((s.id + 1) * 977);
      scorches.push({ lu: s.lu, lv: s.lv, r0: s.big ? 15 : 9, age: 0, blobs: Array.from({ length: s.big ? 7 : 5 }, () => ({ dx: (sr() - 0.5) * 1.1, dy: (sr() - 0.5) * 0.6, r: 0.45 + sr() * 0.55 })) });
      smoke(p.x, p.y, s.big ? 6 : 3);
      burst(p.x, p.y, 6, 90, false);
      sting = Math.min(1, sting + (s.big ? 0.8 : 0.5));
      shake = reduced ? 0 : Math.max(shake, s.big ? 0.5 : 0.2);
      scorchEl.textContent = scorches.length + (scorches.length === 1 ? " schroeiplek" : " schroeiplekken");
      scorchEl.classList.add("hit"); later(() => scorchEl.classList.remove("hit"), 300);
      beep(120, 0.16, "sawtooth", 0.035); beep(70, 0.2, "sine", 0.05);
      buzz(s.big ? 60 : 30);
      if (firstScorch) { firstScorch = false; later(() => popup("Gloei: \"Oeps. Dat kleed was toch al lelijk.\""), 150); }
    }

    const onDown = (e) => {
      if (e.button > 0 || phase !== "play") return;
      e.preventDefault();
      const r = root.getBoundingClientRect();
      tap(e.clientX - r.left, e.clientY - r.top);
    };
    root.addEventListener("pointerdown", onDown);

    // --- Tekenen ---
    function drawFire(ts) {
      const { win } = L;
      const f = 0.85 + 0.15 * Math.sin(ts * 7.3) * Math.sin(ts * 3.1) + flare * 0.35;
      g.save();
      winPath(g, 0); g.clip();
      const bgG = g.createLinearGradient(0, win.y, 0, win.y + win.h);
      bgG.addColorStop(0, "#2a0903"); bgG.addColorStop(0.55, "#6e1f06"); bgG.addColorStop(1, "#9a3008");
      g.fillStyle = bgG; g.fillRect(win.x - 6, win.y - 6, win.w + 12, win.h + 24);
      // gloeiende kolen achterin
      coals.forEach((k) => {
        const a = 0.45 + 0.4 * Math.sin(ts * k.sp + k.ph);
        g.fillStyle = "rgba(" + Math.round(200 + 55 * a) + "," + Math.round(60 + 70 * a) + ",20," + (0.45 + 0.4 * a) + ")";
        g.beginPath(); g.ellipse(win.x + k.x * win.w, win.y + win.h * (0.62 + k.y * 0.4), k.r * win.w, k.r * win.w * 0.6, 0, 0, TAU); g.fill();
      });
      // houtblok schuin over het vuur (zoals op de foto)
      g.save();
      g.translate(win.x + win.w * 0.46, win.y + win.h * 0.46); g.rotate(0.55);
      const lw = win.w * 0.78, lh = win.h * 0.3;
      const lg = g.createLinearGradient(0, -lh / 2, 0, lh / 2);
      lg.addColorStop(0, "#c89058"); lg.addColorStop(0.3, "#9a6a3a"); lg.addColorStop(0.7, "#3a200c"); lg.addColorStop(1, "#140804");
      g.fillStyle = lg; g.fillRect(-lw / 2, -lh / 2, lw, lh);
      g.strokeStyle = "rgba(50,24,8,.45)"; g.lineWidth = 0.7;
      for (let i = 0; i < 6; i++) { const y = -lh / 2 + lh * (i + 0.4) / 6; g.beginPath(); g.moveTo(-lw / 2, y); g.bezierCurveTo(-lw / 6, y + 1.2, lw / 6, y - 1.2, lw / 2, y + 0.6); g.stroke(); }
      // verkoolde onderkant met gloeiende barstjes
      g.fillStyle = "rgba(20,8,3,.8)"; g.fillRect(-lw / 2, lh * 0.18, lw, lh * 0.32);
      g.strokeStyle = "rgba(255," + Math.round(100 + 50 * f) + ",30," + Math.min(0.9, 0.4 + 0.35 * f) + ")"; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(-lw / 2, lh * 0.2);
      for (let i = 1; i <= 10; i++) g.lineTo(-lw / 2 + lw * i / 10, lh * (0.2 + (i % 2 ? 0.05 : -0.02)));
      g.stroke();
      g.restore();
      // vlammen
      g.globalCompositeOperation = "lighter";
      tongues.forEach((tg) => {
        const bx = win.x + tg.x * win.w, by = win.y + win.h * 0.86;
        const hh = win.h * tg.h * (0.75 + 0.25 * Math.sin(ts * tg.sp + tg.ph) + flare * 0.3);
        const sw = Math.sin(ts * tg.sp * 0.7 + tg.ph) * win.w * 0.06, bw = win.w * tg.w;
        const fg = g.createLinearGradient(0, by, 0, by - hh);
        fg.addColorStop(0, "rgba(255,200,110,.42)"); fg.addColorStop(0.3, "rgba(255,160,40,.55)"); fg.addColorStop(0.75, "rgba(255,90,20,.35)"); fg.addColorStop(1, "rgba(255,60,10,0)");
        g.fillStyle = fg;
        g.beginPath(); g.moveTo(bx - bw, by);
        g.bezierCurveTo(bx - bw, by - hh * 0.5, bx + sw - bw * 0.2, by - hh * 0.7, bx + sw * 1.6, by - hh);
        g.bezierCurveTo(bx + sw + bw * 0.3, by - hh * 0.6, bx + bw, by - hh * 0.4, bx + bw, by);
        g.closePath(); g.fill();
      });
      g.globalCompositeOperation = "source-over";
      // kleine blauwe vlammetjes op de kolen (zoals op de foto)
      tongues.forEach((tg) => {
        if (!tg.blue) return;
        const bx = win.x + tg.x * win.w, by = win.y + win.h * 0.84, hh = win.h * (0.1 + 0.05 * Math.sin(ts * tg.sp * 1.3 + tg.ph)), bw = win.w * tg.w * 0.35;
        const bg2 = g.createLinearGradient(0, by, 0, by - hh);
        bg2.addColorStop(0, "rgba(90,169,255,.75)"); bg2.addColorStop(1, "rgba(90,169,255,0)");
        g.fillStyle = bg2;
        g.beginPath(); g.moveTo(bx - bw, by); g.quadraticCurveTo(bx - bw * 0.6, by - hh * 0.7, bx, by - hh); g.quadraticCurveTo(bx + bw * 0.6, by - hh * 0.7, bx + bw, by); g.closePath(); g.fill();
      });
      // rooster voor de vuurmond
      const gy = win.y + win.h * 0.78;
      g.strokeStyle = "#0a0605"; g.lineWidth = Math.max(2.5, win.w * 0.025);
      g.beginPath(); g.moveTo(win.x, gy); g.quadraticCurveTo(L.cx, gy + win.k * 2, win.x + win.w, gy); g.stroke();
      g.lineWidth = Math.max(2, win.w * 0.02);
      for (let i = 1; i < 12; i++) { const bx = win.x + (i / 12) * win.w, dy = win.k * 2 * (1 - Math.pow((i / 12 - 0.5) * 2, 2)) * 0.5; g.beginPath(); g.moveTo(bx, gy + dy); g.lineTo(bx, win.y + win.h + win.k * 2); g.stroke(); }
      // glas: zachte schittering
      g.fillStyle = "rgba(255,240,220,.06)";
      g.beginPath(); g.moveTo(win.x + win.w * 0.08, win.y); g.lineTo(win.x + win.w * 0.28, win.y); g.lineTo(win.x + win.w * 0.12, win.y + win.h); g.lineTo(win.x - win.w * 0.04, win.y + win.h); g.fill();
      g.restore();
      // gloed rond het raam
      g.save(); g.globalCompositeOperation = "lighter";
      const ga = 0.3 * f;
      g.globalAlpha = Math.min(1, ga);
      const R = win.w * 1.3;
      g.drawImage(glowImg, L.cx - R, win.y + win.h * 0.5 - R, R * 2, R * 2);
      g.restore();
    }

    function drawSpill(ts) {
      // warm licht van de kachel op vloer en kleed
      const f = 0.8 + 0.2 * Math.sin(ts * 6.1) * Math.sin(ts * 2.3 + 1) + flare * 0.25;
      g.save(); g.globalCompositeOperation = "lighter";
      const cy = L.rugTop;
      const lg = g.createRadialGradient(L.cx, cy - L.sw * 0.2, 10, L.cx, cy, Math.max(W, H - cy) * 0.95);
      lg.addColorStop(0, "rgba(255,140,50," + 0.16 * f + ")"); lg.addColorStop(0.45, "rgba(255,106,26," + 0.05 * f + ")"); lg.addColorStop(1, "rgba(255,106,26,0)");
      g.fillStyle = lg; g.fillRect(0, L.floorY, W, H - L.floorY);
      g.restore();
    }

    function drawScorches(dt) {
      scorches.forEach((sc) => {
        sc.age += dt;
        const p = rugPt(sc.lu, sc.lv); // in kleedcoördinaten: blijft goed liggen na draaien/resizen
        sc.x = p.x; sc.y = p.y; sc.r = sc.r0 * depth(p.y);
        g.save(); g.translate(sc.x, sc.y);
        // schroeirand
        g.fillStyle = "rgba(70,28,10,.45)";
        g.beginPath(); g.ellipse(0, 0, sc.r * 1.5, sc.r * 0.75, 0, 0, TAU); g.fill();
        g.fillStyle = "rgba(14,5,2,.88)";
        sc.blobs.forEach((b) => { g.beginPath(); g.ellipse(b.dx * sc.r, b.dy * sc.r * 0.5, sc.r * b.r, sc.r * b.r * 0.5, 0, 0, TAU); g.fill(); });
        // nagloeiend randje
        const glow = Math.max(0, 1 - sc.age / 1.8);
        if (glow > 0) {
          g.globalCompositeOperation = "lighter";
          g.strokeStyle = "rgba(255,110,30," + glow * 0.9 + ")"; g.lineWidth = 1.6;
          g.beginPath(); g.ellipse(0, 0, sc.r * 0.95, sc.r * 0.47, 0, 0, TAU); g.stroke();
          g.globalAlpha = glow;
          g.drawImage(hotImg, -sc.r * 1.4, -sc.r * 0.9, sc.r * 2.8, sc.r * 1.8);
          if (Math.random() < dt * 3) smoke(sc.x, sc.y, 1);
        }
        g.restore();
      });
    }

    function drawShadows(t) {
      // schaduwtje + mikpunt op het kleed waar elke vonk gaat landen
      live.forEach((s) => {
        if (s.dead) return;
        const p = posAt(s, t), k = depth(p.land.y), u = p.u;
        const r = (s.big ? 13 : 8) * k * (1.6 - u * 0.6);
        g.fillStyle = "rgba(0,0,0," + (0.12 + u * 0.3) + ")";
        g.beginPath(); g.ellipse(p.land.x, p.land.y, r, r * 0.45, 0, 0, TAU); g.fill();
        if (u > 0.55) {
          const w = (u - 0.55) / 0.45;
          g.strokeStyle = "rgba(255," + Math.round(160 - 110 * w) + ",40," + (0.15 + 0.45 * w) + ")"; g.lineWidth = 1.3;
          g.beginPath(); g.ellipse(p.land.x, p.land.y, r * 1.6, r * 0.72, 0, 0, TAU); g.stroke();
        }
      });
    }

    function drawSparks(t, ts) {
      live.forEach((s) => {
        if (s.dead) return;
        const p = posAt(s, t), k = depth(p.y);
        // staart: punten op het pad in het verleden (tijd, niet frames: even lang op 60 en 120 Hz)
        const trail = [];
        for (let i = s.big ? 13 : 10; i >= 1; i--) { const tt = t - i * 20; if (tt > s.t0) trail.push(posAt(s, tt)); }
        trail.push(p);
        const hot = p.u > 0.72 ? (p.u - 0.72) / 0.28 : 0; // vlak voor de landing: roodgloeiend
        g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round";
        // staart
        for (let i = 1; i < trail.length; i++) {
          const a = i / trail.length, q = trail[i - 1], r = trail[i];
          g.strokeStyle = "rgba(255," + Math.round(150 + 60 * a) + "," + Math.round(40 + 60 * a) + "," + a * 0.55 + ")";
          g.lineWidth = (s.big ? 7 : 4) * a * k;
          g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(r.x, r.y); g.stroke();
        }
        const fl = 0.85 + 0.15 * Math.sin(ts * 40 + s.ph);
        const R = (s.big ? 34 : 22) * k * fl;
        g.globalAlpha = 0.9;
        g.drawImage(glowImg, p.x - R, p.y - R, R * 2, R * 2);
        if (hot > 0) { g.globalAlpha = hot * 0.8; g.drawImage(hotImg, p.x - R * 1.2, p.y - R * 1.2, R * 2.4, R * 2.4); }
        g.restore();
        if (s.big) { // dikke sintel: korst met gloeiende barstjes
          const br = 8.5 * k * (s.hp === 1 ? 0.8 : 1);
          g.save(); g.translate(p.x, p.y); g.rotate(ts * 2 + s.ph);
          const cg = g.createRadialGradient(-br * 0.3, -br * 0.3, 1, 0, 0, br);
          cg.addColorStop(0, "#fff3d0"); cg.addColorStop(0.4, "#ffa040"); cg.addColorStop(0.8, s.hp === 1 ? "#e04a14" : "#9a3010"); cg.addColorStop(1, "#3a1006");
          g.fillStyle = cg;
          g.beginPath();
          for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU, rr = br * (0.82 + 0.18 * Math.sin(i * 2.7 + s.ph)); i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
          g.closePath(); g.fill();
          g.strokeStyle = s.hp === 1 ? "rgba(255,243,208,.95)" : "rgba(255,180,60,.7)"; g.lineWidth = s.hp === 1 ? 1.6 : 1;
          g.beginPath(); g.moveTo(-br * 0.6, -br * 0.1); g.lineTo(-br * 0.1, br * 0.15); g.lineTo(br * 0.5, -br * 0.3);
          if (s.hp === 1) { g.moveTo(-br * 0.1, br * 0.15); g.lineTo(br * 0.05, br * 0.7); }
          g.stroke();
          g.restore();
        } else { // witheet kerntje
          g.fillStyle = hot > 0.5 ? "#ffd27a" : "#fff7de";
          g.beginPath(); g.arc(p.x, p.y, 3.2 * k, 0, TAU); g.fill();
        }
      });
    }

    function drawFx(dt) {
      g.save(); g.globalCompositeOperation = "lighter";
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.k === "spark") { p.vy += 420 * dt; p.vx *= Math.pow(0.96, dt * 60); }
        else { p.vx *= Math.pow(0.98, dt * 60); p.vy *= Math.pow(0.99, dt * 60); }
        if (p.life >= p.max) { parts.splice(i, 1); continue; }
        const a = 1 - p.life / p.max;
        if (p.k === "spark") {
          g.fillStyle = a > 0.5 ? "rgba(255,236,170," + a + ")" : "rgba(255,140,40," + a * 1.6 + ")";
          g.beginPath(); g.arc(p.x, p.y, p.s, 0, TAU); g.fill();
        }
      }
      g.globalCompositeOperation = "source-over";
      parts.forEach((p) => {
        if (p.k !== "smoke") return;
        const a = 1 - p.life / p.max;
        g.fillStyle = "rgba(150,135,125," + a * 0.16 + ")";
        g.beginPath(); g.arc(p.x, p.y, p.s * (1 + p.life * 1.4), 0, TAU); g.fill();
      });
      g.globalCompositeOperation = "lighter";
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]; r.life += dt;
        if (r.life >= r.max) { rings.splice(i, 1); continue; }
        const q = r.life / r.max;
        g.strokeStyle = "rgba(" + r.col + "," + r.a * (1 - q) + ")"; g.lineWidth = 3 * (1 - q) + 0.5;
        g.beginPath(); g.arc(r.x, r.y, r.r * (0.4 + q * 0.8), 0, TAU); g.stroke();
      }
      // gevangen vonken vliegen terug de kachel in
      for (let i = homing.length - 1; i >= 0; i--) {
        const m = homing[i]; m.life += dt;
        const q = Math.min(1, m.life / m.max), e = q * q;
        const tx = L.door.x, ty = L.door.y;
        m.x = lerp(m.sx, tx, e); m.y = lerp(m.sy, ty, e) - Math.sin(q * Math.PI) * 40;
        const R = m.big ? 14 : 9;
        g.globalAlpha = 1 - q * 0.3;
        g.drawImage(glowImg, m.x - R, m.y - R, R * 2, R * 2);
        g.globalAlpha = 1;
        if (q >= 1) { homing.splice(i, 1); flare = Math.min(1.4, flare + (m.big ? 0.5 : 0.22)); }
      }
      g.restore();
      // zwevende teksten (+1, KNAK!)
      for (let i = texts.length - 1; i >= 0; i--) {
        const tx = texts[i]; tx.life += dt;
        if (tx.life >= tx.max) { texts.splice(i, 1); continue; }
        const q = tx.life / tx.max;
        g.save();
        g.globalAlpha = q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3;
        g.font = "900 " + Math.round(tx.size * (q < 0.15 ? 0.7 + q * 2 : 1)) + "px Unbounded, system-ui, sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle";
        g.shadowColor = "rgba(255,106,26,.9)"; g.shadowBlur = 12;
        g.fillStyle = tx.col; g.fillText(tx.s, tx.x, tx.y - q * 26);
        g.restore();
      }
    }

    function drawMotes(dt, ts) {
      g.save(); g.globalCompositeOperation = "lighter";
      motes.forEach((m) => {
        m.y -= m.sp * dt; if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
        const x = m.x * W + Math.sin(ts + m.ph) * 8, y = m.y * H;
        g.fillStyle = "rgba(255,170,80," + (0.15 + 0.2 * Math.sin(ts * 2 + m.ph) ** 2) + ")";
        g.beginPath(); g.arc(x, y, m.r, 0, TAU); g.fill();
      });
      g.restore();
    }

    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (!L || !W) layout();
      const gap = now - (lastFrame || now);
      // Tab weg of telefoon hapert: de speltijd staat stil i.p.v. dat alle vonken in één klap landen.
      if (phase === "play" && gap > 250) t0 += gap - 1000 / 60;
      const dt = Math.min(0.05, gap / 1000);
      lastFrame = now;
      const ts = (now - now0) / 1000, t = playT();

      if (phase === "play") {
        while (next < sparks.length && sparks[next].t <= t) spawn(sparks[next++]);
        live.forEach((s) => { if (!s.dead && t >= s.t0 + s.dur) land(s); });
        for (let i = live.length - 1; i >= 0; i--) if (live[i].dead) live.splice(i, 1);
        const left = Math.max(0, DURATION - t);
        barFill.style.transform = "scaleX(" + (left / DURATION).toFixed(4) + ")";
        const sec = Math.ceil(left / 1000);
        if (sec !== lastSec) {
          lastSec = sec; timeEl.textContent = String(sec);
          if (sec <= 3 && sec > 0) { timeEl.classList.remove("hot"); void timeEl.offsetWidth; timeEl.classList.add("hot"); beep(660, 0.04, "square", 0.03); }
        }
        if (left <= 0 && next >= sparks.length && !live.length) finish();
      }

      flare *= Math.pow(0.15, dt); sting *= Math.pow(0.05, dt); shake *= Math.pow(0.002, dt);

      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (shake > 0.01) g.translate((Math.random() - 0.5) * 12 * shake, (Math.random() - 0.5) * 8 * shake);
      g.drawImage(bg, 0, 0, W, H);
      drawSpill(ts);
      g.drawImage(stoveImg, 0, 0, W, H);
      drawFire(ts);
      drawScorches(dt);
      drawShadows(t);
      drawSparks(t, ts);
      drawFx(dt);
      drawMotes(dt, ts);
      // rand: donker, en kort rood bij een schroeiplek
      const vg = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.42, W / 2, H * 0.5, Math.max(W, H) * 0.78);
      vg.addColorStop(0, "rgba(11,7,5,0)"); vg.addColorStop(1, sting > 0.02 ? "rgba(" + Math.round(11 + 160 * sting) + ",14,5," + (0.6 + 0.2 * sting) + ")" : "rgba(11,7,5,.6)");
      g.fillStyle = vg; g.fillRect(-20, -20, W + 40, H + 40);
    }

    function result() { return { caught, missed, big, combo: best }; }

    function finish() {
      if (phase !== "play") return;
      phase = "result";
      const r = result(), q = ratio(r);
      hud.style.opacity = "0";
      root.querySelectorAll(".vk-pop").forEach((x) => x.remove());
      if (q >= 0.74) { try { sfx.fanfare && sfx.fanfare(); } catch (e) { /* stil */ } }
      const res = h("div", "vk-scr vk-res");
      res.appendChild(h("div", "vk-kicker", missed ? "De regen is voorbij" : "Geen vonk op het kleed!"));
      res.appendChild(h("div", "vk-big vk-disp", String(caught)));
      res.appendChild(h("div", "vk-unit", "van de " + sumAll + " gevangen"));
      res.appendChild(h("div", "vk-rank", RANKS.find((x) => q >= x[0])[1]));
      const st = h("div", "vk-stats");
      [[Math.round(q * 100) + "%", "Gevangen"], [missed, "Geland"], [best, "Beste reeks"]].forEach(([n, lbl]) => {
        const s = h("div", "vk-stat"); s.appendChild(h("b", null, String(n))); s.appendChild(h("span", null, lbl)); st.appendChild(s);
      });
      res.appendChild(st);
      res.appendChild(h("div", "vk-sub", (big ? big / 2 + " dikke " + (big === 2 ? "sintel" : "sintels") + " gedoofd · " : "") + c.name));
      const w = h("div", "vk-wait"); w.appendChild(h("i")); w.appendChild(document.createTextNode("Klaar! Wachten op de rest…"));
      res.appendChild(w);
      root.appendChild(res);
      if (typeof ctx.done === "function") ctx.done(r);
    }

    startBtn.addEventListener("click", () => {
      if (phase !== "howto") return;
      phase = "count";
      beep(1, 0.001, "sine", 0.0001); // audio ontgrendelen binnen het gebaar
      how.remove();
      hud.style.opacity = "1";
      const cd = typeof ctx.countdown === "function" ? ctx.countdown : (e) => M.countdown(e, { sfx });
      cd(root).then(() => {
        if (dead) return;
        t0 = performance.now();
        phase = "play";
      });
    });

    layout();
    now0 = performance.now();
    raf = requestAnimationFrame(frame);

    // Testhaakje (alleen voor Playwright): leesbare speltoestand, geen globale variabele.
    Object.defineProperty(root, "_vonken", { value: {
      get phase() { return phase; }, get t() { return playT(); }, cfg: c, result, total: sumAll,
      get sparks() { const t = playT(); return live.filter((s) => !s.dead).map((s) => { const p = posAt(s, t); return { id: s.id, x: p.x, y: p.y, u: p.u, big: s.big, hp: s.hp }; }); },
    }, enumerable: false });

    return {
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        timers.forEach(clearTimeout); timers.clear();
        if (ro) ro.disconnect(); else removeEventListener("resize", onResize);
        root.removeEventListener("pointerdown", onDown);
        root.remove();
      },
    };
  }

  const def = {
    id: "vonken", title: "Vonken", icon: "✨", kind: "local", duration: 25,
    howto: "Tik de vonken uit de lucht voor ze op het kleed landen.",
    mount, score, bot, plan, bez, logsFor, valid, CFG, DURATION,
  };
  M.register(def);
  if (typeof module === "object" && module.exports) module.exports = def;
})();
