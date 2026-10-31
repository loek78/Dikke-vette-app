/*
 * DVStory — pure engine voor de verhaalmodus "Vuurwacht" (SPEC-3 §3). UMD: `window.DVStory` + CommonJS `module.exports`.
 * Zelfde contract als DVInfiltrant; de kamerlogica (envelop/seq/ack/key/removed, join/leave/kick/profile, carry) komt uit DVRoom.
 * Puur: geen DOM, netwerk, Date.now of Math.random; de invoer-state wordt nooit gemuteerd. Het script zelf staat in
 * online/story.js (DV_STORY) en komt binnen via ctx.story; de minigames via ctx.minis (DVMini).
 *
 * API
 *   DVStory.createState({ code, host: { pid, key, name, avatar, color }, settings?, carry?, now? }) → state
 *   DVStory.reduce(state, env, ctx) → newState      ctx = { rng, now, story: DV_STORY, minis: DVMini }
 *       (story/minis vallen terug op de globals DV_STORY/DVMini; ignored/ack-only/valid precies zoals DVInfiltrant)
 *   DVStory.publicView(state) → publieke state (nooit keys, stemmen van een lopende keuze, minigame-resultaten of
 *       gedeelde minigame-toestand); DVStory.privateView(state, pid, ctx?) → { v:1, game:"story", runNo, nonce, miniId,
 *       miniView } tijdens een net-minigame voor een deelnemer, anders null (ctx is optioneel: de registry uit de laatste
 *       reduce of window.DVMini wordt gebruikt).
 *   DVStory.fill(text, pub, players?) → {A} {B} {ALLEN} {X} {MVP} {VUUR} ingevuld ({MVP}/{B} zonder speler → "iemand")
 *   DVStory.passes(cond, state), difficultyOf(step, state), scaledBurn(burn, setting), endingFor(state, story), verdict(logs)
 *   DVStory.DEFAULT_SETTINGS { difficulty: "normaal" }, MIN_PLAYERS (2), MAX_PLAYERS (6; de kamer zelf houdt DVRoom.MAX_PLAYERS)
 *
 * Fases: lobby → title → card → stappen (scene | choice [→ flip] | mini → miniResult | fire) … → ending, plus fail.
 *   - title/card/scene/flip/fire/miniResult: verder als alle actieve spelers `ready` zijn, of host `next`.
 *   - choice: iedereen `vote {option}` (index; definitief); stemmen blijven geheim tot iedereen gestemd heeft (host `next`
 *     sluit met de huidige stemmen). Unaniem → toepassen. Verdeeld → `flip` = { id, options, votes, result }: elke stem is
 *     een lootje en ctx.rng trekt er één; na "ready" van iedereen wordt het resultaat toegepast. `lastChoice` toont wie wat koos.
 *   - mini: `mini = { id, kind, nonce, seed, difficulty, roles, pids, submitted, startedAt }` (nonce loopt op). Lokale minis:
 *     `mini {k:"result", nonce, r}` per speler (geheim tot het einde). Net-minis: `mini {k:"act", nonce, a}` → def.reduce,
 *     privateView.miniView = def.view. Klaar als alle actieve deelnemers hebben ingeleverd / def.result ≠ null / host `skipMini`
 *     (wie niets inleverde telt als null). Dan def.score → logs (−2..4) → vuur, fase miniResult met
 *     { logs, lines, mvp, perPlayer, fireBefore, fireAfter, verdict, line } (verdict: ≥2 win, 0–1 meh, <0 lose; line = de
 *     bijpassende regel uit het script). {MVP} verwijst naar de mvp van de laatste minigame.
 *   - fire-stap: vuur ± delta, fase fire met fireChange = { delta, before, after, line }.
 *   - Hoofdstukstart: burn (chill ×0.5 naar beneden afgerond, normaal ×1, pittig ×1.5 afgerond) en dáárna het checkpoint
 *     { chapterIdx, fire: max(3, vuur) }. Vuur ≤ 0 (na burn, keuze, fire-stap of minigame, gecontroleerd bij het doorgaan)
 *     → fase fail; host `retry` herstart dat hoofdstuk op het checkpoint-vuur zonder de burn opnieuw te rekenen; flags blijven
 *     (keuzes in het hoofdstuk worden opnieuw gemaakt en overschrijven ze).
 *   - Na het laatste hoofdstuk: ending = eerste passende afloop (cond: fireGte/fireLte/flag+eq; laatste = vangnet).
 *     host `next` → lobby. host `end` → lobby vanuit elke fase van een run (afgebroken).
 *   - `if` op stappen: { flag, eq } | { flag, ne } | { fireGte } | { fireLte } | { players: ">=3" } (actieve spelers).
 *     difficulty: 1..3 of { base, ifFlag: { flag: waarde }, then }, daarna chill −1 / pittig +1, geklemd op 1..3.
 *   - Spelers: start vereist 2–6 actieve spelers; wie tijdens een run binnenkomt is toeschouwer tot de volgende run; wie
 *     vertrekt telt niet meer mee voor ready/votes/minigames (net-minis: def.bot speelt voor hem verder, zie DVRoom.mini);
 *     wie terugkomt (join) doet weer mee. {A}/{B} = eerste twee deelnemers in volgorde van binnenkomst (ook als één weggaat).
 *   - Publiek: x (per stap geseede speler voor {X}), mvp, flags, fire, checkpoint, runStats (deze run), stats.story (alle runs:
 *     runs, finished, fails, endings, bestEnding, bestFire) — stats reizen mee via carry naar andere engines en terug.
 *     Render altijd op `phase`: lastChoice, miniResult en fireChange blijven staan tot de volgende keuze/minigame/fire-stap
 *     (handig voor {MVP} en terugblikken), `mini` is alleen gevuld in fase mini, `ending` alleen in fase ending.
 */
