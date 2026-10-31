/*
 * DVArcade — pure engine voor de arcade: losse minigames spelen (SPEC-3 §4). UMD: `window.DVArcade` + CommonJS `module.exports`.
 * Zelfde contract als DVInfiltrant/DVStory; kamerlogica en minigame-orkestratie komen uit DVRoom (online/room.js).
 * Puur: geen DOM, netwerk, Date.now of Math.random; de invoer-state wordt nooit gemuteerd.
 *
 * API
 *   DVArcade.createState({ code, host, settings?, carry?, now? }) → state
 *   DVArcade.reduce(state, env, ctx) → newState      ctx = { rng, now, minis: DVMini } (minis valt terug op window.DVMini)
 *   DVArcade.publicView(state) → publieke state (zonder keys, resultaten of gedeelde minigame-toestand)
 *   DVArcade.privateView(state, pid, ctx?) → { v:1, game:"arcade", nonce, miniId, miniView } tijdens een net-minigame, anders null
 *   DVArcade.DEFAULT_SETTINGS { difficulty: 2 }, MIN_PLAYERS (1), MAX_PLAYERS (6), verdict(logs)
 *
 * Fases: lobby → pick → mini → miniResult → pick … (host `end` → lobby).
 *   start {} (host, lobby, 1–6 actieve spelers) → pick · pick { id, difficulty? } (host; lobby/pick/miniResult): toeschouwers
 *   doen mee, vertrokken spelers verdwijnen, minigame start voor alle actieve spelers (echo: onbeperkt aantal rondes, met
 *   "Opgeven") · settings { difficulty: 1|2|3 } (host; lobby/pick) · mini {k:"result"|"act", nonce, …} · skipMini (host, mini) ·
 *   next (host, miniResult → pick) · end (host, elke fase → lobby) · join/profile/leave/kick zoals DVInfiltrant.
 * Score: per gespeelde minigame krijgt elke deelnemer max(0, logs) punten en de mvp 1 extra; dat gaat in `scores` (het
 * scorebord van de kamer, dat ook Infiltrant gebruikt). Records per minigame in stats.arcade.records[id] = { best, plays, last }.
 * Het vuur (0..10) is hier puur sfeer: het groeit of zakt met logs en reist via carry mee naar andere engines.
 * miniResult = { id, kind, nonce, difficulty, logs, lines, mvp, perPlayer, pids, skipped, verdict, fireBefore, fireAfter,
 *   points: { pid: n }, record: bool, best }.
 */
