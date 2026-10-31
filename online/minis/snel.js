// Minigame "snel" — lokaal reactieduel tegen De Vorst (SPEC-3 §5, hoofdstuk "Het aanbod van de Vorst").
// Donker huisje, de kachel smeult, de vorst ademt langs de randen. "Wacht op de knal…" — en dan KNAL: het blok in de kachel
// barst open. Tik zo snel je kan. Te vroeg = af. Drie rondes; de Vorst tikt altijd even snel (zijn spookbalk).
// Op moeilijkheid 2–3 doet het vuur alsof (kraakjes, vonkjes, een plofje) om je te laten gokken.
(function () {
  "use strict";
  const M = typeof DVMini !== "undefined" ? DVMini : require("./core.js");

  const ROUNDS = 3;
  const SLOW = 1600; // ms na de knal: daarna ben je "bevroren"
  const GUESS = 100; // ms: sneller dan dit is geen reactie maar gokken → telt als te vroeg
  const MAX_MS = 5000;
  // Per moeilijkheid: reactietijd van de Vorst, wachttijd (ms), en schijnbewegingen van het vuur.
  const CFG = {
    1: { name: "Rustig", vorst: 350, min: 2000, max: 5000, fakeP: 0, maxFakes: 0, kinds: [] },
    2: { name: "Scherp", vorst: 300, min: 2000, max: 6000, fakeP: 0.7, maxFakes: 1, kinds: ["kraak", "plof"] },
    3: { name: "IJskoud", vorst: 260, min: 2000, max: 6000, fakeP: 1, maxFakes: 2, kinds: ["kraak", "plof", "vonk"] },
  };

  const dl = (d) => Math.max(1, Math.min(3, Math.round(d) || 1));
  const cfg = (d) => CFG[dl(d)];

  // Geseed rondeplan: wanneer knalt het blok en wanneer doet het vuur alsof. Zelfde seed = zelfde duel.
  function plan(seed, d) {
    const c = cfg(d), r = M.rng((seed >>> 0) ^ 0x5e1f);
    return Array.from({ length: ROUNDS }, () => {
      const delay = Math.round(c.min + r() * (c.max - c.min));
      const fakes = [];
      if (c.maxFakes && r() < c.fakeP) {
        const n = 1 + Math.floor(r() * c.maxFakes);
        for (let i = 0; i < n; i++) {
          const t = Math.round(700 + r() * Math.max(0, delay - 1300));
          fakes.push({ t, kind: c.kinds[Math.floor(r() * c.kinds.length)] });
        }
        fakes.sort((a, b) => a.t - b.t);
      }
      return { delay, fakes };
    });
  }

  // ---------- Scoren ----------
  const ms = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_MS ? Math.round(v) : null);
  function valid(r) {
    if (!r || typeof r !== "object" || !Array.isArray(r.times)) return null;
    return { times: Array.from({ length: ROUNDS }, (_, i) => ms(r.times[i])) };
  }
  const avgOf = (times) => { const t = times.filter((x) => x !== null); return t.length ? Math.round(t.reduce((s, x) => s + x, 0) / t.length) : null; };
  const beats = (t, d) => t !== null && t < cfg(d).vorst;

  // Een ronde is voor het vuur als minstens de helft van de spelers sneller was dan de Vorst.
  function roundWins(rows, d) {
    const need = Math.max(1, Math.ceil(rows.length / 2));
    let wins = 0;
    for (let i = 0; i < ROUNDS; i++) if (rows.filter((x) => x.v && beats(x.v.times[i], d)).length >= need) wins++;
    return wins;
  }

  function score(results, info) {
    results = results && typeof results === "object" ? results : {};
    info = info || {};
    const d = dl(info.difficulty), V = cfg(d).vorst;
    const players = Array.isArray(info.players) && info.players.length ? info.players : Object.keys(results).map((pid) => ({ pid, name: pid }));
    const nameOf = (p) => (p && p.name) || "Iemand";
    const rows = players.map((p) => { const v = valid(results[p.pid]); return { p, v, avg: v ? avgOf(v.times) : null }; });
    const played = rows.filter((x) => x.v);
    const anyTime = played.some((x) => x.avg !== null);
    const wins = rows.length ? roundWins(rows, d) : 0;
    const sweep = wins === ROUNDS && played.length === rows.length && played.every((x) => x.v.times.every((t) => beats(t, d)));
    const logs = M.clampLogs(!anyTime ? -2 : sweep ? 4 : wins === 0 ? -1 : wins);
    const head = {
      4: "Bliksemsnel! Elke tik was sneller dan de Vorst. Hij kijkt naar zijn eigen handen.",
      3: "Drie keer sneller dan de Vorst. Gloei knettert van trots.",
      2: "Twee van de drie voor het vuur. De Vorst trekt een wenkbrauw op. Van ijs.",
      1: "Eén ronde gepakt. De Vorst knikt beleefd. Te beleefd.",
      "-1": "De Vorst was elke ronde sneller. Het raam bevriest een stukje verder.",
      "-2": "Geen enkele geldige tik. De Vorst hoefde niet eens zijn hand op te tillen.",
    }[logs];
    const lines = [head];
    let mvp = null;
    const ranked = played.filter((x) => x.avg !== null).sort((a, b) => a.avg - b.avg);
    if (ranked.length) {
      const best = ranked[0];
      mvp = best.p.pid;
      if (best.avg < V) lines.push(nameOf(best.p) + " is sneller dan de Vorst: gemiddeld " + best.avg + " ms tegen zijn " + V + ".");
      else lines.push(nameOf(best.p) + " was het snelst met gemiddeld " + best.avg + " ms. De Vorst doet " + V + ".");
    }
    let fast = null;
    played.forEach((x) => x.v.times.forEach((t) => { if (t !== null && (!fast || t < fast.t)) fast = { p: x.p, t }; }));
    if (fast && played.length >= 2 && fast.t < V - 40) lines.push("Snelste tik van de nacht: " + nameOf(fast.p) + ", " + fast.t + " ms.");
    played.forEach((x) => {
      const n = x.v.times.filter((t) => t === null).length;
      if (n >= 2) lines.push(nameOf(x.p) + (n === ROUNDS ? " tikte geen enkele keer goed. De Vorst grinnikt." : " was " + n + "× te vroeg of te laat. De Vorst grinnikt."));
    });
    const absent = rows.filter((x) => !x.v).map((x) => nameOf(x.p));
    if (absent.length) {
      const who = absent.length === 1 ? absent[0] : absent.slice(0, -1).join(", ") + " en " + absent[absent.length - 1];
      const line = who + (absent.length === 1 ? " zat" : " zaten") + " te dutten bij de kachel. De Vorst rekent dat als winst.";
      lines.push(line.length <= 140 ? line : absent.length + " spelers zaten te dutten bij de kachel. De Vorst rekent dat als winst.");
    }
    const perPlayer = {};
    rows.forEach((x) => {
      if (!x.v) { perPlayer[x.p.pid] = "—"; return; }
      const won = x.v.times.filter((t) => beats(t, d)).length;
      perPlayer[x.p.pid] = (x.avg !== null ? "gem. " + x.avg + " ms" : "geen geldige tik") + " · " + won + "/" + ROUNDS + " sneller dan de Vorst";
    });
    return { logs, lines, mvp, perPlayer };
  }

  // Geloofwaardige bot: eigen reflex (±), soms te vroeg (meer bij schijnbewegingen), heel soms te laat.
  function bot(rng, difficulty) {
    const d = dl(difficulty);
    const base = 250 + rng() * 85, early = [0.05, 0.09, 0.14][d - 1];
    const times = [];
    for (let i = 0; i < ROUNDS; i++) {
      const a = rng(), b = rng(), c = rng();
      if (a < early || a > 0.985) { times.push(null); continue; }
      const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, b))) * Math.cos(2 * Math.PI * c); // normaalverdeeld
      times.push(Math.round(Math.max(150, Math.min(1200, base + z * 38 + i * 4))));
    }
    return { times };
  }

  // ---------- UI ----------
  const CSS = `
.sn{position:relative;width:100%;height:100%;min-height:480px;overflow:hidden;color:var(--glow,#ffe7b8);background:var(--soot,#0b0705);
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.sn *{box-sizing:border-box}
.sn-cv{position:absolute;inset:0;width:100%;height:100%;display:block}
.sn-disp{font-family:"Unbounded",system-ui,sans-serif;font-weight:900;letter-spacing:-.02em}
.sn-scr{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:4;
  padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom));text-align:center}
.sn-howto{gap:13px;justify-content:flex-end;padding-bottom:max(34px,env(safe-area-inset-bottom));
  background:linear-gradient(180deg,rgba(11,7,5,0) 22%,rgba(11,7,5,.86) 55%,rgba(11,7,5,.97))}
.sn-kicker{font:800 12px/1.2 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#9fd3ff}
.sn-title{font-size:clamp(40px,13vw,58px);line-height:1;margin:0;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 45%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 18px rgba(255,106,26,.45))}
.sn-text{font-size:17px;line-height:1.4;max-width:330px;margin:0;color:var(--glow,#ffe7b8)}
.sn-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;max-width:340px}
.sn-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 11px;border-radius:99px;font-size:13px;color:var(--ash,#b8a99a);
  background:rgba(255,231,184,.06);border:1px solid rgba(255,194,71,.18)}
.sn-chip b{color:var(--glow,#ffe7b8)}
.sn-chip.ice{border-color:rgba(159,211,255,.3);background:rgba(90,169,255,.08)}
.sn-chip.ice b{color:#cfe8ff}
.sn-btn{appearance:none;border:0;cursor:pointer;margin-top:6px;min-width:200px;min-height:58px;padding:0 34px;border-radius:99px;
  font:900 19px/1 "Unbounded",system-ui,sans-serif;color:#2a0d02;letter-spacing:.02em;touch-action:manipulation;
  background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a) 70%,var(--blaze,#e8401c));
  box-shadow:0 0 0 1px rgba(255,231,184,.35) inset,0 10px 30px rgba(232,64,28,.45),0 0 60px rgba(255,106,26,.25)}
.sn-btn:active{transform:scale(.97)}
.sn-hud{position:absolute;left:0;right:0;top:0;z-index:3;pointer-events:none;padding:max(12px,env(safe-area-inset-top)) 14px 0;
  display:flex;align-items:center;justify-content:space-between;gap:8px;transition:opacity .4s}
.sn-pips{display:flex;gap:6px}
.sn-pip{min-width:50px;height:30px;padding:0 9px;border-radius:99px;display:flex;align-items:center;justify-content:center;
  font:800 12px/1 "Unbounded",system-ui,sans-serif;color:var(--ash,#b8a99a);background:rgba(23,16,11,.72);
  border:1px solid rgba(255,231,184,.12);transition:all .3s}
.sn-pip.cur{color:var(--glow,#ffe7b8);border-color:rgba(255,194,71,.55);box-shadow:0 0 14px rgba(255,106,26,.35)}
.sn-pip.win{color:#2a0d02;background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a));border-color:transparent;box-shadow:0 0 14px rgba(255,106,26,.5)}
.sn-pip.lose{color:#d7ecff;background:rgba(40,70,110,.55);border-color:rgba(159,211,255,.45)}
.sn-pip.bad{color:#9fd3ff;background:rgba(10,20,34,.75);border-color:rgba(159,211,255,.3)}
.sn-vorst{display:flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:99px;white-space:nowrap;
  font:800 12px/1 system-ui,sans-serif;color:#cfe8ff;background:rgba(14,28,46,.7);border:1px solid rgba(159,211,255,.35);
  box-shadow:0 0 16px rgba(90,169,255,.18)}
.sn-vorst b{font:900 12px/1 "Unbounded",system-ui,sans-serif}
.sn-msg{position:absolute;left:0;right:0;z-index:3;text-align:center;pointer-events:none;padding:0 18px;transition:opacity .35s,transform .35s}
.sn-msg .m1{font:900 clamp(21px,6.4vw,27px)/1.1 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8);text-shadow:0 2px 14px #000}
.sn-msg .m1.wait{animation:sn-breathe 2.4s ease-in-out infinite}
.sn-msg .m2{margin-top:8px;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:var(--ash,#b8a99a)}
.sn-msg.hide{opacity:0;transform:translateY(10px)}
@keyframes sn-breathe{0%,100%{opacity:.55;letter-spacing:0}50%{opacity:1;letter-spacing:.02em}}
.sn-fx{position:absolute;inset:0;z-index:3;overflow:hidden;pointer-events:none}
.sn-bang{position:absolute;left:0;right:0;z-index:3;text-align:center;pointer-events:none;opacity:0}
.sn-bang b{display:block;font:900 clamp(64px,22vw,96px)/1 "Unbounded",system-ui,sans-serif;color:#fff6d8;
  text-shadow:0 0 30px rgba(255,194,71,.95),0 0 70px rgba(255,106,26,.9),0 5px 0 #8a2a04}
.sn-bang span{display:inline-block;margin-top:10px;padding:7px 14px 7px 18px;border-radius:99px;font:900 15px/1 "Unbounded",system-ui,sans-serif;letter-spacing:.3em;
  color:#2a0d02;background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a));box-shadow:0 0 24px rgba(255,106,26,.8)}
.sn-bang.early span{color:#0a1a2c;background:linear-gradient(180deg,#e6f4ff,#9fd3ff);box-shadow:0 0 24px rgba(90,169,255,.7)}
.sn-bang.on{opacity:1;animation:sn-knal .32s cubic-bezier(.2,1.6,.4,1) both}
.sn-bang.early b{color:#e6f4ff;font-size:clamp(34px,11.5vw,62px);text-shadow:0 0 26px rgba(120,190,255,.95),0 4px 0 #13304f}
.sn-bang.hit{animation:sn-out .42s ease-in forwards}
@keyframes sn-out{0%{transform:scale(1);opacity:1}100%{transform:scale(1.15);opacity:0}}
@keyframes sn-knal{0%{transform:scale(1.9);opacity:0}100%{transform:scale(1);opacity:1}}
.sn-card{position:absolute;left:50%;bottom:max(16px,env(safe-area-inset-bottom));z-index:3;width:min(360px,calc(100% - 28px));
  transform:translate(-50%,18px);opacity:0;pointer-events:none;transition:opacity .3s,transform .4s cubic-bezier(.2,1.2,.4,1);
  padding:14px 16px 15px;border-radius:22px;background:linear-gradient(180deg,rgba(35,22,14,.88),rgba(16,11,8,.92));
  border:1px solid rgba(255,194,71,.22);box-shadow:inset 0 1px 0 rgba(255,231,184,.1),0 18px 40px rgba(0,0,0,.55);
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.sn-card.on{opacity:1;transform:translate(-50%,0)}
.sn-card.live{transition:opacity .12s,transform .18s ease-out}
.sn-card.live .sn-trk i{transition:none}
.sn-row.hit .sn-trk i.gh{background:linear-gradient(90deg,#5aa9ff,#cfe8ff);box-shadow:0 0 16px rgba(120,190,255,.9)}
.sn-card.cold{border-color:rgba(159,211,255,.35);background:linear-gradient(180deg,rgba(18,28,42,.9),rgba(9,13,20,.94))}
.sn-ctop{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.sn-crd{font:800 11px/1 system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--ash,#b8a99a)}
.sn-cms{font:900 34px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);text-shadow:0 0 16px rgba(255,106,26,.5)}
.sn-cms small{font-size:14px;margin-left:3px;color:var(--ash,#b8a99a);text-shadow:none}
.sn-card.cold .sn-cms{color:#d7ecff;text-shadow:0 0 16px rgba(90,169,255,.5)}
.sn-cvs{margin:6px 0 10px;font-size:15px;font-weight:700;color:var(--glow,#ffe7b8)}
.sn-row{display:grid;grid-template-columns:52px 1fr 52px;align-items:center;gap:8px;margin-top:7px;font-size:12px;color:var(--ash,#b8a99a)}
.sn-row b{font:800 12px/1 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8);text-align:right}
.sn-trk{position:relative;height:12px;border-radius:9px;background:rgba(255,231,184,.07);overflow:hidden}
.sn-trk i{position:absolute;left:0;top:0;bottom:0;border-radius:9px;width:0;transition:width .55s cubic-bezier(.2,.9,.3,1)}
.sn-trk i.me{background:linear-gradient(90deg,var(--blaze,#e8401c),var(--ember,#ff6a1a) 60%,var(--flame,#ffc247));box-shadow:0 0 12px rgba(255,106,26,.7)}
.sn-trk i.gh{background:repeating-linear-gradient(135deg,rgba(159,211,255,.5) 0 6px,rgba(159,211,255,.22) 6px 12px);
  box-shadow:0 0 12px rgba(90,169,255,.4);outline:1px solid rgba(207,232,255,.5);outline-offset:-1px}
.sn-row.vr{color:#9fd3ff}
.sn-row.vr b{color:#cfe8ff}
.sn .mini-countdown{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font:900 clamp(64px,22vw,96px)/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);text-shadow:0 0 30px rgba(255,106,26,.9),0 4px 0 #6a1c04;
  background:radial-gradient(circle at 50% 45%,rgba(6,7,11,.1),rgba(6,7,11,.6))}
.sn .mini-countdown.pop{animation:sn-cd .7s ease-out}
@keyframes sn-cd{0%{transform:scale(1.6);opacity:0}25%{transform:scale(1);opacity:1}100%{transform:scale(.92);opacity:.85}}
.sn-res{gap:9px;background:radial-gradient(100% 62% at 50% 38%,rgba(48,22,12,.84),rgba(8,7,9,.92) 72%,rgba(8,7,9,.6));
  -webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px);animation:sn-fade .5s ease-out both;overflow-y:auto;justify-content:safe center}
.sn-res.cold{background:radial-gradient(100% 62% at 50% 38%,rgba(16,30,48,.86),rgba(6,8,12,.93) 72%,rgba(6,8,12,.6))}
@keyframes sn-fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.sn-big{font-size:clamp(66px,22vw,100px);line-height:.95;margin:2px 0 0;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 50%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 22px rgba(255,106,26,.5))}
.sn-res.cold .sn-big{background:linear-gradient(180deg,#ffffff,#cfe8ff 50%,#5aa9ff);-webkit-background-clip:text;background-clip:text;filter:drop-shadow(0 0 22px rgba(90,169,255,.5))}
.sn-big small{font-size:.42em;letter-spacing:0}
.sn-unit{font:800 12px/1.3 system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--ash,#b8a99a)}
.sn-rank{font:900 18px/1.2 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8);margin-top:4px}
.sn-board{width:100%;max-width:340px;margin-top:6px;padding:12px 14px 14px;border-radius:18px;text-align:left;
  background:linear-gradient(180deg,rgba(255,231,184,.07),rgba(255,231,184,.025));border:1px solid rgba(255,194,71,.18)}
.sn-rr{display:grid;grid-template-columns:18px 1fr 74px;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--ash,#b8a99a)}
.sn-rr:first-child{margin-top:0}
.sn-rr b{font:800 12px/1 "Unbounded",system-ui,sans-serif;text-align:right;color:var(--glow,#ffe7b8);white-space:nowrap}
.sn-rr.lost b{color:#9fd3ff}
.sn-rr .sn-trk{height:14px;overflow:visible}
.sn-rr .sn-trk em{position:absolute;top:-4px;bottom:-4px;width:2px;margin-left:-1px;background:#cfe8ff;box-shadow:0 0 8px #5aa9ff;border-radius:2px}
.sn-rr.lost .sn-trk i.me{background:linear-gradient(90deg,#2b4a6e,#5aa9ff);box-shadow:none;opacity:.8}
.sn-leg{display:flex;justify-content:space-between;margin-top:10px;font-size:11px;letter-spacing:.08em;color:var(--ash,#b8a99a)}
.sn-leg span:last-child{color:#9fd3ff}
.sn-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;max-width:340px}
.sn-stat{padding:11px 6px;border-radius:16px;background:linear-gradient(180deg,rgba(255,231,184,.08),rgba(255,231,184,.03));
  border:1px solid rgba(255,194,71,.18);box-shadow:inset 0 1px 0 rgba(255,231,184,.08)}
.sn-stat b{display:block;font:900 20px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247)}
.sn-stat:nth-child(2) b{color:var(--ember,#ff6a1a)}
.sn-stat:nth-child(3) b{color:#9fc7ff}
.sn-stat span{display:block;margin-top:6px;font-size:11px;color:var(--ash,#b8a99a);letter-spacing:.06em;text-transform:uppercase}
.sn-wait{margin-top:8px;display:inline-flex;align-items:center;gap:10px;font-size:15px;color:var(--glow,#ffe7b8);
  padding:10px 16px;border-radius:99px;background:rgba(23,16,11,.7);border:1px solid rgba(255,231,184,.12)}
.sn-wait i{width:10px;height:10px;border-radius:50%;background:var(--ember,#ff6a1a);box-shadow:0 0 12px var(--ember,#ff6a1a);animation:sn-dot 1s ease-in-out infinite}
@keyframes sn-dot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.7);opacity:.6}}
@media (max-width:374px){.sn-vl{display:none}.sn-pip{min-width:46px;padding:0 7px}}
@media (max-height:640px){.sn-board{padding:9px 12px 11px}.sn-big{font-size:58px}.sn-howto{gap:9px}}
@media (max-height:520px){.sn{min-height:0}}
@media (prefers-reduced-motion:reduce){.sn-wait i,.sn-msg .m1.wait,.sn .mini-countdown.pop,.sn-res{animation:none}.sn-bang.on{animation:none}.sn-bang.hit{opacity:0}
  .sn-card,.sn-card.live{transition:opacity .2s}}
`;

  function injectCss() {
    if (document.getElementById("mini-snel-css")) return;
    const s = document.createElement("style");
    s.id = "mini-snel-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const TAU = Math.PI * 2;
  const RANKS = [[3, "Vorstbreker"], [2, "Snelle vingers"], [1, "Lauwe handjes"], [0, "Bevroren vingers"]];
  const WAITS = ["Wacht op de knal…", "Stil… wacht op de knal…", "Nog niet… wacht op de knal…"];

  function mount(el, ctx) {
    injectCss();
    const d = dl(ctx.difficulty), c = CFG[d], V = c.vorst;
    const rounds = plan(ctx.seed >>> 0, d);
    const sfx = ctx.sfx || {};
    const beep = (...a) => { try { sfx.beep && sfx.beep(...a); } catch (e) { /* geen geluid */ } };
    const buzz = (p) => { try { sfx.buzz && sfx.buzz(p); } catch (e) { /* geen tril */ } };
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    const root = h("div", "sn");
    el.appendChild(root);
    const cv = h("canvas", "sn-cv");
    root.appendChild(cv);
    const g = cv.getContext("2d");
    let dead = false, raf = 0, ro = null, phase = "howto";
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms); timers.add(id); };

    // speltoestand
    let round = 0, waitStart = 0, ignoreUntil = 0, fakeIdx = 0, bangTs = 0;
    const times = Array(ROUNDS).fill(null), tags = Array(ROUNDS).fill("");
    // beeldtoestand
    let fireK = 0.42, flare = 0, flash = 0, shake = 0, logJump = 0, logTwitch = 0, crack = 0, frostBoost = 0, frostK = 0.6, eyesK = 0.6, cold = 0;
    const parts = [];

    // --- HUD ---
    const hud = h("div", "sn-hud");
    const pips = h("div", "sn-pips");
    const pipEls = Array.from({ length: ROUNDS }, (_, i) => { const p = h("div", "sn-pip", String(i + 1)); pips.appendChild(p); return p; });
    const vchip = h("div", "sn-vorst");
    vchip.append(document.createTextNode("❄"), h("span", "sn-vl", "De Vorst"), h("b", null, V + " ms"));
    hud.append(pips, vchip);
    hud.style.opacity = "0";
    root.appendChild(hud);
    const msg = h("div", "sn-msg hide");
    const m1 = h("div", "m1"), m2 = h("div", "m2");
    msg.append(m1, m2);
    root.appendChild(msg);
    const bangEl = h("div", "sn-bang");
    const bangB = h("b"), bangS = h("span");
    bangEl.append(bangB, bangS);
    const fx = h("div", "sn-fx"); // knipt de schaal-animaties af binnen het speelveld
    fx.appendChild(bangEl);
    root.appendChild(fx);
    const card = h("div", "sn-card");
    root.appendChild(card);

    // --- Howto ---
    const how = h("div", "sn-scr sn-howto");
    how.appendChild(h("div", "sn-kicker", "Duel met de Vorst · " + c.name));
    how.appendChild(h("h2", "sn-title sn-disp", "Snel"));
    how.appendChild(h("p", "sn-text", "Wacht tot het blok in de kachel knalt en tik dan zo snel je kan, ergens op het scherm: te vroeg is af."));
    const leg = h("div", "sn-legend");
    const chip = (cls, txt, bold) => { const x = h("span", "sn-chip" + (cls ? " " + cls : "")); x.appendChild(document.createTextNode(txt + " ")); if (bold) x.appendChild(h("b", null, bold)); leg.appendChild(x); };
    chip("ice", "De Vorst tikt in", V + "\u00a0ms");
    chip("", "3 rondes · te vroeg =", "kwijt");
    if (d >= 2) chip("", "het vuur", d >= 3 ? "liegt vaak" : "doet soms alsof");
    how.appendChild(leg);
    const startBtn = h("button", "sn-btn", "Start");
    startBtn.type = "button";
    how.appendChild(startBtn);
    root.appendChild(how);

    // --- Decor (geseed) ---
    const drng = M.rng((ctx.seed >>> 0) ^ 0xf205);
    const tongues = Array.from({ length: 9 }, (_, i) => ({ u: (i + 0.5) / 9 + (drng() - 0.5) * 0.06, w: 0.1 + drng() * 0.07, h: 0.55 + drng() * 0.5, a: 2 + drng() * 3, b: 3 + drng() * 4, p: drng() * TAU, q: drng() * TAU }));
    const coals = Array.from({ length: 34 }, () => ({ u: drng(), v: drng(), r: 0.035 + drng() * 0.05, p: drng() * TAU, s: 0.8 + drng() * 2 }));
    const planks = Array.from({ length: 9 }, () => ({ w: 0.09 + drng() * 0.06, t: drng() }));

    // --- Layout ---
    let W = 0, H = 0, dpr = 1, L = null, bg = null, frost = null, logImg = null, fcv = null, fg = null, glowImg = null;
    // gloeiend kooltje als sprite (scheelt tientallen gradients per frame)
    const coalImg = document.createElement("canvas");
    coalImg.width = coalImg.height = 48;
    (() => {
      const x = coalImg.getContext("2d"), cg = x.createRadialGradient(24, 24, 0, 24, 24, 24);
      cg.addColorStop(0, "rgba(255,214,120,1)"); cg.addColorStop(0.25, "rgba(255,150,50,.9)");
      cg.addColorStop(0.55, "rgba(232,64,28,.5)"); cg.addColorStop(1, "rgba(120,20,5,0)");
      x.fillStyle = cg; x.fillRect(0, 0, 48, 48);
    })();
    const FS = 3; // schaal van het vlammendoek
    function layout() {
      const r = root.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(2, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const cx = W / 2, half = Math.min(W * 0.4, 175, Math.max(70, (H - 232) / 2.1)); // ook liggend past de kachel
      const top = Math.max(112, H * 0.17), bot = Math.max(top + half * 2.1, H * 0.655);
      const bh = bot - top;
      const wTop = top + bh * 0.24, wBot = top + bh * 0.72;
      L = { cx, half, top, bot, bh, wTop, wBot, wht: half * 0.66, whb: half * 0.6, sag: half * 0.07, capR: half * 0.17,
        eyeY: Math.max(66, top - Math.min(52, H * 0.065)) };
      L.wh = wBot - wTop;
      L.logC = { x: cx - L.wht * 0.04, y: wTop + L.wh * 0.47 };
      L.logLen = L.wht * 1.8; L.logTh = L.wh * 0.2; L.logA = 0.4;
      L.railY = wBot - L.wh * 0.2;
      msg.style.top = Math.round(bot + Math.min(64, H * 0.075)) + "px";
      bangEl.style.top = Math.round(wTop + L.wh * 0.5 - 56) + "px";
      bg = renderBg(); frost = renderFrost(); logImg = renderLog(); glowImg = renderGlow();
      // vlammen op lage resolutie tekenen en opgeschaald neerzetten = zachte, gloeiende randen
      const fx0 = L.cx - L.wht - 4, fy0 = L.wTop - 4, fw = L.wht * 2 + 8, fh = L.wh + L.sag * 2 + 8;
      fcv = document.createElement("canvas"); fcv.width = Math.ceil(fw / FS); fcv.height = Math.ceil(fh / FS);
      fg = fcv.getContext("2d"); fg.scale(1 / FS, 1 / FS); fg.translate(-fx0, -fy0);
      L.fBox = [fx0, fy0, fcv.width * FS, fcv.height * FS];
    }
    if (typeof ResizeObserver === "function") { ro = new ResizeObserver(() => layout()); ro.observe(root); }
    const off = (w, hh) => { const o = document.createElement("canvas"); o.width = Math.max(1, Math.round(w * dpr)); o.height = Math.max(1, Math.round(hh * dpr)); const x = o.getContext("2d"); x.scale(dpr, dpr); return [o, x]; };

    function windowPath(x, inset) {
      const { cx, wTop, wBot, wht, whb, sag } = L, k = inset || 0;
      x.beginPath();
      x.moveTo(cx - wht + k, wTop + k);
      x.quadraticCurveTo(cx, wTop + 2 * sag + k, cx + wht - k, wTop + k);
      x.lineTo(cx + whb - k, wBot - k);
      x.quadraticCurveTo(cx, wBot + 2 * sag - k, cx - whb + k, wBot - k);
      x.closePath();
    }

    // Statisch: planken aan de muur, vloerplaat, gietijzeren kachel (cilinder) met kap en voet.
    function renderBg() {
      const [o, x] = off(W, H), drng = M.rng((ctx.seed >>> 0) ^ 0xb6); // eigen rng: zelfde decor na elke resize
      const { cx, half, top, bot, capR } = L;
      x.fillStyle = "#070504"; x.fillRect(0, 0, W, H);
      let px = 0, i = 0;
      while (px < W) {
        const p = planks[i++ % planks.length], pw = p.w * Math.max(W, 360);
        const pg = x.createLinearGradient(px, 0, px + pw, 0);
        const tone = 10 + p.t * 7;
        pg.addColorStop(0, "rgb(" + (tone + 3) + "," + (tone - 1) + "," + (tone - 4) + ")");
        pg.addColorStop(1, "rgb(" + tone + "," + (tone - 3) + "," + (tone - 6) + ")");
        x.fillStyle = pg; x.fillRect(px, 0, pw, bot);
        x.fillStyle = "rgba(0,0,0,.6)"; x.fillRect(px + pw - 1.5, 0, 1.5, bot);
        px += pw;
      }
      // vloer + metalen vloerplaat (zoals bij de echte kachel)
      const fl = x.createLinearGradient(0, bot - 20, 0, H);
      fl.addColorStop(0, "#0d0907"); fl.addColorStop(1, "#050403");
      x.fillStyle = fl; x.fillRect(0, bot - 20, W, H - bot + 20);
      x.fillStyle = "#15110e";
      x.beginPath(); x.moveTo(cx - half * 1.55, bot + half * 0.5); x.lineTo(cx + half * 1.25, bot + half * 0.42);
      x.lineTo(cx + half * 1.05, bot - half * 0.12); x.lineTo(cx - half * 1.2, bot - half * 0.08); x.closePath(); x.fill();
      x.fillStyle = "rgba(184,169,154,.07)";
      for (let k = 0; k < 90; k++) x.fillRect(cx - half * 1.3 + drng() * half * 2.4, bot - half * 0.08 + drng() * half * 0.52, 1.3, 1.1);
      // schaduw onder de kachel
      const sh = x.createRadialGradient(cx, bot, 0, cx, bot, half * 1.2);
      sh.addColorStop(0, "rgba(0,0,0,.75)"); sh.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = sh; x.beginPath(); x.ellipse(cx, bot + 4, half * 1.2, half * 0.26, 0, 0, TAU); x.fill();
      // cilinder
      const body = x.createLinearGradient(cx - half, 0, cx + half, 0);
      body.addColorStop(0, "#060505"); body.addColorStop(0.18, "#1b1714"); body.addColorStop(0.32, "#25201b");
      body.addColorStop(0.55, "#16120f"); body.addColorStop(0.85, "#0b0908"); body.addColorStop(1, "#040303");
      x.fillStyle = body;
      x.beginPath(); x.moveTo(cx - half, top); x.lineTo(cx - half, bot); x.ellipse(cx, bot, half, capR, 0, Math.PI, 0, true); x.lineTo(cx + half, top); x.closePath(); x.fill();
      // gietijzer-korrel
      x.save(); x.beginPath(); x.rect(cx - half, top, half * 2, bot - top + capR); x.clip();
      for (let k = 0; k < 260; k++) { x.fillStyle = "rgba(255,231,184," + (0.01 + drng() * 0.025) + ")"; x.fillRect(cx - half + drng() * half * 2, top + drng() * (bot - top), 1, 1); }
      // naad + ringen
      x.strokeStyle = "rgba(0,0,0,.55)"; x.lineWidth = 2;
      [0.08, 0.86].forEach((k) => { x.beginPath(); x.ellipse(cx, top + (bot - top) * k, half, capR * 0.8, 0, 0, Math.PI); x.stroke(); });
      x.strokeStyle = "rgba(255,231,184,.05)"; x.lineWidth = 1;
      [0.08, 0.86].forEach((k) => { x.beginPath(); x.ellipse(cx, top + (bot - top) * k + 2, half, capR * 0.8, 0, 0, Math.PI); x.stroke(); });
      x.restore();
      // kap bovenop
      const cap = x.createLinearGradient(0, top - capR, 0, top + capR);
      cap.addColorStop(0, "#2a241f"); cap.addColorStop(1, "#0c0a08");
      x.fillStyle = cap; x.beginPath(); x.ellipse(cx, top, half * 1.02, capR, 0, 0, TAU); x.fill();
      x.strokeStyle = "rgba(255,231,184,.12)"; x.lineWidth = 1.2; x.beginPath(); x.ellipse(cx, top, half * 1.02, capR, 0, Math.PI, TAU); x.stroke();
      // kachelpijp
      const pw = half * 0.15, pcx = cx + half * 0.5;
      const pp = x.createLinearGradient(pcx - pw, 0, pcx + pw, 0);
      pp.addColorStop(0, "#050404"); pp.addColorStop(0.3, "#1e1a16"); pp.addColorStop(1, "#060505");
      x.fillStyle = pp; x.fillRect(pcx - pw, 0, pw * 2, top - capR * 0.2);
      x.fillStyle = "rgba(0,0,0,.5)"; x.beginPath(); x.ellipse(pcx, top - capR * 0.2, pw, pw * 0.3, 0, 0, TAU); x.fill();
      // glans langs de bolling + aangestraalde onderkant
      const spec = x.createLinearGradient(cx - half * 0.62, 0, cx - half * 0.38, 0);
      spec.addColorStop(0, "rgba(255,231,184,0)"); spec.addColorStop(0.5, "rgba(255,231,184,.05)"); spec.addColorStop(1, "rgba(255,231,184,0)");
      x.fillStyle = spec; x.fillRect(cx - half * 0.62, top + capR, half * 0.24, bot - top - capR);
      // donkere rand (statisch ingebakken)
      const vg = x.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.4, W / 2, H * 0.45, Math.max(W, H) * 0.78);
      vg.addColorStop(0, "rgba(4,3,2,0)"); vg.addColorStop(1, "rgba(4,3,2,.7)");
      x.fillStyle = vg; x.fillRect(0, 0, W, H);
      // venster-sponning (donkere rand)
      windowPath(x, -5); x.fillStyle = "#050303"; x.fill();
      return o;
    }

    // IJskristallen langs de randen + blauwe vignet; wordt met wisselende sterkte over alles heen gelegd.
    function renderFrost() {
      const [o, x] = off(W, H);
      const vg = x.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.32, W / 2, H * 0.45, Math.max(W, H) * 0.72);
      vg.addColorStop(0, "rgba(40,80,130,0)"); vg.addColorStop(0.6, "rgba(50,100,160,.16)"); vg.addColorStop(1, "rgba(120,180,240,.45)");
      x.fillStyle = vg; x.fillRect(0, 0, W, H);
      const fr = M.rng(0x1ce ^ (ctx.seed >>> 0));
      x.lineCap = "round";
      const branch = (bx, by, a, len, depth) => {
        const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
        x.lineWidth = Math.max(0.5, depth * 0.55);
        x.strokeStyle = "rgba(200,232,255," + (0.12 + depth * 0.07) + ")";
        x.beginPath(); x.moveTo(bx, by); x.lineTo(ex, ey); x.stroke();
        if (depth <= 0) return;
        const n = 3;
        for (let k = 1; k <= n; k++) {
          const sx = bx + (ex - bx) * (k / (n + 1)), sy = by + (ey - by) * (k / (n + 1)), sl = len * (0.42 - k * 0.07);
          branch(sx, sy, a + Math.PI / 3, sl, depth - 1);
          branch(sx, sy, a - Math.PI / 3, sl, depth - 1);
        }
        if (depth >= 2) branch(ex, ey, a + (fr() - 0.5) * 0.5, len * 0.6, depth - 1);
      };
      const edge = Math.min(W, H);
      for (let k = 0; k < 16; k++) {
        const side = k % 4, u = fr();
        const sx = side === 0 ? u * W : side === 1 ? W : side === 2 ? u * W : 0;
        const sy = side === 0 ? 0 : side === 1 ? u * H : side === 2 ? H : u * H;
        const a = Math.atan2(H * 0.45 - sy, W / 2 - sx) + (fr() - 0.5) * 0.9;
        branch(sx, sy, a, edge * (0.08 + fr() * 0.08), 3);
      }
      // hoekbevriezing
      [[0, 0], [W, 0], [0, H], [W, H]].forEach(([qx, qy]) => {
        const cg = x.createRadialGradient(qx, qy, 0, qx, qy, edge * 0.42);
        cg.addColorStop(0, "rgba(215,236,255,.32)"); cg.addColorStop(1, "rgba(215,236,255,0)");
        x.fillStyle = cg; x.fillRect(0, 0, W, H);
      });
      return o;
    }

    // Warm vensterlicht op muur, kachel en vloer: één zachte sprite op lage resolutie, sterkte via globalAlpha.
    function renderGlow() {
      const o = document.createElement("canvas"), sc = 0.25;
      o.width = Math.max(1, Math.round(W * sc)); o.height = Math.max(1, Math.round(H * sc));
      const x = o.getContext("2d"); x.scale(sc, sc);
      const gx = L.cx, gy = L.wTop + L.wh * 0.55;
      const gl = x.createRadialGradient(gx, gy, L.wht * 0.6, gx, gy, Math.max(W, H) * 0.62);
      gl.addColorStop(0, "rgba(255,120,40,.3)"); gl.addColorStop(0.5, "rgba(232,64,28,.1)"); gl.addColorStop(1, "rgba(232,64,28,0)");
      x.fillStyle = gl; x.fillRect(0, 0, W, H);
      return o;
    }

    // Het blok in de kachel: gekloofd hout (licht, aangestraald) met schorsrand en nerf.
    function renderLog() {
      const len = L.logLen, th = L.logTh;
      const [o, x] = off(len + 8, th + 8);
      x.translate(4, 4);
      const wood = x.createLinearGradient(0, 0, 0, th);
      wood.addColorStop(0, "#b4824c"); wood.addColorStop(0.4, "#8a5a36"); wood.addColorStop(0.8, "#4a2c16"); wood.addColorStop(1, "#24140a");
      x.fillStyle = wood;
      x.beginPath(); x.roundRect ? x.roundRect(0, 0, len, th, th * 0.18) : x.rect(0, 0, len, th); x.fill();
      const nr = M.rng(0x109);
      x.strokeStyle = "rgba(70,40,18,.45)";
      for (let k = 0; k < 16; k++) {
        const y = 2 + nr() * (th - 4); x.lineWidth = 0.6 + nr();
        x.beginPath(); x.moveTo(nr() * len * 0.2, y);
        x.bezierCurveTo(len * 0.35, y + (nr() - 0.5) * 6, len * 0.65, y + (nr() - 0.5) * 6, len - nr() * len * 0.2, y + (nr() - 0.5) * 4); x.stroke();
      }
      // verkoolde schorsrand onderaan + kopse kant
      x.fillStyle = "#24140a"; x.fillRect(0, th * 0.84, len, th * 0.16);
      for (let k = 0; k < 22; k++) { x.fillStyle = nr() < 0.5 ? "#3a1c0c" : "rgba(255,120,40,.55)"; x.fillRect(nr() * len, th * (0.82 + nr() * 0.14), 3 + nr() * 6, 2 + nr() * 2); }
      // verkoolde uiteinden
      [[0, 1], [len, -1]].forEach(([ex, dir]) => {
        const end = x.createLinearGradient(ex, 0, ex + dir * th * 0.9, 0);
        end.addColorStop(0, "rgba(18,9,4,.9)"); end.addColorStop(1, "rgba(18,9,4,0)");
        x.fillStyle = end; x.fillRect(Math.min(ex, ex + dir * th * 0.9), 0, th * 0.9, th);
      });
      // gloeiende barstjes in het houtskool aan de uiteinden
      x.lineCap = "round";
      for (let k = 0; k < 18; k++) {
        const left = k % 2 === 0, u = left ? nr() * th * 0.7 : len - nr() * th * 0.7, v = th * (0.1 + nr() * 0.8);
        x.strokeStyle = "rgba(255," + Math.round(90 + nr() * 60) + ",30," + (0.35 + nr() * 0.45) + ")"; x.lineWidth = 0.9 + nr() * 0.8;
        x.beginPath(); x.moveTo(u, v); x.lineTo(u + (nr() - 0.5) * 7, v + (nr() - 0.5) * 3); x.lineTo(u + (nr() - 0.5) * 9, v + (nr() - 0.5) * 7); x.stroke();
      }
      return o;
    }

    // --- Vuur & effecten ---
    const nz = (t, a, b, p, q) => 0.5 * Math.sin(t * a + p) + 0.5 * Math.sin(t * b * 1.7 + q);

    function drawFire(ts) {
      const { cx, wTop, wBot, wht, whb, wh } = L;
      const k = Math.min(1.8, fireK + flare);
      g.save();
      windowPath(g, 0); g.clip();
      // achtergloed
      const bgG = g.createLinearGradient(0, wTop, 0, wBot);
      bgG.addColorStop(0, "rgb(" + Math.round(30 + 50 * k) + "," + Math.round(10 + 14 * k) + ",6)");
      bgG.addColorStop(1, "rgb(" + Math.round(90 + 110 * Math.min(1, k)) + "," + Math.round(26 + 40 * Math.min(1, k)) + ",10)");
      g.fillStyle = bgG; g.fillRect(cx - wht - 4, wTop - 4, wht * 2 + 8, wh + L.sag * 2 + 8);
      // vlammen achter het blok: zacht (laag-res) + scherpe kern
      const baseY = wBot - wh * 0.12, fl = [];
      tongues.forEach((tg, i) => {
        const x0 = cx - whb + tg.u * whb * 2, n = nz(ts, tg.a, tg.b, tg.p, tg.q);
        const hh = wh * tg.h * (0.45 + 0.55 * Math.min(1.5, k)) * (0.8 + 0.25 * n), w = whb * tg.w * (0.9 + 0.35 * k);
        fl.push([x0, hh, w, n * w * 0.9 + Math.sin(ts * 1.3 + i) * 3]);
      });
      fg.save(); fg.setTransform(1, 0, 0, 1, 0, 0); fg.clearRect(0, 0, fcv.width, fcv.height); fg.restore();
      fg.globalCompositeOperation = "lighter";
      fl.forEach(([x0, hh, w, sway]) => flame(fg, x0, baseY, w * 1.5, hh * 1.08, sway, 0.75 + 0.25 * Math.min(1, k), false));
      g.globalCompositeOperation = "lighter";
      g.drawImage(fcv, L.fBox[0], L.fBox[1], L.fBox[2], L.fBox[3]);
      fl.forEach(([x0, hh, w, sway]) => flame(g, x0 + sway * 0.15, baseY, w * 0.45, hh * 0.62, sway * 0.6, 0.35 + 0.25 * Math.min(1, k), false));
      g.globalCompositeOperation = "source-over";
      // het blok
      const jump = logJump, tw = logTwitch * Math.sin(ts * 70) * 2.2;
      g.save();
      g.translate(L.logC.x + tw, L.logC.y - jump * wh * 0.22);
      g.rotate(L.logA - jump * 0.14 + logTwitch * 0.02 * Math.sin(ts * 55));
      g.drawImage(logImg, -L.logLen / 2 - 4, -L.logTh / 2 - 4, L.logLen + 8, L.logTh + 8);
      // aanstraling + gloeiende barst
      g.globalCompositeOperation = "lighter";
      g.fillStyle = "rgba(255,150,60," + (0.08 + 0.12 * Math.min(1.5, k)) + ")";
      g.fillRect(-L.logLen / 2, -L.logTh / 2, L.logLen, L.logTh);
      if (crack > 0.01) {
        g.strokeStyle = "rgba(255,236,170," + crack + ")"; g.lineWidth = 2.5 + crack * 2;
        g.shadowColor = "rgba(255,170,60,1)"; g.shadowBlur = 14;
        g.beginPath(); g.moveTo(-L.logLen * 0.42, -L.logTh * 0.05);
        for (let s = 1; s <= 8; s++) g.lineTo(-L.logLen * 0.42 + (L.logLen * 0.84 * s) / 8, ((s % 2) - 0.5) * L.logTh * 0.28);
        g.stroke(); g.shadowBlur = 0;
      }
      g.restore();
      // gloeiend kolenbed
      g.globalCompositeOperation = "lighter";
      coals.forEach((cl) => {
        const x0 = cx - whb + cl.u * whb * 2, y0 = wBot - wh * (0.02 + cl.v * 0.2) + L.sag;
        const gl = 0.35 + 0.35 * Math.sin(ts * cl.s + cl.p) + 0.3 * Math.min(1.4, k);
        const r = cl.r * whb * 1.6;
        g.globalAlpha = Math.max(0, Math.min(1, gl));
        g.drawImage(coalImg, x0 - r, y0 - r, r * 2, r * 2);
      });
      g.globalAlpha = 1;
      // voorste vlammetjes die over het blok likken (een paar blauwe voetjes zoals bij echt hout)
      for (let i = 0; i < 6; i++) {
        const tg = tongues[(i * 2) % tongues.length], x0 = cx - whb * 0.82 + (i / 5) * whb * 1.64, n = nz(ts * 1.2, tg.b, tg.a, tg.q, tg.p);
        flame(g, x0, wBot - wh * 0.08, whb * 0.075, wh * 0.36 * (0.5 + 0.5 * Math.min(1.5, k)) * (0.75 + 0.35 * n), n * 7, 0.42, i === 1 || i === 4);
      }
      // flits in het glas
      if (flash > 0.01) { g.fillStyle = "rgba(255,240,200," + Math.min(1, flash) * 0.8 + ")"; g.fillRect(cx - wht - 4, wTop - 4, wht * 2 + 8, wh + L.sag * 2 + 8); }
      g.globalCompositeOperation = "source-over";
      // rooster
      const ry = L.railY, rx0 = cx - whb * 0.98, rx1 = cx + whb * 0.98;
      g.strokeStyle = "#0b0706"; g.lineWidth = 5; g.lineCap = "round";
      g.beginPath(); g.moveTo(rx0, ry); g.quadraticCurveTo(cx, ry + L.sag * 2.2, rx1, ry); g.stroke();
      g.lineWidth = 4;
      for (let i = 1; i < 12; i++) {
        const u = i / 12, bx = rx0 + (rx1 - rx0) * u, by = ry + L.sag * 2.2 * 2 * u * (1 - u);
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx, wBot + L.sag * 2.2 * 2 * u * (1 - u) + 4); g.stroke();
      }
      g.strokeStyle = "rgba(255,140,50," + (0.25 + 0.25 * Math.min(1, k)) + ")"; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(rx0, ry - 2); g.quadraticCurveTo(cx, ry + L.sag * 2.2 - 2, rx1, ry - 2); g.stroke();
      // glasreflectie
      const rf = g.createLinearGradient(cx - wht, wTop, cx - wht * 0.4, wBot);
      rf.addColorStop(0, "rgba(255,255,255,.07)"); rf.addColorStop(0.5, "rgba(255,255,255,0)");
      g.fillStyle = rf; g.fillRect(cx - wht, wTop, wht * 0.7, wh + L.sag * 2);
      g.restore();
      // sponning-rand met warme rimlight
      g.save(); windowPath(g, -2);
      g.strokeStyle = "rgba(255,120,40," + (0.18 + 0.2 * Math.min(1.5, k)) + ")"; g.lineWidth = 1.5; g.stroke();
      g.restore();
    }

    function flame(g, x0, baseY, w, hh, sway, a, blue) {
      const gr = g.createLinearGradient(0, baseY, 0, baseY - hh);
      if (blue) {
        gr.addColorStop(0, "rgba(90,169,255," + a * 0.9 + ")"); gr.addColorStop(0.25, "rgba(255,200,120," + a * 0.7 + ")");
      } else {
        gr.addColorStop(0, "rgba(255,240,190," + a + ")"); gr.addColorStop(0.3, "rgba(255,178,64," + a * 0.9 + ")");
      }
      gr.addColorStop(0.7, "rgba(232,64,28," + a * 0.45 + ")"); gr.addColorStop(1, "rgba(232,64,28,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x0 - w, baseY);
      g.bezierCurveTo(x0 - w, baseY - hh * 0.5, x0 + sway - w * 0.3, baseY - hh * 0.75, x0 + sway, baseY - hh);
      g.bezierCurveTo(x0 + sway + w * 0.3, baseY - hh * 0.75, x0 + w, baseY - hh * 0.5, x0 + w, baseY);
      g.closePath(); g.fill();
    }

    // De Vorst: twee bleke ogen in het donker boven de kachel. Knipperen, kijken, schrikken bij de knal.
    function drawEyes(ts) {
      const a = Math.max(0, Math.min(1, eyesK));
      if (a < 0.02) return;
      const cx = L.cx - L.half * 0.12, eyeY = L.eyeY, gap = Math.min(34, W * 0.085), ew = Math.min(15, W * 0.04);
      const blink = (ts % 4.3) < 0.13 ? 0.08 : 1;
      const look = Math.sin(ts * 0.6) * 3;
      g.save();
      g.globalCompositeOperation = "lighter";
      const halo = g.createRadialGradient(cx, eyeY, 0, cx, eyeY, gap * 3);
      halo.addColorStop(0, "rgba(90,169,255," + 0.16 * a + ")"); halo.addColorStop(1, "rgba(90,169,255,0)");
      g.fillStyle = halo; g.fillRect(cx - gap * 3, eyeY - gap * 3, gap * 6, gap * 6);
      [-1, 1].forEach((s) => {
        const ex = cx + s * gap + look, eh = ew * 0.42 * blink;
        g.shadowColor = "rgba(120,190,255,1)"; g.shadowBlur = 16;
        g.fillStyle = "rgba(207,232,255," + 0.85 * a + ")";
        g.beginPath();
        g.moveTo(ex - ew, eyeY + s * 0); g.quadraticCurveTo(ex, eyeY - eh * 2.1, ex + ew, eyeY - s * 2);
        g.quadraticCurveTo(ex, eyeY + eh * 1.3, ex - ew, eyeY);
        g.fill();
        g.shadowBlur = 0;
        if (blink > 0.5) { g.fillStyle = "rgba(10,30,60," + 0.8 * a + ")"; g.fillRect(ex - 1.2 + look * 0.4, eyeY - eh * 0.9, 2.4, eh * 1.4); }
      });
      g.restore();
    }

    function burst(n, power, x, y) {
      for (let i = 0; i < n && parts.length < 320; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6, sp = power * (0.35 + Math.random() * 0.8);
        parts.push({ k: "spark", x: x + (Math.random() - 0.5) * L.logLen * 0.6, y: y + (Math.random() - 0.5) * 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: 0.6 + Math.random() * 0.9, s: 1 + Math.random() * 2.2 });
      }
    }

    function drawParts(dt) {
      g.save(); g.globalCompositeOperation = "lighter";
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.k === "spark") { p.vy += 520 * dt; p.vx *= Math.pow(0.4, dt); }
        else { p.vx += Math.sin(p.life * 3 + p.s) * 8 * dt; }
        if (p.life >= p.max) { parts.splice(i, 1); continue; }
        const a = 1 - p.life / p.max;
        if (p.k === "spark") {
          g.strokeStyle = a > 0.5 ? "rgba(255,240,190," + a + ")" : "rgba(255,150,40," + a * 1.5 + ")";
          g.lineWidth = p.s; g.lineCap = "round";
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025); g.stroke();
        } else {
          g.fillStyle = "rgba(255,150,50," + a * 0.9 + ")"; g.beginPath(); g.arc(p.x, p.y, p.s, 0, TAU); g.fill();
        }
      }
      g.restore();
    }

    let lastFrame = 0, now0 = 0, fdt = 1000 / 60; // fdt = gladgestreken frame-interval (ms)
    function frame(ts) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (!L || !W) layout();
      const fd = ts - (lastFrame || ts), dt = Math.min(0.05, fd / 1000);
      if (fd > 4 && fd < 50) fdt += (fd - fdt) * 0.1;
      lastFrame = ts;
      const st = (ts - now0) / 1000;

      // spelklok: knal/schijnbewegingen/te-laat worden in de frame zelf bepaald, zodat de knal-tijd = dit frame
      if (phase === "wait") {
        const el = ts - waitStart, r = rounds[round];
        while (fakeIdx < r.fakes.length && el >= r.fakes[fakeIdx].t) fake(r.fakes[fakeIdx++].kind);
        if (el >= r.delay) bang(ts);
      } else if (phase === "bang") {
        if (ts - bangTs > SLOW) record(null, "slow");
        else updateRace(ts - bangTs);
      }

      // uitdempen
      flare *= Math.pow(0.03, dt); flash *= Math.pow(0.004, dt); shake *= Math.pow(0.002, dt);
      logJump *= Math.pow(0.02, dt); logTwitch *= Math.pow(0.01, dt); crack *= Math.pow(0.15, dt);
      frostBoost *= Math.pow(0.5, dt); cold *= Math.pow(0.35, dt);
      const tension = phase === "wait" ? 1 : 0;
      const fireT = phase === "wait" ? 0.38 + 0.06 * Math.sin(st * 2.2) : phase === "bang" ? 1.2 : phase === "howto" || phase === "count" ? 0.55 : 0.7;
      fireK += (fireT - fireK) * Math.min(1, dt * (phase === "bang" ? 12 : 2));
      const frostT = (phase === "bang" ? 0.15 : 0.5 + 0.22 * tension + 0.12 * Math.sin(st * 1.4)) + frostBoost + cold * 0.4;
      frostK += (frostT - frostK) * Math.min(1, dt * (phase === "bang" ? 14 : 2.5));
      const eyesT = phase === "bang" ? 0.15 : phase === "wait" ? 0.95 : phase === "done" ? 0.35 : 0.55 + cold * 0.4;
      eyesK += (eyesT - eyesK) * Math.min(1, dt * 4);
      if (!reduced && Math.random() < dt * (2 + fireK * 4) && parts.length < 300) {
        parts.push({ k: "ember", x: L.cx + (Math.random() - 0.5) * L.whb * 1.6, y: L.wBot - L.wh * 0.3, vx: (Math.random() - 0.5) * 10, vy: -30 - Math.random() * 40, life: 0, max: 0.8 + Math.random() * 0.8, s: 0.8 + Math.random() * 0.9 });
      }

      // tekenen
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (shake > 0.01 && !reduced) g.translate((Math.random() - 0.5) * 22 * shake, (Math.random() - 0.5) * 16 * shake);
      g.drawImage(bg, 0, 0, W, H);
      // warm licht van het venster op muur, kachel en vloer
      const k = Math.min(1.8, fireK + flare);
      g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = Math.min(1, 0.75 * k);
      g.drawImage(glowImg, -20, -20, W + 40, H + 40);
      g.restore();
      drawFire(st);
      drawParts(dt);
      drawEyes(st);
      // ademende vorst
      g.globalAlpha = Math.max(0, Math.min(1, frostK));
      g.drawImage(frost, 0, 0, W, H);
      g.globalAlpha = 1;
      if (cold > 0.02) { g.fillStyle = "rgba(120,180,255," + cold * 0.22 + ")"; g.fillRect(-20, -20, W + 40, H + 40); }
      // knalflits over het hele scherm
      if (flash > 0.01) {
        g.save(); g.globalCompositeOperation = "lighter";
        const fl = g.createRadialGradient(L.cx, L.logC.y, 0, L.cx, L.logC.y, Math.max(W, H) * 0.85);
        fl.addColorStop(0, "rgba(255,236,170," + Math.min(1, flash) * 0.85 + ")"); fl.addColorStop(0.45, "rgba(255,150,50," + Math.min(1, flash) * 0.35 + ")"); fl.addColorStop(1, "rgba(255,106,26,0)");
        g.fillStyle = fl; g.fillRect(-20, -20, W + 40, H + 40);
        g.restore();
      }
    }

    // --- Rondes ---
    function setMsg(a, b, waiting) {
      m1.textContent = a; m2.textContent = b || "";
      m1.classList.toggle("wait", !!waiting);
      msg.classList.toggle("hide", !a);
    }
    function setPips() {
      pipEls.forEach((p, i) => {
        p.className = "sn-pip";
        if (i < round || (i === round && (phase === "show" || phase === "done"))) {
          const t = times[i];
          p.classList.add(t === null ? "bad" : t < V ? "win" : "lose");
          p.textContent = t === null ? "✕" : String(t);
        } else {
          p.textContent = String(i + 1);
          if (i === round && phase !== "done") p.classList.add("cur");
        }
      });
    }

    function startRound() {
      phase = "wait";
      waitStart = performance.now();
      ignoreUntil = waitStart + 220;
      fakeIdx = 0;
      cardEls = null;
      card.classList.remove("on");
      bangEl.className = "sn-bang";
      setMsg(WAITS[round % WAITS.length], "Ronde " + (round + 1) + " van " + ROUNDS + " · tik pas bij de\u00a0knal", true);
      setPips();
      beep(180, 0.25, "sine", 0.03);
    }

    function fake(kind) {
      if (kind === "kraak") { flare = 0.45; logTwitch = 1; beep(1500 + Math.random() * 400, 0.015, "square", 0.04); beep(1100, 0.015, "square", 0.03, 0.06); }
      else if (kind === "plof") { flare = 0.3; logJump = 0.25; beep(120, 0.06, "sine", 0.06); for (let i = 0; i < 6; i++) parts.push({ k: "ember", x: L.logC.x + (Math.random() - 0.5) * 40, y: L.logC.y, vx: (Math.random() - 0.5) * 50, vy: -60 - Math.random() * 60, life: 0, max: 0.9, s: 1.2 }); }
      else { flare = 0.7; flash = 0.25; burst(14, 260, L.logC.x, L.logC.y); beep(2200, 0.02, "square", 0.04); }
    }

    // De knal wordt in dít frame getekend maar pas bij de volgende vsync zichtbaar: daar begint de klok.
    function bang(ts) {
      phase = "bang";
      bangTs = ts + Math.max(7, Math.min(34, fdt));
      flash = 1.25; flare = 0.9; shake = reduced ? 0 : 1; logJump = 1; crack = 1; frostK = 0.2;
      burst(reduced ? 30 : 80, 560, L.logC.x, L.logC.y);
      bangEl.className = "sn-bang on";
      bangB.textContent = "KNAL!"; bangS.textContent = "TIK!";
      setMsg("", "");
      showRace();
      buzz(40);
      beep(70, 0.28, "square", 0.16); beep(140, 0.14, "sawtooth", 0.12); beep(2100, 0.03, "square", 0.07);
    }

    function early(guess) {
      cold = 1; frostBoost = 0.5; logTwitch = 0.4;
      bangEl.className = "sn-bang on early";
      bangB.textContent = "Te vroeg!"; bangS.textContent = guess ? "GEGOKT" : "DE VORST LACHT";
      buzz([25, 50, 25]);
      beep(220, 0.18, "sawtooth", 0.06); beep(160, 0.25, "sawtooth", 0.05, 0.12);
      record(null, "early");
    }

    function record(t, tag) {
      times[round] = t; tags[round] = tag;
      phase = "show";
      const win = t !== null && t < V;
      if (t === null && tag === "slow") { cold = 0.8; frostBoost = 0.4; bangEl.className = "sn-bang on early"; bangB.textContent = "Bevroren!"; bangS.textContent = "TE LAAT"; beep(200, 0.2, "triangle", 0.05); }
      if (t !== null) {
        fadeBang(0);
        if (win) { flare = 0.6; beep(880, 0.08, "triangle", 0.08); beep(1320, 0.12, "triangle", 0.06, 0.07); }
        else { cold = 0.6; frostBoost = 0.3; beep(330, 0.12, "triangle", 0.05); }
      }
      showCard(t, tag, win);
      setMsg("", "");
      if (t === null) fadeBang(1000);
      setPips();
      later(() => {
        if (round + 1 < ROUNDS) { round++; startRound(); }
        else finish();
      }, t === null ? 1900 : 2100);
    }

    // KNAL/Te vroeg wegblazen en daarna helemaal resetten (geen blijvende transform/overflow).
    function fadeBang(delay) {
      const at = round;
      later(() => {
        if (phase !== "show" || round !== at) return;
        bangEl.classList.add("hit");
        later(() => { if (round === at) bangEl.className = "sn-bang"; }, 450);
      }, delay);
    }

    // Rondekaart: tijdens de knal een live race (jouw balk tegen de spookbalk van de Vorst), na de tik de uitslag.
    let cardEls = null, vorstHit = false;
    const scale = (t) => Math.min(1, t / Math.max(600, V * 1.8));
    function buildCard() {
      card.textContent = "";
      const top = h("div", "sn-ctop"), big = h("b", "sn-cms"), vs = h("div", "sn-cvs");
      top.append(h("span", "sn-crd", "Ronde " + (round + 1)), big);
      const row = (cls, label, fillCls) => {
        const r = h("div", "sn-row" + (cls ? " " + cls : "")), trk = h("div", "sn-trk"), fill = h("i", fillCls), val = h("b");
        trk.appendChild(fill); r.append(h("span", null, label), trk, val);
        return { r, fill, val };
      };
      const me = row("", "Jij", "me"), vo = row("vr", "Vorst", "gh");
      card.append(top, vs, me.r, vo.r);
      cardEls = { big, vs, me, vo };
    }
    function setBig(text, unit) {
      cardEls.big.textContent = text;
      if (unit) cardEls.big.appendChild(h("small", null, unit));
    }
    function showRace() {
      buildCard();
      vorstHit = false;
      card.className = "sn-card live";
      setBig("0", "ms");
      cardEls.vs.textContent = "De Vorst tikt in " + V + " ms…";
      cardEls.vo.val.textContent = "";
      void card.offsetWidth;
      card.classList.add("on");
    }
    function updateRace(el) {
      if (!cardEls) return;
      const e = Math.max(0, Math.round(el));
      setBig(String(e), "ms");
      cardEls.me.fill.style.width = (scale(e) * 100).toFixed(1) + "%";
      cardEls.vo.fill.style.width = (scale(Math.min(e, V)) * 100).toFixed(1) + "%";
      if (e >= V && !vorstHit) {
        vorstHit = true;
        cardEls.vo.val.textContent = String(V);
        cardEls.vo.r.classList.add("hit");
        cardEls.vs.textContent = "De Vorst heeft getikt!";
        card.classList.add("cold");
        frostBoost = Math.max(frostBoost, 0.35); eyesK = 1.2;
        beep(1250, 0.06, "sine", 0.05);
      }
    }
    function showCard(t, tag, win) {
      if (!cardEls || tag === "early") buildCard();
      card.className = "sn-card" + (win ? "" : " cold") + (card.classList.contains("on") ? " on" : "");
      if (t !== null) setBig(String(t), "ms");
      else setBig(tag === "slow" ? "Bevroren" : "Te vroeg");
      cardEls.vs.textContent = t === null ? (tag === "slow" ? "Te laat. De Vorst pakt de ronde." : "Gegokt. De Vorst pakt de ronde.")
        : win ? (V - t) + " ms sneller dan de Vorst!" + (V - t >= 60 ? " Ruim." : "")
          : t === V ? "Precies gelijk. Bij gelijk wint de Vorst." : t - V <= 25 ? "Net te traag: " + (t - V) + " ms. Eén ijskristal." : "De Vorst was " + (t - V) + " ms sneller.";
      cardEls.me.val.textContent = t === null ? "✕" : String(t);
      cardEls.vo.val.textContent = String(V);
      cardEls.vo.r.classList.toggle("hit", !win);
      later(() => {
        if (!cardEls) return;
        cardEls.me.fill.style.width = (t === null ? 0 : scale(t) * 100).toFixed(1) + "%";
        cardEls.vo.fill.style.width = (scale(V) * 100).toFixed(1) + "%";
      }, 40);
      void card.offsetWidth;
      card.classList.add("on");
    }

    function finish() {
      if (phase === "done") return;
      phase = "done";
      card.classList.remove("on");
      bangEl.className = "sn-bang";
      setMsg("", "");
      setPips();
      const r = { times: times.slice() };
      const won = times.filter((t) => beats(t, d)).length;
      const avg = avgOf(times), best = times.reduce((m, t) => (t !== null && (m === null || t < m) ? t : m), null);
      const misses = times.filter((t) => t === null).length;
      if (won >= 2) { try { sfx.fanfare && sfx.fanfare(); } catch (e) { /* stil */ } }
      const res = h("div", "sn-scr sn-res" + (won >= 2 ? "" : " cold"));
      res.appendChild(h("div", "sn-kicker", "Duel voorbij · De Vorst:\u00a0" + V + "\u00a0ms"));
      const big = h("div", "sn-big sn-disp", String(won));
      big.appendChild(h("small", null, "/" + ROUNDS));
      res.appendChild(big);
      res.appendChild(h("div", "sn-unit", won === 1 ? "ronde sneller dan de Vorst" : "rondes sneller dan de Vorst"));
      res.appendChild(h("div", "sn-rank", RANKS.find((x) => won >= x[0])[1]));
      const board = h("div", "sn-board");
      times.forEach((t, i) => {
        const row = h("div", "sn-rr" + (beats(t, d) ? "" : " lost"));
        const trk = h("div", "sn-trk"), fill = h("i", "me"), ghost = h("em");
        ghost.style.left = (scale(V) * 100).toFixed(1) + "%";
        trk.append(fill, ghost);
        row.append(h("span", null, String(i + 1)), trk, h("b", null, t === null ? (tags[i] === "slow" ? "traag" : "vroeg") : t + " ms"));
        board.appendChild(row);
        later(() => { fill.style.width = (t === null ? 0 : scale(t) * 100).toFixed(1) + "%"; }, 120 + i * 140);
      });
      const lg = h("div", "sn-leg");
      lg.append(h("span", null, "jouw tik"), h("span", null, "| = de Vorst"));
      board.appendChild(lg);
      res.appendChild(board);
      const st = h("div", "sn-stats");
      [[avg === null ? "—" : String(avg), "Gemiddeld"], [best === null ? "—" : String(best), "Snelste"], [String(misses), "Mis"]].forEach(([n, lbl]) => {
        const s = h("div", "sn-stat"); s.appendChild(h("b", null, n)); s.appendChild(h("span", null, lbl)); st.appendChild(s);
      });
      res.appendChild(st);
      const w = h("div", "sn-wait"); w.appendChild(h("i")); w.appendChild(document.createTextNode("Klaar! Wachten op de rest…"));
      res.appendChild(w);
      hud.style.opacity = "0";
      root.appendChild(res);
      if (typeof ctx.done === "function") ctx.done(r);
    }

    // Tijdstempel van de tik in dezelfde klok als requestAnimationFrame (performance.now-basis).
    function stamp(e) {
      const n = performance.now(), t = e && typeof e.timeStamp === "number" ? e.timeStamp : NaN;
      return Number.isFinite(t) && t <= n + 1 && n - t < 1000 ? t : n;
    }
    function tap(e) {
      if (phase === "wait") {
        if (performance.now() < ignoreUntil) return;
        early(false);
      } else if (phase === "bang") {
        const t = stamp(e) - bangTs;
        if (t < GUESS) { early(true); return; }
        if (t > SLOW) { record(null, "slow"); return; } // frame liep achter: telt toch als te laat
        buzz(t < V ? [14, 40, 22] : 12);
        record(Math.round(t), "ok");
      }
    }
    const onDown = (e) => {
      if (e.button > 0 || (phase !== "wait" && phase !== "bang")) return;
      e.preventDefault();
      tap(e);
    };
    const onKey = (e) => { if ((e.code === "Space" || e.key === "Enter") && !e.repeat && (phase === "wait" || phase === "bang")) { e.preventDefault(); tap(e); } };
    // Telefoon weggelegd of scherm uit tijdens het wachten: ronde opnieuw beginnen in plaats van "te laat".
    const onVis = () => {
      if (document.hidden || dead) return;
      if (phase === "wait" || phase === "bang") { flash = 0; startRound(); }
    };
    root.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVis);

    startBtn.addEventListener("click", () => {
      if (phase !== "howto") return;
      phase = "count";
      beep(1, 0.001, "sine", 0.0001); // audio ontgrendelen binnen het gebaar
      how.remove();
      hud.style.opacity = "1";
      setPips();
      ctx.countdown(root, { go: "Stil…" }).then(() => { if (!dead) startRound(); });
    });

    layout();
    now0 = performance.now();
    raf = requestAnimationFrame(frame);

    // Testhaakje (alleen voor Playwright): leesbare speltoestand, geen globale variabele.
    Object.defineProperty(root, "_snel", { value: {
      get phase() { return phase; }, get round() { return round; }, get times() { return times.slice(); },
      get bangTs() { return bangTs; }, plan: rounds, vorst: V,
    }, enumerable: false });

    return {
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        timers.forEach(clearTimeout); timers.clear();
        if (ro) ro.disconnect();
        root.removeEventListener("pointerdown", onDown);
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("visibilitychange", onVis);
        root.remove();
      },
    };
  }

  const def = {
    id: "snel", title: "Snel", icon: "⚡", kind: "local", duration: 25,
    howto: "Wacht tot het blok in de kachel knalt en tik dan zo snel je kan, ergens op het scherm: te vroeg is af.",
    mount, score, bot, plan, valid, roundWins, CFG, ROUNDS, SLOW, GUESS,
  };
  M.register(def);
  if (typeof module === "object" && module.exports) module.exports = def;
})();
