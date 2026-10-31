// Minigame "slot" — net, asymmetrische co-op puzzel (SPEC-3 §5, hoofdstuk "De kist op zolder").
// Eén speler is het SLOT: ziet alleen een ringslot met vier draaiende ringen vol runen en mag drie keer proberen.
// De rest zijn GIDSEN: zien alleen aanwijzingen over de code (verdeeld bij 3+ spelers). Niemand weet alles: praten dus.
// De host (init/reduce) genereert per seed een code plus aanwijzingen die met brute kracht precies één oplossing geven.
(function () {
  "use strict";
  const M = typeof DVMini !== "undefined" ? DVMini : require("./core.js");

  const N = 6, RINGS = 4, MAX_TRIES = 3;
  // Runen: volgorde = volgorde op de ring. f = familie (lucht / bos / vuur & ijs).
  const RUNES = [
    { k: "vlam", n: "vlam", de: "de vlam", een: "een vlam", emoji: "🔥", f: "vuur", col: "#ff7a2a" },
    { k: "maan", n: "maan", de: "de maan", een: "een maan", emoji: "🌙", f: "lucht", col: "#e3ecff" },
    { k: "ijs", n: "ijs", de: "het ijs", een: "ijs", emoji: "❄️", f: "vuur", col: "#8fd0ff" },
    { k: "den", n: "den", de: "de den", een: "een den", emoji: "🌲", f: "bos", col: "#7cc86a" },
    { k: "blok", n: "blok", de: "het blok", een: "een blok", emoji: "🪵", f: "bos", col: "#d89a5c" },
    { k: "ster", n: "ster", de: "de ster", een: "een ster", emoji: "⭐", f: "lucht", col: "#ffd04d" },
  ];
  const FAMS = {
    lucht: { name: "Lucht", runes: [1, 5] },
    bos: { name: "Bos", runes: [3, 4] },
    vuur: { name: "Vuur & IJs", runes: [0, 2] },
  };
  const FAM_KEYS = Object.keys(FAMS);

  // Per moeilijkheid: tijd (s), dubbele tekens, toegestane soorten aanwijzingen, max. directe aanwijzingen,
  // hoe "sterk" de gekozen aanwijzingen zijn (sample: uit hoeveel kandidaten de beste), aantal aanwijzingen en
  // wat het slot terugzegt na een foute poging (ring = per ring, count = hoeveel goed, none = niks).
  const CFG = {
    1: { name: "Roestig slot", limit: 150, rep: false, types: ["is", "not", "grp", "absent", "left", "next", "even", "odd"],
      cap: { is: 2 }, sample: 6, prune: false, min: 4, max: 6, fb: "ring" },
    2: { name: "Zwaar slot", limit: 130, rep: false, types: ["is", "not", "grp", "ngrp", "absent", "left", "next", "apart", "even", "odd", "fam", "nfam", "cnt"],
      cap: { is: 1, not: 2 }, sample: 3, prune: true, min: 5, max: 7, fb: "count" },
    3: { name: "Vorstslot", limit: 120, rep: true, types: ["not", "grp", "ngrp", "absent", "left", "next", "apart", "even", "odd", "fam", "nfam", "cnt", "dup", "ndup", "once", "twice"],
      cap: { not: 2, ndup: 2 }, sample: 2, prune: true, min: 6, max: 8, fb: "none" },
  };
  const dl = (d) => Math.max(1, Math.min(3, Math.round(d) || 1));

  // ---------- Puzzel ----------
  const SPACES = {};
  function space(rep) {
    const key = rep ? "r" : "u";
    if (SPACES[key]) return SPACES[key];
    const out = [];
    for (let i = 0; i < N ** RINGS; i++) {
      const c = [i % N, (i / N | 0) % N, (i / 36 | 0) % N, (i / 216 | 0) % N];
      if (rep || new Set(c).size === RINGS) out.push(c);
    }
    return (SPACES[key] = out);
  }
  const fam = (r) => RUNES[r].f;
  const count = (c, f) => c.reduce((s, x) => s + (f(x) ? 1 : 0), 0);
  const sameCode = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  function evalClue(s, c) {
    switch (s.t) {
      case "is": return c[s.i] === s.r;
      case "not": return c[s.i] !== s.r;
      case "grp": return fam(c[s.i]) === s.g;
      case "ngrp": return fam(c[s.i]) !== s.g;
      case "absent": return !c.includes(s.r);
      case "left": for (let i = 0; i < RINGS; i++) for (let j = i + 1; j < RINGS; j++) if (c[i] === s.a && c[j] === s.b) return true; return false;
      case "next": for (let i = 0; i < RINGS - 1; i++) if (c[i] === s.a && c[i + 1] === s.b) return true; return false;
      case "apart": for (let i = 0; i < RINGS - 1; i++) if ((c[i] === s.a && c[i + 1] === s.b) || (c[i] === s.b && c[i + 1] === s.a)) return false; return true;
      case "even": return c.includes(s.r) && c.every((x, i) => x !== s.r || i % 2 === 1);
      case "odd": return c.includes(s.r) && c.every((x, i) => x !== s.r || i % 2 === 0);
      case "fam": return fam(c[s.i]) === fam(c[s.j]);
      case "nfam": return fam(c[s.i]) !== fam(c[s.j]);
      case "cnt": return count(c, (x) => fam(x) === s.g) === s.n;
      case "dup": return c[s.i] === c[s.j];
      case "ndup": return c[s.i] !== c[s.j];
      case "once": return count(c, (x) => x === s.r) === 1;
      case "twice": return count(c, (x) => x === s.r) === 2;
      default: return false;
    }
  }
  // Alle codes die aan alle aanwijzingen voldoen (brute kracht).
  function solve(specs, rep) { return space(rep).filter((c) => specs.every((s) => evalClue(s, c))); }

  // Alle WARE aanwijzingen voor een code, per soort.
  function truths(code, types) {
    const out = {}, add = (s) => { if (evalClue(s, code)) (out[s.t] = out[s.t] || []).push(s); };
    const allow = new Set(types);
    for (let i = 0; i < RINGS; i++) {
      for (let r = 0; r < N; r++) { if (allow.has("is")) add({ t: "is", i, r }); if (allow.has("not")) add({ t: "not", i, r }); }
      FAM_KEYS.forEach((g) => { if (allow.has("grp")) add({ t: "grp", i, g }); if (allow.has("ngrp")) add({ t: "ngrp", i, g }); });
      for (let j = i + 1; j < RINGS; j++) ["fam", "nfam", "dup", "ndup"].forEach((t) => { if (allow.has(t)) add({ t, i, j }); });
    }
    for (let r = 0; r < N; r++) ["absent", "even", "odd", "once", "twice"].forEach((t) => { if (allow.has(t)) add({ t, r }); });
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      if (a === b) continue;
      if (allow.has("left")) add({ t: "left", a, b });
      if (allow.has("next")) add({ t: "next", a, b });
      // "staan nooit naast elkaar" alleen als ze er allebei in zitten (anders leest het als een strikvraag)
      if (allow.has("apart") && a < b && code.includes(a) && code.includes(b)) add({ t: "apart", a, b });
    }
    if (allow.has("cnt")) FAM_KEYS.forEach((g) => add({ t: "cnt", g, n: count(code, (x) => fam(x) === g) }));
    return out;
  }
  const keyOf = (s) => JSON.stringify(s);
  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function randomCode(rng, rep) {
    if (rep) {
      // Vorstslot: minstens één dubbel teken, anders is "kunnen dubbel" een loze dreiging.
      for (;;) { const c = Array.from({ length: RINGS }, () => Math.floor(rng() * N)); if (new Set(c).size < RINGS) return c; }
    }
    return shuffle([0, 1, 2, 3, 4, 5], rng).slice(0, RINGS);
  }

  // Genereer { code, specs }: aanwijzingen die samen precies één oplossing geven. minClues = min. aantal (≥ #gidsen).
  function genPuzzle(rng, difficulty, minClues) {
    const c = CFG[dl(difficulty)], sp = space(c.rep);
    let best = null;
    for (let attempt = 0; attempt < 400; attempt++) {
      const code = randomCode(rng, c.rep);
      const pool = truths(code, c.types), types = Object.keys(pool);
      const chosen = [], used = new Set(), per = {};
      let cand = sp;
      for (let it = 0; it < 80 && cand.length > 1; it++) {
        let pickS = null, pickC = null;
        for (let k = 0; k < c.sample; k++) {
          const t = pick(types, rng);
          if (c.cap[t] !== undefined && (per[t] || 0) >= c.cap[t]) continue;
          const s = pick(pool[t], rng);
          if (used.has(keyOf(s))) continue;
          const nc = cand.filter((x) => evalClue(s, x));
          if (nc.length < cand.length && (!pickC || nc.length < pickC.length)) { pickS = s; pickC = nc; }
        }
        if (!pickS) continue;
        chosen.push(pickS); used.add(keyOf(pickS)); per[pickS.t] = (per[pickS.t] || 0) + 1; cand = pickC;
      }
      if (cand.length !== 1) continue;
      let specs = chosen;
      if (c.prune) {
        // Overbodige aanwijzingen weg (willekeurige volgorde): de puzzel moet redeneren vragen.
        for (const s of shuffle(chosen, rng)) {
          const rest = specs.filter((x) => x !== s);
          if (solve(rest, c.rep).length === 1) specs = rest;
        }
      }
      const need = Math.max(c.min, minClues || 0);
      // Te weinig? Vul aan met ware (dus overbodige maar kloppende) aanwijzingen, geen weggevers.
      // Geen open deuren: niks wat al uit één andere aanwijzing volgt (zoals "ring 2 is geen den" naast "ring 2 is de ster").
      const extra = shuffle(types.filter((t) => t !== "is").flatMap((t) => pool[t]), rng);
      const have = new Set(specs.map(keyOf));
      const implied = (s) => specs.some((o) => solve([o], c.rep).every((x) => evalClue(s, x)));
      for (const s of extra) {
        if (specs.length >= need) break;
        if (!have.has(keyOf(s)) && !implied(s)) { specs = specs.concat([s]); have.add(keyOf(s)); }
      }
      const ok = specs.length >= need && specs.length <= Math.max(c.max, need);
      if (!best || ok) best = { code, specs };
      if (ok && solve(specs, c.rep).length === 1) return { code, specs: shuffle(specs, rng) };
    }
    return { code: best.code, specs: shuffle(best.specs, rng) };
  }

  // Tekst van een aanwijzing: delen = strings of tokens { r, form } (rune) / { g } (familie).
  const NUM = ["geen", "één", "twee", "drie", "vier"];
  // rep (Vorstslot, tekens kunnen dubbel): lidwoord "een" bij links/naast en "alleen op" bij even/oneven,
  // zodat "het ijs staat links van de vlam" én andersom niet als tegenspraak leest als er twee keer ijs is.
  function partsOf(s, rep) {
    const R = (r, form) => ({ r, form }), F = (g) => ({ g }), ring = (i) => "ring " + (i + 1);
    switch (s.t) {
      case "is": return ["Op " + ring(s.i) + " staat ", R(s.r, "de"), "."];
      case "not": return ["Op " + ring(s.i) + " staat géén ", R(s.r, "n"), "."];
      case "grp": return ["Ring " + (s.i + 1) + " komt uit de familie ", F(s.g), "."];
      case "ngrp": return ["Ring " + (s.i + 1) + " komt níét uit de familie ", F(s.g), "."];
      case "absent": return ["Geen enkele ring toont ", R(s.r, "een"), "."];
      case "left": return rep ? [R(s.a, "Een"), " staat ergens links van ", R(s.b, "ind"), "."] : [R(s.a, "De"), " staat ergens links van ", R(s.b, "de"), "."];
      case "next": return rep ? ["Direct rechts naast ", R(s.a, "ind"), " staat ", R(s.b, "ind"), "."] : ["Direct rechts naast ", R(s.a, "de"), " staat ", R(s.b, "de"), "."];
      case "apart": return [R(s.a, "De"), " en ", R(s.b, "de"), " staan nooit naast elkaar."];
      case "even": return [R(s.r, "De"), rep ? " staat alleen op even ringen (2 of 4)." : " staat op een even ring (2 of 4)."];
      case "odd": return [R(s.r, "De"), rep ? " staat alleen op oneven ringen (1 of 3)." : " staat op een oneven ring (1 of 3)."];
      case "fam": return ["Ring " + (s.i + 1) + " en " + ring(s.j) + " komen uit dezelfde familie."];
      case "nfam": return ["Ring " + (s.i + 1) + " en " + ring(s.j) + " komen uit een andere familie."];
      case "cnt": return s.n === 0 ? ["Geen enkele ring komt uit de familie ", F(s.g), "."]
        : ["Precies " + NUM[s.n] + " " + (s.n === 1 ? "ring komt" : "ringen komen") + " uit de familie ", F(s.g), "."];
      case "dup": return ["Ring " + (s.i + 1) + " en " + ring(s.j) + " tonen hetzelfde teken."];
      case "ndup": return ["Ring " + (s.i + 1) + " en " + ring(s.j) + " tonen een ander teken."];
      case "once": return [R(s.r, "De"), " komt precies één keer voor."];
      case "twice": return [R(s.r, "De"), " komt precies twee keer voor."];
      default: return ["?"];
    }
  }
  function runeWord(r, form) {
    const x = RUNES[r];
    if (form === "De") return x.de.charAt(0).toUpperCase() + x.de.slice(1);
    if (form === "Een" || form === "ind") return (form === "Een" ? "Een " : "een ") + x.n;
    return form === "de" ? x.de : form === "een" ? x.een : x.n;
  }
  const textOf = (parts) => parts.map((p) => (typeof p === "string" ? p : p.g ? FAMS[p.g].name : runeWord(p.r, p.form))).join("");

  // ---------- Net-contract ----------
  function roles(players, rng) {
    const list = (players || []).map((p) => (typeof p === "string" ? p : p.pid));
    const out = {};
    if (!list.length) return out;
    const r = typeof rng === "function" ? rng : Math.random;
    const slot = list[Math.floor(r() * list.length)];
    list.forEach((pid) => { out[pid] = pid === slot ? "slot" : "gids"; });
    return out;
  }

  function init({ seed, difficulty, players, roles: rl } = {}) {
    const d = dl(difficulty), c = CFG[d];
    const rng = M.rng(((seed >>> 0) || 1) ^ 0x51071);
    const pids = (players || []).map((p) => (typeof p === "string" ? p : p.pid));
    const rr = rl && Object.keys(rl).length ? rl : roles(pids, rng);
    let slot = Object.keys(rr).find((pid) => rr[pid] === "slot") || pids[0] || null;
    const gids = pids.filter((pid) => pid !== slot && rr[pid] !== "slot");
    Object.keys(rr).forEach((pid) => { if (rr[pid] === "gids" && !gids.includes(pid) && pid !== slot) gids.push(pid); });
    const { code, specs } = genPuzzle(rng, d, gids.length);
    const clues = specs.map((s, i) => { const parts = partsOf(s, c.rep); return { id: i, spec: s, parts, text: textOf(parts) }; });
    // Verdelen: om de beurt, zodat bij 3+ spelers iedere gids een eigen stuk heeft.
    const hold = {};
    gids.forEach((g) => { hold[g] = []; });
    clues.forEach((cl, i) => { if (gids.length) hold[gids[i % gids.length]].push(cl.id); });
    let rings;
    do { rings = Array.from({ length: RINGS }, () => Math.floor(rng() * N)); } while (sameCode(rings, code));
    return { v: 1, d, rep: c.rep, limit: c.limit, fb: c.fb, slot, gids, code, clues, hold, rings, tries: [], started: [], t0: null, done: null };
  }

  const validCode = (x) => Array.isArray(x) && x.length === RINGS && x.every((v) => Number.isInteger(v) && v >= 0 && v < N);
  const isInt = (x) => Number.isInteger(x);

  function feedback(fb, code, sol) {
    if (fb === "ring") return code.map((x, i) => x === sol[i]);
    if (fb === "count") return code.reduce((s, x, i) => s + (x === sol[i] ? 1 : 0), 0);
    return null;
  }

  function reduce(shared, pid, a, ctx) {
    if (!shared || shared.done || !a || typeof a !== "object") return shared;
    const now = ctx && Number.isFinite(ctx.now) ? ctx.now : null;
    const isSlot = pid === shared.slot;
    const ms = () => (now !== null && shared.t0 !== null ? Math.max(0, now - shared.t0) : 0);
    const clueCount = () => { const o = {}; shared.gids.forEach((g) => { o[g] = (shared.hold[g] || []).length; }); return o; };
    const finish = (solved, tries, extra) => Object.assign({ solved, tries, ms: ms(), slot: shared.slot, clues: clueCount() }, extra || {});
    switch (a.t) {
      case "go": {
        if (!isSlot && !shared.gids.includes(pid)) return shared;
        if (shared.started.includes(pid)) return shared;
        const next = Object.assign({}, shared, { started: shared.started.concat([pid]) });
        // De klok loopt vanaf de eerste die begint: een gids ziet dan al de aanwijzingen, dus vooruit puzzelen telt mee.
        if (shared.t0 === null) next.t0 = now !== null ? now : 0;
        return next;
      }
      case "rot": {
        if (!isSlot || shared.t0 === null) return shared;
        if (!isInt(a.ring) || a.ring < 0 || a.ring >= RINGS || !isInt(a.dir) || a.dir === 0 || Math.abs(a.dir) > 5) return shared;
        const rings = shared.rings.slice();
        rings[a.ring] = (((rings[a.ring] + a.dir) % N) + N) % N;
        return Object.assign({}, shared, { rings });
      }
      case "try": {
        if (!isSlot || shared.t0 === null) return shared;
        if (a.code !== undefined && !validCode(a.code)) return shared;
        const code = a.code !== undefined ? a.code.slice() : shared.rings.slice();
        if (shared.tries.some((t) => sameCode(t.code, code))) return shared; // al geprobeerd: kost geen poging
        const ok = sameCode(code, shared.code);
        const tries = shared.tries.concat([{ code, ok, fb: ok ? null : feedback(shared.fb, code, shared.code) }]);
        const next = Object.assign({}, shared, { rings: code, tries });
        if (ok) next.done = finish(true, tries.length);
        else if (tries.length >= MAX_TRIES) next.done = finish(false, tries.length);
        return next;
      }
      case "timeout": {
        if (shared.t0 === null) return shared;
        if (now !== null && now - shared.t0 < shared.limit * 1000 - 3000) return shared;
        return Object.assign({}, shared, { done: finish(false, shared.tries.length, { ms: shared.limit * 1000, timeout: true }) });
      }
      default: return shared;
    }
  }

  function view(shared, pid) {
    if (!shared) return null;
    const role = pid === shared.slot ? "slot" : shared.gids.includes(pid) ? "gids" : "kijker";
    const v = {
      role, d: shared.d, rep: shared.rep, limit: shared.limit, fb: shared.fb, maxTries: MAX_TRIES,
      slot: shared.slot, gids: shared.gids.slice(), t0: shared.t0, running: shared.t0 !== null,
      started: shared.started.includes(pid),
      tries: shared.tries.map((t) => ({ code: t.code.slice(), ok: t.ok, fb: Array.isArray(t.fb) ? t.fb.slice() : t.fb })),
      left: MAX_TRIES - shared.tries.length,
      done: shared.done ? Object.assign({}, shared.done, { clues: Object.assign({}, shared.done.clues) }) : null,
    };
    if (shared.done) v.solution = shared.code.slice(); // pas na afloop: iedereen ziet de code
    if (role === "slot") v.rings = shared.rings.slice();
    if (role === "gids") {
      const mine = shared.hold[pid] || [];
      v.clues = mine.map((id) => { const c = shared.clues[id]; return { id: c.id, spec: Object.assign({}, c.spec), parts: c.parts.map((p) => (typeof p === "string" ? p : Object.assign({}, p))), text: c.text }; });
      v.holders = shared.gids.map((g) => ({ pid: g, n: (shared.hold[g] || []).length }));
    }
    return v;
  }

  const result = (shared) => (shared && shared.done ? shared.done : null);

  // ---------- Score ----------
  function valid(r) {
    if (!r || typeof r !== "object" || typeof r.solved !== "boolean") return null;
    const tries = Number(r.tries), ms = Number(r.ms);
    if (!Number.isInteger(tries) || tries < 0 || tries > MAX_TRIES || !Number.isFinite(ms) || ms < 0) return null;
    if (r.solved && tries < 1) return null;
    return { solved: r.solved, tries, ms, slot: typeof r.slot === "string" ? r.slot : null, timeout: !!r.timeout,
      clues: r.clues && typeof r.clues === "object" ? r.clues : {} };
  }
  function logsFor(v, d) {
    if (!v || !v.solved) return -1;
    const fast = v.ms > 0 && v.ms < CFG[dl(d)].limit * 1000 * 0.4 ? 1 : 0;
    return Math.max(1, Math.min(4, MAX_TRIES + 1 - v.tries + fast + (dl(d) === 3 ? 1 : 0)));
  }
  const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const joinNames = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " en " + a[a.length - 1]);

  function score(res, info) {
    info = info || {};
    const d = dl(info.difficulty);
    const players = Array.isArray(info.players) ? info.players : [];
    const nameOf = (pid) => { const p = players.find((x) => x.pid === pid); return (p && p.name) || "Iemand"; };
    const v = valid(res);
    const logs = M.clampLogs(logsFor(v, d));
    if (!v) return { logs, lines: ["Niemand kreeg de kist open. Gloei: \"Dan maar de pook.\""], mvp: null, perPlayer: {} };
    const slotName = v.slot ? nameOf(v.slot) : "Het slot";
    const gidsPids = Object.keys(v.clues).length ? Object.keys(v.clues) : players.map((p) => p.pid).filter((pid) => pid !== v.slot);
    const gidsNames = joinNames(gidsPids.map(nameOf));
    const lines = [];
    if (v.solved) {
      lines.push(v.tries === 1
        ? (logs >= 4 ? "Klik! In één keer goed, en razendsnel. Gloei is even sprakeloos." : "Klik! In één keer goed. Dat slot had geen schijn van kans.")
        : v.tries === 2 ? "Klik! De tweede poging is raak. De kist piept open."
          : "Klik… op het allerlaatste nippertje. De kist gaat open.");
      lines.push(slotName + " draaide de ringen" + (gidsNames ? ", " + gidsNames + " las" + (gidsPids.length > 1 ? "en" : "") + " de aanwijzingen voor." : "."));
      lines.push("Open in " + fmt(v.ms) + ", bij poging " + v.tries + " van " + MAX_TRIES + ".");
    } else {
      lines.push(v.timeout ? "De tijd is op. Het slot blijft dicht als een oester." : "Drie keer mis. Het slot zit muurvast.");
      lines.push(gidsNames ? gidsNames + (gidsPids.length > 1 ? " lazen" : " las") + " voor, " + slotName + " draaide. Het slot luisterde niet." : slotName + " draaide en draaide. Het slot luisterde niet.");
      lines.push("Gloei: \"Ik wist het hoor. Ik zei het alleen niet hardop.\"");
    }
    const perPlayer = {};
    if (v.slot) perPlayer[v.slot] = "Aan het slot · " + v.tries + (v.tries === 1 ? " poging" : " pogingen");
    gidsPids.forEach((pid) => { const n = Number(v.clues[pid]) || 0; perPlayer[pid] = "Gids · " + n + (n === 1 ? " aanwijzing" : " aanwijzingen"); });
    const mvp = v.solved && v.slot && players.some((p) => p.pid === v.slot) ? v.slot : null;
    return { logs, lines, mvp, perPlayer };
  }

  // Bot: gidsen doen niks, het slot start en gokt (met de per-ring-feedback van het roestige slot vasthoudend).
  function bot(v, rng) {
    if (!v || v.done || v.role !== "slot") return null;
    if (!v.started) return { t: "go" };
    if (v.left <= 0) return null;
    const r = typeof rng === "function" ? rng : Math.random;
    const keep = Array(RINGS).fill(null);
    v.tries.forEach((t) => { if (Array.isArray(t.fb)) t.fb.forEach((ok, i) => { if (ok) keep[i] = t.code[i]; }); });
    for (let k = 0; k < 200; k++) {
      const code = keep.map((x) => (x !== null ? x : Math.floor(r() * N)));
      if (!v.rep && new Set(code).size < RINGS) continue;
      if (v.tries.some((t) => sameCode(t.code, code))) continue;
      return { t: "try", code };
    }
    return null;
  }
  // Alleen voor tests: de echte code uit de gedeelde toestand.
  const _solution = (shared) => (shared && shared.code ? shared.code.slice() : null);

  // ---------- UI ----------
  const CSS = `
.sl{position:relative;width:100%;height:100%;min-height:480px;overflow:hidden;color:var(--glow,#ffe7b8);container-type:inline-size;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
  background:
    radial-gradient(120% 70% at 0% 18%,rgba(255,120,40,.26),rgba(255,106,26,0) 55%),
    radial-gradient(90% 60% at 100% 100%,rgba(90,169,255,.07),rgba(0,0,0,0) 60%),
    linear-gradient(118deg,rgba(0,0,0,0) 0 22%,rgba(138,90,54,.10) 22% 26%,rgba(0,0,0,0) 26% 62%,rgba(138,90,54,.08) 62% 65%,rgba(0,0,0,0) 65%),
    linear-gradient(180deg,#120c08,var(--soot,#0b0705) 60%,#140d08)}
.sl *{box-sizing:border-box}
.sl-role,.sl-disp,.sl-btn,.sl-time,.sl-ghead h3{font-variant-ligatures:none} /* geen "IJ"-ligatuur die als "U" leest */
.sl::before{content:"";position:absolute;left:-26px;top:0;bottom:0;width:58px;pointer-events:none;z-index:0;
  background:linear-gradient(90deg,#0d0806,#2a1a10 40%,#3a2416 55%,#140c07);box-shadow:0 0 70px 20px rgba(255,106,26,.16);opacity:.85}
.sl::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 45%,rgba(0,0,0,.55))}
.sl-cv{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}
.sl-disp{font-family:"Unbounded",system-ui,sans-serif;font-weight:900;letter-spacing:-.02em}
.sl-scr{position:absolute;inset:0;z-index:4;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  padding:max(20px,env(safe-area-inset-top)) 20px max(22px,env(safe-area-inset-bottom))}
.sl-kicker{font:800 11px/1.2 system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:var(--ember,#ff6a1a)}
.sl-title{font-size:clamp(36px,11.5vw,52px);font-size:clamp(34px,13cqw,52px);line-height:1;margin:8px 0 0;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 45%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 18px rgba(255,106,26,.45))}
.sl-role{display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:9px 16px;border-radius:99px;font:900 14px/1 "Unbounded",system-ui,sans-serif;
  letter-spacing:.02em;color:#2a0d02;background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a));
  box-shadow:0 0 24px rgba(255,106,26,.45)}
.sl-role.g{color:var(--glow,#ffe7b8);background:linear-gradient(180deg,#2a3c58,#1b2638);box-shadow:0 0 24px rgba(90,169,255,.35);border:1px solid rgba(90,169,255,.45)}
.sl-text{font-size:17px;line-height:1.42;max-width:330px;margin:14px 0 0;color:var(--glow,#ffe7b8)}
.sl-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:7px;max-width:340px;margin-top:16px}
.sl-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:99px;font-size:12.5px;color:var(--ash,#b8a99a);
  background:rgba(255,231,184,.06);border:1px solid rgba(255,194,71,.18)}
.sl-chip b{color:var(--glow,#ffe7b8)}
.sl-demo{display:flex;gap:7px;margin-top:22px}
.sl-demo span{width:50px;height:58px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(180deg,#1a120c,#3a2a1d 50%,#1a120c);border:1px solid rgba(214,160,90,.35);box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),0 6px 16px rgba(0,0,0,.5);
  animation:sl-bob 2.6s ease-in-out infinite}
.sl-demo span:nth-child(2){animation-delay:.25s}.sl-demo span:nth-child(3){animation-delay:.5s}.sl-demo span:nth-child(4){animation-delay:.75s}
@keyframes sl-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
.sl-btn{appearance:none;border:0;cursor:pointer;margin-top:22px;min-width:210px;min-height:58px;padding:0 34px;border-radius:99px;
  font:900 19px/1 "Unbounded",system-ui,sans-serif;color:#2a0d02;letter-spacing:.02em;
  background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a) 70%,var(--blaze,#e8401c));
  box-shadow:0 0 0 1px rgba(255,231,184,.35) inset,0 10px 30px rgba(232,64,28,.45),0 0 60px rgba(255,106,26,.25);transition:transform .12s,filter .2s,opacity .2s}
.sl-btn:active{transform:scale(.97)}
.sl-btn[disabled]{filter:grayscale(.6) brightness(.7);cursor:default}
.sl-btn.won[disabled]{filter:none;background:radial-gradient(circle,#fff3d0,var(--flame,#ffc247) 60%,var(--ember,#ff6a1a));box-shadow:0 0 50px rgba(255,194,71,.8)}
.sl-glyph{display:block;width:var(--gs,38px);height:var(--gs,38px);color:var(--c);filter:drop-shadow(0 0 5px var(--c)) drop-shadow(0 1px 0 rgba(0,0,0,.6))}
.sl .mini-countdown{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font:900 96px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);text-shadow:0 0 30px rgba(255,106,26,.9),0 4px 0 #6a1c04;
  background:radial-gradient(circle at 50% 50%,rgba(11,7,5,.2),rgba(11,7,5,.7))}
.sl .mini-countdown.pop{animation:sl-cd .7s ease-out}
@keyframes sl-cd{0%{transform:scale(1.6);opacity:0}25%{transform:scale(1);opacity:1}100%{transform:scale(.92);opacity:.85}}
/* HUD */
.sl-play{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column}
.sl-hud{flex:none;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:max(14px,env(safe-area-inset-top)) 16px 6px}
.sl-time{justify-self:start;font:900 22px/1 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8);font-variant-numeric:tabular-nums}
.sl-time.hot{color:var(--blaze,#e8401c);text-shadow:0 0 12px rgba(232,64,28,.6)}
.sl-mid{font:800 11px/1 system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:var(--ash,#b8a99a);text-align:center}
.sl-pat{justify-self:end;display:flex;gap:5px;align-items:flex-end}
.sl-pat i{position:relative;width:18px;height:24px;display:block;transition:filter .4s,opacity .4s,transform .4s}
.sl-pat i svg{width:100%;height:100%;display:block;filter:drop-shadow(0 0 6px rgba(255,106,26,.85))}
.sl-pat i.out{filter:grayscale(1) brightness(.45);opacity:.55;transform:scale(.8)}
.sl-pat i.out::after{content:"";position:absolute;left:50%;bottom:80%;width:10px;height:10px;margin-left:-5px;border-radius:50%;
  background:rgba(184,169,154,.5);filter:blur(3px);animation:sl-smoke 1.4s ease-out forwards}
@keyframes sl-smoke{0%{transform:translateY(0) scale(.5);opacity:.9}100%{transform:translateY(-26px) scale(2.2);opacity:0}}
.sl-msg{flex:none;min-height:44px;padding:4px 20px 0;display:flex;align-items:center;justify-content:center;text-align:center;
  font-size:15px;line-height:1.35;color:var(--glow,#ffe7b8)}
.sl-msg.bad{color:#ff9a7a}.sl-msg.good{color:var(--flame,#ffc247)}
.sl-msg.pop{animation:sl-in .35s cubic-bezier(.2,.9,.3,1.3)}
@keyframes sl-in{0%{transform:translateY(6px);opacity:0}100%{transform:none;opacity:1}}
/* Slot */
.sl-stage{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:0 14px 6px;touch-action:none}
.sl-lock{--rw:68px;--fh:68px;--wh:146px;position:relative;width:calc(var(--rw)*4 + 24px + 30px);max-width:100%;padding-top:66px}
.sl-shackle{position:absolute;left:50%;top:0;width:66%;height:112px;transform:translateX(-50%);z-index:0;transition:transform .7s cubic-bezier(.3,1.6,.5,1)}
.sl-shackle svg{width:100%;height:100%;display:block;overflow:visible}
.sl-lock.open .sl-shackle{transform:translateX(-50%) translateY(-34px) rotate(-14deg)}
.sl-shackle{transform-origin:50% 100%}
.sl-body{position:relative;z-index:1;border-radius:26px;padding:12px 15px 14px;
  background:radial-gradient(circle at 12px 12px,#c49a5a 0 3px,rgba(0,0,0,0) 4px),radial-gradient(circle at calc(100% - 12px) 12px,#c49a5a 0 3px,rgba(0,0,0,0) 4px),
    radial-gradient(circle at 12px calc(100% - 12px),#c49a5a 0 3px,rgba(0,0,0,0) 4px),radial-gradient(circle at calc(100% - 12px) calc(100% - 12px),#c49a5a 0 3px,rgba(0,0,0,0) 4px),
    linear-gradient(160deg,#4a3a2c,#2a1f17 30%,#1a130e 70%,#2c2119);
  box-shadow:inset 0 0 0 2px rgba(196,154,90,.55),inset 0 2px 0 3px rgba(255,231,184,.10),inset 0 -10px 24px rgba(0,0,0,.6),0 18px 40px rgba(0,0,0,.65),0 0 60px rgba(255,106,26,.12);
  transition:box-shadow .6s}
.sl-lock.open .sl-body{box-shadow:inset 0 0 0 2px rgba(255,210,120,.95),inset 0 0 30px rgba(255,194,71,.35),0 18px 40px rgba(0,0,0,.6),0 0 90px rgba(255,170,60,.7)}
.sl-lock.shake{animation:sl-shake .5s cubic-bezier(.36,.07,.19,.97)}
@keyframes sl-shake{10%,90%{transform:translateX(-2px)}20%,80%{transform:translateX(4px)}30%,50%,70%{transform:translateX(-8px)}40%,60%{transform:translateX(8px)}}
.sl-rings{position:relative;display:grid;grid-template-columns:repeat(4,var(--rw));gap:8px;justify-content:center}
.sl-ring{display:flex;flex-direction:column;align-items:stretch;gap:4px}
.sl-arr{appearance:none;border:0;cursor:pointer;height:40px;border-radius:12px;color:var(--flame,#ffc247);font-size:18px;line-height:1;
  background:linear-gradient(180deg,rgba(255,231,184,.08),rgba(255,231,184,.02));box-shadow:inset 0 0 0 1px rgba(196,154,90,.25);touch-action:none}
.sl-arr:active{background:rgba(255,194,71,.18)}
.sl-arr svg{width:18px;height:18px;display:block;margin:auto}
.sl-win{position:relative;height:var(--wh);border-radius:12px;overflow:hidden;perspective:380px;cursor:grab;touch-action:none;
  background:linear-gradient(180deg,#080504,#1a120c 50%,#080504);box-shadow:inset 0 0 0 2px #7a5a30,inset 0 0 0 3px rgba(0,0,0,.8),0 0 0 1px rgba(255,231,184,.08)}
.sl-win::before{content:"";position:absolute;left:0;right:0;top:50%;height:var(--fh);margin-top:calc(var(--fh)/-2);z-index:2;pointer-events:none;
  border-top:1px solid rgba(255,194,71,.35);border-bottom:1px solid rgba(255,194,71,.35)}
.sl-win::after{content:"";position:absolute;inset:0;z-index:2;pointer-events:none;
  background:linear-gradient(180deg,rgba(5,3,2,.92),rgba(5,3,2,.35) 26%,rgba(255,231,184,.05) 48%,rgba(5,3,2,0) 52%,rgba(5,3,2,.35) 74%,rgba(5,3,2,.92))}
.sl-drum{position:absolute;left:0;right:0;top:50%;height:var(--fh);margin-top:calc(var(--fh)/-2);transform-style:preserve-3d}
.sl-drum.snap{transition:transform .32s cubic-bezier(.25,1.6,.45,1)}
.sl-face{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;backface-visibility:hidden;-webkit-backface-visibility:hidden;
  background:linear-gradient(180deg,#2b1f16,#4a3624 50%,#2b1f16);border-top:1px solid rgba(255,231,184,.12);border-bottom:1px solid rgba(0,0,0,.7)}
.sl-face .sl-glyph{--gs:36px}
.sl-face b{font:800 9.5px/1 system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,231,184,.6)}
.sl-lock.open .sl-face.cur{background:radial-gradient(circle,#ffe7b8,#ffc247 40%,#b5641c 90%);animation:sl-gold .6s ease-out both}
.sl-lock.open .sl-face.cur b{color:#3a1604}
.sl-lock.open .sl-face.cur .sl-glyph{filter:drop-shadow(0 0 8px #fff) drop-shadow(0 0 2px #3a1604)}
@keyframes sl-gold{0%{filter:brightness(1)}40%{filter:brightness(1.8)}100%{filter:brightness(1)}}
.sl-lock.frozen .sl-body::after{content:"";position:absolute;inset:0;border-radius:26px;pointer-events:none;z-index:3;
  background:radial-gradient(circle at 20% 10%,rgba(200,230,255,.5),rgba(90,169,255,.18) 40%,rgba(160,210,255,.32));
  box-shadow:inset 0 0 30px rgba(190,225,255,.7);animation:sl-frost 1.2s ease-out both}
@keyframes sl-frost{from{opacity:0}to{opacity:1}}
.sl-mark{height:22px;display:flex;align-items:center;justify-content:center;font:900 16px/1 system-ui,sans-serif}
.sl-win.ok{box-shadow:inset 0 0 0 2px var(--flame,#ffc247),inset 0 0 22px rgba(255,194,71,.35),0 0 18px rgba(255,194,71,.5)}
.sl-win.no{box-shadow:inset 0 0 0 2px rgba(232,64,28,.8),inset 0 0 0 3px rgba(0,0,0,.8),0 0 12px rgba(232,64,28,.35)}
.sl-mark.ok{color:var(--flame,#ffc247);text-shadow:0 0 10px rgba(255,194,71,.9)}
.sl-mark.no{color:#c24a2e}
.sl-try{margin-top:0;min-width:240px;display:inline-flex;align-items:center;justify-content:center;gap:10px}
.sl-try svg{width:20px;height:20px}
.sl-hist{flex:none;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;min-height:30px;padding:0 12px max(14px,env(safe-area-inset-bottom))}
.sl-att{display:inline-flex;align-items:center;gap:3px;padding:4px 8px;border-radius:10px;background:rgba(23,16,11,.75);border:1px solid rgba(232,64,28,.35)}
.sl-att .sl-glyph{--gs:18px;filter:none}
.sl-att small{font:800 11px/1 system-ui,sans-serif;color:var(--ash,#b8a99a);margin-left:4px}
.sl-att i{width:6px;height:6px;border-radius:50%;background:#5a2a1a;display:block}
.sl-att i.ok{background:var(--flame,#ffc247);box-shadow:0 0 6px var(--flame,#ffc247)}
.sl-att.win{border-color:rgba(255,194,71,.7)}
/* Gids */
.sl-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:8px 16px max(18px,env(safe-area-inset-bottom));
  -webkit-mask-image:linear-gradient(180deg,rgba(0,0,0,0),#000 14px);mask-image:linear-gradient(180deg,rgba(0,0,0,0),#000 14px)}
.sl-ghead{display:flex;align-items:center;gap:12px;margin:2px 0 10px}
.sl-ghead .sl-role{margin:0;padding:7px 11px;font-size:11px}
.sl-ghead h3{margin:0;font:900 17px/1.15 "Unbounded",system-ui,sans-serif;color:var(--glow,#ffe7b8)}
.sl-ghead p{margin:3px 0 0;font-size:13px;color:var(--ash,#b8a99a)}
.sl-rule{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--glow,#ffe7b8);padding:8px 12px;border-radius:12px;margin-bottom:8px;
  background:rgba(90,169,255,.08);border:1px solid rgba(90,169,255,.3)}
.sl-rule.warn{background:rgba(232,64,28,.1);border-color:rgba(232,64,28,.45)}
.sl-fams{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}
.sl-fam{display:flex;flex-direction:column;align-items:center;gap:4px;padding:7px 4px;border-radius:12px;background:rgba(255,231,184,.04);border:1px solid rgba(255,231,184,.10)}
.sl-fam b{font:800 10px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--ash,#b8a99a)}
.sl-fam span{display:flex;gap:8px}
.sl-fam em{display:flex;flex-direction:column;align-items:center;font:600 10px/1 system-ui,sans-serif;font-style:normal;color:rgba(255,231,184,.7);gap:2px}
.sl-fam .sl-glyph{--gs:22px}
.sl-clues{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}
.sl-clue{position:relative;display:flex;gap:12px;align-items:flex-start;padding:13px 14px 13px 12px;border-radius:16px;cursor:pointer;
  font-size:16.5px;line-height:1.45;color:#2a1608;
  background:radial-gradient(120% 140% at 0% 0%,#f6e3bf,#e8cc98 55%,#cfa86c);box-shadow:inset 0 0 0 1px rgba(90,50,20,.35),inset 0 0 22px rgba(120,60,20,.25),0 6px 18px rgba(0,0,0,.45);
  transition:opacity .25s,transform .15s,filter .25s}
.sl-clue:active{transform:scale(.985)}
.sl-clue.read{opacity:.55;filter:saturate(.5)}
.sl-clue.read::after{content:"✓";position:absolute;right:12px;top:10px;font:900 16px/1 system-ui;color:#6a3a12}
.sl-clue .no{flex:none;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-top:1px;
  font:900 13px/1 "Unbounded",system-ui,sans-serif;color:var(--flame,#ffc247);background:#2a1608;box-shadow:0 0 0 2px rgba(106,58,18,.5)}
.sl-clue .tx{flex:1;min-width:0;padding-right:16px}
.sl-rn{display:inline-flex;align-items:center;gap:3px;font-weight:800;white-space:nowrap;padding:0 6px 0 3px;border-radius:8px;background:rgba(42,22,8,.88);color:#ffe7b8;vertical-align:-3px}
.sl-rn .sl-glyph{--gs:19px}
.sl-fm{display:inline-flex;align-items:center;gap:2px;font-weight:800;white-space:nowrap;padding:0 6px;border-radius:8px;background:rgba(42,22,8,.88);color:#ffe7b8;vertical-align:-3px}
.sl-fm .sl-glyph{--gs:16px}
.sl-others{margin:10px 2px 0;font-size:13px;color:var(--ash,#b8a99a)}
.sl-sec{margin:18px 2px 8px;display:flex;justify-content:space-between;align-items:baseline;font:800 11px/1 system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:var(--ember,#ff6a1a)}
.sl-sec small{letter-spacing:.02em;text-transform:none;font-weight:600;color:var(--ash,#b8a99a);font-size:12px}
.sl-pad{display:grid;grid-template-columns:auto repeat(4,1fr);gap:4px;align-items:stretch}
.sl-pad .h{font:800 11px/1 system-ui,sans-serif;color:var(--ash,#b8a99a);text-align:center;padding:4px 0}
.sl-pad .rl{display:flex;align-items:center;gap:5px;padding-right:6px;font-size:12px;color:var(--glow,#ffe7b8)}
.sl-pad .rl .sl-glyph{--gs:20px}
.sl-cell{appearance:none;border:0;cursor:pointer;height:38px;border-radius:9px;font:900 16px/1 system-ui,sans-serif;color:transparent;
  background:rgba(255,231,184,.05);box-shadow:inset 0 0 0 1px rgba(255,231,184,.1);transition:background .15s}
.sl-cell.x{color:#c24a2e;background:rgba(194,74,46,.12)}
.sl-cell.v{color:#2a0d02;background:linear-gradient(180deg,var(--flame,#ffc247),var(--ember,#ff6a1a));box-shadow:0 0 12px rgba(255,140,40,.5)}
.sl-gatt{display:flex;flex-direction:column;gap:6px}
.sl-gatt .sl-att{align-self:flex-start}
.sl-none{font-size:13px;color:var(--ash,#b8a99a)}
.sl-flash{position:absolute;inset:0;z-index:3;pointer-events:none;background:radial-gradient(circle,rgba(232,64,28,0) 40%,rgba(232,64,28,.45));opacity:0}
.sl-flash.on{animation:sl-flash .7s ease-out}
@keyframes sl-flash{0%{opacity:1}100%{opacity:0}}
/* Resultaat */
.sl-res{gap:6px;justify-content:center;background:linear-gradient(180deg,rgba(11,7,5,.95),rgba(11,7,5,.86) 60%,rgba(11,7,5,.7));animation:sl-fade .5s ease-out both;
  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
@keyframes sl-fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.sl-big{font-size:clamp(54px,18vw,84px);font-size:clamp(46px,19cqw,84px);line-height:.95;margin:6px 0 2px;
  background:linear-gradient(180deg,#fff3d0,var(--flame,#ffc247) 50%,var(--ember,#ff6a1a));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 22px rgba(255,106,26,.5))}
.sl-big.cold{background:linear-gradient(180deg,#f2f8ff,#9fd3ff 50%,#5aa9ff);-webkit-background-clip:text;background-clip:text;filter:drop-shadow(0 0 22px rgba(90,169,255,.45))}
.sl-sub{font-size:15px;color:var(--ash,#b8a99a)}
.sl-code{display:flex;gap:8px;margin:14px 0 6px}
.sl-code span{width:62px;height:76px;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
  background:linear-gradient(180deg,#2b1f16,#4a3624 50%,#2b1f16);box-shadow:inset 0 0 0 2px #7a5a30;animation:sl-flip .5s cubic-bezier(.3,1.5,.5,1) both}
.sl-code span b{font:800 9px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,231,184,.65)}
.sl-code.win span{background:radial-gradient(circle,#ffe7b8,#ffc247 45%,#b5641c 95%);box-shadow:0 0 22px rgba(255,194,71,.6)}
.sl-code.win span b{color:#3a1604}
.sl-code span:nth-child(2){animation-delay:.1s}.sl-code span:nth-child(3){animation-delay:.2s}.sl-code span:nth-child(4){animation-delay:.3s}
@keyframes sl-flip{from{transform:rotateX(90deg);opacity:0}to{transform:none;opacity:1}}
.sl-quip{max-width:320px;font-size:15px;line-height:1.4;color:var(--glow,#ffe7b8);margin-top:6px}
.sl-wait{margin-top:16px;display:inline-flex;align-items:center;gap:10px;font-size:15px;color:var(--glow,#ffe7b8);
  padding:10px 16px;border-radius:99px;background:rgba(23,16,11,.75);border:1px solid rgba(255,231,184,.12)}
.sl-wait i{width:10px;height:10px;border-radius:50%;background:var(--ember,#ff6a1a);box-shadow:0 0 12px var(--ember,#ff6a1a);animation:sl-breathe 1s ease-in-out infinite}
@keyframes sl-breathe{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.7);opacity:.6}}
@media (min-height:780px){.sl-lock{--wh:172px;--fh:80px}.sl-face .sl-glyph{--gs:42px}.sl-arr{height:46px}}
@media (max-height:700px){.sl-lock{--wh:128px;--fh:60px;padding-top:54px}.sl-shackle{height:96px}.sl-arr{height:36px}.sl-msg{min-height:38px}}
@media (prefers-reduced-motion:reduce){.sl-demo span,.sl-wait i,.sl-lock.shake,.sl-code span,.sl-msg.pop,.sl-flash.on,.sl-res,.sl-pat i.out::after,
  .sl-lock.open .sl-face.cur{animation:none}.sl-drum.snap{transition-duration:.01s}.sl-shackle{transition:none}}
`;

  function injectCss() {
    if (document.getElementById("mini-slot-css")) return;
    const s = document.createElement("style");
    s.id = "mini-slot-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // Runen als inline SVG (vaste, eigen markup — geen gebruikersinvoer).
  const STAR = (() => { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 8.6 : 20; p.push((24 + rr * Math.cos(a)).toFixed(1) + "," + (25.5 + rr * Math.sin(a)).toFixed(1)); } return p.join(" "); })();
  const ARM = '<path d="M24 5v38M18.5 9.5 24 15l5.5-5.5M18.5 38.5 24 33l5.5 5.5"/>';
  const GLYPH = [
    '<path fill="currentColor" d="M24 3.5c2.2 7.4 11.5 12.2 11.5 24.6a11.5 11.5 0 0 1-23 0c0-6.4 3.2-10.6 7.4-13.6-.4 4.3 1 7.4 3.6 8.8C22 16.6 21.8 10 24 3.5z"/><path fill="rgba(20,8,2,.42)" d="M24 27.5c2.6 3 4.6 5.3 4.6 8.4a4.6 4.6 0 0 1-9.2 0c0-3.1 2-5.4 4.6-8.4z"/>',
    '<path fill="currentColor" d="M30.5 5.5a19.5 19.5 0 1 0 12.2 30.8A16.2 16.2 0 0 1 30.5 5.5z"/>',
    '<g fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">' + ARM + '<g transform="rotate(60 24 24)">' + ARM + '</g><g transform="rotate(120 24 24)">' + ARM + "</g></g>",
    '<path fill="currentColor" d="M24 3l9.5 12.5h-5l9.5 11h-5L43 38.5H5l10-12h-5l9.5-11h-5z"/><rect fill="currentColor" x="21" y="38" width="6" height="7" rx="1"/>',
    '<circle fill="currentColor" cx="24" cy="24" r="18"/><g fill="none" stroke="rgba(40,18,6,.55)" stroke-width="2.2"><circle cx="24" cy="24" r="12.5"/><circle cx="24" cy="24" r="7.5"/><circle cx="24" cy="24" r="2.8"/><path d="M25 23l12-10" stroke-linecap="round"/></g>',
    '<polygon fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" points="' + STAR + '"/>',
  ];
  const FLAME_ICO = '<svg viewBox="0 0 48 48"><defs><linearGradient id="slpf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7b8"/><stop offset=".45" stop-color="#ffc247"/><stop offset="1" stop-color="#e8401c"/></linearGradient></defs><path fill="url(#slpf)" d="M24 2c2.6 8.4 13 13.6 13 27.4a13 13 0 0 1-26 0c0-7.2 3.6-12 8.4-15.4-.5 4.9 1.1 8.4 4 10C22 18 21.6 9.4 24 2z"/></svg>';
  const ARROW = (up) => '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="' + (up ? "M5 15l7-7 7 7" : "M5 9l7 7 7-7") + '"/></svg>';
  const KEY = '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="7.5" cy="12" r="4.5"/><path d="M12 12h10M18 12v4M21 12v3"/></g></svg>';

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  function glyph(r) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 48 48");
    s.setAttribute("class", "sl-glyph");
    s.setAttribute("aria-hidden", "true");
    s.style.setProperty("--c", RUNES[r].col);
    s.innerHTML = GLYPH[r];
    return s;
  }
  const svgEl = (markup) => { const t = document.createElement("span"); t.innerHTML = markup; return t.firstChild; };
  const mod = (x) => ((x % N) + N) % N;

  let uid = 0;
  const GLOEI_WRONG = [
    "Gloei: \"Au. Dat voelde ik tot in mijn pijp.\"",
    "Gloei: \"Nog één kans. Ik word er warm van, en niet op de goede manier.\"",
  ];

  function mount(el, ctx) {
    injectCss();
    let v = ctx.view || null;
    const me = ctx.me ? ctx.me.pid : null;
    const role = (v && v.role) || ctx.role || "kijker";
    const d = dl(v ? v.d : ctx.difficulty), c = CFG[d];
    const limit = (v && v.limit) || c.limit;
    const sfx = ctx.sfx || {};
    const beep = (...a) => { try { sfx.beep && sfx.beep(...a); } catch (e) { /* geen geluid */ } };
    const buzz = (p) => { try { sfx.buzz && sfx.buzz(p); } catch (e) { /* geen tril */ } };
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const players = ctx.players || [];
    const nameOf = (pid) => { const p = players.find((x) => x.pid === pid); return (p && p.name) || "de ander"; };
    const slotName = nameOf(v ? v.slot : null);
    const gidsNames = joinNames((v ? v.gids : []).map(nameOf)) || "de rest";
    const id = "sl" + (++uid);

    const root = h("div", "sl sl-" + role);
    el.appendChild(root);
    let dead = false, phase = "howto", raf = 0, tick = 0, tRef = 0, seenTries = v ? v.tries.length : 0, sentTimeout = 0;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!dead) fn(); }, ms); timers.add(t); };
    const offs = [];
    const on = (node, type, fn, opt) => { node.addEventListener(type, fn, opt); offs.push(() => node.removeEventListener(type, fn, opt)); };

    // --- Sfeer: stofjes in het licht van de kachelpijp, plus vonken bij succes ---
    const cv = h("canvas", "sl-cv");
    root.appendChild(cv);
    const g = cv.getContext && cv.getContext("2d");
    const drng = M.rng((ctx.seed >>> 0) ^ 0xd057);
    const motes = Array.from({ length: reduced ? 8 : 26 }, () => ({ x: drng(), y: drng(), r: 0.5 + drng() * 1.4, sp: 0.004 + drng() * 0.012, ph: drng() * 6.28 }));
    const burst = [];
    let W = 0, H = 0, dpr = 1, last = 0;
    function fit() {
      const r = root.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    function frame(ts) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (!g) return;
      const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016); last = ts;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.globalCompositeOperation = "lighter";
      motes.forEach((m) => {
        m.y -= m.sp * dt * 6; m.x += Math.sin(ts / 2400 + m.ph) * 0.00025;
        if (m.y < -0.02) { m.y = 1.02; m.x = drng(); }
        const warm = Math.max(0, 1 - m.x * 1.6); // dichter bij de pijp = feller
        g.fillStyle = "rgba(255," + Math.round(190 + 40 * warm) + ",140," + (0.12 + 0.35 * warm).toFixed(3) + ")";
        g.beginPath(); g.arc(m.x * W, m.y * H, m.r, 0, 6.283); g.fill();
      });
      for (let i = burst.length - 1; i >= 0; i--) {
        const p = burst[i];
        p.life -= dt; if (p.life <= 0) { burst.splice(i, 1); continue; }
        p.vy += 260 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        const a = Math.min(1, p.life / p.max * 1.6);
        g.fillStyle = p.col.replace("A", a.toFixed(3));
        g.beginPath(); g.arc(p.x, p.y, p.r * (0.5 + a * 0.5), 0, 6.283); g.fill();
      }
      g.globalCompositeOperation = "source-over";
    }
    function sparkle(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, s = 90 + Math.random() * 320, life = 0.7 + Math.random() * 0.9;
        burst.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 180, r: 1.4 + Math.random() * 2.6, life, max: life,
          col: Math.random() < 0.15 ? "rgba(140,200,255,A)" : Math.random() < 0.5 ? "rgba(255,210,110,A)" : "rgba(255,120,40,A)" });
      }
    }

    // --- Howto ---
    const how = h("div", "sl-scr sl-howto");
    how.appendChild(h("div", "sl-kicker", "De kist op zolder · " + c.name));
    how.appendChild(h("h2", "sl-title sl-disp", "Het ringslot"));
    const howText = role === "slot"
      ? "Draai de vier ringen naar de geheime code: " + gidsNames + " " + (v && v.gids.length > 1 ? "hebben" : "heeft") + " de aanwijzingen, dus luister goed."
      : role === "gids"
        ? "Lees je aanwijzingen hardop voor, zodat " + slotName + " de vier ringen goed kan zetten. " + slotName + " ziet ze zelf niet!"
        : "Kijk mee: één draait aan het slot, de rest leest aanwijzingen voor.";
    how.appendChild(h("div", "sl-role" + (role === "slot" ? "" : " g"), role === "slot" ? "🔐 Jij draait het slot" : role === "gids" ? "📜 Jij bent de gids" : "👀 Kijker"));
    how.appendChild(h("p", "sl-text", howText));
    const demo = h("div", "sl-demo");
    [0, 1, 2, 3].map((i) => (i * 2 + (ctx.seed >>> 0)) % N).forEach((r) => { const s = h("span"); s.appendChild(glyph(r)); demo.appendChild(s); });
    how.appendChild(demo);
    const chips = h("div", "sl-chips");
    const chip = (txt, b) => { const x = h("span", "sl-chip"); x.appendChild(document.createTextNode(txt)); if (b) x.appendChild(h("b", null, b)); chips.appendChild(x); };
    chip("⏳ ", fmt(limit * 1000));
    chip("🔥 ", MAX_TRIES + " pogingen");
    chip("", { ring: "Goede ringen lichten op", count: "Slot telt de goede ringen", none: "Slot zegt niks terug" }[c.fb]);
    if (c.rep) chip("", "Tekens kunnen dubbel");
    how.appendChild(chips);
    const startBtn = h("button", "sl-btn", "Start");
    startBtn.type = "button";
    if (role !== "kijker") how.appendChild(startBtn);
    root.appendChild(how);

    // --- Speelscherm (gedeelde HUD) ---
    const play = h("div", "sl-play");
    const hud = h("div", "sl-hud");
    const timeEl = h("div", "sl-time", fmt(limit * 1000));
    const midEl = h("div", "sl-mid", "Poging 1 / " + MAX_TRIES);
    const pat = h("div", "sl-pat");
    pat.setAttribute("aria-label", "Gloei's geduld");
    const patI = [];
    for (let i = 0; i < MAX_TRIES; i++) { const x = h("i"); x.appendChild(svgEl(FLAME_ICO.replace(/slpf/g, id + "f" + i))); pat.appendChild(x); patI.push(x); }
    hud.append(timeEl, midEl, pat);
    play.appendChild(hud);
    const msg = h("div", "sl-msg");
    play.appendChild(msg);
    const flash = h("div", "sl-flash");
    function say(text, cls) {
      msg.textContent = text; msg.className = "sl-msg" + (cls ? " " + cls : "");
      void msg.offsetWidth; msg.classList.add("pop");
    }

    // ===== Slot =====
    let lock = null, tryBtn = null, hist = null;
    const ringUI = [];
    let pos = (v && v.rings ? v.rings : [0, 0, 0, 0]).slice(); // continue posities (gehele getallen in rust)
    let touched = false; // ringen al gedraaid? Zo niet, dan volgt pos de (later binnengekomen) ringstand van de host.
    let busy = false, busyT = 0;
    const idx = (k) => mod(Math.round(pos[k]));
    const current = () => [0, 1, 2, 3].map(idx);

    function click(strong) {
      beep(strong ? 1700 : 2300 + Math.random() * 300, 0.012, "square", strong ? 0.05 : 0.03);
      beep(150, 0.025, "triangle", 0.04);
      buzz(strong ? 12 : 5);
    }
    function setDrum(k, animate) {
      const u = ringUI[k];
      u.drum.classList.toggle("snap", !!animate);
      u.drum.style.transform = "translateZ(" + (-u.R) + "px) rotateX(" + (pos[k] * 60).toFixed(2) + "deg)";
      const cur = idx(k);
      u.faces.forEach((f, i) => f.classList.toggle("cur", i === cur));
    }
    function clearMark(k) { const m = ringUI[k].mark; m.textContent = ""; m.className = "sl-mark"; ringUI[k].win.classList.remove("ok", "no"); }
    function markRing(k, ok) {
      const u = ringUI[k];
      u.mark.textContent = ok ? "✓" : "✗"; u.mark.className = "sl-mark " + (ok ? "ok" : "no");
      u.win.classList.toggle("ok", ok); u.win.classList.toggle("no", !ok);
    }
    function turn(k, delta) {
      // delta in hele stappen vanaf de huidige rustpositie; stuurt de netto draai naar de host
      if (phase !== "play" || busy) return;
      touched = true;
      pos[k] = Math.round(pos[k]) + delta;
      setDrum(k, true); click(false); clearMark(k);
      let dir = mod(delta); if (dir > 3) dir -= N;
      if (dir) ctx.send({ t: "rot", ring: k, dir });
    }

    function buildSlot() {
      const stage = h("div", "sl-stage");
      lock = h("div", "sl-lock");
      const shackle = h("div", "sl-shackle");
      shackle.appendChild(svgEl('<svg viewBox="0 0 200 120" preserveAspectRatio="none"><defs><linearGradient id="' + id + 'sh" x1="0" x2="1"><stop offset="0" stop-color="#3a3632"/><stop offset=".25" stop-color="#a8a39b"/><stop offset=".5" stop-color="#5b5650"/><stop offset=".78" stop-color="#c9c2b6"/><stop offset="1" stop-color="#3a3632"/></linearGradient></defs>' +
        '<path d="M38 120V64a62 62 0 0 1 124 0v56" fill="none" stroke="#120c08" stroke-width="30"/><path d="M38 120V64a62 62 0 0 1 124 0v56" fill="none" stroke="url(#' + id + 'sh)" stroke-width="22"/></svg>'));
      lock.appendChild(shackle);
      const body = h("div", "sl-body");
      const rings = h("div", "sl-rings");
      for (let k = 0; k < RINGS; k++) {
        const col = h("div", "sl-ring");
        const up = h("button", "sl-arr"); up.type = "button"; up.setAttribute("aria-label", "Ring " + (k + 1) + " omhoog"); up.appendChild(svgEl(ARROW(true)));
        const dn = h("button", "sl-arr"); dn.type = "button"; dn.setAttribute("aria-label", "Ring " + (k + 1) + " omlaag"); dn.appendChild(svgEl(ARROW(false)));
        const win = h("div", "sl-win");
        const drum = h("div", "sl-drum");
        const faces = RUNES.map((rn, i) => { const f = h("div", "sl-face"); f.appendChild(glyph(i)); f.appendChild(h("b", null, rn.n)); drum.appendChild(f); return f; });
        win.appendChild(drum);
        const mark = h("div", "sl-mark");
        col.append(up, win, dn, mark);
        rings.appendChild(col);
        ringUI.push({ col, win, drum, faces, mark, up, dn, R: 0 });
        on(up, "click", () => turn(k, 1));
        on(dn, "click", () => turn(k, -1));
        // Slepen: vinger omlaag = trommel rolt omlaag; elke streep een klik, loslaten = vastklikken.
        let drag = null;
        on(win, "pointerdown", (e) => {
          if (phase !== "play" || busy) return;
          e.preventDefault();
          touched = true;
          try { win.setPointerCapture(e.pointerId); } catch (er) { /* oud toestel */ }
          drag = { id: e.pointerId, y: e.clientY, p0: Math.round(pos[k]), last: Math.round(pos[k]), moved: false };
          ringUI[k].drum.classList.remove("snap");
        });
        on(win, "pointermove", (e) => {
          if (!drag || e.pointerId !== drag.id) return;
          const dy = e.clientY - drag.y;
          if (Math.abs(dy) > 6) drag.moved = true;
          pos[k] = drag.p0 - dy / ringUI[k].step;
          setDrum(k, false);
          const r = Math.round(pos[k]);
          if (r !== drag.last) { drag.last = r; click(false); clearMark(k); }
        });
        const end = (e) => {
          if (!drag || e.pointerId !== drag.id) return;
          const dg = drag; drag = null;
          if (!dg.moved && e.type === "pointercancel") { pos[k] = dg.p0; setDrum(k, true); return; } // geen spookstap
          if (!dg.moved) {
            // tik: bovenste helft = omhoog, onderste = omlaag
            const r = win.getBoundingClientRect();
            pos[k] = dg.p0;
            turn(k, e.clientY < r.top + r.height / 2 ? 1 : -1);
            return;
          }
          const target = Math.round(pos[k]);
          pos[k] = target; setDrum(k, true); click(true);
          let dir = mod(target - dg.p0); if (dir > 3) dir -= N;
          if (dir) ctx.send({ t: "rot", ring: k, dir });
        };
        on(win, "pointerup", end);
        on(win, "pointercancel", end);
      }
      body.appendChild(rings);
      lock.appendChild(body);
      stage.appendChild(lock);
      tryBtn = h("button", "sl-btn sl-try");
      tryBtn.type = "button";
      tryBtn.appendChild(svgEl(KEY));
      tryBtn.appendChild(h("span", null, "Open het slot"));
      stage.appendChild(tryBtn);
      play.appendChild(stage);
      hist = h("div", "sl-hist");
      play.appendChild(hist);
      on(tryBtn, "click", () => {
        if (phase !== "play" || busy) return;
        const code = current();
        if (v && v.tries.some((t) => sameCode(t.code, code))) { say("Die combinatie hebben jullie al geprobeerd.", "bad"); shake(); return; }
        busy = true; tryBtn.disabled = true; tryBtn.lastChild.textContent = "Klik…";
        beep(110, 0.09, "square", 0.07); beep(70, 0.14, "triangle", 0.08); buzz(25);
        ctx.send({ t: "try", code });
        clearTimeout(busyT);
        busyT = setTimeout(() => { if (!dead && busy && phase === "play") { busy = false; tryBtn.disabled = false; tryBtn.lastChild.textContent = "Open het slot"; } }, 4000);
      });
      say(gidsNames + " " + (v && v.gids.length > 1 ? "hebben" : "heeft") + " de aanwijzingen. Vraag erom!");
    }
    function layoutRings() {
      // ringbreedte uit de echte containerbreedte (niet vw: de testbank toont meerdere telefoons naast elkaar)
      const rw = Math.max(54, Math.min(76, Math.floor((root.clientWidth - 28 - 30 - 24) / 4)));
      if (lock) lock.style.setProperty("--rw", rw + "px");
      ringUI.forEach((u, k) => {
        const fh = u.faces[0].offsetHeight || 68;
        u.R = Math.round(fh / (2 * Math.tan(Math.PI / N)));
        u.step = fh * 0.95;
        u.faces.forEach((f, i) => { f.style.transform = "rotateX(" + (-i * 60) + "deg) translateZ(" + u.R + "px)"; });
        setDrum(k, false);
      });
    }
    function shake() { if (!lock) return; lock.classList.remove("shake"); void lock.offsetWidth; lock.classList.add("shake"); }
    function attChip(t) {
      const a = h("span", "sl-att" + (t.ok ? " win" : ""));
      t.code.forEach((r) => a.appendChild(glyph(r)));
      if (Array.isArray(t.fb)) t.fb.forEach((ok) => a.appendChild(h("i", ok ? "ok" : "")));
      else if (typeof t.fb === "number") a.appendChild(h("small", null, t.fb + "/4 goed"));
      else if (!t.ok) a.appendChild(h("small", null, "fout"));
      return a;
    }

    // ===== Gids =====
    let gAtt = null;
    function buildGids() {
      const sc = h("div", "sl-scroll");
      const head = h("div", "sl-ghead");
      const kijk = role !== "gids";
      head.appendChild(h("div", "sl-role g", kijk ? "Kijker" : "Gids"));
      const ht = h("div");
      ht.appendChild(h("h3", null, kijk ? "Je kijkt mee" : "Lees voor aan " + slotName));
      ht.appendChild(h("p", null, kijk ? slotName + " draait, " + gidsNames + " " + (v && v.gids.length > 1 ? "lezen" : "leest") + " voor." : slotName + " ziet alleen het slot. Jij alleen dit."));
      head.appendChild(ht);
      sc.appendChild(head);
      sc.appendChild(h("div", "sl-rule" + (v && v.rep ? " warn" : ""), v && v.rep ? "⚠️ Let op: tekens kunnen dubbel voorkomen!" : "Elk teken komt hooguit één keer voor. Ringen tel je van links (1) naar rechts (4)."));
      const fams = h("div", "sl-fams");
      FAM_KEYS.forEach((fk) => {
        const f = h("div", "sl-fam");
        f.appendChild(h("b", null, FAMS[fk].name));
        const s = h("span");
        FAMS[fk].runes.forEach((r) => { const e = h("em"); e.appendChild(glyph(r)); e.appendChild(document.createTextNode(RUNES[r].n)); s.appendChild(e); });
        f.appendChild(s);
        fams.appendChild(f);
      });
      sc.appendChild(fams);
      if (!kijk) buildClues(sc);
      sc.appendChild(h("div", "sl-sec", "Pogingen van " + slotName));
      gAtt = h("div", "sl-gatt");
      gAtt.appendChild(h("div", "sl-none", "Nog niks geprobeerd."));
      sc.appendChild(gAtt);
      play.appendChild(sc);
    }

    // Kladblok + "voorgelezen" overleven een herlaadbeurt midden in het spel (alleen in deze browser).
    const noteKey = "dva:slot-notes:" + (ctx.seed >>> 0) + ":" + me;
    const notes = (() => { try { return JSON.parse(sessionStorage.getItem(noteKey)) || {}; } catch (e) { return {}; } })();
    const saveNotes = () => { try { sessionStorage.setItem(noteKey, JSON.stringify(notes)); } catch (e) { /* privémodus */ } };
    notes.pad = Array.isArray(notes.pad) && notes.pad.length === N * RINGS ? notes.pad : Array(N * RINGS).fill(0);
    notes.read = Array.isArray(notes.read) ? notes.read : [];

    function buildClues(sc) {
      const sec = h("div", "sl-sec", "Jouw aanwijzingen");
      sec.appendChild(h("small", null, "tik = voorgelezen"));
      sc.appendChild(sec);
      const ul = h("ul", "sl-clues");
      ((v && v.clues) || []).forEach((cl, i) => {
        const li = h("li", "sl-clue");
        li.appendChild(h("span", "no", String(i + 1)));
        const tx = h("span", "tx");
        cl.parts.forEach((p) => {
          if (typeof p === "string") { tx.appendChild(document.createTextNode(p)); return; }
          if (p.g) { const f = h("span", "sl-fm"); FAMS[p.g].runes.forEach((r) => f.appendChild(glyph(r))); f.appendChild(document.createTextNode(" " + FAMS[p.g].name)); tx.appendChild(f); return; }
          const rn = h("span", "sl-rn"); rn.appendChild(glyph(p.r)); rn.appendChild(document.createTextNode(runeWord(p.r, p.form))); tx.appendChild(rn);
        });
        li.appendChild(tx);
        li.setAttribute("data-clue", cl.text);
        if (notes.read.includes(cl.id)) li.classList.add("read");
        on(li, "click", () => {
          const r = li.classList.toggle("read");
          notes.read = notes.read.filter((x) => x !== cl.id).concat(r ? [cl.id] : []); saveNotes();
          beep(900, 0.02, "sine", 0.03);
        });
        ul.appendChild(li);
      });
      if (!v || !v.clues || !v.clues.length) ul.appendChild(h("li", "sl-none", "Jij hebt deze keer geen aanwijzingen. Help met denken!"));
      sc.appendChild(ul);
      const others = ((v && v.holders) || []).filter((x) => x.pid !== me && x.n > 0);
      if (others.length) sc.appendChild(h("p", "sl-others", others.map((x) => nameOf(x.pid) + " heeft er " + x.n).join(", ") + ". Samen weten jullie alles."));
      // Kladblok: tik een vakje: ✗ → ✓ → leeg
      const ps = h("div", "sl-sec", "Kladblok");
      ps.appendChild(h("small", null, "tik: ✗ · ✓ · leeg"));
      sc.appendChild(ps);
      const pad = h("div", "sl-pad");
      pad.appendChild(h("span", "h", ""));
      for (let k = 0; k < RINGS; k++) pad.appendChild(h("span", "h", "Ring " + (k + 1)));
      RUNES.forEach((rn, r) => {
        const rl = h("span", "rl"); rl.appendChild(glyph(r)); rl.appendChild(document.createTextNode(rn.n)); pad.appendChild(rl);
        for (let k = 0; k < RINGS; k++) {
          const b = h("button", "sl-cell", "✗"); b.type = "button"; b.setAttribute("aria-label", rn.n + " op ring " + (k + 1));
          const ci = r * RINGS + k;
          const paint = () => { const st = notes.pad[ci]; b.className = "sl-cell" + (st === 1 ? " x" : st === 2 ? " v" : ""); b.textContent = st === 2 ? "✓" : "✗"; };
          paint();
          on(b, "click", () => { notes.pad[ci] = (notes.pad[ci] + 1) % 3; paint(); saveNotes(); beep(notes.pad[ci] === 2 ? 1200 : 700, 0.015, "sine", 0.025); });
          pad.appendChild(b);
        }
      });
      sc.appendChild(pad);
    }

    function renderTries() {
      const ts = (v && v.tries) || [];
      const left = MAX_TRIES - ts.filter((t) => !t.ok).length; // geduld: alleen foute pogingen kosten een vlammetje
      patI.forEach((x, i) => x.classList.toggle("out", i >= left));
      midEl.textContent = v && v.done && v.done.solved ? "Open!" : left > 0 ? "Poging " + Math.min(MAX_TRIES, ts.length + 1) + " / " + MAX_TRIES : "Geen pogingen meer";
      if (hist) { hist.textContent = ""; ts.forEach((t) => hist.appendChild(attChip(t))); }
      if (gAtt && ts.length) { gAtt.textContent = ""; ts.forEach((t) => gAtt.appendChild(attChip(t))); }
    }

    function onNewTry(t) {
      const left = MAX_TRIES - v.tries.length;
      if (t.ok) return; // succes volgt via done
      root.appendChild(flash); flash.classList.remove("on"); void flash.offsetWidth; flash.classList.add("on");
      beep(150, 0.28, "sawtooth", 0.06); beep(95, 0.35, "square", 0.04); buzz([60, 40, 90]);
      if (role === "slot") {
        busy = false; clearTimeout(busyT);
        tryBtn.disabled = false; tryBtn.lastChild.textContent = "Open het slot";
        shake();
        if (Array.isArray(t.fb)) {
          t.fb.forEach((ok, k) => { if (idx(k) === t.code[k]) markRing(k, ok); });
          const n = t.fb.filter(Boolean).length;
          say(n ? n + (n === 1 ? " ring zit" : " ringen zitten") + " goed. " + (left ? "Nog " + left + (left === 1 ? " poging." : " pogingen.") : "") : "Geen enkele ring goed. " + (GLOEI_WRONG[MAX_TRIES - 1 - left] || ""), "bad");
        } else if (typeof t.fb === "number") {
          say(t.fb + " van de 4 ringen " + (t.fb === 1 ? "zit" : "zitten") + " goed. Maar welke?", "bad");
        } else {
          say("Fout. " + (GLOEI_WRONG[MAX_TRIES - 1 - left] || "Het slot zegt verder niks."), "bad");
        }
      } else if (role === "gids") {
        say(slotName + " probeerde het: fout! " + (left ? "Nog " + left + (left === 1 ? " poging." : " pogingen.") : ""), "bad");
      }
    }

    function finish() {
      if (phase === "result") return;
      const dn = v.done, sol = v.solution || [];
      const wasPlaying = phase === "play";
      phase = "result";
      clearInterval(tick); tick = 0; clearTimeout(busyT);
      if (dn.solved) {
        renderTries();
        if (tryBtn) { tryBtn.disabled = true; tryBtn.classList.add("won"); tryBtn.lastChild.textContent = "Open!"; }
        ringUI.forEach((u, k) => markRing(k, true));
        if (lock) {
          lock.classList.add("open");
          const r = lock.getBoundingClientRect(), rr = root.getBoundingClientRect();
          later(() => sparkle(r.left - rr.left + r.width / 2, r.top - rr.top + r.height * 0.35, reduced ? 20 : 90), 250);
        } else sparkle(W / 2, H * 0.4, reduced ? 20 : 70);
        [523, 659, 784, 1047].forEach((f, i) => later(() => beep(f, 0.16, "triangle", 0.08), 80 + i * 110));
        later(() => { try { sfx.fanfare && sfx.fanfare(); sfx.confetti && sfx.confetti(); } catch (e) { /* stil */ } }, 560);
        buzz([30, 40, 80]);
        say("Klik! Het slot is open!", "good");
      } else {
        if (lock) lock.classList.add("frozen");
        if (tryBtn) { tryBtn.disabled = true; tryBtn.lastChild.textContent = "Dicht"; }
        beep(196, 0.4, "sine", 0.05); beep(147, 0.6, "sine", 0.05);
        say(dn.timeout ? "De tijd is op…" : "Het slot zit muurvast.", "bad");
      }
      later(() => showResult(dn, sol), wasPlaying ? (dn.solved ? 1700 : 1300) : 0);
    }

    function showResult(dn, sol) {
      const res = h("div", "sl-scr sl-res");
      res.appendChild(h("div", "sl-kicker", dn.solved ? "De kist is open" : dn.timeout ? "De tijd is op" : "Drie keer mis"));
      res.appendChild(h("div", "sl-big sl-disp" + (dn.solved ? "" : " cold"), dn.solved ? "OPEN!" : "DICHT"));
      res.appendChild(h("div", "sl-sub", dn.solved ? "Poging " + dn.tries + " van " + MAX_TRIES + " · " + fmt(dn.ms) : "De code was:"));
      const code = h("div", "sl-code" + (dn.solved ? " win" : ""));
      sol.forEach((r) => { const s = h("span"); s.appendChild(glyph(r)); s.appendChild(h("b", null, RUNES[r].n)); code.appendChild(s); });
      res.appendChild(code);
      const lg = logsFor(valid(dn), d);
      res.appendChild(h("div", "sl-quip", dn.solved
        ? (lg >= 3 ? "Gloei: \"Eikenhout! Ik ruik het al. Jullie zijn mijn favoriete mensen.\"" : "Gloei: \"Eindelijk. Ik was al bijna een waakvlammetje.\"")
        : "Gloei: \"Dan maar de pook. Niet netjes, wel warm.\""));
      const w = h("div", "sl-wait"); w.appendChild(h("i")); w.appendChild(document.createTextNode("Klaar! Wachten op de rest…"));
      res.appendChild(w);
      root.appendChild(res);
    }

    function startTimer() {
      if (tick) return;
      // Hostklok (t0) gebruiken zolang die geloofwaardig is: ook na herladen midden in het spel loopt de tijd door.
      // Alleen bij een duidelijk scheve klok (t0 in de toekomst of al lang voorbij) vallen we terug op nu.
      const el = v && v.t0 ? Date.now() - v.t0 : NaN;
      tRef = el > -5000 && el < limit * 1000 + 60000 ? v.t0 : Date.now();
      let lastSec = -1;
      const upd = () => {
        if (dead || phase !== "play") return;
        const left = limit * 1000 - (Date.now() - tRef);
        const sec = Math.max(0, Math.ceil(left / 1000));
        timeEl.textContent = fmt(sec * 1000);
        timeEl.classList.toggle("hot", sec <= 15);
        if (sec !== lastSec) { lastSec = sec; if (sec <= 10 && sec > 0) beep(sec <= 3 ? 880 : 660, 0.03, "square", 0.025); }
        if (left <= 0 && Date.now() - sentTimeout > 3000) { sentTimeout = Date.now(); ctx.send({ t: "timeout" }); }
      };
      upd();
      tick = setInterval(upd, 250);
    }

    function enterPlay() {
      phase = "play";
      if (role === "slot") buildSlot(); else buildGids();
      root.appendChild(play);
      if (role === "slot") {
        layoutRings();
        // na herladen: de ✓/✗ van de laatste poging terug op ringen die nog zo staan (roestig slot)
        const lt = v && !v.done && v.tries[v.tries.length - 1];
        if (lt && Array.isArray(lt.fb)) lt.fb.forEach((ok, k) => { if (idx(k) === lt.code[k]) markRing(k, ok); });
      }
      renderTries();
      if (role === "slot" || (v && v.running)) startTimer();
      else timeEl.textContent = "—";
      if (role === "gids" && !(v && v.running)) say("Wachten tot " + slotName + " begint…");
      else if (role === "gids") say("Lees je aanwijzingen hardop voor!");
      if (v && v.done) finish();
    }

    on(startBtn, "click", () => {
      if (phase !== "howto") return;
      phase = "count";
      beep(1, 0.001, "sine", 0.0001); // audio ontgrendelen binnen het gebaar
      how.remove();
      ctx.countdown(root, { go: "DRAAI!" }).then(() => {
        if (dead) return;
        ctx.send({ t: "go" });
        enterPlay();
      });
    });

    fit();
    // Containermaat volgen (draaien, venster, of een story-podium dat later pas zijn maat krijgt).
    const relayout = () => { if (dead) return; fit(); if (ringUI.length) layoutRings(); };
    let ro = null;
    if (typeof ResizeObserver === "function") { ro = new ResizeObserver(relayout); ro.observe(root); }
    else on(window, "resize", relayout);
    raf = requestAnimationFrame(frame);

    // Terugkomen na herladen: al begonnen → meteen spelen; al klaar → meteen resultaat.
    if (v && v.done) { how.remove(); phase = "count"; enterPlay(); }
    else if (v && v.started && role !== "kijker") { how.remove(); enterPlay(); }
    else if (v && v.running && role === "kijker") { how.remove(); enterPlay(); }

    // Testhaakje (alleen voor Playwright): leesbare toestand, geen globale variabele.
    Object.defineProperty(root, "_slot", { value: { get phase() { return phase; }, get rings() { return role === "slot" ? current() : null; }, role, get view() { return v; } }, enumerable: false });

    return {
      update(nv) {
        if (dead || !nv) return;
        const prev = v;
        v = nv;
        // De privé-view komt meestal nét na de publieke state binnen: de ringen beginnen dan op de stand van de host
        // (anders staan telefoon en host vanaf het begin verschillend en klopt de stand na herladen niet).
        if (role === "slot" && Array.isArray(v.rings) && !touched && !(prev && Array.isArray(prev.rings))) {
          pos = v.rings.slice();
          if (ringUI.length) ringUI.forEach((u, k) => setDrum(k, false));
        }
        if (phase === "howto" || phase === "count") {
          seenTries = v.tries.length;
          if (phase === "howto" && (v.done || (role === "kijker" && v.running))) { how.remove(); if (v.done) phase = "count"; enterPlay(); }
          return;
        }
        if (phase !== "play") return;
        if (role === "gids" && v.running && !(prev && prev.running)) { startTimer(); say("Lees je aanwijzingen hardop voor!"); }
        if (v.tries.length > seenTries) {
          const fresh = v.tries.slice(seenTries);
          seenTries = v.tries.length;
          renderTries();
          fresh.forEach(onNewTry);
        }
        if (v.done) finish();
      },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        clearInterval(tick); clearTimeout(busyT);
        timers.forEach(clearTimeout); timers.clear();
        offs.forEach((f) => f()); offs.length = 0;
        root.remove();
      },
    };
  }

  const def = {
    id: "slot", title: "Het ringslot", icon: "🔐", kind: "net",
    howto: "Eén draait aan het slot, de rest leest aanwijzingen voor: kraak samen de code van vier runen.",
    roles, init, reduce, view, result, score, mount, bot, _solution,
    CFG, RUNES, FAMS, MAX_TRIES, evalClue, solve, genPuzzle, partsOf, textOf, logsFor, valid,
  };
  M.register(def);
  if (typeof module === "object" && module.exports) module.exports = def;
})();
