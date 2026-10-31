/*! fire.js — DVFire: living wood fire + drifting sparks for "Bij het vuur" (Loek & Jacques). No deps.
 *
 *   const f = DVFire.flame(canvas, { intensity: .7, embers: true, blueTips: true, logs: true });
 *     intensity  0..1 — 0 = smouldering embers only, 1 = roaring (changes always animate smoothly)
 *     embers     sparks rising from the fire (default true)   blueTips  blue wood-gas flames on logs + coals (default true)
 *     logs       two charred logs (glowing alligator char) on the ember bed (default true)
 *   f.setIntensity(x)  smooth transition (fire meter: blokken / 10)     f.intensity  current target
 *   f.burst()          whoosh (~0.1 s attack, settles in ~2 s) + spark fountain (success!)   f.destroy()
 *
 *   const e = DVFire.embers(canvas, { density: .5 });   // ambient sparks for a full-screen background
 *   e.setDensity(x); e.destroy();
 *
 * Size the canvas with CSS (e.g. background: position:fixed; inset:0; width:100%; height:100%;
 * pointer-events:none). Output is transparent, made to sit on --soot #0b0705. devicePixelRatio (max 2)
 * via ResizeObserver, stepping down to 1.5/1 if the device can't keep ~45 fps; pauses while the tab is hidden
 * or the canvas is off-screen / display:none (IntersectionObserver); prefers-reduced-motion → one static frame.
 */
