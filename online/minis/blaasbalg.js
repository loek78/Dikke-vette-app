// Minigame "blaasbalg" — lokaal co-op ritmespel: blaas het vuur aan in de maat (SPEC-3 §5).
// Ringen krimpen naar de gloeiende kool; tik als ze de kool raken. Gouden ring = op de tel, blauwe = tussen de tellen.
// Iedereen speelt hetzelfde (geseede) patroon; de teamscore bepaalt hoeveel blokken er op het vuur gaan.
(function () {
  "use strict";
  const M = typeof DVMini !== "undefined" ? DVMini : require("./core.js");

  // Per moeilijkheid: tempo, maten, aanloop van de ring (ms) en vensters (ms, ±).
  // bad = buitenrand: een tik net naast "goed" telt als MIS voor díe noot (geen extra luchtpuf-straf).
  const CFG = {
    1: { bpm: 80, bars: 6, approach: 1500, perfect: 75, good: 160, bad: 250, name: "Rustig" },
    2: { bpm: 100, bars: 8, approach: 1150, perfect: 60, good: 130, bad: 210, name: "Stevig" },
    3: { bpm: 120, bars: 10, approach: 950, perfect: 50, good: 110, bad: 175, name: "Heet" },
  };
  const LEAD = 2; // tellen klik vooraf
  // Een tik komt altijd wat later binnen dan je hem bedoelde (beeld loopt ~1 frame achter, touchscreen ~20–40 ms).
  // Die vaste vertraging trekken we eraf, anders voelt "precies op tijd" structureel als "laat".
  const INPUT_LAG = 30;
  const BARS = {
    1: [[0, 1, 2, 3], [0, 2], [0, 1, 2], [0, 2, 3], [0, 1, 3]],
    2: [[0, 1, 2, 3], [0, 1, 1.5, 2, 3], [0, 2, 2.5, 3], [0, 1, 2], [0, 0.5, 1, 2, 3]],
    3: [[0, 1, 2, 3], [0, 1, 1.5, 2, 3], [0, 0.5, 1, 2, 2.5, 3], [0, 2, 3, 3.5]],
  };
  const SYNC = [[0, 1.5, 2.5, 3], [0, 0.5, 1.5, 3], [0, 1, 1.5, 2.5, 3], [0.5, 1, 2, 3]]; // syncopen (alleen 3)

  const cfg = (d) => CFG[Math.max(1, Math.min(3, Math.round(d) || 1))];

  // Geseed patroon → [{ t (ms vanaf start), beat, off (tussen de tellen), big (finale) }]
  function pattern(seed, difficulty) {
    const d = Math.max(1, Math.min(3, Math.round(difficulty) || 1));
    const c = CFG[d], rnd = M.rng(seed >>> 0), beatMs = 60000 / c.bpm;
    const syncBars = new Set();
    if (d === 3) { // een paar syncopen, nooit in de eerste twee maten
      while (syncBars.size < 3) syncBars.add(2 + Math.floor(rnd() * (c.bars - 2)));
    }
    const notes = [];
    for (let b = 0; b < c.bars; b++) {
      let bar;
      if (b === 0) bar = d === 1 ? [0, 2] : [0, 1, 2, 3];
      else if (syncBars.has(b)) bar = SYNC[Math.floor(rnd() * SYNC.length)];
      else bar = BARS[d][Math.floor(rnd() * BARS[d].length)];
      bar.forEach((x) => {
        const beat = LEAD + b * 4 + x;
        notes.push({ t: Math.round(beat * beatMs), beat, off: x % 1 !== 0, big: false });
      });
    }
    const fin = LEAD + c.bars * 4; // grote slotpuf op de één
    notes.push({ t: Math.round(fin * beatMs), beat: fin, off: false, big: true });
    return notes;
  }

  // Welke noot hoort bij een tik op songtijd t? De dichtstbijzijnde open noot binnen het buitenvenster
  // (zodat snelle achtsten elkaar niet "stelen"). → { i, dt, grade: "perfect"|"good"|"miss" } of null (= luchtpuf).
  function classify(notes, from, t, c) {
    let pick = -1, pd = Infinity;
    for (let i = from; i < notes.length; i++) {
      const n = notes[i];
      if (n.done) continue;
      const dt = t - n.t;
      if (dt < -c.bad) break;
      if (Math.abs(dt) <= c.bad && Math.abs(dt) < pd) { pick = i; pd = Math.abs(dt); }
    }
    if (pick < 0) return null;
    return { i: pick, dt: t - notes[pick].t, grade: pd <= c.perfect ? "perfect" : pd <= c.good ? "good" : "miss" };
  }

  // ---------- Scoren ----------
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  function valid(r) {
    if (!r || typeof r !== "object") return null;
    const total = num(r.total), hits = num(r.hits), perfect = num(r.perfect), misses = num(r.misses);
    if (total === null || hits === null || perfect === null || misses === null || total < 1) return null;
    return { total, hits: Math.min(hits, total), perfect: Math.min(perfect, hits, total), misses: Math.min(misses, total),
      stray: num(r.stray) || 0, combo: num(r.combo) || 0 };
  }
  // 0..1 — perfect telt vol, goed 65%, losse luchtpuffen kosten wat.
  function accuracy(r) {
    const v = valid(r);
    if (!v) return null;
    const pts = v.perfect + (v.hits - v.perfect) * 0.65 - 0.25 * Math.min(v.stray, v.total);
    return Math.max(0, Math.min(1, pts / v.total));
  }
  const pct = (a) => Math.round(a * 100) + "%";

  function score(results, info) {
    results = results && typeof results === "object" ? results : {};
    info = info || {};
    const d = Math.max(1, Math.min(3, Math.round(info.difficulty) || 1));
    let players = Array.isArray(info.players) && info.players.length ? info.players : Object.keys(results).map((pid) => ({ pid, name: pid }));
    const nameOf = (p) => (p && p.name) || "Iemand";
    const rows = players.map((p) => ({ p, r: valid(results[p.pid]), acc: accuracy(results[p.pid]) }));
    const played = rows.filter((x) => x.acc !== null);
    // Wie niet meeblies, telt als een zuchtje (0.2).
    const team = rows.length ? rows.reduce((s, x) => s + (x.acc === null ? 0.2 : x.acc), 0) / rows.length : 0;
    const shift = d === 3 ? -0.04 : d === 1 ? 0.03 : 0;
    const logs = M.clampLogs(team >= 0.88 + shift ? 3 : team >= 0.72 + shift ? 2 : team >= 0.52 + shift ? 1 : team >= 0.32 + shift ? 0 : -1);
    const head = {
      3: "Strak in de maat — Gloei laait op als een discobal!",
      2: "Mooi op de tel. Het vuur knispert tevreden.",
      1: "Beetje uit de maat, maar het vuur leeft.",
      0: "Meer lucht naast de kachel dan erin…",
      "-1": "Het vuur sputtert. Gloei: \"Was dat blazen of hijgen?\"",
    }[logs];
    const lines = [head];
    let mvp = null;
    if (played.length >= 2) {
      const best = played.slice().sort((a, b) => b.acc - a.acc || b.r.perfect - a.r.perfect)[0];
      if (best.acc > 0) {
        mvp = best.p.pid;
        lines.push(nameOf(best.p) + " had de beste longen: " + pct(best.acc) + " raak, " + best.r.perfect + "× perfect.");
      }
    } else if (played.length === 1) {
      lines.push(nameOf(played[0].p) + " blies " + pct(played[0].acc) + " raak, " + played[0].r.perfect + "× perfect.");
    }
    const combo = played.slice().sort((a, b) => b.r.combo - a.r.combo)[0];
    if (combo && combo.r.combo >= 8 && combo.p.pid !== mvp) lines.push(nameOf(combo.p) + " haalde een combo van " + combo.r.combo + ". Lekker.");
    rows.filter((x) => x.acc === null).forEach((x) => lines.push(nameOf(x.p) + " blies niet mee. Gloei heeft het gezien."));
    if (played.length >= 2) lines.push("Samen " + pct(team) + " op de tel.");
    const perPlayer = {};
    rows.forEach((x) => {
      perPlayer[x.p.pid] = x.r ? pct(x.acc) + " · " + x.r.perfect + "× perfect · combo " + x.r.combo : "—";
    });
    return { logs, lines, mvp, perPlayer };
  }

  // Geloofwaardige bot: kans op raak/perfect per noot, deterministisch per rng.
  function bot(rng, difficulty) {
    const d = Math.max(1, Math.min(3, Math.round(difficulty) || 1));
    const total = pattern(Math.floor(rng() * 4294967296), d).length;
    const skill = Math.max(0.3, Math.min(0.98, 0.62 + rng() * 0.36 - (d - 1) * 0.07));
    let hits = 0, perfect = 0, combo = 0, best = 0;
    for (let i = 0; i < total; i++) {
      if (rng() < skill) { hits++; combo++; best = Math.max(best, combo); if (rng() < skill * 0.75) perfect++; }
      else combo = 0;
    }
    const stray = rng() < 0.3 ? Math.floor(rng() * 3) : 0;
    return { hits, perfect, misses: total - hits, stray, total, combo: best };
  }

  // ---------- UI ----------
  const CSS = `
.bb{position:relative;width:100%;height:100%;min-height:520px;overflow:hidden;color:var(--glow,#ffe7b8);
  background:radial-gradient(120% 80% at 50% 55%,#2a1209 0%,var(--soot,#0b0705) 70%);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.bb *{box-sizing:border-box}
.bb-disp{font-family:"Unbounded",system-ui,sans-serif;font-weight:900;letter-spacing:-.02em}
.bb-scr{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom));text-align:center}
.bb-howto{gap:16px;background:radial-gradient(90% 55% at 50% 38%,rgba(255,106,26,.22),transparent 70%)}
.bb-orb{width:120px;height:120px;border-radius:50%;position:relative;flex:none;
  background:radial-gradient(circle at 46% 40%,#fff3d0 0,#ffc247 22%,#ff6a1a 52%,#a8260c 78%,#2a0a04 100%);
  margin:40px 0 44px;box-shadow:0 0 40px 8px rgba(255,106,26,.55),0 0 110px 30px rgba(232,64,28,.25);animation:bb-breathe 1.2s ease-in-out infinite}
.bb-orb::before,.bb-orb::after{content:"";position:absolute;inset:-18px;border-radius:50%;border:4px solid var(--flame,#ffc247);
  opacity:0;animation:bb-shrink 1.2s linear infinite}
.bb-orb::after{border-color:var(--blue,#5aa9ff);animation-delay:.6s}
.bb-orb.solo::after{display:none}
.bb-tgt{position:absolute;inset:-18px;border-radius:50%;border:2px solid rgba(255,243,208,.75);box-shadow:0 0 14px rgba(255,194,71,.5);
  animation:bb-tgt 1.2s linear infinite}
.bb-tik{position:absolute;left:100%;top:50%;margin:-10px 0 0 30px;font:900 20px/1 "Unbounded",system-ui,sans-serif;color:#fff3d0;
  text-shadow:0 0 14px rgba(255,194,71,.9);opacity:0;animation:bb-tik 1.2s linear infinite}
@keyframes bb-breathe{0%,78%,100%{transform:scale(1)}84%{transform:scale(1.1)}}
@keyframes bb-shrink{0%{transform:scale(1.45);opacity:0}15%{opacity:1}80%{transform:scale(1);opacity:1}92%{transform:scale(.97);opacity:0}100%{opacity:0}}
@keyframes bb-tgt{0%,76%,100%{transform:scale(1);border-color:rgba(255,243,208,.6)}82%{transform:scale(1.06);border-color:#fff}}
@keyframes bb-tik{0%,76%{opacity:0;transform:scale(.7)}82%{opacity:1;transform:scale(1.15)}100%{opacity:0;transform:scale(1)}}

.bb-kicker{font:800 12px/1 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:var(--ember,#ff6a1a)}
.bb-title{font-size:clamp(34px,11vw,48px);line-height:1;margin:0;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 45%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 18px rgba(255,106,26,.45))}
.bb-text{font-size:17px;line-height:1.4;max-width:330px;margin:0;color:var(--glow,#ffe7b8)}
.bb-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-width:340px}
.bb-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:99px;font-size:13px;color:var(--ash,#b8a99a);
  background:rgba(255,231,184,.06);border:1px solid rgba(255,194,71,.18)}
.bb-chip i{width:14px;height:14px;border-radius:50%;border:3px solid var(--flame,#ffc247);flex:none}
.bb-chip i.b{border-color:var(--blue,#5aa9ff)}
.bb-chip b{color:var(--glow,#ffe7b8)}
.bb-btn{appearance:none;border:0;cursor:pointer;margin-top:6px;min-width:200px;min-height:58px;padding:0 34px;border-radius:99px;
  font:900 19px/1 "Unbounded",system-ui,sans-serif;color:#2a0d02;letter-spacing:.02em;
  background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a) 70%,var(--blaze,#e8401c));
  box-shadow:0 0 0 1px rgba(255,231,184,.35) inset,0 10px 30px rgba(232,64,28,.45),0 0 60px rgba(255,106,26,.25)}
.bb-btn:active{transform:scale(.97)}
.bb-play{touch-action:none;cursor:pointer}
.bb-cv{position:absolute;inset:0;width:100%;height:100%;display:block}
.bb-hud{position:absolute;left:0;right:0;top:0;padding:max(14px,env(safe-area-inset-top)) 16px 0;display:grid;
  grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;pointer-events:none;z-index:2}
.bb-combo{justify-self:start;font-size:13px;color:var(--ash,#b8a99a);white-space:nowrap}
.bb-combo b{font:900 22px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);margin-left:4px;display:inline-block;transition:transform .1s}
.bb-combo b.bump{transform:scale(1.25)}
.bb-acc{justify-self:end;font:900 20px/1 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8)}
.bb-bar{width:min(34vw,140px);height:6px;border-radius:9px;background:rgba(255,231,184,.1);overflow:hidden}
.bb-bar i{display:block;height:100%;width:0;border-radius:9px;background:linear-gradient(90deg,var(--blaze,#e8401c),var(--flame,#ffc247));
  box-shadow:0 0 10px var(--ember,#ff6a1a)}
.bb-hint{position:absolute;left:0;right:0;bottom:max(10px,env(safe-area-inset-bottom));text-align:center;font-size:13px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--ash,#b8a99a);pointer-events:none;transition:opacity .6s;z-index:2}
.bb-pop{position:absolute;left:50%;transform:translate(-50%,-50%);pointer-events:none;white-space:nowrap;z-index:3;
  font:900 30px/1 "Unbounded",system-ui,sans-serif;animation:bb-pop .7s cubic-bezier(.2,.9,.3,1.2) forwards}
.bb-pop{text-shadow:0 0 3px rgba(20,6,2,.95),0 2px 0 #4a1404,0 0 18px rgba(255,106,26,.6)}
.bb-pop.p{color:var(--flame,#ffc247);text-shadow:0 0 3px rgba(20,6,2,.95),0 2px 0 #7a2a06,0 0 18px rgba(255,194,71,.8)}
.bb-pop.g{color:var(--glow,#ffe7b8);font-size:24px}
.bb-pop.m{color:#d9e9ff;font-size:24px;text-shadow:0 0 3px rgba(5,10,20,.95),0 2px 0 #10243d,0 0 16px rgba(90,169,255,.6)}
.bb-pop.s{color:var(--ash,#b8a99a);font-size:15px;font-weight:700;opacity:.8}
.bb-pop.big{font-size:44px;color:#fff3d0;text-shadow:0 0 26px rgba(255,194,71,.95),0 0 60px rgba(255,106,26,.8),0 3px 0 #7a2a06;animation-duration:1.1s}
.bb-pop small{display:block;margin-top:6px;font:800 13px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#fff3d0}
.bb-pop.c{color:var(--glow,#ffe7b8);font-size:15px;font-family:system-ui,sans-serif;font-weight:700;letter-spacing:.02em;
  background:rgba(23,16,11,.75);border:1px solid rgba(255,194,71,.35);padding:8px 13px;border-radius:14px;animation-duration:1.8s}
@keyframes bb-pop{0%{transform:translate(-50%,-30%) scale(.6);opacity:0}18%{transform:translate(-50%,-50%) scale(1.12);opacity:1}
  70%{opacity:1}100%{transform:translate(-50%,-110%) scale(1);opacity:0}}
.bb .mini-countdown{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font:900 96px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);text-shadow:0 0 30px rgba(255,106,26,.9),0 4px 0 #6a1c04;
  background:radial-gradient(circle at 50% 50%,rgba(11,7,5,.2),rgba(11,7,5,.65))}
.bb .mini-countdown.pop{animation:bb-cd .7s ease-out}
@keyframes bb-cd{0%{transform:scale(1.6);opacity:0}25%{transform:scale(1);opacity:1}100%{transform:scale(.92);opacity:.85}}
.bb-res{gap:10px;background:radial-gradient(90% 60% at 50% 35%,rgba(60,20,8,.72),rgba(11,7,5,.9) 75%);-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);
  animation:bb-fade .5s ease-out both;z-index:4}
@keyframes bb-fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.bb-big{font-size:clamp(64px,22vw,96px);line-height:.95;margin:2px 0;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 50%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 22px rgba(255,106,26,.5))}
.bb-rank{font:900 18px/1.2 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8)}
.bb-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;max-width:330px;margin-top:8px}
.bb-stat{padding:12px 6px;border-radius:16px;background:linear-gradient(180deg,rgba(255,231,184,.08),rgba(255,231,184,.03));
  border:1px solid rgba(255,194,71,.18);box-shadow:inset 0 1px 0 rgba(255,231,184,.08)}
.bb-stat b{display:block;font:900 24px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247)}
.bb-stat:nth-child(2) b{color:var(--ember,#ff6a1a)}
.bb-stat:nth-child(3) b{color:var(--ash,#b8a99a)}
.bb-stat span{display:block;margin-top:6px;font-size:12px;color:var(--ash,#b8a99a);letter-spacing:.06em;text-transform:uppercase}
.bb-sub{font-size:14px;color:var(--ash,#b8a99a)}
.bb-wait{margin-top:14px;display:inline-flex;align-items:center;gap:10px;font-size:15px;color:var(--glow,#ffe7b8);
  padding:10px 16px;border-radius:99px;background:rgba(23,16,11,.7);border:1px solid rgba(255,231,184,.12)}
.bb-wait i{width:10px;height:10px;border-radius:50%;background:var(--ember,#ff6a1a);box-shadow:0 0 12px var(--ember,#ff6a1a);
  animation:bb-breathe 1s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.bb-orb,.bb-orb::after,.bb-tgt,.bb-wait i{animation:none}.bb-orb::after{opacity:0}
  .bb-orb::before{animation-name:bb-fadein}.bb-tik{animation-name:bb-fadein}.bb-pop{animation-name:bb-fadeout}
  .bb .mini-countdown.pop,.bb-res{animation:none}}
@keyframes bb-fadein{0%,70%{opacity:0}85%{opacity:1}100%{opacity:0}}
@keyframes bb-fadeout{0%{opacity:0;transform:translate(-50%,-50%)}15%,70%{opacity:1;transform:translate(-50%,-50%)}100%{opacity:0;transform:translate(-50%,-50%)}}
`;

  function injectCss() {
    if (document.getElementById("mini-blaasbalg-css")) return;
    const s = document.createElement("style");
    s.id = "mini-blaasbalg-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  const HOWTO = "Tik overal op het scherm zodra een ring de witte cirkel rond de kool raakt. Blaas in de maat en het vuur groeit.";
  const QUIPS = { 8: "Gloei: \"Ooh, dáár. Ja.\"", 16: "Gloei: \"Ik voel me tien jaar jonger!\"", 24: "Gloei: \"Niet stoppen. NIET STOPPEN.\"", 32: "Gloei: \"Jullie zijn eigenlijk best goed…\"" };
  const RANKS = [[0.9, "Blaasbalg-meester"], [0.75, "Vuurfluisteraar"], [0.55, "Prima pufje"], [0.35, "Beetje hijgerig"], [0, "Gloei is beledigd"]];

  function mount(el, ctx) {
    injectCss();
    const d = Math.max(1, Math.min(3, Math.round(ctx.difficulty) || 1));
    const c = CFG[d], beatMs = 60000 / c.bpm;
    const notes = pattern(ctx.seed >>> 0, d);
    const sfx = ctx.sfx || {};
    const beep = (...a) => { try { sfx.beep && sfx.beep(...a); } catch (e) { /* geen geluid */ } };
    const buzz = (ms) => { try { sfx.buzz && sfx.buzz(ms); } catch (e) { /* geen tril */ } };
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    const root = h("div", "bb");
    el.appendChild(root);
    let dead = false, raf = 0, ro = null, phase = "howto";
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms); timers.add(id); };

    // --- Howto ---
    const how = h("div", "bb-scr bb-howto");
    // Demo: ring krimpt naar de witte doelcirkel, op het moment van raken "TIK!".
    const orb = h("div", "bb-orb" + (d === 1 ? " solo" : ""));
    orb.appendChild(h("div", "bb-tgt"));
    orb.appendChild(h("div", "bb-tik", "TIK!"));
    how.appendChild(orb);
    how.appendChild(h("div", "bb-kicker", "Blaasbalg · " + c.name + " · " + c.bpm + " bpm"));
    how.appendChild(h("h2", "bb-title bb-disp", "Blaasbalg"));
    how.appendChild(h("p", "bb-text", HOWTO));
    const leg = h("div", "bb-legend");
    const chip = (cls, txt, bold) => { const x = h("span", "bb-chip"); x.appendChild(h("i", cls)); x.appendChild(document.createTextNode(txt + " ")); if (bold) x.appendChild(h("b", null, bold)); leg.appendChild(x); };
    chip("", "op de tel", null);
    if (d >= 2) chip("b", "tussen de tellen", null);
    chip("", "combo =", "grotere vlam");
    how.appendChild(leg);
    const startBtn = h("button", "bb-btn", "Start");
    startBtn.type = "button";
    how.appendChild(startBtn);
    root.appendChild(how);

    // --- Speelveld ---
    const play = h("div", "bb-scr bb-play");
    play.style.padding = "0";
    play.style.display = "none";
    const cv = h("canvas", "bb-cv");
    play.appendChild(cv);
    const hud = h("div", "bb-hud");
    const comboEl = h("div", "bb-combo", "combo");
    const comboNum = h("b", null, "0");
    comboEl.appendChild(comboNum);
    const bar = h("div", "bb-bar");
    const barFill = h("i");
    bar.appendChild(barFill);
    const accEl = h("div", "bb-acc", "–");
    hud.append(comboEl, bar, accEl);
    play.appendChild(hud);
    const hint = h("div", "bb-hint", "Tik in de maat");
    play.appendChild(hint);
    root.appendChild(play);

    // --- Canvas + scène ---
    const g = cv.getContext("2d");
    let W = 0, H = 0, dpr = 1, L = null;
    function layout() {
      const r = play.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(2, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const R = Math.min(W * 0.14, H * 0.075);
      const winTop = H * 0.11, winBot = H * 0.76;
      const cy = winTop + (winBot - winTop) * 0.62;
      L = { R, cx: W / 2, cy, ringR: R * 1.35, maxR: Math.min(W * 0.6, H * 0.42), winTop, winBot,
        winL: W * 0.05, winR: W * 0.95, belTop: H * 0.79, belBot: H * 0.95 };
      L.speed = (L.maxR - L.ringR) / c.approach; // px per ms: ringen bewegen op tijd, niet per frame
      buildSprites();
      if (phase === "result" && !raf && !dead) drawScene(performance.now(), 0); // canvas is leeg na resize
    }
    if (typeof ResizeObserver === "function") { ro = new ResizeObserver(() => layout()); ro.observe(play); }

    // Vaste "decor"-random (gloeiende kooltjes, scheuren in de kool) uit de seed.
    const drng = M.rng((ctx.seed >>> 0) ^ 0xb1a5);
    const coals = Array.from({ length: 26 }, () => ({ x: drng(), y: drng(), r: 0.5 + drng() * 0.8, ph: drng() * 6.28 }));
    // Houtskooltextuur: donkere vlekken + gloeiende aders (eenheidscoördinaten in de kool).
    const blots = Array.from({ length: 10 }, () => { const a = drng() * 6.28, r = Math.sqrt(drng()) * 0.75; return { x: Math.cos(a) * r, y: Math.sin(a) * r, s: 0.16 + drng() * 0.22 }; });
    const veins = Array.from({ length: 5 }, () => {
      const a = drng() * 6.28, b = a + (drng() - 0.5) * 2.4, r1 = 0.1 + drng() * 0.3;
      return [Math.cos(a) * r1, Math.sin(a) * r1, Math.cos((a + b) / 2) * 0.55 + (drng() - 0.5) * 0.3, Math.sin((a + b) / 2) * 0.55 + (drng() - 0.5) * 0.3, Math.cos(b) * 0.88, Math.sin(b) * 0.88];
    });

    // Vooraf getekende sprites (gloeibolletje + houtskooltextuur): scheelt ~40 gradients per frame op trage telefoons.
    const sprite = (px, draw) => {
      const k = document.createElement("canvas");
      k.width = k.height = Math.max(2, Math.ceil(px));
      draw(k.getContext("2d"), k.width);
      return k;
    };
    let glowSpr = null, blotSpr = null, veinSpr = null;
    function buildSprites() {
      if (W < 50) return;
      glowSpr = sprite(64, (x, s) => {
        const gr = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        gr.addColorStop(0, "rgba(255,170,60,1)"); gr.addColorStop(0.6, "rgba(232,64,28,.6)"); gr.addColorStop(1, "rgba(60,10,4,0)");
        x.fillStyle = gr; x.fillRect(0, 0, s, s);
      });
      const pr = L.R * 1.1 * dpr; // ruimte voor de puls
      blotSpr = sprite(pr * 2, (x, s) => {
        x.translate(s / 2, s / 2);
        blots.forEach((k) => {
          const bg = x.createRadialGradient(k.x * pr, k.y * pr, 0, k.x * pr, k.y * pr, k.s * pr);
          bg.addColorStop(0, "rgba(70,14,4,1)"); bg.addColorStop(1, "rgba(70,14,4,0)");
          x.fillStyle = bg; x.beginPath(); x.arc(k.x * pr, k.y * pr, k.s * pr, 0, 6.283); x.fill();
        });
      });
      veinSpr = sprite(pr * 2, (x, s) => {
        x.translate(s / 2, s / 2); x.lineCap = "round"; x.strokeStyle = "rgb(255,226,150)"; x.lineWidth = Math.max(1, L.R * 0.035 * dpr);
        veins.forEach((v) => { x.beginPath(); x.moveTo(v[0] * pr, v[1] * pr); x.quadraticCurveTo(v[2] * pr, v[3] * pr, v[4] * pr, v[5] * pr); x.stroke(); });
      });
      L.sprR = L.R * 1.1;
    }

    const parts = [];
    const spark = (x, y, n, spd, kind) => {
      for (let i = 0; i < n && parts.length < 260; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * (kind === "air" ? 0.5 : 2.6);
        const v = spd * (0.4 + Math.random() * 0.8);
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: kind === "smoke" ? 1.1 : kind === "air" ? 0.35 : 0.5 + Math.random() * 0.7,
          s: kind === "smoke" ? 6 + Math.random() * 8 : 1 + Math.random() * 2.2, kind });
      }
    };

    // --- Spelstatus ---
    let t0 = 0, lastBeat = -1, sched = -1, next = 0, pausedT = 0, runId = 0, endAt = 0;
    const lastNote = notes[notes.length - 1];
    let hits = 0, perfect = 0, misses = 0, stray = 0, combo = 0, best = 0;
    let heat = 0.45, pulse = 0, flare = 0, squish = 0, shake = 0, flash = 0, lastFrame = 0;
    const rings = []; // uitdijende raak-ringen

    function popup(text, cls, dy, sub) {
      const p = h("div", "bb-pop " + cls, text);
      if (sub) p.appendChild(h("small", null, sub));
      p.style.top = Math.round(L.cy - L.R * (cls === "c" ? 3.9 : 2.3) + (dy || 0)) + "px";
      p.addEventListener("animationend", () => p.remove());
      play.appendChild(p);
      if (cls !== "c") play.querySelectorAll(".bb-pop:not(.c)").forEach((x) => { if (x !== p) x.remove(); });
    }

    function updHud() {
      comboNum.textContent = String(combo);
      comboNum.classList.remove("bump"); void comboNum.offsetWidth; if (combo) comboNum.classList.add("bump");
      const judged = hits + misses;
      accEl.textContent = judged ? Math.round(accuracy({ hits, perfect, misses, stray, total: judged }) * 100) + "%" : "–";
    }

    function judge(note, dt) {
      note.done = true;
      const a = Math.abs(dt);
      if (a <= c.perfect) {
        perfect++; hits++; combo++;
        popup(note.big ? "PUUUF!" : "PERFECT", note.big ? "p big" : "p");
        beep(988 + Math.min(combo, 24) * 18, 0.08, "triangle", 0.1);
        heat = Math.min(1, heat + 0.1); flare = 1;
        spark(L.cx, L.cy - L.R * 0.6, note.big ? 46 : 18, 260, "spark");
        rings.push({ r: L.ringR, life: 0, col: note.off ? "90,169,255" : "255,194,71" });
        buzz(12);
      } else {
        hits++; combo++;
        popup(note.big ? "PUF!" : "GOED", note.big ? "g big" : "g", 0, dt < 0 ? "vroeg" : "laat");
        beep(740, 0.06, "triangle", 0.08);
        heat = Math.min(1, heat + 0.05); flare = Math.max(flare, 0.55);
        spark(L.cx, L.cy - L.R * 0.6, note.big ? 30 : 9, 190, "spark");
        rings.push({ r: L.ringR, life: 0, col: "255,106,26" });
        buzz(8);
      }
      best = Math.max(best, combo);
      if (note.big) { // slotpuf: alles uit de kast
        flash = 1; flare = 1; heat = Math.min(1, heat + 0.2);
        rings.push({ r: L.ringR, life: 0, col: "255,243,208", big: true });
        beep(523, 0.18, "triangle", 0.09); beep(784, 0.22, "triangle", 0.08, 0.06); beep(1047, 0.3, "triangle", 0.08, 0.12);
        buzz([20, 40, 60]);
      }
      if (QUIPS[combo]) { flash = Math.max(flash, 0.5); later(() => popup(QUIPS[combo], "c"), 120); }
      if (hits >= 3) hint.style.opacity = "0";
      updHud();
    }

    // dt gezet = tik net naast het venster (te vroeg/te laat), anders voorbijgelaten noot.
    function miss(note, dt) {
      note.done = true;
      misses++; combo = 0;
      popup("MIS", "m", 0, dt === undefined ? null : dt < 0 ? "te vroeg" : "te laat");
      beep(150, 0.14, "sawtooth", 0.05);
      buzz(35);
      heat = Math.max(0.12, heat - 0.14); shake = reduced ? 0 : 1;
      spark(L.cx, L.cy - L.R * 0.4, 7, 60, "smoke");
      updHud();
    }

    function tap(at) {
      if (phase !== "play") return;
      const t = at - t0 - INPUT_LAG;
      squish = 1;
      spark(L.cx, L.belTop - 4, 6, 520, "air");
      const hit = classify(notes, next, t, c);
      if (hit) { if (hit.grade === "miss") miss(notes[hit.i], hit.dt); else judge(notes[hit.i], hit.dt); return; }
      stray++; combo = 0;
      popup("pfff…", "s");
      beep(260, 0.04, "square", 0.025);
      updHud();
    }

    // Tijdstip van de tik = moment van het event (niet van de handler): een drukke main thread mag je timing niet kosten.
    const evT = (e) => {
      const n = performance.now(), ts = e && e.timeStamp;
      return ts > 0 && ts <= n + 2 && n - ts < 250 ? ts : n;
    };
    const onDown = (e) => { if (e.button > 0) return; e.preventDefault(); tap(evT(e)); };
    const onKey = (e) => { if ((e.code === "Space" || e.key === "Enter") && phase === "play" && !e.repeat) { e.preventDefault(); tap(evT(e)); } };
    // Tab weg (telefoon op slot, appje): pauzeren i.p.v. alle noten als MIS te tellen; terug = aftellen + 2 tellen aanloop.
    const onVis = () => { if (document.hidden) pause(); else if (phase === "pause") resume(); };
    play.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);

    // --- Tekenen ---
    function flameShape(cx, by, hw, fh, t, ph) {
      g.beginPath();
      const N = 16, left = [], right = [];
      for (let i = 0; i <= N; i++) {
        const v = i / N;
        const sway = (Math.sin(t * 4.1 + v * 4 + ph) * 0.5 + Math.sin(t * 7.7 + v * 9 + ph * 2) * 0.16) * hw * v;
        const wv = hw * Math.pow(Math.sin(Math.PI * (0.5 + 0.5 * v)), 0.8) * (1 - 0.12 * Math.sin(t * 11 + v * 13 + ph) * v);
        left.push([cx + sway - wv, by - v * fh]); right.push([cx + sway + wv, by - v * fh]);
      }
      g.moveTo(left[0][0], left[0][1]);
      for (let i = 1; i <= N; i++) g.lineTo(left[i][0], left[i][1]);
      for (let i = N; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
      g.quadraticCurveTo(cx, by + hw * 0.7, left[0][0], left[0][1]);
    }
    const LAYERS = [["232,64,28", 1, 0.75], ["255,106,26", 0.78, 0.85], ["255,194,71", 0.55, 0.9], ["255,243,208", 0.3, 0.95]];
    function drawFlame(t, fh) {
      const { cx, cy, R } = L;
      const by = cy - R * 0.25;
      g.save();
      g.globalCompositeOperation = "lighter";
      const tongues = [[0, 1, 0], [-0.55, 0.62, 1.7], [0.55, 0.68, 3.1], [-0.25, 0.8, 4.4], [0.3, 0.75, 5.2]];
      tongues.forEach(([ox, sc, ph]) => {
        LAYERS.forEach(([rgb, s, a]) => {
          const hw = R * 0.95 * s * sc, hh = fh * (0.45 + 0.55 * s) * sc;
          const gr = g.createLinearGradient(0, by, 0, by - hh);
          gr.addColorStop(0, "rgba(" + rgb + "," + a * 0.55 + ")");
          gr.addColorStop(0.55, "rgba(" + rgb + "," + a * 0.35 + ")");
          gr.addColorStop(1, "rgba(" + rgb + ",0)");
          g.fillStyle = gr;
          flameShape(cx + ox * R, by, hw, hh, t, ph + s);
          g.fill();
        });
      });
      if (combo >= 12) { // blauwe voet: zo heet is het
        const a = Math.min(0.55, (combo - 11) * 0.05);
        const gr = g.createRadialGradient(cx, by + R * 0.1, 0, cx, by + R * 0.1, R * 1.1);
        gr.addColorStop(0, "rgba(90,169,255," + a + ")"); gr.addColorStop(1, "rgba(90,169,255,0)");
        g.fillStyle = gr;
        g.beginPath(); g.ellipse(cx, by + R * 0.1, R * 1.1, R * 0.45, 0, 0, 6.283); g.fill();
      }
      g.restore();
    }

    function roundRect(x, y, w, hh, r) {
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + hh - r); g.quadraticCurveTo(x + w, y + hh, x + w - r, y + hh);
      g.lineTo(x + r, y + hh); g.quadraticCurveTo(x, y + hh, x, y + hh - r);
      g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
    }

    function drawScene(now, t) {
      const { R, cx, cy, ringR, winTop, winBot, winL, winR } = L;
      const ts = now / 1000;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      if (shake > 0.01) g.translate((Math.random() - 0.5) * 8 * shake, (Math.random() - 0.5) * 6 * shake);

      // Kachelruit: donker gietijzer met warme binnengloed
      const flick = 0.9 + 0.1 * Math.sin(ts * 7.3) * Math.sin(ts * 3.1);
      roundRect(winL, winTop, winR - winL, winBot - winTop, 26);
      const ig = g.createRadialGradient(cx, cy, R * 0.5, cx, cy, Math.max(W, H) * 0.65);
      ig.addColorStop(0, "rgba(120,40,12," + (0.55 + heat * 0.45) * flick + ")");
      ig.addColorStop(0.5, "rgba(48,18,8,.95)");
      ig.addColorStop(1, "#140b07");
      g.fillStyle = ig; g.fill();
      g.lineWidth = 7; g.strokeStyle = "#0a0604"; g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = "rgba(255,194,71,.18)"; g.stroke();

      // Bed van kooltjes onderin de ruit
      g.save();
      roundRect(winL, winTop, winR - winL, winBot - winTop, 26); g.clip();
      if (glowSpr) coals.forEach((k) => {
        const x = winL + 10 + k.x * (winR - winL - 20), y = winBot - 8 - k.y * (winBot - winTop) * 0.14;
        const rr = R * 0.32 * k.r;
        g.globalAlpha = Math.min(1, (0.35 + 0.4 * heat) * (0.6 + 0.4 * Math.sin(ts * 2.3 + k.ph)));
        g.drawImage(glowSpr, x - rr, y - rr, rr * 2, rr * 2);
      });
      g.restore();

      // Halo rond de kool
      const halo = g.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * (3.2 + heat * 1.5));
      halo.addColorStop(0, "rgba(255,106,26," + (0.25 + heat * 0.35 + flash * 0.3) + ")");
      halo.addColorStop(1, "rgba(255,106,26,0)");
      g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, R * 5, 0, 6.283); g.fill();

      // Combovlam (achter de kool)
      const fh = R * (1.6 + Math.min(combo, 30) / 30 * 3.2 + heat * 0.8 + flare * 0.9);
      drawFlame(ts, Math.min(fh, cy - winTop - 6));

      // De kool, pulserend op de tel
      const pr = R * (1 + pulse * 0.07);
      const eg = g.createRadialGradient(cx - R * 0.15, cy - R * 0.2, R * 0.05, cx, cy, pr);
      const hot = Math.min(1, heat + flash * 0.5);
      eg.addColorStop(0, hot > 0.6 ? "#fff3d0" : "#ffd27a");
      eg.addColorStop(0.35, "#ffc247");
      eg.addColorStop(0.7, hot > 0.3 ? "#ff6a1a" : "#c2410f");
      eg.addColorStop(0.92, "#9a220b");
      eg.addColorStop(1, "#3a0e05");
      g.fillStyle = eg; g.beginPath(); g.arc(cx, cy, pr, 0, 6.283); g.fill();
      if (blotSpr) {
        const sr = L.sprR * pr / R;
        g.save(); g.beginPath(); g.arc(cx, cy, pr, 0, 6.283); g.clip();
        g.globalAlpha = 0.6 - hot * 0.3;
        g.drawImage(blotSpr, cx - sr, cy - sr, sr * 2, sr * 2);
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = Math.min(1, 0.12 + hot * 0.35 + pulse * 0.15);
        g.drawImage(veinSpr, cx - sr, cy - sr, sr * 2, sr * 2);
        g.restore();
      }

      // Rooster vóór de kool (zoals de kachel)
      const gy = cy + R * 0.95;
      g.save();
      g.strokeStyle = "#120a06"; g.lineCap = "round";
      for (let i = -6; i <= 6; i++) {
        const x = cx + i * R * 0.3, y0 = gy - Math.abs(i) * Math.abs(i) * R * 0.012;
        g.lineWidth = R * 0.11; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + R * 0.55); g.stroke();
      }
      g.lineWidth = R * 0.14; g.beginPath(); g.moveTo(cx - R * 2, gy - R * 0.4); g.quadraticCurveTo(cx, gy + R * 0.2, cx + R * 2, gy - R * 0.4); g.stroke();
      g.strokeStyle = "rgba(255,140,50," + (0.25 + heat * 0.3) + ")"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(cx - R * 2, gy - R * 0.47); g.quadraticCurveTo(cx, gy + R * 0.13, cx + R * 2, gy - R * 0.47); g.stroke();
      g.restore();

      // Raakzone: de band is precies het "goed"-venster (ringen bewegen met vaste px/ms), de doelring pulseert op de tel.
      const band = L.speed * c.good;
      g.lineWidth = band * 2;
      g.strokeStyle = "rgba(255,194,71," + (0.07 + pulse * 0.07) + ")";
      g.beginPath(); g.arc(cx, cy, ringR, 0, 6.283); g.stroke();
      g.lineWidth = 9 + pulse * 6;
      g.strokeStyle = "rgba(255,194,71," + (0.12 + pulse * 0.25) + ")";
      g.beginPath(); g.arc(cx, cy, ringR + pulse * 3, 0, 6.283); g.stroke();
      g.lineWidth = 2.5 + pulse * 2.5;
      g.strokeStyle = "rgba(255,243,208," + (0.55 + pulse * 0.45) + ")";
      g.beginPath(); g.arc(cx, cy, ringR + pulse * 3, 0, 6.283); g.stroke();

      // Aanrollende ringen: straal = doel + snelheid × resterende tijd (ook ná het doel, zodat "te laat" zichtbaar is)
      if (phase === "play" || phase === "pause" || phase === "resume") {
        for (let i = next; i < notes.length; i++) {
          const n = notes[i];
          const dt = n.t - t;
          if (dt > c.approach) break;
          if (n.done || dt < -c.bad) continue;
          const k = Math.max(0, dt / c.approach);
          const r = Math.max(R * 0.5, ringR + L.speed * dt);
          const col = n.off ? "90,169,255" : "255,194,71";
          const near = Math.abs(dt) <= c.perfect;
          const a = Math.min(1, 0.2 + (1 - k) * 0.95) * (dt < 0 ? Math.max(0, 1 + dt / c.bad) : 1);
          const lw = (n.big ? 7 : 4) + (1 - k) * 4;
          g.lineWidth = lw * 2.6; g.strokeStyle = "rgba(" + col + "," + a * 0.22 + ")"; // gloed zonder shadowBlur
          g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke();
          g.lineWidth = lw;
          g.strokeStyle = near ? "rgba(255,243,208," + a + ")" : "rgba(" + col + "," + a + ")";
          g.stroke();
          if (n.big) { g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, r + 11, 0, 6.283); g.stroke(); }
        }
      }

      // Raak-ringen
      for (let i = rings.length - 1; i >= 0; i--) {
        const q = rings[i];
        const a = 1 - q.life;
        g.lineWidth = 6 * a; g.strokeStyle = "rgba(" + q.col + "," + a + ")";
        g.beginPath(); g.arc(cx, cy, q.r + q.life * R * (q.big ? 4 : 1.6), 0, 6.283); g.stroke();
      }

      // Deeltjes
      g.save();
      parts.forEach((p) => {
        const a = 1 - p.life / p.max;
        if (p.kind === "smoke") {
          g.fillStyle = "rgba(184,169,154," + a * 0.22 + ")";
          g.beginPath(); g.arc(p.x, p.y, p.s * (1 + p.life * 2), 0, 6.283); g.fill();
        } else if (p.kind === "air") {
          g.strokeStyle = "rgba(255,231,184," + a * 0.35 + ")"; g.lineWidth = 2;
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); g.stroke();
        } else {
          g.globalCompositeOperation = "lighter";
          g.fillStyle = a > 0.5 ? "rgba(255,226,140," + a + ")" : "rgba(255,106,26," + a * 1.6 + ")";
          g.beginPath(); g.arc(p.x, p.y, p.s, 0, 6.283); g.fill();
          g.globalCompositeOperation = "source-over";
        }
      });
      g.restore();

      drawBellows();
    }

    // Blaasbalg onderin, mondstuk naar de kachel; knijpt in bij elke tik.
    function boardPath(cx, y0, bw, hh, k) {
      g.beginPath();
      g.moveTo(cx - bw * 0.09 * k, y0);
      g.bezierCurveTo(cx - bw * 0.56 * k, y0 + hh * 0.3, cx - bw * 0.62 * k, y0 + hh, cx, y0 + hh);
      g.bezierCurveTo(cx + bw * 0.62 * k, y0 + hh, cx + bw * 0.56 * k, y0 + hh * 0.3, cx + bw * 0.09 * k, y0);
      g.closePath();
    }
    function drawBellows() {
      const { cx, belTop, belBot } = L;
      const bw = Math.min(W * 0.5, (belBot - belTop) * 1.9);
      const sq = squish;
      const y0 = belTop + (belBot - belTop) * (0.2 + sq * 0.06);
      const hh = (belBot - y0) * (0.86 - sq * 0.06);
      g.save();
      // mondstuk (messing)
      const ng = g.createLinearGradient(cx - 9, 0, cx + 9, 0);
      ng.addColorStop(0, "#5a3a14"); ng.addColorStop(0.5, "#f0c060"); ng.addColorStop(1, "#5a3a14");
      g.fillStyle = ng;
      g.beginPath(); g.moveTo(cx - 3.5, belTop - 4); g.lineTo(cx + 3.5, belTop - 4); g.lineTo(cx + bw * 0.08, y0 + 6); g.lineTo(cx - bw * 0.08, y0 + 6); g.closePath(); g.fill();
      // leer: dikker als de balg open is, met plooien
      const lk = 1.1 - sq * 0.07;
      boardPath(cx, y0 + 2, bw, hh + 4, lk);
      g.fillStyle = "#2a140a"; g.fill();
      g.strokeStyle = "rgba(0,0,0,.5)"; g.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.12 + 0.76 * i / 8);
        const ex = cx + Math.cos(a) * bw * 0.55 * lk, ey = y0 + hh * 0.55 + Math.sin(a) * hh * 0.48;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * bw * 0.44, y0 + hh * 0.55 + Math.sin(a) * hh * 0.4); g.lineTo(ex, ey); g.stroke();
      }
      // houten plank met nerf, rand en messing nagels
      const wg = g.createLinearGradient(0, y0, 0, y0 + hh);
      wg.addColorStop(0, "#b67a45"); wg.addColorStop(1, "#5e3a1e");
      boardPath(cx, y0, bw, hh, 1);
      g.fillStyle = wg; g.fill();
      g.save(); g.clip();
      g.strokeStyle = "rgba(60,30,12,.35)"; g.lineWidth = 1;
      for (let i = -3; i <= 3; i++) {
        g.beginPath(); g.moveTo(cx + i * bw * 0.07, y0); g.bezierCurveTo(cx + i * bw * 0.11, y0 + hh * 0.4, cx + i * bw * 0.06, y0 + hh * 0.7, cx + i * bw * 0.1, y0 + hh); g.stroke();
      }
      const lg = g.createRadialGradient(cx, y0, 0, cx, y0, hh * 1.1);
      lg.addColorStop(0, "rgba(255,150,60," + (0.2 + heat * 0.25 + flash * 0.2) + ")"); lg.addColorStop(1, "rgba(255,150,60,0)");
      g.fillStyle = lg; g.fillRect(cx - bw, y0, bw * 2, hh);
      g.restore();
      boardPath(cx, y0, bw, hh, 1);
      g.strokeStyle = "rgba(255,194,71," + (0.25 + heat * 0.3) + ")"; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = "#e9bb58";
      [[-0.3, 0.62], [0.3, 0.62], [-0.18, 0.86], [0.18, 0.86], [0, 0.3]].forEach(([dx, dy]) => {
        g.beginPath(); g.arc(cx + dx * bw, y0 + hh * dy, 2.4, 0, 6.283); g.fill();
      });
      // embleem: klein vlammetje gebrand in het hout
      g.fillStyle = "rgba(50,22,8,.55)";
      g.beginPath(); g.moveTo(cx, y0 + hh * 0.42); g.quadraticCurveTo(cx + hh * 0.12, y0 + hh * 0.58, cx, y0 + hh * 0.7);
      g.quadraticCurveTo(cx - hh * 0.12, y0 + hh * 0.58, cx, y0 + hh * 0.42); g.fill();
      g.restore();
    }

    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (!L || !W) layout();
      const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
      lastFrame = now;
      const t = phase === "play" ? now - t0 : pausedT;
      if (phase === "play") {
        // klikspoor: vooruit ingepland op de audioklok (via `when`), zodat de tik niet met de framerate jittert
        const pt = performance.now() - t0;
        while ((sched + 1) * beatMs - pt <= 120 && sched + 1 <= lastNote.beat) {
          sched++;
          const bt = sched * beatMs;
          if (bt - pt > -40) beep(sched % 4 === LEAD % 4 ? 1320 : 880, 0.025, "square", sched % 4 === LEAD % 4 ? 0.05 : 0.03, Math.max(0, (bt - pt) / 1000));
        }
        // beeld: de doelring pulseert op de tel
        const b = Math.floor(t / beatMs);
        if (b > lastBeat && t >= 0) { lastBeat = b; if (b <= lastNote.beat) pulse = 1; }
        while (next < notes.length && (notes[next].done || t - notes[next].t > c.bad)) {
          if (!notes[next].done) miss(notes[next]);
          next++;
        }
        barFill.style.width = Math.min(100, (t / lastNote.t) * 100) + "%";
        if (next >= notes.length && t > lastNote.t + c.bad + 600) finish();
      }
      // animaties uitdempen
      pulse *= Math.pow(0.02, dt); flare *= Math.pow(0.08, dt); squish *= Math.pow(0.004, dt);
      shake *= Math.pow(0.002, dt); flash *= Math.pow(0.05, dt);
      if (phase === "play") heat += (0.45 - heat) * dt * 0.08;
      rings.forEach((q) => { q.life += dt * 2.2; });
      for (let i = rings.length - 1; i >= 0; i--) if (rings[i].life >= 1) rings.splice(i, 1);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.kind === "spark") { p.vy += 90 * dt; p.vx *= Math.pow(0.3, dt); } else if (p.kind === "smoke") { p.vy -= 20 * dt; }
        if (p.life >= p.max) parts.splice(i, 1);
      }
      if (phase === "result" && Math.random() < 0.08) spark(L.cx + (Math.random() - 0.5) * L.R, L.cy - L.R, 1, 120, "spark");
      drawScene(now, t);
      // Achter de (geblurde) uitslag is een stilstaand beeld genoeg: scheelt accu tijdens het wachten.
      if (phase === "result" && now - endAt > 1600) { cancelAnimationFrame(raf); raf = 0; }
    }

    // Spel (her)starten op songtijd `from` (ms). Tellen vóór `from` zijn al geweest.
    function startAt(from) {
      t0 = performance.now() - from;
      lastBeat = sched = Math.ceil(from / beatMs) - 1;
      phase = "play";
      if (typeof document !== "undefined" && document.hidden) pause();
    }
    function pause() {
      if (phase !== "play") return;
      pausedT = performance.now() - t0;
      phase = "pause";
    }
    function resume() {
      if (phase !== "pause") return;
      phase = "resume";
      pausedT = Math.max(0, pausedT - 2 * beatMs); // twee tellen aanloop; al beoordeelde noten blijven beoordeeld
      const id = ++runId;
      countdown({ go: "VERDER!" }).then(() => { if (!dead && id === runId && phase === "resume") startAt(pausedT); });
    }
    // Aftellen via de runner; geluid stopt zodra de minigame weg is.
    function countdown(o) {
      const quiet = { beep: (...a) => { if (!dead) beep(...a); } };
      const opts = Object.assign({}, o, { sfx: quiet });
      return ctx.countdown ? ctx.countdown(play, opts) : M.countdown(play, opts);
    }

    function result() { return { hits, perfect, misses, stray, total: notes.length, combo: best }; }

    function finish() {
      if (phase !== "play") return;
      phase = "result";
      endAt = performance.now();
      const r = result();
      const acc = accuracy(r) || 0;
      if (acc >= 0.75) { flash = 1; try { sfx.fanfare && sfx.fanfare(); } catch (e) { /* stil */ } }
      hint.style.opacity = "0";
      const res = h("div", "bb-scr bb-res");
      res.appendChild(h("div", "bb-kicker", "Klaar!"));
      res.appendChild(h("div", "bb-big bb-disp", Math.round(acc * 100) + "%"));
      res.appendChild(h("div", "bb-rank", RANKS.find((x) => acc >= x[0])[1]));
      const st = h("div", "bb-stats");
      [[perfect, "Perfect"], [hits - perfect, "Goed"], [misses, "Mis"]].forEach(([n, lbl]) => {
        const s = h("div", "bb-stat"); s.appendChild(h("b", null, String(n))); s.appendChild(h("span", null, lbl)); st.appendChild(s);
      });
      res.appendChild(st);
      res.appendChild(h("div", "bb-sub", "Beste combo " + best + (stray ? " · " + stray + "× in de lucht geblazen" : "")));
      const w = h("div", "bb-wait"); w.appendChild(h("i")); w.appendChild(document.createTextNode("Klaar! Wachten op de rest…"));
      res.appendChild(w);
      play.appendChild(res);
      play.classList.remove("bb-play");
      if (typeof ctx.done === "function") ctx.done(r);
    }

    startBtn.addEventListener("click", () => {
      if (phase !== "howto") return;
      phase = "count";
      beep(1, 0.001, "sine", 0.0001); // audio ontgrendelen binnen het gebaar
      how.remove();
      play.style.display = "";
      layout();
      raf = requestAnimationFrame(frame);
      countdown().then(() => { if (!dead && phase === "count") startAt(0); });
    });

    // Testhaakje (alleen voor Playwright): leesbare speltoestand, geen globale variabele.
    Object.defineProperty(root, "_bb", { value: { get phase() { return phase; }, get t() { return phase === "play" ? performance.now() - t0 : null; },
      get t0() { return t0; },
      notes, cfg: c, lag: INPUT_LAG, result }, enumerable: false });

    return {
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        timers.forEach(clearTimeout); timers.clear();
        if (ro) ro.disconnect();
        play.removeEventListener("pointerdown", onDown);
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("visibilitychange", onVis);
        root.remove();
      },
    };
  }

  const def = {
    id: "blaasbalg", title: "Blaasbalg", icon: "🌬️", kind: "local", duration: 25,
    howto: HOWTO,
    mount, score, bot, pattern, accuracy, classify, CFG,
  };
  M.register(def);
  if (typeof module === "object" && module.exports) module.exports = def;
})();
