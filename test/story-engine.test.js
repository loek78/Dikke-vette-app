// Tests voor de verhaal-engine (online/story-engine.js) met het echte script (online/story.js) en de echte minigames.
// Draai met: node --test test/story-engine.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const DVMini = require("../online/minis/core.js");
const MINI_IDS = ["blaasbalg", "bijl", "vonken", "slot", "echo", "snel", "verhaal"];
MINI_IDS.forEach((id) => require("../online/minis/" + id + ".js"));
// data-vuur.js bewust niet geladen: dat zet globals (SYNC_PROMPTS) die de minigame-tests in één proces (node --test test/) storen.
const story = require("../online/story.js");
const R = require("../online/room.js");
const S = require("../online/story-engine.js");
const E = require("../online/engine.js");

// ---------- Hulpjes ----------
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
const NAMES = ["Loek", "Jacques", "Sanne", "Mo", "Iris", "Daan", "Fem", "Bas"];
const keyOf = (pid) => "key-" + pid + "-secret";
const hasAck = (s, pid) => Object.prototype.hasOwnProperty.call(s.acks, pid);
const active = (s) => s.players.filter((p) => !p.left && !p.spectator).map((p) => p.pid);
const curStep = (s) => { const ch = story.chapters[s.chapter]; return ch ? ch.steps[s.step] : null; };
const PLAYERS = (pids) => pids.map((pid) => ({ pid, name: NAMES[+pid.slice(1)] || pid }));

// Kamer met n spelers (p0 = host). Elke state wordt diep bevroren → engine mag niets muteren.
function room(n = 2, opts = {}) {
  let rng = DVMini.rng(opts.seed || 1);
  let now = 1000;
  const ctx = () => ({ rng: (...a) => rng(...a), now: (now += 10), story: opts.story || story, minis: DVMini });
  let state = deepFreeze(S.createState({
    code: "BAKO", host: { pid: "p0", key: keyOf("p0"), name: NAMES[0], avatar: "🔥", color: "#ff6a1a" }, settings: opts.settings, now,
  }));
  const r = {
    get s() { return state; },
    set s(v) { state = deepFreeze(v); },
    get now() { return now; },
    set now(v) { now = v; },
    setRng(fn) { rng = fn; },
    ctx,
    reduces: 0,
    env(pid, t, d = {}, extra = {}) {
      const seq = extra.seq != null ? extra.seq : (hasAck(state, pid) ? state.acks[pid] : 0) + 1;
      return { pid, key: extra.key != null ? extra.key : keyOf(pid), seq, t, d };
    },
    // → true als de state veranderde (ook bij alleen-ack), false bij genegeerd (zelfde referentie)
    act(pid, t, d, extra) {
      const prev = state;
      const before = JSON.stringify(prev);
      const next = S.reduce(prev, r.env(pid, t, d, extra), ctx());
      r.reduces++;
      assert.equal(JSON.stringify(prev), before, "input state mutated");
      state = deepFreeze(next);
      return next !== prev;
    },
    join(pid, name) { return r.act(pid, "join", { name: name || NAMES[+pid.slice(1)] || pid, avatar: "🪵", color: "#5aa9ff" }); },
    p(pid) { return state.players.find((x) => x.pid === pid); },
    active() { return active(state); },
    pub() { return S.publicView(state); },
    priv(pid) { return S.privateView(state, pid, { minis: DVMini }); },
    start() { assert.equal(r.act("p0", "start"), true); assert.equal(state.phase, "title"); },
    readyAll() {
      const key = phaseKey(state);
      for (const pid of r.active()) { if (phaseKey(state) !== key) break; r.act(pid, "ready"); }
    },
  };
  for (let i = 1; i < n; i++) r.join("p" + i);
  return r;
}
const phaseKey = (s) => JSON.stringify([s.phase, s.chapter, s.step, s.miniNonce, s.runNo, s.flip ? s.flip.result : null]);

// ---------- Resultaten op maat voor lokale minigames ----------
// Zoekt een resultaat r waarmee def.score({ iedereen: r }) precies `target` blokken geeft.
const CANDIDATES = {
  blaasbalg: Array.from({ length: 101 }, (_, h) => ({ total: 100, hits: h, perfect: h, misses: 100 - h, stray: 0, combo: 0 })),
  bijl: Array.from({ length: 90 }, (_, L) => ({ logs: L, perfect: 0, misses: 0, combo: 0 })).concat([{ logs: 0, perfect: 0, misses: 30, combo: 0 }]),
  vonken: Array.from({ length: 101 }, (_, c) => ({ caught: c, missed: 100 - c, big: 0, combo: 0 })),
  snel: [[100, 100, 100], [200, 200, 1200], [200, 1200, 1200], [1200, 1200, 1200], [null, null, null], [200, null, null]].map((times) => ({ times })),
};
const resultCache = new Map();
function localResult(id, target, difficulty, pids) {
  const key = id + "|" + target + "|" + difficulty + "|" + pids.length;
  if (resultCache.has(key)) return resultCache.get(key);
  const def = DVMini.get(id), players = PLAYERS(pids);
  for (const r of CANDIDATES[id]) {
    const results = {};
    pids.forEach((pid) => { results[pid] = r; });
    if (def.score(results, { difficulty, players }).logs === target) { resultCache.set(key, r); return r; }
  }
  throw new Error("geen " + id + "-resultaat voor " + target + " blokken op moeilijkheid " + difficulty);
}
const MAXLOGS = { blaasbalg: 3, bijl: 4, vonken: 3, slot: 4, echo: 4, snel: 4, verhaal: 3 };
const MINLOGS = { blaasbalg: -1, bijl: -1, vonken: -2, slot: -1, echo: -1, snel: -2, verhaal: 1 };

// ---------- Spelers van net-minigames ----------
function miniAct(r, pid, a) {
  const m = r.s.mini;
  return r.act(pid, "mini", { k: "act", nonce: m.nonce, a });
}
// Slot: zoveel pogingen/zo snel als nodig voor `target` blokken (via def.logsFor), of fout (-1).
function playSlot(r, target) {
  const def = DVMini.get("slot"), m = r.s.mini;
  const slotPid = Object.keys(m.roles).find((p) => m.roles[p] === "slot");
  const sol = def._solution(r.s.miniShared);
  const limit = r.s.miniShared.limit;
  let plan = null;
  if (target > 0) {
    for (let tries = 1; tries <= 3 && !plan; tries++) for (const fast of [true, false]) {
      if (def.logsFor({ solved: true, tries, ms: fast ? 20 : limit * 1000 * 0.9 }, m.difficulty) === target) { plan = { tries, fast }; break; }
    }
    if (!plan) throw new Error("slot: geen plan voor " + target + " blokken op d" + m.difficulty);
  } else plan = { tries: 4, fast: true };
  assert.equal(miniAct(r, slotPid, { t: "go" }), true);
  const wrong = (i) => { const c = sol.slice(); c[i % 4] = (c[i % 4] + 1 + Math.floor(i / 4)) % 6; return c; };
  for (let i = 0; i < Math.min(3, plan.tries - 1); i++) assert.equal(miniAct(r, slotPid, { t: "try", code: wrong(i) }), true);
  if (plan.tries <= 3) {
    if (!plan.fast) r.now += limit * 1000; // langzaam: ruim voorbij 40% van de tijd
    assert.equal(miniAct(r, slotPid, { t: "try", code: sol }), true);
  }
  assert.equal(r.s.phase, "miniResult", "slot klaar");
}
// Echo: N−1 rondes verschillend, dan allemaal hetzelfde woord; target −1 = tot de laatste ronde en dan opgeven.
function playEcho(r, target) {
  const pids = r.s.mini.pids;
  const want = target > 0 ? Math.max(1, 5 - target) : Infinity;
  let round = 1;
  while (r.s.phase === "mini") {
    const shared = r.s.miniShared;
    if (shared.final) {
      for (const pid of pids) if (r.s.phase === "mini") assert.equal(miniAct(r, pid, { t: "quit", on: true }), true);
      break;
    }
    const same = round >= want;
    pids.forEach((pid, i) => {
      if (r.s.phase !== "mini") return;
      // duidelijk verschillende woorden (geen stam of tikfout gemeen), en nooit een eigen eerder woord
      const w = same ? "vuur" : ["kaars", "trein", "piano", "koffie", "zebra", "tulp"][i % 6] + round;
      assert.equal(miniAct(r, pid, { t: "word", w }), true, "echo woord " + w);
    });
    round++;
    if (round > 20) throw new Error("echo loopt vast");
  }
  assert.equal(r.s.phase, "miniResult", "echo klaar");
}
// Verhaal: iedere verteller zegt klaar, de rest geeft `rating` vlammen.
function playVerhaal(r, rating) {
  const def = DVMini.get("verhaal");
  for (let guard = 0; guard < 100 && r.s.phase === "mini"; guard++) {
    const shared = r.s.miniShared;
    const teller = shared.tellers[shared.turn];
    if (shared.stage === "tell") assert.equal(miniAct(r, teller, { t: "klaar" }), true);
    else {
      const raters = shared.order.filter((p) => p !== teller && !Object.prototype.hasOwnProperty.call(shared.votes, p) && r.s.mini.pids.includes(p) && r.active().includes(p));
      for (const pid of raters) { if (r.s.phase !== "mini") break; assert.equal(miniAct(r, pid, { t: "rate", n: rating }), true); }
    }
  }
  assert.equal(r.s.phase, "miniResult", "verhaal klaar " + JSON.stringify(def.result(r.s.miniShared)));
}
// Lokale minigame: iedereen levert hetzelfde resultaat op maat in (target: getal) of een bot-resultaat ("bot").
function playLocal(r, target) {
  const m = r.s.mini, def = DVMini.get(m.id);
  const pids = m.pids.filter((p) => r.active().includes(p));
  for (const pid of pids) {
    if (r.s.phase !== "mini") break;
    const res = target === "bot" ? def.bot(DVMini.rng(r.now + pid.length * 7), m.difficulty) : localResult(m.id, target, m.difficulty, pids);
    assert.equal(r.act(pid, "mini", { k: "result", nonce: m.nonce, r: res }), true);
  }
  assert.equal(r.s.phase, "miniResult", m.id + " klaar");
}
// Speelt de huidige minigame met de gewenste uitkomst ("max" | "min" | "bot" | getal).
function playMini(r, outcome) {
  const m = r.s.mini, id = m.id;
  let target = outcome === "max" ? MAXLOGS[id] : outcome === "min" ? MINLOGS[id] : outcome;
  if (id === "verhaal" && target === 3 && m.pids.filter((p) => r.active().includes(p)).length < 2) target = 2; // solo: Gloei geeft zelf 2 vlammen
  if (id === "slot") playSlot(r, target === "bot" ? 3 : target);
  else if (id === "echo") playEcho(r, target === "bot" ? 3 : target);
  else if (id === "verhaal") playVerhaal(r, target === "bot" ? 2 : target);
  else playLocal(r, target);
  if (target !== "bot") assert.equal(r.s.miniResult.logs, target, id + " moet " + target + " blokken geven: " + JSON.stringify(r.s.miniResult));
  return r.s.miniResult.logs;
}

