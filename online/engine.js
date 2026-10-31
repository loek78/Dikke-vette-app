/*
 * DVInfiltrant — pure game engine for online "Infiltrant" (Dikke Vette App v2).
 * UMD: browser global `window.DVInfiltrant` + CommonJS `module.exports`.
 * Pure: no DOM, network, Date.now or Math.random. Randomness/time/words come in via `ctx`.
 * The input state is never mutated; every change returns a fresh object.
 *
 * API
 *   DVInfiltrant.createState({ code, host: { pid, key, name, avatar, color }, settings?, now? }) → state
 *       Host is auto-joined, acks[host] = 0 (host's first envelope uses seq 1).
 *   DVInfiltrant.reduce(state, env, ctx) → newState
 *       env = { pid, key, seq, t, d }, ctx = { rng: () => [0,1), now: ms, words: DV_WORDPAIRS }
 *       - ignored envelope (unknown pid & not join, wrong key, duplicate/gap seq, removed pid) → SAME reference
 *       - acked but semantically invalid action → new state where only `acks` (and for a new pid `keys`) changed
 *       - valid action → new state with `updatedAt = ctx.now`
 *   DVInfiltrant.publicView(state) → public state (spec §3.6). Never contains keys, roles, words or votes-in-progress.
 *       `result` only in phase "over". In lobby `infiltrantCount` is computed from the current player count.
 *   DVInfiltrant.privateView(state, pid) → { v:1, gameNo, word, category, role, knowsRole } | null
 *       null in lobby, for spectators, left/removed players and unknown pids.
 *   DVInfiltrant.normalize(str)  lowercase, trim, strip accents/punctuation/spaces
 *   DVInfiltrant.levenshtein(a, b), DVInfiltrant.effectiveInfiltrants(setting, n)
 *   DVInfiltrant.DEFAULT_SETTINGS, MIN_PLAYERS (3), MAX_PLAYERS (12)
 *
 * Word pairs (ctx.words) may be objects { a, b, cat|c|category, id? } or arrays [a, b, cat].
 * A pair's identity for `usedPairs` is `id` when present, else "a|b".
 *
 * Internal (secret) state fields, never published: keys, roles, words { burger, infiltrant, category, pairId },
 * votes { voter: target }, usedPairs, pendingWinner, starter, gameDelta.
 *
 * Scoring: correct-vote bonus +1 per voter whose target is an infiltrant (only in the vote that resolves:
 * an elimination or a double tie, not the first tie). Win: burgers +2 each, infiltranten +4 each (+1 for a correct
 * guesser). Players that left/were kicked get no win points. `result.delta` = all points of this game (votes + win).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DVInfiltrant = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 12;
  const DEFAULT_SETTINGS = Object.freeze({ mode: "woord", infiltrants: 1, hintRounds: 1, timer: 0, categories: Object.freeze([]) });
  const IN_GAME = ["reveal", "hints", "vote", "guess", "elim"];

  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const chars = (s) => Array.from(s);

  // ---------- Tekst ----------
  function normalize(str) {
    return String(str == null ? "" : str).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/[^\p{L}\p{N}]/gu, "");
  }
  function clean(str, max) {
    if (typeof str !== "string") return "";
    return chars(str.replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
  }
  function levenshtein(a, b) {
    a = chars(a); b = chars(b);
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  const effectiveInfiltrants = (setting, n) => Math.min(setting === 2 ? 2 : 1, Math.max(1, Math.floor((n - 1) / 2)));

  // ---------- Profiel ----------
  const isColor = (c) => typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
  function profile(d, prev) {
    prev = prev || {};
    const name = clean(d && d.name, 16) || prev.name || "Speler";
    const avatar = clean(d && d.avatar, 16) || prev.avatar || "🙂";
    const color = isColor(d && d.color) ? d.color : prev.color || "#8b5cff";
    return { name, avatar, color };
  }

  // ---------- Woorden ----------
  function pairOf(x) {
    if (!x) return null;
    let a, b, cat, id;
    if (Array.isArray(x)) [a, b, cat] = x;
    else if (typeof x === "object") {
      a = x.a != null ? x.a : Array.isArray(x.w) ? x.w[0] : x.burger;
      b = x.b != null ? x.b : Array.isArray(x.w) ? x.w[1] : x.infiltrant;
      cat = x.cat != null ? x.cat : x.c != null ? x.c : x.category;
      id = x.id;
    }
    if (typeof a !== "string" || typeof b !== "string" || !a || !b) return null;
    return { a, b, cat: cat == null ? null : cat, id: id != null ? String(id) : a + "|" + b };
  }
  function wordList(ctx) {
    const w = (ctx && ctx.words) || (typeof globalThis !== "undefined" && globalThis.DV_WORDPAIRS) || [];
    return Array.isArray(w) ? w.map(pairOf).filter(Boolean) : [];
  }

  // ---------- Instellingen ----------
  function mergeSettings(cur, d, knownCats) {
    const s = clone(cur);
    if (!d || typeof d !== "object") return s;
    if (d.mode === "woord" || d.mode === "blind") s.mode = d.mode;
    if (d.infiltrants === 1 || d.infiltrants === 2) s.infiltrants = d.infiltrants;
    if ([1, 2, 3].includes(d.hintRounds)) s.hintRounds = d.hintRounds;
    if ([0, 30, 60].includes(d.timer)) s.timer = d.timer;
    if (Array.isArray(d.categories)) {
      const cats = [];
      for (const c of d.categories) {
        if (typeof c !== "string" || !c || c.length > 40 || cats.includes(c)) continue;
        if (knownCats && knownCats.length && !knownCats.includes(c)) continue;
        cats.push(c);
      }
      if (cats.length <= 64) s.categories = cats;
    }
    return s;
  }

  // ---------- State ----------
  function createState({ code, host, settings, now } = {}) {
    host = host || {};
    const pid = String(host.pid || "host");
    const p = profile(host);
    return {
      v: 1, code: String(code || ""), hostPid: pid, phase: "lobby", gameNo: 0, round: 0, updatedAt: typeof now === "number" ? now : 0,
      settings: mergeSettings(clone(DEFAULT_SETTINGS), settings),
      players: [{ pid, name: p.name, avatar: p.avatar, color: p.color, alive: true, spectator: false, left: false }],
      scores: { [pid]: 0 }, acks: { [pid]: 0 }, removed: [],
      order: [], turn: null, hints: [], ready: [], voted: [], candidates: null, revote: false,
      lastVote: null, guess: null, result: null, infiltrantCount: 1,
      // geheim
      keys: { [pid]: String(host.key || "") }, roles: {}, words: null, votes: {}, usedPairs: [],
      pendingWinner: null, starter: null, gameDelta: {},
    };
  }

  const player = (s, pid) => s.players.find((p) => p.pid === pid);
  const isAlive = (s, pid) => { const p = player(s, pid); return !!(p && p.alive && !p.left); };
  const activeCount = (s) => s.players.filter((p) => !p.left).length;

  function addPlayer(s, pid, d) {
    if (activeCount(s) >= MAX_PLAYERS) return false;
    const p = profile(d);
    const lobby = s.phase === "lobby";
    s.players.push({ pid, name: p.name, avatar: p.avatar, color: p.color, alive: lobby, spectator: !lobby, left: false });
    if (!hasOwn(s.scores, pid)) s.scores[pid] = 0;
    return true;
  }

  // ---------- Winnen ----------
  function winCheck(s) {
    let inf = 0, burg = 0;
    for (const p of s.players) {
      if (!p.alive || p.left || !hasOwn(s.roles, p.pid)) continue;
      if (s.roles[p.pid] === "infiltrant") inf++; else burg++;
    }
    if (inf === 0) return "burgers";
    if (inf >= burg) return "infiltranten";
    return null;
  }
  function addPoints(s, pid, n) {
    s.scores[pid] = (s.scores[pid] || 0) + n;
    s.gameDelta[pid] = (s.gameDelta[pid] || 0) + n;
  }
  function finish(s, winner) {
    const guesser = s.guess && s.guess.correct ? s.guess.pid : null;
    for (const pid of Object.keys(s.roles)) {
      const p = player(s, pid);
      if (!p || p.left) continue;
      const role = s.roles[pid];
      if (winner === "burgers" && role === "burger") addPoints(s, pid, 2);
      if (winner === "infiltranten" && role === "infiltrant") addPoints(s, pid, pid === guesser ? 5 : 4);
    }
    s.phase = "over";
    s.turn = null; s.candidates = null; s.revote = false; s.voted = []; s.votes = {}; s.pendingWinner = null;
    s.result = {
      winner, roles: clone(s.roles),
      words: { burger: s.words.burger, infiltrant: s.settings.mode === "blind" ? null : s.words.infiltrant },
      category: s.words.category, delta: clone(s.gameDelta),
    };
  }

  // ---------- Beurten ----------
  function rotation(s) {
    const i = Math.max(0, s.order.indexOf(s.starter));
    return s.order.slice(i).concat(s.order.slice(0, i));
  }
  function startHints(s, now) {
    s.phase = "hints";
    const first = rotation(s).find((pid) => isAlive(s, pid));
    s.turn = { pid: first, hintRound: 1, startedAt: now };
  }
  function advanceTurn(s, now) {
    const rot = rotation(s);
    const idx = rot.indexOf(s.turn.pid);
    const next = rot.slice(idx + 1).find((pid) => isAlive(s, pid));
    if (next) { s.turn = { pid: next, hintRound: s.turn.hintRound, startedAt: now }; return; }
    if (s.turn.hintRound < s.settings.hintRounds) {
      s.turn = { pid: rot.find((pid) => isAlive(s, pid)), hintRound: s.turn.hintRound + 1, startedAt: now };
      return;
    }
    startVote(s);
  }
  function startVote(s) {
    s.phase = "vote"; s.turn = null; s.votes = {}; s.voted = []; s.candidates = null; s.revote = false;
  }

  // ---------- Stemmen ----------
  const validTarget = (s, voter, target) =>
    target !== voter && isAlive(s, target) && (!s.candidates || s.candidates.includes(target));
  function voteComplete(s) {
    const alive = s.players.filter((p) => p.alive && !p.left).map((p) => p.pid);
    const eligible = alive.filter((v) => alive.some((t) => validTarget(s, v, t)));
    return eligible.every((v) => s.voted.includes(v));
  }
  function resolveVote(s) {
    const tally = {};
    for (const v of Object.keys(s.votes)) tally[s.votes[v]] = (tally[s.votes[v]] || 0) + 1;
    const max = Math.max(0, ...Object.values(tally));
    const top = s.order.filter((pid) => max > 0 && tally[pid] === max);
    if (top.length > 1 && !s.revote) {
      // Gelijkspel → nog één keer stemmen tussen de koplopers
      s.phase = "vote"; s.candidates = top; s.revote = true; s.votes = {}; s.voted = [];
      return;
    }
    for (const v of Object.keys(s.votes)) if (s.roles[s.votes[v]] === "infiltrant") addPoints(s, v, 1);
    const eliminated = top.length === 1 ? top[0] : null;
    s.lastVote = {
      tally, votes: clone(s.votes), eliminated, role: eliminated ? s.roles[eliminated] || null : null,
      tie: !eliminated, revote: s.revote, round: s.round,
    };
    if (eliminated) player(s, eliminated).alive = false;
    s.votes = {}; s.voted = []; s.candidates = null; s.revote = false; s.turn = null;
    s.pendingWinner = winCheck(s);
    if (eliminated && s.lastVote.role === "infiltrant" && s.settings.mode === "blind") {
      s.phase = "guess";
      s.guess = { pid: eliminated, text: null, correct: null };
    } else {
      s.phase = "elim";
    }
  }

  // ---------- Vertrekken ----------
  function dropOut(s, pid, now) {
    const p = player(s, pid);
    if (s.phase === "lobby") {
      s.players = s.players.filter((x) => x.pid !== pid);
      delete s.scores[pid];
      return;
    }
    const wasAlive = p.alive && !p.left;
    p.left = true; p.alive = false;
    s.ready = s.ready.filter((x) => x !== pid);
    if (s.phase === "guess" && s.guess && s.guess.pid === pid && s.guess.correct === null) {
      s.guess.correct = false; s.phase = "elim";
    }
    if (!wasAlive || s.phase === "over") return;
    const winner = winCheck(s);
    if (s.phase === "guess" || s.phase === "elim") {
      if (!(s.guess && s.guess.correct)) s.pendingWinner = winner;
      return;
    }
    if (s.phase === "vote") {
      delete s.votes[pid];
      for (const v of Object.keys(s.votes)) if (s.votes[v] === pid) delete s.votes[v]; // die mogen opnieuw
      s.voted = s.voted.filter((v) => hasOwn(s.votes, v));
      if (s.candidates) s.candidates = s.candidates.filter((c) => c !== pid);
    }
    if (winner) return finish(s, winner);
    if (s.phase === "reveal" && allReady(s)) startHints(s, now);
    else if (s.phase === "hints" && s.turn && s.turn.pid === pid) advanceTurn(s, now);
    else if (s.phase === "vote" && voteComplete(s)) resolveVote(s);
  }
  const allReady = (s) => s.players.every((p) => !p.alive || p.left || s.ready.includes(p.pid));

  // ---------- Start ----------
  function shuffle(a, rng) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(rng() * (i + 1)));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function startGame(s, ctx) {
    const rng = ctx.rng;
    const players = s.players.filter((p) => !p.left);
    if (players.length < MIN_PLAYERS) return false;
    const all = wordList(ctx);
    if (!all.length) return false;
    const cats = s.settings.categories;
    let pool = cats.length ? all.filter((p) => cats.includes(p.cat)) : all;
    if (!pool.length) pool = all;
    let avail = pool.filter((p) => !s.usedPairs.includes(p.id));
    if (!avail.length) { s.usedPairs = []; avail = pool; }
    const pair = avail[Math.min(avail.length - 1, Math.floor(rng() * avail.length))];
    s.usedPairs.push(pair.id);
    const swap = rng() < 0.5;

    // Vertrokken spelers verdwijnen; toeschouwers spelen mee
    for (const p of s.players) if (p.left) delete s.scores[p.pid];
    s.players = players.map((p) => Object.assign(p, { alive: true, spectator: false, left: false }));
    const pids = players.map((p) => p.pid);
    const k = effectiveInfiltrants(s.settings.infiltrants, pids.length);
    const roles = {};
    shuffle(pids, rng).forEach((pid, i) => (roles[pid] = i < k ? "infiltrant" : "burger"));

    Object.assign(s, {
      phase: "reveal", gameNo: s.gameNo + 1, round: 1, order: shuffle(pids, rng), turn: null, hints: [], ready: [],
      voted: [], candidates: null, revote: false, lastVote: null, guess: null, result: null, infiltrantCount: k,
      roles, votes: {}, pendingWinner: null, starter: null, gameDelta: {},
      words: { burger: swap ? pair.b : pair.a, infiltrant: swap ? pair.a : pair.b, category: pair.cat, pairId: pair.id },
    });
    pids.forEach((pid) => (s.gameDelta[pid] = 0));
    s.starter = s.order[0];
    return true;
  }

  function toLobby(s) {
    for (const p of s.players) if (p.left) delete s.scores[p.pid];
    s.players = s.players.filter((p) => !p.left).map((p) => Object.assign(p, { alive: true, spectator: false }));
    Object.assign(s, {
      phase: "lobby", round: 0, order: [], turn: null, hints: [], ready: [], voted: [], candidates: null, revote: false,
      lastVote: null, guess: null, result: null, roles: {}, words: null, votes: {}, pendingWinner: null, starter: null, gameDelta: {},
    });
  }

  // ---------- Acties ----------
  // Elke handler: (s, pid, d, ctx) → true als er iets veranderd is, false = ongeldig (alleen ack).
  const isHost = (s, pid) => pid === s.hostPid;
  const ACTIONS = {
    join(s, pid, d) {
      const p = player(s, pid);
      if (!p) return addPlayer(s, pid, d);
      Object.assign(p, profile(d, p));
      if (p.left) {
        if (activeCount(s) >= MAX_PLAYERS) return false;
        p.left = false;
      }
      return true;
    },
    profile(s, pid, d) {
      const p = player(s, pid);
      if (!p) return false;
      Object.assign(p, profile(d, p));
      return true;
    },
    leave(s, pid, d, ctx) {
      const p = player(s, pid);
      if (isHost(s, pid) || !p || p.left) return false;
      dropOut(s, pid, ctx.now);
      return true;
    },
    kick(s, pid, d, ctx) {
      const target = d.target;
      if (!isHost(s, pid) || typeof target !== "string" || target === s.hostPid) return false;
      if (!hasOwn(s.keys, target) || s.removed.includes(target)) return false;
      s.removed.push(target);
      const p = player(s, target);
      if (p && !p.left) dropOut(s, target, ctx.now);
      return true;
    },
    settings(s, pid, d, ctx) {
      if (!isHost(s, pid) || s.phase !== "lobby") return false;
      const known = [...new Set(wordList(ctx).map((p) => p.cat).filter((c) => c != null))];
      const next = mergeSettings(s.settings, d, known);
      if (JSON.stringify(next) === JSON.stringify(s.settings)) return false;
      s.settings = next;
      return true;
    },
    start(s, pid, d, ctx) {
      if (!isHost(s, pid) || (s.phase !== "lobby" && s.phase !== "over")) return false;
      return startGame(s, ctx);
    },
    revealed(s, pid, d, ctx) {
      if (s.phase !== "reveal" || !isAlive(s, pid) || s.ready.includes(pid)) return false;
      s.ready.push(pid);
      if (allReady(s)) startHints(s, ctx.now);
      return true;
    },
    hint(s, pid, d, ctx) {
      if (s.phase !== "hints" || !s.turn || s.turn.pid !== pid) return false;
      s.hints.push({ pid, text: clean(d.text, 32), round: s.round, hintRound: s.turn.hintRound });
      advanceTurn(s, ctx.now);
      return true;
    },
    skip(s, pid, d, ctx) {
      if (!isHost(s, pid) || s.phase !== "hints" || !s.turn) return false;
      s.hints.push({ pid: s.turn.pid, text: "", round: s.round, hintRound: s.turn.hintRound, skipped: true });
      advanceTurn(s, ctx.now);
      return true;
    },
    forceVote(s, pid) {
      if (!isHost(s, pid) || s.phase !== "hints") return false;
      startVote(s);
      return true;
    },
    vote(s, pid, d) {
      if (s.phase !== "vote" || !isAlive(s, pid) || s.voted.includes(pid)) return false;
      if (typeof d.target !== "string" || !validTarget(s, pid, d.target)) return false;
      s.votes[pid] = d.target;
      s.voted.push(pid);
      if (voteComplete(s)) resolveVote(s);
      return true;
    },
    closeVote(s, pid) {
      if (!isHost(s, pid) || s.phase !== "vote" || !Object.keys(s.votes).length) return false;
      resolveVote(s);
      return true;
    },
    guess(s, pid, d) {
      if (s.phase !== "guess" || !s.guess || s.guess.pid !== pid || s.guess.correct !== null) return false;
      const text = clean(d.text, 32);
      const g = normalize(text), w = normalize(s.words.burger);
      const correct = g.length > 0 && (g === w || (chars(w).length >= 5 && levenshtein(g, w) <= 1));
      s.guess = { pid, text, correct };
      if (correct) s.pendingWinner = "infiltranten";
      s.phase = "elim";
      return true;
    },
    next(s, pid, d, ctx) {
      if (!isHost(s, pid)) return false;
      if (s.phase === "over") { toLobby(s); return true; }
      if (s.phase !== "elim") return false;
      if (s.pendingWinner) { finish(s, s.pendingWinner); return true; }
      // Nieuwe ronde: begint bij de volgende levende speler na de vorige starter
      const rot = rotation(s);
      s.starter = rot.slice(1).find((x) => isAlive(s, x)) || rot.find((x) => isAlive(s, x));
      s.round += 1;
      s.guess = null;
      startHints(s, ctx.now);
      return true;
    },
  };

  function reduce(state, env, ctx) {
    if (!state || !env || typeof env !== "object" || state.phase === "closed") return state;
    const { pid, key, seq, t } = env;
    if (typeof pid !== "string" || !pid || pid.length > 64) return state;
    if (!Number.isInteger(seq) || seq < 0) return state;
    if (state.removed.includes(pid)) return state;
    ctx = Object.assign({}, ctx);
    if (typeof ctx.rng !== "function") ctx.rng = () => 0.5;
    if (typeof ctx.now !== "number") ctx.now = state.updatedAt;
    const d = env.d && typeof env.d === "object" ? env.d : {};
    let base;
    if (!hasOwn(state.keys, pid)) {
      if (t !== "join" || typeof key !== "string" || !key || key.length > 64) return state;
      base = Object.assign({}, state, { keys: Object.assign({}, state.keys, { [pid]: key }), acks: Object.assign({}, state.acks, { [pid]: seq }) });
    } else {
      if (key !== state.keys[pid] || seq !== state.acks[pid] + 1) return state;
      base = Object.assign({}, state, { acks: Object.assign({}, state.acks, { [pid]: seq }) });
    }
    if (!hasOwn(ACTIONS, t)) return base;
    const s = clone(base);
    if (!ACTIONS[t](s, pid, d, ctx)) return base;
    s.updatedAt = ctx.now;
    return s;
  }

  // ---------- Views ----------
  function publicView(state) {
    const s = state;
    const pub = {
      v: 1, code: s.code, hostPid: s.hostPid, phase: s.phase, gameNo: s.gameNo, round: s.round, updatedAt: s.updatedAt,
      settings: s.settings,
      players: s.players.map((p) => ({ pid: p.pid, name: p.name, avatar: p.avatar, color: p.color, alive: p.alive, spectator: p.spectator, left: p.left })),
      scores: s.scores, acks: s.acks, removed: s.removed, order: s.order, turn: s.turn, hints: s.hints, ready: s.ready,
      voted: s.voted, candidates: s.candidates, revote: s.revote, lastVote: s.lastVote, guess: s.guess,
      result: s.phase === "over" ? s.result : null,
      infiltrantCount: s.phase === "lobby"
        ? effectiveInfiltrants(s.settings.infiltrants, s.players.filter((p) => !p.left).length)
        : s.infiltrantCount,
    };
    return clone(pub);
  }

  function privateView(state, pid) {
    const s = state;
    if (s.phase === "lobby" || s.phase === "closed" || !s.words || s.removed.includes(pid)) return null;
    const p = player(s, pid);
    if (!p || p.left || p.spectator || !hasOwn(s.roles, pid)) return null;
    const inf = s.roles[pid] === "infiltrant";
    const category = s.words.category;
    if (s.settings.mode === "blind") {
      return inf
        ? { v: 1, gameNo: s.gameNo, word: null, category, role: "infiltrant", knowsRole: true }
        : { v: 1, gameNo: s.gameNo, word: s.words.burger, category, role: "burger", knowsRole: true };
    }
    return { v: 1, gameNo: s.gameNo, word: inf ? s.words.infiltrant : s.words.burger, category, role: null, knowsRole: false };
  }

  return {
    createState, reduce, publicView, privateView, normalize, levenshtein, effectiveInfiltrants,
    DEFAULT_SETTINGS, MIN_PLAYERS, MAX_PLAYERS,
  };
});
