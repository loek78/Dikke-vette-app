/*
 * KerstNet — multiplayer layer of KERSTDROOM (SPEC-4 §4) on top of DVNet (online/net.js, MQTT over WebSocket).
 * UMD-light: browser global `window.KerstNet` + CommonJS `module.exports`. No DOM at load time; Node can require() it
 * (inject `mqtt` like DVNet does). The pure functions below are unit-tested in test/kerst-net.test.mjs.
 *
 * Topics (prefix `dva/v1/<CODE>/`, same room codes as the Infiltrant game):
 *   state        host → all, RETAINED QoS 1: the lobby/run/results state (shape: newLobby())
 *   host         player → host, QoS 1: envelopes { t: join|set|leave, pid, d, at }
 *   presence/<pid>  DVNet presence (retained "1"/"0" + Last Will)
 *   pos/<pid>    player → all, QoS 0, NOT retained, every 200 ms: encodePos() — the host's pos also carries `ds`
 *                (Droomster fraction 0..1) so every phone shows the same shared meter
 *   evt          anyone → all, QoS 1, NOT retained: { ev: snoepregen|finale|ping|…, by: pid, name, at }
 *   done/<pid>   player → host, RETAINED QoS 1: the run result (survives a reload; cleared by the host on "Nog een keer")
 *
 * Pure API
 *   KerstNet.topics(code)                      → { prefix, state, host, pos(pid), posAll, evt, done(pid), doneAll }
 *   KerstNet.newLobby({ code, hostPid, host:{name,animal,difficulty}, seed, now })  → state
 *   KerstNet.reduce(state, env, now)           → new state, or the SAME reference when the envelope changes nothing
 *   KerstNet.startRun(state, { now, seed })    → run state (phase "run", startAt = now + START_DELAY_MS, round + 1)
 *   KerstNet.finishRun(state, results, droomster, now) → results state with ranking/total
 *   KerstNet.againState(state, { seed, now })  → lobby again (ready flags reset, results cleared)
 *   KerstNet.canStart(state)                   → { ok, reason }
 *   KerstNet.playerList(state)                 → [{ pid, …player }] host first, then join order
 *   KerstNet.estimateOffset(samples)           samples = [hostAt − localAt] → host-time offset (max = lowest latency)
 *   KerstNet.OffsetEstimator(windowN)          → { sample(hostAt, localAt), offset, count, hostNow(localNow), toLocal(hostAt) }
 *   KerstNet.droomsterTarget(nPlayers)         → stars needed to fill the shared Droomster
 *   KerstNet.aggregateDroomster(posByPid, target) → { sum, target, frac, full }
 *   KerstNet.assignMedals(results, players?)   → ranking [{ pid, name, animal, stars, meters, …, rank, medal, title, emoji }]
 *   KerstNet.familyTotal(results)              → { players, stars, meters, candies, bells, gifts }
 *   KerstNet.encodePos(pos, extra?) / decodePos(obj|string)  compact pos messages
 *   KerstNet.shareUrl(code, brokerIndex, base, brokerOverride)  → kerst/?join=CODE&b=i(&broker=…)
 *
 * Session API (browser; Node with { mqtt })
 *   const s = await KerstNet.createSession({ role: "host"|"join", code?, pid?, profile, preferIndex?, mqtt?, brokers?,
 *                                            onStatus?, joinTimeoutMs? })
 *   s.code, s.pid, s.isHost, s.brokerIndex, s.brokerUrl, s.room (the DVNet room), s.state, s.players, s.me
 *   s.on(type, cb) → off     type ∈ state | pos(pid, pos) | evt(evt) | done(pid, result) | presence(pid, online) |
 *                            status(s) | droomster(frac) | left()
 *   s.send(t, d)             envelope to the host (the host applies it locally): join | set | leave
 *   s.publishPos(pos)        pos from game.hooks.onPos; the host adds `ds`
 *   s.publishEvt(evt)        { ev, … } to everyone (also emitted locally)
 *   s.publishDone(result)    retained result for the host
 *   s.hostNow(), s.toPerf(hostMs), s.offset   host-time helpers (offset is an OffsetEstimator)
 *   s.ghosts(nowMs)          [{ pid, name, animal, x, y, anim, stars, hearts, asleep }] — others with a pos this round
 *   host only: s.update(fn), s.startRun(seed?), s.again(), s.closeRoom(), s.droomster()
 *   s.close()
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KerstNet = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const G = root || {};

  const VERSION = 1;
  const FAMILY = ["Luke", "Viola", "Rivka", "Zara"];
  const ANIMALS = ["hert", "konijn", "vos", "uil"];
  const DIFFS = ["makkelijk", "normaal", "stoer"];
  const MAX_PLAYERS = 8;
  const DURATION_SEC = 90;
  const START_DELAY_MS = 4000;
  const ASLEEP_MS = 5000;        // no pos for 5 s → "ingedut 😴"
  const POS_INTERVAL_MS = 200;
  const PING_MS = 2000;
  const STARS_PER_PLAYER = 50;   // Droomster target per player (a 90 s run yields ~60–100 ⭐)
  const RESULTS_WAIT_MS = 12000; // host waits this long for late results after the first one
  const noop = () => {};

  function dvnet(lib) {
    if (lib) return lib;
    if (G.DVNet) return G.DVNet;
    if (typeof require === "function") { try { return require("../online/net.js"); } catch (e) { /* browser */ } }
    return null;
  }
  const cleanCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const isObj = (o) => !!o && typeof o === "object";

  // ---------- topics ----------
  function topics(code) {
    const prefix = "dva/v1/" + cleanCode(code) + "/";
    return {
      prefix, state: prefix + "state", host: prefix + "host",
      pos: (pid) => prefix + "pos/" + pid, posAll: prefix + "pos/+",
      evt: prefix + "evt",
      done: (pid) => prefix + "done/" + pid, doneAll: prefix + "done/+",
    };
  }

  // ---------- players & state ----------
  function cleanName(s) {
    return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 14);
  }
  function cleanProfile(p) {
    p = p || {};
    return {
      name: cleanName(p.name) || "Speler",
      animal: ANIMALS.indexOf(p.animal) >= 0 ? p.animal : "hert",
      difficulty: DIFFS.indexOf(p.difficulty) >= 0 ? p.difficulty : "normaal",
    };
  }
  function newLobby(o) {
    o = o || {};
    const now = typeof o.now === "number" ? o.now : Date.now();
    const host = Object.assign(cleanProfile(o.host), { ready: true, online: true, joinedAt: now });
    const players = {};
    players[o.hostPid] = host;
    return {
      v: VERSION, game: "kerstdroom", code: cleanCode(o.code), hostPid: o.hostPid, phase: "lobby", round: 0,
      seed: o.seed != null ? o.seed : 1, durationSec: DURATION_SEC, startAt: null, players,
      results: null, ranking: null, total: null, droomster: null, updatedAt: now,
    };
  }
  function copyPlayers(state) { const out = {}; for (const k in state.players) out[k] = Object.assign({}, state.players[k]); return out; }
  function playerList(state) {
    if (!state || !isObj(state.players)) return [];
    return Object.keys(state.players).map((pid) => Object.assign({ pid }, state.players[pid]))
      .sort((a, b) => (a.pid === state.hostPid ? -1 : b.pid === state.hostPid ? 1 : (a.joinedAt || 0) - (b.joinedAt || 0)));
  }
  // Envelope → new state (or the same reference when nothing changes). Pure; `now` stamps updatedAt.
  function reduce(state, env, now) {
    if (!isObj(state) || !isObj(env) || !env.pid || state.phase === "closed") return state;
    if (typeof now !== "number") now = Date.now();
    const pid = String(env.pid), d = isObj(env.d) ? env.d : {};
    const cur = state.players[pid];
    const players = copyPlayers(state);
    let changed = false;
    switch (env.t) {
      case "join": {
        if (!cur) {
          if (Object.keys(players).length >= MAX_PLAYERS) return state;
          players[pid] = Object.assign(cleanProfile(d), { ready: false, online: true, joinedAt: now });
          changed = true;
        } else {
          const p = players[pid];
          const next = cleanProfile(Object.assign({}, p, d));
          if (d.name != null && next.name !== p.name) { p.name = next.name; changed = true; }
          if (d.animal != null && next.animal !== p.animal) { p.animal = next.animal; changed = true; }
          if (d.difficulty != null && next.difficulty !== p.difficulty) { p.difficulty = next.difficulty; changed = true; }
          if (!p.online) { p.online = true; changed = true; }
        }
        break;
      }
      case "set": {
        if (!cur) return state;
        const p = players[pid];
        const next = cleanProfile(Object.assign({}, p, d));
        if (d.name != null && next.name !== p.name) { p.name = next.name; changed = true; }
        if (d.animal != null && next.animal !== p.animal) { p.animal = next.animal; changed = true; }
        if (d.difficulty != null && next.difficulty !== p.difficulty) { p.difficulty = next.difficulty; changed = true; }
        if (typeof d.ready === "boolean" && pid !== state.hostPid && state.phase === "lobby" && d.ready !== !!p.ready) { p.ready = d.ready; changed = true; }
        break;
      }
      case "leave": {
        if (!cur || pid === state.hostPid) return state;
        delete players[pid];
        changed = true;
        break;
      }
      case "presence": {
        if (!cur) return state;
        const on = !!d.online;
        if (!!players[pid].online !== on) { players[pid].online = on; changed = true; }
        break;
      }
      default: return state;
    }
    if (!changed) return state;
    return Object.assign({}, state, { players, updatedAt: now });
  }
  function canStart(state) {
    if (!state || state.phase !== "lobby") return { ok: false, reason: "Nog niet in de kamer" };
    const others = playerList(state).filter((p) => p.pid !== state.hostPid);
    if (!others.length) return { ok: true, solo: true, reason: "" };
    if (others.some((p) => p.ready && p.online !== false)) return { ok: true, solo: false, reason: "" };
    return { ok: false, reason: "Wacht tot iemand op 'Ik ben klaar!' tikt" };
  }
  function startRun(state, o) {
    o = o || {};
    const now = typeof o.now === "number" ? o.now : Date.now();
    return Object.assign({}, state, {
      phase: "run", round: (state.round | 0) + 1, seed: o.seed != null ? o.seed : state.seed, startAt: now + START_DELAY_MS,
      results: null, ranking: null, total: null, droomster: null, updatedAt: now,
    });
  }
  function finishRun(state, results, droomster, now) {
    if (typeof now !== "number") now = Date.now();
    const res = {};
    for (const pid in results || {}) if (isObj(results[pid])) res[pid] = results[pid];
    return Object.assign({}, state, {
      phase: "results", results: res, ranking: assignMedals(res, state.players), total: familyTotal(res),
      droomster: droomster ? { sum: droomster.sum | 0, target: droomster.target | 0, frac: +(+droomster.frac || 0).toFixed(3) } : null,
      endedAt: now, updatedAt: now,
    });
  }
  function againState(state, o) {
    o = o || {};
    const now = typeof o.now === "number" ? o.now : Date.now();
    const players = copyPlayers(state);
    for (const pid in players) players[pid].ready = pid === state.hostPid;
    return Object.assign({}, state, {
      phase: "lobby", seed: o.seed != null ? o.seed : state.seed, startAt: null, players, results: null, ranking: null, total: null, droomster: null, updatedAt: now,
    });
  }

  // ---------- host-time offset ----------
  // Each sample = hostTimestamp − localReceiveTime = trueOffset − latency, so the MAX of a window is the sample with the
  // lowest latency and the best estimate (±50 ms on wifi; stale retained messages only make samples smaller → ignored).
  function estimateOffset(samples) {
    let best = -Infinity;
    for (const s of samples || []) if (typeof s === "number" && isFinite(s) && s > best) best = s;
    return best === -Infinity ? 0 : best;
  }
  function OffsetEstimator(windowN) {
    const N = windowN > 0 ? windowN : 12;
    const samples = [];
    let offset = 0, count = 0;
    const est = {
      sample(hostAt, localAt) {
        if (typeof hostAt !== "number" || !isFinite(hostAt)) return offset;
        if (typeof localAt !== "number") localAt = Date.now();
        samples.push(hostAt - localAt);
        if (samples.length > N) samples.shift();
        offset = estimateOffset(samples);
        count++;
        return offset;
      },
      get offset() { return offset; },
      get count() { return count; },
      get samples() { return samples.slice(); },
      hostNow(localNow) { return (typeof localNow === "number" ? localNow : Date.now()) + offset; },
      toLocal(hostAt) { return hostAt - offset; },
    };
    return est;
  }

  // ---------- Droomster ----------
  function droomsterTarget(nPlayers) { return STARS_PER_PLAYER * Math.max(1, nPlayers | 0); }
  // posByPid: { pid: pos } or Map; pos.stars (or compact pos.s)
  function aggregateDroomster(posByPid, target) {
    let sum = 0;
    const each = (p) => { if (!isObj(p)) return; const v = p.stars != null ? p.stars : p.s; if (typeof v === "number" && isFinite(v)) sum += Math.max(0, v | 0); };
    if (posByPid && typeof posByPid.forEach === "function" && !Array.isArray(posByPid)) posByPid.forEach((v) => each(v && v.pos ? v.pos : v));
    else for (const k in posByPid || {}) each(posByPid[k] && posByPid[k].pos ? posByPid[k].pos : posByPid[k]);
    target = target > 0 ? target | 0 : droomsterTarget(1);
    const frac = Math.min(1, sum / target);
    return { sum, target, frac, full: sum >= target };
  }

  // ---------- results: medals & titles ----------
  // Ranking: most ⭐ wins, ties → meters, then name. Medals: dense ranks (equal stars → same medal).
  // Titles: everyone gets a unique one, assigned in this order to whoever leads that category (value > 0).
  const TITLES = [
    { key: "stars", title: "Sterrenverzamelaar", emoji: "⭐" },
    { key: "meters", title: "Droomrenner", emoji: "🏃" },
    { key: "candies", title: "Zuurstokkampioen", emoji: "🍬" },
    { key: "maxHeight", title: "Hoogste springer", emoji: "🦘" },
    { key: "bells", title: "Belletjesheld", emoji: "🔔" },
    { key: "gifts", title: "Cadeautjesjager", emoji: "🎁" },
    { key: "wishes", title: "Wensenvanger", emoji: "🌠" },
    { key: "maxCombo", title: "Combokampioen", emoji: "✨" },
    { key: "jumps", title: "Springkampioen", emoji: "🐇" },
    { key: "hearts", title: "Voorzichtige dromer", emoji: "💗" },
  ];
  const FALLBACK = [{ title: "Droomvriend", emoji: "☃️" }, { title: "Sneeuwvriend", emoji: "❄️" }, { title: "Dapper dromertje", emoji: "💪" }, { title: "Sterrenkijker", emoji: "🔭" }];
  const MEDALS = ["🥇", "🥈", "🥉"];
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  function assignMedals(results, players) {
    const list = [];
    if (Array.isArray(results)) results.forEach((r, i) => { if (isObj(r)) list.push(Object.assign({ pid: r.pid != null ? String(r.pid) : "p" + i }, r)); });
    else for (const pid in results || {}) if (isObj(results[pid])) list.push(Object.assign({ pid }, results[pid]));
    for (const r of list) {
      const p = players && players[r.pid];
      if (p) { if (!r.name) r.name = p.name; if (!r.animal) r.animal = p.animal; if (!r.difficulty) r.difficulty = p.difficulty; }
      r.name = cleanName(r.name) || "Speler"; r.stars = num(r.stars) | 0; r.meters = Math.round(num(r.meters));
    }
    list.sort((a, b) => b.stars - a.stars || b.meters - a.meters || a.name.localeCompare(b.name, "nl"));
    let rank = 0, prev = null;
    list.forEach((r, i) => {
      if (!prev || prev.stars !== r.stars) rank = i + 1;
      r.rank = rank; r.medal = MEDALS[rank - 1] || "🌟"; prev = r;
    });
    const taken = new Set();
    for (const t of TITLES) {
      if (taken.size >= list.length) break;
      let best = null, bestV = 0;
      for (const r of list) {
        if (taken.has(r.pid)) continue;
        const v = t.key === "hearts" ? (r.revived ? 0 : num(r.hearts)) : num(r[t.key]);
        if (v > bestV) { bestV = v; best = r; }
      }
      if (best) { best.title = t.title; best.emoji = t.emoji; taken.add(best.pid); }
    }
    let f = 0;
    for (const r of list) if (!taken.has(r.pid)) { const fb = FALLBACK[f++ % FALLBACK.length]; r.title = fb.title; r.emoji = fb.emoji; }
    return list;
  }
  function familyTotal(results) {
    const t = { players: 0, stars: 0, meters: 0, candies: 0, bells: 0, gifts: 0 };
    const each = (r) => { if (!isObj(r)) return; t.players++; t.stars += num(r.stars) | 0; t.meters += Math.round(num(r.meters)); t.candies += num(r.candies) | 0; t.bells += num(r.bells) | 0; t.gifts += num(r.gifts) | 0; };
    if (Array.isArray(results)) results.forEach(each); else for (const k in results || {}) each(results[k]);
    return t;
  }

  // ---------- pos codec (compact keys; ~70 bytes per message) ----------
  function encodePos(pos, extra) {
    pos = pos || {};
    const out = { x: Math.round(num(pos.x)), y: Math.round(num(pos.y)), a: pos.anim || "run", s: num(pos.stars) | 0, h: pos.hearts == null ? 3 : num(pos.hearts) | 0, m: Math.round(num(pos.meters)) };
    if (pos.pw) out.p = String(pos.pw);
    if (typeof pos.t === "number") out.t = Math.round(pos.t * 10) / 10;
    if (extra) for (const k in extra) if (extra[k] != null) out[k] = extra[k];
    return out;
  }
  function decodePos(raw) {
    let o = raw;
    if (typeof raw === "string") { try { o = JSON.parse(raw); } catch (e) { return null; } }
    if (!isObj(o)) return null;
    const pos = { x: num(o.x), y: num(o.y), anim: typeof o.a === "string" ? o.a : "run", stars: num(o.s) | 0, hearts: o.h == null ? 3 : num(o.h) | 0, meters: num(o.m) | 0, pw: o.p || null, t: num(o.t) };
    if (typeof o.ds === "number") pos.ds = Math.max(0, Math.min(1, o.ds));
    if (typeof o.at === "number") pos.at = o.at;
    if (o.r != null) pos.round = o.r | 0;
    return pos;
  }

  function shareUrl(code, brokerIndex, base, brokerOverride) {
    let b = base;
    if (!b && typeof location !== "undefined" && location) b = location.href;
    b = String(b || "./").split("#")[0].split("?")[0];
    let q = "?join=" + cleanCode(code);
    if (Number.isInteger(brokerIndex) && brokerIndex >= 0) q += "&b=" + brokerIndex;
    if (brokerOverride) q += "&broker=" + encodeURIComponent(brokerOverride);
    return b + q;
  }
  function newSeed() {
    const c = G.crypto;
    if (c && typeof c.getRandomValues === "function") { try { const a = new Uint32Array(1); c.getRandomValues(a); return a[0] % 2147483647; } catch (e) { /* val terug */ } }
    return Math.floor(Math.random() * 2147483647);
  }
  const perfNow = () => (G.performance && typeof G.performance.now === "function" ? G.performance.now() : Date.now());

  // ---------- session ----------
  async function createSession(opts) {
    const o = opts || {};
    const DV = dvnet(o.dvnet);
    if (!DV) throw new Error("DVNet ontbreekt (laad ../online/net.js eerst)");
    const now = typeof o.now === "function" ? o.now : () => Date.now();
    const isHost = o.role === "host";
    const pid = o.pid ? String(o.pid) : DV.randomId(10);
    const profile = cleanProfile(o.profile);
    const common = {};
    if (o.mqtt) common.mqtt = o.mqtt;
    if (o.brokers) common.brokers = o.brokers;
    const findOpts = Object.assign({ preferIndex: o.preferIndex }, common);
    if (o.findTimeoutMs != null) findOpts.timeoutMs = o.findTimeoutMs;
    if (o.connectTimeout != null) findOpts.connectTimeout = o.connectTimeout;

    let code, brokerIndex, found = null;
    if (isHost) {
      if (o.code) {
        code = cleanCode(o.code);
        found = await DV.findRoom(code, findOpts);
        if (found && found.state && found.state.hostPid && found.state.hostPid !== pid) {
          throw Object.assign(new Error("Deze kamer is van iemand anders"), { code: "occupied" });
        }
        brokerIndex = found ? found.brokerIndex : Number.isInteger(o.preferIndex) ? o.preferIndex : 0;
      } else {
        const claim = await DV.claimCode(Object.assign({ preferIndex: o.preferIndex }, common));
        code = claim.code; brokerIndex = claim.brokerIndex;
      }
    } else {
      code = cleanCode(o.code);
      if (code.length !== 4) throw Object.assign(new Error("Een kamercode heeft 4 letters"), { code: "bad_code" });
      found = await DV.findRoom(code, findOpts);
      if (!found) throw Object.assign(new Error("Kamer " + code + " niet gevonden"), { code: "not_found" });
      brokerIndex = found.brokerIndex;
    }

    const listeners = new Map();
    const emit = (type, a, b) => { const set = listeners.get(type); if (!set) return; for (const fn of [...set]) { try { fn(a, b); } catch (e) { if (G.console) console.error("[kerst-net]", e); } } };
    const on = (type, fn) => { let set = listeners.get(type); if (!set) { set = new Set(); listeners.set(type, set); } set.add(fn); return () => set.delete(fn); };

    const openOpts = Object.assign({ code, pid, brokerIndex, onStatus: (s) => emit("status", s) }, common);
    if (o.timeoutMs != null) openOpts.timeoutMs = o.timeoutMs;
    const room = await DV.open(openOpts);
    const T = topics(code);
    const client = room.client;
    const offset = OffsetEstimator(12);
    const lastPos = new Map();   // pid → { pos, at (local ms), round }
    const results = {};          // host: pid → result (this round)
    let state = found && found.state && isObj(found.state.players) ? found.state : null;
    let closed = false, finaleSent = false, lastFrac = -1, resultsTimer = null, pingTimer = null, joinTimer = null;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!closed) fn(); }, ms); timers.add(t); return t; };

    const hostNow = () => (isHost ? now() : now() + offset.offset);
    const toPerf = (hostMs) => perfNow() + (hostMs - hostNow());
    const pub = (topic, obj, qos, retain) => new Promise((resolve) => {
      if (closed || !client) { resolve(false); return; }
      try { client.publish(topic, typeof obj === "string" ? obj : JSON.stringify(obj), { qos: qos | 0, retain: !!retain }, (err) => resolve(!err)); } catch (e) { resolve(false); }
    });

    // ---- host-side state machine ----
    function setState(next, publish) {
      if (!next || next === state) return state;
      state = next;
      emit("state", state);
      if (publish && isHost) room.publishState(state);
      return state;
    }
    function update(fn) {
      if (!isHost) throw new Error("Alleen de host past de kamer aan");
      const next = fn(state);
      if (!next || next === state) return state;
      if (next.updatedAt == null || next.updatedAt === state.updatedAt) next.updatedAt = now();
      return setState(next, true);
    }
    function applyEnv(env) { if (!isHost || !state) return; update((st) => reduce(st, env, now())); }
    function droomster() {
      const players = state ? Object.keys(state.players).length : 1;
      const cur = new Map();
      const r = state ? state.round : 0;
      lastPos.forEach((v, k) => { if (v.round === r) cur.set(k, v.pos); });
      return aggregateDroomster(cur, droomsterTarget(players));
    }
    function hostAfterPos() {
      if (!isHost || !state || state.phase !== "run") return;
      const ds = droomster();
      if (Math.abs(ds.frac - lastFrac) >= 0.004 || ds.full) { lastFrac = ds.frac; emit("droomster", ds.frac); }
      if (ds.full && !finaleSent) { finaleSent = true; publishEvt({ ev: "finale", reason: "droomster" }); }
    }
    function activePids() {
      const r = state ? state.round : 0, out = [];
      lastPos.forEach((v, k) => { if (v.round === r) out.push(k); });
      if (out.indexOf(pid) < 0) out.push(pid);
      return out;
    }
    function maybeFinish(force) {
      if (!isHost || !state || (state.phase !== "run" && state.phase !== "results")) return;
      const have = Object.keys(results);
      if (!have.length) return;
      const pending = activePids().filter((p) => !results[p]);
      if (pending.length && !force && state.phase === "run") {
        if (!resultsTimer) resultsTimer = later(() => { resultsTimer = null; maybeFinish(true); }, RESULTS_WAIT_MS);
        return;
      }
      if (resultsTimer) { clearTimeout(resultsTimer); timers.delete(resultsTimer); resultsTimer = null; }
      update((st) => finishRun(st, results, droomster(), now()));
    }
    async function clearDone(pids) {
      await Promise.all(pids.map((p) => pub(T.done(p), "", 1, true)));
    }

    // ---- incoming ----
    function onRaw(topic, payload, packet) {
      if (closed || typeof topic !== "string" || topic.indexOf(T.prefix) !== 0) return;
      const rest = topic.slice(T.prefix.length);
      let msg = null;
      try { const s = payload == null ? "" : payload.toString(); msg = s ? JSON.parse(s) : null; } catch (e) { msg = null; }
      if (rest.indexOf("pos/") === 0) {
        const from = rest.slice(4);
        if (from === pid || !msg) return;
        const pos = decodePos(msg);
        if (!pos) return;
        const r = pos.round != null ? pos.round : state ? state.round : 0;
        lastPos.set(from, { pos, at: now(), round: r });
        if (state && from === state.hostPid) {
          if (typeof pos.at === "number") offset.sample(pos.at, now());
          if (typeof pos.ds === "number") emit("droomster", pos.ds);
        }
        emit("pos", from, pos);
        hostAfterPos();
      } else if (rest === "evt") {
        if (!msg || msg.by === pid) return;
        if (state && msg.by === state.hostPid && typeof msg.at === "number") offset.sample(msg.at, now());
        if (msg.ev !== "ping") emit("evt", msg);
      } else if (rest.indexOf("done/") === 0) {
        const from = rest.slice(5);
        if (!msg || !isHost) return;
        if (packet && packet.retain && state && state.phase === "lobby") return; // oud resultaat (wordt gewist)
        if (state && msg.r != null && msg.r !== state.round) return;
        results[from] = msg;
        emit("done", from, msg);
        maybeFinish(false);
      }
    }
    client.on("message", onRaw);
    try { client.subscribe([T.posAll, T.evt].concat(isHost ? [T.doneAll] : []), { qos: 1 }, noop); } catch (e) { /* hersteld door resubscribe */ }

    const offState = room.subscribeState((st) => {
      if (closed) return;
      if (st == null) { if (!isHost) { emit("left", "closed"); } return; }
      if (!isObj(st.players)) return;
      if (isHost) { // alleen bij herstart van de host-telefoon: eigen retained state overnemen
        if (!state || (st.hostPid === pid && typeof st.updatedAt === "number" && st.updatedAt > (state.updatedAt || 0))) setState(st, false);
        return;
      }
      if (state && typeof st.updatedAt === "number" && typeof state.updatedAt === "number" && st.updatedAt < state.updatedAt) return;
      offset.sample(st.updatedAt, now());
      setState(st, false);
    });
    const offPresence = room.subscribePresence((p, online) => {
      if (closed) return;
      emit("presence", p, online);
      if (isHost && state && state.players[p] && p !== pid) applyEnv({ t: "presence", pid: p, d: { online: !!online }, at: now() });
    });
    let offHost = noop;
    if (isHost) offHost = room.subscribeHost((env) => { if (!closed && isObj(env) && env.pid !== pid) applyEnv(env); });

    // ---- outgoing ----
    function send(t, d) {
      const env = { t, pid, d: d || {}, at: now() };
      if (isHost) { applyEnv(env); return Promise.resolve(true); }
      return room.send(env);
    }
    function publishPos(pos) {
      if (closed) return Promise.resolve(false);
      const extra = { r: state ? state.round : 0 };
      if (isHost) {
        extra.at = now();
        lastPos.set(pid, { pos: Object.assign({}, pos), at: now(), round: extra.r });
        hostAfterPos();
        extra.ds = +droomster().frac.toFixed(3);
      }
      return pub(T.pos(pid), encodePos(pos, extra), 0, false);
    }
    function publishEvt(evt) {
      const msg = Object.assign({}, evt || {}, { by: pid, name: me() ? me().name : profile.name, at: hostNow() });
      if (msg.ev !== "ping") emit("evt", msg);
      return pub(T.evt, msg, 1, false);
    }
    function publishDone(result) {
      const msg = Object.assign({}, result || {}, { pid, r: state ? state.round : 0, at: hostNow() });
      if (isHost) { results[pid] = msg; emit("done", pid, msg); maybeFinish(false); }
      return pub(T.done(pid), msg, 1, true);
    }
    const me = () => (state && state.players[pid] ? Object.assign({ pid }, state.players[pid]) : null);
    function ghosts(nowMs) {
      const t = typeof nowMs === "number" ? nowMs : now();
      const out = [];
      if (!state) return out;
      lastPos.forEach((v, k) => {
        if (k === pid || v.round !== state.round) return;
        const p = state.players[k];
        if (!p) return;
        out.push({ pid: k, name: p.name, animal: p.animal, x: v.pos.x, y: v.pos.y, anim: v.pos.anim, stars: v.pos.stars, hearts: v.pos.hearts, asleep: t - v.at > ASLEEP_MS, at: v.at });
      });
      return out;
    }

    // ---- host actions ----
    function startRunNow(seed) {
      if (!isHost) throw new Error("Alleen de host start");
      finaleSent = false; lastFrac = -1;
      for (const k in results) delete results[k];
      const pids = Object.keys(state.players);
      clearDone(pids);
      return update((st) => startRun(st, { now: now(), seed: seed != null ? seed : newSeed() }));
    }
    function again() {
      if (!isHost) throw new Error("Alleen de host");
      const pids = Object.keys(state.results || {}).concat(Object.keys(state.players));
      clearDone(pids);
      for (const k in results) delete results[k];
      lastPos.clear();
      finaleSent = false; lastFrac = -1;
      return update((st) => againState(st, { seed: newSeed(), now: now() }));
    }
    async function closeRoom() {
      if (isHost && state) { update((st) => Object.assign({}, st, { phase: "closed", updatedAt: now() })); }
      await close();
    }
    async function close() {
      if (closed) return;
      closed = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (pingTimer) clearInterval(pingTimer);
      if (joinTimer) clearInterval(joinTimer);
      try { client.removeListener("message", onRaw); } catch (e) { /* */ }
      offState(); offPresence(); offHost();
      if (!isHost && room.connected) { try { await Promise.race([room.send({ t: "leave", pid, d: {}, at: now() }), new Promise((r) => setTimeout(r, 800))]); } catch (e) { /* */ } }
      await room.close();
    }

    // ---- bootstrap ----
    if (isHost) {
      if (!state || state.hostPid !== pid) state = newLobby({ code, hostPid: pid, host: profile, seed: newSeed(), now: now() });
      else { // herstart van de host: profiel bijwerken en weer online
        state = reduce(state, { t: "join", pid, d: profile, at: now() }, now()) || state;
      }
      await room.publishState(state);
      emit("state", state);
      pingTimer = setInterval(() => { if (!closed && room.connected) publishEvt({ ev: "ping" }); }, PING_MS);
      if (pingTimer && typeof pingTimer.unref === "function") pingTimer.unref();
    } else {
      // Aanmelden bij de host; herhalen tot we in de state staan (of de host niet reageert)
      const joinTimeout = o.joinTimeoutMs != null ? o.joinTimeoutMs : 10000;
      await new Promise((resolve, reject) => {
        const t0 = now();
        const tryJoin = () => { if (!closed) room.send({ t: "join", pid, d: profile, at: now() }); };
        const check = () => {
          if (closed) { finish(new Error("Verbinding gesloten")); return; }
          if (state && state.players[pid]) { finish(null); return; }
          if (now() - t0 > joinTimeout) { finish(Object.assign(new Error("De kamer reageert niet. Is de telefoon van de host nog aan?"), { code: "no_host" })); return; }
          tryJoin();
        };
        let done = false;
        const off = on("state", () => { if (state && state.players[pid]) finish(null); });
        const finish = (err) => { if (done) return; done = true; off(); clearInterval(joinTimer); joinTimer = null; if (err) reject(err); else resolve(); };
        tryJoin();
        joinTimer = setInterval(check, 1500);
      }).catch(async (e) => { await close(); throw e; });
      room.onReconnect(() => { if (!closed) room.send({ t: "join", pid, d: me() || profile, at: now() }); });
    }

    const session = {
      code, pid, isHost, brokerIndex: room.brokerIndex, brokerUrl: room.brokerUrl, room, offset,
      get state() { return state; },
      get players() { return playerList(state); },
      get me() { return me(); },
      get connected() { return !closed && room.connected; },
      get closed() { return closed; },
      on, send, publishPos, publishEvt, publishDone, hostNow, toPerf, ghosts, close,
      update, startRun: startRunNow, again, closeRoom, droomster,
      get results() { return Object.assign({}, results); },
      shareUrl: (base) => shareUrl(code, room.brokerIndex, base, DV.brokerOverride ? DV.brokerOverride() : null),
    };
    return session;
  }

  return {
    VERSION, FAMILY, ANIMALS, DIFFS, MAX_PLAYERS, DURATION_SEC, START_DELAY_MS, ASLEEP_MS, POS_INTERVAL_MS, PING_MS, STARS_PER_PLAYER, RESULTS_WAIT_MS, TITLES,
    topics, cleanName, cleanProfile, newLobby, reduce, canStart, startRun, finishRun, againState, playerList,
    estimateOffset, OffsetEstimator, droomsterTarget, aggregateDroomster, assignMedals, familyTotal,
    encodePos, decodePos, shareUrl, newSeed, createSession,
  };
});