// Loopt een hele run: keuzes uit `choices` (id → optie-index, of "split"), minigames via `minis(id, r)` → uitkomst.
function play(r, { choices = {}, minis = () => "max", onFail = null, maxSteps = 600 } = {}) {
  const log = { fails: [], flips: [], minis: [] };
  for (let i = 0; i < maxSteps; i++) {
    const s = r.s;
    if (s.phase === "ending" || s.phase === "lobby") return log;
    if (S.READY_PHASES.includes(s.phase)) {
      if (s.phase === "flip") log.flips.push(s.flip.id);
      r.readyAll();
    } else if (s.phase === "choice") {
      const st = curStep(s);
      const pick = choices[st.id];
      const key = phaseKey(s);
      r.active().forEach((pid, i) => {
        if (phaseKey(r.s) !== key) return;
        const opt = pick === "split" ? i % st.options.length : Number.isInteger(pick) ? pick : 0;
        assert.equal(r.act(pid, "vote", { option: opt }), true);
      });
    } else if (s.phase === "mini") {
      const outcome = minis(s.mini.id, r); // een policy mag de minigame ook zelf afmaken
      const logs = r.s.phase === "mini" ? playMini(r, outcome) : r.s.miniResult.logs;
      log.minis.push({ id: s.mini.id, logs });
    } else if (s.phase === "fail") {
      log.fails.push({ chapter: s.chapter, checkpoint: s.checkpoint, fire: s.fire });
      if (onFail) onFail(r); else assert.equal(r.act("p0", "retry"), true);
    } else throw new Error("onbekende fase " + s.phase);
  }
  throw new Error("run eindigt niet (fase " + r.s.phase + ")");
}

// Onafhankelijke naloop van het script (SPEC-3 §2/§3): zelfde keuzes en dezelfde blokken per minigame → verwacht vuur.
function reference({ choices, logs, difficulty = "normaal", players = 2 }) {
  const burnOf = (b) => (difficulty === "chill" ? Math.floor(b / 2) : difficulty === "pittig" ? Math.round(b * 1.5) : b);
  const clamp = (n) => Math.max(0, Math.min(story.maxFire, n));
  let fire = story.startFire, li = 0;
  const flags = {}, fails = [];
  const pass = (c) => !c || ("flag" in c ? ("eq" in c ? flags[c.flag] === c.eq : flags[c.flag] !== c.ne) : "fireGte" in c ? fire >= c.fireGte : "fireLte" in c ? fire <= c.fireLte : players >= Number(c.players.slice(2)));
  story.chapters.forEach((ch, ci) => {
    fire = clamp(fire - burnOf(ch.burn));
    const cp = Math.max(3, fire);
    if (fire <= 0) { fails.push(ci); fire = cp; }
    for (let attempt = 0; attempt < 20; attempt++) {
      let failed = false;
      for (const st of ch.steps) {
        if (!pass(st.if)) continue;
        if (st.type === "choice") { const o = st.options[choices[st.id]]; Object.assign(flags, o.set); if (o.fire) fire = clamp(fire + o.fire); }
        else if (st.type === "mini") { if (li >= logs.length) throw new Error("referentie: te weinig blokken"); fire = clamp(fire + logs[li++]); }
        else if (st.type === "fire") fire = clamp(fire + st.delta);
        if (fire <= 0) { failed = true; break; }
      }
      if (!failed) break;
      fails.push(ci); fire = cp;
    }
  });
  const ending = story.endings.find(({ cond: c }) => (c.fireGte == null || fire >= c.fireGte) && (c.fireLte == null || fire <= c.fireLte) && (c.flag == null || flags[c.flag] === c.eq));
  return { fire, flags, ending: ending.id, fails, used: li };
}
const CHOICE_IDS = story.chapters.flatMap((ch) => ch.steps.filter((s) => s.type === "choice").map((s) => s.id));
const choiceIdx = (map) => { const out = {}; CHOICE_IDS.forEach((id) => { const st = story.chapters.flatMap((c) => c.steps).find((s) => s.type === "choice" && s.id === id); out[id] = st.options.findIndex((o) => Object.values(o.set)[0] === map[id]); assert.ok(out[id] >= 0, id + "=" + map[id]); }); return out; };

// Speelt een scenario en controleert vuur/einde tegen de referentie.
function scenario(name, { flags, minis, settings, players = 2, ending, fails = 0, fireAtEnd }) {
  const r = room(players, { seed: name.length, settings });
  const choices = choiceIdx(flags);
  r.start();
  const log = play(r, { choices, minis: typeof minis === "function" ? minis : () => minis });
  const ref = reference({ choices, logs: log.minis.map((m) => m.logs), difficulty: (settings && settings.difficulty) || "normaal", players });
  assert.equal(r.s.phase, "ending", name);
  assert.equal(r.s.ending.id, ending, name + ": einde (vuur " + r.s.fire + ", ref " + ref.ending + ")");
  assert.equal(r.s.fire, ref.fire, name + ": vuur volgens referentie");
  assert.equal(ref.ending, ending, name + ": referentie-einde");
  assert.deepEqual(r.s.flags, ref.flags, name + ": flags");
  assert.equal(log.fails.length, fails, name + ": aantal keer uit");
  assert.equal(ref.fails.length, fails, name + ": referentie aantal keer uit");
  if (fireAtEnd != null) assert.equal(r.s.fire, fireAtEnd, name + ": vuur bij dageraad");
  assert.equal(log.flips.length, 0, name + ": geen gesplitste keuzes");
  return { r, log, ref };
}

// ---------- Basis ----------
test("createState: lobby, host, standaardinstellingen, publicView zonder geheimen, privateView null", () => {
  const r = room(1);
  const s = r.s;
  assert.deepEqual([s.game, s.phase, s.hostPid, s.acks.p0, s.scores.p0, s.runNo, s.fire, s.maxFire, s.startFire], ["story", "lobby", "p0", 0, 0, 0, story.startFire, story.maxFire, story.startFire]);
  assert.deepEqual(s.settings, { difficulty: "normaal" });
  assert.deepEqual(S.DEFAULT_SETTINGS, { difficulty: "normaal" });
  assert.deepEqual([S.MIN_PLAYERS, S.MAX_PLAYERS, R.MAX_PLAYERS], [2, 6, 12]);
  const pub = r.pub();
  assert.equal(pub.game, "story");
  assert.ok(!("keys" in pub) && !("votes" in pub) && !("miniResults" in pub) && !("miniShared" in pub));
  assert.ok(!JSON.stringify(pub).includes(keyOf("p0")));
  assert.equal(r.priv("p0"), null);
  assert.deepEqual(pub.players[0], { pid: "p0", name: "Loek", avatar: "🔥", color: "#ff6a1a", alive: true, spectator: false, left: false });
});