(function (root, factory) {
  const R = typeof DVRoom !== "undefined" ? DVRoom : require("./room.js");
  const api = factory(R);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DVStory = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function (R) {
  "use strict";

  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 6;
  const OFFSET = { chill: -1, normaal: 0, pittig: 1 };
  const DEFAULT_SETTINGS = Object.freeze({ difficulty: "normaal" });
  const READY_PHASES = Object.freeze(["title", "card", "scene", "flip", "fire", "miniResult"]);
  const hasOwn = R.hasOwn, clone = R.clone;
  let lastMinis = null; // registry uit de laatste reduce, voor privateView zonder ctx

  // ---------- Script ----------
  const globalStory = () => (typeof globalThis !== "undefined" && globalThis.DV_STORY) || null;
  function storyOf(ctx) {
    const st = (ctx && ctx.story) || globalStory();
    return st && Array.isArray(st.chapters) && Array.isArray(st.endings) ? st : null;
  }
  const chapterOf = (s, story) => (story && story.chapters[s.chapter]) || null;
  const stepOf = (s, story) => { const ch = chapterOf(s, story); return ch && Array.isArray(ch.steps) ? ch.steps[s.step] || null : null; };
  const int = (v, d) => (Number.isInteger(v) ? v : d);

  function playersCond(expr, n) {
    if (Number.isInteger(expr)) return n === expr;
    const m = /^\s*(>=|<=|==|=|>|<)?\s*(\d+)\s*$/.exec(String(expr));
    if (!m) return true;
    const k = Number(m[2]);
    switch (m[1] || ">=") {
      case ">=": return n >= k;
      case "<=": return n <= k;
      case ">": return n > k;
      case "<": return n < k;
      default: return n === k;
    }
  }
  function passes(cond, s) {
    if (!cond || typeof cond !== "object") return true;
    let ok = true;
    if (typeof cond.flag === "string") {
      const v = s.flags ? s.flags[cond.flag] : undefined;
      if (hasOwn(cond, "eq")) ok = ok && v === cond.eq;
      if (hasOwn(cond, "ne")) ok = ok && v !== cond.ne;
    }
    if (Number.isFinite(cond.fireGte)) ok = ok && s.fire >= cond.fireGte;
    if (Number.isFinite(cond.fireLte)) ok = ok && s.fire <= cond.fireLte;
    if (cond.players != null) ok = ok && playersCond(cond.players, R.activePids(s).length);
    return ok;
  }
  function endingMatches(cond, s) {
    cond = cond && typeof cond === "object" ? cond : {};
    if (Number.isFinite(cond.fireGte) && !(s.fire >= cond.fireGte)) return false;
    if (Number.isFinite(cond.fireLte) && !(s.fire <= cond.fireLte)) return false;
    if (typeof cond.flag === "string" && (s.flags || {})[cond.flag] !== cond.eq) return false;
    return true;
  }
  function endingFor(s, story) {
    story = story || globalStory();
    if (!story || !Array.isArray(story.endings)) return null;
    return story.endings.find((e) => e && endingMatches(e.cond, s)) || story.endings[story.endings.length - 1] || null;
  }
  const rankOf = (e) => (e.good ? 10 : 0) + (e.cond && Number.isFinite(e.cond.fireGte) ? e.cond.fireGte : 0);

  function difficultyOf(step, s) {
    let d = step ? step.difficulty : 1;
    if (d && typeof d === "object") {
      const f = d.ifFlag && typeof d.ifFlag === "object" ? d.ifFlag : {};
      const keys = Object.keys(f);
      d = keys.length && keys.every((k) => (s.flags || {})[k] === f[k]) ? d.then : d.base;
    }
    const off = OFFSET[s.settings && s.settings.difficulty] || 0;
    return Math.max(1, Math.min(3, (Math.round(Number(d)) || 1) + off));
  }
  function scaledBurn(burn, difficulty) {
    const b = Number.isFinite(burn) ? Math.max(0, burn) : 0;
    if (difficulty === "chill") return Math.floor(b * 0.5);
    if (difficulty === "pittig") return Math.round(b * 1.5);
    return Math.round(b);
  }

  // ---------- Tekst ----------
  function fill(text, state, players) {
    if (typeof text !== "string") return "";
    const list = Array.isArray(players) ? players : state && Array.isArray(state.players) ? state.players : [];
    const roster = list.filter((p) => p && !p.spectator);
    const active = roster.filter((p) => !p.left);
    const nameOf = (p) => (p && typeof p.name === "string" && p.name) || "iemand";
    const byPid = (pid) => (typeof pid === "string" ? list.find((p) => p && p.pid === pid) || null : null);
    const names = (active.length ? active : roster).map(nameOf);
    const allen = !names.length ? "iedereen" : names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " en " + names[names.length - 1];
    const A = roster[0] || null, B = roster[1] || null;
    const x = byPid(state && state.x) || A, mvp = byPid(state && state.mvp);
    const fire = state && Number.isFinite(state.fire) ? state.fire : 0;
    return text.replace(/\{(A|B|ALLEN|X|MVP|VUUR)\}/g, (m, k) => {
      switch (k) {
        case "A": return nameOf(A);
        case "B": return nameOf(B);
        case "ALLEN": return allen;
        case "X": return nameOf(x);
        case "MVP": return nameOf(mvp);
        case "VUUR": return String(fire);
        default: return m;
      }
    });
  }

  // ---------- State ----------
  function mergeSettings(cur, d) {
    const s = clone(cur);
    if (d && typeof d === "object" && hasOwn(OFFSET, d.difficulty)) s.difficulty = d.difficulty;
    return s;
  }
  function createState({ code, host, settings, carry, now } = {}) {
    const base = R.createBase({ code, host, now, carry });
    const story = globalStory();
    const maxFire = Math.max(1, int(story && story.maxFire, 10));
    const startFire = Math.max(1, Math.min(maxFire, int(story && story.startFire, 4)));
    return Object.assign(base, {
      game: "story", storyId: (story && story.id) || null, settings: mergeSettings(DEFAULT_SETTINGS, settings),
      fire: base.fire === null ? startFire : Math.max(0, Math.min(maxFire, base.fire)),
      runNo: 0, chapter: -1, step: -1, maxFire, startFire, burned: 0, fireAtChapterStart: null, flags: {},
      ready: [], voted: [], lastChoice: null, flip: null,
      mini: null, miniNonce: 0, miniResult: null, fireChange: null, ending: null, checkpoint: null, runStats: null, x: null, mvp: null,
      // geheim
      votes: {}, miniResults: {}, miniShared: null,
    });
  }
  function stats(s) {
    if (!s.stats || typeof s.stats !== "object") s.stats = {};
    const st = s.stats.story && typeof s.stats.story === "object" ? s.stats.story : (s.stats.story = {});
    for (const k of ["runs", "finished", "fails"]) if (!Number.isInteger(st[k])) st[k] = 0;
    if (!st.endings || typeof st.endings !== "object") st.endings = {};
    if (!hasOwn(st, "bestEnding")) st.bestEnding = null;
    if (!Number.isInteger(st.bestRank)) st.bestRank = -1;
    if (!hasOwn(st, "bestFire")) st.bestFire = null;
    return st;
  }
  function setFire(s, n) {
    s.fire = Math.max(0, Math.min(s.maxFire, Math.round(Number(n)) || 0));
    if (s.runStats) {
      s.runStats.fireMin = Math.min(s.runStats.fireMin, s.fire);
      s.runStats.fireMax = Math.max(s.runStats.fireMax, s.fire);
    }
  }
  function setPhase(s, phase) { s.phase = phase; s.ready = []; s.voted = []; s.votes = {}; }
  function pickX(s, ctx) {
    const a = R.activePids(s);
    s.x = a.length ? a[Math.min(a.length - 1, Math.floor(ctx.rng() * a.length))] : null;
  }
  const allReady = (s) => R.activePids(s).every((pid) => s.ready.includes(pid));
  const allVoted = (s) => R.activePids(s).every((pid) => s.voted.includes(pid));

  // ---------- Run ----------
  function startRun(s, ctx) {
    const story = storyOf(ctx);
    if (!story) return false;
    const active = s.players.filter((p) => !p.left);
    if (active.length < MIN_PLAYERS || active.length > MAX_PLAYERS) return false;
    for (const p of s.players) if (p.left) delete s.scores[p.pid];
    s.players = active.map((p) => Object.assign(p, { alive: true, spectator: false, left: false }));
    s.storyId = story.id || null;
    s.maxFire = Math.max(1, int(story.maxFire, 10));
    s.startFire = Math.max(1, Math.min(s.maxFire, int(story.startFire, 4)));
    Object.assign(s, {
      runNo: s.runNo + 1, chapter: -1, step: -1, burned: 0, fireAtChapterStart: null, flags: {}, lastChoice: null, flip: null,
      mini: null, miniResults: {}, miniShared: null, miniResult: null, fireChange: null, ending: null, checkpoint: null, mvp: null,
    });
    s.runStats = { startedAt: ctx.now, endedAt: null, ending: null, fireAtDawn: null, minis: [], choices: {}, flips: 0, fails: 0, fireMin: s.startFire, fireMax: s.startFire, mvpCounts: {} };
    setFire(s, s.startFire);
    stats(s).runs += 1;
    setPhase(s, "title");
    pickX(s, ctx);
    return true;
  }
  function toLobby(s) {
    for (const p of s.players) if (p.left) delete s.scores[p.pid];
    s.players = s.players.filter((p) => !p.left).map((p) => Object.assign(p, { alive: true, spectator: false }));
    Object.assign(s, {
      chapter: -1, step: -1, burned: 0, fireAtChapterStart: null, flip: null, mini: null, miniResults: {}, miniShared: null,
      miniResult: null, fireChange: null, ending: null, checkpoint: null, x: null,
    });
    setPhase(s, "lobby");
  }
  function fail(s) {
    Object.assign(s, { mini: null, miniResults: {}, miniShared: null, flip: null });
    if (s.runStats) s.runStats.fails += 1;
    stats(s).fails += 1;
    setPhase(s, "fail");
    return true;
  }
  function retry(s, ctx) {
    const cp = s.checkpoint, story = storyOf(ctx);
    if (!cp || !story || !story.chapters[cp.chapterIdx]) return false;
    s.chapter = cp.chapterIdx; s.step = -1;
    setFire(s, cp.fire);
    Object.assign(s, { fireAtChapterStart: s.fire, burned: 0, fireChange: null, miniResult: null, lastChoice: null });
    setPhase(s, "card");
    pickX(s, ctx);
    return true;
  }
  function finishRun(s, ctx, story) {
    const e = endingFor(s, story) || { id: "einde", title: "Einde", good: false, cond: {}, mood: "dawn", lines: [] };
    s.ending = Object.assign(clone(e), { fire: s.fire });
    s.step = -1;
    const st = stats(s);
    st.finished += 1;
    st.endings[e.id] = (st.endings[e.id] || 0) + 1;
    if (st.bestFire === null || s.fire > st.bestFire) st.bestFire = s.fire;
    const rank = rankOf(e);
    if (rank > st.bestRank) { st.bestRank = rank; st.bestEnding = e.id; }
    if (s.runStats) Object.assign(s.runStats, { ending: e.id, endedAt: ctx.now, fireAtDawn: s.fire });
    setPhase(s, "ending");
    return true;
  }
  function nextChapter(s, ctx) {
    const story = storyOf(ctx);
    const idx = s.chapter + 1;
    if (idx >= story.chapters.length) return finishRun(s, ctx, story);
    const ch = story.chapters[idx];
    s.chapter = idx; s.step = -1;
    const burn = scaledBurn(ch.burn, s.settings.difficulty);
    setFire(s, s.fire - burn);
    s.burned = burn;
    s.fireAtChapterStart = s.fire;
    s.checkpoint = { chapterIdx: idx, fire: Math.max(Math.min(3, s.maxFire), s.fire) };
    if (s.fire <= 0) return fail(s);
    setPhase(s, "card");
    pickX(s, ctx);
    return true;
  }
  // Volgende stap (voorwaarden overslaan), anders volgend hoofdstuk. Vuur op → fail.
  function advance(s, ctx) {
    const story = storyOf(ctx);
    if (s.fire <= 0) return fail(s);
    for (let guard = 0; guard < 1000; guard++) {
      const ch = chapterOf(s, story);
      if (!ch || !Array.isArray(ch.steps)) return nextChapter(s, ctx);
      s.step += 1;
      if (s.step >= ch.steps.length) return nextChapter(s, ctx);
      const st = ch.steps[s.step];
      if (!st || typeof st !== "object" || !passes(st.if, s)) continue;
      if (enterStep(s, st, ctx)) return true;
    }
    return false;
  }
  function enterStep(s, st, ctx) {
    switch (st.type) {
      case "scene":
        setPhase(s, "scene"); pickX(s, ctx);
        return true;
      case "choice":
        if (!Array.isArray(st.options) || !st.options.length) return false;
        s.flip = null;
        setPhase(s, "choice"); pickX(s, ctx);
        return true;
      case "mini":
        if (!R.mini.begin(s, ctx, { id: st.id, difficulty: difficultyOf(st, s) })) return false; // onbekende minigame: overslaan
        s.miniResult = null;
        setPhase(s, "mini"); pickX(s, ctx);
        return true;
      case "fire": {
        const delta = Math.round(Number(st.delta)) || 0, before = s.fire;
        setFire(s, s.fire + delta);
        const line = st.line && typeof st.line === "object" ? { who: st.line.who, text: st.line.text } : null;
        s.fireChange = { delta, before, after: s.fire, line, chapter: s.chapter, step: s.step };
        setPhase(s, "fire"); pickX(s, ctx);
        return true;
      }
      default:
        return false;
    }
  }
  function proceed(s, ctx) {
    switch (s.phase) {
      case "title": return nextChapter(s, ctx);
      case "card": case "scene": case "fire": case "miniResult": return advance(s, ctx);
      case "flip": {
        const st = stepOf(s, storyOf(ctx));
        if (!s.flip || !st || st.type !== "choice") return advance(s, ctx);
        return applyChoice(s, st, s.flip.result, { votes: s.flip.votes, unanimous: false, flip: true }, ctx);
      }
      default: return false;
    }
  }

  // ---------- Keuzes ----------
  function resolveChoice(s, st, ctx) {
    const votes = clone(s.votes), voters = Object.keys(votes);
    if (!voters.length) return false;
    const chosen = [...new Set(voters.map((v) => votes[v]))].sort((a, b) => a - b);
    if (chosen.length === 1) return applyChoice(s, st, chosen[0], { votes, unanimous: true, flip: false }, ctx);
    // Verdeeld: elke stem is een lootje, Gloei gooit de munt.
    const tickets = voters.map((v) => votes[v]);
    const result = tickets[Math.min(tickets.length - 1, Math.floor(ctx.rng() * tickets.length))];
    s.flip = { id: st.id, options: chosen, votes, result };
    if (s.runStats) s.runStats.flips += 1;
    s.phase = "flip"; s.ready = [];
    return true;
  }
  function applyChoice(s, st, idx, info, ctx) {
    const o = st.options[idx] || {};
    if (o.set && typeof o.set === "object") for (const k of Object.keys(o.set)) s.flags[k] = o.set[k];
    const delta = Math.round(Number(o.fire)) || 0;
    if (delta) setFire(s, s.fire + delta);
    s.lastChoice = { id: st.id, chapter: s.chapter, step: s.step, option: idx, votes: info.votes, unanimous: info.unanimous, flip: info.flip, fire: delta };
    if (s.runStats) s.runStats.choices[st.id] = idx;
    s.flip = null;
    return advance(s, ctx);
  }

  // ---------- Minigames ----------
  function finishMini(s, ctx, skipped) {
    const st = stepOf(s, storyOf(ctx));
    const r = R.mini.finish(s, ctx, { skipped });
    if (!r) return false;
    const before = s.fire;
    setFire(s, s.fire + r.logs);
    const line = st && typeof st[r.verdict] === "string" ? st[r.verdict] : null;
    s.miniResult = Object.assign(r, { fireBefore: before, fireAfter: s.fire, line, chapter: s.chapter, step: s.step });
    s.mvp = r.mvp;
    if (s.runStats) {
      if (r.mvp) s.runStats.mvpCounts[r.mvp] = (s.runStats.mvpCounts[r.mvp] || 0) + 1;
      s.runStats.minis.push({ chapter: s.chapter, id: r.id, difficulty: r.difficulty, logs: r.logs, verdict: r.verdict, mvp: r.mvp, skipped: r.skipped });
    }
    s.phase = "miniResult"; s.ready = [];
    return true;
  }

  // ---------- Vertrekken / terugkomen ----------
  function onDrop(s, pid, ctx, wasActive) {
    s.ready = s.ready.filter((x) => x !== pid);
    s.voted = s.voted.filter((x) => x !== pid);
    delete s.votes[pid];
    if (!wasActive || !R.activePids(s).length) return;
    if (s.phase === "mini") {
      R.mini.drop(s, pid, ctx);
      if (R.mini.done(s, ctx)) finishMini(s, ctx, false);
    } else if (s.phase === "choice") {
      const st = stepOf(s, storyOf(ctx));
      if (st && st.type === "choice" && Object.keys(s.votes).length && allVoted(s)) resolveChoice(s, st, ctx);
    } else if (READY_PHASES.includes(s.phase) && allReady(s)) {
      proceed(s, ctx);
    }
  }
  const onReturn = (s, p) => { p.alive = !p.spectator; };

  // ---------- Acties ----------
  // Elke handler: (s, pid, d, ctx) → true als er iets veranderd is, false = ongeldig (alleen ack).
  const isHost = (s, pid) => pid === s.hostPid;
  const ACTIONS = Object.assign(R.actions({ onDrop, onReturn }), {
    settings(s, pid, d) {
      if (!isHost(s, pid) || s.phase !== "lobby") return false;
      const next = mergeSettings(s.settings, d);
      if (JSON.stringify(next) === JSON.stringify(s.settings)) return false;
      s.settings = next;
      return true;
    },
    start(s, pid, d, ctx) {
      if (!isHost(s, pid) || s.phase !== "lobby") return false;
      return startRun(s, ctx);
    },
    ready(s, pid, d, ctx) {
      if (!READY_PHASES.includes(s.phase) || !R.isActive(s, pid) || s.ready.includes(pid)) return false;
      s.ready.push(pid);
      if (allReady(s)) proceed(s, ctx);
      return true;
    },
    vote(s, pid, d, ctx) {
      if (s.phase !== "choice" || !R.isActive(s, pid) || s.voted.includes(pid)) return false;
      const st = stepOf(s, storyOf(ctx));
      if (!st || st.type !== "choice") return false;
      const opt = d.option;
      if (!Number.isInteger(opt) || opt < 0 || opt >= st.options.length) return false;
      s.votes[pid] = opt;
      s.voted.push(pid);
      if (allVoted(s)) resolveChoice(s, st, ctx);
      return true;
    },
    next(s, pid, d, ctx) {
      if (!isHost(s, pid)) return false;
      if (s.phase === "ending") { toLobby(s); return true; }
      if (READY_PHASES.includes(s.phase)) return proceed(s, ctx);
      if (s.phase === "choice") {
        const st = stepOf(s, storyOf(ctx));
        if (!st || st.type !== "choice" || !Object.keys(s.votes).length) return false;
        return resolveChoice(s, st, ctx);
      }
      return false;
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
    retry(s, pid, d, ctx) {
      if (!isHost(s, pid) || s.phase !== "fail") return false;
      return retry(s, ctx);
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
      game: "story", storyId: s.storyId, settings: s.settings, runNo: s.runNo, chapter: s.chapter, step: s.step,
      fire: s.fire, maxFire: s.maxFire, startFire: s.startFire, burned: s.burned, fireAtChapterStart: s.fireAtChapterStart,
      flags: s.flags, ready: s.ready, voted: s.voted, lastChoice: s.lastChoice, flip: s.flip,
      mini: R.mini.publicOf(s), miniResult: s.miniResult, fireChange: s.fireChange, ending: s.ending, checkpoint: s.checkpoint,
      runStats: s.runStats, stats: s.stats, x: s.x, mvp: s.mvp, active: R.activePids(s),
    });
    return clone(pub);
  }
  function privateView(state, pid, ctx) {
    const s = state;
    if (s.phase !== "mini" || !s.mini || s.mini.kind !== "net" || s.removed.includes(pid)) return null;
    const p = R.player(s, pid);
    if (!p || p.left || p.spectator || !s.mini.pids.includes(pid)) return null;
    const minis = (ctx && ctx.minis) || lastMinis || (typeof globalThis !== "undefined" && globalThis.DVMini) || null;
    const view = R.mini.view(s, pid, { minis });
    return clone({ v: 1, game: "story", runNo: s.runNo, nonce: s.mini.nonce, miniId: s.mini.id, miniView: view });
  }

  return {
    createState, reduce, publicView, privateView, fill, passes, difficultyOf, scaledBurn, endingFor,
    verdict: R.mini.verdict, DEFAULT_SETTINGS, MIN_PLAYERS, MAX_PLAYERS, READY_PHASES,
  };
});
