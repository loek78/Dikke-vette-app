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
    const glow = (rgb, hot) => {
      const c = mk(64, 64), x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, hot ? "rgba(255,247,215,1)" : `rgba(${rgb},1)`);
      g.addColorStop(hot ? .14 : .22, `rgba(${rgb},${hot ? .85 : .6})`);
      g.addColorStop(.5, `rgba(${rgb},.18)`); g.addColorStop(1, `rgba(${rgb},0)`);
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); return c;
    };
    const tongue = (r, g, b) => { // vlamtong: ronde voet, spitse punt; vorm zit in alpha
      const w = 48, h = 112, c = mk(w, h), x = c.getContext("2d"), im = x.createImageData(w, h), d = im.data;
      for (let py = 0; py < h; py++) {
        const v = 1 - (py + .5) / h, hw = v < .22 ? M.sqrt(1 - ((.22 - v) / .22) ** 2) : ((1 - v) / .78) ** 1.35;
        const k = ss(0, .25, v) * (1 - .45 * v);
        for (let px = 0; px < w; px++) {
          const i = (py * w + px) * 4;
          d[i] = r; d[i + 1] = g; d[i + 2] = b;
          d[i + 3] = 255 * k * (1 - ss(.35, 1, M.abs((px + .5) / w * 2 - 1) / (hw + 1e-3)));
        }
      }
      x.putImageData(im, 0, 0); return c;
    };
    return (SP = {
      t: tongue(255, 92, 22), th: tongue(255, 168, 70), tb: tongue(70, 125, 255),
      amb: glow("255,128,40"), core: glow("255,150,50"), ember: glow("255,78,18"),
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
    const NT = 26, tAge = F32(NT), tLife = F32(NT), tX = F32(NT), tH = F32(NT), tW = F32(NT), tPh = F32(NT), tHot = new Uint8Array(NT);
    const NS = 96, sX = F32(NS), sY = F32(NS), sVX = F32(NS), sVY = F32(NS), sL = F32(NS), sM = F32(NS), sR = F32(NS), hot = F32(16);
    let W = 0, H = 0, S = 0, cx = 0, gy = 0, y0 = 0, q = 1, fbX = 0, fbY = 0, bedX = 0, bedY = 0;
    let tgt = clamp(o.intensity == null ? .7 : +o.intensity || 0, 0, 1), cur = tgt, I = cur, flare = 0, time = 0, acc = 0, warmed = false;

    function respawn(j) {
      const x = bell(); tX[j] = x; tAge[j] = 0;
      tLife[j] = (.4 + .7 * R()) * (1.6 - .6 * M.min(I, 1));
      tHot[j] = M.abs(x) < .5 && R() < .5 ? 1 : 0;
      tH[j] = (.45 + .55 * R()) * (1 - .55 * x * x) * (tHot[j] ? .75 : 1);
      tW[j] = .7 + .6 * R(); tPh[j] = R() * 99;
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
      const n = M.round(3 + 20 * M.min(I, 1.15));
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
      W = w; H = h; S = M.min(W * 1.05, H / 1.12); cx = W / 2; gy = H - S * .045; y0 = gy - S * .07;
      const bw = S * 1.1, top = M.max(0, y0 - S * 1.02);
      q = M.min(.5, 260 / bw); fb.width = M.ceil(bw * q); fb.height = M.ceil((y0 + S * .02 - top) * q); fbX = cx - bw / 2; fbY = top;
      buildBed(); sL.fill(0); warm();
    }

    function buildBed() { // gloeiend kolenbed + verkoolde blokken, één keer per formaat
      const c = bc, rnd = seeded(7), bw = M.ceil(S * 1.1), bh = M.ceil(S * .36), ox = bw / 2, oy = bh - S * .04;
      bed.width = bw; bed.height = bh; bedX = cx - ox; bedY = gy - oy;
      c.save(); c.translate(ox, oy - S * .02); c.scale(1, .26);
      let g = c.createRadialGradient(0, 0, 0, 0, 0, S * .38);
      g.addColorStop(0, "#ffa040"); g.addColorStop(.4, "#e2501a"); g.addColorStop(.75, "#5a1606"); g.addColorStop(1, "rgba(40,10,4,0)");
      c.fillStyle = g; c.fillRect(-S * .4, -S * .4, S * .8, S * .8); c.restore();
      const co = [];
      for (let k = 0; k < 70; k++) {
        const u = rnd() * 2 - 1;
        co.push([ox + u * S * .34, oy - rnd() * (1 - u * u) ** .6 * S * .08, S * (.016 + .02 * rnd()) * (1 - .3 * u * u), rnd()]);
      }
      co.sort((a, b) => a[1] - b[1]);
      const coal = ([x, y, r, s]) => {
        c.save(); c.translate(x, y); c.rotate(s * 9); c.scale(1, .7); c.beginPath();
        for (let i = 0; i < 7; i++) { const a = i / 7 * TAU, rr = r * (.75 + .35 * rnd()); c.lineTo(M.cos(a) * rr, M.sin(a) * rr); }
        const gg = c.createRadialGradient(0, -r * .2, 0, 0, 0, r * 1.1);
        if (s < .35) gg.addColorStop(0, "#ffb24e"), gg.addColorStop(.45, "#e04612"), gg.addColorStop(1, "#3c0f05");
        else gg.addColorStop(0, "#3c2518"), gg.addColorStop(1, "#0b0604");
        c.fillStyle = gg; c.fill(); c.restore();
      };
      const log = (x, y, dir, ang, L, T) => {
        c.save(); c.translate(x, y); c.scale(dir, 1); c.rotate(ang);
        g = c.createLinearGradient(0, -T / 2, 0, T / 2);
        g.addColorStop(0, "#6a4326"); g.addColorStop(.3, "#33200f"); g.addColorStop(1, "#090403");
        c.fillStyle = g; c.beginPath(); c.moveTo(0, -T / 2); c.lineTo(L, -T / 2); c.ellipse(L, 0, T * .3, T / 2, 0, -M.PI / 2, M.PI / 2); c.lineTo(0, T / 2); c.fill();
        c.strokeStyle = "rgba(0,0,0,.4)"; c.lineWidth = T * .05;
        for (let i = 1; i < 5; i++) { const yy = -T / 2 + T * i / 5; c.beginPath(); c.moveTo(T * .2, yy); c.quadraticCurveTo(L * .5, yy + T * .12 * (rnd() - .5), L, yy); c.stroke(); }
        c.shadowColor = "#ff4a0a"; c.shadowBlur = T * .3; c.strokeStyle = "#ff9a3a"; c.lineWidth = T * .04;
        for (let i = 0; i < 10; i++) {
          const xx = L * (.45 + .5 * rnd()), yy = T * (rnd() - .3) * .8;
          c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx + T * (.1 + .3 * rnd()), yy + T * .15 * (rnd() - .5)); c.stroke();
        }
        c.shadowBlur = 0; c.scale(.3, 1);
        g = c.createRadialGradient(0, 0, 0, 0, 0, T / 2);
        g.addColorStop(0, "#b07c4c"); g.addColorStop(.55, "#82542f"); g.addColorStop(.82, "#4a2c18"); g.addColorStop(1, "#140a05");
        c.fillStyle = g; c.beginPath(); c.arc(0, 0, T / 2, 0, TAU); c.fill();
        c.lineWidth = T * .035; c.strokeStyle = "rgba(60,30,14,.55)";
        c.beginPath(); c.arc(0, 0, T * .3, 0, TAU); c.stroke(); c.beginPath(); c.arc(0, 0, T * .15, 0, TAU); c.stroke();
        c.restore();
      };
      let k = 0;
      for (; k < co.length && co[k][1] < oy - S * .045; k++) coal(co[k]);
      if (logs) { log(ox - S * .4, oy - S * .015, 1, -.2, S * .7, S * .1); log(ox + S * .4, oy - S * .012, -1, -.18, S * .68, S * .095); }
      for (; k < co.length; k++) coal(co[k]);
      for (let i = 0; i < 16; i += 2) { hot[i] = bedX + ox + (rnd() * 2 - 1) * S * .28; hot[i + 1] = bedY + oy - rnd() * S * .05; }
    }

    function draw() {
      if (!S) return;
      const c = ctx, f = fc, fw = fb.width, fh = fb.height, Ic = M.min(I, 1.25), pres = .3 + .7 * ss(0, .25, Ic);
      const fl = .82 + .36 * vn(time * 6.1) * vn(time * 2.3 + 40), FH = S * (.06 + .62 * Ic), hw = S * (.05 + .16 * Ic), tw = S * (.1 + .12 * Ic);
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, W, H);
      c.globalCompositeOperation = "lighter";
      // warm licht rondom
      const gcy = y0 - FH * .3, rx = M.min(W / 2, S * 1.1), ry = M.min(gcy, H - gcy, S * .95);
      c.globalAlpha = (.14 + .3 * Ic) * fl; c.drawImage(sp.amb, cx - rx, gcy - ry, rx * 2, ry * 2);
      // vlammen in een buffer op lagere resolutie
      f.setTransform(1, 0, 0, 1, 0, 0); f.globalAlpha = 1; f.globalCompositeOperation = "source-over"; f.clearRect(0, 0, fw, fh);
      f.globalCompositeOperation = "lighter";
      f.globalAlpha = .55 * pres * fl;
      f.drawImage(sp.core, (cx - hw * 1.6 - fbX) * q, (y0 - FH * .55 - fbY) * q, hw * 3.2 * q, FH * .75 * q);
      for (let j = 0; j < NT; j++) {
        if (tLife[j] <= 0) continue;
        const a = tAge[j] / tLife[j], gr = ss(0, .22, a), de = ss(.55, 1, a), al = pres * gr * (1 - de) * (tHot[j] ? .5 : .75);
        if (al < .01) continue;
        const fk = .75 + .5 * vn(time * 3.3 + tPh[j]), h = FH * tH[j] * fk * (.45 + .55 * gr) * (1 - .45 * de);
        const w = tw * tW[j] * (.6 + .4 * gr) * (1 - .35 * de), lean = (vn(time * 1.7 + tPh[j] * 3) - .5) * .55 - tX[j] * .25;
        const sx = w * q / 48, sy = h * q / 112;
        f.globalAlpha = al;
        f.setTransform(sx, 0, -lean * sy, sy, (cx + tX[j] * hw - fbX) * q, (y0 - de * de * FH * tH[j] * .6 - fbY) * q);
        f.drawImage(tHot[j] ? sp.th : sp.t, -24, -112);
      }
      // buffer → canvas in horizontale stroken die golvend meebewegen (lekkende tongen)
      c.globalAlpha = 1;
      const n = 24, sh = fh / n, iq = 1 / q;
      for (let k = n - 1, ob = 0; k >= 0; k--) {
        const yT = fbY + k * sh * iq, hN = M.max(0, (y0 - yT) / S), amp = S * .045 * hN * M.sqrt(hN) * (.6 + .4 * Ic);
        const ot = amp * ((vn(hN * 3.1 - time * 2.4) - .5) * 2 + vn(hN * 7.7 - time * 3.9 + 50) - .5);
        c.setTransform(iq, 0, (ob - ot) / sh, iq, fbX + ot, yT);
        c.drawImage(fb, 0, k * sh, fw, sh, 0, 0, fw, sh);
        ob = ot;
      }
      // kolenbed + blokken
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "source-over"; c.drawImage(bed, bedX, bedY);
      c.globalCompositeOperation = "lighter";
      for (let k = 0, r = S * .07; k < 16; k += 2) {
        c.globalAlpha = .1 + .35 * vn(time * .8 + k * 5.3) ** 2;
        c.drawImage(sp.ember, hot[k] - r, hot[k + 1] - r * .6, r * 2, r * 1.2);
      }
      c.globalAlpha = (.12 + .4 * Ic) * fl; c.drawImage(sp.core, cx - S * .32, y0 - S * .1, S * .64, S * .16);
      // blauwe voetjes
      if (blue) for (let j = 0; j < NT; j += 2) {
        if (tLife[j] <= 0) continue;
        const a = tAge[j] / tLife[j], al = ss(0, .2, a) * (1 - ss(.5, .9, a)) * (.35 + .25 * vn(time * 5 + j));
        if (al < .02) continue;
        const h = S * (.035 + .05 * vn(time * 4 + tPh[j])), w = S * (.025 + .02 * tW[j]);
        c.globalAlpha = al; c.setTransform(w / 48, 0, 0, h / 112, cx + tX[j] * hw * 1.15, y0 + S * .012); c.drawImage(sp.tb, -24, -112);
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