test("settings: alleen host, alleen lobby, alleen bekende waarden; start vereist 2–6 spelers en host", () => {
  const r = room(1);
  assert.equal(r.act("p0", "start"), true, "ack");
  assert.equal(r.s.phase, "lobby", "1 speler: niet starten");
  r.join("p1");
  assert.equal(r.act("p1", "settings", { difficulty: "pittig" }), true);
  assert.equal(r.s.settings.difficulty, "normaal", "niet-host");
  assert.equal(r.act("p0", "settings", { difficulty: "heet" }), true);
  assert.equal(r.s.settings.difficulty, "normaal");
  const before = r.s;
  r.act("p0", "settings", { difficulty: "normaal" });
  assert.deepEqual(JSON.parse(JSON.stringify(r.s)), Object.assign(JSON.parse(JSON.stringify(before)), { acks: r.s.acks }), "ongewijzigd → alleen ack");
  assert.equal(r.act("p0", "settings", { difficulty: "pittig" }), true);
  assert.equal(r.s.settings.difficulty, "pittig");
  assert.equal(r.act("p1", "start"), true);
  assert.equal(r.s.phase, "lobby", "niet-host start niet");
  for (let i = 2; i <= 6; i++) r.join("p" + i);
  assert.equal(r.s.players.length, 7);
  assert.equal(r.act("p0", "start"), true);
  assert.equal(r.s.phase, "lobby", "7 spelers: te veel voor het verhaal");
  r.act("p6", "leave");
  r.start();
  assert.equal(r.act("p0", "settings", { difficulty: "chill" }), true);
  assert.equal(r.s.settings.difficulty, "pittig", "in een run niet meer wijzigen");
  assert.deepEqual([r.s.runNo, r.s.fire, r.s.chapter, r.s.step, r.s.stats.story.runs], [1, story.startFire, -1, -1, 1]);
  assert.ok(r.active().includes(r.s.x));
});

test("title → card → scene: iedereen ready of host next; ready van toeschouwers/dubbel = alleen ack", () => {
  const r = room(2);
  r.start();
  assert.equal(r.act("p0", "ready"), true);
  assert.equal(r.s.phase, "title");
  assert.equal(r.act("p0", "ready"), true, "dubbel ready: alleen ack");
  assert.deepEqual(r.s.ready, ["p0"]);
  r.join("p2");
  assert.equal(r.p("p2").spectator, true, "binnenkomer tijdens de run kijkt mee");
  assert.equal(r.act("p2", "ready"), true);
  assert.deepEqual(r.s.ready, ["p0"], "toeschouwer telt niet");
  assert.equal(r.act("p1", "ready"), true);
  assert.deepEqual([r.s.phase, r.s.chapter, r.s.step, r.s.ready, r.s.burned, r.s.fireAtChapterStart], ["card", 0, -1, [], 0, story.startFire]);
  assert.deepEqual(r.s.checkpoint, { chapterIdx: 0, fire: story.startFire });
  assert.equal(r.act("p1", "next"), true);
  assert.equal(r.s.phase, "card", "next is voor de host");
  assert.equal(r.act("p0", "next"), true);
  assert.deepEqual([r.s.phase, r.s.step, curStep(r.s).type], ["scene", 0, "scene"]);
  const pub = r.pub();
  assert.deepEqual([pub.phase, pub.chapter, pub.step, pub.ready], ["scene", 0, 0, []]);
  assert.equal(S.privateView(r.s, "p0"), null);
});

// ---------- Keuzes ----------
test("choice: stemmen geheim tot iedereen gestemd heeft; unaniem → flags; ongeldige stem = alleen ack; stem is definitief", () => {
  const r = room(3);
  r.start();
  while (r.s.phase !== "choice") r.readyAll();
  assert.equal(curStep(r.s).id, "belofte");
  assert.equal(r.act("p0", "vote", { option: 5 }), true);
  assert.deepEqual(r.s.voted, [], "ongeldige optie");
  assert.equal(r.act("p0", "vote", { option: "0" }), true);
  assert.deepEqual(r.s.voted, []);
  assert.equal(r.act("p0", "vote", { option: 1 }), true);
  assert.deepEqual(r.s.voted, ["p0"]);
  const pub = r.pub();
  assert.ok(!("votes" in pub), "stemmen niet publiek");
  assert.equal(pub.lastChoice, null);
  assert.equal(r.act("p0", "vote", { option: 0 }), true);
  assert.deepEqual(r.s.votes, { p0: 1 }, "stem is definitief");
  assert.equal(r.act("p2", "vote", { option: 1 }), true);
  assert.equal(r.s.phase, "choice");
  assert.equal(r.act("p1", "vote", { option: 1 }), true);
  assert.deepEqual([r.s.phase, r.s.flags], ["fire", { belofte: "nee" }], "unaniem nee → de fire-stap (+1) komt");
  assert.deepEqual(r.s.lastChoice, { id: "belofte", chapter: 0, step: 2, option: 1, votes: { p0: 1, p2: 1, p1: 1 }, unanimous: true, flip: false, fire: 0 });
  assert.deepEqual([r.s.fireChange.delta, r.s.fireChange.before, r.s.fireChange.after, r.s.fire], [1, 4, 5, 5]);
  assert.equal(r.s.fireChange.line.who, "gloei");
  assert.deepEqual(r.s.voted, []);
  assert.deepEqual(r.pub().votes, undefined);
});

test("choice verdeeld → flip via rng (elke stem een lootje), daarna ready → optie toegepast", () => {
  for (const [roll, expectOpt] of [[0.01, 0], [0.99, 1]]) {
    const r = room(2);
    r.start();
    while (r.s.phase !== "choice") r.readyAll();
    r.act("p0", "vote", { option: 0 });
    r.setRng(() => roll);
    r.act("p1", "vote", { option: 1 });
    assert.equal(r.s.phase, "flip");
    assert.deepEqual(r.s.flip, { id: "belofte", options: [0, 1], votes: { p0: 0, p1: 1 }, result: expectOpt });
    assert.deepEqual(r.s.flags, {}, "nog niet toegepast");
    assert.equal(r.pub().flip.result, expectOpt);
    assert.equal(r.act("p0", "vote", { option: 0 }), true, "stemmen tijdens flip: alleen ack");
    assert.equal(r.s.phase, "flip");
    r.setRng(DVMini.rng(9));
    r.readyAll();
    assert.deepEqual(r.s.flags, { belofte: expectOpt === 0 ? "ja" : "nee" });
    assert.equal(r.s.lastChoice.flip, true);
    assert.equal(r.s.lastChoice.unanimous, false);
    assert.equal(r.s.flip, null);
    assert.equal(r.s.runStats.flips, 1);
    assert.equal(r.s.phase, expectOpt === 0 ? "scene" : "fire");
  }
  // 3 spelers 2–1: resultaat is één van de gekozen opties; host next met gedeeltelijke stemmen sluit de keuze
  const r = room(3);
  r.start();
  while (r.s.phase !== "choice") r.readyAll();
  r.act("p0", "vote", { option: 1 });
  r.act("p1", "vote", { option: 0 });
  assert.equal(r.act("p0", "next"), true);
  assert.equal(r.s.phase, "flip");
  assert.ok([0, 1].includes(r.s.flip.result));
  assert.deepEqual(r.s.flip.votes, { p0: 1, p1: 0 });
  const r2 = room(2);
  r2.start();
  while (r2.s.phase !== "choice") r2.readyAll();
  assert.equal(r2.act("p0", "next"), true);
  assert.equal(r2.s.phase, "choice", "next zonder stemmen doet niks");
  r2.act("p1", "vote", { option: 0 });
  assert.equal(r2.act("p0", "next"), true);
  assert.deepEqual([r2.s.phase, r2.s.flags, r2.s.lastChoice.unanimous], ["scene", { belofte: "ja" }, true]);
});

