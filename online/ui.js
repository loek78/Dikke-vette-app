/*
 * Infiltrant online — schermen, host-loop en client-sessie (Dikke Vette App v2). Alleen browser.
 * Gebruikt window.DVA (app.js), DVInfiltrant (engine.js), DVNet (net.js), DV_WORDCATS/DV_WORDPAIRS (words.js), qrcode.
 *
 * Schermen: #online (profiel + kamer maken/meedoen + uitleg) en #room (rendert per state.phase).
 *
 * Lagen
 *   Controller (C + functies hieronder): sessie `dva:session`, outbox + retransmit elke 1500 ms (client),
 *     host-loop met de volledige engine-state in `dva:hostRoom` (publiceert publicView + gewijzigde privateViews),
 *     presence, wake lock, auto-resume na herladen.
 *   Render: renderRoom(vm) met vm = { pub, priv, me:{pid,key,isHost}, status, presence, host:{pendingWinner}|null,
 *     ended, pending:Set(t) }. Elke fase is een view { el, update(vm), mounted?(), destroy?() } die alleen opnieuw
 *     wordt gebouwd als viewKey(vm) verandert (dan met View Transition); anders alleen update().
 *   Preview: met ?preview=<fase> laadt dit bestand online/preview.js, die DVOnline.preview(vm) aanroept (geen netwerk).
 *
 * Stabiele selectors (voor e2e-tests)
 *   #online  [data-act=name] (input), [data-act=avatar][data-v], [data-act=color][data-v], [data-act=create],
 *            [data-act=code] (4 inputs), [data-act=join], [data-act=resume]
 *   #room    section[data-screen=room][data-phase=<fase>|connecting|ended], [data-room-code] (tekst = code),
 *            [data-act=start|share|leave|seen|peek|peek-card|hint-input|hint-send|hint-aloud|skip|force-vote|
 *            vote-pick (+data-pid)|vote-submit|close-vote|hints-sheet|guess-input|guess-send|next|again|to-lobby|
 *            exit|player (+data-pid)|kick|confirm|cancel|mode|seg-*|cat], [data-word] (geheime woord op de kaart)
 *   window.DVOnline.debug() → { pub, priv, me, status, outbox, presence }
 *   window.DVOnline.preview(vm) → render het kamerscherm met een vaste vm (alleen bij ?preview); DVOnline.qrSvg(text) → <svg>
 *
 * Preview (design-QA): ?preview=lobby|lobby-host|lobby-wait|reveal|reveal-blind-infiltrant|hints|hints-myturn|vote|
 *   vote-revote|voted-waiting|guess|guess-me|elim-infiltrant|elim-burger|elim-tie|over-burgers|over-infiltranten|
 *   connecting|closed|kicked  (+ &open=1 kaart open, &host=1 als host, &me=p3 als andere speler). Zie online/preview.js.
 */
