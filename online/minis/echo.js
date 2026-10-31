// Minigame "echo" — net, convergentie "Op één lijn" (SPEC-3 §5, hoofdstuk "Middernacht: de Mist").
// Iedereen typt stiekem één woord. Pas als iedereen heeft ingeleverd draaien alle kaarten tegelijk om.
// Allemaal hetzelfde woord → de Mist lost op. Anders zoekt iedereen het woord dat de vorige woorden verbindt.
// Eigen eerdere woorden mag je niet herhalen. "Telt!" (iedereen eens) keurt bijna-gelijke woorden alsnog goed.
(function () {
  "use strict";
  const M = typeof DVMini !== "undefined" ? DVMini : require("./core.js");

  const MAXLEN = 24;
  // Per moeilijkheid: max. rondes, tikfout-tolerantie (lange woorden), tijd per ronde (0 = geen) en of de mist
  // oudere rondes opeet (alleen de laatste onthulling blijft zichtbaar).
  const CFG = {
    1: { name: "Nevel", rounds: 6, fuzzy: true, limit: 0, fog: false },
    2: { name: "Mist", rounds: 5, fuzzy: false, limit: 0, fog: false },
    3: { name: "Dikke mist", rounds: 4, fuzzy: false, limit: 30, fog: true },
  };
  const dl = (d) => Math.max(1, Math.min(3, Math.round(d) || 1));

  const FALLBACK = [
    "Iets wat je bij een vuur ziet", "Iets van hout", "Iets wat warm is", "Een geluid in de nacht", "Iets in een blokhut",
    "Een dier in het bos", "Iets wat mee moet op kamp", "Een winterwoord", "Iets wat je drinkt bij de kachel", "Iets wat gloeit",
    "Iets op een borrelplank", "Iets wat kraakt", "Iets in de lucht", "Iets wat oranje is", "Iets wat je aansteekt",
    "Een snack bij het vuur", "Iets wat zacht is", "Iets wat stinkt", "Iets in de schuur", "Iets wat je 's nachts hoort",
  ];
  function prompts() {
    const G = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : {};
    const p = Array.isArray(G.SYNC_PROMPTS) ? G.SYNC_PROMPTS.filter((x) => typeof x === "string" && x.trim()) : [];
    return p.length ? p : FALLBACK;
  }

  // ---------- Woorden vergelijken ----------
  // normalize: zoals Infiltrant — kleine letters, zonder accenten, leestekens en spaties.
  function normalize(str) {
    return String(str == null ? "" : str).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/[^\p{L}\p{N}]/gu, "");
  }
  const VOW = "aeiou";
  const isV = (ch) => VOW.includes(ch);
  const undouble = (s) => (s.length > 2 && s[s.length - 1] === s[s.length - 2] && !isV(s[s.length - 1]) ? s.slice(0, -1) : s);
  // Alle aannemelijke stammen: meervoud (-en/-s/-eren) en verkleinwoord (-je/-tje/-pje/-etje/-kje, ook met -s).
  function stems(str) {
    const w = normalize(str), out = new Set();
    if (!w) return out;
    out.add(w);
    const add = (s) => { if (s.length >= 2) { out.add(s); out.add(undouble(s)); } };
    const L = w.length;
    ["etjes", "etje", "tjes", "tje", "pjes", "pje", "kjes", "kje", "jes", "je"].forEach((suf) => {
      if (L - suf.length >= 2 && w.endsWith(suf)) add(w.slice(0, -suf.length));
    });
    if (L >= 5 && w.endsWith("s")) add(w.slice(0, -1));
    if (L >= 6 && w.endsWith("eren")) add(w.slice(0, -4));
    if (L >= 5 && w.endsWith("en")) {
      let s = w.slice(0, -2);
      add(s);
      const last = s[s.length - 1];
      if (last === "v" || last === "z") { s = s.slice(0, -1) + (last === "v" ? "f" : "s"); add(s); }
      // open lettergreep: bomen → boom, vuren → vuur, neven → neef
      const n = s.length;
      if (n >= 3 && !isV(s[n - 1]) && isV(s[n - 2]) && !isV(s[n - 3])) add(s.slice(0, n - 1) + s[n - 2] + s[n - 1]);
    }
    return out;
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]; row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const t = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = t;
      }
    }
    return row[b.length];
  }
  // same(a, b, fuzzy): gedeelde stam; met fuzzy ook één tikfout in woorden van 8+ letters (barbecue/barbeque).
  function same(a, b, fuzzy) {
    const A = stems(a), B = stems(b);
    if (!A.size || !B.size) return false;
    for (const x of A) if (B.has(x)) return true;
    if (fuzzy) {
      const na = normalize(a), nb = normalize(b);
      if (Math.min(na.length, nb.length) >= 8 && lev(na, nb) <= 1) return true;
    }
    return false;
  }
  // Groepjes spelers met hetzelfde woord (voor gedeeltelijke matches bij 3+).
  function groupsOf(words, pids, fuzzy) {
    const ids = pids.filter((p) => typeof words[p] === "string");
    const seen = new Set(), out = [];
    ids.forEach((p) => {
      if (seen.has(p)) return;
      const g = ids.filter((q) => !seen.has(q) && (q === p || same(words[p], words[q], fuzzy)));
      g.forEach((q) => seen.add(q));
      if (g.length > 1) out.push(g);
    });
    return out;
  }
  // Iedereen gelijk: elk paar moet kloppen (bomen~boom en bomen~bom, maar boom≁bom).
  const allSame = (words, pids, fuzzy) => pids.length > 0 && pids.every((p, i) => typeof words[p] === "string" && pids.slice(0, i).every((q) => same(words[q], words[p], fuzzy)));
  const clean = (w) => (typeof w === "string" ? w.replace(/\s+/g, " ").trim() : "");
  // "Iets…" → "iets…" (alleen als de tweede letter klein is: afkortingen en namen blijven staan)
  const lcFirst = (s) => (typeof s === "string" && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s || "");

  // ---------- Net-contract ----------
  function init({ seed, difficulty, players, rounds } = {}) {
    const d = dl(difficulty), c = CFG[d];
    const rng = M.rng(((seed >>> 0) || 1) ^ 0xec40);
    const pids = (players || []).map((p) => (typeof p === "string" ? p : p.pid)).filter((x) => typeof x === "string");
    const list = prompts();
    const prompt = list[Math.floor(rng() * list.length)];
    const max = Number.isInteger(rounds) && rounds >= 0 ? rounds : c.rounds; // 0 = onbeperkt (arcade, met "Opgeven")
    return { v: 1, d, max, fuzzy: c.fuzzy, limit: c.limit, fog: c.fog, pids, prompt, cur: {}, rounds: [], telt: [], quit: [], final: false, done: null };
  }

  const usedBy = (shared, pid, w) => shared.rounds.findIndex((r) => typeof r.words[pid] === "string" && same(r.words[pid], w, false));

  function finish(shared, rounds, success, extra) {
    const last = rounds[rounds.length - 1];
    const word = success && last ? last.words[shared.pids.find((p) => typeof last.words[p] === "string")] : null;
    return Object.assign({ success, rounds: rounds.length, telt: false, gaveUp: false, word: word || null,
      trail: rounds.map((r) => Object.assign({}, r.words)), pids: shared.pids.slice() }, extra || {});
  }

  function resolveVotes(shared, next) {
    const all = (arr) => shared.pids.every((p) => arr.includes(p));
    if (all(next.telt)) next.done = finish(shared, shared.rounds, true, { telt: true });
    else if (all(next.quit)) next.done = finish(shared, shared.rounds, false, { gaveUp: !shared.final });
    else if (shared.final && shared.pids.every((p) => next.telt.includes(p) || next.quit.includes(p))) next.done = finish(shared, shared.rounds, false);
    return next;
  }

  function reduce(shared, pid, a) {
    if (!shared || shared.done || !a || typeof a !== "object" || !shared.pids.includes(pid)) return shared;
    switch (a.t) {
      case "word": {
        if (shared.final || typeof shared.cur[pid] === "string") return shared;
        const w = clean(a.w);
        if (!w || w.length > MAXLEN || !normalize(w)) return shared;
        if (usedBy(shared, pid, w) >= 0) return shared; // eigen eerdere woorden tellen niet als nieuw
        const cur = Object.assign({}, shared.cur, { [pid]: w });
        if (!shared.pids.every((p) => typeof cur[p] === "string")) return Object.assign({}, shared, { cur });
        // Iedereen binnen: onthullen.
        const words = {};
        shared.pids.forEach((p) => { words[p] = cur[p]; });
        const match = allSame(words, shared.pids, shared.fuzzy);
        const rounds = shared.rounds.concat([{ words, match, groups: groupsOf(words, shared.pids, shared.fuzzy) }]);
        const next = Object.assign({}, shared, { cur: {}, rounds, telt: [], quit: [] });
        if (match) next.done = finish(shared, rounds, true);
        else if (shared.max && rounds.length >= shared.max) next.final = true; // nog één kans op "Telt!"
        return next;
      }
      case "unword": {
        if (typeof shared.cur[pid] !== "string") return shared;
        const cur = Object.assign({}, shared.cur);
        delete cur[pid];
        return Object.assign({}, shared, { cur });
      }
      case "telt":
      case "quit": {
        const key = a.t, other = a.t === "telt" ? "quit" : "telt";
        const last = shared.rounds[shared.rounds.length - 1];
        if (key === "telt" && (!last || last.match)) return shared;
        if (key === "quit" && !last && !shared.final) return shared; // opgeven pas na een onthulling
        const on = a.on !== false, has = shared[key].includes(pid);
        if (on === has) return shared;
        const next = Object.assign({}, shared, {
          [key]: on ? shared[key].concat([pid]) : shared[key].filter((p) => p !== pid),
          [other]: on ? shared[other].filter((p) => p !== pid) : shared[other].slice(),
        });
        return resolveVotes(shared, next);
      }
      default: return shared;
    }
  }

  function view(shared, pid) {
    if (!shared) return null;
    const n = shared.rounds.length;
    const rounds = shared.rounds.map((r, i) => {
      if (shared.fog && !shared.done && i < n - 1) {
        // De mist vreet oude rondes: alleen je eigen woord blijft (zodat je weet wat je niet mag herhalen).
        const words = {};
        if (typeof r.words[pid] === "string") words[pid] = r.words[pid];
        return { words, match: false, groups: [], fogged: true };
      }
      return { words: Object.assign({}, r.words), match: r.match, groups: r.groups.map((g) => g.slice()) };
    });
    return {
      d: shared.d, max: shared.max, limit: shared.limit, fog: shared.fog, fuzzy: shared.fuzzy, prompt: shared.prompt,
      me: pid, pids: shared.pids.slice(), player: shared.pids.includes(pid),
      round: n + 1, submitted: shared.pids.filter((p) => typeof shared.cur[p] === "string"),
      mine: typeof shared.cur[pid] === "string" ? shared.cur[pid] : null,
      used: shared.rounds.map((r) => r.words[pid]).filter((w) => typeof w === "string"),
      rounds, telt: shared.telt.slice(), quit: shared.quit.slice(), final: shared.final,
      done: shared.done ? JSON.parse(JSON.stringify(shared.done)) : null,
    };
  }

  const result = (shared) => (shared && shared.done ? shared.done : null);

  // ---------- Score ----------
  function valid(r) {
    if (!r || typeof r !== "object" || typeof r.success !== "boolean") return null;
    const rounds = Number(r.rounds);
    if (!Number.isInteger(rounds) || rounds < 0 || rounds > 999 || (r.success && rounds < 1)) return null;
    const trail = Array.isArray(r.trail) ? r.trail.filter((x) => x && typeof x === "object") : [];
    return { success: r.success, rounds, telt: !!r.telt, gaveUp: !!r.gaveUp, word: typeof r.word === "string" ? r.word : null, trail };
  }
  // Echte match in ronde N: max(1, 5−N). "Telt!" is een gunst van Gloei en levert één blok minder op (min. 1),
  // anders is iedereen-tikt-Telt!-na-ronde-1 altijd de beste zet.
  const logsFor = (v) => (v && v.success ? Math.max(1, 5 - v.rounds - (v.telt ? 1 : 0)) : -1);
  const joinNames = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " en " + a[a.length - 1]);
  const q = (w) => "«" + w + "»";

  function score(res, info) {
    info = info || {};
    const players = Array.isArray(info.players) ? info.players : [];
    const nameOf = (pid) => { const p = players.find((x) => x.pid === pid); return (p && p.name) || "Iemand"; };
    const v = valid(res);
    const logs = M.clampLogs(logsFor(v));
    if (!v) return { logs, lines: ["De Mist bleef hangen. Niemand kwam op één lijn."], mvp: null, perPlayer: {} };
    const pids = (Array.isArray(res.pids) ? res.pids : players.map((p) => p.pid)).filter((p) => typeof p === "string");
    const names = pids.map(nameOf);
    const both = pids.length === 2 ? "allebei" : "allemaal";
    const last = v.trail[v.trail.length - 1] || {};
    const lines = [];
    let mvp = null;
    if (v.success) {
      if (v.telt) {
        lines.push("Telt! In ronde " + v.rounds + " keurden jullie het samen goed. Gloei rekent één blok voor de gunst.");
        const ws = pids.filter((p) => typeof last[p] === "string").map((p) => nameOf(p) + " " + q(last[p]));
        if (ws.length) lines.push(joinNames(ws) + ". Gloei knijpt een oogje toe.");
      } else {
        lines.push(v.rounds === 1 ? "Op één lijn, in één keer! De Mist deinst geschrokken terug." : "Op één lijn in ronde " + v.rounds + ". De Mist lost op.");
        if (v.word && names.length) lines.push(joinNames(names) + " dachten " + both + " " + q(v.word) + ".");
        // Wie zag het al aankomen? Iemand wiens woord van de ronde ervoor al het eindwoord was.
        const prev = v.trail[v.trail.length - 2];
        if (prev && v.word) {
          const seers = pids.filter((p) => typeof prev[p] === "string" && same(prev[p], v.word, true));
          if (seers.length === 1) { mvp = seers[0]; lines.push(nameOf(mvp) + " zei het al een ronde eerder. De rest volgde."); }
        }
      }
      lines.push(v.rounds <= 2 ? "Gloei: \"Echte stemmen. Geen twijfel. Ik ken jullie.\"" : "Gloei: \"Zie je wel. De Mist kan stemmen nadoen, maar geen gedachten.\"");
    } else {
      lines.push(v.gaveUp ? "Jullie gaven het op. De Mist grinnikt zacht." : v.rounds + (v.rounds === 1 ? " ronde" : " rondes") + ", nooit hetzelfde woord. De Mist kruipt onder de deur door.");
      const ws = pids.filter((p) => typeof last[p] === "string").map((p) => nameOf(p) + " " + q(last[p]));
      if (ws.length) lines.push("Laatste woorden: " + joinNames(ws) + ".");
      lines.push("Gloei: \"Brr. Even dacht ik dat jullie zelf ook mist waren.\"");
    }
    const perPlayer = {};
    pids.forEach((p) => {
      const chain = v.trail.map((r) => r[p]).filter((w) => typeof w === "string");
      if (chain.length) perPlayer[p] = chain.length > 4 ? chain[0] + " → … → " + chain.slice(-2).join(" → ") : chain.join(" → ");
    });
    return { logs, lines, mvp, perPlayer };
  }

  // ---------- Bot ----------
  const BOT_WORDS = ["vuur", "hout", "kaars", "haard", "vonk", "rook", "deken", "sterren", "thee", "bijl", "worst", "nacht", "uil", "sneeuw"];
  const CONNECT = ["vuur", "warmte", "licht", "nacht", "hout", "winter", "gezellig", "rook", "gloed", "kachel", "sterren", "huisje", "bos", "vonk"];
  // Ronde 1: willekeurig (rng). Daarna kiezen alle bots hetzelfde "verbindingswoord" uit de laatste onthulling,
  // zodat bots onderling convergeren; eigen eerdere woorden worden overgeslagen.
  function bot(v, rng) {
    if (!v || v.done || !v.player) return null;
    const r = typeof rng === "function" ? rng : Math.random;
    if (v.final) return v.telt.includes(v.me) || v.quit.includes(v.me) ? null : { t: r() < 0.3 ? "telt" : "quit", on: true };
    if (v.mine) return null;
    const last = v.rounds[v.rounds.length - 1];
    // Woorden uit de laatste onthulling ziet iedereen: die slaan alle bots over, zodat ze hetzelfde nieuwe woord kiezen.
    const seenW = (v.used || []).concat(last ? Object.values(last.words) : []);
    const used = (w) => seenW.some((u) => same(u, w, false));
    let list = BOT_WORDS, i = Math.floor(r() * BOT_WORDS.length);
    if (last) {
      const key = Object.keys(last.words).sort().map((p) => normalize(last.words[p])).sort().join("|");
      list = CONNECT; i = M.hash(key) % CONNECT.length;
    }
    for (let k = 0; k < list.length; k++) { const w = list[(i + k) % list.length]; if (!used(w)) return { t: "word", w }; }
    for (let k = 2; k < 99; k++) { const w = list[i] + k; if (!used(w)) return { t: "word", w }; }
    return null;
  }

  // ---------- UI ----------
  const CSS = `
.ec{position:relative;width:100%;height:100%;min-height:480px;overflow:hidden;color:var(--glow,#ffe7b8);--fog:.35;--fire:.5;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
  background:
    radial-gradient(90% 46% at 50% 108%,rgba(255,106,26,calc(.18 + var(--fire)*.34)),rgba(255,106,26,0) 70%),
    radial-gradient(70% 40% at 50% 0%,rgba(90,120,170,.16),rgba(0,0,0,0) 70%),
    linear-gradient(180deg,#080a10,#0b0909 45%,var(--soot,#0b0705) 70%,#160c07)}
.ec *{box-sizing:border-box}
.ec-disp,.ec-btn,.ec-card .w,.ec-qw,.ec-big,.ec-hud b,.ec-word,.ec-sum span,.ec-msg{font-variant-ligatures:none;font-feature-settings:"locl" 0,"liga" 0} /* "IJ" in LIJN niet als één glyph (Nederlandse locl) */
.ec-disp{font-family:"Unbounded",system-ui,sans-serif;font-weight:900;letter-spacing:-.02em}
.ec-fog{position:absolute;inset:0;z-index:1;pointer-events:none;opacity:var(--fog);transition:opacity 1.6s ease}
.ec-fog i{position:absolute;left:-40%;right:-40%;height:62%;display:block;border-radius:50%;
  background:radial-gradient(closest-side,rgba(185,206,232,.42),rgba(150,175,210,.18) 55%,rgba(150,175,210,0));animation:ec-drift 26s ease-in-out infinite alternate}
.ec-fog i:nth-child(1){top:-6%}
.ec-fog i:nth-child(2){top:30%;animation-duration:34s;animation-delay:-9s;opacity:.8}
.ec-fog i:nth-child(3){top:58%;animation-duration:22s;animation-delay:-4s;opacity:.65}
.ec-fog::after{content:"";position:absolute;left:0;right:0;bottom:0;height:46%;background:linear-gradient(0deg,rgba(150,180,220,.34),rgba(150,180,220,0));animation:ec-creep 7s ease-in-out infinite alternate}
@keyframes ec-creep{0%{transform:translateY(6%);opacity:.75}100%{transform:none;opacity:1}}
@keyframes ec-drift{0%{transform:translateX(-14%) scaleY(.9)}100%{transform:translateX(14%) scaleY(1.1)}}
.ec-edge{position:absolute;inset:0;z-index:1;pointer-events:none;
  box-shadow:inset 0 0 calc(40px + var(--fog)*90px) rgba(150,185,230,calc(var(--fog)*.45));transition:box-shadow 1.6s}
.ec-cv{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5}
/* Kachelvenster onderaan (zoals hun kachel: gebogen ruit met roostertje) */
.ec-hearth{position:absolute;left:50%;bottom:-6px;z-index:1;width:min(76%,290px);height:min(30%,230px);transform:translateX(-50%);pointer-events:none;
  border-radius:46% 46% 10px 10px / 30% 30% 10px 10px;overflow:hidden;
  background:radial-gradient(80% 70% at 50% 100%,rgba(255,120,30,calc(.25 + var(--fire)*.5)),rgba(40,14,4,.9) 70%),#120a06;
  box-shadow:0 0 0 7px #17110d,0 0 0 9px rgba(255,231,184,.06),0 0 calc(30px + var(--fire)*90px) rgba(255,106,26,calc(.2 + var(--fire)*.45));
  transition:box-shadow 1.2s,opacity .8s,transform .9s cubic-bezier(.3,1.4,.5,1)}
.ec-hearth canvas{position:absolute;left:0;right:0;bottom:0;width:100%;height:100%;display:block}
.ec-hearth::after{content:"";position:absolute;left:6%;right:6%;bottom:0;height:24%;z-index:2;
  background:linear-gradient(180deg,#2a1d14 0 5px,rgba(0,0,0,0) 5px),repeating-linear-gradient(90deg,rgba(0,0,0,0) 0 13px,#1f1510 13px 20px);
  -webkit-mask:linear-gradient(180deg,#000 70%,rgba(0,0,0,.6));mask:linear-gradient(180deg,#000 70%,rgba(0,0,0,.6))}
.ec.playing .ec-hearth{opacity:.92;transform:translateX(-50%) translateY(2%) scale(.86)}
.ec.won .ec-hearth{opacity:1;transform:translateX(-50%) scale(1.12)}
.ec-cssfire{position:absolute;inset:0}
.ec-cssfire i{position:absolute;bottom:10%;left:50%;width:34%;height:70%;margin-left:-17%;border-radius:50% 50% 45% 45% / 70% 70% 30% 30%;
  background:radial-gradient(60% 50% at 50% 75%,#fff3d0,var(--flame,#ffc247) 40%,var(--ember,#ff6a1a) 70%,rgba(232,64,28,0));
  transform-origin:50% 100%;animation:ec-lick 1.1s ease-in-out infinite alternate;filter:blur(1px);mix-blend-mode:screen;opacity:calc(.4 + var(--fire)*.6)}
.ec-cssfire i:nth-child(2){left:34%;width:24%;height:52%;animation-duration:.8s}
.ec-cssfire i:nth-child(3){left:66%;width:24%;height:56%;animation-duration:.95s}
@keyframes ec-lick{0%{transform:scaleY(calc(.6 + var(--fire)*.4)) skewX(-4deg)}100%{transform:scaleY(calc(.75 + var(--fire)*.5)) skewX(5deg)}}
/* Schermen */
.ec-scr{position:absolute;inset:0;z-index:4;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  padding:max(20px,env(safe-area-inset-top)) 22px max(24px,env(safe-area-inset-bottom))}
.ec-howto{justify-content:flex-start;padding-top:max(46px,env(safe-area-inset-top))}
.ec-kicker{font:800 11px/1.2 system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#9fc3ee}
.ec-title{font-size:clamp(38px,12vw,54px);line-height:.98;margin:10px 0 0;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 45%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 18px rgba(255,106,26,.45))}
.ec-text{font-size:17px;line-height:1.42;max-width:330px;margin:14px 0 0}
.ec-demo{display:flex;align-items:center;gap:8px;margin-top:20px}
.ec-demo span{padding:10px 12px;border-radius:12px;font:900 13px/1 "Unbounded",system-ui,sans-serif;color:#2a1608;letter-spacing:.02em;
  background:radial-gradient(120% 140% at 0% 0%,#f6e3bf,#e8cc98 55%,#cfa86c);box-shadow:0 6px 16px rgba(0,0,0,.45);animation:ec-bob 2.8s ease-in-out infinite}
.ec-demo span:nth-of-type(2){animation-delay:.3s}
.ec-demo span.res{color:#2a0d02;background:radial-gradient(circle,#fff3d0,var(--flame,#ffc247) 55%,var(--ember,#ff6a1a));box-shadow:0 0 26px rgba(255,170,60,.7);animation-delay:.6s}
.ec-demo b{font:900 18px/1 system-ui,sans-serif;color:var(--ash,#b8a99a)}
@keyframes ec-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.ec-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:7px;max-width:340px;margin-top:18px}
.ec-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:99px;font-size:12.5px;color:var(--glow,#ffe7b8);
  background:rgba(23,16,11,.7);border:1px solid rgba(255,194,71,.2)}
.ec-chip.cold{border-color:rgba(159,195,238,.35)}
.ec-btn{appearance:none;border:0;cursor:pointer;margin-top:22px;min-width:210px;min-height:58px;padding:0 34px;border-radius:99px;
  font:900 19px/1 "Unbounded",system-ui,sans-serif;color:#2a0d02;letter-spacing:.02em;
  background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a) 70%,var(--blaze,#e8401c));
  box-shadow:0 0 0 1px rgba(255,231,184,.35) inset,0 10px 30px rgba(232,64,28,.45),0 0 60px rgba(255,106,26,.25);transition:transform .12s,filter .2s}
.ec-btn:active{transform:scale(.97)}
.ec .mini-countdown{position:absolute;inset:0;z-index:8;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font:900 96px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);text-shadow:0 0 30px rgba(255,106,26,.9),0 4px 0 #6a1c04;
  background:radial-gradient(circle at 50% 50%,rgba(11,7,5,.2),rgba(11,7,5,.7))}
.ec .mini-countdown.pop{animation:ec-cd .7s ease-out}
@keyframes ec-cd{0%{transform:scale(1.6);opacity:0}25%{transform:scale(1);opacity:1}100%{transform:scale(.92);opacity:.85}}
/* Speelscherm */
.ec-play{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;touch-action:none}
.ec-hud{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:max(14px,env(safe-area-inset-top)) 14px 4px}
.ec-hud b{font:900 13px/1 "Unbounded",system-ui,sans-serif;padding:8px 12px;border-radius:99px;background:rgba(23,16,11,.72);border:1px solid rgba(255,194,71,.22);white-space:nowrap}
.ec-hud b.last{color:#2a0d02;background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a));border-color:transparent}
.ec-who{display:flex;gap:6px;justify-content:flex-end;min-width:0}
.ec-who.many{gap:3px}.ec-who.many .ec-dot{width:26px;height:26px;font-size:14px}
.ec-dot{position:relative;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;
  background:rgba(23,16,11,.8);box-shadow:inset 0 0 0 2px rgba(184,169,154,.3);transition:box-shadow .3s,transform .3s}
.ec-dot.in{box-shadow:inset 0 0 0 2px var(--c,#ffc247),0 0 12px var(--c,#ffc247)}
.ec-dot.in::after{content:"✓";position:absolute;right:-3px;bottom:-3px;width:15px;height:15px;border-radius:50%;font:900 10px/15px system-ui;text-align:center;
  color:#2a0d02;background:var(--flame,#ffc247)}
.ec-dot.pop{animation:ec-dotpop .4s cubic-bezier(.3,1.8,.5,1)}
@keyframes ec-dotpop{0%{transform:scale(.7)}100%{transform:scale(1)}}
.ec-q{flex:none;padding:0 4px 8px;text-align:center}
.ec-qk{font:800 11px/1.2 system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#9fc3ee}
.ec-qw{margin-top:7px;font:900 clamp(19px,5.6vw,24px)/1.18 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8);text-shadow:0 0 18px rgba(255,140,40,.35)}
.ec-sum{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px 8px;margin-top:9px}
.ec-sum span{max-width:100%;padding:7px 11px;border-radius:11px;font:900 15px/1.1 "Unbounded",system-ui,sans-serif;color:#2a1608;overflow-wrap:anywhere;
  background:radial-gradient(120% 140% at 0% 0%,#f6e3bf,#e8cc98 55%,#cfa86c);box-shadow:0 4px 14px rgba(0,0,0,.45)}
.ec-sum.many span{padding:5px 8px;font-size:12px;border-radius:9px}
.ec-sum.many{gap:4px 5px}
.ec-sum.many b{font-size:13px}
.ec-sum span.pair{box-shadow:0 0 0 2px var(--flame,#ffc247),0 0 16px rgba(255,194,71,.6)}
.ec-sum b{font:900 16px/1 system-ui;color:var(--ash,#b8a99a)}
.ec-sum b.eq{color:var(--flame,#ffc247);font-size:20px}
.ec-mid{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:6px 14px 4px;overflow-y:auto;touch-action:pan-y}
.ec-mid>:first-child{margin-top:auto}.ec-mid>:last-child{margin-bottom:auto}
.ec-table{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;perspective:900px}
.ec-card{position:relative;flex:0 0 var(--cw,46%);max-width:170px;height:var(--chh,132px);touch-action:none}
.ec-in3d{position:absolute;inset:0;transform-style:preserve-3d;transition:transform .7s cubic-bezier(.3,1.35,.5,1)}
.ec-card.flip .ec-in3d{transform:rotateY(180deg)}
.ec-face{position:absolute;inset:0;border-radius:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:10px 8px;
  backface-visibility:hidden;-webkit-backface-visibility:hidden;text-align:center}
.ec-back{background:
    repeating-linear-gradient(45deg,rgba(255,194,71,.05) 0 6px,rgba(0,0,0,0) 6px 12px),
    linear-gradient(160deg,#2a1d14,#17100b 60%,#21160f);
  box-shadow:inset 0 0 0 1.5px rgba(184,169,154,.25),0 10px 24px rgba(0,0,0,.55);transition:box-shadow .4s}
.ec-card.in .ec-back{box-shadow:inset 0 0 0 2px var(--c,#ffc247),inset 0 0 26px rgba(255,140,40,.25),0 0 22px rgba(255,140,40,.35),0 10px 24px rgba(0,0,0,.55)}
.ec-back .av{font-size:30px;line-height:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))}
.ec-back .nm{font:800 13px/1.1 system-ui,sans-serif;color:var(--glow,#ffe7b8);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ec-back .st{font:700 12px/1.2 system-ui,sans-serif;color:var(--ash,#b8a99a);min-height:15px}
.ec-card.in .ec-back .st{color:var(--flame,#ffc247)}
.ec-back .mine{font:900 12px/1.1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);max-width:100%;overflow-wrap:anywhere;opacity:.85}
.ec-dots i{display:inline-block;width:5px;height:5px;margin:0 2px;border-radius:50%;background:var(--ash,#b8a99a);animation:ec-think 1.2s ease-in-out infinite}
.ec-dots i:nth-child(2){animation-delay:.15s}.ec-dots i:nth-child(3){animation-delay:.3s}
@keyframes ec-think{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
.ec-front{transform:rotateY(180deg);color:#2a1608;
  background:radial-gradient(120% 140% at 0% 0%,#f6e3bf,#e8cc98 55%,#cfa86c);box-shadow:inset 0 0 0 1px rgba(90,50,20,.35),inset 0 0 22px rgba(120,60,20,.25),0 10px 24px rgba(0,0,0,.5);
  transition:background .5s,box-shadow .5s,filter .5s}
.ec-front .w{font:900 var(--fs,22px)/1.1 "Unbounded",system-ui,sans-serif;overflow-wrap:anywhere;max-width:100%}
.ec-front .nm{font:800 11px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:rgba(42,22,8,.65)}
.ec-card.cold .ec-front{filter:saturate(.55) brightness(.9);box-shadow:inset 0 0 0 1.5px rgba(159,211,255,.7),inset 0 0 34px rgba(90,169,255,.55),0 0 18px rgba(90,169,255,.25),0 10px 24px rgba(0,0,0,.5)}
.ec-card.pair .ec-front{filter:none;box-shadow:inset 0 0 0 2px var(--ember,#ff6a1a),0 0 22px rgba(255,140,40,.55)}
.ec-card.gold .ec-front{background:radial-gradient(circle at 50% 40%,#fff6dc,var(--flame,#ffc247) 55%,var(--ember,#ff6a1a));
  box-shadow:0 0 0 2px #fff3d0,0 0 40px rgba(255,194,71,.9),0 0 90px rgba(255,106,26,.6);animation:ec-gold .9s ease-out both}
@keyframes ec-gold{0%{filter:brightness(1)}35%{filter:brightness(1.6)}100%{filter:brightness(1)}}
.ec-msg{min-height:22px;text-align:center;font-size:15px;line-height:1.35;color:var(--glow,#ffe7b8)}
.ec-msg.bad{color:#ff9a7a}.ec-msg.good{color:var(--flame,#ffc247)}.ec-msg.cold{color:#9fc3ee}
.ec-msg.big{font:900 24px/1.1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);text-shadow:0 0 20px rgba(255,140,40,.8)}
.ec-msg.pop{animation:ec-in .35s cubic-bezier(.2,.9,.3,1.3)}
@keyframes ec-in{0%{transform:translateY(6px);opacity:0}100%{transform:none;opacity:1}}
.ec-trail{display:flex;flex-direction:column;gap:5px;align-items:center}
.ec-trail .row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center;font-size:13px;color:var(--ash,#b8a99a)}
.ec-trail .row em{font:900 10px/1 "Unbounded",system-ui,sans-serif;font-style:normal;color:rgba(159,195,238,.8);width:24px;text-align:right}
.ec-trail .row span{padding:4px 8px;border-radius:8px;background:rgba(255,231,184,.07);border:1px solid rgba(255,231,184,.1);color:var(--glow,#ffe7b8);font-weight:700}
.ec-trail .row span.fog{color:rgba(159,195,238,.6);border-style:dashed;letter-spacing:.2em}
.ec-act{display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap}
.ec-telt{appearance:none;cursor:pointer;min-height:44px;padding:0 16px;border-radius:99px;font:900 14px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);
  background:rgba(23,16,11,.75);border:1.5px solid rgba(255,194,71,.55);display:inline-flex;align-items:center;gap:8px}
.ec-telt small{font:700 12px/1 system-ui,sans-serif;color:var(--ash,#b8a99a)}
.ec-telt.on{color:#2a0d02;background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a));border-color:transparent;box-shadow:0 0 20px rgba(255,140,40,.5)}
.ec-telt.on small{color:#4a1a04}
.ec-quit{appearance:none;cursor:pointer;min-height:44px;padding:0 12px;border:0;background:none;font:700 13px/1 system-ui,sans-serif;color:var(--ash,#b8a99a);text-decoration:underline;text-underline-offset:3px}
.ec-quit.on{color:#9fc3ee}
.ec-actnote{width:100%;text-align:center;font-size:12px;color:var(--ash,#b8a99a)}
.ec-bottom{flex:none;position:relative;padding:10px 14px max(14px,env(safe-area-inset-bottom));
  background:linear-gradient(180deg,rgba(11,7,5,0),rgba(11,7,5,.35) 45%,rgba(11,7,5,.62))}
.ec-timer{position:absolute;left:18px;right:18px;top:2px;height:4px;border-radius:4px;background:rgba(159,195,238,.15);overflow:hidden}
.ec-timer i{position:absolute;inset:0;transform-origin:0 50%;background:linear-gradient(90deg,#9fc3ee,var(--blue,#5aa9ff))}
.ec-timer.hot i{background:linear-gradient(90deg,var(--blaze,#e8401c),var(--ember,#ff6a1a))}
.ec-form{display:flex;gap:8px;align-items:center}
.ec-form input{flex:1;min-width:0;height:58px;padding:0 16px;border-radius:18px;font:800 21px/1 system-ui,-apple-system,sans-serif;color:var(--glow,#ffe7b8);
  background:rgba(23,16,11,.88);border:1.5px solid rgba(255,194,71,.35);outline:none;-webkit-user-select:text;user-select:text;
  box-shadow:inset 0 2px 10px rgba(0,0,0,.5);transition:border-color .2s,box-shadow .2s}
.ec-form input::placeholder{color:rgba(184,169,154,.6);font-weight:600;font-size:17px}
.ec-form input:focus{border-color:var(--flame,#ffc247);box-shadow:inset 0 2px 10px rgba(0,0,0,.5),0 0 0 3px rgba(255,194,71,.18),0 0 24px rgba(255,140,40,.25)}
.ec-form.shake{animation:ec-shake .45s cubic-bezier(.36,.07,.19,.97)}
@keyframes ec-shake{20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-8px)}40%,60%{transform:translateX(8px)}}
.ec-send{appearance:none;border:0;cursor:pointer;flex:none;width:58px;height:58px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#2a0d02;
  background:radial-gradient(circle at 50% 35%,#fff3d0,var(--flame,#ffc247) 45%,var(--ember,#ff6a1a));box-shadow:0 0 22px rgba(255,140,40,.55);transition:transform .12s}
.ec-send:active{transform:scale(.92)}
.ec-send svg{width:26px;height:26px}
.ec-lock{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:58px;padding:8px 8px 8px 16px;border-radius:18px;
  background:rgba(23,16,11,.88);border:1.5px solid rgba(255,194,71,.55);box-shadow:0 0 24px rgba(255,140,40,.2)}
.ec-lock div{min-width:0;text-align:left}
.ec-lock.pending{border-style:dashed;box-shadow:none}.ec-lock.pending strong{opacity:.7}
.ec-lock small{display:block;font:700 11px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--ash,#b8a99a)}
.ec-lock strong{display:block;margin-top:4px;font:900 18px/1.15 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);overflow-wrap:anywhere}
.ec-lock button{appearance:none;cursor:pointer;flex:none;min-height:42px;padding:0 14px;border-radius:12px;border:1px solid rgba(255,231,184,.18);
  background:rgba(255,231,184,.06);color:var(--glow,#ffe7b8);font:700 13px/1 system-ui,sans-serif}
.ec-hint{margin-top:6px;min-height:16px;text-align:center;font-size:12.5px;color:var(--ash,#b8a99a)}
.ec-hint.bad{color:#ff9a7a}
/* Resultaat */
.ec-res{z-index:6;justify-content:flex-start;gap:4px;padding-top:max(34px,env(safe-area-inset-top));overflow-y:auto;touch-action:pan-y;
  background:linear-gradient(180deg,rgba(8,6,6,.9),rgba(11,7,5,.7) 55%,rgba(11,7,5,.15));animation:ec-fade .6s ease-out both}
@keyframes ec-fade{from{opacity:0}to{opacity:1}}
.ec-big{font-size:clamp(46px,15vw,70px);line-height:1.04;margin:2px 0 4px;padding:.12em .04em 0;
  background:linear-gradient(180deg,#fffaf0,var(--flame,#ffc247) 45%,var(--ember,#ff6a1a) 80%,var(--blaze,#e8401c));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 26px rgba(255,106,26,.65));animation:ec-slam .9s cubic-bezier(.2,1.6,.4,1) both}
.ec-big.cold{background:linear-gradient(180deg,#f2f8ff,#9fd3ff 50%,var(--blue,#5aa9ff));-webkit-background-clip:text;background-clip:text;filter:drop-shadow(0 0 22px rgba(90,169,255,.45))}
@keyframes ec-slam{0%{transform:scale(2.2);opacity:0;letter-spacing:.1em}55%{transform:scale(.95);opacity:1}100%{transform:none;letter-spacing:-.02em}}
.ec-word{margin:6px 0 4px;padding:12px 22px;border-radius:18px;max-width:100%;font:900 clamp(22px,7vw,32px)/1.1 "Unbounded",system-ui,sans-serif;color:#2a0d02;overflow-wrap:anywhere;
  background:radial-gradient(circle at 50% 40%,#fff6dc,var(--flame,#ffc247) 55%,var(--ember,#ff6a1a));box-shadow:0 0 0 2px #fff3d0,0 0 44px rgba(255,194,71,.8);
  animation:ec-pop .7s .35s cubic-bezier(.3,1.7,.5,1) both}
.ec-word.long{font-size:clamp(15px,4.6vw,20px);padding:10px 16px}
@keyframes ec-pop{0%{transform:scale(.3);opacity:0}100%{transform:none;opacity:1}}
.ec-sub{font-size:15px;color:var(--glow,#ffe7b8)}
.ec-sub b{color:var(--flame,#ffc247)}
.ec-sub.cold b{color:#9fc3ee}
.ec-res .ec-trail{margin-top:10px;padding:10px 12px;border-radius:14px;background:rgba(11,7,5,.55);border:1px solid rgba(255,231,184,.08);max-width:100%}
.ec-quip{max-width:320px;font-size:15px;line-height:1.4;margin-top:10px}
.ec-wait{margin-top:14px;display:inline-flex;align-items:center;gap:10px;font-size:15px;
  padding:10px 16px;border-radius:99px;background:rgba(23,16,11,.8);border:1px solid rgba(255,231,184,.12)}
.ec-wait i{width:10px;height:10px;border-radius:50%;background:var(--ember,#ff6a1a);box-shadow:0 0 12px var(--ember,#ff6a1a);animation:ec-breathe 1s ease-in-out infinite}
@keyframes ec-breathe{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.7);opacity:.6}}
.ec-ring{position:absolute;left:50%;top:44%;z-index:5;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;pointer-events:none;
  box-shadow:0 0 0 6px rgba(255,194,71,.9),0 0 50px 20px rgba(255,140,40,.7);animation:ec-shock 1s ease-out forwards}
@keyframes ec-shock{0%{transform:scale(.2);opacity:1}100%{transform:scale(14);opacity:0}}
.ec-flash{position:absolute;inset:0;z-index:5;pointer-events:none;background:radial-gradient(circle at 50% 45%,rgba(255,240,200,.9),rgba(255,140,40,.4) 40%,rgba(255,106,26,0) 75%);
  animation:ec-flashk 1.1s ease-out forwards}
.ec-flash.cold{background:radial-gradient(circle,rgba(159,195,238,0) 30%,rgba(159,195,238,.4))}
@keyframes ec-flashk{0%{opacity:1}100%{opacity:0}}
@media (max-height:700px){.ec-card{--chh:108px}.ec-qw{font-size:18px}.ec-hearth{height:min(26%,190px)}}
@media (prefers-reduced-motion:reduce){.ec-fog i,.ec-fog::after,.ec-demo span,.ec-dots i,.ec-wait i,.ec-cssfire i,.ec-big,.ec-word,.ec-ring,.ec-dot.pop,.ec-msg.pop,.ec-form.shake,.ec-card.gold .ec-front,.ec .mini-countdown.pop{animation:none}
  .ec-ring{display:none}.ec-flash{animation-duration:.3s}.ec-in3d{transition-duration:.01s}.ec-hearth,.ec-fog,.ec-edge{transition:none}}
`;

  function injectCss() {
    if (document.getElementById("mini-echo-css")) return;
    const s = document.createElement("style");
    s.id = "mini-echo-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const SEND_ICO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5c1.3 4.3 6.6 7 6.6 14a6.6 6.6 0 0 1-13.2 0c0-3.7 1.9-6.1 4.3-7.8-.3 2.5.6 4.2 2.1 5.1C11.6 10 11 6.2 12 2.5z"/></svg>';
  const fontFor = (w) => { const n = String(w).length; return n <= 5 ? 26 : n <= 8 ? 21 : n <= 12 ? 17 : n <= 17 ? 14 : 12; };

  function mount(el, ctx) {
    injectCss();
    let v = ctx.view || null;
    const me = ctx.me ? ctx.me.pid : null;
    const players = ctx.players || [];
    const pids = v && v.pids ? v.pids.slice() : players.map((p) => p.pid);
    const isPlayer = v ? !!v.player : pids.includes(me);
    const d = dl(v ? v.d : ctx.difficulty), c = CFG[d];
    const max = v ? v.max : c.rounds;
    const limit = v ? v.limit : c.limit;
    const sfx = ctx.sfx || {};
    const beep = (...a) => { try { sfx.beep && sfx.beep(...a); } catch (e) { /* geen geluid */ } };
    const buzz = (p) => { try { sfx.buzz && sfx.buzz(p); } catch (e) { /* geen tril */ } };
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const P = (pid) => players.find((x) => x.pid === pid) || { pid, name: "Iemand", avatar: "🙂", color: "#ffc247" };
    const others = pids.filter((p) => p !== me).map((p) => P(p).name);

    const root = h("div", "ec");
    el.appendChild(root);
    let dead = false, phase = "howto", raf = 0, tick = 0, busy = false, seen = v ? v.rounds.length : 0, roundT0 = 0, autoSent = -1;
    // Optimistische invoer: pend = net verstuurd woord (nog geen echo van de host), unlocking = "Wijzig" getikt.
    let sending = false, pend = null, unlocking = false, sendTok = 0;
    const myWord = () => (pend || (unlocking || !v ? null : v.mine));
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!dead) fn(); }, ms); timers.add(t); };
    const offs = [];
    const on = (node, type, fn, opt) => { node.addEventListener(type, fn, opt); offs.push(() => node.removeEventListener(type, fn, opt)); };

    // --- Sfeer: mist, randvorst, kachelvenster met echt vuur ---
    const fog = h("div", "ec-fog");
    for (let i = 0; i < 3; i++) fog.appendChild(h("i"));
    root.append(fog, h("div", "ec-edge"));
    const hearth = h("div", "ec-hearth");
    let flame = null;
    if (ctx.fire && ctx.fire.flame) {
      const fc = h("canvas");
      hearth.appendChild(fc);
      try { flame = ctx.fire.flame(fc, { intensity: 0.55, embers: true, blueTips: true, logs: true }); } catch (e) { flame = null; }
    }
    if (!flame) { const cf = h("div", "ec-cssfire"); for (let i = 0; i < 3; i++) cf.appendChild(h("i")); hearth.appendChild(cf); }
    root.appendChild(hearth);
    function mood() {
      // Elke ronde zonder match: dikkere mist, zwakker vuur.
      const n = v ? v.rounds.length : 0, k = max ? n / max : Math.min(1, n / 6);
      const fogLv = v && v.done ? (v.done.success ? 0.08 : 0.95) : 0.3 + 0.6 * k;
      const fireLv = v && v.done ? (v.done.success ? 1 : 0.08) : Math.max(0.18, 0.6 - 0.42 * k);
      root.style.setProperty("--fog", fogLv.toFixed(2));
      root.style.setProperty("--fire", fireLv.toFixed(2));
      if (flame && flame.setIntensity) flame.setIntensity(fireLv);
    }

    // Vonken (canvas) voor onthulling en succes.
    const cv = h("canvas", "ec-cv");
    root.appendChild(cv);
    const g = cv.getContext && cv.getContext("2d");
    const parts = [];
    let W = 0, H = 0, dpr = 1, last = 0;
    function fit() {
      const r = root.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      const cw = Math.round(W * dpr), ch = Math.round(H * dpr);
      if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
      layoutCards();
    }
    function frame(ts) {
      raf = 0;
      if (dead || !g) return;
      const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016); last = ts;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = "lighter";
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
        p.vy += p.gr * dt; p.vx *= 1 - 0.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        const a = Math.min(1, (p.life / p.max) * 1.5);
        g.fillStyle = p.col.replace("A", a.toFixed(3));
        g.beginPath(); g.arc(p.x, p.y, p.r * (0.4 + 0.6 * a), 0, 6.283); g.fill();
      }
      g.globalCompositeOperation = "source-over";
      if (parts.length) raf = requestAnimationFrame(frame); else { last = 0; g.clearRect(0, 0, W, H); }
    }
    function burst(x, y, n, cold) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, s = 60 + Math.random() * (cold ? 140 : 380), life = 0.6 + Math.random() * 1.1;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (cold ? 20 : 200), gr: cold ? -30 : 240, r: 1.3 + Math.random() * 2.6, life, max: life,
          col: cold ? "rgba(170,205,245,A)" : Math.random() < 0.12 ? "rgba(140,200,255,A)" : Math.random() < 0.55 ? "rgba(255,214,120,A)" : "rgba(255,120,40,A)" });
      }
      if (!raf) raf = requestAnimationFrame(frame);
    }
    const relOf = (node) => { const r = node.getBoundingClientRect(), rr = root.getBoundingClientRect(); return { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height / 2 }; };

    // --- Howto ---
    const how = h("div", "ec-scr ec-howto");
    how.appendChild(h("div", "ec-kicker", "Middernacht · " + c.name));
    how.appendChild(h("h2", "ec-title ec-disp", "Op één lijn"));
    how.appendChild(h("p", "ec-text", "Typ stiekem één woord: zeggen jullie allemaal hetzelfde, dan is de Mist verslagen; anders zoek je samen het woord dat jullie woorden verbindt."));
    const demo = h("div", "ec-demo");
    demo.append(h("span", null, "KAARS"), h("b", null, "+"), h("span", null, "HAARD"), h("b", null, "="), h("span", "res", "VUUR"));
    how.appendChild(demo);
    const chips = h("div", "ec-chips");
    const chip = (t, cold) => chips.appendChild(h("span", "ec-chip" + (cold ? " cold" : ""), t));
    chip(max ? "🔁 " + max + " rondes" : "🔁 Onbeperkt rondes");
    chip("🙅 Eigen woord niet herhalen");
    chip("🤝 Allemaal Telt! = goed (1 blok minder)");
    if (c.fuzzy) chip("✏️ Tikfoutje mag");
    if (limit) chip("⏳ " + limit + " s per ronde", true);
    if (c.fog) chip("🌫️ De Mist vreet oude woorden", true);
    how.appendChild(chips);
    const startBtn = h("button", "ec-btn", "Start");
    startBtn.type = "button";
    how.appendChild(startBtn);
    root.appendChild(how);

    // --- Speelscherm ---
    const play = h("div", "ec-play");
    const hud = h("div", "ec-hud");
    const roundEl = h("b", null, "");
    const who = h("div", "ec-who" + (pids.length > 4 ? " many" : ""));
    const dotOf = {};
    pids.forEach((p) => { const x = h("span", "ec-dot", P(p).avatar || "🙂"); x.style.setProperty("--c", P(p).color || "#ffc247"); x.title = P(p).name; who.appendChild(x); dotOf[p] = x; });
    hud.append(roundEl, who);
    const qEl = h("div", "ec-q");
    const mid = h("div", "ec-mid");
    const table = h("div", "ec-table");
    const msg = h("div", "ec-msg");
    msg.setAttribute("role", "status");
    const act = h("div", "ec-act");
    const trail = h("div", "ec-trail");
    mid.append(qEl, table, msg, act, trail);
    const bottom = h("div", "ec-bottom");
    const timerEl = h("div", "ec-timer");
    const timerBar = h("i");
    timerEl.appendChild(timerBar);
    const form = h("form", "ec-form");
    form.setAttribute("autocomplete", "off");
    const input = h("input");
    Object.assign(input, { type: "text", maxLength: MAXLEN, placeholder: "Jouw woord…", autocomplete: "off", spellcheck: false });
    input.setAttribute("enterkeyhint", "send");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("aria-label", "Jouw woord");
    const sendBtn = h("button", "ec-send");
    sendBtn.type = "submit";
    sendBtn.setAttribute("aria-label", "Verstuur");
    sendBtn.innerHTML = SEND_ICO;
    form.append(input, sendBtn);
    const lockEl = h("div", "ec-lock");
    const lockTxt = h("div");
    const lockWord = h("strong");
    lockTxt.append(h("small", null, "Jouw woord"), lockWord);
    const undoBtn = h("button", null, "Wijzig");
    undoBtn.type = "button";
    lockEl.append(lockTxt, undoBtn);
    const hint = h("div", "ec-hint");
    hint.setAttribute("aria-live", "polite");
    if (limit) bottom.appendChild(timerEl);
    bottom.append(form, lockEl, hint);
    play.append(hud, mid, bottom);

    function say(text, cls) {
      msg.textContent = text || ""; msg.className = "ec-msg" + (cls ? " " + cls : "");
      if (text) { void msg.offsetWidth; msg.classList.add("pop"); }
    }
    function setHint(text, bad) { hint.textContent = text || ""; hint.className = "ec-hint" + (bad ? " bad" : ""); }

    // Kaarten: één per speler, blijven staan; omdraaien bij onthulling.
    const cards = {};
    pids.forEach((p) => {
      const pl = P(p);
      const card = h("div", "ec-card");
      card.style.setProperty("--c", pl.color || "#ffc247");
      const in3 = h("div", "ec-in3d");
      const back = h("div", "ec-face ec-back");
      const av = h("div", "av", pl.avatar || "🙂");
      const nm = h("div", "nm", p === me ? pl.name + " (jij)" : pl.name);
      const st = h("div", "st");
      const mine = h("div", "mine");
      back.append(av, nm, st, mine);
      const front = h("div", "ec-face ec-front");
      const fw = h("div", "w");
      front.append(fw, h("div", "nm", pl.name));
      in3.append(back, front);
      card.appendChild(in3);
      table.appendChild(card);
      cards[p] = { card, st, mine, fw };
    });
    function layoutCards() {
      const n = pids.length, cols = n <= 2 ? n : n <= 4 ? 2 : 3;
      const wAvail = (root.clientWidth || 360) - 28;
      const cw = Math.min(170, Math.floor((wAvail - (cols - 1) * 10) / Math.max(1, cols)));
      table.style.setProperty("--cw", cw + "px");
      const rows = Math.ceil(n / cols);
      const hh = root.clientHeight || 700;
      table.style.setProperty("--chh", Math.max(78, Math.min(rows > 1 ? 112 : 180, Math.floor((hh * (rows > 1 ? 0.34 : 0.24)) / rows) - 6)) + "px");
    }
    function thinking(node) { node.textContent = ""; const s = h("span", "ec-dots"); s.append(h("i"), h("i"), h("i")); node.appendChild(s); }
    function renderCards() {
      const sub = v ? v.submitted : [];
      pids.forEach((p) => {
        const k = cards[p];
        let isIn = sub.includes(p);
        k.card.className = "ec-card" + (isIn ? " in" : "");
        if (v && v.final) {
          // Laatste kans: de laatste woorden blijven bevroren omgedraaid liggen.
          const w = (v.rounds[v.rounds.length - 1] || { words: {} }).words[p] || "…";
          k.fw.textContent = w; k.fw.style.setProperty("--fs", fontFor(w) + "px");
          k.card.className = "ec-card flip cold"; k.mine.textContent = "";
          return;
        }
        const mw = p === me ? myWord() : null;
        if (p === me) { isIn = !!mw; k.card.classList.toggle("in", isIn); }
        if (isIn) k.st.textContent = p === me ? "Ingeleverd" : "Klaar ✓"; else if (p === me) k.st.textContent = "Jouw beurt"; else thinking(k.st);
        k.mine.textContent = mw || "";
      });
    }

    function renderHud() {
      if (!v) return;
      const n = v.rounds.length;
      roundEl.className = v.final || (max && n === max - 1) ? "last" : "";
      roundEl.textContent = v.final ? "Laatste kans" : "Ronde " + Math.min(n + 1, max || n + 1) + (max ? " / " + max : "");
      pids.forEach((p) => {
        const was = dotOf[p].classList.contains("in"), isIn = p === me ? !!myWord() : v.submitted.includes(p);
        dotOf[p].classList.toggle("in", isIn);
        if (isIn && !was) { dotOf[p].classList.remove("pop"); void dotOf[p].offsetWidth; dotOf[p].classList.add("pop"); }
      });
    }

    function renderQuestion() {
      qEl.textContent = "";
      const lastR = v && v.rounds[v.rounds.length - 1];
      if (!lastR) {
        qEl.appendChild(h("div", "ec-qk", "Startwoord · denk aan"));
        // Als vervolg op "denk aan" met een kleine letter: "Iets…" leest in Unbounded (en de meeste schreefloze
        // letters) als "lets…", een kleine i heeft een punt.
        qEl.appendChild(h("div", "ec-qw", v ? lcFirst(v.prompt) : ""));
        return;
      }
      qEl.appendChild(h("div", "ec-qk", v.final ? "De Mist wacht op jullie oordeel" : "Welk woord verbindt deze?"));
      const sum = h("div", "ec-sum" + (pids.length > 3 || Object.values(lastR.words).join("").length > 26 ? " many" : ""));
      const inPair = new Set((lastR.groups || []).flat());
      const ws = pids.filter((p) => typeof lastR.words[p] === "string");
      ws.forEach((p, i) => {
        if (i) sum.appendChild(h("b", null, "+"));
        sum.appendChild(h("span", inPair.has(p) ? "pair" : "", lastR.words[p]));
      });
      if (!v.final) sum.appendChild(h("b", "eq", "= ?"));
      qEl.appendChild(sum);
    }

    function renderTrail(rounds, all) {
      trail.textContent = "";
      const list = all ? rounds : rounds.slice(0, -1);
      list.forEach((r, i) => {
        const row = h("div", "row");
        row.appendChild(h("em", null, String(i + 1)));
        pids.forEach((p) => {
          if (typeof r.words[p] === "string") row.appendChild(h("span", null, r.words[p]));
          else if (r.fogged) row.appendChild(h("span", "fog", "···"));
        });
        trail.appendChild(row);
      });
      return trail;
    }

    // Telt!/Opgeven: één keer gebouwd (geen nieuwe listeners per update), daarna alleen bijgewerkt.
    const teltBtn = h("button", "ec-telt"), teltN = h("small");
    teltBtn.type = "button";
    teltBtn.append(document.createTextNode("Telt!"), teltN);
    const quitBtn = h("button", "ec-quit");
    quitBtn.type = "button";
    const actNote = h("div", "ec-actnote");
    act.append(teltBtn, quitBtn, actNote);
    on(teltBtn, "click", () => { if (busy || !v) return; beep(880, 0.05, "triangle", 0.06); buzz(10); ctx.send({ t: "telt", on: !v.telt.includes(me) }); });
    on(quitBtn, "click", () => { if (busy || !v) return; beep(260, 0.06, "sine", 0.05); ctx.send({ t: "quit", on: !v.quit.includes(me) }); });
    function renderAct() {
      const lastR = v && v.rounds[v.rounds.length - 1];
      const show = !!(v && !v.done && isPlayer && lastR && !lastR.match && !busy);
      act.style.display = show ? "" : "none";
      if (!show) return;
      const n = pids.length;
      teltBtn.className = "ec-telt" + (v.telt.includes(me) ? " on" : "");
      teltBtn.setAttribute("aria-pressed", String(v.telt.includes(me)));
      teltN.textContent = v.telt.length + "/" + n;
      quitBtn.className = "ec-quit" + (v.quit.includes(me) ? " on" : "");
      quitBtn.textContent = v.final ? "De Mist wint" : "Opgeven " + v.quit.length + "/" + n;
      const votes = v.telt.filter((p) => p !== me).map((p) => P(p).name);
      actNote.textContent = votes.length ? joinNames(votes) + " vind" + (votes.length > 1 ? "en" : "t") + " dat het telt."
        : v.final ? "Bedoelden jullie hetzelfde? Tik allemaal op Telt!" : "Bijna hetzelfde bedoeld? Tikt iedereen Telt!, dan telt het (1 blok minder).";
    }

    function renderInput() {
      const mw = myWord();
      const open = isPlayer && v && !v.done && !v.final && !mw && !busy;
      form.style.display = open ? "" : "none";
      lockEl.style.display = isPlayer && v && mw && !v.final && !busy ? "" : "none";
      timerEl.style.display = limit && open ? "" : "none";
      if (mw) lockWord.textContent = mw;
      lockEl.classList.toggle("pending", !!pend);
      sendBtn.disabled = sending;
      if (!isPlayer) setHint("Je kijkt mee.");
      else if (v && v.final) setHint("");
      else if (mw) {
        const wait = pids.filter((p) => p !== me && !v.submitted.includes(p)).map((p) => P(p).name);
        setHint(wait.length ? "Wachten op " + joinNames(wait) + "…" : "");
      } else if (!hint.classList.contains("bad")) setHint(v && v.rounds.length ? "Niet je eigen eerdere woorden herhalen." : others.length ? "Zelfde woord als " + joinNames(others) + "?" : "");
    }

    function renderAll() {
      if (!v) return;
      mood();
      renderHud(); renderQuestion(); renderCards(); renderAct(); renderInput();
      renderTrail(v.rounds, false);
      if (v.final) say("Geen rondes meer. Telt het toch?", "cold");
    }

    function newRound() {
      roundT0 = Date.now(); autoSent = -1; pend = null; unlocking = false;
      // Woorden laten staan: anders draaien lege voorkanten terug. reveal() zet ze opnieuw.
      pids.forEach((p) => cards[p].card.classList.remove("flip", "cold", "pair", "gold"));
    }

    function submit(auto) {
      if (phase !== "play" || busy || !v || myWord() || v.final || v.done || sending) return;
      const w = clean(input.value);
      const bad = (t) => { setHint(t, true); form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake"); buzz(30); beep(180, 0.08, "square", 0.04); };
      if (!w || !normalize(w)) { if (!auto) bad("Typ eerst een woord."); return; }
      const ui = (v.used || []).findIndex((u) => same(u, w, false));
      if (ui >= 0) { bad("Dat zei je al: «" + v.used[ui] + "». Iets nieuws!"); return; }
      setHint("");
      // Meteen vastzetten (geen leeg veld tijdens netwerkvertraging); komt de host niet terug, dan krijg je je woord terug.
      sending = true; pend = w; unlocking = false;
      const tok = ++sendTok, round = v.rounds.length;
      later(() => {
        if (tok !== sendTok || !sending) return;
        sending = false; pend = null;
        if (v && !v.mine && !v.done && v.rounds.length === round) { input.value = w; setHint("Niet aangekomen. Nog een keer?", true); }
        renderInput(); renderCards();
      }, 3000);
      beep(620, 0.06, "triangle", 0.07); beep(930, 0.08, "triangle", 0.05); buzz(12);
      input.value = "";
      if (input.blur) input.blur();
      renderInput(); renderCards();
      ctx.send({ t: "word", w });
    }
    on(form, "submit", (e) => { e.preventDefault(); submit(false); });
    on(input, "input", () => { if (hint.classList.contains("bad")) { setHint(""); renderInput(); } });
    on(undoBtn, "click", () => {
      const w = myWord();
      if (!v || !w || busy || v.final || v.done) return;
      sendTok++; sending = false; pend = null; unlocking = true;
      input.value = w;
      renderInput(); renderCards();
      try { input.focus({ preventScroll: true }); } catch (e) { /* oud toestel */ } // binnen het gebaar: toetsenbord gaat open
      ctx.send({ t: "unword" });
      beep(440, 0.04, "sine", 0.04);
    });

    // --- Onthulling: alle kaarten tegelijk om ---
    function reveal(r, done) {
      busy = true;
      pids.forEach((p) => dotOf[p].classList.add("in"));
      pids.forEach((p) => {
        const k = cards[p], w = r.words[p];
        k.fw.textContent = typeof w === "string" ? w : "…";
        k.fw.style.setProperty("--fs", fontFor(w || "") + "px");
        k.card.classList.add("in");
        k.st.textContent = "Klaar ✓"; k.mine.textContent = "";
      });
      form.style.display = "none"; lockEl.style.display = "none"; timerEl.style.display = "none"; act.style.display = "none";
      setHint("");
      say("Iedereen heeft gekozen…", "");
      later(() => {
        pids.forEach((p) => cards[p].card.classList.add("flip"));
        beep(330, 0.05, "square", 0.05); beep(660, 0.05, "square", 0.04); buzz(20);
      }, reduced ? 50 : 650);
      later(() => {
        if (r.match) {
          pids.forEach((p) => cards[p].card.classList.add("gold"));
          say("OP ÉÉN LIJN!", "big");
          mood();
          if (flame && flame.burst) { try { flame.burst(); } catch (e) { /* stil */ } }
          const pt = relOf(table);
          burst(pt.x, pt.y, reduced ? 30 : 140, false);
          [523, 659, 784, 1047, 1319].forEach((f, i) => later(() => beep(f, 0.16, "triangle", 0.08), i * 90));
          buzz([30, 40, 90]);
        } else {
          const inPair = new Set((r.groups || []).flat());
          pids.forEach((p) => cards[p].card.classList.add(inPair.has(p) ? "pair" : "cold"));
          say(inPair.size ? "Bijna! " + joinNames([...inPair].map((p) => P(p).name)) + " zitten op één lijn." : "Niet op één lijn… de Mist wordt dikker.", "cold");
          beep(196, 0.35, "sine", 0.06); beep(147, 0.5, "sine", 0.05); buzz([40, 30, 40]);
          mood(); // mist dikker, vuur zakt: meteen voelbaar
          const fl = h("div", "ec-flash cold"); root.appendChild(fl); later(() => fl.remove(), 1200);
          const pt = relOf(table);
          burst(pt.x, pt.y, reduced ? 6 : 26, true);
        }
      }, reduced ? 200 : 1350);
      later(() => {
        busy = false;
        if (v.done) { finish(); return; }
        seen = v.rounds.length;
        newRound();
        renderAll();
        if (!v.final) say(v.rounds.length >= 1 ? "Zoek het woord dat deze verbindt." : "", "");
      }, (reduced ? 600 : 2900) + (done ? 300 : 0));
    }

    // --- Resultaat ---
    function finish() {
      if (phase === "result") return;
      phase = "result";
      clearInterval(tick); tick = 0;
      const dn = v.done;
      mood();
      root.classList.remove("playing");
      if (dn.success) {
        root.classList.add("won");
        if (flame && flame.burst) { try { flame.burst(); } catch (e) { /* stil */ } }
        root.appendChild(h("div", "ec-ring"));
        const fl = h("div", "ec-flash"); root.appendChild(fl); later(() => fl.remove(), 1300);
        burst(W / 2, H * 0.62, reduced ? 30 : 180, false);
        later(() => burst(W / 2, H * 0.3, reduced ? 10 : 90, false), 420);
        later(() => { try { sfx.fanfare && sfx.fanfare(); sfx.confetti && sfx.confetti(); } catch (e) { /* stil */ } }, 200);
      } else {
        const fl = h("div", "ec-flash cold"); root.appendChild(fl); later(() => fl.remove(), 1300);
        beep(130, 0.6, "sine", 0.05);
      }
      const res = h("div", "ec-scr ec-res");
      res.appendChild(h("div", "ec-kicker", dn.success ? (dn.telt ? "Telt! · De Mist trekt op" : "De Mist trekt op") : dn.gaveUp ? "Opgegeven" : "De Mist blijft hangen"));
      res.appendChild(h("div", "ec-big ec-disp" + (dn.success ? "" : " cold"), dn.success ? "OP ÉÉN LIJN!" : "DE MIST WINT"));
      const lastW = dn.trail[dn.trail.length - 1] || {};
      if (dn.success) {
        // Bij Telt! elk (genormaliseerd) woord één keer: "sneeuw = ijs", niet "sneeuw = ijs = sneeuw".
        const uniq = [];
        pids.map((p) => lastW[p]).filter(Boolean).forEach((w) => { if (!uniq.some((u) => normalize(u) === normalize(w))) uniq.push(w); });
        const wt = dn.telt ? uniq.join(" = ") : dn.word || "";
        res.appendChild(h("div", "ec-word" + (wt.length > 14 ? " long" : ""), wt));
      }
      const lg = logsFor(valid(dn));
      const sub = h("div", "ec-sub" + (dn.success ? "" : " cold"));
      sub.appendChild(document.createTextNode(dn.success ? (dn.telt ? "Telt! in ronde " + dn.rounds + " · " : dn.rounds === 1 ? "In één keer! · " : "In ronde " + dn.rounds + " · ") : dn.rounds + (dn.rounds === 1 ? " ronde · " : " rondes · ")));
      sub.appendChild(h("b", null, (lg > 0 ? "+" + lg + " " + (lg === 1 ? "blok" : "blokken") + " " + "🪵".repeat(lg) : "−" + Math.abs(lg) + " blok")));
      res.appendChild(sub);
      if (dn.trail.length) res.appendChild(renderTrail(dn.trail.map((w) => ({ words: w })), true));
      res.appendChild(h("div", "ec-quip", dn.success
        ? dn.telt ? "Gloei: \"Vooruit, ik knijp een oogje toe. Maar de Mist lacht er stiekem om.\""
        : (dn.rounds <= 2 ? "Gloei: \"Echte stemmen! De Mist kan alles nadoen, behalve dít.\"" : "Gloei: \"Hè hè. Even dacht ik dat jullie zelf ook nep waren.\"")
        : "Gloei: \"Brr. Hou me vast, mannen. Ik word er klein van.\""));
      const w = h("div", "ec-wait"); w.appendChild(h("i")); w.appendChild(document.createTextNode("Klaar! Wachten op de rest…"));
      res.appendChild(w);
      play.remove();
      root.appendChild(res);
    }

    // --- Timer (alleen dikke mist): aan het eind wordt een getypt woord vanzelf verstuurd ---
    function startTimer() {
      if (!limit || tick) return;
      roundT0 = roundT0 || Date.now();
      let lastSec = -1;
      tick = setInterval(() => {
        if (dead || phase !== "play" || !v || v.done || v.final || busy) return;
        if (myWord()) { timerBar.style.transform = "scaleX(1)"; return; }
        const left = limit * 1000 - (Date.now() - roundT0);
        timerBar.style.transform = "scaleX(" + Math.max(0, left / (limit * 1000)).toFixed(3) + ")";
        timerEl.classList.toggle("hot", left < 8000);
        const sec = Math.ceil(left / 1000);
        if (sec !== lastSec) { lastSec = sec; if (sec <= 5 && sec > 0) beep(sec <= 2 ? 880 : 660, 0.03, "square", 0.025); }
        if (left <= 0 && autoSent !== v.rounds.length) {
          autoSent = v.rounds.length;
          if (clean(input.value)) submit(true);
          else { say("De Mist fluistert: schiet op…", "cold"); root.style.setProperty("--fog", "0.98"); }
        }
      }, 200);
    }

    function enterPlay() {
      phase = "play";
      root.classList.add("playing");
      root.appendChild(play);
      layoutCards();
      newRound();
      if (v && v.done) {
        seen = v.rounds.length;
        renderAll();
        finish();
        return;
      }
      renderAll();
      startTimer();
      if (v && !v.final) say(v.rounds.length ? "Zoek het woord dat deze verbindt." : "", "");
    }

    on(startBtn, "click", () => {
      if (phase !== "howto") return;
      phase = "count";
      beep(1, 0.001, "sine", 0.0001); // audio ontgrendelen binnen het gebaar
      how.remove();
      ctx.countdown(root, { go: "DENK!" }).then(() => {
        if (dead) return;
        enterPlay();
        if (isPlayer && form.style.display !== "none") { try { input.focus({ preventScroll: true }); } catch (e) { /* oud toestel */ } }
      });
    });
    if (!isPlayer) startBtn.textContent = "Kijk mee";

    fit();
    mood();
    on(window, "resize", fit);
    // Ook als de host de container van maat verandert (rotatie, toetsenbord, paneel) zonder window-resize.
    let ro = null;
    if (typeof ResizeObserver === "function") { ro = new ResizeObserver(() => { if (!dead) fit(); }); ro.observe(root); offs.push(() => ro.disconnect()); }

    // Terugkomen na herladen: al bezig of klaar → meteen naar het spel.
    if (v && (v.done || v.mine || v.rounds.length)) { how.remove(); enterPlay(); }

    // Testhaakje (alleen voor Playwright): leesbare toestand, geen globale variabele.
    Object.defineProperty(root, "_echo", { value: { get phase() { return phase; }, get busy() { return busy; }, get view() { return v; } }, enumerable: false });

    return {
      update(nv) {
        if (dead || !nv) return;
        const prev = v;
        v = nv;
        if (phase !== "play") { if (phase === "howto" && v.done) { how.remove(); enterPlay(); } else seen = v.rounds.length; return; }
        if (v.rounds.length > seen) {
          seen = v.rounds.length;
          sendTok++; sending = false; pend = null; unlocking = false;
          reveal(v.rounds[v.rounds.length - 1], !!v.done);
          return;
        }
        if (busy) return;
        // Host bevestigt: optimistische toestand loslaten.
        if (typeof v.mine === "string") { if (pend) sendTok++; sending = false; pend = null; }
        if (unlocking && !v.mine) unlocking = false;
        if (v.done) { renderAll(); finish(); return; }
        renderHud(); renderCards(); renderAct(); renderInput();
        // iemand anders leverde in: zacht tikje
        const others = (x) => (x ? x.submitted.filter((p) => p !== me).length : 0);
        if (others(v) > others(prev)) { beep(1200, 0.02, "sine", 0.03); buzz(6); }
      },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        clearInterval(tick);
        timers.forEach(clearTimeout); timers.clear();
        offs.forEach((f) => f()); offs.length = 0;
        if (flame && flame.destroy) { try { flame.destroy(); } catch (e) { /* al weg */ } }
        root.remove();
      },
    };
  }

  const def = {
    id: "echo", title: "Op één lijn", icon: "🌫️", kind: "net",
    howto: "Typ stiekem allemaal één woord: hetzelfde woord verdrijft de Mist, anders zoek je het woord dat jullie woorden verbindt.",
    init, reduce, view, result, score, mount, bot,
    CFG, MAXLEN, FALLBACK, normalize, stems, same, groupsOf, logsFor, valid,
  };
  M.register(def);
  if (typeof module === "object" && module.exports) module.exports = def;
})();