// ---------- Hele runs: elk einde ----------
test("einde Legende: belofte, deur dicht, alles gewonnen → vuur ≥ 8", () => {
  const { r } = scenario("legende", {
    flags: { belofte: "ja", bijl: "grote", kleed: "deur", kist: "hout", mist: "dicht", aanbod: "nee", fles: "nu" }, minis: "max", ending: "legende", fireAtEnd: 9,
  });
  assert.equal(r.s.ending.good, true);
  assert.equal(r.s.ending.fire, 9);
  assert.deepEqual(r.s.runStats.minis.map((m) => [m.id, m.difficulty, m.logs]), [["blaasbalg", 1, 3], ["bijl", 3, 4], ["vonken", 2, 3], ["slot", 2, 4], ["echo", 2, 4], ["snel", 2, 4], ["verhaal", 1, 3]]);
  assert.deepEqual(r.s.stats.story, { runs: 1, finished: 1, fails: 0, endings: { legende: 1 }, bestEnding: "legende", bestRank: 18, bestFire: 9 });
  assert.deepEqual([r.s.runStats.ending, r.s.runStats.fireAtDawn, r.s.runStats.fireMin, r.s.runStats.fireMax], ["legende", 9, 4, 10]);
  assert.equal(r.s.chapter, story.chapters.length - 1, "HUD blijft op 06:00");
  // ending-tekst invullen
  const pub = r.pub();
  const txt = pub.ending.lines.map((l) => S.fill(l.text, pub, pub.players)).join("\n");
  assert.ok(/Loek/.test(txt) && /Jacques/.test(txt) && !/\{/.test(txt));
  assert.match(txt, /9 blokken/);
  // host next → lobby, stats blijven, spelers normaal
  assert.equal(r.act("p1", "next"), true);
  assert.equal(r.s.phase, "ending");
  assert.equal(r.act("p0", "next"), true);
  assert.deepEqual([r.s.phase, r.s.ending, r.s.chapter, r.s.stats.story.runs, r.s.fire], ["lobby", null, -1, 1, 9]);
});

test("einde In het Wachtboek: boek mee, geen belofte, hoog vuur", () => {
  scenario("wachtboek", {
    flags: { belofte: "nee", bijl: "takken", kleed: "kachel", kist: "boek", mist: "gekeken", aanbod: "nee", fles: "later" }, minis: "max", ending: "wachtboek", fireAtEnd: 10,
  });
});

test("einde Vuurwachters: hout mee, geen belofte", () => {
  const { r } = scenario("vuurwachters", {
    flags: { belofte: "nee", bijl: "takken", kleed: "kachel", kist: "hout", mist: "gekeken", aanbod: "nee", fles: "later" }, minis: "max", ending: "vuurwachters", fireAtEnd: 10,
  });
  assert.equal(r.s.runStats.minis.find((m) => m.id === "echo").difficulty, 1, "gekeken → makkelijkere echo");
});

test("einde Op het nippertje: vuur 1–3 bij dageraad, zonder uit te gaan", () => {
  const perMini = { blaasbalg: -1, bijl: 0, vonken: 1, slot: 1, echo: 1, snel: 1, verhaal: 1 };
  const { r } = scenario("nippertje", {
    flags: { belofte: "nee", bijl: "takken", kleed: "kachel", kist: "hout", mist: "dicht", aanbod: "nee", fles: "later" }, minis: (id) => perMini[id], ending: "nippertje", fireAtEnd: 3,
  });
  assert.equal(r.s.runStats.fireMin, 1);
  assert.equal(r.s.ending.good, false);
  assert.ok(r.s.runStats.minis.every((m) => m.verdict === (m.logs >= 2 ? "win" : m.logs >= 0 ? "meh" : "lose")));
});

test("einde Een koude handdruk: het aanbod aannemen kost je het einde, hoe hoog het vuur ook staat", () => {
  const { r } = scenario("koud", {
    flags: { belofte: "ja", bijl: "grote", kleed: "deur", kist: "hout", mist: "dicht", aanbod: "ja", fles: "nu" }, minis: "max", ending: "koud", fireAtEnd: 6,
  });
  assert.equal(r.s.runStats.minis.find((m) => m.id === "snel").difficulty, 1, "aanbod ja → makkelijker duel");
  assert.equal(r.s.stats.story.bestEnding, "koud");
});

test("Het vuur is uit bij het hoofdstukbegin (burn) → fail, checkpoint ná de burn, retry zonder nieuwe burn", () => {
  const per = { blaasbalg: -1, bijl: -1 };
  const { r, log } = scenario("fail-burn", {
    flags: { belofte: "nee", bijl: "takken", kleed: "deur", kist: "hout", mist: "dicht", aanbod: "nee", fles: "nu" },
    minis: (id, rr) => (rr.s.runStats.fails === 0 && per[id] !== undefined ? per[id] : "max"), ending: "vuurwachters", fails: 1,
  });
  assert.deepEqual(log.fails, [{ chapter: 2, checkpoint: { chapterIdx: 2, fire: 3 }, fire: 0 }]);
  assert.deepEqual([r.s.stats.story.fails, r.s.runStats.fails], [1, 1]);
  const minis = r.s.runStats.minis.map((m) => m.id);
  assert.deepEqual(minis, ["blaasbalg", "bijl", "vonken", "slot", "echo", "snel", "verhaal"], "geen minigame dubbel: het hoofdstuk Vonkenregen begon opnieuw vóór zijn minigame");
});

test("Het vuur is uit ná een minigame (miniResult toont 0) en ná een fire-stap; retry herspeelt het hoofdstuk", () => {
  // kist: vuur 1 na burn, slot verliest → 0 → bij doorgaan uit; checkpoint = kist met 3
  const perA = { blaasbalg: -1, bijl: 0, vonken: 1, slot: -1 };
  const a = scenario("fail-mini", {
    flags: { belofte: "nee", bijl: "takken", kleed: "kachel", kist: "hout", mist: "dicht", aanbod: "nee", fles: "later" },
    minis: (id, rr) => (rr.s.runStats.fails === 0 && perA[id] !== undefined ? perA[id] : id === "slot" ? 1 : "max"), ending: "vuurwachters", fails: 1,
  });
  assert.deepEqual(a.log.fails, [{ chapter: 3, checkpoint: { chapterIdx: 3, fire: 3 }, fire: 0 }]);
  assert.deepEqual(a.r.s.runStats.minis.map((m) => m.id + ":" + m.logs).slice(0, 5), ["blaasbalg:-1", "bijl:0", "vonken:1", "slot:-1", "slot:1"], "slot opnieuw gespeeld na retry");
  // mist: vuur 1 na burn; gekeken; echo +1 → 2; kleed niet voor de deur −1 → 1; gekeken −1 → 0 → fire-fase toont 0, dan uit
  const perB = { blaasbalg: 0, bijl: 0, vonken: 1, slot: 1, echo: 1 };
  const b = scenario("fail-fire", {
    flags: { belofte: "nee", bijl: "takken", kleed: "kachel", kist: "boek", mist: "gekeken", aanbod: "nee", fles: "later" },
    minis: (id, rr) => (rr.s.runStats.fails === 0 && perB[id] !== undefined ? perB[id] : "max"), ending: "wachtboek", fails: 1,
  });
  assert.deepEqual(b.log.fails, [{ chapter: 4, checkpoint: { chapterIdx: 4, fire: 3 }, fire: 0 }]);
});

test("fail-fase: alleen host retry; retry zet vuur op het checkpoint, fase card, burned 0; end → lobby", () => {
  const r = room(2);
  r.start();
  play(r, { choices: choiceIdx({ belofte: "nee", bijl: "takken", kleed: "deur", kist: "hout", mist: "dicht", aanbod: "nee", fles: "nu" }), minis: () => "min", onFail: (rr) => { rr.act("p0", "end"); } });
  assert.equal(r.s.phase, "lobby", "end vanuit fail → lobby");
  assert.deepEqual([r.s.stats.story.runs, r.s.stats.story.finished, r.s.stats.story.fails], [1, 0, 1]);
  assert.ok(r.s.players.every((p) => !p.left && !p.spectator && p.alive));
  const r3 = room(2);
  r3.start();
  try { play(r3, { choices: choiceIdx({ belofte: "nee", bijl: "takken", kleed: "deur", kist: "hout", mist: "dicht", aanbod: "nee", fles: "nu" }), minis: () => "min", onFail: () => { throw new Error("stop"); } }); } catch (e) { assert.equal(e.message, "stop"); }
  assert.equal(r3.s.phase, "fail");
  assert.equal(r3.s.fire, 0);
  const cp = r3.s.checkpoint;
  assert.equal(r3.act("p1", "retry"), true);
  assert.equal(r3.s.phase, "fail", "retry is voor de host");
  assert.equal(r3.act("p0", "ready"), true);
  assert.equal(r3.s.phase, "fail", "ready doet niks in fail");
  assert.equal(r3.act("p0", "retry"), true);
  assert.deepEqual([r3.s.phase, r3.s.chapter, r3.s.step, r3.s.fire, r3.s.burned, r3.s.fireAtChapterStart, r3.s.mini], ["card", cp.chapterIdx, -1, cp.fire, 0, cp.fire, null]);
  assert.equal(r3.s.checkpoint.chapterIdx, cp.chapterIdx);
  assert.equal(r3.s.runStats.fails, 1);
  assert.equal(r3.act("p0", "retry"), true, "retry buiten fail: alleen ack");
  assert.equal(r3.s.phase, "card");
});

// ---------- Moeilijkheid ----------
test("difficulty: expressies, instellingen chill/pittig, burn-schaal, if-voorwaarden", () => {
  const st = { type: "mini", id: "bijl", difficulty: { base: 1, ifFlag: { bijl: "grote" }, then: 3 } };
  const s = (flags, difficulty, fire = 4, n = 2) => ({ flags, settings: { difficulty }, fire, players: Array.from({ length: n }, (_, i) => ({ pid: "p" + i, left: false, spectator: false })) });
  assert.equal(S.difficultyOf(st, s({ bijl: "grote" }, "normaal")), 3);
  assert.equal(S.difficultyOf(st, s({ bijl: "takken" }, "normaal")), 1);
  assert.equal(S.difficultyOf(st, s({}, "pittig")), 2);
  assert.equal(S.difficultyOf(st, s({ bijl: "grote" }, "pittig")), 3, "geklemd op 3");
  assert.equal(S.difficultyOf(st, s({ bijl: "grote" }, "chill")), 2);
  assert.equal(S.difficultyOf({ difficulty: 1 }, s({}, "chill")), 1, "geklemd op 1");
  assert.equal(S.difficultyOf({ difficulty: 2 }, s({}, "pittig")), 3);
  assert.equal(S.difficultyOf({}, s({}, "normaal")), 1);
  assert.deepEqual([S.scaledBurn(1, "chill"), S.scaledBurn(1, "normaal"), S.scaledBurn(1, "pittig"), S.scaledBurn(2, "pittig"), S.scaledBurn(0, "pittig"), S.scaledBurn(3, "chill")], [0, 1, 2, 3, 0, 1]);
  assert.equal(S.passes({ flag: "x", eq: "a" }, s({ x: "a" })), true);
  assert.equal(S.passes({ flag: "x", eq: "a" }, s({ x: "b" })), false);
  assert.equal(S.passes({ flag: "x", ne: "a" }, s({})), true);
  assert.equal(S.passes({ flag: "x", ne: "a" }, s({ x: "a" })), false);
  assert.equal(S.passes({ fireGte: 4 }, s({}, "normaal", 4)), true);
  assert.equal(S.passes({ fireGte: 5 }, s({}, "normaal", 4)), false);
  assert.equal(S.passes({ fireLte: 3 }, s({}, "normaal", 3)), true);
  assert.equal(S.passes({ fireLte: 3 }, s({}, "normaal", 4)), false);
  assert.equal(S.passes({ players: ">=3" }, s({}, "normaal", 4, 2)), false);
  assert.equal(S.passes({ players: ">=3" }, s({}, "normaal", 4, 3)), true);
  assert.equal(S.passes(null, s({})), true);
  // pittig in een echte run: burn 2 bij hoofdstuk 1, minigame-moeilijkheid +1; chill: burn 0
  const rp = room(2, { settings: { difficulty: "pittig" } });
  rp.start();
  while (rp.s.phase !== "mini") { if (rp.s.phase === "choice") rp.active().forEach((p) => rp.act(p, "vote", { option: 0 })); else rp.readyAll(); }
  assert.equal(rp.s.mini.difficulty, 2, "blaasbalg 1 → 2 op pittig");
  playMini(rp, 3);
  while (rp.s.chapter < 1) rp.readyAll();
  assert.deepEqual([rp.s.burned, rp.s.fire, rp.s.checkpoint], [2, 5, { chapterIdx: 1, fire: 5 }]);
  const rc = room(2, { settings: { difficulty: "chill" } });
  rc.start();
  while (rc.s.phase !== "mini") { if (rc.s.phase === "choice") rc.active().forEach((p) => rc.act(p, "vote", { option: 0 })); else rc.readyAll(); }
  assert.equal(rc.s.mini.difficulty, 1);
  playMini(rc, 0);
  while (rc.s.chapter < 1) rc.readyAll();
  assert.deepEqual([rc.s.burned, rc.s.fire], [0, 4]);
  // de scène voor 3+ spelers (hout[1]) verschijnt alleen met 3 spelers
  const scenes = (rr) => { rr.start(); const out = []; for (let i = 0; i < 400 && rr.s.phase !== "ending"; i++) { if (rr.s.phase === "scene") out.push(rr.s.chapter + ":" + rr.s.step); if (rr.s.phase === "choice") rr.active().forEach((p) => rr.act(p, "vote", { option: 0 })); else if (rr.s.phase === "mini") playMini(rr, "max"); else if (rr.s.phase === "fail") rr.act("p0", "retry"); else rr.readyAll(); } return out; };
  assert.ok(scenes(room(3)).includes("1:1") && !scenes(room(2)).includes("1:1"));
});

// ---------- Minigames ----------
test("mini: publieke velden zonder resultaten, resultaten geheim tot miniResult, dubbel/verkeerde nonce = alleen ack, skipMini → null", () => {
  const r = room(3);
  r.start();
  while (r.s.phase !== "mini") { if (r.s.phase === "choice") r.active().forEach((p) => r.act(p, "vote", { option: 0 })); else r.readyAll(); }
  const m = r.s.mini;
  assert.deepEqual([m.id, m.kind, m.nonce, m.difficulty, m.pids, m.submitted], ["blaasbalg", "local", 1, 1, ["p0", "p1", "p2"], []]);
  assert.ok(Number.isInteger(m.seed));
  assert.deepEqual(r.pub().mini, { id: "blaasbalg", kind: "local", nonce: 1, seed: m.seed, difficulty: 1, roles: null, pids: ["p0", "p1", "p2"], submitted: [], startedAt: m.startedAt });
  const res = (pid) => Object.assign({}, localResult("blaasbalg", 3, 1, m.pids), { marker: "GEHEIM-" + pid + "-" + Math.random().toString(36).slice(2) });
  const r0 = res("p0");
  assert.equal(r.act("p0", "mini", { k: "result", nonce: 99, r: r0 }), true);
  assert.deepEqual(r.s.mini.submitted, [], "verkeerde nonce");
  assert.equal(r.act("p0", "mini", { k: "result", nonce: 1, r: r0 }), true);
  assert.deepEqual(r.s.mini.submitted, ["p0"]);
  assert.equal(r.act("p0", "mini", { k: "result", nonce: 1, r: r0 }), true, "dubbel: alleen ack");
  assert.deepEqual(r.s.mini.submitted, ["p0"]);
  assert.equal(r.act("p0", "mini", { k: "act", nonce: 1, a: { t: "x" } }), true);
  assert.equal(r.s.phase, "mini");
  assert.ok(!JSON.stringify(r.pub()).includes("GEHEIM"), "resultaat van p0 niet publiek");
  assert.equal(r.priv("p1"), null, "lokale mini: geen privé-view nodig");
  assert.equal(r.s.miniResults.p0.marker, r0.marker, "host bewaart het resultaat");
  assert.equal(r.act("p1", "skipMini"), true);
  assert.equal(r.s.phase, "mini", "skip is voor de host");
  assert.equal(r.act("p0", "skipMini"), true);
  assert.equal(r.s.phase, "miniResult");
  const mr = r.s.miniResult;
  assert.deepEqual([mr.id, mr.skipped, mr.pids, mr.nonce], ["blaasbalg", true, ["p0", "p1", "p2"], 1]);
  assert.equal(mr.perPlayer.p1, "—", "ontbrekend resultaat = null → streepje");
  assert.ok(mr.lines.some((l) => /Jacques blies niet mee/.test(l)));
  assert.ok(Number.isInteger(mr.logs) && mr.logs >= -2 && mr.logs <= 4);
  assert.deepEqual([mr.fireBefore, mr.fireAfter, r.s.fire], [4, Math.max(0, Math.min(10, 4 + mr.logs)), Math.max(0, Math.min(10, 4 + mr.logs))]);
  assert.equal(mr.verdict, mr.logs >= 2 ? "win" : mr.logs >= 0 ? "meh" : "lose");
  assert.equal(mr.line, curStep(r.s)[mr.verdict]);
  assert.equal(r.s.mini, null);
  assert.ok(!JSON.stringify(r.pub()).includes("GEHEIM"), "ruwe resultaten blijven ook daarna geheim");
  assert.equal(r.act("p2", "mini", { k: "result", nonce: 1, r: r0 }), true, "te laat: alleen ack");
  assert.equal(r.s.phase, "miniResult");
  assert.equal(r.s.mvp, mr.mvp);
  r.readyAll();
  assert.notEqual(r.s.phase, "miniResult");
});

test("mini verdict-regels: ≥2 win, 0–1 meh, <0 lose; snel −2..4, verhaal nooit lose; echo Telt!", () => {
  const r = room(2);
  r.start();
  const flags = choiceIdx({ belofte: "ja", bijl: "grote", kleed: "deur", kist: "hout", mist: "dicht", aanbod: "nee", fles: "nu" });
  const seen = {};
  const outcomes = { blaasbalg: 0, bijl: -1, vonken: 1, slot: 2, echo: "telt", snel: -2, verhaal: 1 };
  play(r, { choices: flags, minis: (id, rr) => {
    if (id !== "echo") return outcomes[id];
    // Telt!: eerst een onthulling zonder match, dan iedereen Telt → max(1, 5−1−1) = 3
    const pids = rr.s.mini.pids;
    pids.forEach((p) => miniAct(rr, p, { t: "word", w: p + "anders" }));
    pids.forEach((p) => { if (rr.s.phase === "mini") miniAct(rr, p, { t: "telt", on: true }); });
    assert.equal(rr.s.phase, "miniResult");
    seen.echo = rr.s.miniResult;
    return null;
  } });
  const by = {};
  r.s.runStats.minis.forEach((m) => { by[m.id] = m; });
  assert.deepEqual([by.blaasbalg.verdict, by.bijl.verdict, by.vonken.verdict, by.slot.verdict, by.snel.verdict, by.verhaal.verdict], ["meh", "lose", "meh", "win", "lose", "meh"]);
  assert.deepEqual([by.snel.logs, by.verhaal.logs, by.echo.logs], [-2, 1, 3]);
  assert.ok(seen.echo.lines.some((l) => /Telt!/.test(l)));
  assert.ok(/Telt/.test(JSON.stringify(seen.echo.lines)));
});

test("net-minigame slot: privé-views per rol, publiek lekt code noch aanwijzingen; echo: woorden geheim tot de onthulling", () => {
  const r = room(3);
  r.start();
  const toMini = (id) => { while (!(r.s.phase === "mini" && r.s.mini.id === id)) { if (r.s.phase === "choice") r.active().forEach((p) => r.act(p, "vote", { option: 0 })); else if (r.s.phase === "mini") playMini(r, "max"); else if (r.s.phase === "fail") r.act("p0", "retry"); else r.readyAll(); } };
  toMini("slot");
  const def = DVMini.get("slot");
  const shared = r.s.miniShared, sol = def._solution(shared);
  const slotPid = Object.keys(r.s.mini.roles).find((p) => r.s.mini.roles[p] === "slot");
  const gids = r.s.mini.pids.filter((p) => p !== slotPid);
  const pubJson = JSON.stringify(r.pub());
  assert.ok(!pubJson.includes(JSON.stringify(sol)), "code niet publiek");
  for (const c of shared.clues) assert.ok(!pubJson.includes(c.text), "aanwijzing niet publiek: " + c.text);
  assert.ok(!pubJson.includes('"rings"') && !pubJson.includes('"clues"'));
  assert.deepEqual(r.pub().mini.roles, r.s.mini.roles, "rollen zijn publiek (de runner heeft ze nodig)");
  const vs = r.priv(slotPid), vg = r.priv(gids[0]), vg2 = r.priv(gids[1]);
  assert.deepEqual([vs.v, vs.game, vs.runNo, vs.nonce, vs.miniId, vs.miniView.role], [1, "story", 1, r.s.mini.nonce, "slot", "slot"]);
  assert.equal(vg.miniView.role, "gids");
  assert.ok(Array.isArray(vs.miniView.rings) && !("clues" in vs.miniView) && !("solution" in vs.miniView));
  for (const c of shared.clues) assert.ok(!JSON.stringify(vs).includes(c.text), "slot ziet geen aanwijzingen");
  assert.ok(!JSON.stringify(vg).includes(JSON.stringify(sol)) && !("rings" in vg.miniView), "gids ziet de code niet");
  const mine = vg.miniView.clues.map((c) => c.text), theirs = vg2.miniView.clues.map((c) => c.text);
  assert.ok(mine.length && theirs.length && mine.every((t) => !theirs.includes(t)), "aanwijzingen verdeeld over de gidsen");
  assert.equal(r.priv("zz"), null);
  assert.equal(S.privateView(r.s, slotPid).miniView.role, "slot", "zonder ctx: registry uit de laatste reduce");
  // publicView en privateView zijn kopieën
  const pv = r.priv(slotPid); pv.miniView.rings[0] = 99;
  assert.notEqual(r.s.miniShared.rings[0], 99);
  playMini(r, "max");
  toMini("echo");
  const pids = r.s.mini.pids;
  assert.equal(miniAct(r, "p1", { t: "word", w: "Geheimwoordje" }), true);
  const pj = JSON.stringify(r.pub());
  assert.ok(!/geheimwoordje/i.test(pj), "woord niet publiek");
  assert.ok(!/geheimwoordje/i.test(JSON.stringify(r.priv("p0"))), "ander ziet het woord niet");
  assert.equal(r.priv("p1").miniView.mine, "Geheimwoordje", "eigen woord wel (voor een herladen telefoon)");
  assert.deepEqual(r.priv("p0").miniView.submitted, ["p1"]);
  for (const p of pids) if (p !== "p1") assert.equal(miniAct(r, p, { t: "word", w: "Vuur" }), true);
  assert.ok(/Geheimwoordje/.test(JSON.stringify(r.priv("p0"))), "na de onthulling ziet iedereen alles");
  assert.ok(!/geheimwoordje/i.test(JSON.stringify(r.pub())), "maar niet via de publieke state");
  for (const p of pids) if (r.s.phase === "mini") assert.equal(miniAct(r, p, { t: "word", w: "haard" }), true);
  assert.equal(r.s.phase, "miniResult");
  assert.ok(JSON.stringify(r.s.miniResult.perPlayer.p1).includes("Geheimwoordje"), "na afloop staat het traject in perPlayer");
});

// ---------- Vertrekken ----------
test("speler vertrekt tijdens een lokale minigame: niet meer nodig, uitslag zonder hem; terugkomen = weer meedoen", () => {
  const r = room(3);
  r.start();
  while (r.s.phase !== "mini") { if (r.s.phase === "choice") r.active().forEach((p) => r.act(p, "vote", { option: 0 })); else r.readyAll(); }
  const m = r.s.mini;
  const res = localResult("blaasbalg", 2, 1, ["p0", "p2"]);
  assert.equal(r.act("p2", "mini", { k: "result", nonce: m.nonce, r: res }), true);
  assert.equal(r.act("p1", "leave"), true);
  assert.deepEqual([r.p("p1").left, r.p("p1").alive, r.s.phase], [true, false, "mini"]);
  assert.deepEqual(r.active(), ["p0", "p2"]);
  assert.equal(r.act("p1", "mini", { k: "result", nonce: m.nonce, r: res }), true, "alleen ack");
  assert.deepEqual(r.s.mini.submitted, ["p2"]);
  assert.equal(r.act("p0", "mini", { k: "result", nonce: m.nonce, r: res }), true);
  assert.equal(r.s.phase, "miniResult");
  assert.deepEqual([r.s.miniResult.pids, Object.keys(r.s.miniResult.perPlayer).sort(), r.s.miniResult.logs], [["p0", "p2"], ["p0", "p2"], 2]);
  // p1 komt terug: doet weer mee met ready
  assert.equal(r.act("p1", "join", { name: "Jacques" }), true);
  assert.deepEqual([r.p("p1").left, r.p("p1").alive, r.p("p1").spectator], [false, true, false]);
  assert.deepEqual(r.active(), ["p0", "p1", "p2"]);
  r.act("p0", "ready"); r.act("p2", "ready");
  assert.equal(r.s.phase, "miniResult", "wacht op de teruggekeerde p1");
  r.act("p1", "ready");
  assert.notEqual(r.s.phase, "miniResult");
  // vertrek als laatste ontbrekende → meteen klaar
  const r2 = room(2);
  r2.start();
  while (r2.s.phase !== "mini") { if (r2.s.phase === "choice") r2.active().forEach((p) => r2.act(p, "vote", { option: 0 })); else r2.readyAll(); }
  r2.act("p0", "mini", { k: "result", nonce: r2.s.mini.nonce, r: localResult("blaasbalg", 3, 1, ["p0"]) });
  assert.equal(r2.act("p1", "leave"), true);
  assert.deepEqual([r2.s.phase, r2.s.miniResult.pids, r2.s.miniResult.logs], ["miniResult", ["p0"], 3]);
  // en {B} blijft Jacques, {ALLEN} alleen de actieve spelers
  const pub = r2.pub();
  assert.equal(S.fill("{A} en {B}; {ALLEN}", pub, pub.players), "Loek en Jacques; Loek");
});

test("speler vertrekt tijdens ready/choice: eisen krimpen; kick = leave + removed; vertrek van een toeschouwer doet niks", () => {
  const r = room(3);
  r.start();
  r.act("p0", "ready"); r.act("p1", "ready");
  assert.equal(r.s.phase, "title");
  assert.equal(r.act("p0", "kick", { target: "p2" }), true);
  assert.deepEqual([r.s.phase, r.s.removed, r.p("p2").left], ["card", ["p2"], true]);
  assert.equal(r.act("p2", "join", {}), false, "removed → genegeerd");
  while (r.s.phase !== "choice") r.readyAll();
  r.act("p0", "vote", { option: 1 });
  r.join("p3");
  assert.equal(r.p("p3").spectator, true);
  assert.equal(r.act("p3", "vote", { option: 0 }), true);
  assert.deepEqual(r.s.voted, ["p0"], "toeschouwer stemt niet mee");
  assert.equal(r.act("p3", "leave"), true);
  assert.deepEqual([r.s.phase, r.p("p3").left], ["choice", true]);
  assert.equal(r.act("p1", "leave"), true);
  assert.deepEqual([r.s.phase, r.s.flags], ["fire", { belofte: "nee" }], "p1 weg → alleen p0's stem telt → unaniem");
});

test("net-minigame: vertrokken speler wordt door de bot afgemaakt (echo, slot, verhaal) — de kamer loopt nooit vast", () => {
  const toMini = (r, id) => { while (!(r.s.phase === "mini" && r.s.mini.id === id)) { if (r.s.phase === "choice") r.active().forEach((p) => r.act(p, "vote", { option: 0 })); else if (r.s.phase === "mini") playMini(r, "max"); else if (r.s.phase === "fail") r.act("p0", "retry"); else r.readyAll(); } };
  // echo: p1 vertrekt na zijn eerste woord; p0 blijft woorden typen; de bot van p1 doet mee tot het einde
  const r = room(2);
  r.start();
  toMini(r, "echo");
  assert.equal(miniAct(r, "p1", { t: "word", w: "kaars" }), true);
  assert.equal(r.act("p1", "leave"), true);
  assert.equal(r.s.phase, "mini");
  for (let i = 0; i < 12 && r.s.phase === "mini"; i++) {
    const sh = r.s.miniShared;
    if (sh.final) { assert.equal(miniAct(r, "p0", { t: "quit", on: true }), true); break; }
    assert.equal(miniAct(r, "p0", { t: "word", w: "woord" + i }), true);
  }
  assert.equal(r.s.phase, "miniResult", "echo afgerond zonder skip: " + JSON.stringify(r.s.miniShared));
  assert.deepEqual(r.s.miniResult.pids, ["p0"]);
  // slot: de slot-speler vertrekt → bot probeert tot hij klaar is (meteen bij het vertrek)
  const r2 = room(2);
  r2.start();
  toMini(r2, "slot");
  const slotPid = Object.keys(r2.s.mini.roles).find((p) => r2.s.mini.roles[p] === "slot");
  if (slotPid === "p0") {
    // host kan niet weg: dan de gids eruit, het slot speelt zelf verder (gids-bot doet niets)
    assert.equal(r2.act("p1", "leave"), true);
    assert.equal(r2.s.phase, "mini");
    playSlot(r2, 4);
    assert.deepEqual(r2.s.miniResult.pids, ["p0"]);
  } else {
    assert.equal(r2.act("p1", "leave"), true);
    assert.equal(r2.s.phase, "miniResult", "bot heeft de kist afgemaakt");
    assert.ok([-1, 1, 2, 3, 4].includes(r2.s.miniResult.logs));
    assert.deepEqual(r2.s.miniResult.pids, ["p0"]);
  }
  // verhaal met 3 spelers: de verteller vertrekt tijdens het vertellen → bot zegt klaar; luisteraar vertrekt tijdens het stemmen → bot stemt
  const r3 = room(3);
  r3.start();
  toMini(r3, "verhaal");
  const sh = r3.s.miniShared;
  const teller = sh.tellers[0];
  const leaver = teller === "p0" ? null : teller;
  if (leaver) {
    assert.equal(r3.act(leaver, "leave"), true);
    assert.equal(r3.s.miniShared.stage, "rate", "bot-verteller zei klaar");
    assert.equal(r3.s.miniShared.tellers[r3.s.miniShared.turn], leaver);
  }
  // iedereen die nog actief is stemt / vertelt tot het einde
  for (let guard = 0; guard < 60 && r3.s.phase === "mini"; guard++) {
    const s2 = r3.s.miniShared, t = s2.tellers[s2.turn];
    if (s2.stage === "tell") { assert.equal(miniAct(r3, t, { t: "klaar" }), true); continue; }
    const raters = s2.order.filter((p) => p !== t && r3.active().includes(p) && !Object.prototype.hasOwnProperty.call(s2.votes, p));
    for (const p of raters) { if (r3.s.phase !== "mini") break; assert.equal(miniAct(r3, p, { t: "rate", n: 3 }), true); }
  }
  assert.equal(r3.s.phase, "miniResult", "verhaal afgerond: " + JSON.stringify(r3.s.miniShared && r3.s.miniShared.stage));
  assert.ok(r3.s.miniResult.logs >= 1 && r3.s.miniResult.logs <= 3);
});

// ---------- Reconnect / zuiverheid ----------
test("reconnect-veilig: views zijn een pure functie van de state; een herladen telefoon ziet dat hij al klaar is", () => {
  const r = room(2);
  r.start();
  while (r.s.phase !== "mini") { if (r.s.phase === "choice") r.active().forEach((p) => r.act(p, "vote", { option: 0 })); else r.readyAll(); }
  r.act("p1", "mini", { k: "result", nonce: r.s.mini.nonce, r: localResult("blaasbalg", 3, 1, ["p0", "p1"]) });
  assert.equal(JSON.stringify(r.pub()), JSON.stringify(S.publicView(r.s)));
  assert.deepEqual(r.pub().mini.submitted, ["p1"]);
  const copy = JSON.parse(JSON.stringify(r.s)); // host herlaadt uit localStorage
  const next = S.reduce(copy, r.env("p0", "mini", { k: "result", nonce: r.s.mini.nonce, r: localResult("blaasbalg", 3, 1, ["p0", "p1"]) }), r.ctx());
  assert.equal(next.phase, "miniResult");
  assert.equal(next.miniResult.logs, 3);
});

test("seq/ack: duplicaat, gat, verkeerde key → zelfde referentie; ongeldige actie → alleen acks; acks lopen nooit terug", () => {
  const r = room(2);
  const prev = r.s;
  assert.equal(S.reduce(prev, r.env("p1", "profile", { name: "x" }, { seq: prev.acks.p1 }), r.ctx()), prev);
  assert.equal(S.reduce(prev, r.env("p1", "profile", { name: "x" }, { seq: prev.acks.p1 + 2 }), r.ctx()), prev);
  assert.equal(S.reduce(prev, r.env("p1", "profile", { name: "x" }, { key: "nope" }), r.ctx()), prev);
  assert.equal(S.reduce(prev, r.env("p9", "ready"), r.ctx()), prev, "onbekende pid, geen join");
  const ackOnly = S.reduce(prev, r.env("p1", "ready"), r.ctx());
  assert.notEqual(ackOnly, prev);
  assert.equal(ackOnly.acks.p1, prev.acks.p1 + 1);
  assert.equal(ackOnly.updatedAt, prev.updatedAt, "alleen-ack laat updatedAt staan");
  const strip = (s) => { const c = JSON.parse(JSON.stringify(s)); delete c.acks; return c; };
  assert.deepEqual(strip(ackOnly), strip(prev));
  const closed = Object.assign({}, prev, { phase: "closed" });
  assert.equal(S.reduce(closed, r.env("p1", "profile", { name: "x" }), r.ctx()), closed);
  let acks = Object.assign({}, r.s.acks);
  for (let i = 0; i < 50; i++) {
    const pid = i % 2 ? "p1" : "p0";
    r.act(pid, ["ready", "vote", "mini", "next", "bogus", "profile"][i % 6], { option: 0, k: "result", nonce: 1, name: "n" + i });
    for (const p of Object.keys(acks)) assert.ok(r.s.acks[p] >= acks[p]);
    acks = Object.assign({}, r.s.acks);
  }
});

test("engine gebruikt geen Math.random / Date.now en muteert nooit", () => {
  const fs = require("node:fs");
  const code = ["story-engine", "room", "arcade"].map((f) => fs.readFileSync(require.resolve("../online/" + f + ".js"), "utf8")).join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // zonder commentaar
  assert.ok(!/Math\.random|Date\.now|document\.|window\./.test(code), "geen Math.random/Date.now/DOM in de engines");
  // dezelfde invoer (seed) geeft dezelfde run
  const runOnce = () => { const r = room(2, { seed: 77 }); r.start(); play(r, { choices: choiceIdx({ belofte: "ja", bijl: "grote", kleed: "deur", kist: "hout", mist: "dicht", aanbod: "nee", fles: "nu" }), minis: () => "bot" }); return JSON.stringify(r.pub()); };
  assert.equal(runOnce(), runOnce());
});

// ---------- fill ----------
test("fill: {A} {B} {ALLEN} {X} {MVP} {VUUR}; fallbacks; toeschouwers tellen niet, vertrokken spelers houden hun plek", () => {
  const players = [
    { pid: "p0", name: "Loek", spectator: false, left: false }, { pid: "p1", name: "Jacques", spectator: false, left: false },
    { pid: "p2", name: "Sanne", spectator: false, left: false }, { pid: "p3", name: "Kijker", spectator: true, left: false },
  ];
  const st = { x: "p2", mvp: "p1", fire: 7, players };
  assert.equal(S.fill("{A}, {B} en {X}: {ALLEN} ({MVP}, {VUUR})", st), "Loek, Jacques en Sanne: Loek, Jacques en Sanne (Jacques, 7)");
  assert.equal(S.fill("{ALLEN}", { fire: 1 }, players.slice(0, 2)), "Loek en Jacques");
  assert.equal(S.fill("{MVP} / {X} / {B}", { x: null, mvp: null, fire: 0 }, players.slice(0, 1)), "iemand / Loek / iemand");
  assert.equal(S.fill("{ALLEN}", {}, []), "iedereen");
  assert.equal(S.fill(null, st), "");
  assert.equal(S.fill("geen placeholders {ONBEKEND}", st), "geen placeholders {ONBEKEND}");
  const left = players.map((p) => (p.pid === "p0" ? Object.assign({}, p, { left: true }) : p));
  assert.equal(S.fill("{A}|{B}|{ALLEN}", { x: "p0", mvp: "p9", fire: 3 }, left), "Loek|Jacques|Jacques en Sanne");
  // elke regel uit het script komt zonder accolades uit de vulling
  const pub = { x: "p0", mvp: "p1", fire: 5, players: players.slice(0, 2) };
  for (const ch of story.chapters) for (const s of ch.steps) for (const l of s.lines || []) assert.ok(!/\{/.test(S.fill(l.text, pub)), l.text);
});

// ---------- Simulatie ----------
test("simulatie: 200 willekeurige runs (2–4 spelers, alle moeilijkheden, bots, vertrek, kick, skip, rommel) eindigen altijd", { timeout: 120000 }, () => {
  const endings = {};
  let fails = 0, flips = 0, leaves = 0, kicks = 0, skips = 0, proxied = 0, totalReduces = 0;
  for (let run = 0; run < 200; run++) {
    const seed = 1000 + run;
    const rnd = DVMini.rng(seed * 7919);
    const n = 2 + Math.floor(rnd() * 3);
    const difficulty = ["chill", "normaal", "pittig"][run % 3];
    const r = room(n, { seed, settings: { difficulty } });
    assert.equal(r.s.settings.difficulty, difficulty);
    r.start();
    const check = () => {
      const s = r.s;
      assert.ok(s.fire >= 0 && s.fire <= s.maxFire, "vuur binnen bereik");
      if (s.phase === "fail") assert.equal(s.fire, 0);
      const pj = JSON.stringify(S.publicView(s));
      assert.ok(!pj.includes("-secret") && !pj.includes("GEHEIM-"), "geen keys/resultaten in publicView");
      if (s.mini) assert.ok(s.mini.pids.every((p) => s.players.some((x) => x.pid === p)));
    };
    let steps = 0, extra = 0;
    const seen = new Set();
    while (r.s.phase !== "ending" && steps < 1500) {
      steps++;
      const s = r.s;
      check();
      // af en toe rommel: moet genegeerd of alleen-geackt worden, nooit crashen
      if (rnd() < 0.05) {
        const pid = r.active()[0];
        const prev = r.s;
        assert.equal(S.reduce(prev, r.env(pid, "ready", {}, { seq: prev.acks[pid] }), r.ctx()), prev);
        assert.equal(S.reduce(prev, r.env(pid, "ready", {}, { key: "x" }), r.ctx()), prev);
        r.act(pid, ["bogus", "start", "retry", "skipMini", "settings", "vote", "mini"][Math.floor(rnd() * 7)], { option: 9, k: "act", nonce: -1, a: { t: "go" }, difficulty: "pittig" });
      }
      // na vier keer uit: alleen nog topresultaten (dan geen vertrek meer midden in een minigame, anders speelt een bot mee)
      const useMax = r.s.runStats.fails >= 4;
      // af en toe iemand erbij (toeschouwer), weg of terug; soms een kick
      if (rnd() < 0.03 && extra < 2) { extra++; r.join("p" + (n + extra)); assert.equal(r.p("p" + (n + extra)).spectator, true); }
      if (rnd() < 0.03 && !useMax) {
        const cands = r.active().filter((p) => p !== "p0");
        if (cands.length) {
          const pid = cands[Math.floor(rnd() * cands.length)];
          if (r.s.phase === "mini" && r.s.mini.kind === "net") proxied++;
          if (rnd() < 0.25) { kicks++; r.act("p0", "kick", { target: pid }); assert.ok(r.s.removed.includes(pid)); }
          else { leaves++; r.act(pid, "leave"); assert.equal(r.p(pid).left, true); }
          check();
          continue;
        }
      }
      if (rnd() < 0.02) {
        const back = r.s.players.filter((p) => p.left && !r.s.removed.includes(p.pid));
        if (back.length) { r.act(back[0].pid, "join", { name: "Terug" }); assert.equal(r.p(back[0].pid).left, false); }
      }
      const ph = r.s.phase;
      if (S.READY_PHASES.includes(ph)) {
        if (ph === "flip") flips++;
        if (rnd() < 0.2) r.act("p0", "next"); else r.readyAll();
      } else if (ph === "choice") {
        const st = curStep(r.s), key = phaseKey(r.s);
        for (const pid of r.active()) { if (phaseKey(r.s) !== key) break; if (rnd() < 0.15 && Object.keys(r.s.votes).length) { r.act("p0", "next"); break; } r.act(pid, "vote", { option: Math.floor(rnd() * st.options.length) }); }
      } else if (ph === "mini") {
        const m = r.s.mini, def = DVMini.get(m.id);
        const key = m.nonce + "|" + r.s.runNo;
        if (seen.has(key)) { skips++; r.act("p0", "skipMini"); continue; } // tweede keer in dezelfde mini: nooit vastlopen
        seen.add(key);
        if (def.kind === "local") {
          const pids = m.pids.filter((p) => r.active().includes(p));
          for (const pid of pids) {
            if (r.s.phase !== "mini") break;
            if (!useMax && rnd() < 0.04) { skips++; r.act("p0", "skipMini"); break; }
            const res = useMax ? localResult(m.id, MAXLOGS[m.id], m.difficulty, pids) : rnd() < 0.1 ? null : def.bot(DVMini.rng(seed + pid.length), m.difficulty);
            r.act(pid, "mini", { k: "result", nonce: m.nonce, r: res });
          }
        } else if (useMax) {
          playMini(r, "max");
        } else {
          for (let g = 0; g < 400 && r.s.phase === "mini"; g++) {
            let moved = false;
            for (const pid of m.pids.filter((p) => r.active().includes(p))) {
              const a = def.bot(def.view(r.s.miniShared, pid), rnd);
              if (a && r.act(pid, "mini", { k: "act", nonce: m.nonce, a })) { moved = true; if (r.s.phase !== "mini") break; }
            }
            if (!moved) { skips++; r.act("p0", "skipMini"); }
          }
        }
        if (r.s.phase === "miniResult") {
          const mr = r.s.miniResult;
          assert.ok(Number.isInteger(mr.logs) && mr.logs >= -2 && mr.logs <= 4);
          assert.ok(["win", "meh", "lose"].includes(mr.verdict));
          assert.ok(mr.pids.every((p) => Object.prototype.hasOwnProperty.call(mr.perPlayer, p) && typeof mr.perPlayer[p] === "string"));
          assert.ok(mr.mvp === null || mr.pids.includes(mr.mvp));
          assert.equal(mr.fireAfter, r.s.fire);
          assert.equal(mr.fireAfter, Math.max(0, Math.min(r.s.maxFire, mr.fireBefore + mr.logs)));
        }
      } else if (ph === "fail") {
        fails++;
        assert.ok(r.s.checkpoint && r.s.checkpoint.fire >= 3);
        r.act("p0", "retry");
        assert.equal(r.s.phase, "card");
      } else throw new Error("onbekende fase " + ph);
    }
    assert.equal(r.s.phase, "ending", "run " + run + " eindigt (" + r.s.phase + ", hoofdstuk " + r.s.chapter + ")");
    endings[r.s.ending.id] = (endings[r.s.ending.id] || 0) + 1;
    assert.equal(r.s.stats.story.finished, 1);
    assert.equal(r.s.stats.story.endings[r.s.ending.id], 1);
    assert.equal(r.s.stats.story.bestEnding, r.s.ending.id);
    assert.equal(r.s.runStats.minis.length >= 7, true);
    totalReduces += r.reduces;
    // iedereen die nog meedoet mag terug naar de lobby: toeschouwers worden spelers, vertrokken spelers verdwijnen
    r.act("p0", "next");
    assert.equal(r.s.phase, "lobby");
    assert.ok(r.s.players.every((p) => !p.left && !p.spectator && p.alive));
  }
  assert.ok(Object.keys(endings).length >= 3, "verschillende eindes: " + JSON.stringify(endings));
  assert.ok(fails > 0 && flips > 0 && leaves > 0 && kicks > 0 && skips > 0, JSON.stringify({ fails, flips, leaves, kicks, skips, proxied }));
  assert.ok(totalReduces > 200 * 60);
});

// ---------- Carry ----------
test("carry: lobby-wissel vanuit DVInfiltrant houdt spelers/acks/keys/scores; terug naar Infiltrant met stats behouden", () => {
  const rng = DVMini.rng(3);
  const key = (pid) => keyOf(pid);
  let e = E.createState({ code: "BAKO", host: { pid: "p0", key: key("p0"), name: "Loek" }, now: 1 });
  e = E.reduce(e, { pid: "p1", key: key("p1"), seq: 4, t: "join", d: { name: "Jacques" } }, { rng, now: 2 });
  e = Object.assign({}, e, { scores: { p0: 2, p1: 4 } });
  const s = S.createState({ code: "BAKO", host: { pid: "p0", key: key("p0") }, carry: R.carryFrom(e), now: 3 });
  assert.deepEqual([s.players.map((p) => p.name), s.acks, s.scores, s.keys], [["Loek", "Jacques"], { p0: 0, p1: 4 }, { p0: 2, p1: 4 }, { p0: key("p0"), p1: key("p1") }]);
  const r = { s };
  const ctx = () => ({ rng, now: 10, story, minis: DVMini });
  r.s = S.reduce(r.s, { pid: "p1", key: key("p1"), seq: 5, t: "profile", d: { name: "Jacq" } }, ctx());
  assert.equal(r.s.players[1].name, "Jacq");
  r.s = S.reduce(r.s, { pid: "p0", key: key("p0"), seq: 1, t: "start", d: {} }, ctx());
  assert.equal(r.s.phase, "title");
  const back = E.createState({ code: "BAKO", host: { pid: "p0", key: key("p0") }, now: 20 });
  void back;
  const c2 = R.carryFrom(Object.assign({}, r.s, { stats: { story: { runs: 9 } } }));
  assert.deepEqual([c2.acks, c2.stats.story.runs, c2.fire], [{ p0: 1, p1: 5 }, 9, r.s.fire]);
});
