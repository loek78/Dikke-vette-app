/*
 * kerst/ui.js — the screens of KERSTDROOM (SPEC-4 §6): title, solo setup, "Samen spelen", lobby, game HUD, pause,
 * results, help, plus input handling (tap/swipe on the canvas) and the multiplayer wiring on top of KerstNet (§4).
 * Uses (all optional while teammates are still building): KerstGame, KerstArt, KerstFX (via the game), KerstAudio, KerstNet,
 * DVNet, qrcode. Without them the screens still render with placeholders.
 * Test hook: window.__kerst = { game, state, session, ui, net }.
 */
(function () {
  "use strict";
  const W = window, D = document;
  const Art = W.KerstArt || null, Game = W.KerstGame || null, Audio = W.KerstAudio || null, Net = W.KerstNet || null;
  const $ = (sel, root) => (root || D).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || D).querySelectorAll(sel));
  const safe = (fn, dflt) => { try { return fn(); } catch (e) { return dflt; } };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const now = () => Date.now();
  const perfNow = () => (W.performance && W.performance.now ? W.performance.now() : Date.now());

  const FAMILY = (Net && Net.FAMILY) || ["Luke", "Viola", "Rivka", "Zara"];
  const ANIMALS = ["hert", "konijn", "vos", "uil"];
  const ANIMAL_NAMES = (Art && Art.NAMES) || { hert: "Vlok", konijn: "Pluis", vos: "Snuf", uil: "Oeki" };
  const ANIMAL_EMOJI = { hert: "🦌", konijn: "🐰", vos: "🦊", uil: "🦉" };
  const ANIMAL_KIND = { hert: "reekalfje", konijn: "konijn", vos: "vos", uil: "uil" };
  const DIFFS = [
    { id: "makkelijk", e: "😊", t: "Makkelijk", d: "rustig aan" },
    { id: "normaal", e: "🙂", t: "Normaal", d: "lekker rennen" },
    { id: "stoer", e: "😎", t: "Stoer", d: "heel snel!" },
  ];
  const DIFF_LABEL = { makkelijk: "Makkelijk", normaal: "Normaal", stoer: "Stoer" };
  const EVENT_TEXT = {
    noorderlicht: ["🌌 Noorderlicht!", "De sterren worden regenboogsterren"],
    sterrenregen: ["🌠 Sterrenregen!", "Tik op een grote ster en doe een wens"],
    snoepregen: ["🍬 Snoepregen!", "Pak zoveel snoep als je kunt"],
    peperkoek: ["🍪 Peperkoekwereld!", "Alles is van koek en suiker"],
    droomflip: ["🙃 Droomflip!", "Je rent over de hemel"],
    sneeuwbol: ["❄️ Sneeuwbol!", "Schudden… en +1 hartje"],
    rendiervlucht: ["🦌 Rendiervlucht!", "Tik om te fladderen"],
    reuzenboom: ["🎄 Reuzenboom!", "Stoot de kerstballen voor bonus"],
    schaatsbaan: ["⛸️ Schaatsbaan!", "Glad! Dubbel tikken = pirouette"],
    kerstman: ["🛷 De Kerstman!", "Vang het cadeautje"],
    sneeuwpop: ["⛄ Zingende sneeuwpop!", "Pak 5 belletjes op een rij"],
    finale: ["🎆 Finale!", "Vuurwerk voor iedereen"],
  };
  const LS = { fawn: "kerst:fawnName", profile: "kerst:profile", help: "kerst:helpSeen" };
  const SS_SESSION = "kerst:session";
  const lsGet = (k) => safe(() => localStorage.getItem(k), null);
  const lsSet = (k, v) => safe(() => (v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v)));
  const ssGet = (k) => safe(() => JSON.parse(sessionStorage.getItem(k) || "null"), null);
  const ssSet = (k, v) => safe(() => (v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v))));
  const reducedMotion = !!safe(() => W.matchMedia("(prefers-reduced-motion: reduce)").matches, false);

  // ---------- app state ----------
  const cleanName = (s) => (Net ? Net.cleanName(s) : String(s || "").trim().slice(0, 14));
  function loadProfile() {
    const p = safe(() => JSON.parse(lsGet(LS.profile) || "null"), null) || {};
    return { name: cleanName(p.name) || "", animal: ANIMALS.indexOf(p.animal) >= 0 ? p.animal : "hert", difficulty: DIFF_LABEL[p.difficulty] ? p.difficulty : "normaal" };
  }
  const U = {
    screen: "title", profile: loadProfile(), fawnName: cleanName(lsGet(LS.fawn)) || "Vlok", hat: null,
    game: null, gameRound: 0, multi: false, session: null, lastResult: null, resultsMode: null, ghostTimer: 0,
    moonTaps: [], joinLink: null, leaveArmed: 0, heroHappy: 0, sparks: [], busyCancel: null, testDur: null, waitTimer: 0, resultsKey: "",
  };
  const fawnName = () => U.fawnName || "Vlok";
  const animalName = (kind) => (kind === "hert" ? fawnName() : ANIMAL_NAMES[kind] || kind);
  function saveProfile() { lsSet(LS.profile, JSON.stringify(U.profile)); }
  const netProfile = () => Object.assign({}, U.profile, { fawnName: fawnName() });
  // what to call a player's animal: their own fawn name travels with their profile
  const playerAnimalName = (p) => (p.animal === "hert" ? (p.fawnName || (U.session && p.pid === U.session.pid ? fawnName() : "Vlok")) : animalName(p.animal));

  // ---------- tiny DOM helpers ----------
  function h(tag, attrs) {
    const el = D.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach((x) => x != null && x !== false && el.append(x));
      else el.append(c);
    }
    return el;
  }
  let toastT = 0;
  function toast(msg, ms) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove("is-on"), ms || 2600);
  }
  function busy(text, sub, onCancel) {
    const el = $("#busy");
    if (!text) { el.classList.remove("is-on"); U.busyCancel = null; return; }
    $("#busyText").textContent = text;
    $("#busySub").textContent = sub || "";
    const c = $("#busyCancel");
    U.busyCancel = onCancel || null;
    c.hidden = !onCancel;
    el.classList.add("is-on");
  }
  $("#busyCancel").addEventListener("click", () => { const fn = U.busyCancel; busy(null); if (fn) fn(); });
  function overlay(id, on) { $("#" + id).classList.toggle("is-on", !!on); }
  function show(name) {
    U.screen = name;
    D.body.dataset.screen = name;
    for (const s of $$(".kd-scr")) s.classList.toggle("is-on", s.dataset.scr === name);
    const scr = $(`.kd-scr[data-scr="${name}"]`);
    if (scr) scr.scrollTop = 0;
    if (name !== "game") { overlay("pauseOverlay", false); }
    bgNeeded();
  }
  function vibrate(p) { safe(() => navigator.vibrate && navigator.vibrate(p)); }
  function audioInit() { if (Audio && Audio.init) safe(() => Audio.init()); }
  function sfx(name) { if (Audio && Audio.play) safe(() => Audio.play(name)); }
  D.addEventListener("pointerdown", audioInit, { capture: true, passive: true });

  // ---------- background: droombos (KerstArt parallax) + snow ----------
  const BG = { cv: $("#bg"), ctx: null, raf: 0, last: 0, flakes: [], w: 0, h: 0, dpr: 1, t: 0 };
  BG.ctx = BG.cv.getContext("2d");
  const PAR = [0, 0.12, 0.3, 0.55, 0.85];
  function bgResize() {
    const w = W.innerWidth, hh = W.innerHeight;
    BG.dpr = Math.min(2, W.devicePixelRatio || 1);
    if (BG.w !== w || BG.h !== hh) {
      BG.w = w; BG.h = hh;
      BG.cv.width = Math.round(w * BG.dpr); BG.cv.height = Math.round(hh * BG.dpr);
      BG.flakes = [];
      for (let i = 0; i < 70; i++) BG.flakes.push({ x: Math.random() * w, y: Math.random() * hh, r: 1.2 + Math.random() * 2.6, v: 18 + Math.random() * 30, ph: Math.random() * 6.3, a: 0.45 + Math.random() * 0.5 });
    }
  }
  function bgNeeded() {
    const need = U.screen !== "game" && !D.hidden;
    if (need && !BG.raf) { BG.last = 0; BG.raf = W.requestAnimationFrame(bgFrame); }
    if (!need && BG.raf) { W.cancelAnimationFrame(BG.raf); BG.raf = 0; }
  }
  function bgFrame(ts) {
    BG.raf = W.requestAnimationFrame(bgFrame);
    if (BG.last && ts - BG.last < 31) return; // ~30 fps is genoeg voor een achtergrond
    const dt = BG.last ? Math.min(0.1, (ts - BG.last) / 1000) : 0.016;
    BG.last = ts; BG.t += dt;
    bgResize();
    const ctx = BG.ctx, w = BG.w, hh = BG.h, t = BG.t;
    ctx.setTransform(BG.dpr, 0, 0, BG.dpr, 0, 0);
    const title = U.screen === "title";
    const hero = title ? $("#heroVlok").getBoundingClientRect() : null;
    const groundY = hero ? hero.bottom + 4 : hh * 0.84;
    if (Art && Art.background) {
      Art.groundPx = groundY; Art.dpr = BG.dpr;
      Art.moonWink = U.moonWinkUntil > t;
      const scroll = t * 22;
      try { for (let l = 0; l <= 4; l++) Art.background(ctx, l, scroll * PAR[l], w, hh, t, "nacht"); } catch (e) { bgFallback(ctx, w, hh); }
      if (hero && Art.animal) {
        ctx.save(); ctx.translate(hero.left + hero.width * 0.5, groundY);
        const scale = clamp(hero.height / 112, 0.8, 2.6);
        const happy = U.heroHappy > t;
        safe(() => Art.animal(ctx, "hert", happy ? "happy" : "idle", t, { scale, facing: 1, hat: U.hat, blush: happy }));
        ctx.restore();
      }
      // maan-knop over de getekende maan leggen (geheimpje)
      if (title && Art.moonAt) {
        const m = Art.moonAt(w, hh), btn = $("#moonBtn");
        const r = Math.max(48, m.r + 14);
        btn.style.left = (m.x - r) + "px"; btn.style.top = (m.y - r) + "px"; btn.style.width = btn.style.height = (r * 2) + "px";
        btn.classList.remove("kd-moon-emoji"); btn.textContent = "";
      }
    } else {
      bgFallback(ctx, w, hh);
      if (title) { const btn = $("#moonBtn"); btn.classList.add("kd-moon-emoji"); btn.textContent = "🌙"; btn.style.left = (w * 0.78 - 48) + "px"; btn.style.top = (hh * 0.14 - 48) + "px"; btn.style.width = btn.style.height = "96px"; }
      if (hero) { ctx.font = `${Math.round(hero.height * 0.7)}px system-ui`; ctx.textAlign = "center"; ctx.fillText("🦌", hero.left + hero.width / 2, hero.bottom - 6); }
    }
    // sneeuw
    ctx.fillStyle = "#fff";
    for (const f of BG.flakes) {
      f.y += f.v * dt; f.x += Math.sin(t * 0.8 + f.ph) * 14 * dt;
      if (f.y > hh + 4) { f.y = -4; f.x = Math.random() * w; }
      if (f.x < -4) f.x = w + 4; else if (f.x > w + 4) f.x = -4;
      ctx.globalAlpha = f.a; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // vonkjes van het geheimpje
    for (let i = U.sparks.length - 1; i >= 0; i--) {
      const s = U.sparks[i]; s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 240 * dt;
      if (s.life <= 0) { U.sparks.splice(i, 1); continue; }
      ctx.globalAlpha = clamp(s.life, 0, 1); ctx.fillStyle = s.col; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function bgFallback(ctx, w, hh) {
    const g = ctx.createLinearGradient(0, 0, 0, hh);
    g.addColorStop(0, "#070d2a"); g.addColorStop(0.55, "#182666"); g.addColorStop(1, "#3b4a9a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = "#eef3ff"; ctx.fillRect(0, hh * 0.84, w, hh);
  }
  W.addEventListener("resize", bgResize);
  D.addEventListener("visibilitychange", bgNeeded);

  // ---------- animal mini-canvases (pickers, lobby, results, HUD) ----------
  const live = new Set();
  function paintAnimal(cv, kind, anim, t, o) {
    if (!Art || !Art.animal) return false;
    const w = cv.clientWidth || cv.width || 64, hh = cv.clientHeight || cv.height || 64;
    const d = Math.min(2, W.devicePixelRatio || 1);
    const bw = Math.round(w * d), bh = Math.round(hh * d);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, hh);
    ctx.save(); ctx.translate(w * 0.47, hh * 0.9);
    const ok = safe(() => { Art.animal(ctx, kind, anim, t, { scale: (o && o.scale) || hh / 118, facing: 1, hat: o && o.hat, blush: !!(o && o.blush) }); return true; }, false);
    ctx.restore();
    return ok;
  }
  // avatar(kind, { size, live, anim, hat }) → canvas (or emoji span without KerstArt)
  function avatar(kind, o) {
    o = o || {};
    if (!Art || !Art.animal) return h("span", { class: o.cls || "kd-av-emoji", text: ANIMAL_EMOJI[kind] || "🦌", "aria-hidden": "true" });
    const cv = h("canvas", { "aria-hidden": "true" });
    cv.dataset.kind = kind; cv.dataset.anim = o.anim || "idle";
    if (o.hat) cv.dataset.hat = o.hat;
    if (o.live) { live.add(cv); cv.dataset.live = "1"; }
    W.requestAnimationFrame(() => paintAnimal(cv, kind, cv.dataset.anim, 0.4, { hat: o.hat }));
    return cv;
  }
  let liveLast = 0;
  function liveFrame(ts) {
    W.requestAnimationFrame(liveFrame);
    if (ts - liveLast < 50 || D.hidden || U.screen === "game") return; // 20 fps
    liveLast = ts;
    const t = ts / 1000;
    for (const cv of live) {
      if (!cv.isConnected) { live.delete(cv); continue; }
      if (!cv.offsetParent) continue;
      paintAnimal(cv, cv.dataset.kind, cv.dataset.anim, t, { hat: cv.dataset.hat || null, blush: cv.dataset.anim === "happy" });
    }
  }
  W.requestAnimationFrame(liveFrame);

  // ---------- pickers ----------
  // Name chips: Luke · Viola · Rivka · Zara + "Anders…" (free text)
  function renderNames(box) {
    box.replaceChildren();
    const wrap = box.parentElement.querySelector(".kd-name-field"), input = wrap.querySelector("input");
    const isFamily = FAMILY.indexOf(U.profile.name) >= 0;
    for (const n of FAMILY) {
      box.append(h("button", { class: "kd-chip" + (U.profile.name === n ? " is-on" : ""), type: "button", "data-name": n, text: n, onclick: () => { U.profile.name = n; saveProfile(); wrap.hidden = true; renderNames(box); if (U.session) U.session.send("set", { name: n }); } }));
    }
    const other = !isFamily && !!U.profile.name;
    box.append(h("button", { class: "kd-chip kd-chip-ghost" + (other || !wrap.hidden ? " is-on" : ""), type: "button", "data-name": "", text: "✏️ Anders…", onclick: () => { wrap.hidden = false; input.value = isFamily ? "" : U.profile.name; input.focus(); renderNames(box); } }));
    if (other) { wrap.hidden = false; if (input.value !== U.profile.name && D.activeElement !== input) input.value = U.profile.name; }
  }
  for (const input of $$("[data-name-input]")) input.addEventListener("input", (e) => {
    U.profile.name = cleanName(e.target.value); saveProfile();
    for (const b of $$("[data-names] .kd-chip[data-name]")) b.classList.toggle("is-on", !!b.dataset.name && b.dataset.name === U.profile.name);
  });
  function renderAnimals(box) {
    box.replaceChildren();
    for (const kind of ANIMALS) {
      const on = U.profile.animal === kind;
      const card = h("button", { class: "kd-animal" + (on ? " is-on" : ""), type: "button", "data-animal": kind, "aria-pressed": on ? "true" : "false" },
        avatar(kind, { live: true, anim: on ? "happy" : "idle", hat: kind === "hert" ? U.hat : null, cls: "kd-animal-emoji" }),
        h("div", { class: "kd-animal-txt" }, h("b", { text: animalName(kind) }), h("small", { text: ANIMAL_KIND[kind] })));
      card.addEventListener("click", () => { U.profile.animal = kind; saveProfile(); sfx("twinkle"); for (const b of $$("[data-animals]")) renderAnimals(b); for (const b of $$("[data-diff]")) renderDiffs(b); if (U.session) U.session.send("set", { animal: kind }); });
      box.append(card);
    }
  }
  // Wat betekent de keuze? Eén regel onder de knoppen (past op elk scherm, met de naam van je vriendje)
  const DIFF_NOTE = {
    makkelijk: () => `Rustig aan: ${animalName(U.profile.animal)} helpt je met springen en bukken.`,
    normaal: () => "Lekker rennen: zelf springen en glijden.",
    stoer: () => "Heel snel! Voor echte droomrenners.",
  };
  function renderDiffs(box) {
    box.replaceChildren();
    for (const d of DIFFS) {
      const on = U.profile.difficulty === d.id;
      box.append(h("button", { class: on ? "is-on" : "", type: "button", "data-diff": d.id, "aria-pressed": on ? "true" : "false", title: d.d, onclick: () => { U.profile.difficulty = d.id; saveProfile(); for (const b of $$("[data-diff]")) renderDiffs(b); if (U.session) U.session.send("set", { difficulty: d.id }); } },
        h("span", { text: d.e }), d.t));
    }
    let note = box.nextElementSibling;
    if (!note || !note.classList.contains("kd-diff-note")) { note = h("p", { class: "kd-diff-note" }); box.after(note); }
    note.textContent = DIFF_NOTE[U.profile.difficulty] ? DIFF_NOTE[U.profile.difficulty]() : "";
  }
  function renderPickers() {
    for (const b of $$("[data-names]")) renderNames(b);
    for (const b of $$("[data-animals]")) renderAnimals(b);
    for (const b of $$("[data-diff]")) renderDiffs(b);
  }

  // ---------- title: fawn name, mute, moon, help ----------
  function renderFawnName() { for (const el of $$("[data-fawn-name]")) el.textContent = fawnName(); }
  function setFawnName(name) {
    U.fawnName = cleanName(name).slice(0, 12) || "Vlok";
    lsSet(LS.fawn, U.fawnName === "Vlok" ? null : U.fawnName);
    renderFawnName(); renderPickers();
    if (U.session) U.session.send("set", { fawnName: U.fawnName });
  }
  $("#fawnEdit").addEventListener("click", () => { $("#fawnInput").value = U.fawnName === "Vlok" ? "" : U.fawnName; overlay("nameOverlay", true); setTimeout(() => $("#fawnInput").focus(), 50); });
  $("#btnFawnOk").addEventListener("click", () => { setFawnName($("#fawnInput").value); overlay("nameOverlay", false); toast(`💛 ${fawnName()}! Wat een lieve naam`); sfx("twinkle"); });
  $("#btnFawnCancel").addEventListener("click", () => overlay("nameOverlay", false));
  $("#fawnInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnFawnOk").click(); });

  function renderMute() { const b = $("#btnMute"); const m = !!(Audio && Audio.muted); b.textContent = m ? "🔇" : "🔊"; b.setAttribute("aria-label", m ? "Geluid aanzetten" : "Geluid uitzetten"); }
  $("#btnMute").addEventListener("click", () => { if (!Audio) { toast("Geluid komt nog 🎵"); return; } audioInit(); Audio.setMuted(!Audio.muted); renderMute(); toast(Audio.muted ? "🔇 Geluid uit" : "🔊 Geluid aan", 1400); });

  function moonTap() {
    const t = now();
    U.moonTaps = U.moonTaps.filter((x) => t - x < 2500); U.moonTaps.push(t);
    U.moonWinkUntil = BG.t + 1.1;
    const btn = $("#moonBtn"); btn.classList.remove("kd-moon-wink"); void btn.offsetWidth; btn.classList.add("kd-moon-wink");
    sfx("tick");
    if (U.moonTaps.length >= 3) {
      U.moonTaps = [];
      U.hat = U.hat ? null : "kerstmuts";
      const r = btn.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      for (let i = 0; i < 26; i++) { const a = Math.random() * 6.2832, v = 60 + Math.random() * 180; U.sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, r: 2 + Math.random() * 3, life: 0.7 + Math.random() * 0.6, col: ["#ffd14f", "#fff", "#ffe9a8", "#e8465a"][i % 4] }); }
      sfx("twinkle"); vibrate([10, 30, 10]);
      toast(U.hat ? `🎅 Psst… ${fawnName()} krijgt een kerstmuts!` : `De maan knipoogt… ${fawnName()} zet de muts weer af 😉`, 3000);
      renderPickers();
    }
  }
  $("#moonBtn").addEventListener("click", moonTap);
  $("#heroVlok").style.pointerEvents = "auto";
  $("#heroVlok").addEventListener("pointerdown", () => { U.heroHappy = BG.t + 1.6; sfx("star"); vibrate(8); });

  function drawHelpPictures() {
    for (const cv of $$("canvas[data-help]")) {
      const ctx = cv.getContext("2d"), w = cv.width, hh = cv.height, kind = cv.dataset.help;
      ctx.clearRect(0, 0, w, hh);
      ctx.fillStyle = "#f6fbff"; ctx.fillRect(0, hh - 24, w, 24);
      ctx.fillStyle = "#dfe9ff"; ctx.fillRect(0, hh - 16, w, 16);
      const sprite = (name, x, y, o) => { if (!Art || !Art.sprite) return; ctx.save(); ctx.translate(x, y); safe(() => Art.sprite(ctx, name, 0, o || {})); ctx.restore(); };
      const animal = (anim, x, y, s) => { ctx.save(); ctx.translate(x, y); if (Art && Art.animal) safe(() => Art.animal(ctx, "hert", anim, 1.2, { scale: s, facing: 1, blush: anim === "happy" })); else { ctx.font = "48px system-ui"; ctx.textAlign = "center"; ctx.fillText("🦌", 0, 0); } ctx.restore(); };
      if (kind === "jump") { sprite("log", w * 0.62, hh - 24, { scale: 1.0 }); animal("jump", w * 0.42, hh - 86, 0.8); ctx.font = "30px system-ui"; ctx.textAlign = "center"; ctx.fillText("👆", w * 0.84, 44); }
      else if (kind === "slide") { sprite("icicles", w * 0.5, 38, { scale: 1.2 }); animal("slide", w * 0.5, hh - 24, 0.82); ctx.font = "30px system-ui"; ctx.textAlign = "center"; ctx.fillText("👇", w * 0.86, hh - 40); }
      else { animal("happy", w * 0.34, hh - 24, 0.8); for (let i = 0; i < 3; i++) sprite("star", w * 0.62 + i * 40, 60 + (i % 2) * 28, { scale: 0.9 }); sprite("candyCane", w * 0.9, 52, { scale: 0.8 }); }
    }
  }
  $("#btnHelp").addEventListener("click", () => { drawHelpPictures(); overlay("helpOverlay", true); });
  $("#btnHelpOk").addEventListener("click", () => { overlay("helpOverlay", false); lsSet(LS.help, "1"); const fn = afterHelp; afterHelp = null; if (fn) fn(); });

  // ---------- navigation ----------
  for (const b of $$("[data-back]")) b.addEventListener("click", () => show("title"));
  $("#btnPlay").addEventListener("click", () => { renderPickers(); show("setup"); });
  let afterHelp = null;
  $("#btnSoloStart").addEventListener("click", () => {
    if (!lsGet(LS.help)) { afterHelp = () => startSolo(); drawHelpPictures(); overlay("helpOverlay", true); return; } // eerste keer: eerst even uitleggen
    startSolo();
  });
  $("#btnTogether").addEventListener("click", () => { renderPickers(); show("together"); });

  // ---------- GAME ----------
  const HUD = {
    stars: $("#hudStars span"), starsPill: $("#hudStars"), hearts: $("#hudHearts"), meters: $("#hudMeters"), combo: $("#hudCombo"),
    droom: $("#hudDroom"), droomFill: $("#hudDroomFill"), droomPct: $("#hudDroomPct"), ghosts: $("#hudGhosts"),
    banner: $("#banner"), count: $("#countdown"), prompt: $("#prompt"), pw: $("#hudPw"),
  };
  let hud = { stars: -1, hearts: -1, meters: -1, combo: -1, count: null, prompt: null, paused: null, pw: null, droom: -1, raf: 0, last: 0, bannerT: 0 };
  function resetHud() {
    hud = Object.assign(hud, { stars: -1, hearts: -1, meters: -1, combo: -1, count: null, prompt: null, paused: null, pw: null, droom: -1 });
    HUD.stars.textContent = "0"; HUD.meters.textContent = "0 m"; HUD.combo.classList.remove("is-on");
    renderHearts(3, false);
    HUD.count.classList.remove("is-on"); HUD.prompt.classList.remove("is-on"); HUD.pw.classList.remove("is-on"); HUD.banner.classList.remove("is-on");
    HUD.droom.classList.toggle("is-on", U.multi); HUD.droom.classList.remove("is-full");
    HUD.droomFill.style.transform = "scaleX(0)"; HUD.droomPct.textContent = "0%";
    HUD.ghosts.replaceChildren(); ghostChips.clear();
  }
  function renderHearts(n, lost) {
    HUD.hearts.replaceChildren();
    for (let i = 0; i < 3; i++) HUD.hearts.append(h("span", { class: (i < n ? "" : "is-off") + (lost && i === n ? " kd-lost" : ""), text: "❤️" }));
  }
  function banner(title, sub, ms) {
    HUD.banner.querySelector("b").textContent = title;
    HUD.banner.querySelector("span").textContent = sub || "";
    HUD.banner.classList.remove("is-on"); void HUD.banner.offsetWidth; HUD.banner.classList.add("is-on");
    clearTimeout(hud.bannerT);
    hud.bannerT = setTimeout(() => HUD.banner.classList.remove("is-on"), ms || 2600);
  }
  function applyStats(s) {
    if (s.stars !== hud.stars) { if (s.stars > hud.stars && hud.stars >= 0) { HUD.starsPill.classList.remove("kd-bump"); void HUD.starsPill.offsetWidth; HUD.starsPill.classList.add("kd-bump"); } hud.stars = s.stars; HUD.stars.textContent = String(s.stars); }
    if (s.hearts !== hud.hearts) { renderHearts(s.hearts, s.hearts < hud.hearts); hud.hearts = s.hearts; }
    if (s.meters !== hud.meters) { hud.meters = s.meters; HUD.meters.textContent = s.meters + " m"; }
    if (s.combo !== hud.combo) { hud.combo = s.combo; HUD.combo.textContent = s.combo >= 3 ? `×${s.combo} combo!` : ""; HUD.combo.classList.toggle("is-on", s.combo >= 3); }
    const pw = s.powerup;
    if (pw) {
      if (hud.pw !== pw.id) { hud.pw = pw.id; HUD.pw.querySelector(".kd-pw-icon").textContent = pw.icon || "✨"; HUD.pw.querySelector(".kd-pw-label").textContent = pw.label || pw.id; HUD.pw.style.setProperty("--pw", (Game && Game.POWERUPS[pw.id] && Game.POWERUPS[pw.id].color) || "#ffd14f"); HUD.pw.classList.add("is-on"); }
      HUD.pw.querySelector(".kd-pw-bar i").style.transform = `scaleX(${clamp(pw.left / pw.total, 0, 1)})`;
    } else if (hud.pw) { hud.pw = null; HUD.pw.classList.remove("is-on"); }
    if (U.multi && typeof s.droomster === "number" && s.droomster !== hud.droom) setDroomsterHud(s.droomster);
  }
  function setDroomsterHud(frac) {
    hud.droom = frac;
    HUD.droomFill.style.transform = `scaleX(${clamp(frac, 0, 1)})`;
    HUD.droomPct.textContent = Math.round(frac * 100) + "%";
    HUD.droom.classList.toggle("is-full", frac >= 1);
  }
  function hudFrame(ts) {
    hud.raf = W.requestAnimationFrame(hudFrame);
    if (!U.game || ts - hud.last < 45) return; // ~20 Hz
    hud.last = ts;
    const st = safe(() => U.game.state, null);
    if (!st) return;
    applyStats(st);
    // aftellen
    const cd = st.countdown != null && st.countdown > 0 && (st.phase === "countdown" || st.paused === false) ? Math.min(3, Math.ceil(st.countdown)) : null; // altijd 3-2-1, ook als de start iets verder weg ligt
    const cdKey = cd == null ? null : st.phase === "countdown" && st.countdown < 0.35 ? "go" : String(cd);
    if (cdKey !== hud.count) {
      hud.count = cdKey;
      HUD.count.classList.toggle("is-on", cdKey != null);
      if (cdKey != null) { const b = HUD.count.querySelector("b"); b.textContent = cdKey === "go" ? "Rennen!" : cdKey; b.classList.toggle("kd-go", cdKey === "go"); HUD.count.querySelector("span").textContent = st.phase === "countdown" ? "Klaar?" : "Daar gaan we weer"; }
    }
    // "Tik om verder te dromen" / "Goedemorgen!"
    const pr = st.phase === "fading" ? "fading" : st.phase === "ending" ? "ending" : null;
    if (pr !== hud.prompt) {
      hud.prompt = pr;
      HUD.prompt.classList.toggle("is-on", !!pr);
      if (pr === "fading") { HUD.prompt.querySelector("small").textContent = "Je wordt bijna wakker…"; HUD.prompt.querySelector("b").textContent = "Tik om verder te dromen"; HUD.prompt.querySelector(".kd-finger").hidden = false; }
      if (pr === "ending") { HUD.prompt.querySelector("small").textContent = "De droom vervaagt…"; HUD.prompt.querySelector("b").textContent = "Goedemorgen!"; HUD.prompt.querySelector(".kd-finger").hidden = true; }
    }
    if (st.paused !== hud.paused) { hud.paused = st.paused; overlay("pauseOverlay", !!st.paused); }
  }

  // Input: tap = jump (also tap in the air), swipe down = slide, swipe up = jump. Big and forgiving: a swipe is recognised
  // after 18 px within 90 ms, otherwise it's a tap (fired on release or after 90 ms, whichever comes first).
  function bindInput(canvas) {
    let p = null;
    const SWIPE = 18, DECIDE_MS = 90;
    const send = (type, detail) => { if (U.game) U.game.input(type, detail); };
    const tapNow = () => { if (!p || p.decided) return; p.decided = "tap"; clearTimeout(p.timer); const r = canvas.getBoundingClientRect(); send("tap", { x: p.x0 - r.left, y: p.y0 - r.top }); };
    const down = (e) => {
      if (p || (e.button != null && e.button !== 0)) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: perfNow(), decided: null, swiped: false, timer: setTimeout(tapNow, DECIDE_MS) };
      safe(() => canvas.setPointerCapture(e.pointerId));
      e.preventDefault();
    };
    const move = (e) => {
      if (!p || e.pointerId !== p.id) return;
      const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
      if (!p.decided) {
        if (Math.abs(dy) >= SWIPE && Math.abs(dy) > Math.abs(dx)) { p.decided = dy > 0 ? "down" : "up"; clearTimeout(p.timer); send(dy > 0 ? "swipeDown" : "swipeUp"); }
        else if (Math.abs(dx) >= 40) tapNow(); // horizontaal geveegd: tellen als tik
      } else if (p.decided === "tap" && !p.swiped && dy >= 40 && Math.abs(dy) > Math.abs(dx)) { p.swiped = true; send("swipeDown"); } // langzame veeg na een tik: toch glijden
    };
    const up = (e) => { if (!p || e.pointerId !== p.id) return; if (!p.decided) tapNow(); clearTimeout(p.timer); p = null; };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    const key = (e) => {
      if (!U.game || U.screen !== "game" || e.repeat) return;
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") { send("tap"); e.preventDefault(); }
      else if (e.code === "ArrowDown" || e.code === "KeyS") { send("swipeDown"); e.preventDefault(); }
      else if (e.code === "KeyP" || e.code === "Escape") { togglePause(); }
    };
    W.addEventListener("keydown", key);
    return () => { canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up); W.removeEventListener("keydown", key); };
  }
  let unbindInput = null;

  function startRun(cfg) {
    stopGame();
    U.multi = !!cfg.multi;
    U.lastResult = null;
    show("game");
    resetHud();
    const canvas = $("#game");
    const myName = cfg.name || (cfg.animal === "hert" ? fawnName() : ANIMAL_NAMES[cfg.animal]);
    if (!Game) { placeholderGame(canvas, myName); return; }
    U.game = Game.create(canvas, {
      seed: cfg.seed, difficulty: cfg.difficulty, animal: cfg.animal, name: myName, hat: U.hat, fawnName: fawnName(),
      durationSec: cfg.multi ? (cfg.durationSec > 0 ? cfg.durationSec : Net ? Net.DURATION_SEC : 90) : null,
      hooks: {
        onStats: applyStats,
        onPos: (pos) => { if (U.multi && U.session) U.session.publishPos(pos); },
        onEvent: onGameEvent,
        onEnd: onGameEnd,
        onCandyRain: () => { if (U.multi && U.session) U.session.publishEvt({ ev: "snoepregen" }); },
      },
    });
    U.gameRound = cfg.round || 0;
    unbindInput = bindInput(canvas);
    U.game.start(cfg.perfAt != null ? cfg.perfAt : perfNow() + 3300);
    if (!hud.raf) { hud.last = 0; hud.raf = W.requestAnimationFrame(hudFrame); }
    if (U.multi) startGhostSync();
  }
  function placeholderGame(canvas, name) {
    const ctx = canvas.getContext("2d"), w = canvas.clientWidth, hh = canvas.clientHeight;
    canvas.width = w; canvas.height = hh;
    const g = ctx.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, "#070d2a"); g.addColorStop(1, "#3b4a9a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "800 24px system-ui";
    ctx.fillText("Het droombos wordt nog gebouwd… 🚧", w / 2, hh * 0.45);
    ctx.font = "600 18px system-ui"; ctx.fillText(`${name} staat al klaar!`, w / 2, hh * 0.45 + 34);
    toast("Het spel zelf is er nog niet — de schermen wel 😊", 3000);
  }
  function onGameEvent(id, data) {
    data = data || {};
    if (id === "powerup") { banner(`${(Game && Game.POWERUPS[data.id] && Game.POWERUPS[data.id].icon) || "✨"} ${data.label || data.id}!`, powerupHint(data.id), 2200); return; }
    if (id === "wens") { banner("🌠 Wens vervuld!", `+${data.stars || 25} sterren`, 2000); return; }
    if (id === "revive") { banner("💫 Je droomt verder!", "Drie nieuwe hartjes", 2000); return; }
    if (id === "hartje") { banner("💖 Hartje terug!", `${Game ? Game.HEAL_STARS : 40} sterren gepakt — goed zo!`, 2000); return; }
    if (id === "melodie") { banner("🎵 Jingle Bells!", "Je kreeg een power-up", 2200); return; }
    if (id === "hurt") { vibrate(30); return; }
    if (id === "snoepregen" && data.external && data.by) { banner("🍬 Snoepregen!", `${data.by} laat het snoep regenen!`, 3000); return; }
    if (id === "finale" && U.multi) { banner("🎆 Finale!", data.reason === "droomster" ? "De Droomster is vol!" : "Vuurwerk voor iedereen", 3000); return; }
    const txt = EVENT_TEXT[id];
    if (txt) banner(txt[0], txt[1], 3000);
  }
  function powerupHint(id) {
    return { sneeuwbol: "Een bel beschermt je", sleetje: "Zoef over alles heen", rendiervlucht: "Tik om te fladderen", magneet: "Sterren komen naar je toe", dubbelsterren: "Alle sterren tellen dubbel", snoepregen: "Snoep voor iedereen!" }[id] || "";
  }
  function resultFromState(st) {
    return { stars: st.stars | 0, meters: Math.round(st.meters || 0), maxCombo: st.maxCombo | 0, candies: st.candies | 0, bells: st.bells | 0, gifts: st.gifts | 0, hearts: st.hearts | 0, revived: !!st.revived, name: st.name, animal: st.animal, difficulty: st.difficulty, seed: st.seed, stopped: true };
  }
  function onGameEnd(result) {
    U.lastResult = result;
    if (U.multi && U.session) {
      U.session.publishDone(result);
      setTimeout(() => { if (U.screen === "game" && U.multi) waitForOthers(result); }, 1200);
    } else {
      setTimeout(() => { if (U.lastResult === result) showResults("solo", { result }); }, 1500);
    }
  }
  // Vroeg wakker in een gezinsrun: de anderen dromen door tot de tijd om is — laat zien hoe lang nog
  function waitForOthers(result) {
    const tick = () => {
      if (U.screen !== "game" || !U.multi || !U.session) { clearInterval(U.waitTimer); U.waitTimer = 0; return; }
      const st = U.session.state;
      const dur = st && st.durationSec > 0 ? st.durationSec : Net ? Net.DURATION_SEC : 90;
      const left = st && st.phase === "run" && typeof st.startAt === "number" ? Math.ceil((st.startAt + dur * 1000 - U.session.hostNow()) / 1000) : 0;
      busy("Goedemorgen! ☀️", `Je droomde ${result.meters} m en pakte ${result.stars} sterren.` + (left > 0 ? ` De anderen dromen nog ${left} s door…` : " Even wachten op de anderen…"));
    };
    clearInterval(U.waitTimer); U.waitTimer = setInterval(tick, 1000); tick();
  }
  function stopGame() {
    if (U.game) { safe(() => U.game.destroy()); U.game = null; }
    if (unbindInput) { unbindInput(); unbindInput = null; }
    if (hud.raf) { W.cancelAnimationFrame(hud.raf); hud.raf = 0; }
    stopGhostSync();
    overlay("pauseOverlay", false);
  }
  function togglePause() { if (!U.game) return; const st = U.game.state; if (st.paused) U.game.resume(); else if (st.phase === "run" || st.phase === "finale") U.game.pause(); }
  $("#btnPause").addEventListener("click", () => { if (U.game) { U.game.pause(); sfx("tick"); } });
  $("#btnResume").addEventListener("click", () => { if (U.game) U.game.resume(); overlay("pauseOverlay", false); });
  $("#btnQuit").addEventListener("click", () => quitRun());
  function quitRun() {
    if (!U.game) { show("title"); return; }
    const st = safe(() => U.game.state, null);
    const result = st && st.result ? st.result : st ? resultFromState(st) : null;
    stopGame();
    if (U.multi && U.session) {
      if (result) { U.session.publishDone(result); U.lastResult = result; }
      const st2 = U.session.state;
      if (st2 && st2.phase === "results") showResults("multi", { state: st2 });
      else { show("lobby"); renderLobby(); busy("Goedemorgen! ☀️", "Even wachten tot de anderen klaar zijn…"); }
    } else if (result && result.meters >= 40) showResults("solo", { result }); // per ongeluk meteen gestopt → gewoon terug
    else show("title");
  }
  function startSolo(o) {
    o = o || {};
    if (o.animal) U.profile.animal = o.animal;
    if (o.difficulty) U.profile.difficulty = o.difficulty;
    saveProfile();
    const seed = o.seed != null ? o.seed : (Net ? Net.newSeed() : Math.floor(Math.random() * 1e9));
    startRun({ seed, difficulty: U.profile.difficulty, animal: U.profile.animal, multi: false, perfAt: o.perfAt });
  }

  // ---------- ghosts (multiplayer) ----------
  function startGhostSync() {
    stopGhostSync();
    U.ghostTimer = setInterval(syncGhosts, 100);
  }
  function stopGhostSync() { if (U.ghostTimer) { clearInterval(U.ghostTimer); U.ghostTimer = 0; } }
  const ghostChips = new Map(); // pid → { el, name, stars, asleep }
  function syncGhosts() {
    if (!U.game || !U.session) return;
    const list = U.session.ghosts(now());
    U.game.setGhosts(list.map((g) => ({ pid: g.pid, name: g.asleep ? g.name + " 😴" : g.name, animal: g.animal, x: g.x, y: g.y, anim: g.asleep ? "idle" : g.anim, stars: g.stars, hearts: g.hearts })));
    const seen = new Set();
    for (const g of list) {
      seen.add(g.pid);
      let c = ghostChips.get(g.pid);
      if (!c) {
        c = { el: h("span", { class: "kd-ghost", "data-pid": g.pid }, avatar(g.animal, { cls: "kd-g-emoji" }), h("span", { class: "kd-g-name" }), h("b")), name: null, stars: -1, asleep: null };
        ghostChips.set(g.pid, c); HUD.ghosts.append(c.el);
      }
      if (c.name !== g.name) { c.name = g.name; c.el.querySelector(".kd-g-name").textContent = g.name; }
      if (c.stars !== g.stars) { c.stars = g.stars; c.el.querySelector("b").textContent = "⭐" + g.stars; }
      if (c.asleep !== g.asleep) { c.asleep = g.asleep; c.el.classList.toggle("is-asleep", g.asleep); c.el.querySelector(".kd-g-name").textContent = g.asleep ? g.name + " 😴" : g.name; }
    }
    for (const [pid, c] of ghostChips) if (!seen.has(pid)) { c.el.remove(); ghostChips.delete(pid); }
  }

  // ---------- RESULTS ----------
  function showResults(mode, o) {
    stopGame();
    busy(null);
    U.resultsMode = mode;
    const body = $("#resBody");
    body.replaceChildren();
    const title = $("#resTitle"), lead = $("#resLead");
    const again = $("#btnAgain");
    if (mode === "solo") {
      const r = o.result;
      const myTitle = Net ? Net.assignMedals([Object.assign({ pid: "me" }, r)])[0] : { title: "Droomrenner", emoji: "🏃" };
      title.textContent = "Goedemorgen! ☀️";
      lead.replaceChildren(`Je droomde `, h("b", { text: `${r.meters} m` }), ` met ${r.name || animalName(r.animal)}`);
      body.append(
        h("div", { class: "kd-bigstats" },
          h("div", { class: "kd-bigstat" }, h("b", { text: "⭐ " + r.stars }), h("span", { text: "sterren" })),
          h("div", { class: "kd-bigstat" }, h("b", { text: "🍬 " + (r.candies | 0) }), h("span", { text: "snoep" })),
          h("div", { class: "kd-bigstat" }, h("b", { text: "🔔 " + (r.bells | 0) }), h("span", { text: "belletjes" })),
          h("div", { class: "kd-bigstat" }, h("b", { text: "🎁 " + (r.gifts | 0) }), h("span", { text: "cadeautjes" })),
          h("div", { class: "kd-bigstat" }, h("b", { text: "✨ " + (r.maxCombo | 0) }), h("span", { text: "beste combo" })),
          h("div", { class: "kd-bigstat" }, h("b", { text: "🌠 " + (r.wishes | 0) }), h("span", { text: "wensen" }))),
        h("div", { class: "kd-title-card" }, h("small", { text: "Jouw titel" }), h("b", { text: `${myTitle.emoji} ${myTitle.title}` })));
      if (r.events && r.events.length) body.append(h("p", { class: "kd-lead", style: { marginTop: "12px" }, text: "Verrassingen: " + uniq(r.events).map((e) => (EVENT_TEXT[e] ? EVENT_TEXT[e][0] : e)).join(" · ") }));
      again.disabled = false; again.textContent = "Nog een keer! 🔁";
      $("#lobbyNote").textContent = "";
    } else {
      const st = o.state;
      const ranking = st.ranking || (Net ? Net.assignMedals(st.results || {}, st.players) : []);
      const total = st.total || (Net ? Net.familyTotal(st.results || {}) : { stars: 0, meters: 0 });
      const me = U.session ? U.session.pid : null;
      title.textContent = "Jullie kerstdroom 🌟";
      lead.replaceChildren(`Samen `, h("b", { text: `${total.stars} ⭐` }), ` en `, h("b", { text: `${total.meters} m` }), ` gedroomd!`);
      const rows = h("div", { class: "kd-rank" });
      ranking.forEach((p, i) => {
        rows.append(h("div", { class: "kd-rank-row" + (p.pid === me ? " is-me" : "") + (p.rank === 1 ? " is-first" : ""), style: { "--i": i }, "data-pid": p.pid },
          h("div", { class: "kd-medal", text: p.medal || "🌟" }),
          avatar(p.animal || "hert", { anim: p.rank === 1 ? "happy" : "idle" }),
          h("div", { class: "kd-r-name", text: p.name + (p.pid === me ? " (jij)" : "") }),
          h("div", { class: "kd-r-title", text: `${p.emoji || "☃️"} ${p.title || "Droomvriend"}` }),
          h("div", { class: "kd-r-score" }, `⭐ ${p.stars}`, h("small", { text: `${p.meters} m` }))));
      });
      body.append(rows);
      const ds = st.droomster || { frac: 0 };
      const pct = Math.round((ds.frac || 0) * 100);
      body.append(h("div", { class: "kd-total" }, h("b", { text: pct >= 100 ? "De Droomster was helemaal vol! 🌟" : `De Droomster was ${pct}% vol` }),
        h("div", { class: "kd-droom-bar" }, h("div", { class: "kd-droom-fill", style: { transform: `scaleX(${clamp(ds.frac || 0, 0, 1)})` } })),
        h("div", { class: "kd-droom-label" }, h("span", { text: `${ds.sum | 0} van ${ds.target | 0} sterren samen` }))));
      const isHost = !!(U.session && U.session.isHost);
      again.disabled = !isHost;
      again.textContent = isHost ? "Nog een keer! 🔁" : `Wacht op ${hostName(st)}…`;
    }
    show("results");
    // dezelfde uitslag nog eens tekenen (state-update van de host) → geen tweede fanfare/confetti
    const key = mode + ":" + (o.state ? o.state.round + ":" + o.state.updatedAt : "solo:" + (o.result && o.result.seed));
    if (key !== U.resultsKey) { U.resultsKey = key; sfx("fanfare"); confetti(); }
  }
  const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
  function hostName(st) { const p = st && st.players && st.players[st.hostPid]; return p ? p.name : "de baas"; }
  $("#btnAgain").addEventListener("click", () => {
    if (U.resultsMode === "multi") { if (U.session && U.session.isHost) U.session.again(); return; }
    startSolo();
  });
  $("#btnResHome").addEventListener("click", () => { leaveSession(); show("title"); });
  // confetti: own tiny particle burst on #confetti (gold/red/green/pink)
  let confRaf = 0;
  function confetti() {
    if (reducedMotion) return;
    const cv = $("#confetti"), ctx = cv.getContext("2d");
    const w = W.innerWidth, hh = W.innerHeight, d = Math.min(2, W.devicePixelRatio || 1);
    cv.width = Math.round(w * d); cv.height = Math.round(hh * d);
    const ps = [];
    for (let i = 0; i < 120; i++) ps.push({ x: w / 2 + (Math.random() - 0.5) * 80, y: hh * 0.3, vx: (Math.random() - 0.5) * 520, vy: -200 - Math.random() * 420, r: 4 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, col: ["#ffd14f", "#e8465a", "#49b075", "#ff8ad6", "#6fd3ff", "#fff"][i % 6], life: 3 + Math.random() });
    let last = 0;
    cancelAnimationFrame(confRaf);
    const frame = (ts) => {
      const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts;
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, hh);
      let alive = 0;
      for (const p of ps) {
        p.life -= dt; if (p.life <= 0) continue; alive++;
        p.vy += 500 * dt; p.vx *= 0.995; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillStyle = p.col; ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2); ctx.restore();
      }
      if (alive && U.screen === "results") confRaf = W.requestAnimationFrame(frame); else ctx.clearRect(0, 0, w, hh);
    };
    confRaf = W.requestAnimationFrame(frame);
  }

  // ---------- MULTIPLAYER ----------
  function profileOk() {
    if (!U.profile.name) { toast("Kies eerst je naam 😊"); const chip = $("[data-names] .kd-chip"); if (chip) chip.focus(); return false; }
    return true;
  }
  function netMissing() { if (!Net || !W.DVNet) { toast("Samen spelen komt nog — de verbinding wordt nog gebouwd 🔧", 3200); return true; } return false; }
  $("#btnHost").addEventListener("click", () => { if (profileOk()) hostRoom(); });
  $("#btnJoin").addEventListener("click", () => {
    if (!profileOk()) return;
    if (U.joinLink) { joinRoom(U.joinLink.code, U.joinLink.b); return; }
    $("#codeInput").value = ""; overlay("joinOverlay", true); setTimeout(() => $("#codeInput").focus(), 50);
  });
  $("#btnJoinCancel").addEventListener("click", () => overlay("joinOverlay", false));
  $("#codeInput").addEventListener("input", (e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4); if (v !== e.target.value) e.target.value = v; });
  $("#codeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnJoinGo").click(); });
  $("#btnJoinGo").addEventListener("click", () => {
    const code = $("#codeInput").value.toUpperCase().replace(/[^A-Z]/g, "");
    if (code.length !== 4) { toast("Een code heeft 4 letters, bijvoorbeeld BAKO"); return; }
    overlay("joinOverlay", false);
    joinRoom(code, null);
  });

  async function hostRoom() {
    if (netMissing()) return;
    saveProfile();
    busy("Kamer maken…", "Even verbinden met het droombos");
    try {
      const s = await Net.createSession({ role: "host", profile: netProfile(), onStatus: setStatus, durationSec: U.testDur });
      adoptSession(s);
    } catch (e) { busy(null); toast("Dat lukte niet: " + friendlyError(e), 4000); }
  }
  async function joinRoom(code, preferIndex, pid) {
    if (netMissing()) return;
    saveProfile();
    code = String(code || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    let cancelled = false;
    busy(`Op zoek naar kamer ${code}…`, "Vraag of de baas de kamer open heeft", () => { cancelled = true; });
    try {
      const s = await Net.createSession({ role: "join", code, preferIndex: Number.isInteger(preferIndex) ? preferIndex : undefined, pid: pid || undefined, profile: netProfile(), onStatus: setStatus });
      if (cancelled) { s.close(); return; }
      U.joinLink = null; $("#joinHint").hidden = true; $("#btnJoin").textContent = "🔑 Meedoen"; $("#btnHost").hidden = false;
      adoptSession(s);
    } catch (e) { if (!cancelled) { busy(null); toast(friendlyError(e), 4500); } }
  }
  function friendlyError(e) {
    const c = e && e.code;
    if (c === "not_found") return `Kamer ${/[A-Z]{4}/.exec(e.message) ? /[A-Z]{4}/.exec(e.message)[0] : ""} is niet gevonden. Klopt de code? 🔎`;
    if (c === "no_host") return "De kamer reageert niet. Is de telefoon van de baas nog aan? 📵";
    if (c === "occupied") return "Die kamer is van iemand anders.";
    if (c === "bad_code") return "Een code heeft 4 letters.";
    return (e && e.message) || "Geen verbinding";
  }
  function setStatus(s) {
    const el = $("#netStatus");
    el.dataset.s = s;
    el.textContent = { online: "verbonden", connecting: "verbinden…", reconnecting: "opnieuw verbinden…", offline: "geen verbinding" }[s] || s;
  }
  function adoptSession(s) {
    leaveSession(true);
    U.session = s;
    ssSet(SS_SESSION, { role: s.isHost ? "host" : "join", code: s.code, pid: s.pid, brokerIndex: s.brokerIndex, profile: U.profile });
    setStatus(s.room && s.room.status || "online");
    s.on("status", setStatus);
    s.on("state", onState);
    s.on("evt", onEvt);
    s.on("droomster", (frac) => { if (U.game) U.game.setDroomster(frac); setDroomsterHud(frac); });
    s.on("left", () => { toast("De kamer is gesloten 🏠"); leaveSession(); show("title"); });
    s.on("presence", () => { if (U.screen === "lobby") renderLobby(); });
    busy(null);
    onState(s.state);
  }
  function leaveSession(silent) {
    const s = U.session;
    U.session = null;
    ssSet(SS_SESSION, null);
    stopGhostSync();
    if (s) { if (s.isHost) s.closeRoom().catch(() => {}); else s.close().catch(() => {}); }
    if (U.multi) { stopGame(); U.multi = false; }
    if (!silent) busy(null);
  }
  function onState(st) {
    if (!st || !U.session) return;
    if (st.phase === "closed") { toast("De kamer is gesloten 🏠"); leaveSession(); show("title"); return; }
    if (st.phase === "lobby") {
      if (U.game) stopGame();
      busy(null);
      if (U.screen !== "lobby") show("lobby");
      renderLobby();
      return;
    }
    if (st.phase === "run") {
      if (U.game && U.gameRound === st.round) return; // dezelfde ronde: alleen een state-update
      const late = U.session.hostNow() - st.startAt;
      if (late > 2500) { // we komen te laat (herladen tijdens de run): wachten op de uitslag
        if (U.screen !== "lobby") show("lobby");
        renderLobby();
        busy("Het spel is al bezig 🏃", "Wacht even… de uitslag komt zo!");
        return;
      }
      busy(null);
      const me = st.players[U.session.pid] || U.profile;
      startRun({ seed: st.seed, difficulty: me.difficulty, animal: me.animal, name: me.name, multi: true, perfAt: U.session.toPerf(st.startAt), round: st.round, durationSec: st.durationSec });
      return;
    }
    if (st.phase === "results") {
      if (U.game) { // onze run loopt nog (gepauzeerd?) → afronden met wat we hebben. Eerst het spel stoppen: op de host
        // geeft publishDone meteen een nieuwe state terug (opnieuw onState) en zonder lopend spel is dat geen lus.
        const gs = safe(() => U.game.state, null);
        const r = gs && !gs.result ? resultFromState(gs) : null;
        stopGame();
        if (r) U.session.publishDone(r);
      }
      showResults("multi", { state: (U.session && U.session.state) || st });
    }
  }
  // Team events from the room. publishEvt() also emits our OWN events locally: our snoepregen already rains (power-up),
  // so skip it; the finale must run on every phone, the host's included. Banners come from hooks.onEvent (data.external).
  function onEvt(evt) {
    if (!evt || !U.game || !U.session) return;
    if (evt.ev === "snoepregen") { if (evt.by !== U.session.pid) U.game.triggerEvent("snoepregen", { by: evt.name }); }
    else if (evt.ev === "finale") { const names = U.session.players.map((p) => p.name); U.game.triggerEvent("finale", { names, reason: evt.reason }); }
  }

  // ---------- LOBBY ----------
  let qrCode = "";
  function renderLobby() {
    const s = U.session; if (!s || !s.state) return;
    const st = s.state;
    $("#lobbyCode").textContent = st.code;
    if (qrCode !== st.code) { qrCode = st.code; renderQr(s.shareUrl()); }
    const me = s.pid;
    const box = $("#players");
    box.replaceChildren();
    for (const p of s.players) {
      const isMe = p.pid === me, isHost = p.pid === st.hostPid, off = p.online === false;
      const state = h("div", { class: "kd-p-state" });
      if (off) state.append(h("span", { class: "kd-wait", text: "even weg 😴" }));
      else if (isHost) state.append(h("span", { class: "kd-tag", text: "baas 👑" }));
      else if (p.ready) state.append(h("span", { class: "kd-ok", text: "✅" }), h("span", { text: "klaar!" }));
      else state.append(h("span", { class: "kd-wait", text: "nog niet klaar…" }));
      const row = h(isMe ? "button" : "div", { class: "kd-player" + (isMe ? " is-me" : "") + (off ? " is-off" : ""), "data-pid": p.pid, type: isMe ? "button" : null },
        avatar(p.animal, { anim: p.ready || isHost ? "happy" : "idle", hat: isMe && p.animal === "hert" ? U.hat : null }),
        h("div", {}, h("div", { class: "kd-p-name" }, p.name, isMe ? h("span", { class: "kd-tag kd-tag-me", text: "jij ✏️" }) : null), h("div", { class: "kd-p-sub", text: `${playerAnimalName(p)} · ${DIFF_LABEL[p.difficulty] || p.difficulty}` })),
        state);
      if (isMe) row.addEventListener("click", () => openProfileEdit());
      box.append(row);
    }
    const ready = $("#btnReady"), start = $("#btnStart"), note = $("#lobbyNote");
    if (s.isHost) {
      ready.hidden = true; start.hidden = false;
      const can = Net.canStart(st);
      start.disabled = !can.ok;
      start.textContent = can.solo ? "Alleen starten 🚀" : "Start! 🚀";
      start.classList.toggle("kd-btn-xl", false);
      const others = s.players.length - 1;
      note.textContent = can.ok ? (can.solo ? "Je kunt alleen beginnen, of wacht tot de rest meedoet" : `${s.players.filter((p) => p.ready && p.pid !== st.hostPid).length} van ${others} klaar — start wanneer je wilt!`) : can.reason;
    } else {
      start.hidden = true; ready.hidden = false;
      const mine = st.players[me];
      const isReady = !!(mine && mine.ready);
      ready.classList.toggle("is-on", isReady);
      ready.textContent = isReady ? "Ik ben klaar! ✅" : "Ik ben klaar!";
      note.textContent = isReady ? `Wachten tot ${hostName(st)} op Start tikt…` : "Tik als je er klaar voor bent";
    }
  }
  $("#btnReady").addEventListener("click", () => { const s = U.session; if (!s) return; const mine = s.state.players[s.pid]; s.send("set", { ready: !(mine && mine.ready) }); sfx("twinkle"); vibrate(10); });
  $("#btnStart").addEventListener("click", () => { const s = U.session; if (!s || !s.isHost) return; const can = Net.canStart(s.state); if (!can.ok) { toast(can.reason); return; } sfx("fanfare"); s.startRun(); });
  $("[data-leave]").addEventListener("click", () => {
    const t = now();
    if (t - U.leaveArmed < 3000) { U.leaveArmed = 0; leaveSession(); show("title"); return; }
    U.leaveArmed = t;
    toast(U.session && U.session.isHost ? "Nog een keer tikken om de kamer te sluiten" : "Nog een keer tikken om de kamer te verlaten", 2500);
  });
  $("#btnShare").addEventListener("click", async () => {
    const s = U.session; if (!s) return;
    const url = s.shareUrl();
    const text = `Doe mee met onze Kerstdroom! 🎄 Kamercode: ${s.code}`;
    if (navigator.share) { try { await navigator.share({ title: "Kerstdroom", text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(url); toast("Link gekopieerd 📋"); } catch (e) { toast(url, 6000); }
  });
  // QR as SVG (vendor/qrcode.js); EC level M, dark modules as rounded rects
  function renderQr(text) {
    const box = $("#lobbyQr");
    box.replaceChildren();
    if (typeof W.qrcode !== "function") { box.append(h("span", { text: "QR", style: { color: "#000", font: "800 20px system-ui", display: "block", textAlign: "center", lineHeight: "98px" } })); return; }
    try {
      const qr = W.qrcode(0, "M"); qr.addData(text); qr.make();
      const n = qr.getModuleCount();
      const NS = "http://www.w3.org/2000/svg";
      const svg = D.createElementNS(NS, "svg"); svg.setAttribute("viewBox", `0 0 ${n} ${n}`); svg.setAttribute("shape-rendering", "crispEdges");
      let d = "";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      const path = D.createElementNS(NS, "path"); path.setAttribute("d", d); path.setAttribute("fill", "#0b1340");
      svg.append(path); box.append(svg);
    } catch (e) { box.textContent = text; }
  }
  // edit own profile from the lobby: reuse the "together" pickers inside a dialog
  function openProfileEdit() {
    const dlg = $("#profileOverlay");
    renderPickers();
    overlay("profileOverlay", true);
    dlg.querySelector("[data-profile-ok]").onclick = () => { overlay("profileOverlay", false); if (U.session) U.session.send("set", netProfile()); };
  }

  // ---------- boot: deep link, rejoin ----------
  function boot() {
    renderFawnName(); renderMute(); renderPickers();
    bgResize(); bgNeeded();
    const q = new URLSearchParams(location.search);
    const join = (q.get("join") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    const b = parseInt(q.get("b"), 10);
    const dur = parseInt(q.get("dur"), 10); // tests: kortere multiplayer-run voor de kamer die deze telefoon maakt
    if (dur >= 15 && dur <= 600) U.testDur = dur;
    if (join.length === 4) {
      U.joinLink = { code: join, b: Number.isInteger(b) ? b : null };
      const hint = $("#joinHint"); hint.hidden = false; hint.textContent = `🎉 Je bent uitgenodigd voor kamer ${join}! Tik op "Samen spelen".`;
      $("#btnJoin").textContent = `🎉 Doe mee met ${join}`;
      $("#btnHost").hidden = true; // uitgenodigd: niet per ongeluk een eigen kamer maken
      safe(() => { q.delete("join"); q.delete("b"); const qs = q.toString(); history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "")); });
      renderPickers(); show("together");
      return;
    }
    const saved = ssGet(SS_SESSION);
    if (saved && saved.code && saved.pid && Net && W.DVNet) {
      if (saved.profile) U.profile = Object.assign(U.profile, saved.profile);
      busy("Terug naar de kamer…", `Kamer ${saved.code}`);
      const p = saved.role === "host"
        ? Net.createSession({ role: "host", code: saved.code, pid: saved.pid, preferIndex: saved.brokerIndex, profile: netProfile(), onStatus: setStatus, durationSec: U.testDur })
        : Net.createSession({ role: "join", code: saved.code, pid: saved.pid, preferIndex: saved.brokerIndex, profile: netProfile(), onStatus: setStatus, joinTimeoutMs: 8000 });
      p.then(adoptSession, (e) => { busy(null); ssSet(SS_SESSION, null); toast("De kamer is er niet meer: " + friendlyError(e), 3500); show("title"); });
    }
  }
  W.addEventListener("pagehide", () => { if (U.game && U.screen === "game") safe(() => U.game.pause()); });

  // ---------- test hook ----------
  W.__kerst = {
    get game() { return U.game; },
    get state() { return U.game ? U.game.state : null; },
    get session() { return U.session; },
    net: Net,
    ui: {
      get screen() { return U.screen; }, get profile() { return U.profile; }, get multi() { return U.multi; }, get hat() { return U.hat; }, get fawnName() { return fawnName(); },
      show, startSolo, hostRoom, joinRoom, leaveSession, quitRun, togglePause, moonTap, setFawnName, renderLobby, startRun, showResults,
      setProfile(p) { Object.assign(U.profile, p || {}); saveProfile(); renderPickers(); },
      input(type, detail) { if (U.game) U.game.input(type, detail); },
      pause() { if (U.game) U.game.pause(); }, resume() { if (U.game) U.game.resume(); },
      banner, toast,
    },
  };
  boot();
})();
