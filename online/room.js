/*
 * DVRoom — gedeelde kamerlogica voor de online engines (DVStory, DVArcade). Spiegelt DVInfiltrant (online/engine.js).
 * UMD: browser global `window.DVRoom` + CommonJS `module.exports`.
 * Puur: geen DOM, netwerk, Date.now of Math.random. Tijd en toeval komen binnen via `ctx`; de invoer-state wordt nooit gemuteerd.
 *
 * Waarom: alle engines moeten dezelfde envelop/seq/ack/key/removed-semantiek en dezelfde join/leave/kick/profile-afhandeling
 * hebben als DVInfiltrant, zodat de client-outbox en retransmit in ui.js ongewijzigd blijven werken en de lobby van spel kan
 * wisselen met `carry`. engine.js is NIET aangepast: DVRoom spiegelt zijn gedrag (test/room.test.js bewijst de pariteit).
 *
 * API
 *   DVRoom.MAX_PLAYERS (12), hasOwn, clone, clean(str, max), isColor, profile(d, prev), normalize(str), shuffle(arr, rng)
 *   DVRoom.createBase({ code, host: { pid, key, name, avatar, color }, now?, carry? })
 *       → { v:1, code, hostPid, phase:"lobby", updatedAt, players, scores, acks, removed, keys, fire, stats }
 *       Zonder carry: host auto-joined, acks[host] = 0. Met carry (zie carryFrom) blijven spelers, keys, acks, scores,
 *       removed, hostPid, stats en fire behouden, zodat seq/acks naadloos doorlopen bij een spelwissel in de lobby.
 *   DVRoom.carryFrom(state) → { players, keys, acks, scores, removed, hostPid, stats, fire }
 *       Werkt voor elke engine-state, ook DVInfiltrant (leest players/keys/acks/scores/removed/hostPid; stats/fire als ze er zijn).
 *       Vertrokken spelers (left) vallen weg; keys/acks van álle bekende pids blijven (acks mogen nooit terugvallen).
 *   DVRoom.validate(state, env) → null (negeren → zelfde referentie) | { base, pid, t, d }
 *       base = state met bijgewerkte acks (en keys voor een nieuwe pid); d = env.d als object, anders {}.
 *   DVRoom.reduce(state, env, ctx, actions) → newState
 *       actions = { [t]: (s, pid, d, ctx) → bool } op een diepe kopie `s`; false = alleen ack (zoals DVInfiltrant).
 *       Onbekende t → alleen ack. Geldig → s.updatedAt = ctx.now. ctx.rng/now krijgen dezelfde fallbacks als in DVInfiltrant.
 *   DVRoom.actions(hooks) → { join, profile, leave, kick }
 *       hooks: onJoin(s, player), onDrop(s, pid, ctx, wasActive) (leave/kick tijdens een spel), onReturn(s, player, ctx)
 *       (join van een speler met left:true tijdens een spel).
 *   DVRoom.publicBase(state) → { v, code, hostPid, phase, updatedAt, players (zonder geheimen), scores, acks, removed }
 *   DVRoom.player(s, pid), activeCount(s) (= !left, zoals DVInfiltrant), activePids(s) (= !left && !spectator), isActive(s, pid)
 *   DVRoom.mini — minigames uit de DVMini-registry orkestreren in een engine-state (zie onder).
 *
 * Envelop (identiek aan DVInfiltrant.reduce): env = { pid, key, seq, t, d }
 *   - phase "closed", ongeldige pid (geen string, leeg, > 64) of seq (geen geheel getal ≥ 0), removed pid → zelfde referentie
 *   - onbekende pid: alleen t:"join" met key (string, 1–64) → keys[pid] = key, acks[pid] = seq
 *   - bekende pid: key moet kloppen én seq === acks[pid] + 1; duplicaat/gat/verkeerde key → zelfde referentie
 *   - acks lopen op ook als de actie zelf ongeldig is (anders blijft de client eindeloos hersturen)
 *
 * Spelers (identiek aan DVInfiltrant): max 12 spelers met !left (toeschouwers tellen mee); join tijdens een spel = spectator
 * (doet mee vanaf het volgende potje); join van een bekende pid = profiel bijwerken en left wissen; leave/kick in de lobby
 * verwijdert speler én score; in een spel wordt het left:true/alive:false en krijgt de engine de hook onDrop. Host kan niet
 * weg. Profiel: naam max 16 tekens (fallback "Speler"), avatar max 16 (fallback 🙂), kleur #rgb/#rrggbb (fallback #8b5cff).
 * Bewuste afwijking: een teruggekeerde speler (join na left, tijdens een spel) krijgt de hook onReturn; DVStory/DVArcade maken
 * hem daarmee weer actief, waar DVInfiltrant hem voor dat potje uitgeschakeld laat (in een verhaal bestaat "dood" niet).
 *
 * DVRoom.mini — velden in de engine-state:
 *   mini: { id, kind, nonce, seed, difficulty, roles, pids, submitted: [pid], startedAt } | null   (publiek, zonder resultaten)
 *   miniResults: { [pid]: result|null }  (geheim, lokale minis)   miniShared: object|null (geheim, net-minis)   miniNonce: n
 *   begin(s, ctx, { id, difficulty, pids, init? }) → bool   nonce++, seed uit ctx.rng, net: def.roles + def.init
 *   submit(s, pid, d, ctx) → bool   d = { k:"result", nonce, r }  (lokaal; één keer per speler; r wordt JSON-gekopieerd)
 *   act(s, pid, d, ctx) → bool      d = { k:"act", nonce, a }     (net; def.reduce, zelfde referentie = ongeldig)
 *   drop(s, pid, ctx)               speler is vertrokken: bij net-minis speelt def.bot voor hem verder
 *   done(s, ctx) → bool             lokaal: alle actieve spelers uit mini.pids hebben ingeleverd; net: def.result ≠ null
 *   finish(s, ctx, { skipped }) → { id, kind, nonce, difficulty, logs, lines, mvp, perPlayer, pids, skipped, verdict }
 *                                   score van def.score (ontbrekende resultaten = null), logs geklemd op [-2, 4]; wist mini*.
 *   view(s, pid, ctx) → def.view(miniShared, pid) | null       verdict(logs) → "win" (≥2) | "meh" (0–1) | "lose" (<0)
 *   Spelers die vertrekken tellen niet meer mee in de eisen; wie na "skip" niets inleverde krijgt null (de minigame-score
 *   zegt dan bv. "blies niet mee"). Een vertrokken speler in een net-minigame wordt door def.bot afgemaakt (max. 24 zetten
 *   per beurt), zodat echo/slot/verhaal niet eindeloos op hem wachten; de host kan altijd nog skipMini doen.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DVRoom = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_PLAYERS = 12;
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const chars = (s) => Array.from(s);

  // ---------- Tekst & profiel (identiek aan DVInfiltrant) ----------
  function normalize(str) {
    return String(str == null ? "" : str).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/[^\p{L}\p{N}]/gu, "");
  }
  function clean(str, max) {
    if (typeof str !== "string") return "";
    return chars(str.replace(/\s+/g, " ").trim()).slice(0, max).join("").trim();
  }
  const isColor = (c) => typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
  function profile(d, prev) {
    prev = prev || {};
    const name = clean(d && d.name, 16) || prev.name || "Speler";
    const avatar = clean(d && d.avatar, 16) || prev.avatar || "🙂";
    const color = isColor(d && d.color) ? d.color : prev.color || "#8b5cff";
    return { name, avatar, color };
  }
  function shuffle(a, rng) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(rng() * (i + 1)));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Spelers ----------
  const player = (s, pid) => s.players.find((p) => p.pid === pid);
  const activeCount = (s) => s.players.filter((p) => !p.left).length;
  const activePids = (s) => s.players.filter((p) => !p.left && !p.spectator).map((p) => p.pid);
  const isActive = (s, pid) => { const p = player(s, pid); return !!(p && !p.left && !p.spectator); };
  const lobbyPlayer = (p) => ({ pid: String(p.pid), name: p.name, avatar: p.avatar, color: p.color, alive: true, spectator: false, left: false });
  const validPlayer = (p) => p && typeof p === "object" && typeof p.pid === "string" && p.pid && !p.left;

  function strMap(o) {
    const out = {};
    if (o && typeof o === "object") for (const k of Object.keys(o)) if (typeof o[k] === "string") out[k] = o[k];
    return out;
  }
  function intMap(o) {
    const out = {};
    if (o && typeof o === "object") for (const k of Object.keys(o)) if (Number.isInteger(o[k])) out[k] = o[k];
    return out;
  }

  // ---------- Kamer ----------
  function createBase({ code, host, now, carry } = {}) {
    host = host || {};
    const c = carry && typeof carry === "object" ? carry : null;
    const hostPid = String((c && c.hostPid) || host.pid || "host");
    const base = {
      v: 1, code: String(code || ""), hostPid, phase: "lobby", updatedAt: typeof now === "number" ? now : 0,
      players: [], scores: {}, acks: {}, removed: [], keys: {}, fire: null, stats: {},
    };
    if (c) {
      base.players = (Array.isArray(c.players) ? c.players : []).filter(validPlayer).map((p) => lobbyPlayer(profileOf(p)));
      base.keys = strMap(c.keys);
      base.acks = intMap(c.acks);
      base.scores = intMap(c.scores);
      base.removed = Array.isArray(c.removed) ? c.removed.filter((x) => typeof x === "string") : [];
      base.stats = c.stats && typeof c.stats === "object" ? clone(c.stats) : {};
      base.fire = Number.isInteger(c.fire) ? c.fire : null;
    }
    if (!base.players.some((p) => p.pid === hostPid)) base.players.unshift(lobbyPlayer(Object.assign({ pid: hostPid }, profile(host))));
    if (!hasOwn(base.keys, hostPid)) base.keys[hostPid] = String(host.key || "");
    if (!hasOwn(base.acks, hostPid)) base.acks[hostPid] = 0;
    for (const p of base.players) if (!hasOwn(base.scores, p.pid)) base.scores[p.pid] = 0;
    return base;
  }
  const profileOf = (p) => Object.assign({ pid: p.pid }, profile(p));

  function carryFrom(state) {
    if (!state || typeof state !== "object") return null;
    const players = (Array.isArray(state.players) ? state.players : []).filter(validPlayer)
      .map((p) => ({ pid: p.pid, name: p.name, avatar: p.avatar, color: p.color }));
    const scores = {};
    for (const p of players) scores[p.pid] = Number.isInteger(state.scores && state.scores[p.pid]) ? state.scores[p.pid] : 0;
    return {
      players, keys: strMap(state.keys), acks: intMap(state.acks), scores,
      removed: Array.isArray(state.removed) ? state.removed.slice() : [],
      hostPid: typeof state.hostPid === "string" ? state.hostPid : null,
      stats: state.stats && typeof state.stats === "object" ? clone(state.stats) : {},
      fire: Number.isInteger(state.fire) ? state.fire : null,
    };
  }

  // ---------- Envelop ----------
  function validate(state, env) {
    if (!state || !env || typeof env !== "object" || state.phase === "closed") return null;
    const { pid, key, seq, t } = env;
    if (typeof pid !== "string" || !pid || pid.length > 64) return null;
    if (!Number.isInteger(seq) || seq < 0) return null;
    if (state.removed.includes(pid)) return null;
    const d = env.d && typeof env.d === "object" ? env.d : {};
    if (!hasOwn(state.keys, pid)) {
      if (t !== "join" || typeof key !== "string" || !key || key.length > 64) return null;
      const base = Object.assign({}, state, { keys: Object.assign({}, state.keys, { [pid]: key }), acks: Object.assign({}, state.acks, { [pid]: seq }) });
      return { base, pid, t, d };
    }
    if (key !== state.keys[pid] || seq !== state.acks[pid] + 1) return null;
    return { base: Object.assign({}, state, { acks: Object.assign({}, state.acks, { [pid]: seq }) }), pid, t, d };
  }
  function withDefaults(ctx, state) {
    ctx = Object.assign({}, ctx);
    if (typeof ctx.rng !== "function") ctx.rng = () => 0.5;
    if (typeof ctx.now !== "number") ctx.now = state.updatedAt;
    return ctx;
  }
  function reduce(state, env, ctx, actions) {
    const v = validate(state, env);
    if (!v) return state;
    ctx = withDefaults(ctx, state);
    if (!hasOwn(actions, v.t) || typeof actions[v.t] !== "function") return v.base;
    const s = clone(v.base);
    if (!actions[v.t](s, v.pid, v.d, ctx)) return v.base;
    s.updatedAt = ctx.now;
    return s;
  }

  // ---------- Gedeelde acties ----------
  function addPlayer(s, pid, d, hooks) {
    if (activeCount(s) >= MAX_PLAYERS) return false;
    const p = profile(d);
    const lobby = s.phase === "lobby";
    const np = { pid, name: p.name, avatar: p.avatar, color: p.color, alive: lobby, spectator: !lobby, left: false };
    s.players.push(np);
    if (!hasOwn(s.scores, pid)) s.scores[pid] = 0;
    if (hooks.onJoin) hooks.onJoin(s, np);
    return true;
  }
  function dropOut(s, pid, ctx, hooks) {
    const p = player(s, pid);
    if (s.phase === "lobby") {
      s.players = s.players.filter((x) => x.pid !== pid);
      delete s.scores[pid];
      return;
    }
    const wasActive = !p.left && !p.spectator;
    p.left = true; p.alive = false;
    if (hooks.onDrop) hooks.onDrop(s, pid, ctx, wasActive);
  }
  function actions(hooks) {
    hooks = hooks || {};
    return {
      join(s, pid, d, ctx) {
        const p = player(s, pid);
        if (!p) return addPlayer(s, pid, d, hooks);
        Object.assign(p, profile(d, p));
        if (p.left) {
          if (activeCount(s) >= MAX_PLAYERS) return false;
          p.left = false;
          if (hooks.onReturn) hooks.onReturn(s, p, ctx);
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
        if (pid === s.hostPid || !p || p.left) return false;
        dropOut(s, pid, ctx, hooks);
        return true;
      },
      kick(s, pid, d, ctx) {
        const target = d.target;
        if (pid !== s.hostPid || typeof target !== "string" || target === s.hostPid) return false;
        if (!hasOwn(s.keys, target) || s.removed.includes(target)) return false;
        s.removed.push(target);
        const p = player(s, target);
        if (p && !p.left) dropOut(s, target, ctx, hooks);
        return true;
      },
    };
  }

  function publicBase(s) {
    return {
      v: 1, code: s.code, hostPid: s.hostPid, phase: s.phase, updatedAt: s.updatedAt,
      players: s.players.map((p) => ({ pid: p.pid, name: p.name, avatar: p.avatar, color: p.color, alive: p.alive, spectator: p.spectator, left: p.left })),
      scores: s.scores, acks: s.acks, removed: s.removed,
    };
  }

  // ---------- Minigames ----------
  const registry = (ctx) => (ctx && ctx.minis) || (typeof globalThis !== "undefined" && globalThis.DVMini) || null;
  const defOf = (s, ctx) => { const R = registry(ctx); return R && s.mini && typeof R.get === "function" ? R.get(s.mini.id) : null; };
  const clampLogs = (n) => Math.max(-2, Math.min(4, Math.round(Number(n) || 0)));
  const clampDifficulty = (d) => Math.max(1, Math.min(3, Math.round(Number(d)) || 1));
  const verdict = (logs) => (logs >= 2 ? "win" : logs >= 0 ? "meh" : "lose");
  const miniPlayers = (s, pids) => pids.map((pid) => { const p = player(s, pid) || {}; return { pid, name: p.name, avatar: p.avatar, color: p.color }; });
  const requiredPids = (s) => (s.mini ? s.mini.pids.filter((pid) => isActive(s, pid)) : []);

  function miniBegin(s, ctx, { id, difficulty, pids, init } = {}) {
    const R = registry(ctx);
    const def = R && typeof R.get === "function" ? R.get(id) : null;
    if (!def || typeof def.score !== "function") return false;
    const list = (Array.isArray(pids) ? pids : activePids(s)).filter((pid) => isActive(s, pid));
    if (!list.length) return false;
    const d = clampDifficulty(difficulty);
    const seed = Math.floor(ctx.rng() * 4294967296) >>> 0;
    const players = miniPlayers(s, list);
    let roles = null, shared = null;
    if (def.kind === "net") {
      try {
        if (typeof def.roles === "function") roles = def.roles(players, ctx.rng) || null;
        const args = Object.assign({ seed, rng: typeof R.rng === "function" ? R.rng(seed) : ctx.rng, difficulty: d, players }, init || {});
        if (roles) args.roles = roles;
        shared = def.init(args);
      } catch (e) { return false; }
      if (!shared || typeof shared !== "object") return false;
    }
    s.miniNonce = (s.miniNonce || 0) + 1;
    s.mini = { id, kind: def.kind, nonce: s.miniNonce, seed, difficulty: d, roles, pids: list, submitted: [], startedAt: ctx.now };
    s.miniResults = {};
    s.miniShared = shared;
    return true;
  }
  function miniSubmit(s, pid, d, ctx) {
    const m = s.mini, def = defOf(s, ctx);
    if (!m || !def || def.kind !== "local") return false;
    if (d.nonce !== m.nonce || !m.pids.includes(pid) || !isActive(s, pid) || m.submitted.includes(pid)) return false;
    let r = d.r === undefined ? null : d.r;
    try { r = r === null ? null : clone(r); } catch (e) { return false; }
    s.miniResults[pid] = r;
    m.submitted.push(pid);
    return true;
  }
  function miniAct(s, pid, d, ctx) {
    const m = s.mini, def = defOf(s, ctx);
    if (!m || !def || def.kind !== "net" || !s.miniShared) return false;
    if (d.nonce !== m.nonce || !m.pids.includes(pid) || !isActive(s, pid)) return false;
    const a = d.a;
    if (!a || typeof a !== "object") return false;
    let next;
    try { next = def.reduce(s.miniShared, pid, a, { rng: ctx.rng, now: ctx.now }); } catch (e) { return false; }
    if (!next || typeof next !== "object" || next === s.miniShared) return false;
    s.miniShared = next;
    proxyBots(s, ctx);
    return true;
  }
  // Vertrokken spelers in een net-minigame: def.bot speelt hun zetten, anders wacht de minigame eindeloos op ze.
  function proxyBots(s, ctx) {
    const m = s.mini, def = defOf(s, ctx);
    if (!m || !def || def.kind !== "net" || typeof def.bot !== "function" || !s.miniShared) return;
    for (const pid of m.pids) {
      if (isActive(s, pid)) continue;
      for (let i = 0; i < 24; i++) {
        let a, next;
        try {
          if (def.result(s.miniShared) != null) return;
          a = def.bot(def.view(s.miniShared, pid), ctx.rng);
          if (!a || typeof a !== "object") break;
          next = def.reduce(s.miniShared, pid, a, { rng: ctx.rng, now: ctx.now });
        } catch (e) { break; }
        if (!next || typeof next !== "object" || next === s.miniShared) break;
        s.miniShared = next;
      }
    }
  }
  function miniDrop(s, pid, ctx) {
    if (!s.mini || !s.mini.pids.includes(pid)) return;
    proxyBots(s, ctx);
  }
  function miniDone(s, ctx) {
    const m = s.mini, def = defOf(s, ctx);
    if (!m || !def) return false;
    if (def.kind === "local") return requiredPids(s).every((pid) => m.submitted.includes(pid));
    try { return def.result(s.miniShared) != null; } catch (e) { return false; }
  }
  const strOf = (x) => (typeof x === "string" ? x : x == null ? "" : String(x));
  function miniFinish(s, ctx, opts) {
    const m = s.mini;
    if (!m) return null;
    const def = defOf(s, ctx);
    const pids = requiredPids(s);
    const players = miniPlayers(s, pids);
    let res = null;
    if (def && def.kind === "local") {
      res = {};
      for (const pid of pids) res[pid] = hasOwn(s.miniResults, pid) ? s.miniResults[pid] : null;
    } else if (def) {
      try { res = def.result(s.miniShared); } catch (e) { res = null; }
      if (res === undefined) res = null;
    }
    let sc = null;
    if (def) { try { sc = def.score(res, { difficulty: m.difficulty, players }); } catch (e) { sc = null; } }
    const logs = clampLogs(sc && sc.logs);
    const lines = sc && Array.isArray(sc.lines) ? sc.lines.filter((l) => typeof l === "string" && l) : [];
    if (!def) lines.push("Onbekende minigame: " + m.id);
    const mvp = sc && typeof sc.mvp === "string" && pids.includes(sc.mvp) ? sc.mvp : null;
    const perPlayer = {};
    for (const pid of pids) perPlayer[pid] = sc && sc.perPlayer && hasOwn(sc.perPlayer, pid) ? strOf(sc.perPlayer[pid]) : "";
    const out = {
      id: m.id, kind: m.kind, nonce: m.nonce, difficulty: m.difficulty, logs, lines, mvp, perPlayer, pids,
      skipped: !!(opts && opts.skipped), verdict: verdict(logs),
    };
    s.mini = null; s.miniResults = {}; s.miniShared = null;
    return out;
  }
  function miniView(s, pid, ctx) {
    const m = s.mini, def = defOf(s, ctx);
    if (!m || !def || def.kind !== "net" || !s.miniShared || typeof def.view !== "function") return null;
    try { const v = def.view(s.miniShared, pid); return v == null ? null : v; } catch (e) { return null; }
  }
  function miniPublic(s) {
    const m = s.mini;
    if (!m) return null;
    return { id: m.id, kind: m.kind, nonce: m.nonce, seed: m.seed, difficulty: m.difficulty, roles: m.roles, pids: m.pids, submitted: m.submitted, startedAt: m.startedAt };
  }

  return {
    MAX_PLAYERS, hasOwn, clone, clean, isColor, profile, normalize, shuffle,
    createBase, carryFrom, validate, reduce, actions, publicBase,
    player, activeCount, activePids, isActive,
    mini: {
      begin: miniBegin, submit: miniSubmit, act: miniAct, drop: miniDrop, done: miniDone, finish: miniFinish,
      view: miniView, publicOf: miniPublic, required: requiredPids, clampLogs, clampDifficulty, verdict,
    },
  };
});
