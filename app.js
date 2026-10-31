(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // Vuurpalet (SPEC-2 §A): warm, met één blauw vlammetje
  const COLORS = ["#ff6a1a", "#ffc247", "#e8401c", "#ffe7b8", "#ff9a3c", "#5aa9ff", "#c98f5a", "#ffd98a", "#ff7a45", "#b8a99a"];
  const INK = "#2a1208"; // donkere tekst op lichte vlakken
  // Is een hex-kleur licht genoeg voor donkere tekst?
  const isLight = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150; };
  const rand = (n) => Math.floor(Math.random() * n);
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- Opslag ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("dva:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("dva:" + k, JSON.stringify(v)); } catch { /* privémodus */ } },
  };

  // ---------- Geluid & trillen ----------
  let soundOn = store.get("sound", true);
  let ac;
  function audio() {
    if (!soundOn) return null;
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
    if (ac.state === "suspended") ac.resume();
    return ac;
  }
  function beep(freq = 880, dur = 0.05, type = "square", vol = 0.08, when = 0) {
    const a = audio(); if (!a) return;
    const t = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.22, "triangle", 0.12, i * 0.11));
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* niet ondersteund */ } };

  const soundBtn = $("#soundBtn");
  const renderSound = () => { soundBtn.textContent = soundOn ? "🔊 Geluid aan" : "🔇 Geluid uit"; };
  soundBtn.onclick = () => { soundOn = !soundOn; store.set("sound", soundOn); renderSound(); if (soundOn) beep(660, .08); };
  renderSound();

  // ---------- Toast ----------
  let toastT;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- Confetti ----------
  const cv = $("#confetti"), cx = cv.getContext("2d");
  let parts = [], confRaf;
  function confetti(colors = COLORS, n = 160) {
    const dpr = devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < n; i++) {
      parts.push({
        x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .45,
        vx: (Math.random() - .5) * 16, vy: -Math.random() * 16 - 6,
        r: Math.random() * Math.PI, vr: (Math.random() - .5) * .4,
        w: 6 + Math.random() * 8, h: 4 + Math.random() * 6,
        c: colors[rand(colors.length)], life: 0,
      });
    }
    if (!confRaf) confRaf = requestAnimationFrame(stepConfetti);
  }
  function stepConfetti() {
    cx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => p.y < innerHeight + 40 && p.life < 400);
    for (const p of parts) {
      p.life++; p.vy += .45; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c;
      cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 6))); cx.restore();
    }
    confRaf = parts.length ? requestAnimationFrame(stepConfetti) : null;
  }

  // ---------- Navigatie ----------
  const screens = {};
  const hooks = {};
  $$(".screen").forEach((s) => (screens[s.dataset.screen] = s));
  function show(name) {
    if (!screens[name]) name = "home";
    Object.values(screens).forEach((s) => s.classList.toggle("active", s === screens[name]));
    window.scrollTo(0, 0);
    hooks[name] && hooks[name]();
  }
  $$("[data-go]").forEach((b) => (b.onclick = () => {
    beep(520, .04);
    // "Speel samen": #online maakt meteen een kamer (online/ui.js leest dit vlaggetje)
    if (b.dataset.autocreate) { try { sessionStorage.setItem("dva:autocreate", "1"); } catch { /* privémodus */ } }
    location.hash = b.dataset.go;
  }));
  $$("[data-back]").forEach((b) => (b.onclick = () => { history.length > 1 && location.hash ? history.back() : (location.hash = ""); }));
  addEventListener("hashchange", () => show(location.hash.slice(1)));

  // ---------- Herbruikbare lijst-editor ----------
  function listEditor(root, key, defaults, placeholder, onChange) {
    let items = store.get(key, defaults);
    root.innerHTML = `
      <form class="add-row"><input maxlength="40" enterkeyhint="done" placeholder="${placeholder}"><button aria-label="Toevoegen">+</button></form>
      <div class="chips"></div>`;
    const input = $("input", root), chips = $(".chips", root);
    function render() {
      chips.innerHTML = items.length ? "" : `<div class="chips-empty">Nog niks toegevoegd.</div>`;
      items.forEach((it, i) => {
        const el = document.createElement("span");
        el.className = "chip"; el.style.setProperty("--c", COLORS[i % COLORS.length]);
        el.innerHTML = `<span class="dot"></span><span></span><button aria-label="Verwijder">✕</button>`;
        el.children[1].textContent = it;
        el.lastChild.onclick = () => { items.splice(i, 1); save(); };
        chips.appendChild(el);
      });
    }
    function save() { store.set(key, items); render(); onChange && onChange(items); }
    $("form", root).onsubmit = (e) => {
      e.preventDefault();
      const v = input.value.trim(); if (!v) return;
      v.split(",").map((s) => s.trim()).filter(Boolean).forEach((s) => items.push(s));
      input.value = ""; save(); beep(740, .04);
    };
    render();
    return {
      get: () => items,
      set: (v) => { items = [...v]; save(); },
    };
  }

  // =========================================================
  // VINGERKIEZER
  // =========================================================
  (() => {
    const area = $("#fingerArea"), flood = $("#flood");
    const fingers = new Map();
    let mode = "1", timer = null, beepIv = null, state = "idle", colorIdx = 0;

    $$("#fingerMode button").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      $$("#fingerMode button").forEach((x) => x.classList.toggle("on", x === b));
      mode = b.dataset.n; reset();
    }));
    $("#fingerMode").addEventListener("pointerdown", (e) => e.stopPropagation());
    $('[data-screen="finger"] .back').addEventListener("pointerdown", (e) => e.stopPropagation());

    function place(f, e) { f.el.style.left = e.clientX + "px"; f.el.style.top = e.clientY + "px"; }

    area.addEventListener("pointerdown", (e) => {
      if (state === "done") return;
      e.preventDefault();
      const c = COLORS[colorIdx++ % COLORS.length];
      const el = document.createElement("div");
      el.className = "finger"; el.style.setProperty("--c", c);
      area.appendChild(el);
      const f = { el, c, x: e.clientX, y: e.clientY };
      fingers.set(e.pointerId, f); place(f, e);
      area.classList.add("has-touch");
      beep(300 + fingers.size * 90, .06, "sine", .1); buzz(15);
      arm();
    });
    area.addEventListener("pointermove", (e) => {
      const f = fingers.get(e.pointerId); if (!f) return;
      f.x = e.clientX; f.y = e.clientY; place(f, e);
    });
    const up = (e) => {
      const f = fingers.get(e.pointerId); if (!f) return;
      fingers.delete(e.pointerId);
      if (state === "done") {
        if (!fingers.size) setTimeout(reset, 900);
        return;
      }
      f.el.remove();
      if (!fingers.size) area.classList.remove("has-touch");
      arm();
    };
    ["pointerup", "pointercancel", "pointerleave"].forEach((t) => area.addEventListener(t, up));
    area.addEventListener("contextmenu", (e) => e.preventDefault());

    function needed() { return mode === "teams" ? 2 : Math.max(2, +mode + 1); }
    function arm() {
      clearTimeout(timer); clearInterval(beepIv);
      fingers.forEach((f) => f.el.classList.remove("armed"));
      if (fingers.size < needed()) return;
      state = "arming";
      timer = setTimeout(() => {
        fingers.forEach((f) => f.el.classList.add("armed"));
        let n = 0;
        beepIv = setInterval(() => { beep(600 + n * 120, .05); n++; }, 250);
        timer = setTimeout(() => { clearInterval(beepIv); pick(); }, 1000);
      }, 1200);
    }
    function pick() {
      state = "done";
      const list = shuffle([...fingers.values()]);
      buzz([60, 40, 120]); fanfare();
      if (mode === "teams") {
        const teamColors = ["#ff6a1a", "#5aa9ff"]; // vuur tegen het blauwe vlammetje
        list.forEach((f, i) => {
          const t = i % 2;
          f.el.style.setProperty("--c", teamColors[t]);
          f.el.classList.add("win");
          const l = document.createElement("span"); l.className = "label"; l.textContent = "Team " + (t ? "B" : "A");
          f.el.appendChild(l);
        });
        confetti(teamColors, 120);
        return;
      }
      const n = Math.min(+mode, list.length - 1);
      const winners = list.slice(0, n);
      list.slice(n).forEach((f) => f.el.classList.add("lose"));
      winners.forEach((f, i) => {
        f.el.classList.add("win");
        if (n > 1) { const l = document.createElement("span"); l.className = "label"; l.textContent = "#" + (i + 1); f.el.appendChild(l); }
      });
      const w = winners[0];
      flood.style.background = w.c;
      flood.style.left = w.x + "px"; flood.style.top = w.y + "px";
      flood.classList.add("go");
      requestAnimationFrame(() => (flood.style.transform = `scale(${Math.hypot(innerWidth, innerHeight) / 8})`));
      confetti([w.c, "#fff3d6"], 140);
    }
    function reset() {
      clearTimeout(timer); clearInterval(beepIv);
      state = "idle";
      fingers.clear();
      $$(".finger", area).forEach((el) => el.remove());
      flood.classList.remove("go"); flood.style.transform = "scale(0)";
      area.classList.remove("has-touch");
    }
    hooks.finger = reset;
  })();

  // =========================================================
  // RAD VAN FORTUIN
  // =========================================================
  (() => {
    const canvas = $("#wheel"), ctx = canvas.getContext("2d");
    const pointer = $(".pointer"), result = $("#wheelResult"), spinBtn = $("#spinBtn");
    let rot = 0, spinning = false;
    const editor = listEditor($("#wheelEditor"), "wheel", ["Loek", "Jacques"],
      "Naam of optie (komma's mag)", () => draw());
    // Radkleuren: gloed, vlam, hout, blauw… afwisselend licht/donker zodat buren verschillen
    const WHEEL = ["#ff6a1a", "#ffc247", "#e8401c", "#ffe7b8", "#8a5a36", "#ff9a3c", "#5aa9ff", "#ffd98a", "#c0391a", "#c98f5a"];
    const wheelColor = (i, n) => WHEEL[(n % WHEEL.length === 1 && i === n - 1) ? 1 : i % WHEEL.length];

    function size() {
      const dpr = devicePixelRatio || 1, w = canvas.clientWidth || 360;
      canvas.width = canvas.height = Math.round(w * dpr);
      draw();
    }
    function draw() {
      const items = editor.get(), n = Math.max(items.length, 1);
      const W = canvas.width, R = W / 2, arc = (Math.PI * 2) / n;
      ctx.clearRect(0, 0, W, W);
      ctx.save(); ctx.translate(R, R);
      // rand: gesmeed, donker metaal met een gloeiende ring
      const rim = ctx.createRadialGradient(0, 0, R * .9, 0, 0, R);
      rim.addColorStop(0, "#3a2416"); rim.addColorStop(.55, "#1d120a"); rim.addColorStop(1, "#0b0705");
      ctx.beginPath(); ctx.arc(0, 0, R - 2, 0, Math.PI * 2); ctx.fillStyle = rim; ctx.fill();
      ctx.beginPath(); ctx.arc(0, 0, R * .955, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,194,71,.55)"; ctx.lineWidth = R * .012; ctx.stroke();
      for (let i = 0; i < n; i++) {
        const a0 = rot + i * arc;
        const c = items.length ? wheelColor(i, n) : "#2a1a10";
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R * .94, a0, a0 + arc); ctx.closePath();
        ctx.fillStyle = c; ctx.fill();
        ctx.strokeStyle = "rgba(11,7,5,.45)"; ctx.lineWidth = R * .008; ctx.stroke();
        if (!items.length) continue;
        ctx.save(); ctx.rotate(a0 + arc / 2);
        ctx.fillStyle = isLight(c) ? INK : "#fff3d6"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
        const fs = Math.min(R * .1, (R * .9 * arc) * .5);
        ctx.font = `900 ${fs}px ui-rounded, system-ui, sans-serif`;
        let label = items[i];
        while (ctx.measureText(label).width > R * .6 && label.length > 2) label = label.slice(0, -2) + "…";
        ctx.fillText(label, R * .86, 0);
        ctx.restore();
      }
      // warme glans over het rad
      const sheen = ctx.createRadialGradient(-R * .3, -R * .35, 0, 0, 0, R);
      sheen.addColorStop(0, "rgba(255,243,214,.28)"); sheen.addColorStop(.5, "rgba(255,243,214,0)"); sheen.addColorStop(1, "rgba(11,7,5,.35)");
      ctx.beginPath(); ctx.arc(0, 0, R * .94, 0, Math.PI * 2); ctx.fillStyle = sheen; ctx.fill();
      // pinnetjes: messing
      for (let i = 0; i < n; i++) {
        const a = rot + i * arc;
        ctx.beginPath(); ctx.arc(Math.cos(a) * R * .97, Math.sin(a) * R * .97, R * .018, 0, Math.PI * 2);
        ctx.fillStyle = "#ffc247"; ctx.fill();
      }
      ctx.restore();
    }
    function indexAt(r) {
      const n = editor.get().length, arc = (Math.PI * 2) / n;
      let a = (-Math.PI / 2 - r) % (Math.PI * 2); if (a < 0) a += Math.PI * 2;
      return Math.floor(a / arc) % n;
    }
    function spin() {
      const items = editor.get();
      if (spinning) return;
      if (items.length < 2) { toast("Voeg minstens 2 opties toe"); return; }
      spinning = true; result.textContent = "…"; result.classList.remove("pop");
      const start = rot, total = Math.PI * 2 * (5 + Math.random() * 3) + Math.random() * Math.PI * 2;
      const dur = 4200 + Math.random() * 1200, t0 = performance.now();
      let last = indexAt(rot);
      const ease = (t) => 1 - Math.pow(1 - t, 4);
      (function frame(now) {
        const t = Math.min((now - t0) / dur, 1);
        rot = start + total * ease(t);
        draw();
        const idx = indexAt(rot);
        if (idx !== last) {
          last = idx; beep(1200, .02, "square", .05); buzz(4);
          pointer.classList.remove("tick"); void pointer.offsetWidth; pointer.classList.add("tick");
        }
        if (t < 1) return requestAnimationFrame(frame);
        rot %= Math.PI * 2;
        spinning = false;
        const win = items[idx];
        result.textContent = "🎉 " + win; void result.offsetWidth; result.classList.add("pop");
        fanfare(); buzz([40, 30, 80]); confetti([wheelColor(idx, items.length), "#fff3d6", "#ffc247"]);
      })(t0);
    }
    spinBtn.onclick = spin;
    // Swipen op het rad werkt ook
    let sy = null;
    canvas.addEventListener("pointerdown", (e) => (sy = [e.clientX, e.clientY]));
    canvas.addEventListener("pointerup", (e) => {
      if (sy && Math.hypot(e.clientX - sy[0], e.clientY - sy[1]) > 40) spin();
      sy = null;
    });

    // Eigen presets (data-vuur.js) eerst, dan de klassieke
    const presets = Object.assign({}, window.VUUR_WHEEL_PRESETS || {}, window.WHEEL_PRESETS || {}), names = Object.keys(presets);
    let pi = 0;
    $("#wheelPresetBtn").onclick = () => {
      const name = names[pi++ % names.length];
      editor.set(presets[name]); toast(name); result.innerHTML = "&nbsp;";
    };

    addEventListener("resize", size);
    hooks.wheel = () => requestAnimationFrame(size);
  })();

  // =========================================================
  // KAARTSPEL
  // =========================================================
  (() => {
    // Decks: eerst de eigen "bij het vuur"-decks (data-vuur.js), dan de klassieke, in vuurkleuren
    const DECK_THEME = {
      waarschijnlijk: ["#ffc247", "#ff6a1a"], nooit: ["#5aa9ff", "#2f5fa8"], doedurf: ["#e8401c", "#ff6a1a"], liever: ["#c98f5a", "#8a5a36"],
    };
    const decks = [...(window.VUUR_DECKS || []), ...(window.DECKS || [])].map((d) => {
      const t = DECK_THEME[d.id];
      return t ? Object.assign({}, d, { c: t[0], c2: t[1] }) : d;
    });
    const picker = $("#deckPicker"), card = $("#card"), kicker = $("#cardKicker"), text = $("#cardText"), counter = $("#cardCounter");
    let deck = decks.find((d) => d.id === store.get("deck")) || decks[0];
    let pile = [], seen = 0;
    const pencil = document.createElement("button");
    pencil.className = "card-pencil hidden"; pencil.textContent = "✏️"; pencil.setAttribute("aria-label", "Namen aanpassen");
    card.appendChild(pencil);

    decks.forEach((d) => {
      const b = document.createElement("button");
      b.textContent = d.name; b.style.setProperty("--c", d.c); b.style.setProperty("--ink", isLight(d.c) ? INK : "#fff3d6");
      b.onclick = () => { deck = d; store.set("deck", d.id); start(); beep(600, .04); };
      picker.appendChild(b);
    });

    function start() {
      $$("button", picker).forEach((b, i) => b.classList.toggle("on", decks[i] === deck));
      card.style.setProperty("--c", deck.c); card.style.setProperty("--c2", deck.c2);
      card.style.setProperty("--ink", isLight(deck.c) || isLight(deck.c2) ? INK : "#fff3d6");
      pencil.classList.toggle("hidden", !deck.duo);
      pile = deck.tod ? [] : shuffle(deck.items); seen = 0;
      next(true);
    }
    // "Loek of Jacques?": de twee namen (dva:duo), aanpasbaar via het potlood
    const duoNames = () => { const d = store.get("duo", ["Loek", "Jacques"]); return Array.isArray(d) && d.length === 2 ? d : ["Loek", "Jacques"]; };
    function duoButtons() {
      const row = document.createElement("div"); row.className = "duo";
      duoNames().forEach((name) => {
        const b = document.createElement("button"); b.textContent = name;
        b.onclick = (e) => {
          e.stopPropagation();
          $$("button", row).forEach((x) => x.classList.remove("cheer")); void b.offsetWidth; b.classList.add("cheer");
          fanfare(); buzz([30, 30, 60]); confetti([deck.c, deck.c2, "#ffc247", "#fff3d6"], 110);
          setTimeout(() => b.classList.remove("cheer"), 950);
        };
        row.appendChild(b);
      });
      return row;
    }
    function duoEditor(row) {
      const f = document.createElement("form"); f.className = "duo-edit";
      const [a, b] = duoNames().map((v) => { const i = document.createElement("input"); i.maxLength = 16; i.value = v; i.enterKeyHint = "done"; return i; });
      const ok = document.createElement("button"); ok.textContent = "Klaar ✓";
      f.append(a, b, ok);
      f.onsubmit = (e) => {
        e.preventDefault();
        store.set("duo", [a.value.trim() || "Loek", b.value.trim() || "Jacques"]);
        f.replaceWith(duoButtons()); beep(740, .05); toast("Namen opgeslagen");
      };
      row.replaceWith(f); a.focus(); a.select();
    }
    pencil.onclick = (e) => {
      e.stopPropagation();
      const row = $(".duo", text); if (row) duoEditor(row); else { const f = $(".duo-edit", text); f && f.requestSubmit(); }
    };
    function next(first) {
      card.classList.remove("fly", "snap", "enter");
      card.style.transform = ""; card.style.opacity = "";
      if (deck.duo) {
        if (!pile.length) { pile = shuffle(deck.items); if (!first) toast("Deck geschud! 🔀"); seen = 0; }
        kicker.textContent = deck.kicker;
        text.textContent = "";
        const wrap = document.createElement("div"); wrap.style.width = "100%";
        const q = document.createElement("div"); q.textContent = pile.pop();
        wrap.append(q, duoButtons()); text.appendChild(wrap);
        seen++; counter.textContent = `${seen} / ${deck.items.length}`;
      } else if (deck.tod) {
        kicker.textContent = deck.kicker;
        text.innerHTML = `<div style="width:100%"><div>Kies maar…</div><div class="tod"><button data-t="truths">Durf 🗣️</button><button data-t="dares">Doe 💪</button></div></div>`;
        $$(".tod button", text).forEach((b) => (b.onclick = (e) => {
          e.stopPropagation();
          const list = deck[b.dataset.t];
          kicker.textContent = b.dataset.t === "truths" ? "Durf — vertel de waarheid" : "Doe — opdracht!";
          text.textContent = list[rand(list.length)];
          seen++; counter.textContent = seen + " gespeeld"; buzz(10); beep(880, .05);
        }));
        counter.textContent = seen + " gespeeld";
      } else {
        if (!pile.length) { pile = shuffle(deck.items); if (!first) toast("Deck geschud! 🔀"); seen = 0; }
        kicker.textContent = deck.kicker;
        text.textContent = pile.pop();
        seen++; counter.textContent = `${seen} / ${deck.items.length}`;
      }
      void card.offsetWidth; card.classList.add("enter");
    }

    // swipen / tikken
    let sx = 0, sy = 0, dx = 0, drag = false, moved = false;
    card.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button, input, form")) return;
      drag = true; moved = false; sx = e.clientX; sy = e.clientY; dx = 0;
      card.classList.remove("snap", "enter"); card.setPointerCapture(e.pointerId);
    });
    card.addEventListener("pointermove", (e) => {
      if (!drag) return;
      dx = e.clientX - sx;
      if (Math.abs(dx) > 6 || Math.abs(e.clientY - sy) > 6) moved = true;
      card.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
    });
    const end = () => {
      if (!drag) return; drag = false;
      if (!moved || Math.abs(dx) > 90) {
        const dir = dx < 0 ? -1 : 1;
        card.classList.add("fly");
        card.style.transform = `translateX(${dir * innerWidth * 1.2}px) rotate(${dir * 25}deg)`;
        card.style.opacity = "0";
        beep(400, .05, "sine"); buzz(8);
        setTimeout(() => next(), 260);
      } else {
        card.classList.add("snap"); card.style.transform = "";
      }
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);

    start();
  })();

  // =========================================================
  // TEAMS
  // =========================================================
  (() => {
    const out = $("#teamsOut"), countEl = $("#teamCount");
    let count = store.get("teamCount", 2);
    const NAMES = ["Team Vuur 🔥", "Team Hout 🪵", "Team Vonk ✨", "Team Uil 🦉", "Team Wolf 🐺", "Team Bijl 🪓", "Team Vos 🦊", "Team Maan 🌙"];
    // Teamkleuren: vuur, blauw vlammetje, heet rood, hout, vlam, as, oranje, nacht
    const TEAM_GRADS = [["#ff6a1a", "#ffc247"], ["#5aa9ff", "#2f5fa8"], ["#e8401c", "#ff6a1a"], ["#c98f5a", "#8a5a36"], ["#ffc247", "#ffe7b8"], ["#b8a99a", "#ffe7b8"], ["#ff9a3c", "#e8401c"], ["#3a2416", "#8a5a36"]];
    const editor = listEditor($("#teamsEditor"), "players", ["Loek", "Jacques", "Sanne", "Jeroen", "Fleur", "Mo"],
      "Spelers toevoegen (komma's mag)");
    const render = () => { countEl.textContent = count; store.set("teamCount", count); };
    $("#teamMinus").onclick = () => { count = Math.max(2, count - 1); render(); };
    $("#teamPlus").onclick = () => { count = Math.min(8, count + 1); render(); };
    $("#makeTeams").onclick = () => {
      const players = shuffle(editor.get());
      if (players.length < count) { toast(`Je hebt minstens ${count} spelers nodig`); return; }
      const names = shuffle(NAMES).slice(0, count);
      const teams = names.map(() => []);
      players.forEach((p, i) => teams[i % count].push(p));
      out.innerHTML = "";
      teams.forEach((t, i) => {
        const el = document.createElement("div");
        const g = TEAM_GRADS[i % TEAM_GRADS.length];
        el.className = "team" + (isLight(g[0]) || isLight(g[1]) ? "" : " is-light");
        el.style.setProperty("--c", g[0]);
        el.style.setProperty("--c2", g[1]);
        el.style.animationDelay = i * 0.12 + "s";
        el.innerHTML = `<h3></h3><ul></ul>`;
        el.firstChild.textContent = names[i];
        t.forEach((p) => { const li = document.createElement("li"); li.textContent = p; el.lastChild.appendChild(li); });
        out.appendChild(el);
      });
      fanfare(); buzz([30, 30, 60]); confetti();
      setTimeout(() => out.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    };
    render();
  })();

  // =========================================================
  // DOBBELSTENEN
  // =========================================================
  (() => {
    const board = $("#diceBoard"), total = $("#diceTotal"), countEl = $("#diceCount");
    const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
    let count = store.get("diceCount", 2), rolling = false;

    function build() {
      countEl.textContent = count; store.set("diceCount", count);
      board.innerHTML = "";
      for (let i = 0; i < count; i++) {
        const d = document.createElement("div"); d.className = "die";
        d.innerHTML = "<i></i>".repeat(9); board.appendChild(d); face(d, 6);
      }
      total.textContent = "Tik om te gooien";
    }
    function face(d, v) { [...d.children].forEach((p, i) => (p.style.visibility = PIPS[v].includes(i) ? "visible" : "hidden")); }
    function roll() {
      if (rolling) return; rolling = true;
      const dice = $$(".die", board);
      let ticks = 0;
      dice.forEach((d) => { d.classList.remove("roll"); void d.offsetWidth; d.classList.add("roll"); });
      const iv = setInterval(() => {
        dice.forEach((d) => face(d, 1 + rand(6))); beep(200 + rand(200), .03, "triangle", .06);
        if (++ticks > 8) {
          clearInterval(iv);
          const vals = dice.map((d) => { const v = 1 + rand(6); face(d, v); return v; });
          const sum = vals.reduce((a, b) => a + b, 0);
          const allSame = vals.length > 1 && vals.every((v) => v === vals[0]);
          total.textContent = allSame ? `🔥 DUBBEL ${vals[0]}! Totaal ${sum}` : `Totaal: ${sum}`;
          buzz(allSame ? [50, 40, 50, 40, 120] : 30);
          if (allSame) { fanfare(); confetti(); }
          rolling = false;
        }
      }, 60);
    }
    board.onclick = roll;
    total.onclick = roll;
    $("#diceMinus").onclick = () => { count = Math.max(1, count - 1); build(); };
    $("#dicePlus").onclick = () => { count = Math.min(6, count + 1); build(); };

    // schudden
    let last = 0, shakeOn = false;
    function onMotion(e) {
      const a = e.accelerationIncludingGravity; if (!a) return;
      const f = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
      if (f > 25 && Date.now() - last > 900 && screens.dice.classList.contains("active")) { last = Date.now(); roll(); }
    }
    $("#shakeBtn").onclick = async () => {
      if (shakeOn) return;
      try {
        if (typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission) {
          if ((await DeviceMotionEvent.requestPermission()) !== "granted") throw 0;
        }
        addEventListener("devicemotion", onMotion);
        shakeOn = true; $("#shakeBtn").textContent = "📳 Schudden staat aan"; toast("Schud je telefoon!");
      } catch { toast("Schudden wordt niet ondersteund"); }
    };
    build();
  })();

  // ---------- Home: begroeting, het vuur en de vonkjes ----------
  function greeting() {
    const h = new Date().getHours();
    if (h >= 1 && h < 5) return "Nachtbrakers… 🦉";
    if (h < 12) return "Goeiemorgen, mannen ☕";
    if (h < 18) return "Goeiemiddag, mannen";
    return "Goeienavond, mannen";
  }
  const greetEl = $("#greet");
  hooks.home = () => { if (greetEl) greetEl.textContent = greeting(); };
  hooks.home();
  let heroFire = null;
  if (window.DVFire) {
    try {
      const bg = $("#embers"); if (bg) DVFire.embers(bg, { density: 0.3 });
      const hf = $("#heroFire"); if (hf) heroFire = DVFire.flame(hf, { intensity: 0.72, embers: true, blueTips: true, logs: true });
    } catch (e) { console.error(e); }
  }
  // Even oplaaien als je op de grote knop tikt
  $(".tile.t-online") && $(".tile.t-online").addEventListener("pointerdown", () => heroFire && heroFire.burst());

  // ---------- PWA: installeren / "Zet op je beginscherm" ----------
  let deferred;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(navigator.userAgent);
  const standalone = () => matchMedia("(display-mode: standalone)").matches || !!navigator.standalone;
  const sheet = $("#installSheet");
  function openSheet() {
    sheet.hidden = false;
    $("#installIll").hidden = !isIOS;
    $("#installGo").hidden = !deferred;
    $("#installText").textContent = isIOS
      ? "Open deze pagina in Safari, tik onderin op Deel en kies 'Zet op beginscherm'. Daarna opent hij als een echte app."
      : deferred
        ? "Eén tik en hij staat tussen je apps: beeldvullend, zonder adresbalk, ook zonder internet."
        : "Tik rechtsboven op ⋮ en kies 'App installeren' of 'Toevoegen aan startscherm'. Daarna opent hij als een echte app.";
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add("open")));
  }
  function closeSheet() {
    sheet.classList.remove("open"); store.set("installHint", true);
    setTimeout(() => { sheet.hidden = true; }, 500);
  }
  $$("#installSheet [data-close]").forEach((b) => (b.onclick = closeSheet));
  async function install() {
    if (!deferred) return;
    deferred.prompt(); const r = await deferred.userChoice; deferred = null;
    $("#installBtn").classList.add("hidden"); $("#installGo").hidden = true;
    if (r && r.outcome === "accepted") { toast("Geïnstalleerd 🔥"); closeSheet(); }
  }
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferred = e;
    $("#installBtn").classList.remove("hidden"); if (!sheet.hidden) $("#installGo").hidden = false;
  });
  $("#installBtn").onclick = install;
  $("#installGo").onclick = install;
  addEventListener("appinstalled", () => { deferred = null; $("#installBtn").classList.add("hidden"); closeSheet(); });
  // Eén keer, na 3 s, alleen op een telefoon die 'm nog niet op het beginscherm heeft (dva:iosHint = oude tip)
  const quiet = /[?&](preview|test)\b/.test(location.search);
  if ((isIOS || isAndroid) && !standalone() && !quiet && !store.get("installHint") && !store.get("iosHint")) {
    setTimeout(() => { if (!standalone() && screens.home.classList.contains("active")) openSheet(); }, 3000);
  }
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // Gedeelde helpers voor de online-modules (online/ui.js).
  window.DVA = { $, $$, COLORS, rand, shuffle, store, beep, fanfare, buzz, toast, confetti, show, hooks, screens };

  // Pas tonen als alle scripts (ook online/*) geladen zijn en hun hooks hebben geregistreerd.
  addEventListener("DOMContentLoaded", () => show(location.hash.slice(1)));
})();
