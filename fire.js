/*! fire.js — DVFire: living wood fire + drifting sparks for "Bij het vuur" (Loek & Jacques). No deps.
 *
 *   const f = DVFire.flame(canvas, { intensity: .7, embers: true, blueTips: true, logs: true });
 *     intensity 0..1  0 = smouldering embers only, 1 = roaring (changes always animate smoothly)
 *     embers          sparks rising out of the fire        (default true)
 *     blueTips        little blue flames on the coals      (default true)
 *     logs            two charred logs on the ember bed    (default true)
 *   f.setIntensity(x)  smooth transition, e.g. the fire meter (blokken / 10)
 *   f.burst()          one-off flare-up + spark shower (success!)
 *   f.destroy()
 *
 *   const e = DVFire.embers(canvas, { density: .5 });  // ambient sparks for a full-screen background
 *   e.setDensity(x); e.destroy();
 *
 * The canvas takes its size from CSS (background: position:fixed; inset:0; width:100%; height:100%;
 * pointer-events:none). Output is transparent, made to sit on --soot #0b0705. devicePixelRatio (max 2)
 * via ResizeObserver; pauses while the tab is hidden or the canvas is off-screen / display:none
 * (IntersectionObserver); prefers-reduced-motion → one static glowing frame.
 */
(() => {
  "use strict";
  const M = Math, R = M.random, TAU = M.PI * 2, F32 = (n) => new Float32Array(n);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const ss = (a, b, x) => ((x = clamp((x - a) / (b - a), 0, 1)), x * x * (3 - 2 * x));
  const P = F32(256).map(R);
  const vn = (x) => { const i = M.floor(x), f = x - i, a = P[i & 255]; return a + (P[(i + 1) & 255] - a) * f * f * (3 - 2 * f); };
  const bell = () => (R() + R() + R()) / 1.5 - 1; // -1..1, meeste rond 0
  const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const RM = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const still = () => !!(RM && RM.matches);

  // ---------- Sprites (één keer, gedeeld) ----------
  let SP;
  function sprites() {
    if (SP) return SP;
    const glow = (rgb, hot, soft) => {
      const c = mk(64, 64), x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, hot ? "rgba(255,247,215,1)" : `rgba(${rgb},1)`);
      if (soft) [[.15, .72], [.35, .36], [.6, .11], [.8, .03]].forEach(([p, a]) => g.addColorStop(p, `rgba(${rgb},${a})`));
      else g.addColorStop(hot ? .14 : .22, `rgba(${rgb},${hot ? .85 : .6})`), g.addColorStop(.5, `rgba(${rgb},.18)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
    };
    // vlamtong: ronde voet → (gebogen) staart; tail = hoe snel hij versmalt, bend = kromming van de staart
    const tongue = (r, g, b, tail, bend) => {
      const w = 48, h = 128, c = mk(w, h), x = c.getContext("2d"), im = x.createImageData(w, h), d = im.data;
      for (let py = 0; py < h; py++) {
        const v = 1 - (py + .5) / h, hw = .92 * (v < .25 ? M.sqrt(1 - ((.25 - v) / .25) ** 2) : ((1 - v) / .75) ** tail);
        const k = ss(0, .2, v) * (1 - v) ** .5, cc = bend * v * v;
        for (let px = 0; px < w; px++) {
          const i = (py * w + px) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b;
          d[i + 3] = 255 * k * (1 - ss(.25, 1, M.abs((px + .5) / w * 2 - 1 - cc) / (hw + 1e-3)));
        }
      }
      x.putImageData(im, 0, 0); return c;
    };
    return (SP = {
      lick: tongue(255, 104, 26, 1.9, .45), hot: tongue(255, 176, 84, 1.5, .25), body: tongue(255, 66, 18, 1.1, 0),
      blue: tongue(84, 118, 255, .8, 0),
      amb: glow("255,128,40", 0, 1), core: glow("255,150,50"), ember: glow("255,78,18"),
      s: [glow("255,190,90", 1), glow("255,122,30", 1), glow("228,58,18", 1)],
    });
  }

  // ---------- Gedeelde lus: dpr, resize, zichtbaarheid, reduced motion ----------
  function runner(cv, o) {
    let raf = 0, last = 0, vis = true, dead = false, ro, io;
    const ok = () => !dead && vis && !document.hidden && o.ready();
    const tick = (ts) => {
      raf = 0;
      if (!ok() || still()) return;
      o.step(last ? M.min(.05, (ts - last) / 1e3) : 1 / 60); last = ts; o.draw();
      raf = requestAnimationFrame(tick);
    };
    const go = () => {
      if (!ok()) return;
      if (still()) { o.warm(); o.draw(); } else if (!raf) { last = 0; raf = requestAnimationFrame(tick); }
    };
    const fit = () => {
      const d = M.min(window.devicePixelRatio || 1, 2), w = M.round(cv.clientWidth * d), h = M.round(cv.clientHeight * d);
      if (!w || !h) return;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      o.size(w, h, d); if (ok()) o.draw(); go();
    };
    if (window.ResizeObserver) (ro = new ResizeObserver(fit)).observe(cv); else addEventListener("resize", fit);
    if (window.IntersectionObserver) (io = new IntersectionObserver((es) => { vis = es[es.length - 1].isIntersecting; go(); })).observe(cv);
    document.addEventListener("visibilitychange", go);
    if (RM && RM.addEventListener) RM.addEventListener("change", go);
    fit();
    return {
      go,
      destroy() {
        dead = true; cancelAnimationFrame(raf);
        ro ? ro.disconnect() : removeEventListener("resize", fit); io && io.disconnect();
        document.removeEventListener("visibilitychange", go);
        if (RM && RM.removeEventListener) RM.removeEventListener("change", go);
        const c = cv.getContext("2d"); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
      },
    };
  }

  // ---------- Vuur ----------
  function flame(cv, o = {}) {
    const sp = sprites(), ctx = cv.getContext("2d"), fb = mk(2, 2), fc = fb.getContext("2d"), bed = mk(2, 2), bc = bed.getContext("2d");
    const sparks = o.embers !== false, blue = o.blueTips !== false, logs = o.logs !== false;
    const NT = 34, tAge = F32(NT), tLife = F32(NT), tX = F32(NT), tH = F32(NT), tW = F32(NT), tPh = F32(NT), tHot = new Uint8Array(NT);
    const NS = 96, sX = F32(NS), sY = F32(NS), sVX = F32(NS), sVY = F32(NS), sL = F32(NS), sM = F32(NS), sR = F32(NS), hot = F32(24);
    let W = 0, H = 0, S = 0, cx = 0, gy = 0, y0 = 0, q = 1, fbX = 0, fbY = 0, bedX = 0, bedY = 0;
    let tgt = clamp(o.intensity == null ? .7 : +o.intensity || 0, 0, 1), cur = tgt, I = cur, flare = 0, time = 0, acc = 0, warmed = false;

    function respawn(j) {
      const x = bell(); tX[j] = x; tAge[j] = 0;
      tLife[j] = (.35 + .6 * R()) * (1.5 - .5 * M.min(I, 1));
      tHot[j] = M.abs(x) < .45 && R() < .45 ? 1 : 0;
      tH[j] = (.3 + .7 * R() ** 1.4) * (1 - .55 * x * x) * (tHot[j] ? .6 : 1);
      tW[j] = (.7 + .6 * R()) * (R() < .5 ? -1 : 1); tPh[j] = R() * 99;
    }
    function spark(boost) {
      for (let k = 0; k < NS; k++) if (sL[k] <= 0) {
        const i = M.min(I, 1);
        sX[k] = cx + bell() * S * (.04 + .1 * i); sY[k] = y0 - R() * S * (.05 + .3 * i);
        sVX[k] = bell() * S * (.1 + .7 * boost); sVY[k] = -S * (.3 + .5 * R() + 1.4 * boost * R());
        sM[k] = sL[k] = .5 + 1.3 * R(); sR[k] = S * (.005 + .007 * R());
        return;
      }
    }
    function step(dt) {
      time += dt;
      cur += (tgt - cur) * (1 - M.exp(-dt * 1.6));
      flare *= M.exp(-dt * 1.5);
      I = cur + flare * .6;
      const n = M.round(4 + 26 * M.min(I, 1.15));
      for (let j = 0; j < NT; j++) {
        if (tLife[j] > 0) { if ((tAge[j] += dt) >= tLife[j]) j < n ? respawn(j) : (tLife[j] = 0); }
        else if (j < n) { respawn(j); tAge[j] = R() * tLife[j] * .6; }
      }
      if (sparks) for (acc += dt * (.6 + 9 * I * I); acc > 1; acc--) spark(0);
      for (let k = 0; k < NS; k++) if (sL[k] > 0) {
        sL[k] -= dt;
        sVX[k] = (sVX[k] + (vn(time * 2.3 + k * 7.7) - .5) * S * 2.2 * dt) * (1 - 1.5 * dt);
        sVY[k] = (sVY[k] - S * .3 * dt) * (1 - .5 * dt);
        sX[k] += sVX[k] * dt; sY[k] += sVY[k] * dt;
      }
    }
    function warm() { if (!warmed && S) { warmed = true; for (let k = 0; k < 60; k++) step(1 / 30); } }

    function size(w, h) {
      W = w; H = h; S = M.min(W * 1.05, H / 1.1); cx = W / 2; gy = H - S * .06; y0 = gy - S * .06;
      const bw = S * 1.1, top = M.max(0, y0 - S * 1.02);
      q = M.min(.5, 260 / bw); fb.width = M.ceil(bw * q); fb.height = M.ceil((y0 + S * .02 - top) * q); fbX = cx - bw / 2; fbY = top;
      buildBed(); sL.fill(0); warm();
    }

    function buildBed() { // gloeiend kolenbed + verkoolde blokken, één keer per formaat
      const c = bc, rnd = seeded(7), bw = M.ceil(S * .9), bh = M.ceil(S * .3), ox = bw / 2, oy = bh - S * .05;
      bed.width = bw; bed.height = bh; bedX = cx - ox; bedY = gy - oy;
      c.save(); c.translate(ox, oy - S * .025); c.scale(1, .2);
      let g = c.createRadialGradient(0, 0, 0, 0, 0, S * .36);
      g.addColorStop(0, "#ff9a3a"); g.addColorStop(.35, "#e8521a"); g.addColorStop(.7, "#6a1a06"); g.addColorStop(1, "rgba(50,12,4,0)");
      c.fillStyle = g; c.fillRect(-S * .4, -S * .4, S * .8, S * .8); c.restore();
      const co = [];
      for (let k = 0; k < 150; k++) {
        const u = rnd() * 2 - 1, y = rnd();
        co.push([ox + u * S * .29, oy - y * (1 - u * u) ** .5 * S * .07, S * (.013 + .016 * rnd()) * (1 - .35 * u * u), rnd() < .22 + .5 * (1 - M.abs(u)) * y]);
      }
      co.sort((a, b) => a[1] - b[1]);
      const coal = ([x, y, r, h]) => {
        c.save(); c.translate(x, y); c.scale(1, .72); c.beginPath();
        for (let i = 0, a0 = rnd() * TAU; i < 6; i++) { const a = a0 + i / 6 * TAU, rr = r * (.7 + .4 * rnd()); c.lineTo(M.cos(a) * rr, M.sin(a) * rr); }
        const gg = c.createRadialGradient(0, -r * .25, 0, 0, 0, r * 1.1);
        if (h) gg.addColorStop(0, "#ffc46a"), gg.addColorStop(.35, "#f2621c"), gg.addColorStop(.75, "#9a2408"), gg.addColorStop(1, "#2a0a04");
        else gg.addColorStop(0, "#3a2212"), gg.addColorStop(.6, "#160b06"), gg.addColorStop(1, "#070302");
        c.fillStyle = gg; c.fill(); c.restore();
      };
      // verkoold blok: donker, rond belicht, met een net van gloeiende scheurtjes dat heter wordt richting het vuur
      const log = (x, y, dir, ang, L, T) => {
        c.save(); c.translate(x, y); c.scale(dir, 1); c.rotate(ang);
        c.beginPath(); c.moveTo(0, T / 2);
        for (let i = 0; i <= 10; i++) c.lineTo(L * i / 10, -T / 2 + T * .06 * (rnd() - .5));
        c.ellipse(L, 0, T * .25, T / 2, 0, -M.PI / 2, M.PI / 2); c.closePath();
        g = c.createLinearGradient(0, -T / 2, 0, T / 2);
        g.addColorStop(0, "#4e2c16"); g.addColorStop(.2, "#26140a"); g.addColorStop(.65, "#100804"); g.addColorStop(1, "#040201");
        c.fillStyle = g; c.fill(); c.clip();
        g = c.createLinearGradient(0, 0, L, 0);
        g.addColorStop(0, "rgba(200,40,8,0)"); g.addColorStop(.6, "rgba(200,40,8,0)"); g.addColorStop(1, "rgba(220,60,12,.35)");
        c.fillStyle = g; c.fillRect(0, -T, L * 1.3, T * 2);
        g = c.createLinearGradient(0, 0, L, 0);
        g.addColorStop(0, "rgba(255,90,20,0)"); g.addColorStop(.3, "rgba(160,36,8,.35)"); g.addColorStop(.7, "rgba(255,110,30,.9)"); g.addColorStop(1, "rgba(255,200,120,1)");
        c.strokeStyle = g; c.lineWidth = T * .032; c.lineJoin = c.lineCap = "round"; c.shadowColor = "rgba(255,80,16,.9)"; c.shadowBlur = T * .14;
        const row = (r) => -M.cos(r * M.PI / 4) * T / 2; // rijen dichter bij elkaar aan de randen: het blok is rond
        for (let r = 1; r < 4; r++) { // lengtescheuren (met de nerf mee), elk stuk eigen gloed
          c.beginPath();
          for (let u = 0; u < L + T; u += T * .16) {
            const yy = row(r) + (rnd() - .5) * T * .09;
            if (rnd() < .22) { c.globalAlpha = .3 + .7 * rnd(); c.stroke(); c.beginPath(); c.moveTo(u, yy); } else c.lineTo(u, yy);
          }
          c.stroke();
        }
        for (let i = 0; i < L / T * 3.5; i++) { // schuine dwarsscheurtjes
          const u = rnd() * (L + T * .3), r = rnd() * 4 | 0, d = (rnd() - .5) * T * .45;
          c.globalAlpha = .3 + .7 * rnd(); c.beginPath(); c.moveTo(u, row(r));
          c.quadraticCurveTo(u + d / 2 + (rnd() - .5) * T * .2, (row(r) + row(r + 1)) / 2, u + d, row(r + 1)); c.stroke();
        }
        c.globalAlpha = 1;
        c.restore(); c.save(); c.translate(x, y); c.scale(dir, 1); c.rotate(ang); c.scale(.28, 1);
        g = c.createRadialGradient(-T * .1, -T * .1, 0, 0, 0, T / 2);
        g.addColorStop(0, "#4a2c17"); g.addColorStop(.55, "#33200f"); g.addColorStop(.85, "#1e1008"); g.addColorStop(1, "#0b0503");
        c.fillStyle = g; c.beginPath(); c.arc(0, 0, T / 2, 0, TAU); c.fill();
        c.lineWidth = T * .05; c.strokeStyle = "rgba(10,5,2,.45)"; c.beginPath(); c.arc(0, 0, T * .27, 0, TAU); c.stroke();
        c.restore();
      };
      let k = 0;
      for (; k < co.length && co[k][1] < oy - S * .035; k++) coal(co[k]);
      if (logs) { log(ox - S * .32, oy - S * .006, 1, -.27, S * .5, S * .08); log(ox + S * .32, oy, -1, -.25, S * .49, S * .076); }
      for (; k < co.length; k++) coal(co[k]);
      for (let i = 0; i < 24; i += 2) { hot[i] = bedX + ox + bell() * S * .26; hot[i + 1] = bedY + oy - S * (.01 + .06 * rnd()); }
    }

    function draw() {
      if (!S) return;
      const c = ctx, f = fc, fw = fb.width, fh = fb.height, Ic = M.min(I, 1.25), pres = .3 + .7 * ss(0, .25, Ic);
      const fl = .8 + .4 * vn(time * 6.1) * vn(time * 2.3 + 40), FH = S * M.min(.98, .1 + .85 * Ic), hw = S * (.06 + .19 * Ic), tw = S * (.1 + .13 * Ic);
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, W, H);
      c.globalCompositeOperation = "lighter";
      // warm licht rondom + gloed om de vlam
      const gcy = y0 - FH * .35, rx = M.min(W / 2, S * 1.2), ry = M.min(gcy, H - gcy, S);
      c.globalAlpha = (.16 + .34 * Ic) * fl; c.drawImage(sp.amb, cx - rx, gcy - ry, rx * 2, ry * 2);
      c.globalAlpha = (.12 + .3 * Ic) * pres * fl; c.drawImage(sp.core, cx - hw * 3, y0 - FH * .85, hw * 6, FH * 1.1);
      // vlammen in een buffer op lagere resolutie
      f.setTransform(1, 0, 0, 1, 0, 0); f.globalAlpha = 1; f.globalCompositeOperation = "source-over"; f.clearRect(0, 0, fw, fh);
      f.globalCompositeOperation = "lighter";
      for (let e = 0; e < 3; e++) { // omhulsel (rood) + hete kern (geel)
        const h = FH * (e ? .62 - .2 * (e - 1) : .45) * (.85 + .3 * vn(time * 3.7 + e * 17)), w = hw * (e ? 2.9 - .7 * (e - 1) : 1.6);
        f.globalAlpha = pres * (e ? .32 : .5) * fl;
        f.setTransform(w * q / 48, 0, (vn(time * 1.4 + e * 9) - .5) * .25 * h * q / 128, h * q / 128, (cx - fbX) * q, (y0 - fbY) * q);
        f.drawImage(e ? sp.body : sp.hot, -24, -128);
      }
      for (let j = 0; j < NT; j++) {
        if (tLife[j] <= 0) continue;
        const a = tAge[j] / tLife[j], gr = ss(0, .2, a), de = ss(.5, 1, a), al = pres * gr * (1 - de) * (tHot[j] ? .55 : .72);
        if (al < .01) continue;
        const fk = .78 + .44 * vn(time * 5 + tPh[j]), h = FH * tH[j] * fk * (.5 + .5 * gr) * (1 - .4 * de);
        const w = tw * tW[j] * (.6 + .4 * gr) * (1 - .3 * de), lean = (vn(time * 2.6 + tPh[j] * 3) - .5) * .7 - tX[j] * .3, sy = h * q / 128;
        f.globalAlpha = al;
        f.setTransform(w * q / 48, 0, -lean * sy, sy, (cx + tX[j] * hw - fbX) * q, (y0 - de * de * h * .9 - fbY) * q);
        f.drawImage(tHot[j] ? sp.hot : sp.lick, -24, -128);
      }
      // buffer → canvas in horizontale stroken die golvend meebewegen (likkende tongen)
      c.globalAlpha = 1;
      const n = 32, sh = fh / n, iq = 1 / q;
      for (let k = n - 1, ob = 0; k >= 0; k--) {
        const yT = fbY + k * sh * iq, hN = M.max(0, (y0 - yT) / S), amp = S * .07 * hN ** 1.3 * (.6 + .4 * Ic);
        const ot = amp * ((vn(hN * 3.1 - time * 2.8) - .5) * 2 + (vn(hN * 8 - time * 5.3 + 50) - .5) * .9);
        c.setTransform(iq, 0, (ob - ot) / sh, iq, fbX + ot, yT);
        c.drawImage(fb, 0, k * sh, fw, sh, 0, 0, fw, sh);
        ob = ot;
      }
      // kolenbed + blokken, ademende gloed, vuurschijn
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "source-over"; c.drawImage(bed, bedX, bedY);
      c.globalCompositeOperation = "lighter";
      for (let k = 0, r = S * .065; k < 24; k += 2) {
        c.globalAlpha = (.1 + .5 * vn(time * .7 + k * 5.3) ** 2) * (1.3 - .5 * Ic);
        c.drawImage(sp.ember, hot[k] - r, hot[k + 1] - r * .5, r * 2, r);
      }
      c.globalAlpha = (.1 + .38 * Ic) * fl; c.drawImage(sp.core, cx - S * .3, y0 - S * .09, S * .6, S * .15);
      // blauwe voetjes
      if (blue) for (let j = 0; j < NT; j += 2) {
        if (tLife[j] <= 0 || M.abs(tX[j]) > .8) continue;
        const a = tAge[j] / tLife[j], al = ss(0, .25, a) * (1 - ss(.45, .85, a)) * (.22 + .3 * vn(time * 6 + j)) * (1.3 - .5 * Ic);
        if (al < .02) continue;
        const xx = tX[j] * M.max(hw * 1.1, S * .2), h = S * (.028 + .035 * vn(time * 5 + tPh[j])), w = S * (.03 + .014 * M.abs(tW[j]));
        c.globalAlpha = al; c.setTransform(w / 48, 0, (vn(time * 3 + j) - .5) * .5 * h / 128, h / 128, cx + xx, y0 + S * .03 + xx * xx / S * .5);
        c.drawImage(sp.blue, -24, -128);
      }
      // vonken, uitgerekt langs hun snelheid
      for (let k = 0; k < NS; k++) {
        if (sL[k] <= 0) continue;
        const f2 = sL[k] / sM[k], r = sR[k] * (.5 + .5 * f2), vx = sVX[k], vy = sVY[k], v = M.sqrt(vx * vx + vy * vy) + 1e-3;
        const len = M.max(r * 2, M.min(v * .035, r * 8)), ux = vx / v, uy = vy / v;
        c.globalAlpha = M.min(1, f2 * 2.5) * (.6 + .4 * vn(time * 9 + k));
        c.setTransform(ux * len / 64, uy * len / 64, -uy * r / 32, ux * r / 32, sX[k], sY[k]);
        c.drawImage(sp.s[f2 > .66 ? 0 : f2 > .33 ? 1 : 2], -32, -32);
      }
    }

    const run = runner(cv, { size, step, draw, warm, ready: () => S > 0 });
    return {
      setIntensity(x) { tgt = clamp(+x || 0, 0, 1); if (still()) { cur = tgt; for (let k = 0; k < 30; k++) step(1 / 30); } run.go(); },
      burst() { if (still()) return; flare = 1; for (let k = 0; k < 70; k++) spark(1); run.go(); },
      destroy: run.destroy,
      get intensity() { return tgt; },
    };
  }

  // ---------- Vonkjes op de achtergrond ----------
  function embers(cv, o = {}) {
    const sp = sprites(), ctx = cv.getContext("2d"), N = 64;
    const x = F32(N), y = F32(N), vx = F32(N), vy = F32(N), z = F32(N), ph = F32(N), life = F32(N), max = F32(N), col = new Uint8Array(N);
    let W = 0, H = 0, d = 1, n = 0, time = 0, dens = clamp(o.density == null ? .5 : +o.density || 0, 0, 1);
    const count = () => { n = M.min(N, M.round((5 + 30 * dens) * clamp(W * H / (d * d * 330000), .4, 2.2))); };
    function spawn(k, any) {
      z[k] = R() ** 1.6; x[k] = R() * W; y[k] = any ? R() * H : H + R() * 40 * d;
      vx[k] = 0; vy[k] = -(10 + 32 * z[k] + 12 * R()) * d;
      ph[k] = R() * 99; max[k] = life[k] = 4 + 8 * R(); col[k] = R() * 3 | 0;
      if (any) life[k] *= R();
    }
    function size(w, h, dpr) { W = w; H = h; d = dpr; count(); for (let k = 0; k < N; k++) spawn(k, true); }
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
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, W, H);
      c.globalCompositeOperation = "lighter";
      for (let k = 0; k < n; k++) {
        const f = life[k] / max[k], zz = z[k], r = (2.2 + 8 * zz * zz) * d;
        c.globalAlpha = ss(0, .25, f) * ss(1, .85, f) * (.35 + .65 * vn(time * 3 + ph[k])) * (.95 - .5 * zz) * (.5 + .5 * y[k] / H);
        c.drawImage(zz > .7 ? sp.core : sp.s[col[k]], x[k] - r, y[k] - r, r * 2, r * 2);
      }
    }
    const run = runner(cv, { size, step, draw, warm() {}, ready: () => W > 0 });
    return { setDensity(v) { dens = clamp(+v || 0, 0, 1); count(); run.go(); }, destroy: run.destroy };
  }

  window.DVFire = { flame, embers };
})();