(() => {
  "use strict";
  const M = Math, R = M.random, TAU = M.PI * 2, F32 = (n) => new Float32Array(n);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const ss = (a, b, x) => ((x = clamp((x - a) / (b - a), 0, 1)), x * x * (3 - 2 * x));
  const P = F32(256).map(R);
  const vn = (x) => { const i = M.floor(x), f = x - i, a = P[i & 255]; return a + (P[(i + 1) & 255] - a) * f * f * (3 - 2 * f); }; // ruis 0..1
  const bell = () => (R() + R() + R()) / 1.5 - 1; // -1..1, meeste rond 0
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const stops = (g, s) => (s.split(" ").forEach((p) => g.addColorStop(...p.split("@"))), g); // "0@#fff .5@red …"
  const reset = (c, w, h) => { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, w, h); };
  const RM = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)");
  const still = () => !!(RM && RM.matches);

  // ---------- Sprites (één keer, gedeeld) ----------
  let SP;
  function sprites() {
    if (SP) return SP;
    const glow = (rgb, prof, hot) => {
      const c = mk(64, 64), x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      prof.split(" ").forEach((p, i) => { const [o, a] = p.split("@"); g.addColorStop(o, !i && hot ? "#fff7d7" : `rgba(${rgb},${a})`); });
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
    };
    // vlamtong: ronde voet → staart; tail = hoe snel hij versmalt, bend = kromming. Vorm zit in alpha,
    // kleur loopt van voet (a) naar punt (b): heet geel onderin, dieprood in de punten (kleurtemperatuur)
    const tongue = (a, b, tail, bend) => {
      const w = 48, h = 128, c = mk(w, h), x = c.getContext("2d"), im = x.createImageData(w, h), d = im.data;
      for (let py = 0; py < h; py++) {
        const v = 1 - (py + .5) / h, hw = .92 * (v < .25 ? M.sqrt(1 - ((.25 - v) / .25) ** 2) : ((1 - v) / .75) ** tail);
        const k = ss(0, .2, v) * (1 - v) ** .5, cc = bend * v * v, t = ss(.1, .95, v);
        for (let px = 0, i = py * w * 4; px < w; px++, i += 4) {
          for (let ch = 0; ch < 3; ch++) d[i + ch] = a[ch] + (b[ch] - a[ch]) * t;
          d[i + 3] = 255 * k * (1 - ss(.25, 1, M.abs((px + .5) / w * 2 - 1 - cc) / (hw + 1e-3)));
        }
      }
      x.putImageData(im, 0, 0); return c;
    };
    const G = "0@1 .22@.6 .5@.18 1@0";
    return (SP = {
      lick: tongue([255, 122, 30], [226, 52, 12], 1.9, .45), hot: tongue([255, 192, 104], [255, 116, 36], 1.5, .25),
      body: tongue([255, 84, 22], [196, 34, 8], 1.1, 0), blue: tongue([70, 140, 255], [110, 60, 240], .6, .3),
      core: glow("255,150,50", G), ember: glow("255,78,18", G),
      s: ["255,190,90", "255,122,30", "228,58,18"].map((c) => glow(c, "0@1 .18@.85 .5@.2 1@0", 1)),
    });
  }

  // ---------- Gedeelde lus: dpr, resize, zichtbaarheid, reduced motion ----------
  function runner(cv, o) {
    let raf = 0, last = 0, vis = true, dead = false, cap = 2, slow = 0, ro, io;
    const ok = () => !dead && vis && !document.hidden && o.ready();
    const tick = (ts) => {
      raf = 0;
      if (!ok() || still()) return;
      raf = requestAnimationFrame(tick); // eerst inplannen: dan start fit() → go() geen tweede lus
      const dt = last ? (ts - last) / 1e3 : 1 / 60; last = ts;
      // blijft het toestel onder ~45 fps hangen (losse haperingen tellen niet), dan stapsgewijs minder pixels
      if (dt < .1 && (slow = M.max(0, slow + (dt > .022 ? 1 : -.5))) > 40 && cap > 1) { cap -= .5; slow = 0; fit(); }
      o.step(M.min(.05, dt)); o.draw();
    };
    const go = () => { if (ok()) still() ? (o.warm(), o.draw()) : raf || ((last = 0), (raf = requestAnimationFrame(tick))); };
    const fit = () => {
      const d = M.min(window.devicePixelRatio || 1, cap), w = M.round(cv.clientWidth * d), h = M.round(cv.clientHeight * d);
      if (!w || !h) return;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      o.size(w, h, d); if (ok()) o.draw(); go();
    };
    const destroy = () => {
      dead = true; cancelAnimationFrame(raf);
      ro ? ro.disconnect() : removeEventListener("resize", fit); io && io.disconnect();
      document.removeEventListener("visibilitychange", go);
      RM && RM.removeEventListener && RM.removeEventListener("change", go);
      reset(cv.getContext("2d"), cv.width, cv.height); o.free && o.free();
      if (cv._dvfire === destroy) cv._dvfire = null;
    };
    cv._dvfire && cv._dvfire(); cv._dvfire = destroy; // één animatie per canvas
    if (window.ResizeObserver) (ro = new ResizeObserver(fit)).observe(cv); else addEventListener("resize", fit);
    if (window.IntersectionObserver) (io = new IntersectionObserver((es) => { vis = es[es.length - 1].isIntersecting; go(); })).observe(cv);
    document.addEventListener("visibilitychange", go);
    RM && RM.addEventListener && RM.addEventListener("change", go);
    fit();
    return { go, destroy };
  }

  // ---------- Vuur ----------
  function flame(cv, o = {}) {
    const sp = sprites(), ctx = cv.getContext("2d"), fb = mk(2, 2), fc = fb.getContext("2d"), bed = mk(2, 2), bc = bed.getContext("2d");
    const sparks = o.embers !== false, blue = o.blueTips !== false, logs = o.logs !== false;
    const NT = 34, tAge = F32(NT), tLife = F32(NT), tX = F32(NT), tH = F32(NT), tW = F32(NT), tPh = F32(NT), tHot = F32(NT); // vlamtongen
    const NS = 96, sX = F32(NS), sY = F32(NS), sVX = F32(NS), sVY = F32(NS), sL = F32(NS), sM = F32(NS), sR = F32(NS); // vonken
    const hot = F32(24), bl = F32(42); // gloeiende plekken in het bed; plekjes voor blauwe vlammetjes (x, y, fase)
    let W = 0, H = 0, S = 0, cx = 0, gy = 0, y0 = 0, q = 1, fbX = 0, fbY = 0, bedX = 0, bedY = 0, warmed = 0, ambG;
    let tgt = clamp(o.intensity == null ? .7 : +o.intensity || 0, 0, 1), cur = tgt, I = cur, flare = 0, kick = 0, pend = 0, time = 0, acc = 0;

    function respawn(j) {
      const x = bell(); tX[j] = x; tAge[j] = 0;
      tLife[j] = (.35 + .6 * R()) * (1.5 - .5 * M.min(I, 1));
      tHot[j] = M.abs(x) < .45 && R() < .45 ? 1 : 0;
      tH[j] = (.3 + .7 * R() ** 1.4) * (1 - .55 * x * x) * (tHot[j] ? .6 : 1); // weinig hoge, veel lage tongen
      tW[j] = (.7 + .6 * R()) * (R() < .5 ? -1 : 1); tPh[j] = R() * 99; // teken = gespiegeld (staart links/rechts)
    }
    function spark(boost) {
      for (let k = 0, i = M.min(I, 1); k < NS; k++) if (sL[k] <= 0) {
        sX[k] = cx + bell() * S * (.04 + .1 * i); sY[k] = y0 - R() * S * (.05 + .3 * i);
        sVX[k] = bell() * S * (.1 + .7 * boost); sVY[k] = -S * (.3 + .5 * R() + 1.4 * boost * R());
        sM[k] = sL[k] = .5 + 1.3 * R(); sR[k] = S * (.005 + .007 * R());
        return;
      }
    }
    function step(dt) {
      time += dt;
      cur += (tgt - cur) * (1 - M.exp(-dt * 1.6));
      flare += (kick - flare) * (1 - M.exp(-dt * 16)); kick *= M.exp(-dt * 1.1); // opflakkeren: snelle aanzet (~0,1 s), dan rustig uitdoven
      I = cur + flare * .7;
      for (let k = M.min(pend, M.ceil(dt * 240)); k > 0; k--, pend--) spark(1); // vonkenfontein over ~0,25 s
      for (let j = 0, n = M.round(4 + 26 * M.min(I, 1.15)); j < NT; j++) {
        if (tLife[j] > 0) { if ((tAge[j] += dt) >= tLife[j]) j < n ? respawn(j) : (tLife[j] = 0); }
        else if (j < n) { respawn(j); if (!warmed) tAge[j] = R() * tLife[j] * .6; } // nieuwe tongen groeien rustig aan
      }
      if (sparks) for (acc += dt * (.6 + 9 * I * I); acc > 1; acc--) spark(0);
      for (let k = 0; k < NS; k++) if (sL[k] > 0) {
        sL[k] -= dt;
        sVX[k] = (sVX[k] + (vn(time * 2.3 + k * 7.7) - .5) * S * 2.2 * dt) * (1 - 1.5 * dt);
        sVY[k] = (sVY[k] - S * .3 * dt) * (1 - .5 * dt);
        sX[k] += sVX[k] * dt; sY[k] += sVY[k] * dt;
      }
    }
    function warm() { if (!warmed && S) { for (let k = 0; k < 60; k++) step(1 / 30); warmed = 1; } }

    function size(w, h) {
      W = w; H = h; S = M.min(W * 1.05, H / 1.1); cx = W / 2; gy = H - S * .06; y0 = gy - S * .06;
      const bw = S * 1.1, top = M.max(0, y0 - S * 1.02);
      q = M.min(.5, 240 / bw); fb.width = M.ceil(bw * q); fb.height = M.ceil((y0 + S * .02 - top) * q); fbX = cx - bw / 2; fbY = top;
      ambG = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      for (let i = 0; i <= 20; i++) { const r = i / 20; ambG.addColorStop(r, `rgba(255,128,40,${(M.exp(-6 * r * r) * (1 - r * r) ** 2).toFixed(4)})`); }
      buildBed(); sL.fill(0); warm();
    }

    function buildBed() { // gloeiend kolenbed + verkoolde blokken, één keer per formaat
      let seed = 7, nb = 0;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647; // zelfde vorm na elke resize
      const c = bc, bw = M.ceil(S * .9), bh = M.ceil(S * .3), ox = bw / 2, oy = bh - S * .05;
      bed.width = bw; bed.height = bh; bedX = cx - ox; bedY = gy - oy;
      // hittekleur 0 (koud, as) → 1 (geeloranje kern), zoals echte houtskool
      const HC = [[26, 15, 11], [74, 18, 6], [176, 44, 10], [240, 92, 26], [255, 178, 90]];
      const heat = (h, k = 1) => {
        const t = clamp(h, 0, 1) * 4, i = M.min(3, t | 0), f = t - i, A = HC[i], B = HC[i + 1];
        return `rgb(${(A[0] + (B[0] - A[0]) * f) * k | 0},${(A[1] + (B[1] - A[1]) * f) * k | 0},${(A[2] + (B[2] - A[2]) * f) * k | 0})`;
      };
      c.save(); c.translate(ox, oy - S * .025); c.scale(1, .2); // gloed onder alles: wordt zichtbaar in de naden
      c.fillStyle = stops(c.createRadialGradient(0, 0, 0, 0, 0, S * .38), "0@#ff9a3a .3@#e8521a .65@#7a1e06 1@rgba(50,12,4,0)");
      c.fillRect(-S * .4, -S * .4, S * .8, S * .8); c.restore();
      const co = [];
      for (let k = 0; k < 130; k++) {
        const u = rnd() * 2 - 1, y = rnd();
        co.push([ox + u * S * .3, oy - y * (1 - u * u) ** .5 * S * .07, S * (.014 + .017 * rnd()) * (1 - .35 * u * u), (1 - M.abs(u)) ** 1.2 * (.4 + .6 * y) * (.65 + .75 * rnd())]);
      }
      co.sort((a, b) => a[1] - b[1]);
      const coal = ([x, y, r, h]) => { // brok houtskool: gloeit van binnen, donkere korst/naad rondom, koude brokken grijs van de as
        c.save(); c.translate(x, y); c.scale(1, .7); c.beginPath();
        for (let i = 0, a0 = rnd() * TAU; i < 7; i++) { const a = a0 + i / 7 * TAU, rr = r * (.72 + .4 * rnd()); c.lineTo(M.cos(a) * rr, M.sin(a) * rr); }
        c.closePath();
        c.fillStyle = stops(c.createRadialGradient(r * .1, r * .15, 0, 0, 0, r * 1.15), `0@${heat(h + .12)} .6@${heat(h * .8)} 1@${heat(h * .35, .7)}`);
        c.fill(); c.lineWidth = r * .1; c.strokeStyle = "rgba(30,8,3,.55)"; c.stroke();
        if (h < .2) { c.fillStyle = `rgba(112,94,82,${(.2 - h) * .5})`; c.fill(); } // as
        c.restore();
      };
      // verkoold blok: krokodillenhuid van houtskoolblokjes, de naden ertussen gloeien (heter richting het vuur en aan de onderkant)
      const log = (x, y, dir, ang, L, T) => {
        const at = () => { c.save(); c.translate(x, y); c.scale(dir, 1); c.rotate(ang); };
        const row = (r) => -M.cos(r * M.PI / 4) * T / 2; // rijen dichter bij elkaar aan de randen: het blok is rond
        const top = [];
        at(); c.beginPath(); c.moveTo(0, T / 2);
        for (let i = 0; i <= 10; i++) { const yy = -T / 2 + T * .07 * (rnd() - .5); top.push(yy); c.lineTo(L * i / 10, yy); }
        c.ellipse(L, 0, T * .3, T / 2, 0, -M.PI / 2, M.PI / 2); c.closePath();
        const seam = c.createLinearGradient(0, 0, L + T * .3, 0);
        c.fillStyle = stops(seam, `0@#1a0704 .4@#220803 .54@#5a1806 .66@#d8521a .72@#f07022 .84@#8a2a0a 1@#2e0a03`); c.fill(); c.clip();
        for (let r = 0; r < 4; r++) { // bolle, onregelmatige houtskoolblokjes (krokodillenhuid); de naden ertussen gloeien in het vuur
          const y1 = row(r), y2 = row(r + 1), hh = y2 - y1, lit = r < 2, p = [];
          for (let u = -rnd() * hh; u < L + T * .3;) {
            const len = hh * (.7 + 1.3 * rnd() ** 1.5), w = (u + len / 2) / L, h = (ss(.3, .66, w) * (1 - .5 * ss(.75, 1, w)) + .25 * (r === 3) * (1 - w)) * (.4 + .6 * rnd()), g = T * .028;
            const a = u + g, b2 = u + len - g, t = y1 + g + (r ? (rnd() - .5) * hh * .5 : 0), bt = y2 - g + (r < 3 ? (rnd() - .5) * hh * .5 : 0), j = () => (rnd() - .5) * T * .07;
            p.length = 0; p.push(a + j(), t + j(), (a + b2) / 2 + j(), t + j() * .5, b2 + j(), t + j(), b2 + j(), bt + j(), (a + b2) / 2 + j(), bt + j() * .5, a + j(), bt + j());
            c.beginPath(); c.moveTo((p[10] + p[0]) / 2, (p[11] + p[1]) / 2);
            for (let i = 0; i < 12; i += 2) { const n = (i + 2) % 12; c.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[n]) / 2, (p[i + 1] + p[n + 1]) / 2); }
            const k = .7 + .5 * rnd(), lo = lit ? [40, 26, 18] : [22, 14, 10], hc = [120, 30, 9];
            const col = (q, f) => `rgb(${(q[0] + (hc[0] - q[0]) * h) * f | 0},${(q[1] + (hc[1] - q[1]) * h) * f | 0},${(q[2] + (hc[2] - q[2]) * h) * f | 0})`;
            const mx = (a + b2) / 2 - len * .12, my = t + (bt - t) * .3;
            c.fillStyle = stops(c.createRadialGradient(mx, my, 0, mx, my, len * .75), `0@${col(lo, k)} 1@${col([10, 6, 4], k)}`);
            c.fill();
            if (lit && rnd() < .3) { c.fillStyle = "rgba(170,158,146,.1)"; c.fill(); } // witte as bovenop
            u += len;
          }
        }
        c.globalCompositeOperation = "lighter"; // het einde in het vuur gloeit door
        c.fillStyle = stops(c.createRadialGradient(L * .68, T * .2, 0, L * .68, T * .2, T * 1.6), "0@rgba(255,110,30,.45) .45@rgba(220,60,12,.16) 1@rgba(160,30,6,0)");
        c.fillRect(0, -T, L + T, T * 2); c.globalCompositeOperation = "source-over";
        // rondheid: bovenkant aangelicht door de vlammen, onderkant in de schaduw
        c.fillStyle = stops(c.createLinearGradient(0, -T / 2, 0, T / 2), "0@rgba(255,170,90,.22) .25@rgba(255,140,60,.05) .55@rgba(0,0,0,0) 1@rgba(0,0,0,.5)");
        c.fillRect(-T, -T, L + T * 2, T * 2);
        c.restore(); at(); c.scale(.3, 1); // gezaagde kop: licht hout met jaarringen en een verkoolde rand
        c.beginPath(); for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, rr = T / 2 * (.9 + .12 * rnd()); c.lineTo(M.cos(a) * rr, M.sin(a) * rr); } c.closePath();
        c.fillStyle = stops(c.createRadialGradient(-T * .08, -T * .1, 0, 0, 0, T / 2), "0@#7a5232 .5@#5a3a22 .82@#3a2414 1@#120905"); c.fill();
        c.lineWidth = T * .07; c.strokeStyle = "#140a05"; c.stroke(); c.lineWidth = T * .02; c.strokeStyle = "rgba(30,16,8,.45)";
        for (let i = 1; i < 4; i++) { c.beginPath(); c.arc(-T * .04, 0, T / 2 * i / 4.2, 0, TAU); c.stroke(); }
        c.restore();
        // plekken waar houtgas blauw opbrandt: op de bovenrand, aan de hete kant
        for (let i = 0; i < 4; i++) {
          const u = L * (.55 + .4 * i / 3 + .05 * rnd()), v = top[M.min(10, M.round(u / L * 10))], ca = M.cos(ang), sa = M.sin(ang);
          bl[nb++] = (bedX + x + dir * (u * ca - v * sa)) | 0; bl[nb++] = bedY + y + u * sa + v * ca; bl[nb++] = rnd() * 99;
        }
      };
      let k = 0;
      for (; k < co.length && co[k][1] < oy - S * .035; k++) coal(co[k]); // achterste kooltjes, dan blokken, dan de voorste
      if (logs) { log(ox - S * .32, oy - S * .006, 1, -.27, S * .5, S * .085); log(ox + S * .32, oy, -1, -.25, S * .49, S * .08); }
      for (; k < co.length; k++) coal(co[k]);
      while (nb < bl.length) { const u = bell(); bl[nb++] = cx + u * S * .2; bl[nb++] = gy - S * (.035 + .025 * rnd()) * (1 - u * u); bl[nb++] = rnd() * 99; }
      for (let i = 0; i < 24; i += 2) { hot[i] = cx + bell() * S * .26; hot[i + 1] = gy - S * (.01 + .06 * rnd()); }
    }

    function draw() {
      if (!S) return;
      const c = ctx, f = fc, fw = fb.width, fh = fb.height, Ic = M.min(I, 1.25), frozen = still(), pres = .3 + .7 * ss(0, .25, Ic);
      const fl = .8 + .4 * vn(time * 6.1) * vn(time * 2.3 + 40), FH = S * M.min(.98, .1 + .85 * Ic), hw = S * (.06 + .19 * Ic), tw = S * (.1 + .13 * Ic);
      reset(c, W, H); c.globalCompositeOperation = "lighter";
      const gcy = y0 - FH * .35, rx = M.min(W / 2, S * 1.2), ry = M.min(gcy, H - gcy, S);
      // warm licht rondom: echte gradient (geen opgeschaalde sprite → geen trapjes/ringen in het donker)
      c.globalAlpha = M.min(1, (.2 + .42 * Ic + .3 * flare) * fl); c.setTransform(rx, 0, 0, ry, cx, gcy); c.fillStyle = ambG; c.fillRect(-1, -1, 2, 2);
      c.setTransform(1, 0, 0, 1, 0, 0);
      // vlammen in een buffer op lage resolutie: rood omhulsel + gele kern, dan losse tongen (additief → wit-geel hart)
      reset(f, fw, fh); f.globalCompositeOperation = "lighter";
      for (let e = 0; e < 3; e++) {
        const h = FH * (e ? .62 - .2 * (e - 1) : .45) * (.85 + .3 * vn(time * 3.7 + e * 17)), w = hw * (e ? 2.5 - .6 * (e - 1) : 1.5);
        f.globalAlpha = pres * (e ? .32 : .5) * fl;
        f.setTransform(w * q / 48, 0, (vn(time * 1.4 + e * 9) - .5) * .25 * h * q / 128, h * q / 128, (cx - fbX) * q, (y0 - fbY) * q);
        f.drawImage(e ? sp.body : sp.hot, -24, -128);
      }
      for (let j = 0; j < NT; j++) {
        if (tLife[j] <= 0) continue;
        const a = tAge[j] / tLife[j], gr = ss(0, .2, a), de = ss(.5, 1, a), al = pres * gr * (1 - de) * (tHot[j] ? .55 : .72);
        if (al < .01 || (frozen && de > .05)) continue; // stilstaand beeld: geen losgeslagen slierten
        const h = FH * tH[j] * (.78 + .44 * vn(time * 5 + tPh[j])) * (.5 + .5 * gr) * (1 - .4 * de), sy = h * q / 128; // de = loslaten
        const lean = (vn(time * 2.6 + tPh[j] * 3) - .5) * .7 - tX[j] * .3;
        f.globalAlpha = al;
        f.setTransform(tw * tW[j] * (.6 + .4 * gr) * (1 - .3 * de) * q / 48, 0, -lean * sy, sy, (cx + tX[j] * hw - fbX) * q, (y0 - de * de * h * .9 - fbY) * q);
        f.drawImage(tHot[j] ? sp.hot : sp.lick, -24, -128);
      }
      // buffer → canvas in schuine stroken die golvend meebewegen: likkende S-bochten (zacht uitlopend tegen de bovenrand)
      for (let k = 31, sh = fh / 32, iq = 1 / q, ob = 0; k >= 0; k--) {
        const yT = fbY + k * sh * iq, hN = M.max(0, (y0 - yT) / S);
        if (y0 - yT - sh * iq > FH * 1.35) break; // hierboven komt geen vlam
        const ot = S * .07 * hN ** 1.3 * (.6 + .4 * Ic) * ((vn(hN * 3.1 - time * 2.8) - .5) * 2 + (vn(hN * 8 - time * 5.3 + 50) - .5) * .9);
        c.globalAlpha = M.min(1, yT / (S * .15));
        c.setTransform(iq, 0, (ob - ot) / sh, iq, fbX + ot, yT);
        c.drawImage(fb, 0, k * sh, fw, sh, 0, 0, fw, sh);
        ob = ot;
      }
      // kolenbed + blokken, ademende gloed, vuurschijn
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.drawImage(bed, bedX, bedY);
      c.globalCompositeOperation = "lighter";
      for (let k = 0, r = S * .065; k < 24; k += 2) {
        c.globalAlpha = (.1 + .5 * vn(time * .7 + k * 5.3) ** 2) * (1.3 - .5 * Ic);
        c.drawImage(sp.ember, hot[k] - r, hot[k + 1] - r * .5, r * 2, r);
      }
      c.globalAlpha = M.min(1, (.06 + .24 * Ic + .4 * flare) * fl); c.drawImage(sp.core, cx - S * .3, y0 - S * .09, S * .6, S * .15);
      if (blue) for (let k = 0; k < bl.length; k += 3) { // blauwe vlammetjes: houtgas dat op de blokken en kolen opbrandt
        const ph = bl[k + 2], al = ss(.48, .78, vn(time * .8 + ph)) * (.35 + .4 * vn(time * 7 + ph)) * (1.05 - .3 * Ic);
        if (al < .02) continue;
        const h = S * (.022 + .036 * vn(time * 4.3 + ph * 2)) * (.75 + .45 * Ic), w = S * (.034 + .014 * vn(ph)) * (ph > 50 ? -1 : 1);
        c.globalAlpha = al; c.setTransform(w / 48, 0, (vn(time * 2.7 + ph) - .5) * 1.4 * h / 128, h / 128, bl[k], bl[k + 1]);
        c.drawImage(sp.blue, -24, -128);
      }
      for (let k = 0; k < NS; k++) { // vonken, uitgerekt langs hun snelheid
        if (sL[k] <= 0) continue;
        const f2 = sL[k] / sM[k], r = sR[k] * (.5 + .5 * f2), vx = sVX[k], vy = sVY[k], v = M.sqrt(vx * vx + vy * vy) + 1e-3;
        const len = M.max(r * 2, M.min(v * .035, r * 8)), ux = vx / v, uy = vy / v;
        c.globalAlpha = M.min(1, f2 * 2.5, sY[k] / (S * .15)) * (.6 + .4 * vn(time * 9 + k));
        if (c.globalAlpha < .01) continue;
        c.setTransform(ux * len / 64, uy * len / 64, -uy * r / 32, ux * r / 32, sX[k], sY[k]);
        c.drawImage(sp.s[f2 > .66 ? 0 : f2 > .33 ? 1 : 2], -32, -32);
      }
    }

    const run = runner(cv, { size, step, draw, warm, ready: () => S > 0, free: () => { fb.width = fb.height = bed.width = bed.height = 0; } });
    return {
      setIntensity(x) { tgt = clamp(+x || 0, 0, 1); if (still()) { cur = tgt; for (let k = 0; k < 30; k++) step(1 / 30); } run.go(); },
      burst() { if (still()) return; kick = M.min(1.3, kick + 1); pend = 60; for (let k = 0; k < 24; k++) spark(1); run.go(); },
      destroy: run.destroy,
      get intensity() { return tgt; },
    };
  }

  // ---------- Vonkjes op de achtergrond ----------
  function embers(cv, o = {}) {
    const sp = sprites(), ctx = cv.getContext("2d"), N = 64;
    const x = F32(N), y = F32(N), vx = F32(N), vy = F32(N), z = F32(N), ph = F32(N), life = F32(N), max = F32(N), col = F32(N);
    const dirty = F32(N * 3); // vorige tekenplek per vonkje: alleen die stukjes wissen, niet het hele scherm
    let W = 0, H = 0, d = 1, n = 0, time = 0, full = 1, dens = clamp(o.density == null ? .5 : +o.density || 0, 0, 1);
    const count = () => { n = M.min(N, M.round((6 + 34 * dens) * clamp(W * H / (d * d * 330000), .4, 2.2))); };
    function spawn(k, any) {
      z[k] = R() ** 1.6; x[k] = R() * W; y[k] = any ? R() * H : H + R() * 40 * d; // z: diepte (groot = dichtbij, wazig)
      vx[k] = 0; vy[k] = -(10 + 32 * z[k] + 12 * R()) * d;
      ph[k] = R() * 99; max[k] = life[k] = 4 + 8 * R(); col[k] = R() * 3 | 0;
      if (any) life[k] *= R();
    }
    function size(w, h, dpr) { // bij een resize (bv. iOS-werkbalk) schalen we mee i.p.v. alles opnieuw te strooien
      const first = !W, rx = w / W, ry = h / H, rd = dpr / d;
      W = w; H = h; d = dpr; full = 1; count();
      for (let k = 0; k < N; k++) first ? spawn(k, 1) : ((x[k] *= rx), (y[k] *= ry), (vx[k] *= rd), (vy[k] *= rd));
    }
    function step(dt) {
      time += dt;
      for (let k = 0; k < n; k++) {
        if ((life[k] -= dt) <= 0 || y[k] < -20 * d) { spawn(k, R() < .5); continue; }
        vx[k] += ((vn(time * .5 + ph[k]) - .5) * 60 * d - vx[k] * .8) * dt;
        x[k] += (vx[k] + M.sin(time * (1 + z[k]) + ph[k]) * 8 * d) * dt; y[k] += vy[k] * dt;
      }
    }
    function draw() {
      const c = ctx;
      if (full) reset(c, W, H), (full = 0);
      else for (let k = 0; k < N * 3; k += 3) if (dirty[k + 2]) {
        const r = dirty[k + 2] + 3;
        c.clearRect(M.floor(dirty[k] - r), M.floor(dirty[k + 1] - r), (r * 2 + 2) | 0, (r * 2 + 2) | 0); dirty[k + 2] = 0;
      }
      c.globalCompositeOperation = "lighter";
      for (let k = 0; k < n; k++) {
        const f = life[k] / max[k], zz = z[k], r = (2.8 + 8 * zz * zz) * d;
        c.globalAlpha = ss(0, .25, f) * ss(1, .85, f) * (.45 + .55 * vn(time * 3 + ph[k])) * (1 - .45 * zz) * (.6 + .4 * y[k] / H);
        c.drawImage(zz > .7 ? sp.core : sp.s[col[k]], x[k] - r, y[k] - r, r * 2, r * 2);
        dirty[k * 3] = x[k]; dirty[k * 3 + 1] = y[k]; dirty[k * 3 + 2] = r;
      }
    }
    const run = runner(cv, { size, step, draw, warm() {}, ready: () => W > 0 });
    return { setDensity(v) { dens = clamp(+v || 0, 0, 1); count(); run.go(); }, destroy: run.destroy };
  }

  window.DVFire = { flame, embers };
})();
