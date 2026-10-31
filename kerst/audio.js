/*! kerst/audio.js — KerstAudio: alle geluiden van KERSTDROOM, puur WebAudio (geen bestanden). Geen deps.
 * UMD-light: browser global `window.KerstAudio` + CommonJS `module.exports`. Geen DOM/AudioContext bij het laden;
 * alles ontstaat in init() (eerste tik, autoplay-beleid). Gooit nooit: zonder AudioContext doet alles stil niets.
 *
 *   KerstAudio.init()            maak/hervat de AudioContext (aanroepen bij het eerste gebruikersgebaar; vaker mag)
 *   KerstAudio.play(name)        jump doubleJump land star bell candy gift powerup hurt revive whoosh twinkle wish fanfare
 *                                tick countdown   ("star" stijgt in toonhoogte bij snelle combo's, pentatonisch)
 *   KerstAudio.setMusic(theme)   "nacht" | "aurora" | "peperkoek" | "off" — loopende 8-maats lo-fi kerstmelodie (eigen
 *                                compositie, majeur, speeldoos-timbre, sleebel-shaker, zachte bas) met zachte variaties
 *   KerstAudio.duck(ms)          muziek even zachter (events, pauze)
 *   KerstAudio.setMuted(bool) / KerstAudio.muted     bewaard in localStorage "kerst:muted"
 *   KerstAudio.melodyNote(i)     belletjes-combo: speelt zinnetje i (mod 5) van "Jingle Bells" (publiek domein, 1857)
 *   KerstAudio.ready → bool      is er een werkende AudioContext?      KerstAudio.theme → huidige muziek ("off" = stil)
 *   KerstAudio.destroy()         stop alles (tests)
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KerstAudio = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const G = root || {};
  const LS_KEY = "kerst:muted";
  const safe = (fn, dflt) => { try { return fn(); } catch (e) { return dflt; } };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- liedjes (eigen compositie; noten als "E5:4" = E5, 4 zestienden; r = rust) ----------
  const NOTE_OFF = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function parseMelody(bars) { // → array[128] met { m, len } op de startstap van elke noot
    const out = new Array(128).fill(null);
    bars.forEach((bar, b) => {
      let pos = 0;
      for (const tok of bar.trim().split(/\s+/)) {
        const [nm, lenS] = tok.split(":"); const len = +lenS || 1;
        if (nm !== "r") {
          const mt = /^([A-G])([#b]?)(\d)$/.exec(nm);
          if (mt) out[b * 16 + pos] = { m: 12 * (+mt[3] + 1) + NOTE_OFF[mt[1]] + (mt[2] === "#" ? 1 : mt[2] === "b" ? -1 : 0), len };
        }
        pos += len;
      }
    });
    return out;
  }
  const ch = (r, n) => ({ r, n }); // r = grondtoon (midi), n = voicing
  const SONGS = {
    nacht: { // "Droombos-wiegelied" — C majeur, dromerig
      bpm: 80, kick: false, pad: false, bright: 0,
      melody: parseMelody(["E5:4 G5:2 E5:2 D5:4 C5:4", "D5:4 E5:4 D5:6 r:2", "E5:4 G5:2 A5:2 G5:4 E5:4", "D5:6 C5:2 D5:8",
        "E5:4 G5:2 E5:2 D5:4 C5:4", "A4:4 C5:4 D5:6 r:2", "E5:2 D5:2 C5:4 D5:4 E5:4", "C5:8 r:8"]),
      chords: [[ch(48, [60, 64, 67])], [ch(45, [57, 60, 64])], [ch(41, [57, 60, 65])], [ch(43, [59, 62, 67])],
        [ch(48, [60, 64, 67])], [ch(45, [57, 60, 64])], [ch(50, [57, 62, 65]), ch(43, [59, 62, 67])], [ch(48, [60, 64, 67])]],
    },
    aurora: { // "Noorderlicht-slaapliedje" — G majeur, zwevend met pad
      bpm: 70, kick: false, pad: true, bright: -1,
      melody: parseMelody(["B5:6 A5:2 G5:8", "D5:4 E5:4 G5:8", "A5:6 B5:2 A5:4 G5:4", "E5:4 D5:4 r:8",
        "B5:6 A5:2 G5:4 E5:4", "D5:4 E5:4 G5:4 A5:4", "B5:4 A5:4 G5:4 E5:4", "D5:8 G5:8"]),
      chords: [[ch(43, [55, 59, 62])], [ch(40, [52, 55, 59])], [ch(48, [55, 60, 64])], [ch(50, [57, 62, 66])],
        [ch(43, [55, 59, 62])], [ch(40, [52, 55, 59])], [ch(48, [55, 60, 64]), ch(50, [57, 62, 66])], [ch(43, [55, 59, 62])]],
    },
    peperkoek: { // "Peperkoek-polka" — F majeur, huppelend met kick
      bpm: 100, kick: true, pad: false, bright: 1,
      melody: parseMelody(["F5:2 F5:2 A5:2 F5:2 C6:4 A5:4", "G5:2 G5:2 Bb5:2 G5:2 C6:4 r:4", "A5:2 A5:2 C6:2 A5:2 F5:2 G5:2 A5:4", "G5:2 F5:2 E5:2 F5:2 G5:4 r:4",
        "F5:2 F5:2 A5:2 F5:2 C6:4 A5:4", "Bb5:2 Bb5:2 D6:2 Bb5:2 C6:4 A5:4", "G5:2 A5:2 Bb5:2 C6:2 D6:4 C6:4", "A5:2 G5:2 F5:8 r:4"]),
      chords: [[ch(41, [53, 57, 60])], [ch(48, [55, 60, 64])], [ch(41, [53, 57, 60])], [ch(48, [55, 60, 64])],
        [ch(41, [53, 57, 60])], [ch(46, [53, 58, 62])], [ch(43, [55, 58, 62]), ch(48, [55, 60, 64])], [ch(41, [53, 57, 60])]],
    },
  };
  const THEMES = Object.keys(SONGS);
  // "Jingle Bells" (J. L. Pierpont, 1857 — publiek domein): vijf zinnetjes, één per gevangen belletje
  const JINGLE = [[64, 64, 64], [64, 64, 64], [64, 67, 60, 62, 64], [65, 65, 65, 65, 65, 64, 64, 64], [64, 62, 62, 64, 62, 67]];
  // C-majeur pentatonisch vanaf C5 voor de ster-chimes
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33];

  // ---------- staat ----------
  let ctx = null, master = null, musicBus = null, duckBus = null, sfxBus = null, noiseBuf = null, unavailable = false;
  let muted = !!safe(() => G.localStorage && G.localStorage.getItem(LS_KEY) === "1", false);
  let theme = "off", pendingTheme = null, song = null, timer = null, nextStep = 0, nextTime = 0, loopNo = 0, loopRng = mulberry32(1), varia = {};
  let starCombo = 0, lastStarAt = -1e9, duckUntil = 0, visHooked = false;
  const LOOKAHEAD = 0.25, TICK_MS = 60;

  function now() { return ctx ? ctx.currentTime : 0; }

  function init() {
    return safe(() => {
      if (unavailable) return false;
      if (!ctx) {
        const AC = G.AudioContext || G.webkitAudioContext;
        if (!AC) { unavailable = true; return false; }
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
        const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2;
        master.connect(comp); comp.connect(ctx.destination);
        duckBus = ctx.createGain(); duckBus.connect(master);
        musicBus = ctx.createGain(); musicBus.gain.value = 0.6; musicBus.connect(duckBus);
        sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0); let s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 2147483648) - 1; }
        hookVisibility();
      }
      if (ctx.state === "suspended" && typeof ctx.resume === "function") safe(() => { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); });
      if (pendingTheme) { const t = pendingTheme; pendingTheme = null; setMusic(t); }
      else if (theme !== "off" && !timer) startScheduler();
      return true;
    }, false);
  }
  function hookVisibility() {
    if (visHooked || !G.document || !G.document.addEventListener) return;
    visHooked = true;
    G.document.addEventListener("visibilitychange", () => safe(() => {
      if (!ctx) return;
      if (G.document.hidden) { if (ctx.state === "running") ctx.suspend(); }
      else if (ctx.state === "suspended" && !muted) { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
    }));
  }

  // ---------- synth-bouwstenen ----------
  function env(g, at, peak, a, d, floor) { // exponentiële enveloppe (klikvrij)
    const f = floor || 0.0004;
    g.gain.cancelScheduledValues(at); g.gain.setValueAtTime(f, at);
    g.gain.exponentialRampToValueAtTime(Math.max(f, peak), at + Math.max(0.002, a));
    g.gain.exponentialRampToValueAtTime(f, at + Math.max(0.002, a) + Math.max(0.01, d));
  }
  // toon: type, f → f1 (glide), a/d enveloppe, piek g, naar dest
  function tone(o) {
    const at = o.at != null ? o.at : now() + 0.005;
    const osc = ctx.createOscillator(); osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, at);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, at + (o.glide || (o.a || 0.01) + (o.d || 0.2)));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain(); env(g, at, o.g || 0.2, o.a || 0.005, o.d || 0.25);
    let node = osc;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lp; f.Q.value = 0.7; osc.connect(f); node = f; }
    node.connect(g); g.connect(o.dest || sfxBus);
    osc.start(at); osc.stop(at + (o.a || 0.005) + (o.d || 0.25) + 0.05);
  }
  // speeldoos: grondtoon + octaaf + een licht ontstemde hoge partial die snel wegsterft
  function musicBox(f, at, vel, dest, dec, bright) {
    const d = dec || 1.1, b = bright || 0;
    tone({ type: "sine", f, at, a: 0.004, d, g: vel, dest });
    tone({ type: "sine", f: f * 2, at, a: 0.003, d: d * 0.6, g: vel * (0.3 + b * 0.1), dest });
    tone({ type: "sine", f: f * 3.98, at, a: 0.002, d: d * (b > 0 ? 0.35 : 0.22), g: vel * (b > 0 ? 0.2 : 0.11), dest });
    if (b < 0) tone({ type: "triangle", f: f / 2, at, a: 0.02, d: d * 1.3, g: vel * 0.18, dest, lp: 1200 });
  }
  // belletje: inharmonische partials
  function bell(f, at, vel, dest) {
    const P = [[1, 1, 1.4], [2.0, 0.55, 0.9], [3.01, 0.33, 0.6], [4.2, 0.2, 0.35], [5.4, 0.1, 0.25]];
    for (const [r, g, d] of P) tone({ type: "sine", f: f * r, at, a: 0.002, d: d, g: vel * g, dest });
  }
  function noise(o) { // ruisje door een filter
    const at = o.at != null ? o.at : now() + 0.005;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = o.rate || 1;
    const f = ctx.createBiquadFilter(); f.type = o.type || "bandpass"; f.frequency.setValueAtTime(o.f || 2000, at); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, at + (o.a || 0.005) + (o.d || 0.1)); f.Q.value = o.q || 1;
    const g = ctx.createGain(); env(g, at, o.g || 0.2, o.a || 0.003, o.d || 0.1);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxBus);
    src.start(at); src.stop(at + (o.a || 0.003) + (o.d || 0.1) + 0.05);
  }
  function thump(at, f0, f1, d, g, dest) { tone({ type: "sine", f: f0, f1, at, a: 0.004, d, g, glide: d, dest: dest || sfxBus }); }

  // ---------- geluidseffecten ----------
  const SFX = {
    jump(at) { noise({ at, f: 900, f1: 2600, q: 0.8, a: 0.01, d: 0.12, g: 0.12 }); tone({ f: 520, f1: 880, at, a: 0.01, d: 0.12, g: 0.16, glide: 0.1 }); },
    doubleJump(at) { noise({ at, f: 1200, f1: 3200, q: 0.8, a: 0.01, d: 0.14, g: 0.1 }); tone({ f: 660, f1: 990, at, a: 0.01, d: 0.1, g: 0.14, glide: 0.08 }); tone({ f: 880, f1: 1320, at: at + 0.07, a: 0.01, d: 0.12, g: 0.14, glide: 0.08 }); },
    land(at) { thump(at, 120, 42, 0.16, 0.55); noise({ at, type: "lowpass", f: 700, a: 0.002, d: 0.05, g: 0.12 }); },
    star(at) {
      const t = now(); starCombo = t - lastStarAt < 1.3 ? starCombo + 1 : 0; lastStarAt = t;
      const f = midiHz(72 + PENTA[Math.min(starCombo, PENTA.length - 1)]);
      musicBox(f, at, 0.26, sfxBus, 0.7, 1);
      tone({ f: f * 4, at: at + 0.01, a: 0.003, d: 0.08, g: 0.03 });
    },
    bell(at) { bell(1318.5, at, 0.22, sfxBus); },
    candy(at) { noise({ at, f: 1800, q: 2, a: 0.002, d: 0.04, g: 0.25 }); tone({ f: 900, f1: 1500, at: at + 0.01, a: 0.005, d: 0.09, g: 0.12, glide: 0.07, type: "triangle" }); },
    gift(at) { [72, 76, 79, 84].forEach((m, i) => musicBox(midiHz(m), at + i * 0.07, 0.2, sfxBus, 0.6, 1)); noise({ at: at + 0.05, f: 6000, q: 1, a: 0.01, d: 0.25, g: 0.05 }); },
    powerup(at) {
      [72, 76, 79, 83, 86].forEach((m, i) => { const t = at + i * 0.08; tone({ type: "triangle", f: midiHz(m), at: t, a: 0.01, d: 0.22, g: 0.14, lp: 3200 }); tone({ f: midiHz(m + 12), at: t, a: 0.01, d: 0.18, g: 0.05 }); });
      [84, 88, 91].forEach((m) => tone({ f: midiHz(m), at: at + 0.42, a: 0.02, d: 0.6, g: 0.07 }));
    },
    hurt(at) { tone({ type: "triangle", f: 330, f1: 170, at, a: 0.01, d: 0.35, g: 0.22, glide: 0.3, lp: 1500 }); thump(at + 0.02, 90, 50, 0.2, 0.3); tone({ f: 660, f1: 330, at: at + 0.05, a: 0.01, d: 0.25, g: 0.06, glide: 0.2 }); },
    revive(at) { [60, 64, 67, 72].forEach((m, i) => tone({ type: "triangle", f: midiHz(m), at: at + i * 0.03, a: 0.12, d: 0.7, g: 0.12, lp: 1800 })); [79, 84, 88].forEach((m, i) => musicBox(midiHz(m), at + 0.3 + i * 0.1, 0.16, sfxBus, 0.9, 0)); },
    whoosh(at) { noise({ at, f: 400, f1: 3000, q: 0.9, a: 0.04, d: 0.28, g: 0.3 }); },
    twinkle(at) { [96, 93, 91, 88, 86, 84].forEach((m, i) => musicBox(midiHz(m), at + i * 0.05, 0.13, sfxBus, 0.5, 1)); },
    wish(at) {
      [84, 88, 91, 96].forEach((m, i) => { const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = midiHz(m); const lfo = ctx.createOscillator(); lfo.frequency.value = 6; const lg = ctx.createGain(); lg.gain.value = 9; lfo.connect(lg); lg.connect(o.detune); const g = ctx.createGain(); env(g, at + i * 0.04, 0.09, 0.05, 0.9); o.connect(g); g.connect(sfxBus); o.start(at); lfo.start(at); o.stop(at + 1.1); lfo.stop(at + 1.1); });
      tone({ f: 600, f1: 2400, at, a: 0.02, d: 0.4, g: 0.08, glide: 0.4 }); noise({ at: at + 0.1, f: 7000, q: 1.5, a: 0.05, d: 0.5, g: 0.05 });
    },
    fanfare(at) {
      const seq = [[67, 0, 0.14], [72, 0.13, 0.14], [76, 0.26, 0.14], [79, 0.39, 0.18], [84, 0.62, 0.7]];
      for (const [m, dt, d] of seq) { const t = at + dt; tone({ type: "sawtooth", f: midiHz(m), at: t, a: 0.015, d, g: 0.12, lp: 1800 }); tone({ type: "square", f: midiHz(m - 12), at: t, a: 0.015, d, g: 0.05, lp: 900 }); tone({ f: midiHz(m + 12), at: t, a: 0.01, d: d * 0.8, g: 0.04 }); }
      thump(at + 0.62, 140, 50, 0.3, 0.5); [76, 79].forEach((m) => tone({ type: "sawtooth", f: midiHz(m), at: at + 0.62, a: 0.02, d: 0.7, g: 0.07, lp: 1600 }));
    },
    tick(at) { tone({ f: 880, at, a: 0.003, d: 0.06, g: 0.14 }); noise({ at, f: 3000, q: 3, a: 0.002, d: 0.03, g: 0.08 }); },
    countdown(at) { tone({ f: midiHz(84), at, a: 0.005, d: 0.12, g: 0.16 }); tone({ f: midiHz(91), at: at + 0.1, a: 0.005, d: 0.35, g: 0.16 }); [79, 84, 88].forEach((m) => musicBox(midiHz(m), at + 0.1, 0.1, sfxBus, 0.6, 1)); },
  };
  function play(name) {
    safe(() => {
      if (!ctx || muted || !SFX[name]) return;
      if (ctx.state !== "running") return;
      SFX[name](now() + 0.005);
    });
  }
  function melodyNote(i) {
    safe(() => {
      if (!ctx || muted || ctx.state !== "running") return;
      const phrase = JINGLE[((i | 0) % JINGLE.length + JINGLE.length) % JINGLE.length];
      const at = now() + 0.005, gap = phrase.length > 3 ? 0.17 : 0.2;
      phrase.forEach((m, k) => bell(midiHz(m + 12), at + k * gap, 0.2, sfxBus));
      duck(phrase.length * gap * 1000 + 300);
    });
  }

  // ---------- muziek ----------
  function setMusic(th) {
    safe(() => {
      th = th === "off" ? "off" : SONGS[th] ? th : "nacht";
      if (!ctx) { pendingTheme = th; theme = th; return; }
      if (th === theme && (timer || th === "off")) return;
      const t = now();
      if (th === "off") { theme = "off"; song = null; stopScheduler(); musicBus.gain.cancelScheduledValues(t); musicBus.gain.setValueAtTime(musicBus.gain.value, t); musicBus.gain.linearRampToValueAtTime(0.0001, t + 0.6); return; }
      theme = th; song = SONGS[th];
      const wasOn = !!timer;
      stopScheduler();
      musicBus.gain.cancelScheduledValues(t);
      musicBus.gain.setValueAtTime(Math.max(0.0001, musicBus.gain.value), t);
      const start = wasOn ? 0.7 : 0.05;
      if (wasOn) musicBus.gain.linearRampToValueAtTime(0.0001, t + 0.55);
      musicBus.gain.setValueAtTime(0.0001, t + start); musicBus.gain.linearRampToValueAtTime(0.6, t + start + 0.8);
      loopNo = 0; nextStep = 0; nextTime = t + start; newLoop();
      startScheduler();
    });
  }
  function startScheduler() { if (timer || !song) return; timer = setInterval(() => safe(schedule), TICK_MS); }
  function stopScheduler() { if (timer) { clearInterval(timer); timer = null; } }
  function newLoop() {
    loopRng = mulberry32(loopNo * 7919 + THEMES.indexOf(theme) * 31 + 17);
    // zachte variaties per rondje: octaafje omhoog in maat 5–6, echo-nootjes, een loopje in maat 8, af en toe rust in de bas
    varia = { oct: loopNo > 0 && loopRng() < 0.35, echo: loopRng() < 0.5, fill: loopNo > 0 && loopRng() < 0.6, restBass: loopRng() < 0.25, swing: 0.004 + loopRng() * 0.008 };
  }
  function schedule() {
    if (!ctx || !song) return;
    const t = now();
    const stepDur = 60 / song.bpm / 4;
    if (nextTime < t - 0.5) nextTime = t + 0.05; // na een pauze (tab weg) niet inhalen
    while (nextTime < t + LOOKAHEAD) {
      playStep(nextStep, nextTime, stepDur);
      nextStep = (nextStep + 1) % 128;
      if (nextStep === 0) { loopNo++; newLoop(); }
      nextTime += stepDur;
    }
  }
  function playStep(s, at, stepDur) {
    const bar = s >> 4, pos = s & 15, d = musicBus, br = song.bright;
    const chords = song.chords[bar], chord = chords.length > 1 && pos >= 8 ? chords[1] : chords[0];
    const hum = (loopRng() - 0.5) * varia.swing;
    // melodie (speeldoos)
    const note = song.melody[s];
    if (note) {
      let m = note.m; if (varia.oct && (bar === 4 || bar === 5)) m += 12;
      const dec = Math.min(2.2, 0.5 + note.len * stepDur * 1.3);
      musicBox(midiHz(m), at + hum, 0.22, d, dec, br);
      if (varia.echo && note.len >= 4) musicBox(midiHz(m + (br > 0 ? 12 : 0)), at + stepDur * 2, 0.07, d, dec * 0.7, br);
    } else if (varia.fill && bar === 7 && pos >= 8 && pos % 2 === 0) { // loopje over het akkoord in de laatste maat
      const n = chord.n[((pos - 8) / 2) % chord.n.length] + 12; musicBox(midiHz(n), at + hum, 0.1, d, 0.6, br);
    }
    // akkoord: zacht getokkeld op 1 en 3 (aurora: pad)
    if (pos === 0 || pos === 8) {
      if (song.pad) chord.n.forEach((n, i) => tone({ type: "triangle", f: midiHz(n), detune: i % 2 ? 5 : -5, at, a: 0.35, d: stepDur * 8, g: 0.045, lp: 900, dest: d }));
      else chord.n.forEach((n, i) => musicBox(midiHz(n), at + i * 0.035, 0.07, d, 1.2, br));
    }
    // bas
    if ((pos === 0 || pos === 8) && !(varia.restBass && pos === 8 && bar % 2)) tone({ type: "triangle", f: midiHz(chord.r), at, a: 0.01, d: stepDur * 5, g: 0.16, lp: 500, dest: d });
    if (song.kick && (pos === 4 || pos === 12)) tone({ type: "triangle", f: midiHz(chord.r + 7), at, a: 0.01, d: stepDur * 3, g: 0.1, lp: 500, dest: d });
    // sleebel-shaker: op elke achtste, accent op de na-slag; peperkoek dubbel zo druk
    const shakerOn = song.kick ? true : pos % 2 === 0;
    if (shakerOn) {
      const acc = pos % 4 === 2 ? 1 : pos % 2 ? 0.45 : 0.7;
      noise({ at: at + hum, f: 5600, q: 1.2, a: 0.003, d: 0.07, g: 0.055 * acc, dest: d });
      noise({ at: at + hum + 0.004, f: 8200, q: 2, a: 0.002, d: 0.05, g: 0.03 * acc, dest: d });
    }
    // zachte kick / hartslag
    if (pos === 0 || (song.kick && pos === 8)) thump(at, 110, 48, 0.14, song.kick ? 0.32 : 0.14, d);
  }

  function duck(ms) {
    safe(() => {
      if (!ctx || !duckBus) return;
      const t = now(), hold = clamp((+ms || 600) / 1000, 0.1, 5);
      duckBus.gain.cancelScheduledValues(t);
      duckBus.gain.setValueAtTime(duckBus.gain.value, t);
      duckBus.gain.linearRampToValueAtTime(0.35, t + 0.06);
      duckBus.gain.setValueAtTime(0.35, t + hold);
      duckBus.gain.linearRampToValueAtTime(1, t + hold + 0.5);
      duckUntil = t + hold;
    });
  }
  function setMuted(b) {
    muted = !!b;
    safe(() => { if (G.localStorage) G.localStorage.setItem(LS_KEY, muted ? "1" : "0"); });
    safe(() => {
      if (!ctx || !master) return;
      const t = now();
      master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, t + 0.15);
      if (!muted && ctx.state === "suspended") { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
    });
  }
  function destroy() {
    safe(() => { stopScheduler(); song = null; theme = "off"; pendingTheme = null; if (ctx && typeof ctx.close === "function") ctx.close(); ctx = null; master = musicBus = duckBus = sfxBus = null; });
  }

  return {
    init, play, setMusic, duck, setMuted, melodyNote, destroy,
    get muted() { return muted; },
    get ready() { return !!ctx; },
    get theme() { return theme; },
    get state() { return ctx ? ctx.state : "none"; },
    get ducking() { return !!ctx && now() < duckUntil; },
    THEMES, SFX_NAMES: Object.keys(SFX), SONGS,
  };
});
