// DVStoryUI — Vuurwacht: de filmische kamer-UI van de verhaalmodus (SPEC-3 §6). Alleen browser.
//
//   DVStoryUI.render(root, { pub, priv, me, players, api })
//     Aanroepen bij elke nieuwe state. Idempotent: de DOM blijft staan zolang dezelfde stap getoond wordt (animaties,
//     typemachine en het vuur lopen door); pas bij een andere fase/stap/nonce wordt de view opnieuw opgebouwd.
//     pub      publieke state van DVStory (§3): phase, chapter, step, fire, maxFire, flags, ready, voted, flip, mini,
//              miniResult, ending, checkpoint, runStats, x, hostPid, players…
//     priv     privé-payload ({ miniView } voor net-minigames) | null
//     me       { pid, isHost }                players  [{ pid, name, avatar, color, left, spectator }]
//     api      { send(t, d) } — acties: ready, vote {option}, mini {k,nonce,r|a}, next, retry, skipMini
//   DVStoryUI.destroy(root)     ruimt canvassen/timers op.
//   DVStoryUI.fill(text, ctx)   placeholders {A} {B} {ALLEN} {X} {MVP} {VUUR} (gebruikt DVStory.fill als die bestaat).
//   DVStoryUI.shell / .parts    gedeelde bouwstenen voor online/arcade-ui.js (zelfde HUD, podium en uitslagblokken).
//
// Vormgeving staat in online/story.css (prefix sv-). Namen en spelerstekst altijd via textContent.
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // =========================================================
  // Hulpjes
  // =========================================================
  const DVA = () => window.DVA || {};
  const sfx = {
    beep(...a) { try { DVA().beep && DVA().beep(...a); } catch (e) { /* geen geluid */ } },
    // Trillen mag pas na een tik van de gebruiker (anders meldt Chrome een fout in de console)
    buzz(p) { try { if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; DVA().buzz && DVA().buzz(p); } catch (e) { /* geen tril */ } },
    fanfare() { try { DVA().fanfare && DVA().fanfare(); } catch (e) { /* */ } },
    confetti(c, n) { try { DVA().confetti && DVA().confetti(c, n); } catch (e) { /* */ } },
  };
  const FIRE_COLORS = ["#ff6a1a", "#ffc247", "#e8401c", "#ffe7b8", "#ff8a2a", "#fff3d0"];
  const reduced = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const rnd = Math.random;

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style") for (const s of Object.keys(v)) el.style.setProperty(s, v[s]);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const c of kids.flat(Infinity)) if (c != null && c !== false && c !== "") el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k of Object.keys(attrs || {})) el.setAttribute(k, attrs[k]);
    kids.forEach((k) => k && el.append(k));
    return el;
  }
  // Lijst bijwerken op sleutel: bestaande elementen blijven staan (geen herhaalde animaties).
  function keyed(box, items, keyOf, make, update) {
    const old = new Map();
    for (const c of [...box.children]) if (c.dataset.k != null) old.set(c.dataset.k, c);
    let prev = null;
    items.forEach((it, i) => {
      const k = String(keyOf(it, i));
      let el = old.get(k);
      if (el) old.delete(k);
      else { el = make(it, i); el.dataset.k = k; }
      if (update) update(el, it, i);
      const want = prev ? prev.nextSibling : box.firstChild;
      if (el !== want) box.insertBefore(el, want);
      prev = el;
    });
    old.forEach((el) => el.remove());
  }
  function avatar(p, size) {
    return h("span", { class: "o-av o-av-" + (size || "md"), style: { "--pc": (p && p.color) || "#8a5a36" }, "aria-hidden": "true" },
      h("span", { class: "o-av-e", text: (p && p.avatar) || "🙂" }));
  }
  // Timers per view, zodat destroy() alles netjes stopt.
  function timers() {
    const set = new Set();
    let dead = false;
    return {
      later(fn, ms) { if (dead) return 0; const id = setTimeout(() => { set.delete(id); if (!dead) fn(); }, ms); set.add(id); return id; },
      every(fn, ms) { if (dead) return 0; const id = setInterval(() => { if (!dead) fn(); }, ms); set.add(id); return id; },
      clear() { dead = true; set.forEach((id) => { clearTimeout(id); clearInterval(id); }); set.clear(); },
      get dead() { return dead; },
    };
  }
  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };
  const listNames = (names) => names.length <= 1 ? (names[0] || "") : names.slice(0, -1).join(", ") + " en " + names[names.length - 1];

  // =========================================================
  // Verhaal: context, placeholders, sprekers
  // =========================================================
  const story = () => window.DV_STORY || null;
  const CAST = { gloei: { name: "Gloei", color: "#ffc247" }, vorst: { name: "De Vorst", color: "#9fd3ff" }, verteller: { name: "" } };
  const cast = (who) => { const s = story(); return (s && s.cast && s.cast[who]) || CAST[who] || { name: who, color: "#b8a99a" }; };

  function ctxOf(data) {
    data = data || {};
    const pub = data.pub || {};
    const players = Array.isArray(data.players) ? data.players : Array.isArray(pub.players) ? pub.players : [];
    const me = data.me || {};
    const pid = me.pid != null ? me.pid : null;
    const isHost = me.isHost != null ? !!me.isHost : pub.hostPid != null && pub.hostPid === pid;
    const active = players.filter((p) => p && !p.left && !p.spectator);
    const st = story();
    const chapter = (st && st.chapters && st.chapters[pub.chapter]) || null;
    const step = (chapter && chapter.steps && chapter.steps[pub.step]) || null;
    const api = data.api && typeof data.api.send === "function" ? data.api : { send() {} };
    const P = (id) => players.find((p) => p && p.pid === id) || null;
    // debug (alleen de preview-pagina): { instant: true, line: n } — animaties overslaan / bij een regel beginnen
    return { pub, priv: data.priv || null, me: { pid, isHost }, players, active, api, story: st, chapter, step, P, debug: data.debug || null,
      send(t, d) { try { api.send(t, d || {}); } catch (e) { console.error(e); } } };
  }

  const PLACEHOLDER = /\{(A|B|ALLEN|X|MVP|VUUR)\}/g;
  function fill(text, c) {
    if (typeof text !== "string") return "";
    const DS = window.DVStory;
    if (DS && typeof DS.fill === "function") {
      try {
        const r = DS.fill(text, c.pub, c.players);
        if (typeof r === "string" && !PLACEHOLDER.test(r)) { PLACEHOLDER.lastIndex = 0; return r; }
      } catch (e) { /* lokale invulling hieronder */ }
      PLACEHOLDER.lastIndex = 0;
    }
    const names = (c.active && c.active.length ? c.active : c.players) || [];
    const nm = (i) => (names[i] && names[i].name) || (i ? "jij daar" : "jij");
    const byPid = (id) => { const p = id != null && c.P ? c.P(id) : null; return p ? p.name : null; };
    const allen = names.length ? listNames(names.map((p) => p.name)) : "jullie";
    return text.replace(PLACEHOLDER, (m, k) => {
      switch (k) {
        case "A": return nm(0);
        case "B": return nm(1);
        case "ALLEN": return allen;
        case "X": return byPid(c.pub.x) || nm(0);
        case "MVP": return byPid(c.pub.miniResult && c.pub.miniResult.mvp) || byPid(c.pub.x) || nm(0);
        case "VUUR": return String(c.pub.fire != null ? c.pub.fire : "");
        default: return m;
      }
    });
  }

  // who → { kind: "gloei"|"vorst"|"narr"|"player", name, color, player }
  function speaker(who, c) {
    if (who === "gloei" || who === "vorst") { const k = cast(who); return { kind: who, name: k.name, color: k.color }; }
    if (who === "A" || who === "B") {
      const i = who === "A" ? 0 : 1, names = c.active.length ? c.active : c.players, p = names[i];
      if (p) return { kind: "player", name: p.name, color: p.color || "#8a5a36", player: p };
      return { kind: "player", name: i ? "De ander" : "Jij", color: "#b8a99a", player: null };
    }
    return { kind: "narr", name: "", color: "#b8a99a" };
  }
  // 20:00 → 0 … 06:00 → 1
  function nightProgress(time) {
    const m = /^(\d{1,2})(?::(\d{2}))?/.exec(String(time || ""));
    if (!m) return 0;
    let d = (+m[1] + (+m[2] || 0) / 60) - 20;
    if (d < 0) d += 24;
    return clamp(d / 10, 0, 1);
  }
  function moodNear(chapter, idx) {
    if (!chapter || !chapter.steps) return "warm";
    for (let i = Math.min(idx, chapter.steps.length - 1); i >= 0; i--) { const s = chapter.steps[i]; if (s && s.type === "scene" && s.mood) return s.mood; }
    for (const s of chapter.steps) if (s && s.type === "scene" && s.mood) return s.mood;
    return "warm";
  }
  function endingOf(c) {
    const e = c.pub.ending, st = c.story;
    if (!e) return null;
    if (typeof e === "object") { if (Array.isArray(e.lines)) return e; const f = st && st.endings.find((x) => x.id === e.id); return f || e; }
    return (st && st.endings.find((x) => x.id === e)) || null;
  }
  const endingId = (c) => { const e = endingOf(c); return e ? e.id || e.title : String(c.pub.ending || ""); };
  const miniDef = (id) => (window.DVMini && id ? window.DVMini.get(id) : null);

  // =========================================================
  // Typemachine met knetter-tikjes
  // =========================================================
  function crackle(kind) {
    const r = rnd();
    if (kind === "gloei") sfx.beep(1300 + r * 900, 0.018, "square", 0.016);
    else if (kind === "vorst") sfx.beep(2500 + r * 900, 0.02, "sine", 0.02);
    else sfx.beep(750 + r * 400, 0.014, "triangle", 0.012);
  }
  function typewriter(el, text, { speed = 40, tick, done, instant } = {}) {
    const node = document.createTextNode("");
    const caret = h("span", { class: "sv-caret", "aria-hidden": "true" });
    el.replaceChildren(node, caret);
    let n = 0, alive = true, timer = 0;
    const finish = () => { if (!alive) return; alive = false; clearTimeout(timer); node.data = text; caret.remove(); done && done(); };
    if (instant || reduced() || !text) { finish(); return { finish, cancel() {}, get active() { return false; } }; }
    const step = () => {
      if (!alive) return;
      n++;
      node.data = text.slice(0, n);
      const ch = text[n - 1];
      if (tick && n % 2 === 0 && ch !== " ") tick(n);
      if (n >= text.length) { finish(); return; }
      let delay = 1000 / speed;
      if (/[.!?…]/.test(ch)) delay += 240; else if (/[,;:]/.test(ch)) delay += 110;
      delay *= 0.7 + rnd() * 0.6;
      timer = setTimeout(step, delay);
    };
    timer = setTimeout(step, 90);
    return { finish, cancel() { alive = false; clearTimeout(timer); caret.remove(); }, get active() { return alive; } };
  }

  // =========================================================
  // Lagen: sfeer, sneeuw, mist, rijp, HUD, haard
  // =========================================================
  const MOODS = ["warm", "tense", "spooky", "cold", "dawn"];
  function buildBg() {
    const el = h("div", { class: "sv-bg", "aria-hidden": "true" }, MOODS.map((m) => h("i", { class: "m-" + m })));
    return { el, set(mood) { for (const i of el.children) i.classList.toggle("on", i.className.includes("m-" + mood)); } };
  }
  function buildSnow() {
    const el = h("div", { class: "sv-snow", "aria-hidden": "true" });
    for (let i = 0; i < 16; i++) {
      el.append(h("i", { style: { "--x": (rnd() * 100).toFixed(1) + "%", "--s": (2 + rnd() * 2.5).toFixed(1) + "px", "--d": (9 + rnd() * 8).toFixed(1) + "s",
        "--dl": (-rnd() * 16).toFixed(1) + "s", "--dx": ((rnd() - 0.5) * 70).toFixed(0) + "px" } }));
    }
    return el;
  }
  // IJskristal: varens die vanuit de hoek naar binnen groeien (stroke-dashoffset tekent ze in).
  function iceSvg() {
    const paths = [];
    const stem = (ang, L) => {
      const a = (ang * Math.PI) / 180, ex = Math.cos(a) * L, ey = Math.sin(a) * L;
      paths.push(`M0 0 L${ex.toFixed(1)} ${ey.toFixed(1)}`);
      for (let d = 12, k = 0; d < L - 6; d += 11, k++) {
        const bx = Math.cos(a) * d, by = Math.sin(a) * d, bl = Math.max(4, 15 - k * 2.2), side = k % 2 ? 1 : -1;
        const ba = a + side * 0.95;
        paths.push(`M${bx.toFixed(1)} ${by.toFixed(1)} L${(bx + Math.cos(ba) * bl).toFixed(1)} ${(by + Math.sin(ba) * bl).toFixed(1)}`);
        if (bl > 9) {
          const mx = bx + Math.cos(ba) * bl * 0.55, my = by + Math.sin(ba) * bl * 0.55, sa = ba + side * 0.8, sl = bl * 0.4;
          paths.push(`M${mx.toFixed(1)} ${my.toFixed(1)} L${(mx + Math.cos(sa) * sl).toFixed(1)} ${(my + Math.sin(sa) * sl).toFixed(1)}`);
        }
      }
    };
    stem(14, 66); stem(45, 74); stem(76, 66);
    return sv("svg", { viewBox: "0 0 100 100", "aria-hidden": "true" }, ...paths.map((d) => sv("path", { d, pathLength: "1" })));
  }
  function buildFrost() {
    const ice = (cls) => h("div", { class: "sv-ice " + cls }, iceSvg());
    const el = h("div", { class: "sv-frost", "aria-hidden": "true" }, h("div", { class: "sv-frost-vig" }), ice("tl"), ice("tr"), ice("bl"), ice("br"));
    const fog = h("div", { class: "sv-fog", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
    let mode = "off";
    return { el, fog, set(m) { if (m === mode) return; mode = m; el.classList.toggle("on", m === "on"); el.classList.toggle("full", m === "full"); } };
  }

  // HUD: nachtboog met maan → zon, tijd, vuurmeter (10 blokken + klein levend vlammetje)
  let gradSeq = 0;
  function buildHud() {
    const gid = "svArcGrad" + (++gradSeq);
    const P0 = [18, 42], P1 = [150, -30], P2 = [282, 42];
    const bez = (t) => [(1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]];
    const d = `M${P0[0]} ${P0[1]} Q${P1[0]} ${P1[1]} ${P2[0]} ${P2[1]}`;
    const lit = sv("path", { d, class: "arc-lit", pathLength: "1", style: `stroke: url(#${gid}); stroke-dasharray: 1; stroke-dashoffset: 1` });
    const moon = sv("g", { class: "body moon-g" }, sv("circle", { r: 7, class: "moon" }), sv("circle", { r: 5.6, cx: 3.2, cy: -2.2, class: "moon-shadow" }));
    const sun = sv("g", { class: "body sun-g", style: "opacity:0" }, sv("circle", { r: 8, class: "sun" }));
    const svg = sv("svg", { viewBox: "0 0 300 46", preserveAspectRatio: "xMidYMid meet", "aria-hidden": "true" },
      sv("defs", null, sv("linearGradient", { id: gid, x1: "0", y1: "0", x2: "1", y2: "0" },
        sv("stop", { offset: "0", "stop-color": "#9fd3ff" }), sv("stop", { offset: "0.55", "stop-color": "#ffc247" }), sv("stop", { offset: "1", "stop-color": "#ff6a1a" }))),
      sv("path", { d, class: "arc" }), lit,
      sv("text", { x: 18, y: 31, "text-anchor": "middle", class: "tick" }, document.createTextNode("20:00")),
      sv("text", { x: 282, y: 31, "text-anchor": "middle", class: "tick" }, document.createTextNode("06:00")),
      moon, sun);
    const time = h("div", { class: "sv-time", text: "20:00" });
    const sky = h("div", { class: "sv-sky" }, svg, time);
    const flame = h("canvas", { class: "sv-flame", "aria-hidden": "true" });
    const logs = h("div", { class: "sv-logs", role: "img" });
    const logEls = [];
    for (let i = 0; i < 10; i++) { const l = h("i", { class: "sv-log ash", style: { "--i": i } }); logEls.push(l); logs.append(l); }
    const nB = h("b", { text: "0" });
    const count = h("div", { class: "sv-fire-n" }, nB, " / 10");
    const row = h("div", { class: "sv-firerow" }, logs, count);
    const el = h("div", { class: "sv-hud", role: "status" }, flame, sky, row);
    let fire = null, shownFire = -1, maxFire = 10, prog = -1, override = null;
    const ensureFire = () => { if (!fire && window.DVFire && flame.isConnected) fire = window.DVFire.flame(flame, { intensity: 0.4, logs: false, embers: true, blueTips: true }); return fire; };
    function paint(n) {
      logs.setAttribute("aria-label", `Vuur: ${n} van ${maxFire} blokken`);
      for (let i = 0; i < 10; i++) {
        const l = logEls[i], on = i < n, was = l.classList.contains("lit");
        l.hidden = i >= maxFire;
        l.classList.toggle("lit", on); l.classList.toggle("ash", !on);
        if (on && !was && shownFire >= 0) restart(l, "pop");
      }
      setText(nB, String(n));
      const f = ensureFire();
      if (f) f.setIntensity(n <= 0 ? 0.04 : 0.12 + 0.88 * (n / maxFire));
      shownFire = n;
    }
    return {
      el,
      update(c, o) {
        o = o || {};
        const pub = c.pub;
        maxFire = pub.maxFire > 0 ? pub.maxFire : 10;
        el.classList.toggle("compact", !!o.compact);
        const t = o.time != null ? o.time : (c.chapter && c.chapter.time) || "20:00";
        setText(time, t);
        const p = o.progress != null ? o.progress : nightProgress(t);
        if (p !== prog) {
          prog = p;
          const [x, y] = bez(p);
          moon.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
          sun.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
          const sunK = clamp((p - 0.82) / 0.18, 0, 1);
          moon.style.opacity = String(1 - sunK); sun.style.opacity = String(sunK);
          lit.style.strokeDashoffset = String(1 - p);
        }
        const n = override != null ? override : clamp(Math.round(pub.fire != null ? pub.fire : 0), 0, maxFire);
        if (n !== shownFire) paint(n);
      },
      // Tijdelijk een andere stand tonen (uitslag-animatie): null = weer de echte stand.
      show(n) { override = n; if (n != null) paint(clamp(n, 0, maxFire)); },
      get flameEl() { return flame; },
      get logsEl() { return logs; },
      destroy() { if (fire) fire.destroy(); fire = null; },
    };
  }

  // Haard: rond gietijzeren kachelraam met echt vuur (DVFire) en het gezicht van Gloei in de vlammen.
  function buildHearth() {
    const cv = h("canvas", { "aria-hidden": "true" });
    const mouth = h("i", { class: "sv-mouth" });
    const face = h("div", { class: "sv-face" }, h("i", { class: "sv-eye l" }), h("i", { class: "sv-eye r" }), mouth);
    const stove = h("div", { class: "sv-stove" }, cv, h("div", { class: "sv-grate" }), face);
    const el = h("div", { class: "sv-hearth", "aria-hidden": "true", hidden: true }, stove);
    let fire = null, size = null, want = 0.5;
    const ensure = () => {
      if (!fire && window.DVFire && cv.isConnected && !el.hidden) { fire = window.DVFire.flame(cv, { intensity: want, logs: true, embers: true, blueTips: true }); }
      return fire;
    };
    return {
      el,
      get stove() { return stove; },
      show(sz) {
        if (sz === size) return;
        size = sz;
        el.hidden = !sz;
        el.classList.toggle("xs", sz === "xs"); el.classList.toggle("sm", sz === "sm"); el.classList.toggle("md", sz === "md");
        if (sz) requestAnimationFrame(() => { const f = ensure(); if (f) f.setIntensity(want); });
      },
      setIntensity(k) { want = clamp(k, 0, 1); const f = ensure(); if (f) f.setIntensity(want); },
      burst() { const f = ensure(); if (f) f.burst(); },
      face(on, hot) { face.classList.toggle("on", !!on); face.classList.toggle("hot", !!(on && hot)); if (!on) mouth.classList.remove("open"); },
      chatter() { if (face.classList.contains("on")) mouth.classList.toggle("open"); },
      quiet() { mouth.classList.remove("open"); },
      destroy() { if (fire) fire.destroy(); fire = null; },
    };
  }

  // =========================================================
  // Schil: lagen + HUD + haard + view-wissel (ook gebruikt door de arcade)
  // =========================================================
  const INST = new WeakMap();
  function shell(root) {
    let S = INST.get(root);
    if (S) return S;
    const bg = buildBg(), frost = buildFrost(), hud = buildHud(), hearth = buildHearth();
    const mist = h("div", { class: "sv-mist", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
    const viewBox = h("div", { class: "sv-viewbox", style: { display: "contents" } });
    const el = h("div", { class: "sv-root", "data-phase": "", "data-mood": "warm" }, bg.el, h("div", { class: "sv-stars", "aria-hidden": "true" }), buildSnow(), mist, hud.el, hearth.el, viewBox, frost.el, frost.fog);
    root.classList.add("sv-host");
    root.replaceChildren(el);
    S = {
      root, el, bg, frost, hud, hearth, viewBox, key: null, view: null, spk: null, hot: false, opts: {},
      // Sfeer per fase: { mood, hearth: "sm"|"md"|null, hud: true|"compact"|false, frost: "off"|"on"|"full", phase, time, progress, intensity }
      apply(c, o) {
        this.opts = o;
        el.dataset.phase = o.phase || c.pub.phase || "";
        el.dataset.mood = o.mood || "warm";
        bg.set(o.mood || "warm");
        hud.el.hidden = !o.hud;
        if (o.hud) hud.update(c, { compact: o.hud === "compact", time: o.time, progress: o.progress });
        hearth.show(o.hearth || null);
        this.refreshSpeaker();
        const max = c.pub.maxFire > 0 ? c.pub.maxFire : 10;
        const k = o.intensity != null ? o.intensity : (c.pub.fire != null ? clamp(c.pub.fire / max, 0, 1) : 0.4);
        el.style.setProperty("--fireK", String(k));
        if (o.hearth) hearth.setIntensity(o.intensity != null ? o.intensity : (k <= 0 ? 0.04 : 0.1 + 0.9 * k));
      },
      speaker(kind, hot) { this.spk = kind || null; this.hot = !!hot; this.refreshSpeaker(); },
      refreshSpeaker() {
        const o = this.opts || {};
        hearth.face(this.spk === "gloei" && !!o.hearth, this.hot);
        frost.set(o.frost === "full" ? "full" : this.spk === "vorst" || o.frost === "on" ? "on" : "off");
      },
      // Wissel van view als de sleutel verandert; anders alleen update(c).
      setView(key, make, c) {
        if (key === this.key && this.view) { this.view.update && this.view.update(c); return; }
        if (this.view && this.view.destroy) { try { this.view.destroy(); } catch (e) { console.error(e); } }
        this.key = key; this.spk = null; this.hot = false;
        const view = make(this, c);
        this.view = view;
        viewBox.replaceChildren(view.el);
        this.refreshSpeaker();
        view.update && view.update(c);
        if (view.mounted) requestAnimationFrame(() => { if (this.view === view) view.mounted(c); });
        if (typeof window.scrollTo === "function") try { window.scrollTo(0, 0); } catch (e) { /* */ }
      },
      destroy() {
        if (this.view && this.view.destroy) { try { this.view.destroy(); } catch (e) { /* */ } }
        hud.destroy(); hearth.destroy();
        el.remove(); root.classList.remove("sv-host");
        INST.delete(root);
      },
    };
    INST.set(root, S);
    return S;
  }

  // =========================================================
  // Gedeelde blokken
  // =========================================================
  // Klaar-knop + wie er nog leest + (host) "Iedereen verder" na een poosje.
  function readyBlock(S, c, o) {
    o = Object.assign({ label: "Klaar ✓", done: "Klaar ✓", action: "ready", hostAction: "next", hostLabel: "Iedereen verder →", verb: "leest", delay: 7000, cls: "" }, o || {});
    const T = timers();
    const btn = h("button", { class: "sv-btn wide " + o.cls, type: "button", "data-act": o.action, text: o.label, onclick() {
      if (sent || !enabled) return;
      sent = true; sfx.beep(660, 0.07, "triangle", 0.1); sfx.buzz(12);
      c.send(o.action, {});
      o.onReady && o.onReady();
      paint(c);
    } });
    const readers = h("div", { class: "sv-readers", role: "status" });
    const hostBtn = h("button", { class: "sv-link hot", type: "button", "data-act": o.hostAction, text: o.hostLabel, onclick() { sfx.beep(520, 0.06); c.send(o.hostAction, {}); hostLine.classList.remove("show"); } });
    const hostLine = h("div", { class: "sv-hostline" }, hostBtn);
    const el = h("div", { class: "sv-actions" }, btn, readers, hostLine);
    let sent = false, enabled = o.enabled !== false, hostT = 0;
    function paint(cc) {
      c = cc;
      const ready = new Set(Array.isArray(c.pub.ready) ? c.pub.ready : []);
      const meActive = c.active.some((p) => p.pid === c.me.pid);
      const mine = ready.has(c.me.pid) || sent;
      btn.hidden = !meActive;
      btn.disabled = mine || !enabled;
      btn.classList.toggle("done", mine);
      setText(btn, mine ? o.done : o.label);
      const waiting = c.active.filter((p) => !ready.has(p.pid) && !(p.pid === c.me.pid && mine));
      keyed(readers, c.active, (p) => p.pid, (p) => h("span", { class: "sv-rd" }, avatar(p, "sm"), h("i", { text: "✓" })), (elm, p) => {
        const ok = ready.has(p.pid) || (p.pid === c.me.pid && mine);
        elm.classList.toggle("ok", ok); elm.classList.toggle("wait", !ok);
      });
      let t = readers.querySelector("span.t");
      if (!t) { t = h("span", { class: "t" }); readers.append(t); }
      const all = waiting.length === 0 && c.active.length > 0;
      readers.classList.toggle("ok", all);
      setText(t, !meActive ? "Je kijkt mee 👀" : all ? "Iedereen is klaar ✓" : waiting.length === c.active.length && !mine ? "" :
        `${listNames(waiting.map((p) => p.name))} ${waiting.length > 1 ? o.verb.replace(/t$/, "en") : o.verb} nog…`);
      // Host mag doorduwen als de rest niet komt (iemand weggevallen?)
      const showHost = c.me.isHost && mine && !all && c.active.length > 1;
      if (showHost && !hostT) hostT = T.later(() => hostLine.classList.add("show"), o.delay);
      if (!showHost) { hostLine.classList.remove("show"); if (hostT) { clearTimeout(hostT); hostT = 0; } }
    }
    return { el, btn, update: paint, enable(v) { enabled = v; paint(c); }, destroy() { T.clear(); } };
  }
  function tag(spk) {
    const el = h("span", { class: "sv-tag " + spk.kind, style: { "--tc": spk.color } });
    if (spk.kind === "player" && spk.player) el.append(avatar(spk.player, "xs"));
    else if (spk.kind === "gloei") el.append(h("span", { class: "sv-sym", text: "🔥" }));
    else if (spk.kind === "vorst") el.append(h("span", { class: "sv-sym", text: "❄" }));
    el.append(h("span", { text: spk.name }));
    return el;
  }
  function embersCanvas(density) {
    const cv = h("canvas", { class: "sv-embers", "aria-hidden": "true" });
    let e = null;
    return { el: cv, start() { if (!e && window.DVFire && cv.isConnected) e = window.DVFire.embers(cv, { density: density == null ? 0.55 : density }); }, destroy() { if (e) e.destroy(); e = null; } };
  }
  function fireRow(fire, max) {
    const logs = h("div", { class: "sv-logs", "aria-hidden": "true" });
    for (let i = 0; i < max; i++) logs.append(h("i", { class: "sv-log " + (i < fire ? "lit" : "ash"), style: { "--i": i } }));
    return h("div", { class: "sv-minifire" }, logs, h("div", { class: "sv-fire-n" }, h("b", { text: String(fire) }), ` / ${max}`));
  }
  const deltaText = (n) => (n > 0 ? "+" + n + " " + "🪵".repeat(Math.min(n, 4)) : n < 0 ? "−" + (-n) + " " + "🪵".repeat(Math.min(-n, 4)) : "±0");

  // Blokken die naar (of uit) het vuur vliegen. from/to: elementen; n: aantal; onEach(i) bij aankomst.
  function flyLogs(from, to, n, { ash, onEach, onDone, T } = {}) {
    if (!from || !to || !from.isConnected || !to.isConnected || n <= 0) { onDone && onDone(); return; }
    if (reduced()) { for (let i = 0; i < n; i++) onEach && onEach(i); onDone && onDone(); return; }
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const sx = a.left + a.width / 2, sy = a.top + a.height / 2, tx = b.left + b.width / 2, ty = b.top + b.height / 2;
    const later = T ? T.later.bind(T) : (fn, ms) => setTimeout(fn, ms);
    for (let i = 0; i < n; i++) {
      later(() => {
        const el = h("div", { class: "sv-fly" + (ash ? " ash" : ""), style: { left: sx - 15 + "px", top: sy - 7 + "px", transform: `translate(${(rnd() - 0.5) * 40}px, 0) rotate(${(rnd() - 0.5) * 40}deg)` } });
        document.body.append(el);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.transform = `translate(${tx - sx + (rnd() - 0.5) * 16}px, ${ty - sy}px) rotate(${(rnd() - 0.5) * 300}deg) scale(0.6)`;
          el.style.opacity = "0";
        }));
        later(() => { el.remove(); onEach && onEach(i); if (i === n - 1) onDone && onDone(); }, 900);
      }, i * 140);
    }
  }

  // Minigame-podium: DVMini.runner in een volle-hoogte doos, met (optioneel) een intro van Gloei erboven en een
  // overslaan-knop voor de host. sync(c) bij elke state.
  function miniStage(S, c, o) {
    o = o || {};
    const T = timers();
    const run = h("div", { class: "sv-minirun" }); // alleen van de runner: die leegt dit element bij een wissel
    const box = h("div", { class: "sv-minibox" }, run);
    const skip = c.me.isHost ? h("button", { class: "sv-skip", type: "button", "data-act": "skipMini", text: "⏭ Overslaan", onclick() {
      if (skip.classList.contains("arm")) { sfx.beep(440, 0.08); c.send("skipMini", {}); skip.classList.remove("arm"); setText(skip, "⏭ Overslaan"); return; }
      skip.classList.add("arm"); setText(skip, "Zeker? Tik nog eens"); sfx.buzz(8);
      T.later(() => { skip.classList.remove("arm"); setText(skip, "⏭ Overslaan"); }, 3200);
    } }) : null;
    let intro = null;
    if (o.intro) {
      intro = h("div", { class: "sv-intro sv-glass" }, h("div", { class: "sv-introtxt" }, tag(speaker("gloei", c)), h("p", { text: o.intro })), skip);
    }
    const el = h("div", { class: "sv-mini" }, intro, box);
    if (!intro && skip) { skip.classList.add("sv-skip-float"); box.append(skip); }
    const runner = window.DVMini ? window.DVMini.runner(run, { send: (msg) => c.send("mini", msg) }) : null;
    if (!runner) run.append(h("div", { class: "mini-waiting", text: "Minigames zijn niet geladen." }));
    // Intro weg zodra het spel begint (Start getikt of het aftellen verschijnt); daarna krijgt het spel alle ruimte.
    const away = () => {
      if (!intro || intro.classList.contains("away")) return;
      intro.classList.add("away"); T.later(fit, 520);
      if (skip) { skip.classList.add("sv-skip-float"); box.append(skip); }
    };
    const mo = typeof MutationObserver === "function" ? new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList && (n.classList.contains("mini-countdown") || n.querySelector && n.querySelector(".mini-countdown"))) { away(); return; }
    }) : null;
    if (mo) mo.observe(run, { childList: true, subtree: true });
    let startedAt = 0;
    run.addEventListener("pointerdown", () => { const now = performance.now(); if (startedAt && now - startedAt > 400) away(); if (!startedAt) startedAt = now; }, true);
    // De doos krijgt de rest van het scherm (de minigames willen een vaste hoogte, min. 480).
    function fit() {
      if (!box.isConnected) return;
      const top = box.getBoundingClientRect().top + (window.scrollY || 0);
      const hgt = Math.max(520, Math.round((window.visualViewport ? window.visualViewport.height : window.innerHeight) - top));
      box.style.height = hgt + "px";
    }
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    requestAnimationFrame(() => { fit(); T.later(fit, 300); });
    return {
      el, box,
      sync(cc) {
        c = cc;
        if (!runner) return;
        const view = c.priv && c.priv.miniView !== undefined ? c.priv.miniView : undefined;
        const mini = c.pub.mini || null;
        const players = mini && Array.isArray(mini.pids) ? c.players.filter((p) => mini.pids.includes(p.pid)) : c.active;
        // Toeschouwer (niet in mini.pids): niet meespelen, wel zien dat de rest bezig is
        if (mini && Array.isArray(mini.pids) && !mini.pids.includes(c.me.pid)) {
          try { runner.sync({ mini: null }); } catch (e) { /* */ }
          if (!run.querySelector(".mini-waiting")) run.append(h("div", { class: "mini-waiting", text: `Je kijkt mee 👀 — ${listNames(players.map((p) => p.name)) || "de rest"} speelt…` }));
          return;
        }
        // Net-minigame: pas mounten als de privé-view er is. Die komt nét na de publieke state binnen (apart kanaal), en
        // slot/echo/verhaal beginnen vanuit die view: ringstand, eigen woord, beurt — ook na herladen midden in het spel.
        if (mini && mini.kind === "net" && view === undefined) return;
        try { runner.sync({ mini, view, me: { pid: c.me.pid }, players: players.length ? players : c.active }); } catch (e) { console.error(e); }
      },
      fit,
      destroy() { T.clear(); window.removeEventListener("resize", onResize); if (mo) mo.disconnect(); if (runner) runner.destroy(); },
    };
  }

  // Uitslagblokken (verhaal én arcade): koptekst, blokken, Gloei-regel, regels, per speler.
  const VERDICT = { win: "Het vuur laait op!", meh: "Het vuur houdt stand.", lose: "Het vuur zakt in…" };
  function resultHead(r, def, o) {
    o = o || {};
    const verdict = r.verdict || (r.logs >= 2 ? "win" : r.logs >= 0 ? "meh" : "lose");
    const logs = Number(r.logs) || 0;
    const kick = h("p", { class: "sv-kicker", text: `${def ? def.icon + " " + def.title : "Minigame"} · uitslag` });
    const title = h("h1", { class: "sv-verdict " + verdict + (verdict === "win" ? " sv-grad" : ""), text: o.title || VERDICT[verdict] });
    const delta = h("div", { class: "sv-logsdelta " + (logs > 0 ? "pos" : logs < 0 ? "neg" : "zero"), text: deltaText(logs) });
    return { el: h("div", { class: "sv-res-head" }, kick, title, delta), delta, verdict, logs };
  }
  function resultLines(lines) {
    const ul = h("ul", { class: "sv-lines" });
    (Array.isArray(lines) ? lines : []).filter((l) => typeof l === "string" && l).forEach((l, i) => ul.append(h("li", { text: l, style: { "animation-delay": (0.6 + i * 0.12).toFixed(2) + "s" } })));
    return ul;
  }
  function resultPlayers(c, r, o) {
    o = o || {};
    const pp = (r.perPlayer && typeof r.perPlayer === "object") ? r.perPlayer : {};
    const pids = c.active.map((p) => p.pid).concat(Object.keys(pp).filter((pid) => !c.active.some((p) => p.pid === pid)));
    const box = h("div", { class: "sv-pp" });
    pids.forEach((pid, i) => {
      const p = c.P(pid) || { pid, name: "Iemand", avatar: "🙂", color: "#8a5a36" };
      const stat = pp[pid];
      const mvp = r.mvp != null && r.mvp === pid;
      const row = h("div", { class: "row" + (mvp ? " mvp" : ""), style: { "animation-delay": (0.9 + i * 0.1).toFixed(2) + "s" } },
        avatar(p, "md"),
        h("div", null, h("div", { class: "nm", text: p.name }), stat != null && stat !== "" ? h("div", { class: "st", text: typeof stat === "string" ? stat : JSON.stringify(stat) }) : null),
        o.points ? h("div", { class: "pts", text: o.points(pid) }) : (mvp ? h("div", { class: "pts", text: "MVP" }) : null),
        mvp ? h("span", { class: "sv-crown", "aria-label": "beste speler", text: "👑" }) : null);
      box.append(row);
    });
    return box;
  }
  // Uitslag-animatie: blokken vliegen de haard in (of eruit), meter telt mee, vuur flakkert op.
  function animateLogs(S, head, r, T, maxFire) {
    const before = Number.isFinite(r.fireBefore) ? r.fireBefore : null, after = Number.isFinite(r.fireAfter) ? r.fireAfter : null;
    const logs = Number(r.logs) || 0;
    if (before == null || after == null) return;
    const target = S.hearth.el.hidden ? S.hud.flameEl : S.hearth.stove;
    S.hud.show(before);
    const max = maxFire > 0 ? maxFire : 10;
    if (logs > 0) {
      T.later(() => flyLogs(head.delta, target, logs, { T, onEach(i) {
        S.hud.show(Math.min(after, before + i + 1)); S.hearth.burst(); S.hearth.setIntensity(0.1 + 0.9 * clamp((before + i + 1) / max, 0, 1));
        sfx.beep(520 + i * 90, 0.08, "triangle", 0.09); sfx.buzz(10);
      }, onDone() { T.later(() => S.hud.show(null), 400); } }), 700);
    } else if (logs < 0) {
      T.later(() => flyLogs(target, head.delta, -logs, { T, ash: true, onEach(i) {
        S.hud.show(Math.max(after, before - i - 1)); S.hearth.setIntensity(0.06 + 0.9 * clamp((before - i - 1) / max, 0, 1));
        sfx.beep(260 - i * 30, 0.14, "sine", 0.08); sfx.buzz([20, 30, 20]);
      }, onDone() { T.later(() => S.hud.show(null), 400); } }), 700);
    } else T.later(() => S.hud.show(null), 300);
  }

  // =========================================================
  // Views
  // =========================================================
  const VIEWS = {};

  VIEWS.plain = (S, c, text, emoji) => {
    const el = h("div", { class: "sv-view" }, h("div", { class: "sv-plain" }, h("div", { class: "big", text: emoji || "🔥" }), h("div", { text })));
    return { el, update() {} };
  };
  VIEWS.lobby = (S, c) => VIEWS.plain(S, c, "De host zet het verhaal klaar…");

  // Titel van het verhaal (fase "title")
  VIEWS.title = (S, c) => {
    const st = c.story || {};
    const emb = embersCanvas(0.7);
    const castRow = h("div", { class: "sv-cast" });
    const inner = h("div", { class: "sv-card-inner" },
      h("p", { class: "sv-kicker", text: st.subtitle || "De langste nacht" }),
      h("h1", { class: "sv-storytitle", text: st.title || "Vuurwacht" }),
      h("div", { class: "sv-rule" }),
      h("p", { class: "sv-tagline", text: "Hou het vuur brandend tot de zon opkomt." }),
      castRow);
    const ready = readyBlock(S, c, { label: "Het vuur gaat aan 🔥", done: "Klaar ✓", verb: "wacht" });
    const el = h("div", { class: "sv-view" }, h("div", { class: "sv-card" }, emb.el, inner), ready.el);
    return {
      el,
      update(cc) {
        keyed(castRow, cc.active, (p) => p.pid, (p) => h("div", { class: "c" }, avatar(p, "md"), h("span")), (elm, p) => setText(elm.lastChild, p.name));
        ready.update(cc);
      },
      mounted() { emb.start(); },
      destroy() { emb.destroy(); ready.destroy(); },
    };
  };

  // Hoofdstuk-titelkaart (fase "card")
  VIEWS.card = (S, c) => {
    const ch = c.chapter || {}, st = c.story || { chapters: [] };
    const idx = c.pub.chapter || 0, total = st.chapters ? st.chapters.length : 8;
    const emb = embersCanvas(0.55);
    const fireBox = h("div");
    const inner = h("div", { class: "sv-card-inner" },
      h("p", { class: "sv-kicker", text: `${st.title || "Vuurwacht"} · hoofdstuk ${idx + 1} van ${total}` }),
      h("div", { class: "sv-bigtime", text: ch.time || "" }),
      h("div", { class: "sv-rule" }),
      h("h1", { class: "sv-h1", text: ch.title || "" }),
      ch.tagline ? h("p", { class: "sv-tagline", text: ch.tagline }) : null,
      fireBox);
    const ready = readyBlock(S, c, { label: "Verder", done: "Klaar ✓", verb: "wacht" });
    const el = h("div", { class: "sv-view" }, h("div", { class: "sv-card" }, emb.el, inner), ready.el);
    let shownFire = null;
    return {
      el,
      update(cc) {
        const f = cc.pub.fire != null ? cc.pub.fire : 0, m = cc.pub.maxFire > 0 ? cc.pub.maxFire : 10;
        if (f !== shownFire) { shownFire = f; fireBox.replaceChildren(fireRow(clamp(Math.round(f), 0, m), m)); }
        ready.update(cc);
      },
      mounted() { emb.start(); },
      destroy() { emb.destroy(); ready.destroy(); },
    };
  };

  // Scène: visual novel — één regel tegelijk, tik om af te maken / verder te gaan, "Klaar ✓" na de laatste regel.
  VIEWS.scene = (S, c, opts) => {
    opts = opts || {};
    const T = timers();
    const step = c.step || {};
    const lines = (Array.isArray(opts.lines) ? opts.lines : Array.isArray(step.lines) ? step.lines : []).filter((l) => l && typeof l.text === "string");
    if (!lines.length) return VIEWS.plain(S, c, "Even geduld…");
    const textEl = h("p", { class: "sv-text", "aria-live": "polite" });
    const tagBox = h("div");
    const dots = h("div", { class: "sv-ldots", "aria-hidden": "true" }, lines.map(() => h("i")));
    const next = h("span", { class: "sv-next" }, h("span", { text: "tik" }), h("b", { text: "▾" }));
    const prev = h("button", { class: "sv-prev", type: "button", "aria-label": "Vorige regel", text: "‹", onclick(e) { e.stopPropagation(); if (idx > 0) go(idx - 1, true); } });
    const dlg = h("div", { class: "sv-dlg sv-glass sv-flick", role: "button", tabindex: "0", "aria-label": "Tik om verder te lezen" }, tagBox, textEl, h("div", { class: "sv-dlg-foot" }, prev, dots, next));
    const extra = h("div");
    const ready = readyBlock(S, c, { label: "Klaar ✓", done: "Klaar ✓", verb: "leest", enabled: false, onReady() { if (tw) tw.finish(); } });
    const space = h("div", { class: "sv-stage-space" });
    const el = h("div", { class: "sv-view" }, h("div", { class: "sv-scene" }, space, dlg, extra), ready.el);
    let idx = 0, tw = null, instantAll = false, cur = null;
    const alreadyReady = Array.isArray(c.pub.ready) && c.pub.ready.includes(c.me.pid);
    if (alreadyReady) { idx = lines.length - 1; instantAll = true; } // herverbonden: alles meteen zichtbaar
    if (c.debug) { if (typeof c.debug.line === "number") idx = clamp(c.debug.line, 0, lines.length - 1); if (c.debug.instant) instantAll = true; }

    function go(i, instant) {
      idx = clamp(i, 0, lines.length - 1);
      const line = lines[idx], spk = speaker(line.who, c), text = fill(line.text, c);
      cur = spk;
      tagBox.replaceChildren(spk.kind === "narr" ? "" : tag(spk));
      textEl.className = "sv-text " + (spk.kind === "narr" ? "narr" : spk.kind === "vorst" ? "vorst" : "");
      S.speaker(spk.kind, /!/.test(text) && spk.kind === "gloei");
      next.classList.remove("show");
      prev.disabled = idx === 0;
      [...dots.children].forEach((d, k) => { d.classList.toggle("seen", k < idx); d.classList.toggle("cur", k === idx); });
      if (tw) tw.cancel();
      const kind = spk.kind;
      tw = typewriter(textEl, text, {
        speed: kind === "narr" ? 54 : 46, instant: instant || instantAll,
        tick() { crackle(kind); if (kind === "gloei") S.hearth.chatter(); },
        done() { S.hearth.quiet(); if (idx >= lines.length - 1) { ready.enable(true); } else next.classList.add("show"); },
      });
      if (idx >= lines.length - 1) ready.enable(true);
    }
    const tap = (e) => {
      if (e && e.target && e.target.closest && e.target.closest("button")) return;
      if (tw && tw.active) { tw.finish(); sfx.beep(900, 0.03, "triangle", 0.05); return; }
      if (idx < lines.length - 1) { sfx.beep(700, 0.03, "triangle", 0.05); go(idx + 1); }
    };
    dlg.addEventListener("click", tap);
    space.addEventListener("click", tap);
    dlg.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); tap(); } });
    go(idx, instantAll);
    return {
      el,
      update(cc) { c = cc; ready.update(cc); },
      destroy() { T.clear(); if (tw) tw.cancel(); ready.destroy(); S.hearth.quiet(); S.speaker(null); },
    };
  };

  // Vuur-stap: fireChange = { delta, before, after, line } — korte scène + blokkenbadge, de meter telt mee.
  VIEWS.fire = (S, c) => {
    const step = c.step || {}, fc = c.pub.fireChange || {};
    const delta = Number.isFinite(fc.delta) ? fc.delta : Math.round(Number(step.delta)) || 0;
    const line = fc.line || step.line || null;
    const n = Math.abs(delta);
    const v = VIEWS.scene(S, c, { lines: line && line.text ? [line] : [{ who: "verteller", text: delta >= 0 ? `Het vuur krijgt er ${n} ${n === 1 ? "blok" : "blokken"} bij.` : `Het vuur verliest ${n} ${n === 1 ? "blok" : "blokken"}.` }] });
    if (delta !== 0) {
      const scene = v.el.querySelector(".sv-scene");
      if (scene) scene.append(h("div", { style: { "text-align": "center" } }, h("span", { class: "sv-delta " + (delta < 0 ? "neg" : ""), text: deltaText(delta) })));
    }
    const T = timers(), inner = v;
    const fast = reduced() || (Array.isArray(c.pub.ready) && c.pub.ready.includes(c.me.pid)) || !!(c.debug && c.debug.instant);
    return {
      el: v.el,
      update(cc) { inner.update && inner.update(cc); },
      mounted() {
        if (fast || !Number.isFinite(fc.before)) return;
        S.hud.show(fc.before);
        T.later(() => { S.hud.show(null); if (delta > 0) { S.hearth.burst(); sfx.beep(640, 0.1, "triangle", 0.09); } else if (delta < 0) sfx.beep(240, 0.2, "sine", 0.07); }, 900);
      },
      destroy() { T.clear(); S.hud.show(null); inner.destroy && inner.destroy(); },
    };
  };

  // Keuze: grote kaarten, stem verborgen tot iedereen gekozen heeft.
  VIEWS.choice = (S, c) => {
    const step = c.step || {};
    const options = Array.isArray(step.options) ? step.options : [];
    const prompt = h("div", { class: "sv-prompt sv-glass sv-flick" }, h("p", { class: "sv-kicker", text: `Keuze · ${(c.chapter && c.chapter.time) || ""}` }), h("p", { text: fill(step.prompt || "", c) }));
    const opts = h("div", { class: "sv-opts", role: "group" });
    const RUNE = ["I", "II", "III", "IV", "V"];
    let myVote = null, sent = false;
    options.forEach((o, i) => {
      opts.append(h("button", { class: "sv-opt", type: "button", "data-act": "vote", "data-option": i, onclick() {
        if (sent || !c.active.some((p) => p.pid === c.me.pid)) return;
        sent = true; myVote = i;
        sfx.beep(660, 0.07, "triangle", 0.1); sfx.buzz(14);
        c.send("vote", { option: i });
        paint(c);
      } }, h("span", { class: "sv-rune", text: RUNE[i] || String(i + 1) }), h("span", null, h("b", { text: fill(o.text || "", c) }), o.hint ? h("small", { text: fill(o.hint, c) }) : null)));
    });
    const readers = h("div", { class: "sv-readers", role: "status" });
    const hint = h("p", { class: "sv-muted", style: { "text-align": "center", margin: "0" }, text: `${c.active.length > 2 ? "Kies allemaal" : "Kies allebei"}. Verdeeld? Dan gooit Gloei een munt.` });
    const el = h("div", { class: "sv-view" }, h("div", { class: "sv-choice" }, prompt, opts), h("div", { class: "sv-actions" }, hint, readers));
    function paint(cc) {
      c = cc;
      const voted = new Set(Array.isArray(c.pub.voted) ? c.pub.voted : []);
      const priv = c.priv || {};
      if (myVote == null && typeof priv.vote === "number") myVote = priv.vote;
      const mine = voted.has(c.me.pid) || sent;
      const meActive = c.active.some((p) => p.pid === c.me.pid);
      [...opts.children].forEach((b, i) => {
        b.disabled = mine || !meActive;
        b.classList.toggle("picked", mine && myVote === i);
        b.classList.toggle("dim", mine && myVote != null && myVote !== i);
      });
      const waiting = c.active.filter((p) => !voted.has(p.pid) && !(p.pid === c.me.pid && mine));
      keyed(readers, c.active, (p) => p.pid, (p) => h("span", { class: "sv-rd" }, avatar(p, "sm"), h("i", { text: "✓" })), (elm, p) => {
        const ok = voted.has(p.pid) || (p.pid === c.me.pid && mine);
        elm.classList.toggle("ok", ok); elm.classList.toggle("wait", !ok);
      });
      let t = readers.querySelector("span.t");
      if (!t) { t = h("span", { class: "t" }); readers.append(t); }
      setText(t, !meActive ? "Je kijkt mee 👀" : !mine ? "Jouw keuze…" : waiting.length ? `Wachten op ${listNames(waiting.map((p) => p.name))}…` : "Iedereen heeft gekozen ✓");
      hint.hidden = mine;
    }
    return { el, update: paint, destroy() {} };
  };

  // Muntworp bij een verdeelde keuze: gouden munt, wie koos wat, uitkomst, dan "Verder".
  VIEWS.flip = (S, c) => {
    const T = timers();
    const step = c.step || {};
    const flip = c.pub.flip || {};
    const options = Array.isArray(flip.options) && flip.options.length && typeof flip.options[0] === "object" ? flip.options : Array.isArray(step.options) ? step.options : [];
    const result = typeof flip.result === "number" ? flip.result : typeof flip.result === "string" ? options.findIndex((o) => o && o.text === flip.result) : 0;
    const votes = flip.votes && typeof flip.votes === "object" ? flip.votes : {};
    const RUNE = ["I", "II", "III", "IV", "V"];
    const alreadyReady = Array.isArray(c.pub.ready) && c.pub.ready.includes(c.me.pid);
    const still = reduced() || alreadyReady || !!(c.debug && c.debug.instant);
    const coin = h("div", { class: "sv-coin" + (result === 1 ? " r1" : "") + (still ? " still" : ""), "aria-hidden": "true" },
      h("div", { class: "sv-face2 a" }, RUNE[0], h("small", { text: "Gloei" })), h("div", { class: "sv-face2 b" }, RUNE[1] || "II", h("small", { text: "Gloei" })));
    const line = h("p", { class: "sv-verdictline sv-reveal" }, "De munt zegt: ", h("b"));
    const opts = h("div", { class: "sv-opts" });
    options.forEach((o, i) => {
      const voters = c.players.filter((p) => votes[p.pid] === i || votes[p.pid] === (o && o.text));
      opts.append(h("div", { class: "sv-opt" + (still && i === result ? " win" : ""), "data-option": i },
        h("span", { class: "sv-rune", text: RUNE[i] || String(i + 1) }), h("span", null, h("b", { text: fill((o && o.text) || "", c) }), voters.length ? h("small", { text: `Gekozen door ${listNames(voters.map((p) => p.name))}` }) : null),
        h("span", { class: "sv-votes" }, voters.map((p) => avatar(p, "xs")))));
    });
    const ready = readyBlock(S, c, { label: "Verder", done: "Klaar ✓", verb: "wacht", enabled: still });
    const el = h("div", { class: "sv-view" }, h("div", { class: "sv-flip" },
      h("p", { class: "sv-kicker", text: "Verdeeld!" }), h("h2", { class: "sv-h2", text: "Gloei gooit een gloeiende munt" }),
      h("div", { class: "sv-coinwrap" }, coin), h("div", { class: "sv-coinshadow", "aria-hidden": "true" }), line, opts), ready.el);
    const reveal = () => {
      setText(line.lastChild, fill((options[result] && options[result].text) || "", c));
      line.classList.add("show");
      [...opts.children].forEach((o, i) => o.classList.toggle("win", i === result));
      ready.enable(true);
      S.hearth.burst(); sfx.fanfare(); sfx.buzz([30, 40, 60]);
    };
    if (still) { setText(line.lastChild, fill((options[result] && options[result].text) || "", c)); line.classList.add("show"); }
    else { let k = 0; T.every(() => { if (k++ < 9) sfx.beep(900 + k * 60, 0.03, "triangle", 0.05); }, 150); T.later(reveal, 2650); }
    return { el, update(cc) { ready.update(cc); }, mounted() { S.speaker("gloei"); }, destroy() { T.clear(); ready.destroy(); S.speaker(null); } };
  };

  // Minigame: intro van Gloei + het podium met DVMini.runner.
  VIEWS.mini = (S, c) => {
    const step = c.step || {};
    const stage = miniStage(S, c, { intro: step.intro ? fill(step.intro, c) : null });
    const el = h("div", { class: "sv-view" }, stage.el);
    return { el, update(cc) { stage.sync(cc); }, mounted(cc) { stage.fit(); stage.sync(cc); }, destroy() { stage.destroy(); } };
  };

  // Uitslag van een minigame: kop, Gloei's regel, score-regels, per speler, blokken het vuur in.
  VIEWS.miniResult = (S, c) => {
    const T = timers();
    const r = c.pub.miniResult || {}, step = c.step || {};
    const def = miniDef(r.id || (c.pub.mini && c.pub.mini.id) || step.id);
    const head = resultHead(r, def);
    const raw = typeof r.line === "string" && r.line ? r.line : step[head.verdict];
    const gline = raw ? fill(raw, c) : null;
    const qtext = h("p");
    const quote = gline ? h("div", { class: "sv-quote sv-glass sv-flick" }, tag(speaker("gloei", c)), qtext) : null;
    const ready = readyBlock(S, c, { label: "Verder", done: "Klaar ✓", verb: "wacht" });
    const el = h("div", { class: "sv-view" }, h("div", { class: "sv-res" }, head.el, quote, resultLines(r.lines), resultPlayers(c, r)), ready.el);
    const alreadyReady = (Array.isArray(c.pub.ready) && c.pub.ready.includes(c.me.pid)) || !!(c.debug && c.debug.instant);
    let tw = null;
    return {
      el,
      update(cc) { ready.update(cc); },
      mounted() {
        S.speaker("gloei");
        if (gline) tw = typewriter(qtext, gline, { speed: 60, instant: alreadyReady, tick() { crackle("gloei"); S.hearth.chatter(); }, done() { S.hearth.quiet(); } });
        if (!alreadyReady) {
          if (head.verdict === "win") { sfx.fanfare(); sfx.buzz([30, 40, 30, 40, 80]); } else if (head.verdict === "lose") { sfx.beep(220, 0.3, "sine", 0.08); sfx.buzz(60); } else sfx.beep(520, 0.1, "triangle", 0.08);
          animateLogs(S, head, r, T, c.pub.maxFire);
        }
      },
      destroy() { T.clear(); if (tw) tw.cancel(); ready.destroy(); S.hud.show(null); S.hearth.quiet(); S.speaker(null); },
    };
  };

  // Het vuur is uit: rijp over alles, regels van de Vorst, host probeert opnieuw.
  VIEWS.fail = (S, c) => {
    const T = timers();
    const st = c.story || {}, f = st.fail || { title: "Het vuur is uit", lines: [] };
    const cp = c.pub.checkpoint || {};
    const cpCh = st.chapters && st.chapters[cp.chapterIdx != null ? cp.chapterIdx : c.pub.chapter];
    const linesBox = h("div", { class: "sv-faillines" });
    const lines = (f.lines || []).filter((l) => l && l.text);
    lines.forEach((l) => { const spk = speaker(l.who, c); linesBox.append(h("p", { class: spk.kind, text: fill(l.text, c), style: { "animation-play-state": "paused" } })); });
    const host = c.P(c.pub.hostPid);
    const retry = h("button", { class: "sv-btn wide ice", type: "button", "data-act": "retry", text: "Probeer opnieuw", onclick() { retry.disabled = true; sfx.beep(600, 0.08, "triangle", 0.1); sfx.buzz(20); c.send("retry", {}); } });
    const wait = h("div", { class: "sv-readers" }, h("span", { class: "sv-dots" }, h("i"), h("i"), h("i")), h("span", { class: "t" }));
    const el = h("div", { class: "sv-view" }, h("div", { class: "sv-fail" },
      h("p", { class: "sv-kicker", style: { color: "#9fd3ff" }, text: "De Vorst glimlacht" }),
      h("h1", { class: "sv-h1 sv-grad-ice", text: f.title || "Het vuur is uit" }),
      linesBox,
      cpCh ? h("div", { class: "sv-checkpoint" }, h("span", { text: "Terug naar" }), h("b", { text: `${cpCh.time || ""} · ${cpCh.title || ""}` }), h("span", { text: "🔥" }), h("b", { text: `${cp.fire != null ? cp.fire : 3} blokken` })) : null),
      h("div", { class: "sv-actions" }, retry, wait));
    return {
      el,
      update(cc) {
        c = cc;
        retry.hidden = !c.me.isHost;
        wait.hidden = c.me.isHost;
        setText(wait.lastChild, `Wachten tot ${(host && host.name) || "de host"} het vuur weer aanmaakt…`);
      },
      mounted() {
        const fast = reduced() || !!(c.debug && c.debug.instant);
        if (!fast) { sfx.beep(160, 0.5, "sine", 0.1); sfx.buzz([80, 60, 120]); }
        [...linesBox.children].forEach((p, i) => T.later(() => { p.style.animationPlayState = "running"; if (p.className === "vorst") crackle("vorst"); }, fast ? 0 : 700 + i * 1500));
      },
      destroy() { T.clear(); },
    };
  };

  // Einde: dageraad boven de dennen, titel, regels, statistieken, badge, confetti.
  function treesSvg() {
    let d = "M0 100 L0 62";
    let x = 0;
    let seed = 7;
    const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    while (x < 400) {
      const w = 14 + r() * 16, hgt = 26 + r() * 30, base = 62 + r() * 6;
      d += ` L${x.toFixed(1)} ${base.toFixed(1)} L${(x + w * 0.25).toFixed(1)} ${(base - hgt * 0.45).toFixed(1)} L${(x + w * 0.18).toFixed(1)} ${(base - hgt * 0.45).toFixed(1)} L${(x + w * 0.4).toFixed(1)} ${(base - hgt * 0.78).toFixed(1)} L${(x + w * 0.34).toFixed(1)} ${(base - hgt * 0.78).toFixed(1)} L${(x + w / 2).toFixed(1)} ${(base - hgt).toFixed(1)} L${(x + w * 0.66).toFixed(1)} ${(base - hgt * 0.78).toFixed(1)} L${(x + w * 0.6).toFixed(1)} ${(base - hgt * 0.78).toFixed(1)} L${(x + w * 0.82).toFixed(1)} ${(base - hgt * 0.45).toFixed(1)} L${(x + w * 0.75).toFixed(1)} ${(base - hgt * 0.45).toFixed(1)} L${(x + w).toFixed(1)} ${base.toFixed(1)}`;
      x += w * 0.8;
    }
    d += " L400 62 L400 100 Z";
    return sv("svg", { viewBox: "0 0 400 100", preserveAspectRatio: "none", "aria-hidden": "true" }, sv("path", { d }));
  }
  VIEWS.ending = (S, c) => {
    const T = timers();
    const e = endingOf(c) || { title: "Dageraad", lines: [], mood: "dawn", good: c.pub.fire >= 4 };
    const good = e.good != null ? !!e.good : (e.id ? ["legende", "vuurwachters", "wachtboek"].includes(e.id) : c.pub.fire >= 4);
    const cold = e.mood === "cold";
    const rs = c.pub.runStats && typeof c.pub.runStats === "object" ? c.pub.runStats : {};
    const lines = (e.lines || []).filter((l) => l && l.text);
    const sky = h("div", { class: "sv-endsky" },
      h("div", { class: "sv-dawn" + (cold ? "" : " go"), "aria-hidden": "true" }, h("div", { class: "sv-dawn-night" }), h("div", { class: "sv-dawn-day" }), h("div", { class: "sv-dawn-sun" }), h("div", { class: "sv-trees" }, treesSvg())),
      h("p", { class: "sv-kicker", text: `06:00 · Dageraad · ${good ? "Vuurwachters" : "Einde"}` }),
      h("h1", { class: "sv-h1" + (cold ? " sv-grad-ice" : ""), text: e.title || "Dageraad" }));
    const linesBox = h("div", { class: "sv-endlines sv-glass" });
    lines.forEach((l) => {
      const spk = speaker(l.who, c);
      linesBox.append(h("p", { class: spk.kind, style: { "--tc": spk.color } }, spk.kind !== "narr" ? h("span", { class: "who", text: spk.name }) : null, fill(l.text, c)));
    });
    // Statistieken: vuur bij dageraad, minigames gewonnen, keren opnieuw
    const minis = Array.isArray(rs.minis) ? rs.minis : null;
    const wins = minis ? minis.filter((m) => m && (m.verdict === "win" || m.logs >= 2)).length : null;
    const retries = Number.isFinite(rs.fails) ? rs.fails : Number.isFinite(rs.retries) ? rs.retries : null;
    const stats = h("div", { class: "sv-stats sv-reveal" },
      h("div", { class: "sv-stat" }, h("b", { text: `${c.pub.fire != null ? c.pub.fire : "–"}/${c.pub.maxFire || 10}` }), h("span", { text: "vuur bij dageraad" })),
      h("div", { class: "sv-stat" }, h("b", { text: wins != null ? `${wins}/${minis.length}` : (c.story ? String(c.story.chapters.length) : "8") }), h("span", { text: wins != null ? "proeven gewonnen" : "uren gewaakt" })),
      h("div", { class: "sv-stat" }, h("b", { text: retries != null ? `${retries}×` : "1" }), h("span", { text: retries != null ? "opnieuw" : "nacht" })));
    const mvpCounts = rs.mvpCounts && typeof rs.mvpCounts === "object" ? rs.mvpCounts : rs.mvp && typeof rs.mvp === "object" ? rs.mvp : null;
    const mvps = mvpCounts ? h("div", { class: "sv-mvps sv-reveal" }, c.active.filter((p) => mvpCounts[p.pid] > 0).sort((a, b) => mvpCounts[b.pid] - mvpCounts[a.pid]).map((p) => h("div", { class: "m" }, avatar(p, "md"), h("b", { text: `👑 ${mvpCounts[p.pid]}` }), h("span", { text: p.name })))) : null;
    const badge = good ? h("div", { class: "sv-badge sv-reveal" }, h("div", { class: "em", text: "🔥" }), h("b", { text: "Vuurwachters" }), h("small", { text: listNames(c.active.map((p) => p.name)) })) : null;
    const host = c.P(c.pub.hostPid);
    const back = h("button", { class: "sv-btn wide", type: "button", "data-act": "next", text: "Terug naar het kampvuur", onclick() { back.disabled = true; sfx.beep(600, 0.08, "triangle", 0.1); c.send("next", {}); } });
    const wait = h("div", { class: "sv-readers" }, h("span", { class: "sv-dots" }, h("i"), h("i"), h("i")), h("span", { class: "t" }));
    const actions = h("div", { class: "sv-actions sv-reveal" }, back, wait);
    const body = h("div", { class: "sv-endbody" }, linesBox, badge, stats, mvps);
    const el = h("div", { class: "sv-view" }, h("div", { class: "sv-end" }, sky, body), actions);
    let shown = 0, finished = false;
    const showLine = () => {
      if (shown < linesBox.children.length) { const p = linesBox.children[shown++]; p.classList.add("show"); const k = p.className.replace(" show", ""); crackle(k === "narr" ? "narr" : k); }
      if (shown >= linesBox.children.length && !finished) {
        finished = true;
        T.later(() => {
          [stats, mvps, badge, actions].forEach((x) => x && x.classList.add("show"));
          if (good && !reduced()) { sfx.fanfare(); sfx.buzz([40, 60, 40, 60, 120]); sfx.confetti(FIRE_COLORS, 180); T.later(() => sfx.confetti(FIRE_COLORS, 120), 700); }
          else if (good) sfx.fanfare();
        }, 500);
      }
    };
    const fast = reduced() || (Array.isArray(c.pub.ready) && c.pub.ready.includes(c.me.pid)) || !!(c.debug && c.debug.instant);
    el.addEventListener("click", (e) => { if (e.target.closest("button")) return; if (!finished) showLine(); });
    return {
      el,
      update(cc) { c = cc; back.hidden = !c.me.isHost; wait.hidden = c.me.isHost; setText(wait.lastChild, `${(host && host.name) || "De host"} brengt jullie terug naar het kampvuur…`); },
      mounted() {
        if (fast) { while (!finished) showLine(); return; }
        T.later(showLine, 1800);
        T.every(() => { if (!finished) showLine(); }, 2300);
      },
      destroy() { T.clear(); },
    };
  };

  // =========================================================
  // Fase → sfeer + view
  // =========================================================
  function viewKey(c) {
    const p = c.pub, ph = p.phase || "lobby", n = p.mini ? p.mini.nonce : 0;
    switch (ph) {
      case "lobby": return "lobby";
      case "title": return "title";
      case "card": return `card:${p.chapter}`;
      case "scene": case "choice": case "fire": return `${ph}:${p.chapter}:${p.step}`;
      case "flip": return `flip:${p.chapter}:${p.step}`;
      case "mini": return `mini:${p.chapter}:${p.step}:${n}`;
      case "miniResult": return `miniResult:${p.chapter}:${p.step}:${p.miniResult && p.miniResult.nonce != null ? p.miniResult.nonce : n}`;
      case "fail": return `fail:${p.checkpoint ? p.checkpoint.chapterIdx : p.chapter}`;
      case "ending": return `ending:${endingId(c)}`;
      default: return "other:" + ph;
    }
  }
  function chromeFor(c) {
    const p = c.pub, ph = p.phase || "lobby", step = c.step || {};
    const o = { phase: ph, mood: "warm", hearth: null, hud: true, frost: "off" };
    switch (ph) {
      case "lobby": o.hud = false; break;
      case "title": o.mood = "cold"; o.hud = false; break;
      case "card": o.mood = moodNear(c.chapter, 0); o.hud = false; break;
      case "scene": o.mood = step.mood || moodNear(c.chapter, p.step); o.hearth = "md"; break;
      case "fire": { const d = p.fireChange && Number.isFinite(p.fireChange.delta) ? p.fireChange.delta : Number(step.delta) || 0; o.mood = d < 0 ? "cold" : moodNear(c.chapter, p.step); o.hearth = "md"; break; }
      case "choice": case "flip": o.mood = moodNear(c.chapter, p.step); o.hearth = "xs"; break;
      case "mini": o.mood = "warm"; o.hearth = null; o.hud = "compact"; break;
      case "miniResult": { const v = p.miniResult && (p.miniResult.verdict || (p.miniResult.logs < 0 ? "lose" : "win")); o.mood = v === "lose" ? "cold" : v === "meh" ? "tense" : "warm"; o.hearth = "xs"; break; }
      case "fail": o.mood = "cold"; o.hearth = "sm"; o.frost = "full"; o.hud = false; o.intensity = 0.02; break;
      case "ending": { const e = endingOf(c); o.mood = (e && e.mood) || "dawn"; o.hud = false; o.time = "06:00"; break; }
      default: o.hud = false;
    }
    return o;
  }
  function render(root, data) {
    if (!root) return;
    const S = shell(root);
    const c = ctxOf(data);
    const key = viewKey(c);
    const ph = c.pub.phase || "lobby";
    const make = (SS, cc) => (VIEWS[ph] || ((s, x) => VIEWS.plain(s, x, "Even geduld…")))(SS, cc);
    S.apply(c, chromeFor(c));
    S.setView(key, make, c);
    return S;
  }
  function destroy(root) { const S = root && INST.get(root); if (S) S.destroy(); }

  window.DVStoryUI = {
    render, destroy, fill, shell, ctxOf, viewKey,
    parts: { h, sv, keyed, avatar, timers, typewriter, crackle, tag, speaker, readyBlock, miniStage, resultHead, resultLines, resultPlayers, animateLogs, flyLogs, fireRow, embersCanvas, deltaText, listNames, setText, reduced, sfx, FIRE_COLORS, VIEWS, miniDef },
  };
})();