(function (root, factory) {
  const R = typeof DVRoom !== "undefined" ? DVRoom : require("./room.js");
  const api = factory(R);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DVArcade = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function (R) {
  "use strict";

  const MIN_PLAYERS = 1;
  const MAX_PLAYERS = 6;
  const MAX_FIRE = 10;
  const DEFAULT_SETTINGS = Object.freeze({ difficulty: 2 });
  const PICK_PHASES = ["lobby", "pick", "miniResult"];
  const hasOwn = R.hasOwn, clone = R.clone;
  let lastMinis = null;

  const registry = (ctx) => (ctx && ctx.minis) || lastMinis || (typeof globalThis !== "undefined" && globalThis.DVMini) || null;

  function mergeSettings(cur, d) {
    const s = clone(cur);
    if (d && typeof d === "object" && [1, 2, 3].includes(d.difficulty)) s.difficulty = d.difficulty;
    return s;
  }
  function createState({ code, host, settings, carry, now } = {}) {
    const base = R.createBase({ code, host, now, carry });
    return Object.assign(base, {
      game: "arcade", settings: mergeSettings(DEFAULT_SETTINGS, settings),
      fire: base.fire === null ? 4 : Math.max(0, Math.min(MAX_FIRE, base.fire)), maxFire: MAX_FIRE,
      mini: null, miniNonce: 0, miniResult: null, lastMini: null,
      // geheim
      miniResults: {}, miniShared: null,
    });
  }
  function stats(s) {
    if (!s.stats || typeof s.stats !== "object") s.stats = {};
    const st = s.stats.arcade && typeof s.stats.arcade === "object" ? s.stats.arcade : (s.stats.arcade = {});
    if (!st.records || typeof st.records !== "object") st.records = {};
    if (!Number.isInteger(st.plays)) st.plays = 0;
    return st;
  }
  const setFire = (s, n) => { s.fire = Math.max(0, Math.min(MAX_FIRE, Math.round(Number(n)) || 0)); };

  // Toeschouwers doen mee, vertrokken spelers verdwijnen (zoals DVInfiltrant bij start).
  function refreshPlayers(s) {
    for (const p of s.players) if (p.left) delete s.scores[p.pid];
    s.players = s.players.filter((p) => !p.left).map((p) => Object.assign(p, { alive: true, spectator: false, left: false }));
  }
  function toLobby(s) {
    refreshPlayers(s);
    Object.assign(s, { phase: "lobby", mini: null, miniResults: {}, miniShared: null, miniResult: null });
  }

  function pickMini(s, ctx, id, difficulty) {
    const M = registry(ctx);
    const def = M && typeof M.get === "function" && typeof id === "string" ? M.get(id) : null;
    if (!def) return false;
    refreshPlayers(s);
    if (s.players.length < MIN_PLAYERS || s.players.length > MAX_PLAYERS) return false;
    if ([1, 2, 3].includes(difficulty)) s.settings.difficulty = difficulty;
    const init = id === "echo" ? { rounds: 0 } : undefined; // arcade: onbeperkt, met "Opgeven"
    if (!R.mini.begin(s, ctx, { id, difficulty: s.settings.difficulty, init })) return false;
    s.miniResult = null;
    s.lastMini = id;
    s.phase = "mini";
    return true;
  }
  function finishMini(s, ctx, skipped) {
    const r = R.mini.finish(s, ctx, { skipped });
    if (!r) return false;
    const before = s.fire;
    setFire(s, s.fire + r.logs);
    const points = {};
    for (const pid of r.pids) {
      points[pid] = Math.max(0, r.logs) + (pid === r.mvp ? 1 : 0);
      s.scores[pid] = (s.scores[pid] || 0) + points[pid];
    }
    const st = stats(s);
    const rec = st.records[r.id] && typeof st.records[r.id] === "object" ? st.records[r.id] : { best: null, plays: 0, last: null };
    const record = rec.best === null || r.logs > rec.best;
    rec.plays += 1;
    rec.last = r.logs;
    if (record) rec.best = r.logs;
    st.records[r.id] = rec;
    st.plays += 1;
    s.miniResult = Object.assign(r, { fireBefore: before, fireAfter: s.fire, points, record, best: rec.best });
    s.phase = "miniResult";
    return true;
  }

  function onDrop(s, pid, ctx, wasActive) {
    if (!wasActive || s.phase !== "mini" || !R.activePids(s).length) return;
    R.mini.drop(s, pid, ctx);
    if (R.mini.done(s, ctx)) finishMini(s, ctx, false);
  }
  const onReturn = (s, p) => { p.alive = !p.spectator; };

  // ---------- Acties ----------
  const isHost = (s, pid) => pid === s.hostPid;
  const ACTIONS = Object.assign(R.actions({ onDrop, onReturn }), {
    settings(s, pid, d) {
      if (!isHost(s, pid) || !["lobby", "pick"].includes(s.phase)) return false;
      const next = mergeSettings(s.settings, d);
      if (JSON.stringify(next) === JSON.stringify(s.settings)) return false;
      s.settings = next;
      return true;
    },
    start(s, pid) {
      if (!isHost(s, pid) || s.phase !== "lobby") return false;
      refreshPlayers(s);
      if (s.players.length < MIN_PLAYERS || s.players.length > MAX_PLAYERS) return false;
      s.phase = "pick";
      return true;
    },
    pick(s, pid, d, ctx) {
      if (!isHost(s, pid) || !PICK_PHASES.includes(s.phase)) return false;
      return pickMini(s, ctx, d.id, d.difficulty);
    },
    mini(s, pid, d, ctx) {
      if (s.phase !== "mini" || !s.mini) return false;
      const ok = d.k === "result" ? R.mini.submit(s, pid, d, ctx) : d.k === "act" ? R.mini.act(s, pid, d, ctx) : false;
      if (!ok) return false;
      if (R.mini.done(s, ctx)) finishMini(s, ctx, false);
      return true;
    },
    skipMini(s, pid, d, ctx) {
      if (!isHost(s, pid) || s.phase !== "mini" || !s.mini) return false;
      return finishMini(s, ctx, true);
    },
    next(s, pid) {
      if (!isHost(s, pid) || s.phase !== "miniResult") return false;
      refreshPlayers(s);
      s.phase = "pick";
      return true;
    },
    end(s, pid) {
      if (!isHost(s, pid) || s.phase === "lobby") return false;
      toLobby(s);
      return true;
    },
  });

  function reduce(state, env, ctx) {
    if (ctx && ctx.minis) lastMinis = ctx.minis;
    return R.reduce(state, env, ctx, ACTIONS);
  }

  // ---------- Views ----------
  function publicView(state) {
    const s = state;
    const pub = Object.assign(R.publicBase(s), {
      game: "arcade", settings: s.settings, fire: s.fire, maxFire: s.maxFire, mini: R.mini.publicOf(s), miniResult: s.miniResult,
      lastMini: s.lastMini, stats: s.stats, active: R.activePids(s),
    });
    return clone(pub);
  }
  function privateView(state, pid, ctx) {
    const s = state;
    if (s.phase !== "mini" || !s.mini || s.mini.kind !== "net" || s.removed.includes(pid)) return null;
    const p = R.player(s, pid);
    if (!p || p.left || p.spectator || !s.mini.pids.includes(pid)) return null;
    const view = R.mini.view(s, pid, { minis: registry(ctx) });
    return clone({ v: 1, game: "arcade", nonce: s.mini.nonce, miniId: s.mini.id, miniView: view });
  }

  return { createState, reduce, publicView, privateView, verdict: R.mini.verdict, DEFAULT_SETTINGS, MIN_PLAYERS, MAX_PLAYERS };
});