(() => {
  "use strict";
  const DVA = window.DVA;
  const E = window.DVInfiltrant;
  const N = window.DVNet;
  if (!DVA || !E || !N) { console.error("online/ui.js: DVA, DVInfiltrant of DVNet ontbreekt"); return; }
  const { $, store, toast, confetti, hooks } = DVA;
  const active = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;
  const buzz = (p) => { if (active()) DVA.buzz(p); };
  const beep = (...a) => { if (active()) DVA.beep(...a); };
  const fanfare = () => { if (active()) DVA.fanfare(); };
  const CATS = window.DV_WORDCATS || {};
  const QS = new URLSearchParams(location.search);
  const PREVIEW = QS.get("preview");
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  const AVATARS = ["😎", "🤠", "🥸", "🤡", "👽", "🤖", "👻", "💀", "😈", "🧙", "🦊", "🐸",
    "🐼", "🐯", "🦁", "🐙", "🦄", "🐵", "🐷", "🐔", "🦖", "🍕", "🌮", "🔥"];
  const NEON = ["#ff2e93", "#ff8a00", "#ffe03d", "#9dff3d", "#00e0a4", "#22e6ff", "#5a8bff", "#8b5cff"];
  const HOST_TTL = 12 * 3600e3;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const plural = (n, one, more) => n + " " + (n === 1 ? one : more);

  // =========================================================
  // DOM-hulpjes (tekst altijd via textContent / text nodes)
  // =========================================================
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
  const ICONS = {
    exit: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10",
    share: "M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5",
    check: "M5 12.5 9.5 17 19 7.5",
    send: "M5 12h13M13 6l6 6-6 6",
    close: "M6 6l12 12M18 6 6 18",
    users: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3",
    play: "M8 5.5v13l10.5-6.5z",
    lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
    chat: "M4 5h16v11H9l-5 4z",
    skip: "M6 6l8 6-8 6zM17 6v12",
    copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  };
  function icon(name, cls) {
    return sv("svg", { viewBox: "0 0 24 24", class: "o-ic" + (cls ? " " + cls : ""), "aria-hidden": "true" }, sv("path", { d: ICONS[name] }));
  }
  function fingerprint() {
    const g = sv("svg", { viewBox: "0 0 48 48", class: "o-fp", "aria-hidden": "true" });
    ["M14 38c-3-4-4-8-4-13 0-8 6-14 14-14s14 6 14 14", "M18 41c-2-3-3-7-3-11 0-5 4-9 9-9s9 4 9 9c0 3-1 5-2 7",
      "M24 25c0 6 2 11 6 15", "M20 28c0 4 1 8 3 11", "M29 30c0 2 0 5 1 7", "M9 18c3-6 9-10 15-10 7 0 12 4 15 10",
      "M13 8c3-2 7-3 11-3s8 1 11 3"].forEach((d) => g.append(sv("path", { d })));
    return g;
  }

  // Lijst bijwerken op sleutel: bestaande elementen blijven staan (geen herhaalde animaties), nieuwe komen erbij.
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

  // Lettergrootte verkleinen tot de tekst in de breedte past.
  function fit(el, max, min = 13) {
    if (!el || !el.isConnected) return;
    let fs = max;
    el.style.fontSize = fs + "px";
    while (fs > min && el.scrollWidth > el.clientWidth + 1) { fs -= 1; el.style.fontSize = fs + "px"; }
  }
  const afterFonts = (fn) => { fn(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fn).catch(() => {}); };

  // Ingedrukt houden (pointer + toetsenbord). Release = loslaten, annuleren of focus kwijt.
  function hold(el, on, off) {
    let active = false;
    const up = () => { if (!active) return; active = false; off(); };
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      active = true;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* oud apparaat */ }
      on();
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => el.addEventListener(t, up));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    el.addEventListener("keydown", (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); if (!active) { active = true; on(); } }
    });
    el.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); up(); } });
    el.addEventListener("blur", up);
  }
  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  function shake(el) { if (el) restart(el, "o-shake"); buzz([20, 30, 20]); }

  // ---------- Geluid ----------
  const sfx = {
    tap: () => beep(640, 0.03, "sine", 0.05),
    pop: () => { beep(520, 0.05, "triangle", 0.08); beep(780, 0.08, "triangle", 0.07, 0.05); },
    turn: () => [660, 880, 1320].forEach((f, i) => beep(f, 0.13, "triangle", 0.1, i * 0.09)),
    lock: () => { beep(260, 0.06, "square", 0.04); beep(520, 0.14, "triangle", 0.09, 0.05); },
    tick: (i) => beep(420 + i * 22, 0.025, "square", 0.035),
    thud: () => { beep(120, 0.35, "sine", 0.3); beep(62, 0.5, "sine", 0.25, 0.03); },
    evil: () => { [196, 233, 277].forEach((f) => beep(f, 0.8, "sawtooth", 0.035)); beep(98, 0.9, "square", 0.05); },
    angel: () => [784, 988, 1175, 1568].forEach((f, i) => beep(f, 0.4, "sine", 0.07, i * 0.08)),
    whoosh: () => { for (let i = 0; i < 6; i++) beep(320 + i * 130, 0.05, "sine", 0.035, i * 0.022); },
    alarm: () => { beep(880, 0.12, "square", 0.045); beep(660, 0.14, "square", 0.045, 0.15); },
    sad: () => [392, 330, 262].forEach((f, i) => beep(f, 0.28, "triangle", 0.08, i * 0.17)),
  };

  // =========================================================
  // Opslag: profiel, sessie, host-kamer
  // =========================================================
  function drop(k) { try { localStorage.removeItem("dva:" + k); } catch (e) { /* privémodus */ } }
  function getProfile() {
    let p = store.get("profile", null);
    if (!p || typeof p !== "object" || !p.avatar || !p.color) {
      p = Object.assign({ name: "" }, p || {}, { avatar: (p && p.avatar) || pick(AVATARS), color: (p && p.color) || pick(NEON) });
      store.set("profile", p);
    }
    return { name: String(p.name || "").slice(0, 16), avatar: String(p.avatar), color: String(p.color) };
  }
  function setProfile(patch) { const p = Object.assign(getProfile(), patch); store.set("profile", p); return p; }

  // =========================================================
  // Controller
  // =========================================================
  const C = { session: null, room: null, status: "idle", pub: null, priv: null, presence: {}, outbox: [], host: null, ended: null, since: 0, leaving: false };
  let retxIv = null, retryT = null, unsubs = [], opening = null;
  const sentAt = new Map(); // seq → laatste verzendtijd (alleen in geheugen)
  // Engine-context van de host: echte tijd, de woordenlijst en een crypto-rng (rollen en woorden eerlijk verdeeld).
  const u32 = new Uint32Array(1);
  const rng = () => { try { crypto.getRandomValues(u32); return u32[0] / 4294967296; } catch (e) { return Math.random(); } };
  const ectx = () => ({ rng, now: Date.now(), words: window.DV_WORDPAIRS });

  function saveSession() {
    if (!C.session) return;
    C.session.outbox = C.outbox;
    store.set("session", C.session);
  }
  function saveHost() {
    if (!C.host || !C.session) return;
    const s = C.session;
    store.set("hostRoom", { code: s.code, brokerIndex: s.brokerIndex, brokerUrl: s.brokerUrl, state: C.host.state, savedAt: Date.now() });
  }
  function setStatus(s) { if (C.status !== s) { C.status = s; emit(); } }
  function hostDerive() {
    C.pub = E.publicView(C.host.state);
    C.priv = E.privateView(C.host.state, C.session.pid);
  }

  function openRoom(s) {
    if (opening) return opening;
    setStatus("connecting");
    opening = N.open({
      code: s.code, pid: s.pid, brokerUrl: s.brokerUrl, brokerIndex: s.brokerIndex,
      onStatus: (st) => { if (C.session === s) setStatus(st); },
    }).then((room) => {
      opening = null;
      if (C.session !== s) { room.close(); return null; }
      C.room = room;
      if (s.isHost) {
        unsubs.push(room.subscribeHost(hostReceive));
        unsubs.push(room.onReconnect(hostPublishAll));
        hostPublishAll();
      } else {
        unsubs.push(room.subscribeState(onState));
        unsubs.push(room.subscribePrivate(s.key, onPrivate));
        unsubs.push(room.onReconnect(() => flush(true)));
        flush(true);
      }
      unsubs.push(room.subscribePresence(onPresence));
      clearInterval(retxIv);
      retxIv = setInterval(() => flush(false), 1500);
      C.since = Date.now();
      wake();
      emit();
      return room;
    }, (err) => {
      opening = null;
      if (C.session === s) setStatus("offline");
      throw err;
    });
    return opening;
  }
  function connectLoop() {
    const s = C.session;
    if (!s || C.room) return;
    clearTimeout(retryT);
    openRoom(s).catch(() => { if (C.session === s && !C.room) retryT = setTimeout(connectLoop, 2500); });
  }

  // ---------- Host ----------
  function hostReceive(env) {
    if (!C.host || !env) return;
    let next;
    try { next = E.reduce(C.host.state, env, ectx()); } catch (e) { console.error(e); return; }
    if (next === C.host.state) return;
    const prev = C.host.state;
    C.host.state = next;
    hostDerive();
    saveHost();
    if (JSON.stringify(prev.settings) !== JSON.stringify(next.settings)) store.set("hostSettings", next.settings);
    if (C.room) { C.room.publishState(C.pub); hostPublishPrivates(false); }
    emit();
  }
  function hostPublishAll() {
    if (!C.room || !C.host) return;
    C.room.publishState(C.pub);
    hostPublishPrivates(true);
  }
  function hostPublishPrivates(force) {
    const st = C.host.state, last = C.host.lastPriv;
    for (const pid of Object.keys(st.keys)) {
      if (pid === st.hostPid) continue;
      const key = st.keys[pid];
      const view = E.privateView(st, pid);
      const json = view ? JSON.stringify(view) : null;
      if (!force && last[key] === json) continue;
      if (view) C.room.publishPrivate(key, view);
      else if (force || last[key]) C.room.clearPrivate(key);
      last[key] = json;
    }
  }

  // ---------- Client ----------
  function onState(st) {
    const s = C.session;
    if (!s || C.ended || !st || typeof st !== "object" || !Array.isArray(st.players)) return;
    if (st.code && st.code !== s.code) return;
    C.pub = st;
    const ack = st.acks && typeof st.acks[s.pid] === "number" ? st.acks[s.pid] : 0;
    const n = C.outbox.length;
    C.outbox = C.outbox.filter((e) => e.seq > ack);
    if (ack > s.seq) s.seq = ack;
    if (C.outbox.length !== n) saveSession();
    if (Array.isArray(st.removed) && st.removed.includes(s.pid)) return end("removed");
    if (st.phase === "closed") return end("closed");
    const known = st.acks && typeof st.acks[s.pid] === "number";
    if (known && !C.leaving && !st.players.some((p) => p.pid === s.pid) && !C.outbox.some((e) => e.t === "join")) return end("full");
    emit();
  }
  function onPrivate(p) { C.priv = p && typeof p === "object" ? p : null; emit(); }
  function onPresence(pid, on) { if (C.presence[pid] !== on) { C.presence[pid] = on; emit(); } }
  function flush(force) {
    const r = C.room, s = C.session;
    if (!r || !s || s.isHost || !r.connected) return;
    const now = Date.now();
    for (const env of C.outbox) {
      if (!force && now - (sentAt.get(env.seq) || 0) < 1200) continue;
      sentAt.set(env.seq, now);
      r.send(env);
    }
  }

  // Elke actie van deze telefoon. Host: lokaal door dezelfde reduce (eigen pid/key/seq); client: outbox + versturen.
  function act(t, d) {
    if (PREVIEW) { toast("Preview: " + t); return true; }
    const s = C.session;
    if (!s || C.ended) return false;
    d = d || {};
    if (s.isHost) {
      if (!C.host) return false;
      hostReceive({ pid: s.pid, key: s.key, seq: (C.host.state.acks[s.pid] || 0) + 1, t, d });
      return true;
    }
    s.seq = (s.seq || 0) + 1;
    const env = { pid: s.pid, key: s.key, seq: s.seq, t, d };
    C.outbox.push(env);
    saveSession();
    if (C.room && C.room.connected) { sentAt.set(env.seq, Date.now()); C.room.send(env); }
    emit();
    return true;
  }

  async function createRoom(prof) {
    const claim = await N.claimCode({});
    const pid = N.randomId(12), key = N.randomId(16);
    const state = E.createState({ code: claim.code, host: Object.assign({ pid, key }, prof), settings: store.get("hostSettings", undefined), now: Date.now() });
    C.session = { code: claim.code, pid, key, seq: 0, brokerIndex: claim.brokerIndex, brokerUrl: claim.brokerUrl, isHost: true, outbox: [] };
    C.host = { state, lastPriv: {} };
    C.outbox = []; C.ended = null; C.presence = {};
    hostDerive();
    saveSession();
    saveHost();
    await openRoom(C.session);
  }
  async function joinRoom(code, found, prof) {
    C.session = { code, pid: N.randomId(12), key: N.randomId(16), seq: 0, brokerIndex: found.brokerIndex, brokerUrl: found.brokerUrl, isHost: false, outbox: [] };
    C.outbox = []; C.ended = null; C.pub = found.state; C.priv = null; C.presence = {}; C.host = null;
    act("join", prof);
    await openRoom(C.session);
  }
  // Na herladen: sessie (en voor de host de volledige state) terughalen.
  function resume() {
    if (C.session) return true;
    const s = store.get("session", null);
    if (!s || typeof s !== "object" || !s.code || !s.pid || !s.key) return false;
    if (s.isHost) {
      const hr = store.get("hostRoom", null);
      if (!hr || hr.code !== s.code || !hr.state || Date.now() - (hr.savedAt || hr.state.updatedAt || 0) > HOST_TTL) {
        drop("session"); drop("hostRoom"); return false;
      }
      C.session = s;
      C.host = { state: hr.state, lastPriv: {} };
      hostDerive();
    } else {
      C.session = s;
      C.pub = null; C.priv = null;
    }
    C.outbox = Array.isArray(s.outbox) ? s.outbox.filter((e) => e && Number.isInteger(e.seq)) : [];
    C.ended = null; C.presence = {};
    connectLoop();
    return true;
  }
  async function teardown(clearAll) {
    clearInterval(retxIv); retxIv = null;
    clearTimeout(retryT);
    unsubs.forEach((u) => { try { u(); } catch (e) { /* al weg */ } });
    unsubs = [];
    const room = C.room;
    C.room = null;
    unwake();
    if (clearAll) {
      if (C.session && C.session.isHost) drop("hostRoom");
      drop("session");
      Object.assign(C, { session: null, host: null, pub: null, priv: null, presence: {}, outbox: [], ended: null });
    }
    C.status = "idle";
    if (room) await room.close();
    emit();
  }
  function end(reason) {
    C.ended = reason;
    if (C.session && C.session.isHost) drop("hostRoom");
    drop("session");
    teardown(false);
    buzz([60, 40, 60]);
    emit();
  }
  async function leaveRoom() {
    const s = C.session;
    if (!s) return;
    if (!C.room && opening) await Promise.race([opening.catch(() => {}), sleep(4000)]);
    if (s.isHost) return closeRoom();
    C.leaving = true;
    act("leave");
    const t0 = Date.now();
    while (C.room && C.outbox.length && Date.now() - t0 < 2500) await sleep(100);
    await teardown(true);
    C.leaving = false;
  }
  async function closeRoom() {
    const h0 = C.host;
    if (h0 && C.room) {
      const closed = Object.assign(E.publicView(h0.state), { phase: "closed", updatedAt: Date.now() });
      const jobs = [C.room.publishState(closed)];
      for (const pid of Object.keys(h0.state.keys)) if (pid !== h0.state.hostPid) jobs.push(C.room.clearPrivate(h0.state.keys[pid]));
      await Promise.race([Promise.all(jobs), sleep(2500)]);
    }
    drop("hostRoom");
    await teardown(true);
  }

  // ---------- Wake lock ----------
  let wakeLock = null;
  async function wake() {
    if (PREVIEW || !C.session || wakeLock || document.hidden || !navigator.wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (e) { wakeLock = null; }
  }
  function unwake() { const w = wakeLock; wakeLock = null; if (w) { try { w.release().catch(() => {}); } catch (e) { /* */ } } }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) wake(); });

  // =========================================================
  // View model + effecten
  // =========================================================
  let previewVm = null;
  function vm() {
    if (PREVIEW) return previewVm;
    const s = C.session;
    const priv = C.priv && C.pub && C.priv.gameNo === C.pub.gameNo ? C.priv : null; // nooit het woord van vorig potje
    return {
      pub: C.pub, priv, me: { pid: s ? s.pid : null, key: s ? s.key : null, isHost: !!(s && s.isHost), code: s ? s.code : null },
      status: C.status, presence: C.presence, host: C.host ? { pendingWinner: C.host.state.pendingWinner || null } : null,
      ended: C.ended, pending: new Set(C.outbox.map((e) => e.t)), brokerIndex: s ? s.brokerIndex : 0, since: C.since,
    };
  }
  const isActive = (name) => !!(DVA.screens[name] && DVA.screens[name].classList.contains("active"));
  let emitQueued = false;
  function emit() {
    if (emitQueued) return;
    emitQueued = true;
    queueMicrotask(() => {
      emitQueued = false;
      const v = vm();
      if (isActive("room") && v) { renderRoom(v); effects(v); }
      if (isActive("online")) refreshHome();
    });
  }

  // Geluid/trillen bij overgangen (alleen als het kamerscherm open is)
  let fxPrev = null;
  function effects(v) {
    const p = v.pub;
    if (!p) return;
    const now = { phase: p.phase, n: p.players.filter((x) => !x.left).length, turn: p.turn ? p.turn.pid + ":" + p.turn.hintRound + ":" + p.round : null, revote: p.revote, g: p.gameNo };
    const was = fxPrev;
    fxPrev = now;
    if (!was || v.ended) return;
    if (now.phase === "lobby" && was.phase === "lobby" && now.n > was.n) { sfx.pop(); buzz(10); }
    if (now.phase !== was.phase) {
      if (now.phase === "reveal") { sfx.whoosh(); buzz(25); }
      if (now.phase === "vote") { sfx.alarm(); buzz([30, 50, 30]); }
      if (now.phase === "lobby" && was.phase === "over") sfx.pop();
    } else if (now.phase === "vote" && now.revote && !was.revote) { sfx.alarm(); buzz([40, 40, 40]); }
    if (now.turn && now.turn !== was.turn && p.turn.pid === v.me.pid) { sfx.turn(); buzz([40, 60, 40]); }
  }

  // =========================================================
  // Bouwstenen
  // =========================================================
  const P = (pub, pid) => pub.players.find((p) => p.pid === pid);
  const activeP = (pub) => pub.players.filter((p) => !p.left);
  const aliveP = (pub) => pub.players.filter((p) => p.alive && !p.left && !p.spectator);
  const playing = (v) => { const m = v.pub && P(v.pub, v.me.pid); return !!(m && m.alive && !m.left && !m.spectator); };
  const catLabel = (id) => CATS[id] || "Alles door elkaar";
  const watchText = (v) => {
    const m = v.pub && P(v.pub, v.me.pid);
    if (!m || m.spectator) return "Je kijkt mee 👀";
    if (!m.alive) return "Je ligt eruit · je kijkt mee 👀";
    return null;
  };

  function avatar(p, size) {
    return h("span", { class: "o-av o-av-" + (size || "md"), style: { "--pc": (p && p.color) || "#8b5cff" }, "aria-hidden": "true" },
      h("span", { class: "o-av-e", text: (p && p.avatar) || "🙂" }));
  }
  function setAvatar(el, p) {
    el.style.setProperty("--pc", p.color || "#8b5cff");
    const e = el.firstChild;
    if (e.textContent !== p.avatar) e.textContent = p.avatar || "🙂";
  }
  function kicker(text) { return h("p", { class: "o-kicker", text }); }
  function btn(label, act0, cls, onclick, extra) {
    return h("button", Object.assign({ class: "o-btn " + (cls || "o-btn-glass"), type: "button", "data-act": act0, onclick }, extra || {}), label);
  }
  const busyKids = new WeakMap();
  function busy(b, label) {
    if (!b) return;
    if (label) {
      if (!busyKids.has(b)) busyKids.set(b, [...b.childNodes]);
      b.disabled = true; b.setAttribute("aria-busy", "true"); b.classList.add("is-busy");
      b.replaceChildren(h("span", { class: "o-spin" }), label.trim() ? h("span", { text: label }) : "");
    } else {
      b.disabled = false; b.removeAttribute("aria-busy"); b.classList.remove("is-busy");
      if (busyKids.has(b)) { b.replaceChildren(...busyKids.get(b)); busyKids.delete(b); }
    }
  }
  function dots() { return h("span", { class: "o-dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")); }
  function waitLine(text) { return h("div", { class: "o-wait" }, dots(), h("span", { text })); }

  function shareUrl(code, bi) {
    const u = new URL(location.href);
    u.hash = ""; u.search = "";
    u.searchParams.set("join", code);
    if (Number.isInteger(bi)) u.searchParams.set("b", String(bi));
    const o = N.brokerOverride ? N.brokerOverride() : null;
    if (o) u.searchParams.set("broker", o);
    return u.toString();
  }
  async function shareLink(code, bi) {
    const url = shareUrl(code, bi);
    const text = `Doe mee met Infiltrant! 🕵️ Kamercode ${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Infiltrant", text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast("Link gekopieerd 📋"); return; } catch (e) { /* fallback hieronder */ }
    const ta = h("textarea", { style: { position: "fixed", opacity: "0" } }); ta.value = url;
    document.body.append(ta); ta.select();
    try { document.execCommand("copy"); toast("Link gekopieerd 📋"); } catch (e) { toast(url); }
    ta.remove();
  }

  // QR als SVG: afgeronde modules, eigen finder-patronen en een logo in het midden (EC-niveau Q vangt dat op).
  let qrN = 0;
  function qrSvg(text) {
    const gid = "oqrg" + ++qrN;
    const qr = window.qrcode(0, "Q");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const logo = n <= 29 ? 5 : 7, lo = (n - logo) / 2;
    const inFinder = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
    const inLogo = (r, c) => r >= lo - 0.5 && r < lo + logo && c >= lo - 0.5 && c < lo + logo;
    // "Vloeibare" modules: volle vakjes die met donkere buren versmelten; alleen vrije buitenhoeken worden rond.
    // Geometrisch gelijk aan een gewone QR, dus scanbaar op elke resolutie (kleine overlap e tegen naden).
    const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c) && !inFinder(r, c) && !inLogo(r, c);
    const R = 0.42, e = 0.02, f = (v) => +v.toFixed(2);
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!dark(r, c)) continue;
      const up = dark(r - 1, c), dn = dark(r + 1, c), lf = dark(r, c - 1), rt = dark(r, c + 1);
      const tl = !up && !lf ? R : 0, tr = !up && !rt ? R : 0, br = !dn && !rt ? R : 0, bl = !dn && !lf ? R : 0;
      const x0 = c - (lf ? e : 0), x1 = c + 1 + (rt ? e : 0), y0 = r - (up ? e : 0), y1 = r + 1 + (dn ? e : 0);
      d += `M${f(x0 + tl)} ${f(y0)}H${f(x1 - tr)}` + (tr ? `a${R} ${R} 0 0 1 ${R} ${R}` : "") +
        `V${f(y1 - br)}` + (br ? `a${R} ${R} 0 0 1 -${R} ${R}` : "") +
        `H${f(x0 + bl)}` + (bl ? `a${R} ${R} 0 0 1 -${R} -${R}` : "") +
        `V${f(y0 + tl)}` + (tl ? `a${R} ${R} 0 0 1 ${R} -${R}` : "") + "z";
    }
    const svg = sv("svg", { viewBox: `-2 -2 ${n + 4} ${n + 4}`, class: "o-qr-svg", role: "img", "aria-label": "QR-code om mee te doen" });
    const defs = sv("defs");
    const grad = sv("linearGradient", { id: gid, x1: "0", y1: "0", x2: "1", y2: "1" },
      sv("stop", { offset: "0", "stop-color": "#7a3cff" }), sv("stop", { offset: "1", "stop-color": "#ff2e93" }));
    defs.append(grad);
    svg.append(defs, sv("path", { d, fill: "#170b2b" }));
    [[0, 0], [0, n - 7], [n - 7, 0]].forEach(([r, c]) => {
      svg.append(sv("rect", { x: c + 0.5, y: r + 0.5, width: 6, height: 6, rx: 1.5, fill: "none", stroke: `url(#${gid})`, "stroke-width": 1 }));
      svg.append(sv("rect", { x: c + 2, y: r + 2, width: 3, height: 3, rx: 0.7, fill: "#170b2b" }));
    });
    const lp = lo - 0.2, ls = logo + 0.4;
    svg.append(sv("rect", { x: lp, y: lp, width: ls, height: ls, rx: 1.6, fill: `url(#${gid})` }));
    const t = sv("text", { x: n / 2, y: n / 2 + logo * 0.06, "text-anchor": "middle", "dominant-baseline": "central", "font-size": logo * 0.62 });
    t.textContent = "🕵️";
    svg.append(t);
    return svg;
  }

  // =========================================================
  // Sheets (bottom sheet, bevestiging)
  // =========================================================
  function sheet(build, cls, onClose) {
    const wrap = h("div", { class: "ol o-sheet-wrap" + (cls ? " " + cls : "") });
    const panel = h("div", { class: "o-sheet o-glass", role: "dialog", "aria-modal": "true" }, h("div", { class: "o-grab" }));
    const bg = h("div", { class: "o-sheet-bg" });
    wrap.append(bg, panel);
    let closed = false;
    const onKey = (e) => { if (e.key === "Escape") close(); };
    function close() {
      if (closed) return;
      closed = true;
      wrap.classList.remove("open");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => wrap.remove(), 340);
      if (onClose) onClose();
    }
    bg.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    build(panel, close);
    document.body.append(wrap);
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add("open")));
    return close;
  }
  // Bevestiging als sheet → Promise<boolean> (achtergrond/escape = annuleren)
  function ask({ title, text, ok = "OK", cancel = "Annuleren", danger = false, emoji }) {
    return new Promise((resolve) => {
      let answer = false;
      sheet((panel, close) => {
        add(panel, [
          emoji && h("div", { class: "o-ask-e", text: emoji }),
          h("h3", { class: "o-sheet-title", text: title }),
          text && h("p", { class: "o-sheet-text", text }),
          h("div", { class: "o-sheet-actions" },
            btn(ok, "confirm", danger ? "o-btn-danger" : "o-btn-primary", () => { answer = true; close(); }),
            btn(cancel, "cancel", "o-btn-glass", close)),
        ]);
      }, "o-ask", () => resolve(answer));
    });
  }

  // Profiel-editor (gebruikt op #online en in de lobby-sheet)
  function profileEditor(init, onChange, opts) {
    const o = opts || {};
    let p = Object.assign({}, init);
    const big = avatar(p, "xl");
    const bubble = h("button", { class: "o-pe-bubble", type: "button", "aria-label": "Kies je avatar en kleur" }, big, h("span", { class: "o-pe-edit", text: "✎" }));
    const name = h("input", {
      class: "o-input o-pe-name", "data-act": "name", maxlength: "16", placeholder: "Jouw naam", autocomplete: "nickname",
      enterkeyhint: "done", "aria-label": "Jouw naam", spellcheck: "false",
    });
    name.value = p.name || "";
    const avs = h("div", { class: "o-pe-avs" }, AVATARS.map((a) => h("button", { class: "o-pe-av", type: "button", "data-act": "avatar", "data-v": a, "aria-label": "Avatar " + a, text: a })));
    const cols = h("div", { class: "o-pe-cols" }, NEON.map((c) => h("button", { class: "o-pe-col", type: "button", "data-act": "color", "data-v": c, style: { "--pc": c }, "aria-label": "Kleur " + c })));
    const picker = h("div", { class: "o-pe-pick" }, h("p", { class: "o-pe-label", text: "Kies je avatar" }), avs, h("p", { class: "o-pe-label", text: "en je kleur" }), cols);
    const el = h("div", { class: "o-pe" + (o.open ? " open" : "") },
      h("div", { class: "o-pe-top" }, bubble, h("label", { class: "o-pe-field" }, h("span", { class: "o-pe-label", text: o.label || "Zo heet je in het spel" }), name)), picker);
    function sync() {
      setAvatar(big, p);
      avs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === p.avatar));
      cols.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === p.color));
    }
    const changed = () => { sync(); onChange && onChange(Object.assign({}, p)); };
    avs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; p.avatar = b.dataset.v; restart(big, "o-bounce"); sfx.tap(); buzz(6); changed(); });
    cols.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; p.color = b.dataset.v; restart(big, "o-bounce"); sfx.tap(); buzz(6); changed(); });
    name.addEventListener("input", () => { p.name = name.value.slice(0, 16); onChange && onChange(Object.assign({}, p)); });
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });
    bubble.addEventListener("click", () => { el.classList.toggle("open"); sfx.tap(); });
    sync();
    return { el, name, get: () => Object.assign({}, p), set(np) { p = Object.assign({}, np); if (document.activeElement !== name) name.value = p.name || ""; sync(); } };
  }

  function profileSheet(v) {
    sheet((panel, close) => {
      const me = P(v.pub, v.me.pid) || getProfile();
      const pe = profileEditor({ name: me.name, avatar: me.avatar, color: me.color }, null, { open: true, label: "Je naam" });
      add(panel, [
        h("h3", { class: "o-sheet-title", text: "Jouw profiel" }), pe.el,
        h("div", { class: "o-sheet-actions" }, btn("Opslaan", "profile-save", "o-btn-primary", () => {
          const p = pe.get();
          p.name = (p.name || "").trim() || me.name;
          setProfile(p);
          act("profile", p);
          sfx.pop(); close();
        })),
      ]);
    });
  }
  function playerSheet(v, p) {
    sheet((panel, close) => {
      add(panel, [
        h("div", { class: "o-ps-head" }, avatar(p, "xl"), h("h3", { class: "o-sheet-title", text: p.name })),
        h("p", { class: "o-sheet-text", text: "Wil je deze speler uit de kamer zetten? Die kan daarna alleen opnieuw meedoen met een nieuwe uitnodiging." }),
        h("div", { class: "o-sheet-actions" },
          btn("Uit de kamer zetten", "kick", "o-btn-danger", () => { act("kick", { target: p.pid }); buzz(30); close(); }),
          btn("Annuleren", "cancel", "o-btn-glass", close)),
      ]);
    });
  }
  // Kamer-sheet (tik op de code in de balk): QR + delen + spelers (host kan iemand eruit zetten)
  function roomSheet(v) {
    sheet((panel, close) => {
      const pub = v.pub;
      const list = h("div", { class: "o-rs-list" });
      activeP(pub).forEach((p) => {
        const row = h("div", { class: "o-rs-row" }, avatar(p, "sm"), h("span", { class: "o-rs-name", text: p.name }),
          p.pid === pub.hostPid && h("span", { class: "o-tag", text: "👑 host" }),
          p.pid === v.me.pid && h("span", { class: "o-tag o-tag-me", text: "jij" }),
          !p.alive && pub.phase !== "lobby" && h("span", { class: "o-tag", text: p.spectator ? "kijkt mee" : "eruit" }));
        if (v.me.isHost && p.pid !== v.me.pid) row.append(btn("Eruit", "player", "o-btn-mini", () => { close(); playerSheet(v, p); }, { "data-pid": p.pid }));
        list.append(row);
      });
      add(panel, [
        h("p", { class: "o-kicker", text: "Kamercode" }),
        codeTiles(pub.code, "sm"),
        h("div", { class: "o-rs-qr" }, h("div", { class: "o-qr" }, qrSvg(shareUrl(pub.code, v.brokerIndex))),
          h("p", { class: "o-sheet-text", text: "Laat iemand scannen om mee te doen. Tijdens een potje kijken nieuwe spelers mee tot het volgende potje." })),
        btn([icon("share"), " Deel link"], "share", "o-btn-glass o-btn-wide", () => shareLink(pub.code, v.brokerIndex)),
        h("h4", { class: "o-h4", text: "Spelers" }), list,
      ]);
    });
  }
  function hintsSheet(v) {
    sheet((panel) => {
      const feed = h("div", { class: "o-feed" });
      add(panel, [h("h3", { class: "o-sheet-title", text: "Alle hints" }), feed]);
      renderFeed(feed, v.pub);
      if (!v.pub.hints.length) feed.append(h("p", { class: "o-empty", text: "Nog geen hints gegeven." }));
    }, "o-sheet-tall");
  }

  function codeTiles(code, size) {
    return h("div", { class: "o-tiles" + (size ? " o-tiles-" + size : ""), "data-room-code": code, "aria-label": "Kamercode " + code.split("").join(" ") },
      code.split("").map((ch, i) => h("span", { class: "o-tile", style: { "--i": i }, text: ch })));
  }

  // =========================================================
  // Kamer-scherm: shell (balk + banner + podium)
  // =========================================================
  let shell = null;
  function ensureShell() {
    if (shell) return shell;
    const root = $("#roomApp");
    const codeB = h("b", { class: "o-bar-code", "data-room-code": "" });
    const codeBtn = h("button", { class: "o-bar-chip", type: "button", "aria-label": "Kamer en spelers", onclick: () => { const v = vm(); if (v && v.pub) { sfx.tap(); roomSheet(v); } } },
      h("span", { class: "o-bar-k", text: "Kamer" }), codeB, icon("users", "o-bar-ic"));
    const pillT = h("span", { text: "Verbinden…" });
    const pill = h("span", { class: "o-pill", "data-state": "wait", role: "status" }, h("i"), pillT);
    const leave = h("button", { class: "o-bar-btn", type: "button", "data-act": "leave", "aria-label": "Verlaten", onclick: onLeave }, icon("exit"));
    const bar = h("header", { class: "o-bar" }, codeBtn, pill, leave);
    const banner = h("div", { class: "o-banner", role: "status" });
    const stage = h("main", { class: "o-stage" });
    stage.addEventListener("click", (e) => { if (ghostTap(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    root.replaceChildren(bar, banner, stage);
    shell = { root, section: root.closest(".screen"), bar, codeB, codeBtn, pill, pillT, leave, banner, stage };
    return shell;
  }
  function updateChrome(v) {
    const sh = ensureShell();
    const code = (v.pub && v.pub.code) || v.me.code || "····";
    if (sh.codeB.textContent !== code) { sh.codeB.textContent = code; sh.codeB.dataset.roomCode = code; }
    const hostOff = !!(v.pub && !v.me.isHost && v.presence && v.presence[v.pub.hostPid] === false && v.status === "online");
    const live = v.status === "online";
    const st = v.ended ? "off" : !live ? "wait" : hostOff ? "bad" : "live";
    sh.pill.dataset.state = st;
    sh.bar.classList.toggle("is-wide", st !== "live"); // lange status → compactere code-chip
    sh.pillT.textContent = { live: "Live", wait: "Verbinden…", bad: "Host offline", off: "Offline" }[st];
    sh.leave.setAttribute("aria-label", v.me.isHost ? "Kamer sluiten" : "Verlaten");
    sh.leave.hidden = !!v.ended;
    sh.codeBtn.disabled = !v.pub || !!v.ended;
    let msg = "";
    if (!v.ended && v.pub) {
      if (hostOff) msg = "Host is even weg… het spel gaat verder zodra die terug is.";
      else if (!live && v.status !== "idle" && v.status !== "connecting") msg = "Verbinding kwijt — opnieuw verbinden…";
    }
    sh.banner.textContent = msg;
    sh.banner.classList.toggle("show", !!msg);
    sh.banner.classList.toggle("bad", hostOff);
  }
  async function onLeave() {
    const v = vm();
    if (!v) return;
    if (PREVIEW) { toast("Preview: verlaten"); return; }
    const host = v.me.isHost;
    const ok = await ask(host
      ? { emoji: "🚪", title: "Kamer sluiten?", text: "Iedereen wordt eruit gegooid en het potje stopt.", ok: "Kamer sluiten", danger: true }
      : { emoji: "👋", title: "Kamer verlaten?", text: "Je stopt met dit potje. Je kunt later opnieuw meedoen met de code.", ok: "Verlaten", danger: true });
    if (!ok) return;
    busy(shell && shell.leave, " ");
    await leaveRoom();
    busy(shell && shell.leave, false);
    location.hash = "online";
  }

  // ---------- Router voor fases ----------
  let cur = { key: null, view: null, name: null };
  let vtBusy = false;
  let latest = null;
  // Een verse fase is heel even niet aan te tikken. Anders landt een dubbele tik op de vorige knop op de nieuwe
  // knop op dezelfde plek ("Uitslag" → "Nog een potje", "Volgende ronde" → "Nu stemmen"). Vooral zonder
  // View Transitions (iOS < 18, minder beweging) wisselt het scherm meteen en raakt de tweede tik de nieuwe fase.
  // Twee lagen: `inert` blokkeert direct, en een tik telt alleen als de vinger pas ná het verschijnen (+ marge)
  // neerging. Dat laatste kijkt naar de tijdstempel van de pointerdown, dus het werkt ook als de telefoon het
  // scherm traag tekent en de tweede tik pas na afloop van `inert` verwerkt wordt.
  const TAP_GUARD_MS = 450;
  let guardT = null, viewAt = -Infinity, downAt = -Infinity;
  function guardTaps(el) {
    if (PREVIEW) return;
    viewAt = performance.now();
    el.inert = true;
    clearTimeout(guardT);
    guardT = setTimeout(() => { el.inert = false; }, TAP_GUARD_MS);
  }
  document.addEventListener("pointerdown", (e) => { downAt = e.timeStamp; }, true);
  function ghostTap(e) { return e.detail > 0 && downAt < viewAt + TAP_GUARD_MS; } // detail 0 = toetsenbord/programma
  function pickView(v) {
    if (v.ended) return { name: "ended", key: "ended:" + v.ended };
    const pub = v.pub;
    if (!pub) return { name: "connecting", key: "connecting" };
    const g = pub.gameNo, r = pub.round;
    switch (pub.phase) {
      case "lobby": return { name: "lobby", key: "lobby:" + (v.me.isHost ? 1 : 0) };
      case "reveal": return { name: "reveal", key: `reveal:${g}:${playing(v) ? 1 : 0}` };
      case "hints": return { name: "hints", key: `hints:${g}:${r}` };
      case "vote": return { name: "vote", key: `vote:${g}:${r}:${pub.revote ? 1 : 0}:${voteMode(v)}` };
      case "guess": return { name: "guess", key: `guess:${g}:${r}` };
      case "elim": return { name: "elim", key: `elim:${g}:${r}:${pub.lastVote && pub.lastVote.revote ? 1 : 0}` };
      case "over": return { name: "over", key: `over:${g}` };
      case "closed": return { name: "ended", key: "ended:closed" };
      default: return { name: "connecting", key: "connecting" };
    }
  }
  function mood(v) {
    const pub = v.pub;
    if (!pub) return "";
    if (pub.phase === "over" && pub.result) return pub.result.winner === "burgers" ? "win-b" : "win-i";
    if ((pub.phase === "elim" || pub.phase === "guess") && pub.lastVote) {
      if (pub.guess && pub.guess.correct) return "inf";
      return pub.lastVote.eliminated ? (pub.lastVote.role === "infiltrant" ? "inf" : "burg") : "tie";
    }
    return "";
  }
  function renderRoom(v) {
    latest = v;
    const sh = ensureShell();
    updateChrome(v);
    const { name, key } = pickView(v);
    if (key === cur.key) { if (cur.view) cur.view.update(v); return; }
    cur.key = key;
    cur.view = null;
    const apply = () => {
      if (cur.key !== key) return; // ingehaald door een nieuwere fase
      const lv = latest;
      if (cur.prev && cur.prev.destroy) cur.prev.destroy();
      const view = VIEWS[name](lv);
      cur.view = view; cur.prev = view; cur.name = name;
      sh.section.dataset.phase = name === "ended" || name === "connecting" ? name : lv.pub.phase;
      sh.section.dataset.mood = mood(lv);
      sh.stage.replaceChildren(view.el);
      guardTaps(sh.stage);
      view.update(lv);
      if (view.mounted) view.mounted(lv);
      window.scrollTo(0, 0);
    };
    // View Transition alleen als er geen andere loopt (snel na elkaar → direct wisselen, geen "skipped"-fouten)
    const vt = document.startViewTransition && !vtBusy && !reduced() && !document.hidden && sh.stage.childElementCount && isActive("room");
    if (!vt) { apply(); return; }
    try {
      const t = document.startViewTransition(() => { try { apply(); } catch (e) { console.error(e); } });
      vtBusy = true;
      const done = () => { vtBusy = false; };
      t.ready.catch(() => {});
      t.updateCallbackDone.catch(() => {});
      t.finished.then(done, done);
    } catch (e) { vtBusy = false; apply(); }
  }

  // =========================================================
  // Fase-views
  // =========================================================
  const VIEWS = {};

  // ---------- Verbinden ----------
  VIEWS.connecting = (v) => {
    const sub = h("p", { class: "o-center-text", text: "Even geduld, we zoeken je kamer op." });
    const stop = btn("Stoppen", "exit", "o-btn-glass", async () => { await teardown(true); location.hash = "online"; });
    stop.hidden = true;
    const el = h("div", { class: "o-view o-center" },
      h("div", { class: "o-radar o-rise" }, h("i"), h("i"), h("i"), h("span", { text: "🕵️" })),
      h("h2", { class: "o-title o-rise", style: { "--i": 1 }, text: "Verbinden…" }), sub, stop);
    const startedAt = Date.now();
    const t = setInterval(() => {
      if (PREVIEW || Date.now() - startedAt < 9000) return;
      sub.textContent = C.room ? "Geen antwoord van de kamer. Misschien is die al gesloten?" : "Dit duurt lang… check je internetverbinding.";
      stop.hidden = false;
    }, 1000);
    return { el, update() {}, destroy() { clearInterval(t); } };
  };

  // ---------- Einde (gesloten / eruit gezet / vol) ----------
  VIEWS.ended = (v) => {
    const why = v.ended || "closed";
    const M = {
      closed: ["🚪", "De host heeft de kamer gesloten", "Dat was het voor nu. Bedankt voor het spelen!"],
      removed: ["🥾", "Je bent uit de kamer gezet", "De host heeft je eruit gehaald. Je kunt alleen opnieuw meedoen als je weer wordt uitgenodigd."],
      full: ["🈵", "De kamer is vol", "Er doen al 12 spelers mee. Probeer het straks nog eens."],
    }[why] || ["🚪", "De kamer is gesloten", ""];
    const el = h("div", { class: "o-view o-center" },
      h("div", { class: "o-big-e o-rise", text: M[0] }),
      h("h2", { class: "o-title o-rise", style: { "--i": 1 }, text: M[1] }),
      h("p", { class: "o-center-text o-rise", style: { "--i": 2 }, text: M[2] }),
      h("div", { class: "o-rise", style: { "--i": 3 } }, btn("Terug", "exit", "o-btn-primary o-btn-wide", async () => {
        if (!PREVIEW) { await teardown(true); }
        location.hash = "online";
      })));
    return { el, update() {} };
  };

  // ---------- Lobby ----------
  VIEWS.lobby = (v0) => {
    const isHost = v0.me.isHost;
    const code = v0.pub.code;
    // Ticket: code + QR + delen
    const qrBox = h("div", { class: "o-qr" });
    let qrFor = null;
    const ticket = h("section", { class: "o-glass o-ticket o-rise", style: { "--i": 0 } },
      kicker("Kamercode"), codeTiles(code),
      h("div", { class: "o-ticket-row" }, qrBox,
        h("div", { class: "o-ticket-side" },
          h("p", { class: "o-ticket-text", text: "Scan de QR of deel de link. Iedereen speelt op z'n eigen telefoon." }),
          btn([icon("share"), " Deel link"], "share", "o-btn-glass o-btn-sm", () => { sfx.tap(); shareLink(code, latest.brokerIndex); }))));

    // Spelers
    const count = h("span", { class: "o-count" });
    const grid = h("div", { class: "o-pgrid" });
    const need = h("p", { class: "o-need" });
    grid.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pid]");
      if (!b || b.dataset.ghost) return;
      const v = latest, p = P(v.pub, b.dataset.pid);
      if (!p) return;
      sfx.tap();
      if (p.pid === v.me.pid) profileSheet(v);
      else if (v.me.isHost) playerSheet(v, p);
      else restart(b.querySelector(".o-av"), "o-bounce");
    });
    const players = h("section", { class: "o-glass o-card o-rise", style: { "--i": 1 } },
      h("div", { class: "o-card-head" }, h("h3", { class: "o-h3", text: "Spelers" }), count), grid, need);

    const conf = isHost ? settingsCard() : summaryCard();
    const startSub = h("span", { class: "o-btn-sub" });
    const start = isHost ? h("button", { class: "o-btn o-btn-primary o-btn-hero", type: "button", "data-act": "start", onclick: () => {
      const v = latest;
      if (activeP(v.pub).length < E.MIN_PLAYERS) { shake(start); return; }
      sfx.whoosh(); buzz(20); act("start");
    } }, h("span", { class: "o-btn-l" }, icon("play"), h("span", { text: "Start" })), startSub) : null;
    const dock = h("div", { class: "o-dock" }, isHost ? start : waitLine("Wachten tot de host start…"));
    const el = h("div", { class: "o-view o-lobby" }, ticket, players, conf.el, dock);

    return {
      el,
      update(v) {
        const pub = v.pub;
        const link = shareUrl(pub.code, v.brokerIndex);
        if (qrFor !== link) { qrFor = link; qrBox.replaceChildren(qrSvg(link)); }
        const ps = activeP(pub);
        count.textContent = ps.length + " / " + E.MAX_PLAYERS;
        const missing = Math.max(0, E.MIN_PLAYERS - ps.length);
        const slots = ps.concat(Array.from({ length: missing }, (_, i) => ({ pid: "ghost" + i, ghost: true })));
        keyed(grid, slots, (p) => p.pid, (p, i) => (p.ghost ? ghostCell(i) : playerCell(p, i)), (cell, p) => { if (!p.ghost) updateCell(cell, p, v); });
        need.textContent = missing ? `Nog ${plural(missing, "speler", "spelers")} nodig om te starten` : ps.length >= E.MAX_PLAYERS ? "De kamer is vol 🔥" : "Klaar om te spelen! Er kunnen er nog meer bij.";
        need.classList.toggle("ok", !missing);
        conf.update(v);
        if (start) {
          start.classList.toggle("is-off", !!missing);
          start.setAttribute("aria-disabled", missing ? "true" : "false");
          startSub.textContent = missing ? `Nog ${plural(missing, "speler", "spelers")} nodig` : `${ps.length} spelers · ${plural(pub.infiltrantCount, "infiltrant", "infiltranten")}`;
        }
      },
    };
  };
  function ghostCell(i) {
    return h("div", { class: "o-pcell o-ghost", "data-pid": "ghost" + i, "data-ghost": "1", style: { "--i": i + 1 } },
      h("span", { class: "o-pcell-av" }, h("span", { class: "o-av o-av-lg o-av-ghost" }, h("span", { class: "o-av-e", text: "?" }))),
      h("span", { class: "o-pcell-name", text: "Wachten…" }));
  }
  function playerCell(p, i) {
    return h("button", { class: "o-pcell o-pop", type: "button", "data-act": "player", "data-pid": p.pid, style: { "--i": i } },
      h("span", { class: "o-pcell-av" }, avatar(p, "lg"), h("i", { class: "o-pres" }), h("span", { class: "o-crown", text: "👑" })),
      h("span", { class: "o-pcell-name" }),
      h("span", { class: "o-pcell-meta" }));
  }
  function updateCell(cell, p, v) {
    const isMe = p.pid === v.me.pid, isHost = p.pid === v.pub.hostPid;
    setAvatar(cell.querySelector(".o-av"), p);
    const nm = cell.querySelector(".o-pcell-name");
    if (nm.textContent !== p.name) nm.textContent = p.name;
    const on = isMe || v.presence[p.pid] !== false;
    cell.classList.toggle("is-off", !on);
    cell.classList.toggle("is-host", isHost);
    cell.classList.toggle("is-me", isMe);
    const meta = cell.querySelector(".o-pcell-meta");
    const score = v.pub.scores[p.pid] || 0;
    const want = (isMe ? "jij" : "") + "|" + score;
    if (meta.dataset.v !== want) {
      meta.dataset.v = want;
      meta.replaceChildren(isMe ? h("span", { class: "o-tag o-tag-me", text: "jij" }) : "", score ? h("span", { class: "o-tag o-tag-score", text: "★ " + score }) : "");
    }
    cell.setAttribute("aria-label", p.name + (isHost ? " (host)" : "") + (isMe ? " (jij)" : "") + (on ? "" : " (offline)"));
  }

  // Segmented control met schuivende pil
  function seg(name, opts, onPick) {
    const btns = opts.map((o, i) => h("button", { class: "o-seg-b", type: "button", "data-act": "seg-" + name, "data-v": String(o.v), style: { "--i": i }, text: o.t, onclick: () => onPick(o.v) }));
    const el = h("div", { class: "o-seg", role: "radiogroup", style: { "--n": opts.length } }, h("span", { class: "o-seg-thumb" }), btns);
    return {
      el,
      set(val) {
        const i = opts.findIndex((o) => o.v === val);
        el.style.setProperty("--sel", String(Math.max(0, i)));
        btns.forEach((b, j) => { b.classList.toggle("on", j === i); b.setAttribute("aria-checked", j === i ? "true" : "false"); });
      },
    };
  }
  function setSettings(patch) { sfx.tap(); buzz(6); act("settings", patch); }
  function settingsCard() {
    const MODES = [
      { v: "woord", e: "🎭", t: "Ander woord", d: "De infiltrant krijgt een nét ander woord — en weet van niks." },
      { v: "blind", e: "🕶️", t: "Geen woord", d: "De infiltrant weet het, maar ziet alleen de categorie." },
    ];
    const modes = MODES.map((m) => h("button", { class: "o-mode", type: "button", "data-act": "mode", "data-v": m.v, onclick: () => setSettings({ mode: m.v }) },
      h("span", { class: "o-mode-e", text: m.e }), h("b", { class: "o-mode-t", text: m.t }), h("span", { class: "o-mode-d", text: m.d }),
      h("span", { class: "o-mode-check" }, icon("check"))));
    const sInf = seg("infiltrants", [{ v: 1, t: "1" }, { v: 2, t: "2" }], (x) => setSettings({ infiltrants: x }));
    const sRounds = seg("hintRounds", [{ v: 1, t: "1" }, { v: 2, t: "2" }, { v: 3, t: "3" }], (x) => setSettings({ hintRounds: x }));
    const sTimer = seg("timer", [{ v: 0, t: "Uit" }, { v: 30, t: "30s" }, { v: 60, t: "60s" }], (x) => setSettings({ timer: x }));
    const infNote = h("span", { class: "o-opt-note" });
    const ids = Object.keys(CATS);
    const all = h("button", { class: "o-cat", type: "button", "data-act": "cat", "data-v": "", text: "✨ Alles" });
    const cats = ids.map((id) => h("button", { class: "o-cat", type: "button", "data-act": "cat", "data-v": id, text: CATS[id] }));
    const catBox = h("div", { class: "o-cats" }, all, cats);
    catBox.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const curC = (latest.pub.settings.categories || []).slice();
      const id = b.dataset.v;
      let next;
      if (!id) next = [];
      else if (curC.includes(id)) next = curC.filter((c) => c !== id);
      else next = curC.concat(id);
      if (next.length === ids.length) next = [];
      setSettings({ categories: next });
    });
    const row = (label, ctl, note) => h("div", { class: "o-opt" }, h("span", { class: "o-opt-l" }, h("b", { text: label }), note), ctl.el);
    const el = h("section", { class: "o-glass o-card o-rise", style: { "--i": 2 } },
      h("div", { class: "o-card-head" }, h("h3", { class: "o-h3", text: "Spelregels" }), h("span", { class: "o-count", text: "jij bepaalt" })),
      h("div", { class: "o-modes" }, modes),
      row("Infiltranten", sInf, infNote), row("Hint-rondes", sRounds, h("span", { class: "o-opt-note", text: "hints per speler vóór elke stemming" })),
      row("Timer per beurt", sTimer, h("span", { class: "o-opt-note", text: "alleen een aftelklok, niemand wordt overgeslagen" })),
      h("p", { class: "o-opt-l o-cat-l" }, h("b", { text: "Categorieën" })), catBox);
    return {
      el,
      update(v) {
        const s = v.pub.settings;
        modes.forEach((b) => b.classList.toggle("on", b.dataset.v === s.mode));
        sInf.set(s.infiltrants); sRounds.set(s.hintRounds); sTimer.set(s.timer);
        const n = activeP(v.pub).length;
        infNote.textContent = s.infiltrants === 2 && v.pub.infiltrantCount < 2 ? `2 infiltranten vanaf 5 spelers (nu ${n})` : "hoeveel er tussen jullie zitten";
        const sel = s.categories || [];
        all.classList.toggle("on", !sel.length);
        cats.forEach((b) => b.classList.toggle("on", sel.includes(b.dataset.v)));
      },
    };
  }
  function summaryCard() {
    const chips = h("div", { class: "o-sum" });
    const el = h("section", { class: "o-glass o-card o-rise", style: { "--i": 2 } },
      h("div", { class: "o-card-head" }, h("h3", { class: "o-h3", text: "Spelregels" }), h("span", { class: "o-count", text: "de host bepaalt" })), chips);
    return {
      el,
      update(v) {
        const s = v.pub.settings, sel = s.categories || [];
        const items = [
          s.mode === "blind" ? ["🕶️", "Geen woord", "Infiltrant ziet alleen de categorie"] : ["🎭", "Ander woord", "Infiltrant weet van niks"],
          ["🕵️", plural(v.pub.infiltrantCount, "infiltrant", "infiltranten"), "zit er tussen jullie"],
          ["💬", plural(s.hintRounds, "hint-ronde", "hint-rondes"), "per stemming"],
          ["⏱️", s.timer ? s.timer + " seconden" : "Geen timer", "per beurt"],
          ["🗂️", sel.length ? sel.map((c) => catLabel(c).replace(/^\S+\s/, "")).join(", ") : "Alle categorieën", "woorden uit"],
        ];
        const want = JSON.stringify(items);
        if (chips.dataset.v === want) return;
        chips.dataset.v = want;
        chips.replaceChildren(...items.map(([e, t, d]) => h("div", { class: "o-sum-i" }, h("span", { class: "o-sum-e", text: e }), h("span", { class: "o-sum-t" }, h("b", { text: t }), h("small", { text: d })))));
      },
    };
  }

  // ---------- Geheime kaart ----------
  function wordContent(priv) {
    if (!priv) return { cls: "loading", cat: "…", word: "…", note: "Je woord komt eraan…" };
    const cat = catLabel(priv.category);
    if (priv.knowsRole && priv.role === "infiltrant") return { cls: "inf", cat, word: "JIJ BENT DE INFILTRANT", note: "Je hebt géén woord. Luister goed en bluf mee! 🤫", inf: true };
    if (priv.knowsRole) return { cls: "", cat, word: priv.word || "?", note: "Je bent burger 😇 — één van jullie heeft géén woord." };
    return { cls: "", cat, word: priv.word || "?", note: "Eén van jullie heeft een ánder woord… misschien jij? 🤫" };
  }
  function secretCard(onPeek) {
    const cat = h("span", { class: "o-c3-cat" });
    const word = h("div", { class: "o-c3-word", "data-word": "" });
    const note = h("p", { class: "o-c3-note" });
    const stamp = h("div", { class: "o-c3-stamp", text: "🕵️" });
    const back = h("div", { class: "o-c3-face o-c3-back" }, h("i", { class: "o-c3-foil" }), cat, stamp, word, note);
    const front = h("div", { class: "o-c3-face o-c3-front" },
      h("i", { class: "o-c3-guilloche" }), h("i", { class: "o-c3-foil" }),
      h("div", { class: "o-c3-top" }, h("span", { text: "TOP SECRET" }), h("span", { text: "№ 007" })),
      h("div", { class: "o-c3-emblem" }, h("span", { text: "🕵️" })),
      h("div", { class: "o-c3-cta" }, h("b", { text: "Houd ingedrukt" }), " ", h("span", { text: "om je woord te zien" })),
      h("div", { class: "o-c3-print" }, fingerprint()));
    const inner = h("div", { class: "o-c3-inner" }, front, back);
    const el = h("div", { class: "o-card3d", tabindex: "0", role: "button", "data-act": "peek-card", "aria-label": "Houd ingedrukt om je woord te zien" }, inner);
    hold(el, () => { el.classList.add("open"); buzz(8); onPeek && onPeek(); }, () => el.classList.remove("open"));
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", ((e.clientX - r.left) / r.width).toFixed(3));
      el.style.setProperty("--my", ((e.clientY - r.top) / r.height).toFixed(3));
    });
    let last = null;
    return {
      el,
      set(priv) {
        const c = wordContent(priv);
        const k = JSON.stringify(c);
        if (k === last) return;
        last = k;
        back.className = "o-c3-face o-c3-back" + (c.cls ? " is-" + c.cls : "");
        cat.textContent = c.cat;
        word.textContent = c.word;
        word.classList.toggle("o-glitch", !!c.inf);
        word.dataset.text = c.word;
        note.textContent = c.note;
        stamp.hidden = !c.inf;
        afterFonts(() => fit(word, c.inf ? 30 : 46, 16));
      },
    };
  }
  function peekChip(getPriv) {
    const pc = h("span", { class: "o-peek-cat" });
    const pw = h("b", { class: "o-peek-word" });
    const pop = h("div", { class: "o-peek-pop", "aria-hidden": "true" }, pc, pw);
    const b = h("button", { class: "o-peek", type: "button", "data-act": "peek", "aria-label": "Houd ingedrukt om je woord te zien" },
      h("span", { class: "o-peek-eye", text: "👁" }), " ", h("span", { text: "Mijn woord" }));
    const wrap = h("div", { class: "o-peek-wrap" }, b, pop);
    hold(b, () => {
      const c = wordContent(getPriv());
      pc.textContent = c.cat;
      pw.textContent = c.inf ? "🕵️ Jij bent de infiltrant" : c.word;
      pop.classList.toggle("is-inf", !!c.inf);
      wrap.classList.add("open"); buzz(6);
    }, () => wrap.classList.remove("open"));
    return wrap;
  }
  function phaseHead(k, title, right) {
    const kk = kicker(k);
    const tt = title ? h("h2", { class: "o-title", text: title }) : null;
    const el = h("header", { class: "o-phead o-rise" }, h("div", { class: "o-phead-l" }, kk, tt), right);
    return { el, k: kk, t: tt };
  }

  // ---------- Reveal ----------
  VIEWS.reveal = (v0) => {
    const ready = h("div", { class: "o-ready" });
    const readyT = h("p", { class: "o-ready-t" });
    if (!playing(v0)) {
      const el = h("div", { class: "o-view o-reveal" },
        phaseHead(`Spel ${v0.pub.gameNo}`, "Geheime woorden").el,
        h("section", { class: "o-glass o-card o-watch o-rise", style: { "--i": 1 } },
          h("div", { class: "o-big-e", text: "👀" }), h("h3", { class: "o-h3", text: watchText(v0) || "Je kijkt mee 👀" }),
          h("p", { class: "o-center-text", text: "Er loopt een potje. Iedereen bekijkt nu z'n geheime woord. Jij doet het volgende potje mee!" })),
        h("div", { class: "o-rise", style: { "--i": 2 } }, readyT, ready));
      return { el, update(v) { updReady(v); } };
    }
    let peeked = false;
    const seen = btn(h("span", { class: "o-btn-l", text: "Gezien ✓" }), "seen", "o-btn-primary o-btn-hero o-btn-soft", () => {
      if (latest.pending.has("revealed")) return;
      sfx.lock(); buzz(15); act("revealed");
    });
    const card = secretCard(() => { if (!peeked) { peeked = true; seen.classList.remove("o-btn-soft"); sfx.whoosh(); } });
    const hint = h("p", { class: "o-reveal-hint o-rise", style: { "--i": 2 }, text: "Laat niemand meekijken 👀" });
    const dock = h("div", { class: "o-dock" }, seen);
    const el = h("div", { class: "o-view o-reveal" },
      phaseHead(`Spel ${v0.pub.gameNo} · ${v0.pub.settings.mode === "blind" ? "geen woord" : "ander woord"}`, "Jouw geheime woord").el,
      h("div", { class: "o-c3-stage o-rise", style: { "--i": 1 } }, card.el), hint,
      h("div", { class: "o-rise", style: { "--i": 3 } }, readyT, ready), dock);
    function updReady(v) {
      const ps = aliveP(v.pub);
      const n = ps.filter((p) => v.pub.ready.includes(p.pid)).length;
      readyT.textContent = `${n} van ${ps.length} klaar`;
      keyed(ready, ps, (p) => p.pid, (p) => h("span", { class: "o-ready-i" }, avatar(p, "sm"), h("i", { class: "o-ready-ok" }, icon("check"))),
        (it, p) => { setAvatar(it.firstChild, p); it.classList.toggle("on", v.pub.ready.includes(p.pid)); it.title = p.name; });
    }
    return {
      el,
      update(v) {
        card.set(v.priv);
        updReady(v);
        const done = v.pub.ready.includes(v.me.pid) || v.pending.has("revealed");
        seen.disabled = done;
        seen.classList.toggle("is-done", done);
        seen.firstChild.textContent = done ? "Wachten op de rest…" : "Gezien ✓";
        hint.textContent = done ? "Je kunt je woord later nog zien met 👁 Mijn woord" : "Laat niemand meekijken 👀";
      },
    };
  };

  // ---------- Hints ----------
  function renderFeed(box, pub) {
    const rounds = [...new Set(pub.hints.map((x) => x.round))].sort((a, b) => b - a);
    const groups = rounds.map((r) => ({ r, items: pub.hints.filter((x) => x.round === r) }));
    keyed(box, groups, (g) => "r" + g.r, (g) => h("div", { class: "o-feed-g" }, h("h4", { class: "o-feed-h", text: "Ronde " + g.r }), h("div", { class: "o-feed-l" })), (gel, g) => {
      const list = gel.lastChild;
      keyed(list, g.items, (x, i) => i + ":" + x.pid, (x) => {
        const p = P(pub, x.pid) || { name: "?", avatar: "❔", color: "#888" };
        const txt = x.skipped ? "—" : x.text ? x.text : "🗣️ hardop gezegd";
        return h("div", { class: "o-bub o-pop" + (x.skipped ? " is-skip" : "") + (!x.text && !x.skipped ? " is-loud" : ""), style: { "--pc": p.color } },
          avatar(p, "sm"),
          h("div", { class: "o-bub-b" }, h("span", { class: "o-bub-n", text: p.name + (pub.settings.hintRounds > 1 ? " · " + x.hintRound : "") }), h("span", { class: "o-bub-t", text: txt })));
      });
    });
  }
  VIEWS.hints = (v0) => {
    const w = watchText(v0);
    const head = phaseHead("", null, h("div", { class: "o-phead-r" }, playing(v0) || (P(v0.pub, v0.me.pid) && !P(v0.pub, v0.me.pid).spectator) ? peekChip(() => latest.priv) : null));
    const stageAv = h("span", { class: "o-spot-av" });
    const ring = h("span", { class: "o-spot-ring" });
    const tmr = h("span", { class: "o-timer" });
    const spotName = h("h2", { class: "o-spot-name" });
    const spotSub = h("p", { class: "o-spot-sub" });
    const spot = h("section", { class: "o-spot o-rise", style: { "--i": 1 } }, h("div", { class: "o-spot-stage" }, ring, tmr, stageAv), spotName, spotSub);
    const order = h("div", { class: "o-order o-rise", style: { "--i": 2 } });

    const input = h("input", { class: "o-input o-hint-in", "data-act": "hint-input", maxlength: "32", placeholder: "Typ je hint…", enterkeyhint: "send", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "Jouw hint" });
    const send = h("button", { class: "o-hint-send", type: "submit", "data-act": "hint-send", "aria-label": "Versturen" }, icon("send"));
    const aloud = btn("Hardop gezegd ✓", "hint-aloud", "o-btn-glass o-btn-wide", () => submitHint(""));
    const counter = h("span", { class: "o-hint-count", text: "0/32" });
    const form = h("form", { class: "o-hint-form o-glass", autocomplete: "off" },
      h("p", { class: "o-hint-k", text: "Geef één hint over je woord — niet te makkelijk!" }),
      h("div", { class: "o-hint-row" }, input, send), h("div", { class: "o-hint-foot" }, counter, h("span", { text: "of zeg 'm hardop:" })), aloud);
    form.addEventListener("submit", (e) => { e.preventDefault(); submitHint(input.value); });
    input.addEventListener("input", () => { counter.textContent = Array.from(input.value).length + "/32"; });
    function submitHint(text) {
      const v = latest;
      if (!v.pub.turn || v.pub.turn.pid !== v.me.pid || v.pending.has("hint")) return;
      sfx.lock(); buzz(12);
      act("hint", { text: String(text).trim().slice(0, 32) });
      input.value = ""; counter.textContent = "0/32"; input.blur();
    }
    const feed = h("section", { class: "o-feed o-rise", style: { "--i": 3 } });
    let skipAt = 0; // dubbele tik = één beurt overslaan (de view blijft staan, dus de tap-guard helpt hier niet)
    const skip = btn([icon("skip"), " Beurt overslaan"], "skip", "o-btn-glass o-btn-sm", () => {
      if (Date.now() - skipAt < 600) return;
      skipAt = Date.now(); sfx.tap(); act("skip");
    });
    const force = btn([icon("lock"), " Nu stemmen"], "force-vote", "o-btn-glass o-btn-sm", () => { sfx.tap(); act("forceVote"); });
    const dock = v0.me.isHost ? h("div", { class: "o-dock o-dock-tools", "aria-label": "Host" }, skip, force) : null;
    const el = h("div", { class: "o-view o-hints" }, head.el, w && h("p", { class: "o-watch-pill o-rise", text: w }), spot, form, order, feed, dock);
    let turnKey = null, timerT = null;

    function setTimer(v) {
      clearTimeout(timerT);
      tmr.replaceChildren();
      tmr.classList.remove("late");
      const secs = v.pub.settings.timer;
      if (!secs || !v.pub.turn) return;
      let elapsed = Date.now() - (v.pub.turn.startedAt || Date.now());
      if (elapsed < 0 || elapsed > secs * 1000 + 5000) elapsed = 0;
      const left = Math.max(0, secs * 1000 - elapsed);
      const r = 46, cfr = 2 * Math.PI * r;
      const run = sv("circle", { cx: 50, cy: 50, r, class: "o-timer-run", "stroke-dasharray": cfr.toFixed(2), style: `--c:${cfr.toFixed(2)};animation-duration:${secs}s;animation-delay:-${(elapsed / 1000).toFixed(2)}s` });
      tmr.append(sv("svg", { viewBox: "0 0 100 100" }, sv("circle", { cx: 50, cy: 50, r, class: "o-timer-track" }), run));
      timerT = setTimeout(() => {
        tmr.classList.add("late");
        if (latest.pub.turn && latest.pub.turn.pid === latest.me.pid) { buzz([80, 60, 80]); sfx.alarm(); }
      }, left);
    }
    return {
      el,
      destroy() { clearTimeout(timerT); },
      update(v) {
        const pub = v.pub, turn = pub.turn;
        head.k.textContent = `Ronde ${pub.round} · hint ${turn ? turn.hintRound : pub.settings.hintRounds}/${pub.settings.hintRounds}`;
        const tp = turn && P(pub, turn.pid);
        const mine = !!(tp && tp.pid === v.me.pid);
        const k = turn ? `${turn.pid}:${turn.hintRound}:${turn.startedAt}` : "none";
        if (k !== turnKey) {
          turnKey = k;
          if (tp) {
            stageAv.replaceChildren(avatar(tp, "xl"));
            ring.style.setProperty("--pc", tp.color);
            tmr.style.setProperty("--pc", tp.color);
            restart(spot, "o-spot-swap");
          }
          setTimer(v);
        }
        spot.classList.toggle("is-mine", mine);
        spotName.textContent = mine ? "Jouw beurt!" : tp ? tp.name : "…";
        const sending = mine && v.pending.has("hint");
        spotSub.textContent = mine ? (sending ? "Hint versturen…" : "Iedereen wacht op jouw hint") : tp ? "is aan de beurt" : "";
        form.hidden = !mine;
        input.disabled = send.disabled = aloud.disabled = sending;
        // volgorde-strip
        const said = new Set(pub.hints.filter((x) => x.round === pub.round && turn && x.hintRound === turn.hintRound).map((x) => x.pid));
        const ord = pub.order.map((pid) => P(pub, pid)).filter(Boolean);
        keyed(order, ord, (p) => p.pid, (p) => h("span", { class: "o-ord" }, avatar(p, "xs"), h("i", { class: "o-ord-x", text: "✓" })), (it, p) => {
          setAvatar(it.firstChild, p);
          const out = !p.alive || p.left;
          it.classList.toggle("now", !!turn && p.pid === turn.pid);
          it.classList.toggle("done", !out && said.has(p.pid));
          it.classList.toggle("out", out);
          it.title = p.name;
        });
        renderFeed(feed, pub);
        if (!pub.hints.length && !feed.querySelector(".o-empty")) feed.append(h("p", { class: "o-empty", text: "Nog geen hints. De eerste is altijd het moeilijkst…" }));
        else if (pub.hints.length) { const e0 = feed.querySelector(".o-empty"); if (e0) e0.remove(); }
      },
    };
  };

  // ---------- Stemmen ----------
  function voteMode(v) {
    if (!playing(v)) return "watch";
    return v.pub.voted.includes(v.me.pid) || v.pending.has("vote") ? "wait" : "pick";
  }
  let myVote = { key: null, pid: null };
  VIEWS.vote = (v0) => {
    const mode = voteMode(v0);
    const pub0 = v0.pub;
    const vkey = `${pub0.code}:${pub0.gameNo}:${pub0.round}:${pub0.revote ? 1 : 0}`;
    const head = phaseHead(`Ronde ${pub0.round} · stemmen`, "Wie is de infiltrant?", h("div", { class: "o-phead-r" }, playing(v0) ? peekChip(() => latest.priv) : null));
    const banner = pub0.revote ? h("div", { class: "o-revote o-rise", style: { "--i": 1 } }, h("b", { text: "Gelijkspel! Nog één keer" }), h("span", { text: "Kies tussen de koplopers." })) : null;
    const tally = h("span", { class: "o-count" });
    const sheetB = btn([icon("chat"), " Bekijk hints"], "hints-sheet", "o-btn-glass o-btn-sm", () => { sfx.tap(); hintsSheet(latest); });
    const meta = h("div", { class: "o-vmeta o-rise", style: { "--i": 3 } }, sheetB, tally);
    const closeV = v0.me.isHost ? btn("Stemmen sluiten", "close-vote", "o-btn-glass o-btn-sm", async () => {
      const v = latest;
      if (!v.pub.voted.length) { toast("Er heeft nog niemand gestemd"); return; }
      const missing = aliveP(v.pub).length - v.pub.voted.length;
      if (missing > 0 && !(await ask({ emoji: "⏱️", title: "Stemmen sluiten?", text: `${plural(missing, "speler heeft", "spelers hebben")} nog niet gestemd. De stemmen die er zijn tellen.`, ok: "Sluiten" }))) return;
      act("closeVote");
    }) : null;
    let sel = null;
    const parts = [head.el, banner];
    let grid = null, submit = null, waitBox = null, waitT = null, youVoted = null;
    if (mode === "pick") {
      grid = h("div", { class: "o-vgrid o-rise", style: { "--i": 2 }, role: "radiogroup", "aria-label": "Kies wie de infiltrant is" });
      grid.addEventListener("click", (e) => {
        const b = e.target.closest("[data-pid]");
        if (!b) return;
        sel = sel === b.dataset.pid ? null : b.dataset.pid;
        sfx.tap(); buzz(8);
        this0.update(latest);
      });
      submit = h("button", { class: "o-btn o-btn-primary o-btn-hero", type: "button", "data-act": "vote-submit", onclick: () => {
        if (latest.pending.has("vote") || latest.pub.voted.includes(latest.me.pid)) return; // stem is al onderweg
        if (!sel) { shake(grid); toast("Tik eerst op iemand"); return; }
        myVote = { key: vkey, pid: sel };
        sfx.lock(); buzz([20, 40, 60]);
        act("vote", { target: sel });
      } }, h("span", { class: "o-btn-l" }, icon("lock"), h("span", { class: "o-vs-l", text: "Stem vastleggen" })), h("span", { class: "o-btn-sub" }));
      parts.push(grid, meta, h("div", { class: "o-dock" }, submit, closeV));
    } else {
      const target = v0.myVote ? P(pub0, v0.myVote) : myVote.key === vkey ? P(pub0, myVote.pid) : null;
      youVoted = h("section", { class: "o-glass o-locked o-rise", style: { "--i": 2 } },
        h("div", { class: "o-locked-ic" }, icon("lock")),
        h("div", null, h("h3", { class: "o-h3", text: mode === "watch" ? watchText(v0) : "Je stem is binnen" }),
          h("p", { class: "o-locked-t", text: mode === "watch" ? "Jij stemt deze keer niet mee." : target ? `Je stemde op ${target.name}. Geen weg meer terug!` : "Geen weg meer terug!" })),
        target ? avatar(target, "md") : null);
      waitT = h("h3", { class: "o-wait-n" });
      waitBox = h("div", { class: "o-vwait" });
      tally.hidden = true;
      parts.push(youVoted, h("section", { class: "o-glass o-card o-rise", style: { "--i": 3 } }, h("div", { class: "o-card-head" }, h("h3", { class: "o-h3", text: "Wie heeft er gestemd?" }), waitT), waitBox), meta,
        closeV ? h("div", { class: "o-dock" }, closeV) : h("div", { class: "o-dock" }, waitLine("Wachten op de andere stemmen…")));
    }
    const el = h("div", { class: "o-view o-vote" + (pub0.revote ? " is-revote" : "") }, parts);
    const this0 = {
      el,
      update(v) {
        const pub = v.pub;
        const voters = aliveP(pub);
        tally.textContent = `${pub.voted.length}/${voters.length} gestemd`;
        if (closeV) closeV.disabled = !pub.voted.length;
        if (grid) {
          const targets = voters.filter((p) => p.pid !== v.me.pid && (!pub.candidates || pub.candidates.includes(p.pid)));
          if (sel && !targets.some((p) => p.pid === sel)) sel = null;
          keyed(grid, targets, (p) => p.pid, (p, i) => h("button", { class: "o-vcard o-pop", type: "button", "data-act": "vote-pick", "data-pid": p.pid, role: "radio", style: { "--i": i } },
            h("span", { class: "o-vcard-av" }, avatar(p, "lg"), h("i", { class: "o-vcard-ok" }, icon("check"))), h("span", { class: "o-vcard-n" })), (b, p) => {
            setAvatar(b.querySelector(".o-av"), p);
            b.querySelector(".o-vcard-n").textContent = p.name;
            b.style.setProperty("--pc", p.color);
            b.classList.toggle("on", sel === p.pid);
            b.setAttribute("aria-checked", sel === p.pid ? "true" : "false");
          });
          grid.classList.toggle("has-sel", !!sel);
          const two = targets.length <= 2 || targets.length === 4;
          grid.style.setProperty("--cols", two ? "2" : "3");
          grid.classList.toggle("is-big", two);
          const sp = sel && P(pub, sel);
          submit.classList.toggle("is-off", !sp);
          submit.querySelector(".o-btn-sub").textContent = sp ? `Op ${sp.name} — dit is definitief` : "Tik op wie je verdenkt";
        }
        if (waitBox) {
          waitT.textContent = `${pub.voted.length}/${voters.length}`;
          keyed(waitBox, voters, (p) => p.pid, (p) => h("span", { class: "o-vw" }, avatar(p, "md"), h("span", { class: "o-vw-n" }), h("i", { class: "o-vw-ok" }, icon("check"))), (it, p) => {
            setAvatar(it.firstChild, p);
            it.querySelector(".o-vw-n").textContent = p.name;
            const did = pub.voted.includes(p.pid);
            if (did && !it.classList.contains("on")) { it.classList.add("on"); if (p.pid !== v.me.pid) beep(880 + pub.voted.length * 60, 0.04, "triangle", 0.05); }
            it.classList.toggle("on", did);
          });
        }
      },
    };
    return this0;
  };

  // ---------- Drama (eliminatie-onthulling, één keer per lastVote) ----------
  const DRAMA_KEY = "dva:drama";
  const dramaSeen = (() => { try { return new Set(PREVIEW ? [] : JSON.parse(sessionStorage.getItem(DRAMA_KEY) || "[]")); } catch (e) { return new Set(); } })();
  const dramaId = (pub) => pub.lastVote ? `${pub.code}:${pub.gameNo}:${pub.lastVote.round}:${pub.lastVote.revote ? 1 : 0}` : null;
  function markDrama(id) {
    dramaSeen.add(id);
    if (PREVIEW) return;
    try { sessionStorage.setItem(DRAMA_KEY, JSON.stringify([...dramaSeen].slice(-30))); } catch (e) { /* */ }
  }
  function contenders(pub) {
    const lv = pub.lastVote, tally = lv.tally || {};
    const max = Math.max(0, ...Object.values(tally));
    let ids = lv.tie ? Object.keys(tally).filter((p) => tally[p] === max) : Object.keys(tally).filter((p) => tally[p] > 0);
    if (ids.length < 2) ids = pub.players.filter((p) => !p.spectator && !p.left && (p.alive || p.pid === lv.eliminated)).map((p) => p.pid);
    const pool = ids.map((pid) => P(pub, pid)).filter(Boolean);
    return pool.sort((a, b) => pub.order.indexOf(a.pid) - pub.order.indexOf(b.pid)).slice(0, 8);
  }
  // Ring springt over de kandidaten, vertraagt en landt op de afvaller. → cancel()
  function playDrama(host, pub, done) {
    const lv = pub.lastVote;
    const pool = contenders(pub);
    const cells = pool.map((p) => h("div", { class: "o-drum-c" }, avatar(p, "lg"), h("span", { class: "o-drum-n", text: p.name })));
    const ring = h("div", { class: "o-drum-ring" });
    const grid = h("div", { class: "o-drum-g" + (pool.length > 4 ? " is-many" : "") }, cells, ring);
    const title = h("h2", { class: "o-title o-drum-t", text: "De stemmen zijn geteld…" });
    const stage = h("section", { class: "o-drum" }, kicker(lv.revote ? "Herstemming" : "Ronde " + lv.round), title, grid, h("div", { class: "o-drum-roll", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"), h("i")));
    host.append(stage);
    const timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    const n = pool.length;
    const target = lv.eliminated ? pool.findIndex((p) => p.pid === lv.eliminated) : -1;
    const steps = [];
    for (let d = 70, tot = 0; tot < 2250; d = d * 1.12 + 8) { steps.push(d); tot += d; }
    let idx = target >= 0 ? (((target - steps.length) % n) + n) % n : 0;
    const move = (i) => {
      const a = cells[i] && cells[i].firstChild;
      if (!a) return;
      ring.style.translate = `${a.offsetLeft + a.offsetWidth / 2}px ${a.offsetTop + a.offsetHeight / 2}px`;
      cells.forEach((c, j) => c.classList.toggle("lit", j === i));
    };
    requestAnimationFrame(() => {
      ring.style.transition = "none";
      move(idx);
      void ring.offsetWidth;
      ring.style.transition = "";
      ring.classList.add("on");
    });
    let t = 450;
    steps.forEach((dt, k) => {
      t += dt;
      later(() => { idx = (idx + 1) % n; move(idx); sfx.tick(k); buzz(4); }, t);
    });
    later(() => {
      if (target >= 0) {
        stage.classList.add("landed");
        cells[target].classList.add("hit");
        title.textContent = pool[target].name + "…";
      } else {
        stage.classList.add("landed", "tied");
        ring.classList.remove("on");
        cells.forEach((c) => c.classList.add("hit"));
        title.textContent = "Gelijkspel!";
      }
      sfx.thud(); buzz([30, 40, 90]);
    }, t + 380);
    later(done, t + 1450);
    return () => timers.forEach(clearTimeout);
  }
  function verdictCard(pub, v) {
    const lv = pub.lastVote;
    if (!lv.eliminated) {
      const tied = contenders(pub);
      return h("section", { class: "o-verdict is-tie" },
        h("div", { class: "o-verdict-avs" }, tied.slice(0, 4).map((p) => avatar(p, "lg"))),
        h("h2", { class: "o-verdict-t", text: "Niemand eruit!" }),
        h("p", { class: "o-verdict-s", text: "Weer gelijkspel. Iedereen blijft — de infiltrant lacht in z'n vuistje." }));
    }
    const p = P(pub, lv.eliminated) || { name: "?", avatar: "❔", color: "#888" };
    const inf = lv.role === "infiltrant";
    const isMe = v && p.pid === v.me.pid;
    return h("section", { class: "o-verdict " + (inf ? "is-inf" : "is-burg") },
      h("div", { class: "o-verdict-av" }, avatar(p, "xxl"), h("span", { class: "o-verdict-x", text: inf ? "🕵️" : "😇" })),
      h("p", { class: "o-verdict-name", text: isMe ? "Jij" : p.name }),
      inf ? h("h2", { class: "o-verdict-t o-glitch", "data-text": "WAS DE INFILTRANT", text: "WAS DE INFILTRANT" }) : h("h2", { class: "o-verdict-t", text: "was een burger 😇" }),
      inf ? h("p", { class: "o-verdict-tag", text: "🕵️ ontmaskerd" }) : null,
      h("p", { class: "o-verdict-s", text: inf ? (isMe ? "Betrapt! Goed gespeeld, maar niet goed genoeg." : "Ontmaskerd! Goed gezien, speurneuzen.") : (isMe ? "Je lag eruit terwijl je onschuldig was… 💀" : "Oei… een onschuldige burger. De infiltrant loopt nog vrij rond.") }));
  }
  function tallyCard(pub) {
    const lv = pub.lastVote, tally = lv.tally || {};
    const ids = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || pub.order.indexOf(a) - pub.order.indexOf(b));
    const max = Math.max(1, ...Object.values(tally));
    const rows = ids.map((pid, i) => {
      const p = P(pub, pid) || { name: "?", avatar: "❔", color: "#888" };
      const voters = Object.keys(lv.votes || {}).filter((x) => lv.votes[x] === pid).map((x) => P(pub, x)).filter(Boolean);
      return h("div", { class: "o-tal" + (pid === lv.eliminated ? " is-out" : ""), style: { "--i": i, "--pc": p.color, "--w": (tally[pid] / max).toFixed(3) } },
        avatar(p, "sm"),
        h("div", { class: "o-tal-m" },
          h("div", { class: "o-tal-top" }, h("span", { class: "o-tal-n", text: p.name }), h("b", { class: "o-tal-c", text: plural(tally[pid], "stem", "stemmen") })),
          h("div", { class: "o-tal-bar" }, h("i")),
          voters.length ? h("div", { class: "o-tal-v" }, voters.map((x) => avatar(x, "xs"))) : null));
    });
    return h("section", { class: "o-glass o-card o-tally" }, h("div", { class: "o-card-head" }, h("h3", { class: "o-h3", text: "De stemmen" }), h("span", { class: "o-count", text: lv.revote ? "herstemming" : "ronde " + lv.round })), rows);
  }
  function guessOutcome(pub) {
    const g = pub.guess;
    if (!g || g.correct === null || g.correct === undefined) return null;
    const p = P(pub, g.pid) || { name: "?", avatar: "❔", color: "#888" };
    return h("section", { class: "o-glass o-card o-gout " + (g.correct ? "is-yes" : "is-no") },
      avatar(p, "md"),
      h("div", null, h("p", { class: "o-kicker", text: p.name + " raadde" }), h("p", { class: "o-gout-w", text: g.text ? "„" + g.text + "”" : "(niks)" })),
      h("b", { class: "o-gout-r", text: g.correct ? "Goed! 😱" : "Fout ❌" }));
  }

  // ---------- Raden (blind: betrapte infiltrant) ----------
  VIEWS.guess = (v0) => {
    const pub0 = v0.pub;
    const id = dramaId(pub0);
    const host = h("div", { class: "o-drama-host" });
    const body = h("div", { class: "o-guess-body" });
    const el = h("div", { class: "o-view o-guess" }, host, body);
    let cancel = null;
    const mine = pub0.guess && pub0.guess.pid === v0.me.pid;
    const gp = P(pub0, pub0.guess && pub0.guess.pid) || { name: "?", avatar: "❔", color: "#888" };
    const input = h("input", { class: "o-input o-guess-in", "data-act": "guess-input", maxlength: "32", placeholder: "Het woord is…", enterkeyhint: "send", autocomplete: "off", spellcheck: "false", "aria-label": "Jouw gok" });
    const sendB = h("button", { class: "o-btn o-btn-primary o-btn-hero", type: "submit", "data-act": "guess-send" }, h("span", { class: "o-btn-l", text: "Raden!" }), h("span", { class: "o-btn-sub", text: "Je hebt maar één kans" }));
    function buildBody() {
      if (mine) {
        const form = h("form", { class: "o-guess-form" },
          h("section", { class: "o-glass o-card o-guess-card o-rise" },
            h("div", { class: "o-big-e", text: "🕵️" }),
            h("h2", { class: "o-title", text: "Je bent ontmaskerd!" }),
            h("p", { class: "o-center-text", text: "Maar je kunt nog winnen. Raad het woord van de burgers:" }),
            h("p", { class: "o-guess-cat" }, h("span", { text: "Categorie" }), h("b", { text: latest.priv ? catLabel(latest.priv.category) : "?" })),
            h("label", { class: "o-guess-l", text: "Raad het woord van de burgers" }), input),
          h("div", { class: "o-dock" }, sendB));
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const t = input.value.trim();
          if (latest.pending.has("guess")) return; // gok is al onderweg
          if (!t) { shake(input); return; }
          sfx.lock(); buzz(20);
          act("guess", { text: t.slice(0, 32) });
          busy(sendB, "Raden…");
        });
        body.replaceChildren(form);
      } else {
        const feed = h("section", { class: "o-feed" });
        renderFeed(feed, latest.pub);
        body.replaceChildren(h("section", { class: "o-guessing o-glass o-rise" },
          h("div", { class: "o-spot-stage is-red" }, h("span", { class: "o-spot-ring" }), h("span", { class: "o-spot-av" }, avatar(gp, "xl"))),
          h("p", { class: "o-verdict-tag", text: "🕵️ ontmaskerd" }),
          h("h2", { class: "o-title", text: "De infiltrant mag nog één keer raden…" }),
          h("p", { class: "o-center-text", text: `Raadt ${gp.name} het woord van de burgers? Dan wint de infiltrant alsnog.` }),
          waitLine(gp.name + " denkt na")),
          h("h4", { class: "o-h4 o-rise", style: { "--i": 2 }, text: "Wat er gezegd is" }), h("div", { class: "o-rise", style: { "--i": 2 } }, feed));
      }
    }
    return {
      el,
      mounted() {
        if (id && !dramaSeen.has(id) && !reduced()) {
          body.hidden = true;
          cancel = playDrama(host, pub0, () => {
            markDrama(id);
            host.replaceChildren(h("div", { class: "o-flip-in" }, verdictCard(latest.pub, latest)));
            sfx.evil(); buzz([60, 30, 60, 30, 120]);
            setTimeout(() => { host.replaceChildren(); body.hidden = false; buildBody(); }, 2200);
          });
        } else { if (id) markDrama(id); buildBody(); }
      },
      destroy() { if (cancel) cancel(); },
      update() {},
    };
  };

  // ---------- Eliminatie ----------
  VIEWS.elim = (v0) => {
    const pub0 = v0.pub;
    const id = dramaId(pub0);
    const host = h("div", { class: "o-drama-host" });
    const results = h("div", { class: "o-elim-res" });
    const label = h("span", { class: "o-btn-l" });
    const nextB = v0.me.isHost ? h("button", { class: "o-btn o-btn-primary o-btn-hero", type: "button", "data-act": "next", onclick: () => { sfx.whoosh(); act("next"); } }, label, h("span", { class: "o-btn-sub" })) : null;
    const dock = h("div", { class: "o-dock" }, nextB || waitLine("Wachten op de host…"));
    const el = h("div", { class: "o-view o-elim" }, host, results, dock);
    let cancel = null;
    function showResults(animate) {
      const pub = latest.pub;
      const w = watchText(latest);
      results.replaceChildren();
      add(results, [
        h("div", { class: animate ? "o-flip-in" : "" }, verdictCard(pub, latest)),
        guessOutcome(pub),
        tallyCard(pub),
        w && pub.lastVote.eliminated !== latest.me.pid ? h("p", { class: "o-watch-pill", text: w }) : null,
      ]);
      dock.hidden = false;
      if (animate) {
        const inf = pub.lastVote.eliminated && pub.lastVote.role === "infiltrant";
        if (pub.guess && pub.guess.correct) { sfx.evil(); buzz([60, 40, 120]); }
        else if (!pub.lastVote.eliminated) { sfx.sad(); buzz(40); }
        else if (inf) { sfx.evil(); buzz([60, 30, 60, 30, 140]); }
        else { sfx.angel(); buzz(30); }
      }
    }
    return {
      el,
      mounted() {
        if (id && !dramaSeen.has(id) && !reduced()) {
          dock.hidden = true;
          cancel = playDrama(host, pub0, () => { markDrama(id); host.replaceChildren(); showResults(true); });
        } else { if (id) markDrama(id); showResults(false); }
      },
      destroy() { if (cancel) cancel(); },
      update(v) {
        if (!nextB) return;
        const win = (v.host && v.host.pendingWinner) || (v.pub.guess && v.pub.guess.correct ? "infiltranten" : null);
        label.textContent = win ? "Uitslag" : "Volgende ronde";
        nextB.lastChild.textContent = win ? "Het spel is voorbij — bekijk wie er wint" : `Ronde ${v.pub.round + 1}: nieuwe hints`;
      },
    };
  };

  // ---------- Uitslag ----------
  const confSeen = new Set();
  VIEWS.over = (v0) => {
    const pub = v0.pub, res = pub.result || { winner: "burgers", roles: {}, words: {}, delta: {} };
    const burgers = res.winner === "burgers";
    const infs = Object.keys(res.roles).filter((pid) => res.roles[pid] === "infiltrant").map((pid) => P(pub, pid)).filter(Boolean);
    const lines = burgers ? ["BURGERS", "WINNEN"] : infs.length > 1 ? ["INFILTRANTEN", "WINNEN"] : ["INFILTRANT", "WINT"];
    const myRole = res.roles[v0.me.pid];
    const won = myRole ? (burgers ? myRole === "burger" : myRole === "infiltrant") : null;
    const myDelta = res.delta[v0.me.pid] || 0;
    const lineCls = "o-win-l" + (burgers ? "" : " o-glitch");
    const t1 = h("span", { class: lineCls, "data-text": lines[0], text: lines[0] }), t2 = h("span", { class: lineCls, "data-text": lines[1], text: lines[1] });
    const banner = h("section", { class: "o-win " + (burgers ? "is-b" : "is-i") },
      kicker(`Spel ${pub.gameNo} · uitslag`),
      h("div", { class: "o-win-e", text: burgers ? "😇" : "🕵️" }),
      h("h1", { class: "o-win-t", "aria-label": lines.join(" ") }, t1, " ", t2),
      h("p", { class: "o-win-s", text: burgers ? (infs.length > 1 ? "De infiltranten zijn ontmaskerd!" : "De infiltrant is ontmaskerd!") : pub.guess && pub.guess.correct ? "Het woord geraden — wat een bluffer!" : "Niemand had het door. Wat een bluf!" }),
      won === null ? null : h("p", { class: "o-win-me " + (won ? "is-won" : "is-lost"), text: won ? `Jij wint! +${myDelta} 🎉` : `Verloren… ${myDelta ? "+" + myDelta + " voor goed stemmen" : "volgende keer beter"} 😅` }));
    const reveal = h("section", { class: "o-glass o-card o-infs o-rise", style: { "--i": 1 } },
      kicker(infs.length > 1 ? "De infiltranten waren" : "De infiltrant was"),
      h("div", { class: "o-infs-l" }, infs.map((p) => h("div", { class: "o-infs-i" }, avatar(p, "lg"), h("b", { text: p.name })))));
    const words = h("section", { class: "o-words o-rise", style: { "--i": 2 } },
      h("div", { class: "o-wcard is-b" }, h("span", { class: "o-wcard-k", text: "😇 Burgers" }), h("b", { class: "o-wcard-w", text: res.words.burger || "?" })),
      h("div", { class: "o-wcard is-i" }, h("span", { class: "o-wcard-k", text: "🕵️ Infiltrant" }), h("b", { class: "o-wcard-w", text: res.words.infiltrant || "geen woord" })),
      h("p", { class: "o-words-cat", text: catLabel(res.category) }));
    const ranked = activeP(pub).slice().sort((a, b) => (pub.scores[b.pid] || 0) - (pub.scores[a.pid] || 0) || (res.delta[b.pid] || 0) - (res.delta[a.pid] || 0));
    const MED = ["🥇", "🥈", "🥉"];
    const board = h("section", { class: "o-glass o-card o-board o-rise", style: { "--i": 3 } },
      h("div", { class: "o-card-head" }, h("h3", { class: "o-h3", text: "Scorebord" }), h("span", { class: "o-count", text: "na " + plural(pub.gameNo, "potje", "potjes") })),
      ranked.map((p, i) => {
        const sc = pub.scores[p.pid] || 0;
        const rank = 1 + ranked.filter((q) => (pub.scores[q.pid] || 0) > sc).length;
        const role = res.roles[p.pid];
        const d = res.delta[p.pid] || 0;
        return h("div", { class: "o-row" + (p.pid === v0.me.pid ? " is-me" : "") + (role === "infiltrant" ? " is-inf" : ""), style: { "--i": i } },
          h("span", { class: "o-row-rank", text: rank <= 3 && sc > 0 ? MED[rank - 1] : String(rank) }),
          avatar(p, "sm"),
          h("span", { class: "o-row-n" }, h("b", { text: p.name }), h("small", { text: role === "infiltrant" ? "🕵️ infiltrant" : role === "burger" ? "😇 burger" : "👀 keek mee" })),
          h("span", { class: "o-row-d" + (d > 0 ? " up" : ""), text: d > 0 ? "+" + d : "±0" }),
          h("b", { class: "o-row-s", text: String(sc) }));
      }));
    const again = v0.me.isHost ? btn(h("span", { class: "o-btn-l" }, icon("play"), h("span", { text: "Nog een potje" })), "again", "o-btn-primary o-btn-hero", () => { sfx.whoosh(); act("next"); act("start"); }) : null;
    const lobby = v0.me.isHost ? btn("Naar de lobby", "to-lobby", "o-btn-glass o-btn-sm", () => { sfx.tap(); act("next"); }) : null;
    const dock = h("div", { class: "o-dock" + (lobby ? " is-row" : "") }, lobby, again || waitLine("Wachten op de host…"));
    const el = h("div", { class: "o-view o-over " + (burgers ? "is-b" : "is-i") }, banner, reveal, words, board, dock);
    return {
      el,
      mounted() {
        afterFonts(() => { const max = Math.min(60, el.clientWidth / 5.2); fit(t1, max, 18); fit(t2, max, 18); const m = Math.min(parseFloat(t1.style.fontSize), parseFloat(t2.style.fontSize)); t1.style.fontSize = t2.style.fontSize = m + "px"; });
        const k = pub.code + ":" + pub.gameNo;
        if (!confSeen.has(k)) {
          confSeen.add(k);
          setTimeout(() => {
            confetti(burgers ? ["#2dffb3", "#9dff3d", "#22e6ff", "#ffffff", "#ffe03d"] : ["#ff3b5c", "#ff8a00", "#ff2e93", "#ffffff", "#8b5cff"], 200);
            fanfare(); buzz([40, 30, 40, 30, 160]);
          }, reduced() ? 0 : 450);
        }
      },
      update() {},
    };
  };

  // =========================================================
  // #online — profiel, kamer maken, meedoen, uitleg
  // =========================================================
  let home = null, pendingJoin = null;
  function buildHome(root) {
    const prof = getProfile();
    const hero = h("header", { class: "o-hero" },
      h("div", { class: "o-emblem", "aria-hidden": "true" }, h("i", { class: "o-emblem-ring" }), h("i", { class: "o-emblem-core" }), h("span", { class: "o-emblem-e", text: "🕵️" })),
      h("h1", { class: "o-brand", "data-text": "INFILTRANT" }, h("span", { text: "INFILTRANT" })),
      h("p", { class: "o-tagline", text: "Eén van jullie liegt." }),
      h("p", { class: "o-sub", text: "Online · ieder op z'n eigen telefoon · 3–12 spelers" }));
    const resumeBox = h("div", { class: "o-resume-box" });
    const pe = profileEditor(prof, (p) => { setProfile(p); }, { open: !prof.name });
    const profCard = h("section", { class: "o-glass o-card o-rise", style: { "--i": 1 } }, h("div", { class: "o-card-head" }, h("h3", { class: "o-h3", text: "Wie ben jij?" })), pe.el);

    const createB = h("button", { class: "o-btn o-btn-primary o-btn-hero", type: "button", "data-act": "create", onclick: () => onCreate(createB) },
      h("span", { class: "o-btn-l" }, h("span", { text: "Kamer maken" })), h("span", { class: "o-btn-sub", text: "Jij bent de host · vrienden scannen je QR" }));
    const boxes = [0, 1, 2, 3].map((i) => h("input", {
      class: "o-cb", "data-act": "code", "data-i": i, inputmode: "text", autocapitalize: "characters", autocomplete: "off", autocorrect: "off",
      spellcheck: "false", enterkeyhint: i === 3 ? "go" : "next", "aria-label": "Letter " + (i + 1) + " van de kamercode",
    }));
    const codebox = h("div", { class: "o-codebox", role: "group", "aria-label": "Kamercode" }, boxes);
    const err = h("p", { class: "o-err", role: "alert" });
    const joinB = h("button", { class: "o-btn o-btn-glass o-btn-wide o-btn-join", type: "button", "data-act": "join", onclick: () => onJoin(code(), pendingJoin && pendingJoin.code === code() ? pendingJoin.b : undefined) }, "Meedoen");
    const code = () => boxes.map((b) => b.value).join("");
    const setCode = (s) => { const c = String(s || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4); boxes.forEach((b, i) => { b.value = c[i] || ""; }); syncCode(); };
    function syncCode() {
      const c = code();
      boxes.forEach((b) => b.classList.toggle("filled", !!b.value));
      joinB.classList.toggle("ready", c.length === 4);
      err.textContent = "";
    }
    const parseCode = (t) => { const m = /join=([A-Za-z]{4})/.exec(t); return (m ? m[1] : t).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4); };
    boxes.forEach((b, i) => {
      b.addEventListener("focus", () => setTimeout(() => { if (document.activeElement === b) b.select(); }, 0));
      b.addEventListener("input", () => {
        const v = b.value.toUpperCase().replace(/[^A-Z]/g, "");
        if (v.length > 1) { // plakken / autocorrect: verdelen over de vakjes
          const all = (code().slice(0, i) + v).slice(0, 4);
          setCode(all);
          if (all.length === 4) { b.blur(); joinB.focus({ preventScroll: true }); } else boxes[all.length].focus();
          return;
        }
        b.value = v;
        syncCode();
        if (v && i < 3) boxes[i + 1].focus();
        if (v && i === 3) { b.blur(); joinB.focus({ preventScroll: true }); sfx.tap(); }
      });
      b.addEventListener("keydown", (e) => {
        if (e.key === "Backspace" && !b.value && i > 0) { boxes[i - 1].value = ""; boxes[i - 1].focus(); syncCode(); e.preventDefault(); }
        else if (e.key === "ArrowLeft" && i > 0) boxes[i - 1].focus();
        else if (e.key === "ArrowRight" && i < 3) boxes[i + 1].focus();
        else if (e.key === "Enter") { e.preventDefault(); joinB.click(); }
      });
      b.addEventListener("paste", (e) => {
        const t = (e.clipboardData || window.clipboardData).getData("text");
        const c = parseCode(t);
        if (!c) return;
        e.preventDefault();
        setCode(c);
        boxes[Math.min(3, c.length)].focus();
      });
    });
    const actions = h("section", { class: "o-glass o-card o-actions o-rise", style: { "--i": 2 } },
      createB,
      h("div", { class: "o-or" }, h("span", { text: "of doe mee met een code" })),
      codebox, err, joinB);

    const STEPS = [
      ["📱", "Maak een kamer", "Je vrienden scannen de QR of tikken op je link. Iedereen speelt op z'n eigen telefoon."],
      ["🤫", "Bekijk je geheime woord", "Iedereen krijgt hetzelfde woord… behalve de infiltrant: die krijgt een ánder woord (of geen)."],
      ["💬", "Geef om de beurt een hint", "Eén woord of korte zin. Te duidelijk? Dan weet de infiltrant het ook. Te vaag? Dan lijk jij verdacht."],
      ["🗳️", "Stem wie de infiltrant is", "Ligt hij eruit, dan winnen de burgers. Blijft hij uit handen tot het einde, dan wint de infiltrant."],
    ];
    const how = h("details", { class: "o-glass o-how o-rise", style: { "--i": 3 } },
      h("summary", { class: "o-how-s" }, h("span", { text: "Hoe werkt het?" }), h("i", { class: "o-how-chev" })),
      h("ol", { class: "o-how-l" }, STEPS.map(([e, t, d], i) => h("li", { class: "o-how-i" },
        h("span", { class: "o-how-n", text: String(i + 1) }), h("div", null, h("b", { text: e + " " + t }), h("p", { text: d }))))));

    root.replaceChildren(hero, resumeBox, profCard, actions, how);
    return {
      pe, setCode, err, joinB, codebox, boxes,
      refresh() {
        // Hervat-kaart als er nog een kamer loopt
        const s = liveSession();
        const k = s && s.code ? s.code + ":" + (s.isHost ? 1 : 0) : "";
        if (resumeBox.dataset.k !== k) {
          resumeBox.dataset.k = k;
          resumeBox.replaceChildren(k ? h("section", { class: "o-glass o-resume o-rise" },
            h("div", { class: "o-resume-e", text: s.isHost ? "👑" : "🕵️" }),
            h("div", { class: "o-resume-t" }, h("b", { text: "Je zit nog in kamer " + s.code }), h("small", { text: s.isHost ? "Jij bent de host" : "Spring er weer in" })),
            btn("Terug", "resume", "o-btn-primary o-btn-sm", () => { sfx.tap(); location.hash = "room"; })) : "");
        }
        pe.set(getProfile());
      },
    };
  }
  const liveSession = () => (C.session && !C.ended ? C.session : store.get("session", null));
  function refreshHome() {
    const root = $("#olHome");
    if (!root) return;
    if (!home) home = buildHome(root);
    home.refresh();
  }
  function requireName() {
    const p = getProfile();
    if (!p.name.trim()) {
      if (home) { shake(home.pe.name); home.pe.name.focus(); }
      toast("Vul eerst je naam in ✍️");
      return null;
    }
    return Object.assign(p, { name: p.name.trim() });
  }
  async function leaveOld(newCode) {
    if (C.ended) await teardown(true); // kamer is al voorbij: gewoon opruimen
    const old = liveSession();
    if (!old) return true;
    const ok = await ask({ emoji: "🔁", title: "Andere kamer?", text: `Je zit nog in kamer ${old.code}${old.isHost ? " (als host)" : ""}. Die ${old.isHost ? "sluiten" : "verlaten"} en ${newCode ? "naar " + newCode : "een nieuwe maken"}?`, ok: old.isHost ? "Sluiten en door" : "Verlaten en door" });
    if (!ok) return false;
    resume();
    await leaveRoom();
    return true;
  }
  async function onCreate(b) {
    const prof = requireName();
    if (!prof || b.disabled) return;
    if (!(await leaveOld())) return;
    busy(b, "Kamer maken…");
    try {
      await createRoom(prof);
      sfx.pop(); buzz(15);
      location.hash = "room";
    } catch (e) {
      console.warn(e);
      toast("Geen verbinding met de server 😕 Probeer het zo nog eens");
      await teardown(true);
    } finally { busy(b, false); }
  }
  async function onJoin(code, b) {
    if (!home) return;
    const prof = requireName();
    if (!prof || home.joinB.disabled) return;
    if (code.length !== 4) { shake(home.codebox); home.err.textContent = "Vul de 4 letters van de kamercode in"; return; }
    if (C.ended) await teardown(true);
    const old = liveSession();
    if (old && old.code === code) { if (resume()) { location.hash = "room"; return; } }
    if (old && !(await leaveOld(code))) return;
    busy(home.joinB, "Kamer zoeken…");
    try {
      const found = await N.findRoom(code, { preferIndex: b });
      if (!found) { home.err.textContent = `Kamer ${code} niet gevonden 🤔 Klopt de code?`; shake(home.codebox); return; }
      const st = found.state;
      if (Array.isArray(st.players) && st.phase === "lobby" && st.players.filter((p) => !p.left).length >= E.MAX_PLAYERS) {
        home.err.textContent = "Deze kamer is vol (12 spelers)"; shake(home.codebox); return;
      }
      await joinRoom(code, found, prof);
      pendingJoin = null;
      sfx.pop(); buzz(15);
      location.hash = "room";
    } catch (e) {
      console.warn(e);
      home.err.textContent = "Geen verbinding met de server 😕 Probeer het nog eens";
      await teardown(true);
    } finally { busy(home.joinB, false); }
  }

  // =========================================================
  // Routes, deeplinks, preview
  // =========================================================
  hooks.online = () => {
    refreshHome();
    if (pendingJoin && home) {
      home.setCode(pendingJoin.code);
      const p = getProfile();
      const other = liveSession();
      if (p.name.trim() && !pendingJoin.tried && (!other || other.code === pendingJoin.code)) {
        pendingJoin.tried = true;
        setTimeout(() => onJoin(pendingJoin.code, pendingJoin.b), 350);
      } else if (!p.name.trim()) toast("Vul je naam in en tik op Meedoen 👇");
    }
  };
  hooks.room = () => {
    if (PREVIEW) { if (previewVm) { cur.key = null; renderRoom(previewVm); } else ensureShell(); return; }
    if (!C.session && !resume()) {
      history.replaceState(null, "", location.pathname + location.search + "#online");
      DVA.show("online");
      return;
    }
    fxPrev = null;
    cur.key = null;
    renderRoom(vm());
    wake();
    if (!C.room) connectLoop();
  };

  if (!PREVIEW) {
    const j = (QS.get("join") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    if (j.length === 4) {
      if (N.brokerOverride) N.brokerOverride(); // bewaart ?broker= in sessionStorage vóór we de URL opschonen
      const b = parseInt(QS.get("b"), 10);
      pendingJoin = { code: j, b: Number.isInteger(b) && b >= 0 ? b : undefined };
      history.replaceState(null, "", location.pathname + "#online");
    }
  } else {
    // Preview: nooit verbinden; meteen het kamerscherm tonen
    history.replaceState(null, "", location.pathname + location.search + "#room");
    const s = document.createElement("script");
    s.src = "online/preview.js";
    s.onerror = () => console.error("preview.js kon niet laden");
    document.body.append(s);
  }

  window.DVOnline = {
    debug: () => ({ pub: C.pub, priv: C.priv, me: C.session && { pid: C.session.pid, isHost: C.session.isHost, code: C.session.code }, status: C.status, outbox: C.outbox.slice(), presence: Object.assign({}, C.presence) }),
    // Preview / design-QA: render het kamerscherm met een vaste vm (zonder netwerk)
    preview(v) {
      previewVm = Object.assign({ presence: {}, pending: new Set(), status: "online", host: null, ended: null, brokerIndex: 0, since: Date.now() }, v);
      if (!(previewVm.pending instanceof Set)) previewVm.pending = new Set(previewVm.pending || []);
      if (!isActive("room")) { DVA.show("room"); return; } // hooks.room rendert
      cur.key = null;
      renderRoom(previewVm);
    },
    qrSvg, // design-QA: QR-SVG voor willekeurige tekst
    AVATARS, NEON,
  };
})();
