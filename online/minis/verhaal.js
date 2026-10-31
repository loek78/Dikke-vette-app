// Minigame "verhaal" — net, verhalen vertellen bij het vuur (SPEC-3 §5, hoofdstuk "Het uur van de wolf").
// Om de beurt is iemand de VERTELLER: die krijgt een kaart uit Vuurpraat, vertelt hardop en tikt "Klaar met vertellen".
// De rest geeft één tot drie vlammen (stemmen blijven geheim tot iedereen gestemd heeft). Dan de volgende verteller.
// 2–3 spelers: iedereen één keer; 4+: vier verhalen. Moeilijkheid = strengere kaarten (verplichte woorden, openingszin, zandloper).
(function () {
  "use strict";
  const M = typeof DVMini !== "undefined" ? DVMini : require("./core.js");

  const CFG = {
    1: { name: "Knus", swaps: 2, twists: 0, opener: false, limit: 0 },
    2: { name: "Gezellig", swaps: 1, twists: 1, opener: false, limit: 90 },
    3: { name: "Pittig", swaps: 0, twists: 2, opener: true, limit: 60 },
  };
  // Hoe gul Gloei de vlammen omrekent naar blokken: zwaardere kaarten = milder oordeel.
  const BAR = { 1: [2.6, 2.0], 2: [2.45, 1.85], 3: [2.3, 1.7] };
  const dl = (d) => Math.max(1, Math.min(3, Math.round(d) || 1));
  const WARMUP = 3000; // ms voor "Klaar" tikbaar wordt (geen per-ongeluk-klaar)
  const SKIP_AFTER = 20000; // ms waarna de verteller niet meer hoeft te wachten op een treuzelaar

  const FALLBACK = [
    "Wat is je eerste herinnering aan een kampvuur of open haard?",
    "Wat is het domste wat je als puber hebt uitgehaald?",
    "Wat is tot nu toe ons mooiste avontuur samen?",
    "Welke vakantie van vroeger zou je nog één keer over willen doen?",
    "Je krijgt een blokhut in het bos. Waar staat hij en wie mag er langs?",
    "Welk gênant verhaal durf je nu, bij het vuur, eindelijk te vertellen?",
    "Wat is de mooiste plek waar je ooit bent geweest?",
    "Van wie heb je het meest geleerd in je leven?",
    "Wanneer voelde je je voor het laatst helemaal vrij?",
    "We moeten samen een week overleven in het bos. Wie doet wat?",
    "Wat maakt een gewone avond voor jou een topavond?",
    "Wat is het beste advies dat je ooit hebt gekregen?",
  ];
  const TWISTS = [
    "een geit", "de Vorst", "een verloren sok", "een frikandel speciaal", "je oma", "een tractor", "een ijsbeer",
    "een verkeerde afslag", "een kapotte paraplu", "Gloei", "een karaokemicrofoon", "een bos sleutels", "een ezel",
    "een snackbar om drie uur 's nachts", "een gouden tand", "een verdwaalde postbode", "een fles advocaat",
    "een zeilboot", "een agent op de fiets", "een mislukte taart", "de spin uit de houtmand", "een accordeon",
    "een lekke band", "een verdwenen hamster",
  ];
  const OPENERS = [
    "Het was een donkere en stormachtige nacht…",
    "Ik heb dit nog nooit aan iemand verteld, maar…",
    "Het begon allemaal met een frikandel.",
    "Niemand geloofde me, maar het is echt gebeurd.",
    "Ik was een jaar of twaalf, en het regende.",
    "Je raadt nooit wie er die avond voor de deur stond.",
    "Achteraf had ik dat briefje nooit moeten openen.",
    "Het was de warmste dag van het jaar.",
  ];
  const RATE_WORD = ["", "Gezellig", "Mooi verteld!", "Kippenvel!"];

  // ---------- Hulpjes ----------
  const pidOf = (p) => (typeof p === "string" ? p : p && p.pid);
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  const round2 = (x) => Math.round(x * 100) / 100;
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const fmt1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace(".", ",").replace(",0", "");
  const flamesWord = (x) => { const t = fmt1(x); return t + (t === "1" ? " vlam" : " vlammen"); };
  const joinNames = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " en " + a[a.length - 1]);

  function prompts() {
    const g = typeof globalThis !== "undefined" ? globalThis : {};
    const decks = g.VUUR_DECKS;
    const deck = Array.isArray(decks) ? decks.find((x) => x && x.id === "vuurpraat") : null;
    const items = deck && Array.isArray(deck.items) ? deck.items.filter((s) => typeof s === "string" && s.trim()) : [];
    return items.length >= 4 ? items : FALLBACK;
  }

  // ---------- Host-logica (puur) ----------
  function init({ seed, difficulty, players } = {}) {
    const d = dl(difficulty), c = CFG[d];
    const rng = M.rng(((seed >>> 0) || 1) ^ 0x7e7a1);
    const pids = [];
    (players || []).forEach((p) => { const pid = pidOf(p); if (typeof pid === "string" && pid && !pids.includes(pid)) pids.push(pid); });
    const order = shuffle(pids, rng);
    const turns = pids.length <= 3 ? pids.length : 4;
    const tellers = order.slice(0, turns);
    const src = prompts(), need = turns * (1 + c.swaps);
    let deck = [];
    while (deck.length < need) deck = deck.concat(shuffle(src, rng));
    deck = deck.slice(0, need);
    const tw = shuffle(TWISTS, rng), op = shuffle(OPENERS, rng);
    const twists = tellers.map((_, i) => tw.slice(i * c.twists, (i + 1) * c.twists));
    const openers = tellers.map((_, i) => (c.opener ? op[i % op.length] : null));
    const s = { v: 1, d, order, tellers, turns, turn: 0, stage: "tell", deck, cur: 0, nxt: 1, swaps: c.swaps, twists, openers, votes: {}, log: [], done: null };
    if (!turns) { s.stage = "end"; s.done = { ratings: {}, log: [] }; }
    return s;
  }

  const tellerOf = (s) => (s.stage === "end" ? null : s.tellers[s.turn] || null);
  const ratersOf = (s) => { const t = tellerOf(s); return s.order.filter((p) => p !== t); };

  function mkResult(log) {
    const by = {};
    log.forEach((e) => { (by[e.teller] = by[e.teller] || []).push(e.avg); });
    const ratings = {};
    Object.keys(by).forEach((pid) => { ratings[pid] = round2(mean(by[pid])); });
    return { ratings, log: log.map((e) => ({ teller: e.teller, avg: e.avg, n: e.n, prompt: e.prompt })) };
  }

  function finishTurn(s, votes) {
    const vals = Object.keys(votes).map((k) => votes[k]).sort((a, b) => b - a);
    const gloei = !vals.length; // niemand om te stemmen (solo): Gloei geeft er zelf twee
    const avg = gloei ? 2 : round2(mean(vals));
    const entry = { teller: tellerOf(s), prompt: s.deck[s.cur], avg, n: vals.length, flames: gloei ? [2] : vals, gloei };
    const log = s.log.concat([entry]);
    const next = Object.assign({}, s, { log, votes: {} });
    if (s.turn + 1 >= s.turns) return Object.assign(next, { stage: "end", done: mkResult(log) });
    return Object.assign(next, { turn: s.turn + 1, stage: "tell", cur: s.nxt, nxt: s.nxt + 1, swaps: CFG[s.d].swaps });
  }

  function reduce(shared, pid, a) {
    if (!shared || shared.done || !a || typeof a !== "object" || !shared.order.includes(pid)) return shared;
    const teller = tellerOf(shared);
    switch (a.t) {
      case "swap": {
        if (shared.stage !== "tell" || pid !== teller || shared.swaps <= 0 || shared.nxt >= shared.deck.length) return shared;
        return Object.assign({}, shared, { cur: shared.nxt, nxt: shared.nxt + 1, swaps: shared.swaps - 1 });
      }
      case "klaar": {
        if (shared.stage !== "tell" || pid !== teller) return shared;
        if (!ratersOf(shared).length) return finishTurn(shared, {});
        return Object.assign({}, shared, { stage: "rate", votes: {} });
      }
      case "rate": {
        if (shared.stage !== "rate" || pid === teller || Object.prototype.hasOwnProperty.call(shared.votes, pid)) return shared;
        if (!Number.isInteger(a.n) || a.n < 1 || a.n > 3) return shared;
        const votes = Object.assign({}, shared.votes, { [pid]: a.n });
        if (ratersOf(shared).every((p) => Object.prototype.hasOwnProperty.call(votes, p))) return finishTurn(shared, votes);
        return Object.assign({}, shared, { votes });
      }
      case "next": { // verteller wacht niet langer op een weggelopen luisteraar
        if (shared.stage !== "rate" || pid !== teller || !Object.keys(shared.votes).length) return shared;
        return finishTurn(shared, shared.votes);
      }
      default: return shared;
    }
  }

  function view(shared, pid) {
    if (!shared) return null;
    const teller = tellerOf(shared);
    const live = shared.stage !== "end";
    const v = {
      d: shared.d, role: pid === teller ? "teller" : shared.order.includes(pid) ? "luisteraar" : "kijker",
      turn: shared.turn, turns: shared.turns, tellers: shared.tellers.slice(), teller, stage: shared.stage,
      prompt: live ? shared.deck[shared.cur] : null,
      twists: live ? (shared.twists[shared.turn] || []).slice() : [],
      opener: live ? shared.openers[shared.turn] || null : null,
      swapsLeft: pid === teller && shared.stage === "tell" ? Math.min(shared.swaps, shared.deck.length - shared.nxt) : 0,
      raters: live ? ratersOf(shared) : [],
      voted: Object.keys(shared.votes), // alleen wíe er stemde, nooit hoeveel
      myVote: Object.prototype.hasOwnProperty.call(shared.votes, pid) ? shared.votes[pid] : null,
      history: shared.log.map((e) => ({ teller: e.teller, prompt: e.prompt, avg: e.avg, n: e.n, flames: e.flames.slice(), gloei: e.gloei })),
      done: shared.done ? { ratings: Object.assign({}, shared.done.ratings), log: shared.done.log.map((e) => Object.assign({}, e)) } : null,
    };
    return v;
  }

  const result = (shared) => (shared && shared.done ? shared.done : null);

  // ---------- Score ----------
  // Altijd 1..3 blokken: het is het warme hoofdstuk, een verhaal is nooit slecht voor het vuur.
  function entries(res) {
    if (!res || typeof res !== "object" || !res.ratings || typeof res.ratings !== "object") return [];
    const keys = Array.isArray(res.log) ? res.log.map((e) => e && e.teller).filter((k, i, a) => typeof k === "string" && a.indexOf(k) === i) : [];
    Object.keys(res.ratings).forEach((k) => { if (!keys.includes(k)) keys.push(k); });
    return keys.map((pid) => ({ pid, avg: Number(res.ratings[pid]) }))
      .filter((e) => Number.isFinite(e.avg))
      .map((e) => ({ pid: e.pid, avg: Math.max(1, Math.min(3, e.avg)) }));
  }
  function logsFor(avg, d) {
    const [hi, lo] = BAR[dl(d)];
    return avg >= hi ? 3 : avg >= lo ? 2 : 1;
  }

  function score(res, info) {
    info = info || {};
    const d = dl(info.difficulty);
    const players = Array.isArray(info.players) ? info.players : [];
    const nameOf = (pid) => { const p = players.find((x) => x && x.pid === pid); return (p && p.name) || "Iemand"; };
    const es = entries(res);
    if (!es.length) return { logs: 1, lines: ["Niemand kwam aan vertellen toe.", "Gloei: \"Dan verzin ik er zelf wel een. Over mezelf. Die zijn het mooist.\""], mvp: null, perPlayer: {} };
    const avg = mean(es.map((e) => e.avg));
    const logs = M.clampLogs(logsFor(avg, d));
    const lines = [logs >= 3 ? "Wat een verhalen. Gloei hangt aan jullie lippen en vergeet bijna te branden."
      : logs === 2 ? "Mooie verhalen. Gloei knispert tevreden mee."
        : "Gloei gaapt, maar luistert beleefd tot het eind. Een verhaal is altijd brandhout."];
    es.forEach((e) => lines.push(nameOf(e.pid) + " kreeg " + flamesWord(e.avg) + "."));
    const top = Math.max(...es.map((e) => e.avg));
    const best = es.filter((e) => e.avg === top);
    let mvp = null;
    if (best.length === 1 && (es.length > 1 || top >= 2.5)) {
      mvp = best[0].pid;
      lines.push(nameOf(mvp) + " vertelde het verhaal van de nacht.");
    } else if (es.length > 1 && best.length === es.length) {
      lines.push("Gelijkspel bij het vuur: " + joinNames(es.map((e) => nameOf(e.pid))) + " vertelden even mooi.");
    }
    const perPlayer = {};
    players.forEach((p) => { if (p && p.pid) perPlayer[p.pid] = "Luisteraar"; });
    es.forEach((e) => { perPlayer[e.pid] = "🔥 " + flamesWord(e.avg); });
    return { logs, lines, mvp, perPlayer };
  }

  // Bot: vertelt meteen "klaar" en geeft (meestal gul) vlammen.
  function bot(v, rng) {
    if (!v || v.done) return null;
    const r = typeof rng === "function" ? rng : Math.random;
    if (v.role === "teller" && v.stage === "tell") return { t: "klaar" };
    if (v.role === "luisteraar" && v.stage === "rate" && v.myVote === null) {
      const x = r();
      return { t: "rate", n: x < 0.15 ? 1 : x < 0.55 ? 2 : 3 };
    }
    return null;
  }

  // ---------- UI ----------
  const CSS = `
.vh{position:relative;width:100%;height:100%;min-height:480px;overflow:hidden;overflow:clip;color:var(--glow,#ffe7b8);
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
  background:radial-gradient(140% 70% at 50% 108%,rgba(255,106,26,.34),rgba(232,64,28,.10) 42%,rgba(0,0,0,0) 70%),
    radial-gradient(90% 50% at 50% 0%,rgba(138,90,54,.10),rgba(0,0,0,0) 70%),
    linear-gradient(180deg,#0d0806,var(--soot,#0b0705) 55%,#170c06)}
.vh *{box-sizing:border-box}
.vh,.vh *{font-variant-ligatures:none} /* geen "IJ"-ligatuur in Unbounded die als "U" leest */
.vh::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(60% 45% at 50% 100%,rgba(255,150,60,.22),rgba(255,106,26,0) 70%);animation:vh-breathe 5.5s ease-in-out infinite}
.vh::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:5;background:radial-gradient(ellipse at 50% 55%,rgba(0,0,0,0) 50%,rgba(0,0,0,.6))}
@keyframes vh-breathe{0%,100%{opacity:.75;transform:scale(1)}30%{opacity:1;transform:scale(1.03)}55%{opacity:.82}80%{opacity:.95;transform:scale(1.015)}}
.vh-cv{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2}
.vh-stove{position:absolute;left:50%;bottom:-14px;transform:translateX(-50%);z-index:1;width:min(300px,80%);height:clamp(118px,23%,176px);
  border-radius:50% 50% 14px 14px/26% 26% 14px 14px;overflow:hidden;
  background:radial-gradient(80% 70% at 50% 85%,#ff9a3a,#e8401c 35%,#5a1606 70%,#1a0904);
  box-shadow:0 0 0 9px #0f0a08,0 0 0 10px rgba(255,194,71,.10),0 -10px 90px 20px rgba(255,106,26,.30),inset 0 8px 24px rgba(0,0,0,.6)}
.vh-stove.lit{background:radial-gradient(80% 60% at 50% 100%,#3a1206,#120604 70%)}
.vh-fire{position:absolute;left:-15%;bottom:-4%;width:130%;height:190%;display:block}
.vh-grate{position:absolute;left:0;right:0;bottom:0;height:24%;
  background:repeating-linear-gradient(90deg,rgba(0,0,0,0) 0 14px,#120a07 14px 19px),linear-gradient(180deg,#1d120c 0 5px,rgba(0,0,0,0) 5px);
  border-top:2px solid #26180f;opacity:.92}
.vh-stove:not(.lit)::after{content:"";position:absolute;inset:20% 18% 18%;border-radius:50%;background:radial-gradient(#ffe7b8,#ffc247 30%,rgba(255,106,26,0) 70%);
  filter:blur(6px);animation:vh-flick 2.2s ease-in-out infinite}
@keyframes vh-flick{0%,100%{opacity:.7;transform:scaleY(1)}20%{opacity:.95;transform:scaleY(1.08)}45%{opacity:.6}70%{opacity:.9;transform:scaleY(.96)}}
.vh-disp{font-family:"Unbounded",system-ui,sans-serif;font-weight:900;letter-spacing:-.02em}
.vh-scr{position:absolute;inset:0;z-index:4;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  padding:max(22px,env(safe-area-inset-top)) 20px max(150px,calc(env(safe-area-inset-bottom) + 130px))}
.vh-kicker{font:800 11px/1.2 system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--ember,#ff6a1a)}
.vh-title{font-size:clamp(30px,9.6vw,44px);line-height:1.02;margin:10px 0 0;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 45%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 18px rgba(255,106,26,.45))}
.vh-text{font-size:17px;line-height:1.42;max-width:330px;margin:14px 0 0;color:var(--glow,#ffe7b8)}
.vh-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:7px;max-width:340px;margin-top:16px}
.vh-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:99px;font-size:12.5px;color:var(--ash,#b8a99a);
  background:rgba(255,231,184,.06);border:1px solid rgba(255,194,71,.18)}
.vh-chip b{color:var(--glow,#ffe7b8)}
.vh-order{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:6px;margin-top:18px;max-width:340px}
.vh-order .ar{color:var(--ash,#b8a99a);opacity:.6;font-size:13px}
.vh-who{display:inline-flex;align-items:center;gap:6px;padding:5px 11px 5px 5px;border-radius:99px;font-weight:700;font-size:14px;
  background:rgba(23,16,11,.8);border:1px solid rgba(255,194,71,.22)}
.vh-av{width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:16px;flex:none;
  background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.18),rgba(0,0,0,0) 60%),var(--c,#ff6a1a);box-shadow:0 0 0 2px rgba(11,7,5,.9)}
.vh-demo{display:flex;gap:10px;margin-top:20px;align-items:flex-end}
.vh-demo .vh-fl{--s:40px}.vh-demo .vh-fl:nth-child(2){--s:50px}.vh-demo .vh-fl:nth-child(3){--s:62px}
.vh-btn{appearance:none;border:0;cursor:pointer;position:relative;overflow:hidden;min-width:210px;min-height:58px;padding:0 30px;border-radius:99px;
  font:900 18px/1 "Unbounded",system-ui,sans-serif;color:#2a0d02;letter-spacing:.01em;
  background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a) 70%,var(--blaze,#e8401c));
  box-shadow:0 0 0 1px rgba(255,231,184,.35) inset,0 10px 30px rgba(232,64,28,.45),0 0 60px rgba(255,106,26,.25);transition:transform .12s,filter .25s,opacity .25s}
.vh-btn:active{transform:scale(.97)}
.vh-btn[disabled]{filter:grayscale(.5) brightness(.62);cursor:default}
.vh-btn .fill{position:absolute;left:0;top:0;bottom:0;width:calc(var(--p,1) * 100%);background:rgba(255,243,208,.28);pointer-events:none;transition:width .2s linear}
.vh-btn span{position:relative}
.vh-howto .vh-btn{margin-top:24px}
.vh-ghost{appearance:none;cursor:pointer;min-height:44px;padding:0 18px;border-radius:99px;font:700 14px/1 system-ui,sans-serif;color:var(--glow,#ffe7b8);
  background:rgba(23,16,11,.75);border:1px solid rgba(255,194,71,.28);transition:transform .12s}
.vh-ghost:active{transform:scale(.97)}
.vh .mini-countdown{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font:900 clamp(56px,20vw,96px)/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);text-shadow:0 0 30px rgba(255,106,26,.9),0 4px 0 #6a1c04;
  background:radial-gradient(circle at 50% 50%,rgba(11,7,5,.2),rgba(11,7,5,.7))}
.vh .mini-countdown.pop{animation:vh-cd .7s ease-out}
@keyframes vh-cd{0%{transform:scale(1.6);opacity:0}25%{transform:scale(1);opacity:1}100%{transform:scale(.92);opacity:.85}}
/* Vlammen: donkere basis + oplichtende vulling van onder naar boven (--f 0..1) */
.vh-fl{--s:84px;--f:0;position:relative;display:inline-block;width:var(--s);height:var(--s);flex:none}
.vh-fl svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.vh-fl .b path{fill:#24170f;stroke:rgba(255,194,71,.28);stroke-width:1.2}
.vh-fl .lw{position:absolute;inset:0;transform-origin:50% 92%;filter:drop-shadow(0 0 7px rgba(255,140,40,.85)) drop-shadow(0 0 20px rgba(255,106,26,.5))}
.vh-fl .l{clip-path:inset(calc((1 - var(--f)) * 100%) 0 0 0);transition:clip-path .45s cubic-bezier(.2,.8,.2,1)}
.vh-fl:not(.on) .lw{filter:none}
.vh-fl.on .lw{animation:vh-lick 1.6s ease-in-out infinite}
.vh-fl .core{fill:#fff3d0;opacity:.85}
@keyframes vh-lick{0%,100%{transform:scale(1,1) skewX(0)}25%{transform:scale(.97,1.05) skewX(-2deg)}50%{transform:scale(1.02,.97) skewX(1deg)}75%{transform:scale(.98,1.04) skewX(2deg)}}
/* Speelscherm */
.vh-play{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;touch-action:none;
  padding:max(14px,env(safe-area-inset-top)) 16px max(18px,env(safe-area-inset-bottom))}
.vh-top{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:40px}
.vh-pips{display:flex;align-items:center;gap:6px;min-width:0}
.vh-pip{position:relative;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;
  background:rgba(23,16,11,.85);border:1.5px solid rgba(255,194,71,.18);opacity:.55;transition:all .4s}
.vh-pip.now{opacity:1;border-color:var(--flame,#ffc247);box-shadow:0 0 0 3px rgba(255,194,71,.18),0 0 18px rgba(255,140,40,.6);transform:scale(1.1)}
.vh-pip.done{opacity:.95;border-color:rgba(255,106,26,.6)}
.vh-pip i{position:absolute;right:-5px;bottom:-5px;font:900 9px/1 "Unbounded",system-ui,sans-serif;font-style:normal;color:#2a0d02;
  background:var(--flame,#ffc247);border-radius:99px;padding:3px 4px;box-shadow:0 0 8px rgba(255,194,71,.7)}
.vh-count{font:800 11px/1.2 system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--ash,#b8a99a);white-space:nowrap}
.vh-fuse{position:relative;height:16px;margin:8px 2px 0;display:none;align-items:center;gap:8px}
.vh-fuse.on{display:flex}
.vh-fuse .tr{position:relative;flex:1;height:4px;border-radius:9px;background:rgba(138,90,54,.35)}
.vh-fuse .tr b{position:absolute;left:0;top:0;bottom:0;width:calc(var(--t,1) * 100%);border-radius:9px;
  background:linear-gradient(90deg,#8a5a36,#d8913f);transition:width .25s linear}
.vh-fuse .tr b::after{content:"";position:absolute;right:-6px;top:50%;width:12px;height:12px;margin-top:-6px;border-radius:50%;
  background:radial-gradient(#fff3d0,#ffc247 40%,rgba(255,106,26,0) 72%);box-shadow:0 0 14px 4px rgba(255,140,40,.7);animation:vh-flick 0.6s infinite}
.vh-fuse span{font:800 12px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);min-width:34px;text-align:right;font-variant-numeric:tabular-nums}
.vh-fuse.out span{color:var(--blaze,#e8401c)}
.vh-main{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;align-items:stretch;gap:14px;padding:6px 0}
.vh-foot{display:flex;flex-direction:column;align-items:center;gap:10px;padding-bottom:clamp(64px,13vh,118px)}
.vh-head{text-align:center}
.vh-pill{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border-radius:99px;font:900 12px/1 "Unbounded",system-ui,sans-serif;
  letter-spacing:.06em;text-transform:uppercase;color:#2a0d02;background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a));
  box-shadow:0 0 22px rgba(255,106,26,.45)}
.vh-big{font:900 clamp(24px,7.6vw,32px)/1.08 "Unbounded",system-ui,sans-serif;letter-spacing:-.02em;margin:10px 0 0;color:var(--glow,#ffe7b8);
  text-shadow:0 0 24px rgba(255,140,40,.35)}
.vh-big .vh-av{width:40px;height:40px;font-size:22px;vertical-align:-8px;margin-right:6px}
.vh-dots{display:inline-flex;gap:4px;margin-left:4px;vertical-align:middle}
.vh-dots i{width:6px;height:6px;border-radius:50%;background:var(--flame,#ffc247);animation:vh-dot 1.4s ease-in-out infinite}
.vh-dots i:nth-child(2){animation-delay:.2s}.vh-dots i:nth-child(3){animation-delay:.4s}
@keyframes vh-dot{0%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-4px)}}
.vh-sub{font-size:15px;line-height:1.4;color:var(--ash,#b8a99a);margin:8px auto 0;max-width:320px}
/* Kaart */
.vh-card{position:relative;border-radius:22px;padding:20px 20px 18px;text-align:left;overflow:hidden;
  background:linear-gradient(165deg,rgba(255,231,184,.10),rgba(255,231,184,.02) 55%),linear-gradient(180deg,#21160e,#150d08);
  border:1px solid rgba(255,194,71,.30);
  box-shadow:inset 0 1px 0 rgba(255,231,184,.16),0 22px 50px rgba(0,0,0,.6),0 0 70px rgba(255,106,26,.14);animation:vh-deal .7s cubic-bezier(.2,.9,.25,1) both}
.vh-card::before{content:"";position:absolute;inset:auto -20% -60% -20%;height:110%;pointer-events:none;
  background:radial-gradient(50% 50% at 50% 50%,rgba(255,130,40,.20),rgba(255,106,26,0));animation:vh-breathe 4.2s ease-in-out infinite}
.vh-card::after{content:"";position:absolute;inset:7px;border-radius:16px;border:1px dashed rgba(255,194,71,.12);pointer-events:none}
.vh-card.small{padding:14px 16px 13px;border-radius:18px}
@keyframes vh-deal{0%{opacity:0;transform:translateY(26px) rotate(-3deg) scale(.96)}100%{opacity:1;transform:none}}
.vh-ck{position:relative;display:flex;align-items:center;justify-content:space-between;font:800 10.5px/1 system-ui,sans-serif;letter-spacing:.2em;
  text-transform:uppercase;color:var(--ember,#ff6a1a)}
.vh-ck em{font-style:normal;color:var(--ash,#b8a99a);letter-spacing:.12em}
.vh-q{position:relative;margin:12px 0 0;font:italic 500 clamp(21px,6.3vw,27px)/1.28 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  color:#fff1d6;text-wrap:balance;text-shadow:0 1px 0 rgba(0,0,0,.5)}
.vh-card.big .vh-q{font-size:clamp(23px,7.2vw,30px)}
.vh-card.small .vh-q{font-size:clamp(16px,4.6vw,19px);margin-top:8px}
.vh-op{position:relative;margin:14px 0 0;padding:10px 12px;border-radius:12px;background:rgba(90,169,255,.08);border:1px solid rgba(90,169,255,.28);
  font-size:13.5px;line-height:1.35;color:var(--glow,#ffe7b8)}
.vh-op b,.vh-tw b{display:block;font:800 10px/1 system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:var(--blue,#5aa9ff);margin-bottom:6px}
.vh-op span{font-family:"Iowan Old Style",Palatino,Georgia,serif;font-style:italic;font-size:15px}
.vh-tw{position:relative;margin:12px 0 0}
.vh-tw b{color:var(--flame,#ffc247)}
.vh-tw span{display:inline-block;margin:0 6px 6px 0;padding:7px 11px;border-radius:10px;font-weight:700;font-size:14px;color:#2a0d02;
  background:linear-gradient(180deg,#ffe7b8,#ffc247);box-shadow:0 0 14px rgba(255,194,71,.35);transform:rotate(-1.2deg)}
.vh-tw span:nth-child(odd){transform:rotate(1.4deg)}
.vh-card.small .vh-op,.vh-card.small .vh-tw{margin-top:8px}
.vh-gloei{font:italic 14px/1.4 "Iowan Old Style",Palatino,Georgia,serif;color:rgba(255,231,184,.72);text-align:center;max-width:320px;margin:0 auto}
.vh-gloei::before{content:"🔥 ";font-style:normal}
.vh-foot .vh-gloei{margin-bottom:clamp(30px,7vh,56px)}
/* Beoordelen */
.vh-rate{display:flex;justify-content:center;align-items:flex-end;gap:clamp(6px,3vw,16px);margin-top:4px}
.vh-rb{appearance:none;border:0;background:none;cursor:pointer;padding:6px 4px 2px;border-radius:20px;display:flex;flex-direction:column;align-items:center;gap:4px;
  color:var(--ash,#b8a99a);font:900 13px/1 "Unbounded",system-ui,sans-serif;transition:transform .18s}
.vh-rb:active{transform:scale(.94)}
.vh-rb .vh-fl{--s:clamp(70px,22vw,96px)}
.vh-rb:nth-child(1) .vh-fl{--s:clamp(62px,19vw,82px)}.vh-rb:nth-child(3) .vh-fl{--s:clamp(80px,25vw,110px)}
.vh-rb.on{color:var(--flame,#ffc247)}
.vh-rw{min-height:26px;text-align:center;font:900 18px/1.3 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);text-shadow:0 0 18px rgba(255,140,40,.6)}
.vh-raters{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:12px}
.vh-rp{display:inline-flex;align-items:center;gap:6px;padding:5px 11px 5px 5px;border-radius:99px;font-size:13.5px;font-weight:700;color:var(--ash,#b8a99a);
  background:rgba(23,16,11,.8);border:1px solid rgba(255,194,71,.15);transition:all .3s}
.vh-rp.ok{color:var(--glow,#ffe7b8);border-color:rgba(255,194,71,.55);box-shadow:0 0 16px rgba(255,140,40,.25)}
.vh-rp.ok::after{content:"🔥";font-size:13px}
.vh-mine{display:flex;justify-content:center;gap:6px;margin-top:12px}
.vh-mine .vh-fl{--s:54px}
/* Onthulling */
.vh-rev{position:absolute;inset:0;z-index:7;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px 20px 150px;
  background:radial-gradient(70% 50% at 50% 42%,rgba(60,22,6,.55),rgba(11,7,5,.35) 70%,rgba(11,7,5,0));animation:vh-in .35s ease-out both}
.vh-play{transition:opacity .35s,filter .35s}
.vh.revealing .vh-play{opacity:0;filter:blur(6px)}
.vh-rev.out{animation:vh-out .45s ease-in both}
@keyframes vh-in{from{opacity:0}to{opacity:1}}@keyframes vh-out{to{opacity:0}}
.vh-rev .row{display:flex;gap:10px;align-items:flex-end;margin-top:20px}
.vh-rev .vh-fl{--s:clamp(66px,21vw,92px)}
.vh-rev .row .vh-fl:nth-child(2){--s:clamp(78px,25vw,108px)}
.vh-rev .avg{font:900 clamp(46px,15vw,64px)/1 "Unbounded",system-ui,sans-serif;margin-top:16px;color:var(--flame,#ffc247);
  text-shadow:0 0 30px rgba(255,106,26,.8);opacity:0;transform:scale(.7);transition:all .5s cubic-bezier(.2,1.4,.4,1)}
.vh-rev .avg.on{opacity:1;transform:none}
.vh-rev .avg small{display:block;font:700 13px/1.4 system-ui,sans-serif;color:var(--ash,#b8a99a);text-shadow:none;margin-top:6px}
/* Klaar */
.vh-done{z-index:6}
.vh-list{width:100%;max-width:340px;display:flex;flex-direction:column;gap:8px;margin-top:18px}
.vh-li{position:relative;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:16px;text-align:left;
  background:rgba(23,16,11,.82);border:1px solid rgba(255,194,71,.18);animation:vh-deal .6s cubic-bezier(.2,.9,.25,1) both}
.vh-li.mvp{border-color:rgba(255,194,71,.6);box-shadow:0 0 26px rgba(255,140,40,.25)}
.vh-li .nm{flex:1;min-width:0;font-weight:800;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.vh-li .nm small{display:block;font-weight:500;font-size:12px;color:var(--ash,#b8a99a);overflow:hidden;text-overflow:ellipsis}
.vh-li .fs{display:flex;gap:2px}.vh-li .vh-fl{--s:24px}
.vh-li .sc{font:900 15px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);min-width:30px;text-align:right}
.vh-li .cr{position:absolute;left:-6px;top:-10px;font-size:18px;transform:rotate(-18deg)}
.vh-end{font-size:17px;margin-top:18px}
.vh-wait{margin-top:18px;font-size:14px;color:var(--ash,#b8a99a)}
@media (max-height:640px){.vh-q{font-size:clamp(18px,5.6vw,22px)}.vh-card{padding:15px 16px 14px}.vh-foot{padding-bottom:58px}.vh-stove{height:96px}
  .vh-rb .vh-fl{--s:64px}.vh-rb:nth-child(1) .vh-fl{--s:56px}.vh-rb:nth-child(3) .vh-fl{--s:74px}.vh-scr{padding-bottom:110px}}
@media (prefers-reduced-motion:reduce){.vh::before,.vh-card,.vh-card::before,.vh-fl.on .lw,.vh-dots i,.vh-stove::after,.vh-li,.vh-fuse .tr b::after{animation:none}}
`;

  function injectCss() {
    if (document.getElementById("mini-verhaal-css")) return;
    const s = document.createElement("style");
    s.id = "mini-verhaal-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const FP = "M24 2c2.6 8.4 13 13.6 13 27.4a13 13 0 0 1-26 0c0-7.2 3.6-12 8.4-15.4-.5 4.9 1.1 8.4 4 10C22 18 21.6 9.4 24 2z";
  const CORE = "M24 26.5c2.8 3.2 5 5.7 5 9a5 5 0 0 1-10 0c0-3.3 2.2-5.8 5-9z";
  const GLOEI_TELL = [
    "Gloei leunt naar voren. Gloei leunt altijd naar voren.",
    "Gloei knispert zachtjes mee, alsof hij het spannend vindt.",
    "Gloei dempt zijn vlammen om beter te kunnen horen.",
    "Gloei doet alsof hij niet meeluistert. Hij luistert mee.",
    "Gloei: \"Langzaam vertellen. Ik wil van elk woord eten.\"",
    "Gloei: \"Ooh. Dit wordt een goeie, dat voel ik in mijn kooltjes.\"",
  ];
  const GLOEI_REV = ["Gloei sputtert beleefd.", "Gloei knikt. Met zijn hele vlam.", "Gloei slaakt een tevreden zucht. Er vliegen vonken uit."];

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  let uid = 0;

  function mount(el, ctx) {
    injectCss();
    let v = ctx.view || null;
    const d = dl(v ? v.d : ctx.difficulty), c = CFG[d];
    const sfx = ctx.sfx || {};
    const beep = (...a) => { try { sfx.beep && sfx.beep(...a); } catch (e) { /* geen geluid */ } };
    const buzz = (p) => { try { sfx.buzz && sfx.buzz(p); } catch (e) { /* geen tril */ } };
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const players = ctx.players || [];
    const pl = (pid) => players.find((p) => p.pid === pid) || { pid, name: "Iemand", avatar: "🙂", color: "#8a5a36" };
    const nameOf = (pid) => pl(pid).name || "Iemand";
    const gid = "vh" + (++uid) + "g";
    const seed = ctx.seed >>> 0;

    const root = h("div", "vh");
    el.appendChild(root);
    let dead = false, phase = "howto", raf = 0, key = "", seenLog = v ? v.history.length : 0, sel = 0;
    let turnT0 = 0, rateT0 = 0, turnSeen = -1, rateSeen = -1, outTurn = -1;
    const revQ = [];
    let revEl = null, finished = false;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!dead) fn(); }, ms); timers.add(t); return t; };
    const offs = [];
    const on = (node, type, fn, opt) => { node.addEventListener(type, fn, opt); offs.push(() => node.removeEventListener(type, fn, opt)); };
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

    // Gradiënt voor de vlammetjes (uniek per telefoon, meerdere telefoons op één pagina in de testbank).
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    defs.setAttribute("width", "0"); defs.setAttribute("height", "0"); defs.setAttribute("aria-hidden", "true");
    defs.style.position = "absolute";
    defs.innerHTML = '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3d0"/><stop offset=".35" stop-color="#ffc247"/><stop offset=".75" stop-color="#ff6a1a"/><stop offset="1" stop-color="#e8401c"/></linearGradient></defs>';
    root.appendChild(defs);
    function flame(f) {
      const s = h("span", "vh-fl" + (f > 0 ? " on" : ""));
      s.style.setProperty("--f", String(Math.max(0, Math.min(1, f))));
      s.innerHTML = '<svg class="b" viewBox="0 0 48 48" aria-hidden="true"><path d="' + FP + '"/></svg>' +
        '<span class="lw"><svg class="l" viewBox="0 0 48 48" aria-hidden="true"><path fill="url(#' + gid + ')" d="' + FP + '"/><path class="core" d="' + CORE + '"/></svg></span>';
      return s;
    }
    const setFlame = (s, f) => { s.style.setProperty("--f", String(Math.max(0, Math.min(1, f)))); s.classList.toggle("on", f > 0); };
    const flameRow = (avg, cls) => { const r = h("div", cls || "fs"); for (let i = 1; i <= 3; i++) r.appendChild(flame(Math.max(0, Math.min(1, avg - (i - 1))))); return r; };
    function avatar(pid, cls) {
      const p = pl(pid);
      const a = h("span", "vh-av" + (cls ? " " + cls : ""), p.avatar || "🙂");
      a.style.setProperty("--c", p.color || "#8a5a36");
      return a;
    }

    // --- De kachel (echt vuur via DVFire als dat er is) ---
    const stove = h("div", "vh-stove");
    const fcv = h("canvas", "vh-fire");
    stove.append(fcv, h("div", "vh-grate"));
    root.appendChild(stove);
    let fire = null;
    try { if (ctx.fire && ctx.fire.flame) { fire = ctx.fire.flame(fcv, { intensity: 0.55, embers: true, blueTips: true, logs: true }); stove.classList.add("lit"); } }
    catch (e) { fire = null; }
    const fireTo = (x) => { if (fire) try { fire.setIntensity(x); } catch (e) { /* stil */ } };
    const fireBurst = () => { if (fire) try { fire.burst(); } catch (e) { /* stil */ } };
    // Hoe warmer de verhalen tot nu toe, hoe hoger het vuur (0,42 → 0,92 bij louter drie vlammen).
    const warmth = (n) => { if (!v) return 0.5; const hs = v.history.slice(0, n == null ? v.history.length : n); return 0.42 + 0.5 * hs.reduce((a, e) => a + e.avg, 0) / (3 * Math.max(1, v.turns)); };

    // --- Trage gloeiende sintels over het hele scherm ---
    const cv = h("canvas", "vh-cv");
    root.appendChild(cv);
    const g = cv.getContext && cv.getContext("2d");
    const drng = M.rng(seed ^ 0xe4b3);
    const motes = Array.from({ length: reduced ? 6 : 22 }, () => ({ x: drng(), y: drng(), r: 0.7 + drng() * 1.7, sp: 0.012 + drng() * 0.03, ph: drng() * 6.28, hue: drng() }));
    let W = 0, H = 0, dpr = 1, last = 0;
    const sparks = []; // vonkjes bij stemmen en onthullen (px, px/s, s)
    function fit() {
      if (dead) return;
      const r = root.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      if (reduced) frame(now()); // canvas is net gewist: stilstaand beeld opnieuw tekenen
    }
    // Vonkenfontein vanuit een element (alleen met beweging aan).
    function spark(node, n, up) {
      if (reduced || !node || !node.getBoundingClientRect || sparks.length > 220) return;
      const rr = root.getBoundingClientRect(), b = node.getBoundingClientRect();
      if (!b.width) return;
      const x0 = b.left - rr.left + b.width / 2, y0 = b.top - rr.top + b.height * (up ? 0.25 : 0.5);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * (up ? 1.3 : 2.6), sp = 90 + Math.random() * 260;
        sparks.push({ x: x0 + (Math.random() - 0.5) * b.width * 0.5, y: y0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0, max: 0.55 + Math.random() * 0.75, r: 1 + Math.random() * 1.8, hot: Math.random() });
      }
    }
    function frame(ts) {
      if (dead) return;
      if (!reduced) raf = requestAnimationFrame(frame);
      if (!g) return;
      const dt = Math.min(0.05, last ? Math.max(0, ts - last) / 1000 : 0.016); last = ts;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = "lighter";
      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.life += dt;
        if (p.life >= p.max) { sparks.splice(i, 1); continue; }
        const k = Math.pow(0.12, dt); // luchtweerstand, per seconde
        p.vx *= k; p.vy = p.vy * k - 40 * dt; // warme lucht trekt ze omhoog
        p.x += p.vx * dt; p.y += p.vy * dt;
        const a = 1 - p.life / p.max;
        g.fillStyle = p.hot < 0.3 ? "rgba(255,243,208," + a.toFixed(3) + ")" : p.hot < 0.75 ? "rgba(255,194,71," + a.toFixed(3) + ")" : "rgba(255,106,26," + a.toFixed(3) + ")";
        g.beginPath(); g.arc(p.x, p.y, p.r * (0.5 + a * 0.6), 0, 6.283); g.fill();
      }
      motes.forEach((m) => {
        m.y -= m.sp * dt; m.x += Math.sin(ts / 3100 + m.ph) * 0.013 * dt;
        if (m.y < -0.03) { m.y = 1.03; m.x = 0.2 + drng() * 0.6; }
        const life = Math.max(0, Math.min(1, m.y * 1.3)); // doven langzaam uit naar boven
        const tw = 0.6 + 0.4 * Math.sin(ts / 420 + m.ph * 3);
        const a = life * tw;
        const x = m.x * W, y = m.y * H, rr = m.r * (0.6 + 0.4 * life);
        const grd = g.createRadialGradient(x, y, 0, x, y, rr * 4);
        const col = m.hue < 0.08 ? "140,200,255" : m.hue < 0.5 ? "255,200,110" : "255,120,40";
        grd.addColorStop(0, "rgba(" + col + "," + (0.9 * a).toFixed(3) + ")");
        grd.addColorStop(1, "rgba(" + col + ",0)");
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, rr * 4, 0, 6.283); g.fill();
      });
      g.globalCompositeOperation = "source-over";
    }

    // --- Howto ---
    const how = h("div", "vh-scr vh-howto");
    how.appendChild(h("div", "vh-kicker", "Het uur van de wolf · " + c.name));
    how.appendChild(h("h2", "vh-title vh-disp", "Verhalen bij het vuur"));
    how.appendChild(h("p", "vh-text", "Om de beurt vertel je hardop een verhaal bij je kaart; de anderen geven je één tot drie vlammen."));
    const demo = h("div", "vh-demo");
    [1, 1, 1].forEach((f) => demo.appendChild(flame(f)));
    how.appendChild(demo);
    const order = h("div", "vh-order");
    (v ? v.tellers : players.map((p) => p.pid)).forEach((pid, i) => {
      if (i) order.appendChild(h("span", "ar", "→"));
      const w = h("span", "vh-who");
      w.append(avatar(pid), document.createTextNode(nameOf(pid)));
      order.appendChild(w);
    });
    how.appendChild(order);
    const chips = h("div", "vh-chips");
    const chip = (txt, b) => { const x = h("span", "vh-chip"); x.appendChild(document.createTextNode(txt)); if (b) x.appendChild(h("b", null, b)); chips.appendChild(x); };
    chip("🃏 ", c.swaps ? c.swaps + "× andere kaart" : "Geen ruilen");
    if (c.twists) chip("✍️ ", c.twists === 1 ? "1 verplicht woord" : c.twists + " verplichte woorden");
    if (c.opener) chip("📜 ", "Vaste openingszin");
    chip("⏳ ", c.limit ? "±" + c.limit + " s per verhaal" : "Geen haast");
    how.appendChild(chips);
    const startBtn = h("button", "vh-btn");
    startBtn.type = "button";
    startBtn.appendChild(h("span", null, "Start"));
    how.appendChild(startBtn);
    root.appendChild(how);

    // --- Speelscherm ---
    const play = h("div", "vh-play");
    const top = h("div", "vh-top");
    const pips = h("div", "vh-pips");
    const count = h("div", "vh-count");
    top.append(pips, count);
    const fuse = h("div", "vh-fuse");
    const fuseTr = h("div", "tr");
    const fuseB = h("b");
    fuseTr.appendChild(fuseB);
    const fuseT = h("span");
    fuse.append(h("span", null, "⏳"), fuseTr, fuseT);
    const main = h("div", "vh-main");
    const foot = h("div", "vh-foot");
    play.append(top, fuse, main, foot);
    let pipEls = [];
    let klaarBtn = null, skipBtn = null, raterEls = {};

    function buildPips() {
      pips.textContent = "";
      pipEls = (v ? v.tellers : []).map((pid) => {
        const p = h("div", "vh-pip", pl(pid).avatar || "🙂");
        p.title = nameOf(pid);
        pips.appendChild(p);
        return p;
      });
    }
    function updatePips() {
      if (!v) return;
      pipEls.forEach((p, i) => {
        p.classList.toggle("now", !v.done && i === v.turn);
        const hst = v.history[i];
        p.classList.toggle("done", !!hst);
        let badge = p.querySelector("i");
        if (hst && !badge) { badge = h("i", null, fmt1(hst.avg)); p.appendChild(badge); }
      });
      count.textContent = v.done ? "Klaar" : "Verhaal " + (v.turn + 1) + " / " + v.turns;
      Object.keys(raterEls).forEach((pid) => raterEls[pid].classList.toggle("ok", v.voted.includes(pid)));
    }

    function card(small) {
      const k = h("div", "vh-card" + (small ? " small" : " big"));
      const ck = h("div", "vh-ck");
      ck.append(document.createTextNode("🔥 Vuurpraat"), h("em", null, "Kaart " + (v.turn + 1)));
      k.appendChild(ck);
      k.appendChild(h("p", "vh-q", v.prompt || ""));
      if (v.opener) {
        const o = h("div", "vh-op");
        o.append(h("b", null, "Begin met"), h("span", null, "“" + v.opener + "”"));
        k.appendChild(o);
      }
      if (v.twists && v.twists.length) {
        const t = h("div", "vh-tw");
        t.appendChild(h("b", null, "Verwerk erin"));
        v.twists.forEach((w) => t.appendChild(h("span", null, w)));
        k.appendChild(t);
      }
      return k;
    }
    function raterRow(list) {
      raterEls = {};
      const r = h("div", "vh-raters");
      list.forEach((pid) => {
        const x = h("span", "vh-rp");
        x.append(avatar(pid), document.createTextNode(nameOf(pid)));
        raterEls[pid] = x;
        r.appendChild(x);
      });
      return r;
    }
    const gloeiLine = () => GLOEI_TELL[(seed + v.turn * 7) % GLOEI_TELL.length];

    function render() {
      if (!v || phase !== "play") return;
      if (v.stage === "tell" && turnSeen !== v.turn) { turnSeen = v.turn; turnT0 = now(); }
      if (v.stage === "rate" && rateSeen !== v.turn) { rateSeen = v.turn; rateT0 = now(); sel = 0; }
      const k = [v.turn, v.stage, v.role, v.prompt, v.swapsLeft, v.myVote === null ? 0 : 1, v.done ? 1 : 0].join("|");
      if (k !== key) {
        key = k;
        build();
      }
      updatePips();
      tickUI();
    }

    // Komt er binnen 4 s geen nieuwe toestand (actie onderweg kwijt), dan mag je opnieuw tikken.
    const unstick = (btn, fn) => { const k0 = key; later(() => { if (key === k0 && btn.isConnected) { btn.disabled = false; if (fn) fn(); } }, 4000); };
    function build() {
      main.textContent = ""; foot.textContent = "";
      klaarBtn = null; skipBtn = null; raterEls = {};
      if (v.done) return;
      const tName = nameOf(v.teller);
      const head = h("div", "vh-head");
      if (v.stage === "tell") {
        fireTo(warmth());
        if (v.role === "teller") {
          head.appendChild(h("span", "vh-pill", "🎙️ Jouw beurt"));
          head.appendChild(h("div", "vh-big", "Vertel maar…"));
          main.append(head, card(false));
          if (v.swapsLeft > 0) {
            const sw = h("button", "vh-ghost", "🔄 Andere kaart · nog " + v.swapsLeft);
            sw.type = "button";
            on(sw, "click", () => { if (sw.disabled) return; sw.disabled = true; beep(380, 0.06, "sine", 0.06); buzz(10); ctx.send({ t: "swap" }); unstick(sw); });
            foot.appendChild(sw);
          }
          const kb = klaarBtn = h("button", "vh-btn");
          kb.type = "button";
          kb.disabled = true;
          kb.append(h("i", "fill"), h("span", null, "Klaar met vertellen"));
          on(kb, "click", () => {
            if (kb.disabled || kb.dataset.sent) return;
            kb.disabled = true;
            kb.dataset.sent = "1";
            beep(660, 0.12, "triangle", 0.08); buzz(25);
            spark(kb, 18, true);
            ctx.send({ t: "klaar" });
            unstick(kb, () => { delete kb.dataset.sent; });
          });
          foot.appendChild(kb);
        } else {
          const b = h("div", "vh-big");
          b.append(avatar(v.teller), document.createTextNode(tName + " vertelt"));
          const dots = h("span", "vh-dots"); dots.append(h("i"), h("i"), h("i"));
          b.appendChild(dots);
          head.appendChild(b);
          head.appendChild(h("p", "vh-sub", v.role === "kijker" ? "Luister mee." : "Luister goed. Straks geef je vlammen."));
          main.append(head, card(true));
          foot.appendChild(h("p", "vh-gloei", gloeiLine()));
        }
        return;
      }
      // stage "rate"
      fireTo(warmth() + 0.04);
      if (v.role === "luisteraar" && v.myVote === null) {
        head.appendChild(h("div", "vh-kicker", "Jouw oordeel · geheim"));
        const b = h("div", "vh-big");
        b.append(document.createTextNode("Hoeveel vlammen voor "), avatar(v.teller), document.createTextNode(tName + "?"));
        head.appendChild(b);
        main.appendChild(head);
        const row = h("div", "vh-rate");
        const word = h("div", "vh-rw", sel ? RATE_WORD[sel] : "");
        const btns = [1, 2, 3].map((n) => {
          const bt = h("button", "vh-rb");
          bt.type = "button";
          bt.setAttribute("aria-label", n + (n === 1 ? " vlam" : " vlammen"));
          bt.dataset.n = String(n);
          const fl = flame(0);
          bt.append(fl, h("span", null, String(n)));
          row.appendChild(bt);
          return { bt, fl };
        });
        const paint = () => btns.forEach((x, i) => { setFlame(x.fl, i < sel ? 1 : 0); x.bt.classList.toggle("on", i < sel); x.bt.setAttribute("aria-pressed", String(i + 1 === sel)); });
        const give = h("button", "vh-btn");
        give.type = "button";
        const giveT = h("span", null, "Kies je vlammen");
        give.append(h("i", "fill"), giveT);
        give.disabled = !sel;
        let sent = false;
        const setSel = (n) => {
          if (sent) return; // al verstuurd: niet stiekem nog een stem klaarzetten
          sel = n; paint();
          word.textContent = RATE_WORD[n];
          giveT.textContent = "Geef " + n + (n === 1 ? " vlam" : " vlammen");
          give.disabled = false;
          beep(420 + n * 120, 0.07, "sine", 0.07); buzz(12);
          spark(btns[n - 1].fl, 4 + n * 3, true);
        };
        btns.forEach((x, i) => { x.bt.setAttribute("aria-pressed", "false"); on(x.bt, "click", () => setSel(i + 1)); });
        on(give, "click", () => {
          if (!sel || give.disabled || sent) return;
          give.disabled = true; sent = true;
          const n = sel;
          beep(520 + n * 140, 0.16, "triangle", 0.09); buzz([20, 40, 20]);
          btns.slice(0, n).forEach((x) => spark(x.fl, 8, true));
          ctx.send({ t: "rate", n });
          unstick(give, () => { sent = false; });
        });
        if (sel) { paint(); giveT.textContent = "Geef " + sel + (sel === 1 ? " vlam" : " vlammen"); }
        main.append(row, word);
        foot.appendChild(give);
        return;
      }
      if (v.role === "luisteraar") {
        head.appendChild(h("div", "vh-kicker", "Gegeven"));
        head.appendChild(h("div", "vh-big", "Jouw vlammen zijn binnen"));
        const mine = h("div", "vh-mine");
        for (let i = 1; i <= 3; i++) mine.appendChild(flame(i <= v.myVote ? 1 : 0));
        head.appendChild(mine);
        head.appendChild(h("p", "vh-sub", "Nog even wachten op de rest…"));
        head.appendChild(raterRow(v.raters));
        main.appendChild(head);
        return;
      }
      // verteller (of kijker) wacht op het oordeel
      head.appendChild(h("div", "vh-kicker", v.role === "teller" ? "Mooi verteld" : "Beoordelen"));
      head.appendChild(h("div", "vh-big", v.role === "teller" ? "De vlammen worden geteld…" : tName + " krijgt vlammen…"));
      head.appendChild(h("p", "vh-sub", v.role === "teller" ? "Geheim tot iedereen heeft gekozen. Even op je handen zitten." : "Geheim tot iedereen heeft gekozen."));
      head.appendChild(raterRow(v.raters));
      main.appendChild(head);
      foot.appendChild(h("p", "vh-gloei", "Gloei houdt zijn adem in. Voor zover een vuur dat kan."));
      if (v.role === "teller") {
        skipBtn = h("button", "vh-ghost", "Niet langer wachten");
        skipBtn.type = "button";
        skipBtn.style.display = "none";
        const sb = skipBtn;
        on(sb, "click", () => { if (sb.disabled) return; sb.disabled = true; ctx.send({ t: "next" }); unstick(sb); });
        foot.appendChild(skipBtn);
      }
    }

    // Klokje: zandloper, opwarm-vulling van "Klaar", wacht-knop.
    function tickUI() {
      if (!v || phase !== "play" || v.done) { fuse.classList.remove("on"); return; }
      const t = now();
      const telling = v.stage === "tell";
      // Zolang de uitslag van het vorige verhaal nog op het scherm staat, begint de nieuwe beurt niet.
      if (telling && revEl) turnT0 = t;
      if (c.limit && telling) {
        const left = Math.max(0, c.limit * 1000 - (t - turnT0));
        fuse.classList.add("on");
        fuse.classList.toggle("out", left <= 0);
        fuseB.style.setProperty("--t", String(left / (c.limit * 1000)));
        fuseT.textContent = left > 0 ? Math.ceil(left / 1000) + "s" : "Tijd!";
        if (klaarBtn && left <= 0 && !klaarBtn.dataset.out) { klaarBtn.dataset.out = "1"; klaarBtn.lastChild.textContent = "Rond af · Klaar"; }
        if (left <= 0 && outTurn !== v.turn) {
          outTurn = v.turn;
          if (v.role === "teller") { beep(300, 0.2, "sine", 0.06); buzz([30, 60, 30]); }
        }
      } else fuse.classList.remove("on");
      if (klaarBtn && !klaarBtn.dataset.sent) {
        const p = Math.min(1, (t - turnT0) / WARMUP);
        klaarBtn.style.setProperty("--p", String(p));
        klaarBtn.disabled = p < 1;
      }
      if (skipBtn) {
        const missing = v.raters.filter((p) => !v.voted.includes(p));
        const show = v.voted.length > 0 && missing.length > 0 && t - rateT0 > SKIP_AFTER;
        skipBtn.style.display = show ? "" : "none";
        if (show) skipBtn.textContent = "Verder zonder " + joinNames(missing.map(nameOf));
      }
    }
    const tickId = setInterval(() => { if (!dead) tickUI(); }, 200);

    // --- Onthulling na elk verhaal ---
    function queueReveals() {
      if (!v) return;
      while (seenLog < v.history.length) { revQ.push({ e: v.history[seenLog], i: seenLog }); seenLog++; }
      if (!revEl) nextReveal();
    }
    function nextReveal() {
      const q = revQ.shift();
      if (!q) { revEl = null; root.classList.remove("revealing"); if (v && v.done) showDone(); else if (v) fireTo(warmth()); return; }
      const e = q.e;
      const r = h("div", "vh-rev");
      r.setAttribute("role", "status");
      r.appendChild(h("div", "vh-kicker", e.gloei ? "Gloei oordeelt zelf" : "Verhaal " + (q.i + 1) + " · " + (e.n === 1 ? "1 stem" : e.n + " stemmen")));
      const b = h("div", "vh-big");
      b.append(avatar(e.teller), document.createTextNode(nameOf(e.teller)));
      r.appendChild(b);
      const row = h("div", "row");
      const fls = [0, 1, 2].map(() => { const f = flame(0); row.appendChild(f); return f; });
      r.appendChild(row);
      const avg = h("div", "avg", fmt1(e.avg));
      avg.appendChild(h("small", null, (e.avg >= 2.5 ? RATE_WORD[3] : e.avg >= 1.75 ? RATE_WORD[2] : RATE_WORD[1]) +
        (e.flames.length > 1 ? " · " + e.flames.join(" + ") : "")));
      r.appendChild(avg);
      r.appendChild(h("p", "vh-gloei", GLOEI_REV[Math.min(2, Math.max(0, Math.round(e.avg) - 1))]));
      root.appendChild(r);
      root.classList.add("revealing");
      revEl = r;
      const step = reduced ? 0 : 420;
      fls.forEach((f, i) => later(() => {
        const fr = Math.max(0, Math.min(1, e.avg - i));
        setFlame(f, fr);
        if (fr > 0) { beep(440 + i * 150, 0.14, "triangle", 0.07); buzz(15); spark(f, Math.round(6 + fr * 12), true); }
      }, 300 + i * step));
      later(() => {
        avg.classList.add("on");
        fireTo(Math.min(0.98, warmth(q.i + 1) + 0.1));
        if (e.avg >= 2.3) { fireBurst(); spark(avg, 30); }
        if (e.avg >= 3) { try { sfx.confetti && sfx.confetti(); } catch (x) { /* stil */ } buzz([30, 50, 30, 50, 60]); }
      }, 300 + 3 * step);
      let gone = false;
      const close = () => {
        if (gone) return; gone = true;
        r.classList.add("out");
        later(() => { r.remove(); nextReveal(); }, reduced ? 0 : 420);
      };
      later(close, reduced ? 2400 : 4300); // tikken = sneller verder
      on(r, "click", () => { if (avg.classList.contains("on")) close(); });
    }

    // --- Klaar: samenvatting ---
    function showDone() {
      if (finished || !v || !v.done) return;
      finished = true;
      play.remove();
      fuse.classList.remove("on");
      const scr = h("div", "vh-scr vh-done");
      scr.appendChild(h("div", "vh-kicker", "Het uur van de wolf"));
      scr.appendChild(h("h2", "vh-title vh-disp", "Klaar!"));
      const log = v.done.log || [];
      const top = log.length ? Math.max(...log.map((e) => e.avg)) : 0;
      const tops = log.filter((e) => e.avg === top);
      const list = h("div", "vh-list");
      log.forEach((e, i) => {
        const li = h("div", "vh-li" + (tops.length === 1 && e === tops[0] && log.length > 1 ? " mvp" : ""));
        li.style.animationDelay = i * 0.12 + "s";
        if (li.classList.contains("mvp")) li.appendChild(h("span", "cr", "👑"));
        li.appendChild(avatar(e.teller));
        const nm = h("div", "nm", nameOf(e.teller));
        nm.appendChild(h("small", null, e.prompt || ""));
        li.appendChild(nm);
        li.appendChild(flameRow(e.avg));
        li.appendChild(h("div", "sc", fmt1(e.avg)));
        list.appendChild(li);
      });
      scr.appendChild(list);
      const all = log.length ? mean(log.map((e) => e.avg)) : 0;
      scr.appendChild(h("p", "vh-gloei vh-end", all >= 2.5 ? "Gloei: \"Ik ben er stil van. En ik ben nooit stil.\"" : all >= 1.8 ? "Gloei: \"Mooi. Ik bewaar ze in mijn kooltjes.\"" : "Gloei: \"Gezellig. Echt. Ik gaapte alleen van de rook.\""));
      const w = h("div", "vh-wait", "Klaar! Wachten op de rest…");
      scr.appendChild(w);
      root.appendChild(scr);
      fireTo(0.85); fireBurst();
      try { sfx.fanfare && sfx.fanfare(); } catch (e) { /* stil */ }
    }

    function enterPlay() {
      if (dead) return;
      phase = "play";
      root.appendChild(play);
      buildPips();
      render();
      queueReveals();
      if (v && v.done && !revEl) showDone();
    }

    on(startBtn, "click", () => {
      if (phase !== "howto") return;
      phase = "count";
      beep(1, 0.001, "sine", 0.0001); // audio ontgrendelen binnen het gebaar
      how.remove();
      const cd = ctx.countdown || ((el, o) => M.countdown(el, Object.assign({ sfx }, o)));
      cd(root, { go: "VERTEL!" }).then(() => { if (!dead) enterPlay(); });
    });

    fit();
    on(window, "resize", fit);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => fit()) : null;
    if (ro) ro.observe(root);
    raf = requestAnimationFrame(frame);

    // Terugkomen na herladen: al bezig of klaar → meteen naar het spel.
    if (v && (v.done || v.turn > 0 || v.stage === "rate")) { how.remove(); seenLog = v.history.length; enterPlay(); }

    // Testhaakje (alleen voor Playwright): leesbare toestand, geen globale variabele.
    Object.defineProperty(root, "_vh", { value: { get phase() { return phase; }, get view() { return v; }, get revealing() { return !!revEl; } }, enumerable: false });

    return {
      update(nv) {
        if (dead || !nv) return;
        v = nv;
        if (phase !== "play") { seenLog = v.history.length; return; }
        render();
        queueReveals();
      },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        clearInterval(tickId);
        if (ro) ro.disconnect();
        sparks.length = 0;
        timers.forEach(clearTimeout); timers.clear();
        offs.forEach((f) => f()); offs.length = 0;
        if (fire) try { fire.destroy(); } catch (e) { /* stil */ }
        root.remove();
      },
    };
  }

  const def = {
    id: "verhaal", title: "Verhalen bij het vuur", icon: "📖", kind: "net",
    howto: "Om de beurt vertel je hardop een verhaal bij je kaart; de anderen geven je één tot drie vlammen.",
    init, reduce, view, result, score, mount, bot,
    CFG, BAR, TWISTS, OPENERS, FALLBACK, logsFor, prompts,
  };
  M.register(def);
  if (typeof module === "object" && module.exports) module.exports = def;
})();
