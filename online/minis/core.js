// DVMini — registry + runner voor minigames (verhaalmodus "Vuurwacht" en de arcade).
//
// Een minigame registreert zich met DVMini.register(def). Twee soorten:
//
// kind: "local"  — iedere telefoon speelt zelf (timing/reactie/tikken), alleen het eindresultaat gaat over het netwerk.
//   def = { id, title, icon, kind: "local", duration, howto,
//           mount(el, ctx) -> { destroy() },          // ctx.done(result) precies één keer aanroepen
//           score(results, info) -> { logs, lines, mvp?, perPlayer? },
//           bot(rng, difficulty) -> result }           // geloofwaardig resultaat voor tests / afwezige spelers
//
// kind: "net"    — gedeelde toestand die de host bijhoudt (puzzels, woordrondes).
//   def = { id, title, icon, kind: "net", howto,
//           init({ seed, rng, difficulty, players, roles }) -> shared,
//           reduce(shared, pid, action, { rng, now }) -> shared   // puur; zelfde referentie = genegeerd
//           view(shared, pid) -> object                            // wat déze speler mag zien (mag geheimen bevatten)
//           result(shared) -> result | null                       // niet-null = klaar
//           score(result, info) -> { logs, lines, mvp?, perPlayer? },
//           mount(el, ctx) -> { update(view), destroy() },         // ctx.send(action) stuurt een actie naar de host
//           roles?(players, rng) -> { [pid]: role },               // optioneel: rollen (bv. "slot"/"gids"), host roept dit aan
//           bot?(view, rng) -> action | null }
//
// ctx (beide soorten): { seed, rng, difficulty (1..3), me, players, role, sfx: { beep, fanfare, buzz, confetti },
//                        fire: window.DVFire || null, done(result) (local), send(action) + view (net) }
// info (score): { difficulty, players }
// score().logs is een geheel getal in [-2, 4]: hoeveel blokken er op het vuur gaan (negatief = vuur zakt).
//
// De runner (DVMini.runner) koppelt dit aan de room-UI: hij mount een minigame één keer per `nonce`, stuurt
// resultaten/acties via send(...) en ververst net-minigames met de nieuwste privé-view.
// Testhaak: met ?test in de URL kan DVMini.testFinish(result?) een lokale minigame direct laten eindigen.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DVMini = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const registry = Object.create(null);

  function register(def) {
    if (!def || !def.id || !def.kind) throw new Error("DVMini.register: id en kind zijn verplicht");
    registry[def.id] = def;
    return def;
  }
  const get = (id) => registry[id] || null;
  const list = () => Object.values(registry);

  // Deterministische PRNG (mulberry32) zodat host en telefoons hetzelfde patroon kunnen genereren.
  function rng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clampLogs = (n) => Math.max(-2, Math.min(4, Math.round(Number(n) || 0)));

  // Groot "3 · 2 · 1 · VUUR!" aftellen bovenop een element. Resolvet als het spel mag beginnen.
  function countdown(el, { from = 3, go = "VUUR!", sfx } = {}) {
    return new Promise((resolve) => {
      if (typeof document === "undefined") return resolve();
      const o = document.createElement("div");
      o.className = "mini-countdown";
      el.appendChild(o);
      let n = from;
      const tick = () => {
        o.textContent = n > 0 ? String(n) : go;
        o.classList.remove("pop"); void o.offsetWidth; o.classList.add("pop");
        if (sfx && sfx.beep) sfx.beep(n > 0 ? 520 : 880, n > 0 ? 0.08 : 0.18, "triangle", 0.1);
        if (n-- <= 0) { setTimeout(() => { o.remove(); resolve(); }, 450); return; }
        setTimeout(tick, 700);
      };
      tick();
    });
  }

  function sfxFromDVA() {
    const D = (typeof window !== "undefined" && window.DVA) || {};
    const noop = () => {};
    return { beep: D.beep || noop, fanfare: D.fanfare || noop, buzz: D.buzz || noop, confetti: D.confetti || noop };
  }

  const testMode = () => typeof location !== "undefined" && /[?&]test\b/.test(location.search);

  // ---------- Runner ----------
  // const r = DVMini.runner(container, { send })
  // r.sync({ mini, view, me, players })   // aanroepen bij elke nieuwe public/private state
  //   mini = { id, nonce, seed, difficulty, roles?: {pid: role}, submitted?: [pid] } | null
  //   view = privé-view voor net-minigames (uit privateView) | undefined
  // r.destroy()
  let active = null; // { def, nonce, inst, done, finished }

  function runner(container, { send }) {
    let cur = null;

    function unmount() {
      if (cur && cur.inst && cur.inst.destroy) { try { cur.inst.destroy(); } catch (e) { console.error(e); } }
      if (cur && active === cur) active = null;
      cur = null;
      container.textContent = "";
    }

    function sync({ mini, view, me, players }) {
      if (!mini) { unmount(); return; }
      const def = get(mini.id);
      if (!def) { unmount(); container.textContent = "Onbekende minigame: " + mini.id; return; }
      if (cur && cur.nonce === mini.nonce) {
        if (def.kind === "net" && view !== undefined && cur.inst && cur.inst.update) cur.inst.update(view);
        return;
      }
      unmount();
      const seed = mini.seed >>> 0;
      const role = (mini.roles && me && mini.roles[me.pid]) || null;
      const state = { def, nonce: mini.nonce, inst: null, finished: false };
      const ctx = {
        seed, rng: rng(seed ^ hash(me ? me.pid : "")), sharedRng: rng(seed),
        difficulty: mini.difficulty || 1, me, players: players || [], role,
        sfx: sfxFromDVA(), fire: (typeof window !== "undefined" && window.DVFire) || null,
        countdown: (el, o) => countdown(el, Object.assign({ sfx: ctx.sfx }, o)),
      };
      if (def.kind === "local") {
        ctx.done = (result) => {
          if (state.finished || cur !== state) return;
          state.finished = true;
          send({ k: "result", nonce: mini.nonce, r: result === undefined ? null : result });
        };
      } else {
        ctx.view = view;
        ctx.send = (action) => { if (cur === state) send({ k: "act", nonce: mini.nonce, a: action }); };
      }
      cur = state;
      active = state;
      state.ctx = ctx;
      const alreadyIn = mini.submitted && me && mini.submitted.includes(me.pid);
      if (def.kind === "local" && alreadyIn) {
        state.finished = true;
        const w = document.createElement("div");
        w.className = "mini-waiting";
        w.textContent = "Klaar! Even wachten op de rest…";
        container.appendChild(w);
        return;
      }
      try { state.inst = def.mount(container, ctx) || {}; }
      catch (e) { console.error(e); container.textContent = "Minigame kon niet starten."; }
    }

    return { sync, destroy: unmount, get nonce() { return cur ? cur.nonce : null; } };
  }

  // Testhaak: laat de actieve lokale minigame meteen eindigen.
  function testFinish(result) {
    if (!active || active.def.kind !== "local" || active.finished) return false;
    const r = result !== undefined ? result : (active.def.bot ? active.def.bot(active.ctx.rng, active.ctx.difficulty) : null);
    active.ctx.done(r);
    return true;
  }

  function hash(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }

  return { register, get, list, rng, hash, clampLogs, countdown, runner, testFinish, testMode, get active() { return active; } };
});
