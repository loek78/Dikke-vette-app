// E2E voor KERSTDROOM (kerst/): Playwright-Chromium met vier "telefoons" (iPhone 13, touch, eigen opslag) tegen een
// lokale MQTT-broker en statische server op vrije poorten.
//   npm run e2e:kerst                      beide suites; standaard screenshots in test-results/e2e-kerst/
//   npm run e2e:kerst -- solo | samen      één suite
//   E2E_SHOTS=<map> npm run e2e:kerst      screenshots elders (e2e-<fase>-<telefoon>.png)
//   KERST_P95_MS=<ms>                      andere grens voor de rAF-p95-meting (standaard 20 ms)
// (a) solo: titel → SPELEN → uitleg → aftellen → 30 s autopilot met ECHTE tikken/vegen (CDP touch) op het canvas → ≥ 200 m,
//     verrassingen, pauze/hervatten, rAF-p95 tijdens snoepregen + noorderlicht met 3 geesten, 0 hartjes → "Tik om verder te
//     dromen" → nog eens → uitslag.
// (b) samen: Luke maakt een kamer (?dur=25 → korte run), Viola en Zarah doen mee met de code, Rifka via de deellink; klaar →
//     Start → synchroon aftellen → iedereen rent → geesten met de juiste namen → Rifka's snoepregen = banner op alle 4 →
//     Droomster vol (hook op de host) → finale → uitslag met medailles/titels op alle 4 → Viola herlaadt → Nog een keer →
//     lobby → tweede ronde met de 25 s-timer-finale en een ingedutte Zarah → kamer sluiten.
// Faalt bij elke mislukte stap, bij elke console-fout/pageerror/dialog en bij elk antwoord ≥ 400 of mislukt verzoek.
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { createEnv, ROOT, assert, eq, until, sleep, log } from "./lib.mjs";

const SHOTS = process.env.E2E_SHOTS || process.env.KERST_SHOTS || join(ROOT, "test-results", "e2e-kerst");
const P95_LIMIT = process.env.KERST_P95_MS ? +process.env.KERST_P95_MS : 20;
const NAMES = ["Luke", "Viola", "Rifka", "Zarah"];

// ---------- hulpjes ----------
const kerstUrl = (env, suffix = "") => `${env.origin}kerst/?broker=${env.brokerUrl}${suffix}`;
const screenOf = (p) => p.page.evaluate(() => window.__kerst && window.__kerst.ui.screen);
const waitScreen = (p, name, timeout = 15000) => p.page.waitForSelector(`.kd-scr.is-on[data-scr="${name}"]`, { timeout });
// Compacte momentopname van game.state (null zonder spel)
const stateOf = (p) => p.page.evaluate(() => {
  const s = window.__kerst && window.__kerst.state;
  if (!s) return null;
  return { phase: s.phase, t: s.t, x: s.x, meters: s.meters, stars: s.stars, hearts: s.hearts, speed: s.speed, onGround: s.onGround, anim: s.anim,
    flying: s.flying, sled: s.sled, paused: s.paused, countdown: s.countdown, prompt: s.prompt, event: s.event && s.event.id, powerup: s.powerup && s.powerup.id,
    candyRain: s.candyRain, droomster: s.droomster, theme: s.theme, ghosts: s.ghosts.map((g) => g.name), result: !!s.result };
});
const waitPhase = (p, phases, timeout = 15000) => until(async () => { const s = await stateOf(p); return s && [].concat(phases).includes(s.phase) ? s : null; }, { timeout, interval: 60, msg: `${p.name}: fase ${[].concat(phases).join("/")}` });
const sessionState = (p) => p.page.evaluate(() => { const s = window.__kerst.session; return s ? JSON.parse(JSON.stringify(s.state)) : null; });
const pidOf = (p) => p.page.evaluate(() => window.__kerst.session && window.__kerst.session.pid);
const bannerText = (p) => p.page.evaluate(() => { const b = document.getElementById("banner"); return b.classList.contains("is-on") ? b.textContent : ""; });
const text = (p, sel) => p.page.textContent(sel);

// Echte aanrakingen via CDP (touch-emulatie van de iPhone 13-context): tik en veeg omlaag midden op het canvas
async function touchOf(p) {
  if (p._touch) return p._touch;
  const cdp = await p.ctx.newCDPSession(p.page);
  const at = async () => { const r = await p.page.evaluate(() => { const c = document.getElementById("game").getBoundingClientRect(); return { x: c.left + c.width * 0.5, y: c.top + c.height * 0.62 }; }); return r; };
  const ev = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  p._touch = {
    async tap(x, y) { const c = x == null ? await at() : { x, y }; await ev("touchStart", [{ x: c.x, y: c.y }]); await ev("touchEnd", []); },
    async swipeDown() { const c = await at(); await ev("touchStart", [{ x: c.x, y: c.y }]); await ev("touchMove", [{ x: c.x, y: c.y + 36 }]); await ev("touchMove", [{ x: c.x, y: c.y + 80 }]); await ev("touchEnd", []); },
    async swipeUp() { const c = await at(); await ev("touchStart", [{ x: c.x, y: c.y }]); await ev("touchMove", [{ x: c.x, y: c.y - 36 }]); await ev("touchMove", [{ x: c.x, y: c.y - 80 }]); await ev("touchEnd", []); },
  };
  return p._touch;
}

// Autopilot vanuit Node: leest __kerst.state.obstaclesAhead (~60×/s) en tikt/veegt met echte touch-events; verzamelt de
// verrassingen die voorbijkomen. ghosts = 3 synthetische geesten rond de speler zetten (voor de prestatiemeting).
function startAutopilot(p) {
  const ap = { running: true, events: new Set(), iters: 0, minHearts: 3, maxMeters: 0, ghosts: false, done: null };
  const acted = new Map();
  ap.done = (async () => {
    const touch = await touchOf(p);
    while (ap.running) {
      let st = null;
      try {
        st = await p.page.evaluate((ghosts) => {
          const k = window.__kerst, s = k && k.state;
          if (!s) return null;
          if (ghosts && k.game) {
            const G = [["g1", "Luke", "vos"], ["g2", "Viola", "uil"], ["g3", "Zarah", "konijn"]];
            k.game.setGhosts(G.map(([pid, name, animal], i) => ({ pid, name, animal, x: s.x + Math.sin(s.t * 0.7 + i) * 220 - 60, y: Math.max(0, Math.sin(s.t * 3 + i) * 120), anim: "run", stars: i * 7, hearts: 3 })));
          }
          return { phase: s.phase, x: s.x, speed: s.speed, onGround: s.onGround, anim: s.anim, flying: s.flying, sled: s.sled, ev: s.event && s.event.id, hearts: s.hearts, meters: s.meters, obs: s.obstaclesAhead.slice(0, 3) };
        }, ap.ghosts);
      } catch (e) { st = null; } // pagina herlaadt of spel weg
      if (st) {
        ap.iters++;
        if (st.ev) ap.events.add(st.ev);
        ap.minHearts = Math.min(ap.minHearts, st.hearts);
        ap.maxMeters = Math.max(ap.maxMeters, st.meters);
        if (st.phase === "fading") await touch.tap();
        else if (st.phase === "run" || st.phase === "finale") {
          if (!st.flying && !st.sled) {
            for (const o of st.obs) {
              if (o.x + o.w < st.x) continue;
              const d = o.x - st.x, key = o.type + "@" + Math.round(o.x), tt = d / Math.max(1, st.speed); // s tot de rand
              const slide = o.needs === "slide" || o.alt === "slide";
              if (slide) { if (d > 0 && tt < 0.32 && st.onGround && st.anim !== "slide" && !acted.has(key)) { acted.set(key, 1); await touch.swipeDown(); } }
              else if (d > 0 && tt < 0.26 && st.onGround && !acted.has(key)) { acted.set(key, 1); await touch.tap(); }
              break;
            }
          }
        }
        if (acted.size > 300) for (const k of [...acted.keys()].slice(0, 200)) acted.delete(k);
      }
      await sleep(st ? 6 : 100);
    }
  })();
  ap.stop = async () => { ap.running = false; await ap.done; return ap; };
  return ap;
}

// rAF-frametijden opnemen in de pagina
const recFrames = (p) => p.page.evaluate(() => {
  if (window.__rec) { window.__rec.frames.length = 0; window.__rec.on = true; return; }
  window.__rec = { on: true, frames: [] };
  let last = performance.now();
  (function f(t) { if (window.__rec.on) window.__rec.frames.push(t - last); last = t; requestAnimationFrame(f); })(last);
});
const readFrames = (p) => p.page.evaluate(() => {
  window.__rec.on = false;
  const fr = window.__rec.frames.slice(1).sort((a, b) => a - b);
  const q = (k) => fr[Math.min(fr.length - 1, Math.floor(fr.length * k))] || 0;
  return { n: fr.length, p50: q(0.5), p95: q(0.95), max: fr[fr.length - 1] || 0 };
});

// Netwerk: elk antwoord ≥ 400 of mislukt verzoek (behalve afgebroken door navigatie) is een fout
function watchNetwork(env, p) {
  p.loaded = new Set();
  p.page.on("response", (r) => { p.loaded.add(r.url()); if (r.status() >= 400) env.errors.push(`[${p.name}] HTTP ${r.status()} ${r.url()}`); });
  p.page.on("requestfailed", (r) => { const f = r.failure(); if (f && !/ERR_ABORTED/.test(f.errorText || "")) env.errors.push(`[${p.name}] verzoek mislukt ${r.url()} (${f.errorText})`); });
  p.page.on("pageerror", (e) => log(`  [${p.name}] pageerror: ${e.message}\n    ${String(e.stack || "").split("\n").slice(0, 4).join("\n    ")}`)); // lib.mjs telt de fout; hier de stack
}
async function newPhone(env, name) {
  const p = await env.phone(name);
  watchNetwork(env, p);
  return p;
}
// Alle relatieve paden uit kerst/index.html (scripts, css, iconen, preloads) bestaan op schijf
function checkIndexPaths() {
  const html = readFileSync(join(ROOT, "kerst", "index.html"), "utf8");
  const missing = [];
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^(https?:)?\/\//.test(ref) || ref === "../") continue;
    const file = join(ROOT, "kerst", ref.split("?")[0]);
    if (!existsSync(file)) missing.push(ref);
  }
  return missing;
}

// ---------- (a) solo ----------
async function solo(env) {
  const { step } = env;
  const p = await newPhone(env, "Rifka");
  let ap = null;

  await step("solo: titel → SPELEN → kies je vriendje → uitleg (eerste keer) → aftellen → rennen", async () => {
    await p.goto(kerstUrl(env));
    await waitScreen(p, "title");
    eq(checkIndexPaths(), [], "alle relatieve paden in kerst/index.html bestaan");
    eq(await text(p, "[data-fawn-name]"), "Vlok", "het reekalfje heet Vlok");
    await p.shot("10-titel");
    await p.tap("#btnPlay");
    await waitScreen(p, "setup");
    await p.tap('[data-animals="solo"] .kd-animal[data-animal="hert"]');
    await p.tap('[data-diff="solo"] button[data-diff="normaal"]');
    await p.shot("11-kies-vriendje");
    await p.tap("#btnSoloStart");
    await p.page.waitForSelector("#helpOverlay.is-on", { timeout: 5000 });
    await p.shot("12-uitleg");
    await p.tap("#btnHelpOk");
    await waitScreen(p, "game");
    await waitPhase(p, "countdown", 5000);
    await until(() => p.page.isVisible("#countdown.is-on"), { timeout: 3000, msg: "aftellen zichtbaar" });
    await p.shot("13-aftellen");
    await waitPhase(p, "run", 8000);
    eq(await screenOf(p), "game", "spelscherm");
  });

  await step("solo: 30 s autopilot met echte tikken/vegen → ≥ 200 m, verrassing(en) onderweg", async () => {
    ap = startAutopilot(p);
    await sleep(9000);
    await p.shot("20-rennen");
    await sleep(21000);
    const st = await stateOf(p);
    log(`  ${st.meters} m · ⭐ ${st.stars} · ❤️ ${st.hearts} · events: ${[...ap.events].join(", ") || "-"} · ${ap.iters} beslissingen`);
    assert(st.phase === "run" || st.phase === "finale", `nog aan het rennen (${st.phase})`);
    assert(st.meters >= 200, `≥ 200 m na 30 s (${st.meters} m)`);
    assert(st.hearts >= 1, `hartjes over (${st.hearts})`);
    assert(ap.events.size >= 1, "minstens één verrassing kwam vanzelf (noorderlicht bij 80 m)");
  });

  await step("solo: 4 verrassingen getriggerd (banner + thema/flip) → ≥ 3 verschillende events", async () => {
    const checks = { peperkoek: (s) => s.theme === "peperkoek", droomflip: null, sneeuwbol: null, reuzenboom: null, kerstman: null, sterrenregen: null };
    let shots = 0;
    for (const id of Object.keys(checks)) {
      await p.page.evaluate((i) => window.__kerst.game.triggerEvent(i, {}), id);
      const b = await until(() => bannerText(p), { timeout: 2500, msg: `banner voor ${id}` });
      assert(b.length > 4, `banner heeft tekst (${id}: ${JSON.stringify(b)})`);
      await sleep(1400);
      const st = await stateOf(p);
      assert(st.event === id, `${id} is het actieve event (nu: ${st.event})`);
      if (checks[id]) assert(checks[id](st), `${id}: zichtbaar effect in state`);
      if (shots < 4) { await p.shot(`30-event-${id}`); shots++; }
      await sleep(900);
    }
    const flip = await p.page.evaluate(() => window.__kerst.state.flip);
    assert(flip >= 0, "flip is een getal");
    const st = await stateOf(p);
    assert(st.hearts >= 1 && (st.phase === "run" || st.phase === "finale"), `nog in de droom (${st.phase}, ❤️ ${st.hearts})`);
    assert(ap.events.size >= 3, `≥ 3 verschillende verrassingen (${[...ap.events].join(", ")})`);
  });

  await step("solo: pauze → overlay → Verder! → 3-2-1 → verder rennen", async () => {
    await p.tap("#btnPause");
    await until(async () => (await stateOf(p)).paused, { timeout: 2000, msg: "gepauzeerd" });
    await until(() => p.page.isVisible("#pauseOverlay.is-on"), { timeout: 1500, msg: "pauze-overlay zichtbaar (HUD volgt de state op 20 Hz)" });
    const before = await stateOf(p);
    await sleep(700);
    const during = await stateOf(p);
    assert(Math.abs(during.x - before.x) < 1, "de wereld staat stil tijdens de pauze");
    await p.shot("40-pauze");
    await p.tap("#btnResume");
    const st = await until(async () => { const s = await stateOf(p); return s && !s.paused && s.countdown > 0 ? s : null; }, { timeout: 2000, msg: "aftellen na hervatten" });
    await until(() => p.page.isVisible("#countdown.is-on"), { timeout: 1500, msg: "3-2-1 zichtbaar" });
    await until(async () => !(await p.page.isVisible("#pauseOverlay.is-on")), { timeout: 1500, msg: "overlay weg" });
    log(`  hervatten: aftellen vanaf ${st.countdown.toFixed(1)} s`);
    await until(async () => { const s = await stateOf(p); return s && s.countdown == null && !s.paused; }, { timeout: 5000, msg: "aftellen klaar" });
    const x0 = (await stateOf(p)).x;
    await sleep(500);
    assert((await stateOf(p)).x > x0 + 50, "de wereld beweegt weer");
  });

  await step("solo: rAF p95 tijdens snoepregen + noorderlicht met 3 geesten", async () => {
    ap.ghosts = true;
    await sleep(600);
    await p.page.evaluate(() => { window.__kerst.game.triggerEvent("noorderlicht", {}); window.__kerst.game.triggerEvent("snoepregen", { by: "Zarah" }); });
    const st0 = await until(async () => { const s = await stateOf(p); return s && s.candyRain && s.theme === "aurora" && s.ghosts.length === 3 ? s : null; }, { timeout: 2500, msg: "snoepregen + noorderlicht + 3 geesten actief" });
    await sleep(700); // even warmdraaien (aurora-caches)
    await recFrames(p);
    await sleep(2200);
    await p.shot("31-event-noorderlicht-snoepregen-geesten");
    await sleep(2800);
    const fr = await readFrames(p);
    const st = await stateOf(p);
    const dpr = await p.page.evaluate(() => window.__kerst.state.dpr);
    const load = os.loadavg()[0], cores = os.cpus().length || 1;
    log(`  rAF: ${fr.n} frames · p50 ${fr.p50.toFixed(1)} ms · p95 ${fr.p95.toFixed(1)} ms · max ${fr.max.toFixed(1)} ms · canvas-DPR ${dpr} · load ${load.toFixed(1)}/${cores} · thema ${st.theme} · geesten ${st0.ghosts.join(", ")}`);
    assert(fr.n > 150, "rAF liep");
    eq(st.ghosts.length, 3, "3 geesten in state");
    assert(st.theme === "aurora", "noorderlicht actief");
    if (load > cores * 1.5) log(`  (p95 niet beoordeeld: machine overbelast, load ${load.toFixed(1)} op ${cores} kernen)`);
    else assert(fr.p95 <= P95_LIMIT, `rAF p95 ${fr.p95.toFixed(1)} ms ≤ ${P95_LIMIT} ms`);
    ap.ghosts = false;
  });

  await step("solo: 0 hartjes → 'Tik om verder te dromen' → tik → 3 hartjes; nog eens → Goedemorgen → uitslag", async () => {
    await ap.stop();
    const touch = await touchOf(p);
    for (let i = 0; i < 6 && (await stateOf(p)).phase !== "fading"; i++) await p.page.evaluate(() => window.__kerst.game.hurt("test", true));
    let st = await stateOf(p);
    eq(st.phase, "fading", "bijna wakker");
    eq(st.hearts, 0, "0 hartjes");
    await until(() => p.page.isVisible("#prompt.is-on"), { timeout: 2000, msg: "prompt zichtbaar" });
    assert((await text(p, "#prompt b")).includes("Tik om verder te dromen"), "prompttekst");
    await sleep(600);
    await p.shot("50-bijna-wakker");
    await touch.tap();
    st = await until(async () => { const s = await stateOf(p); return s && s.phase === "run" ? s : null; }, { timeout: 3000, msg: "verder dromen na de tik" });
    eq(st.hearts, 3, "drie nieuwe hartjes");
    await until(async () => !(await p.page.isVisible("#prompt.is-on")), { timeout: 2000, msg: "prompt weg" });
    const meters = st.meters;
    await sleep(1800); // onkwetsbaar na het ontwaken
    for (let i = 0; i < 6 && !["ending", "end"].includes((await stateOf(p)).phase); i++) await p.page.evaluate(() => window.__kerst.game.hurt("test", true));
    st = await stateOf(p);
    assert(st.phase === "ending" || st.phase === "end", `tweede keer: de droom vervaagt (${st.phase})`);
    await waitScreen(p, "results", 12000);
    assert((await text(p, "#resTitle")).includes("Goedemorgen"), "Goedemorgen!");
    const lead = await text(p, "#resLead");
    assert(/\d+ m/.test(lead) && lead.includes("Vlok"), `uitslagregel noemt meters en Vlok (${lead})`);
    assert(parseInt(/(\d+) m/.exec(lead)[1], 10) >= meters - 1, "afstand klopt");
    eq(await p.page.$$eval("#resBody .kd-bigstat", (e) => e.length), 6, "zes grote cijfers");
    assert((await text(p, "#resBody .kd-title-card b")).length > 3, "een titel voor de speler");
    await sleep(800);
    await p.shot("51-uitslag-solo");
  });

  await step("solo: Terug naar het begin", async () => {
    await p.tap("#btnResHome");
    await waitScreen(p, "title");
    assert(!(await stateOf(p)), "geen spel meer");
  });
}

// ---------- (b) samen spelen ----------
async function samen(env) {
  const { step } = env;
  const [luke, viola, rivka, zara] = await Promise.all(NAMES.map((n) => newPhone(env, n)));
  const all = [luke, viola, rivka, zara];
  const others = [viola, rivka, zara];
  let code = "";
  const pids = {};
  const autopilots = new Map();
  const startAll = () => { for (const p of all) autopilots.set(p, startAutopilot(p)); };
  const stopAll = async () => { for (const [, ap] of autopilots) await ap.stop(); autopilots.clear(); };
  const pickProfile = async (p, name, animal, diff) => {
    await p.tap(`[data-names="together"] .kd-chip[data-name="${name}"]`);
    await p.tap(`[data-animals="together"] .kd-animal[data-animal="${animal}"]`);
    await p.tap(`[data-diff="together"] button[data-diff="${diff}"]`);
  };
  const playersOn = (p) => p.page.$$eval("#players .kd-player .kd-p-name", (els) => els.map((e) => e.firstChild.textContent.trim()));

  await step("samen: Luke maakt een kamer (vos, stoer) → lobby met code en QR", async () => {
    await luke.goto(kerstUrl(env, "&dur=25"));
    await waitScreen(luke, "title");
    await luke.tap("#btnTogether");
    await waitScreen(luke, "together");
    await pickProfile(luke, "Luke", "vos", "stoer");
    await luke.shot("60-samen-spelen");
    await luke.tap("#btnHost");
    await waitScreen(luke, "lobby");
    code = (await text(luke, "#lobbyCode")).trim();
    assert(/^[A-Z]{4}$/.test(code), `kamercode van 4 letters (${code})`);
    assert(await luke.page.$("#lobbyQr svg"), "QR-code getekend");
    assert(!(await luke.page.isHidden("#btnStart")), "de baas ziet Start");
    eq(await text(luke, "#btnStart"), "Alleen starten 🚀", "alleen starten mag ook");
    pids.luke = await pidOf(luke);
    log(`  kamer ${code}`);
    await luke.shot("61-lobby-alleen");
  });

  await step("samen: Viola doet mee met de code (uil, normaal)", async () => {
    await viola.goto(kerstUrl(env));
    await waitScreen(viola, "title");
    await viola.tap("#btnTogether");
    await waitScreen(viola, "together");
    await pickProfile(viola, "Viola", "uil", "normaal");
    await viola.tap("#btnJoin");
    await viola.page.waitForSelector("#joinOverlay.is-on");
    await viola.page.fill("#codeInput", code.toLowerCase());
    eq(await viola.page.inputValue("#codeInput"), code, "code wordt hoofdletters");
    await viola.shot("62-code-invoeren");
    await viola.tap("#btnJoinGo");
    await waitScreen(viola, "lobby");
    pids.viola = await pidOf(viola);
    await until(async () => (await playersOn(luke)).length === 2, { timeout: 8000, msg: "Luke ziet Viola" });
    eq(await playersOn(viola), ["Luke", "Viola"], "Viola ziet Luke (baas) en zichzelf");
  });

  await step("samen: Rifka via de deellink ?join=CODE&b=0 (reekalfje), Zarah met de code (konijn, makkelijk)", async () => {
    await rivka.goto(`${env.origin}kerst/?join=${code}&b=0&broker=${env.brokerUrl}`);
    await waitScreen(rivka, "together");
    assert((await text(rivka, "#joinHint")).includes(code), "uitnodiging met de code");
    assert((await text(rivka, "#btnJoin")).includes(code), `knop noemt de kamer (${await text(rivka, "#btnJoin")})`);
    assert(!(await rivka.page.url()).includes("join="), "deellink-parameters uit de URL gehaald");
    await pickProfile(rivka, "Rifka", "hert", "normaal");
    await rivka.shot("63-uitgenodigd");
    await rivka.tap("#btnJoin");
    await waitScreen(rivka, "lobby");
    pids.rifka = await pidOf(rivka);

    await zara.goto(kerstUrl(env));
    await waitScreen(zara, "title");
    await zara.tap("#btnTogether");
    await waitScreen(zara, "together");
    await pickProfile(zara, "Zarah", "konijn", "makkelijk");
    await zara.tap("#btnJoin");
    await zara.page.waitForSelector("#joinOverlay.is-on");
    await zara.page.fill("#codeInput", code);
    await zara.tap("#btnJoinGo");
    await waitScreen(zara, "lobby");
    pids.zarah = await pidOf(zara);
    for (const p of all) await until(async () => (await playersOn(p)).length === 4, { timeout: 10000, msg: `${p.name} ziet 4 spelers` });
    for (const p of all) eq(await playersOn(p), NAMES, `${p.name}: spelers in volgorde (baas eerst)`);
    const st = await sessionState(luke);
    eq([st.players[pids.luke].animal, st.players[pids.viola].animal, st.players[pids.rifka].animal, st.players[pids.zarah].animal], ["vos", "uil", "hert", "konijn"], "vriendjes in de state");
    eq(st.players[pids.zarah].difficulty, "makkelijk", "Zarah speelt makkelijk");
    eq(st.durationSec, 25, "testrun van 25 s via ?dur=");
    await luke.shot("64-lobby-vol");
    await rivka.shot("64-lobby-vol");
  });

  await step("samen: iedereen klaar → Start wordt actief", async () => {
    assert(await luke.page.isDisabled("#btnStart"), "Start uit zolang niemand klaar is");
    for (const p of others) await p.tap("#btnReady");
    await until(async () => { const st = await sessionState(luke); return others.every((p) => st.players[pids[p.name.toLowerCase()]].ready); }, { timeout: 8000, msg: "alle drie klaar" });
    await until(async () => !(await luke.page.isDisabled("#btnStart")), { timeout: 4000, msg: "Start actief" });
    eq(await text(luke, "#btnStart"), "Start! 🚀", "Start-knop");
    assert((await text(luke, "#lobbyNote")).includes("3 van 3"), `notitie telt (${await text(luke, "#lobbyNote")})`);
    assert((await viola.page.getAttribute("#btnReady", "class")).includes("is-on"), "Viola's knop staat op klaar");
    await viola.shot("65-klaar");
    await luke.shot("65-klaar");
  });

  await step("samen: Start → synchroon aftellen → alle 4 in fase run (klokverschil < 0,5 s)", async () => {
    await luke.tap("#btnStart");
    for (const p of all) await waitScreen(p, "game", 10000);
    for (const p of all) await waitPhase(p, ["countdown", "run"], 6000);
    await luke.shot("70-aftellen");
    await zara.shot("70-aftellen");
    await Promise.all(all.map((p) => waitPhase(p, "run", 10000)));
    const ts = await Promise.all(all.map((p) => stateOf(p).then((s) => s.t)));
    const spread = Math.max(...ts) - Math.min(...ts);
    log(`  spelklokken: ${ts.map((t) => t.toFixed(2)).join(" / ")} s → verschil ${spread.toFixed(2)} s`);
    assert(spread < 0.5, `telefoons lopen gelijk (${spread.toFixed(2)} s)`);
    for (const p of all) assert(await p.page.isVisible("#hudDroom.is-on"), `${p.name}: Droomster-meter zichtbaar`);
    startAll();
  });

  await step("samen: geesten met de juiste namen op elke telefoon (state + HUD-chips)", async () => {
    for (const p of all) {
      const expect = NAMES.filter((n) => n !== p.name).sort();
      await until(async () => { const s = await stateOf(p); return s && s.ghosts.slice().sort().join() === expect.join(); }, { timeout: 8000, msg: `${p.name} ziet ${expect.join(", ")}` });
      await until(async () => (await p.page.$$eval("#hudGhosts .kd-ghost .kd-g-name", (e) => e.map((x) => x.textContent))).sort().join() === expect.join(), { timeout: 4000, msg: `${p.name}: geest-chips` });
    }
    await sleep(800);
    await luke.shot("71-geesten");
    await rivka.shot("71-geesten");
  });

  await step("samen: Rifka pakt Snoepregen → snoep + banner op alle 4", async () => {
    await rivka.page.evaluate(() => window.__kerst.game.grantPowerup("snoepregen"));
    for (const p of all) await until(async () => (await stateOf(p)).candyRain, { timeout: 4000, msg: `${p.name}: het snoep regent` });
    const own = await until(() => bannerText(rivka), { timeout: 2000, msg: "Rifka's eigen banner" });
    assert(own.includes("Snoepregen"), `Rifka: power-up-banner (${own})`);
    for (const p of all.filter((x) => x !== rivka)) {
      const b = await until(async () => { const t = await bannerText(p); return t.includes("Rifka") ? t : null; }, { timeout: 4000, msg: `${p.name}: banner van Rifka` });
      assert(b.includes("Snoepregen") && b.includes("laat het snoep regenen"), `${p.name}: banner (${b})`);
    }
    await sleep(700);
    await viola.shot("72-snoepregen");
    await rivka.shot("72-snoepregen");
  });

  await step("samen: verrassingen voor de foto's (noorderlicht, peperkoek, droomflip, reuzenboom) + Droomster-meter loopt", async () => {
    await luke.page.evaluate(() => window.__kerst.game.triggerEvent("noorderlicht", {}));
    await zara.page.evaluate(() => window.__kerst.game.triggerEvent("peperkoek", {}));
    await sleep(1800);
    await luke.shot("73-event-noorderlicht");
    await zara.shot("73-event-peperkoek");
    eq((await stateOf(luke)).theme, "aurora", "Luke ziet het noorderlicht");
    eq((await stateOf(zara)).theme, "peperkoek", "Zarah ziet de peperkoekwereld");
    await viola.page.evaluate(() => window.__kerst.game.triggerEvent("droomflip", {}));
    await rivka.page.evaluate(() => window.__kerst.game.triggerEvent("reuzenboom", {}));
    await sleep(2500);
    await viola.shot("73-event-droomflip");
    await rivka.shot("73-event-reuzenboom");
    assert((await viola.page.evaluate(() => window.__kerst.state.flip)) > 0.5, "Viola rent over de hemel");
    // Droomster: host telt de sterren van iedereen en deelt de fractie via zijn pos
    const frac = await until(async () => { const s = await stateOf(viola); return s && s.droomster > 0 ? s.droomster : null; }, { timeout: 6000, msg: "Droomster-fractie bij Viola" });
    const pct = await text(viola, "#hudDroomPct");
    log(`  Droomster bij Viola: ${(frac * 100).toFixed(1)}% (HUD ${pct})`);
    assert(parseInt(pct, 10) >= 1, `HUD toont de Droomster (${pct})`);
  });

  await step("samen: Droomster vol (host-hook) → finale op alle 4 → uitslag met medailles en titels op alle 4", async () => {
    await luke.page.evaluate(() => window.__kerst.session.publishEvt({ ev: "finale", reason: "droomster" }));
    for (const p of all) await waitPhase(p, "finale", 4000);
    const b = await until(async () => { const t = await bannerText(zara); return t.includes("Finale") ? t : null; }, { timeout: 3000, msg: "finale-banner bij Zarah" });
    assert(b.includes("Droomster"), `banner noemt de Droomster (${b})`);
    await sleep(2500);
    await luke.shot("74-finale");
    await zara.shot("74-finale");
    for (const p of all) await waitScreen(p, "results", 30000);
    await stopAll();
    for (const p of all) {
      assert((await text(p, "#resTitle")).includes("Jullie kerstdroom"), `${p.name}: uitslagtitel`);
      const rows = await p.page.$$eval("#resBody .kd-rank-row", (els) => els.map((e) => ({ medal: e.querySelector(".kd-medal").textContent, name: e.querySelector(".kd-r-name").textContent, title: e.querySelector(".kd-r-title").textContent, score: e.querySelector(".kd-r-score").textContent, me: e.classList.contains("is-me") })));
      eq(rows.length, 4, `${p.name}: vier rijen`);
      for (const r of rows) {
        assert(["🥇", "🥈", "🥉", "🌟"].includes(r.medal), `${p.name}: medaille (${r.medal})`);
        assert(r.title.length > 3, `${p.name}: titel (${r.title})`);
        assert(/⭐ \d+/.test(r.score), `${p.name}: score (${r.score})`);
      }
      eq(rows.filter((r) => r.me).length, 1, `${p.name}: eigen rij gemarkeerd`);
      assert(rows.find((r) => r.me).name.includes(p.name) && rows.find((r) => r.me).name.includes("(jij)"), `${p.name}: eigen naam + (jij)`);
      eq(new Set(rows.map((r) => r.title)).size, 4, `${p.name}: vier verschillende titels`);
      assert((await text(p, "#resBody .kd-total b")).includes("Droomster"), `${p.name}: Droomster-regel`);
    }
    assert(!(await luke.page.isDisabled("#btnAgain")), "Luke mag Nog een keer");
    for (const p of others) { assert(await p.page.isDisabled("#btnAgain"), `${p.name} wacht op Luke`); assert((await text(p, "#btnAgain")).includes("Luke"), `${p.name}: knop noemt Luke`); }
    const st = await sessionState(luke);
    eq(st.phase, "results", "state in results");
    eq(Object.keys(st.results).length, 4, "vier resultaten verzameld");
    assert(st.ranking[0].medal === "🥇", "goud bovenaan");
    log(`  ranking: ${st.ranking.map((r) => `${r.medal} ${r.name} ⭐${r.stars} ${r.meters}m · ${r.title}`).join(" | ")}`);
    await sleep(900);
    await luke.shot("80-uitslag");
    await zara.shot("80-uitslag");
  });

  await step("samen: Viola herlaadt tijdens de uitslag en ziet die weer", async () => {
    await viola.page.reload();
    await waitScreen(viola, "results", 15000);
    await until(async () => (await viola.page.$$eval("#resBody .kd-rank-row", (e) => e.length)) === 4, { timeout: 5000, msg: "vier rijen na herladen" });
    eq(await pidOf(viola), pids.viola, "zelfde speler-id na herladen");
    assert((await viola.page.$$eval("#resBody .kd-rank-row.is-me .kd-r-name", (e) => e.map((x) => x.textContent)))[0].includes("Viola"), "eigen rij weer gemarkeerd");
    await viola.shot("81-uitslag-na-herladen");
  });

  await step("samen: Nog een keer → iedereen terug in de lobby, klaar-vinkjes weg, nieuwe seed", async () => {
    const seed1 = (await sessionState(luke)).seed;
    await luke.tap("#btnAgain");
    for (const p of all) await waitScreen(p, "lobby", 10000);
    const st = await sessionState(luke);
    eq(st.phase, "lobby", "lobby");
    eq(st.round, 1, "ronde 1 gespeeld");
    assert(st.seed !== seed1, "nieuwe seed");
    for (const p of others) assert(!(await p.page.getAttribute("#btnReady", "class")).includes("is-on"), `${p.name}: nog niet klaar`);
    await until(() => luke.page.isDisabled("#btnStart"), { timeout: 3000, msg: "Start weer uit" });
    for (const p of all) eq(await playersOn(p), NAMES, `${p.name}: nog steeds 4 spelers`);
    await luke.shot("90-lobby-opnieuw");
    await viola.shot("90-lobby-opnieuw");
  });

  await step("samen: ronde 2 — Viola klaar, Start → timer-finale (T−10) → Zarah dut in (pauze) → uitslag → kamer sluiten", async () => {
    await viola.tap("#btnReady");
    await until(async () => !(await luke.page.isDisabled("#btnStart")), { timeout: 5000, msg: "Start actief" });
    await luke.tap("#btnStart");
    await Promise.all(all.map((p) => waitPhase(p, "run", 15000)));
    eq((await sessionState(luke)).round, 2, "ronde 2");
    startAll();
    await sleep(1500);
    // Rifka wordt vroeg wakker (twee keer 0 hartjes) terwijl Zarah pauzeert: ze ziet hoe lang de anderen nog dromen
    await autopilots.get(rivka).stop(); autopilots.delete(rivka);
    const rivkaEarly = (async () => {
      for (let k = 0; k < 2; k++) {
        for (let i = 0; i < 6 && !["fading", "ending", "end"].includes((await stateOf(rivka)).phase); i++) await rivka.page.evaluate(() => window.__kerst.game.hurt("test", true));
        if ((await stateOf(rivka)).phase === "fading") { await sleep(300); await (await touchOf(rivka)).tap(); await until(async () => ["run", "finale"].includes((await stateOf(rivka)).phase), { timeout: 3000, msg: "Rifka droomt verder" }); await sleep(2600); }
      }
      await until(async () => (await stateOf(rivka)).phase === "end", { timeout: 8000, msg: "Rifka's droom is voorbij" });
      return until(async () => { const t = await text(rivka, "#busySub"); return (await rivka.page.isVisible("#busy.is-on")) && /dromen nog \d+ s/.test(t) ? t : null; }, { timeout: 5000, msg: "Rifka ziet hoe lang de anderen nog dromen" });
    })();
    // Zarah pauzeert: na 5 s zonder pos ziet de rest "Zarah 😴"
    await autopilots.get(zara).stop(); autopilots.delete(zara);
    await zara.tap("#btnPause");
    await until(async () => (await stateOf(zara)).paused, { timeout: 2000, msg: "Zarah pauzeert" });
    await until(async () => (await stateOf(luke)).ghosts.includes("Zarah 😴"), { timeout: 9000, interval: 200, msg: "Luke ziet Zarah ingedut" });
    assert(await luke.page.$("#hudGhosts .kd-ghost.is-asleep"), "chip gedimd");
    await luke.shot("91-ingedut");
    await zara.tap("#btnResume");
    await until(async () => { const s = await stateOf(zara); return s && !s.paused && s.countdown == null; }, { timeout: 5000, msg: "Zarah rent weer" });
    autopilots.set(zara, startAutopilot(zara));
    await until(async () => !(await stateOf(luke)).ghosts.includes("Zarah 😴"), { timeout: 4000, msg: "Zarah is weer wakker" });
    // Rifka werd intussen vroeg wakker (twee keer 0 hartjes): zij wacht op de rest — de run van de anderen loopt door
    const wait = await rivkaEarly;
    log(`  Rifka vroeg wakker: "${wait}"`);
    eq(await screenOf(luke), "game", "Luke rent gewoon door");
    assert((await stateOf(luke)).phase === "run" || (await stateOf(luke)).phase === "finale", "Luke's run loopt nog");
    await rivka.shot("91b-vroeg-wakker");
    // Timer-finale op T−10 (dur=25) bij de drie die doorliepen
    const fin = await waitPhase(luke, "finale", 20000);
    assert(fin.t >= 14 && fin.t <= 17, `finale begint rond 15 s (${fin.t.toFixed(1)} s)`);
    await sleep(1500);
    await luke.shot("92-finale-ronde2");
    await rivka.shot("92-finale-ronde2");
    for (const p of all) await waitScreen(p, "results", 40000);
    await stopAll();
    const st = await sessionState(luke);
    eq(Object.keys(st.results).length, 4, "vier resultaten in ronde 2 (ook die van de vroeg wakkere Rifka)");
    eq(st.round, 2, "ronde 2 uitslag");
    assert(st.results[pids.rifka] && st.results[pids.rifka].meters > 0, "Rifka's vroege uitslag telt mee");
    await luke.shot("93-uitslag-ronde2");
    // Luke sluit de kamer: iedereen terug naar het begin
    await luke.tap("#btnResHome");
    for (const p of all) await waitScreen(p, "title", 10000);
    for (const p of others) assert(!(await p.page.evaluate(() => !!window.__kerst.session)), `${p.name}: sessie weg`);
    await zara.shot("99-einde");
  });
}

// ---------- runner ----------
async function main() {
  if (process.env.NODE_TEST_CONTEXT) { console.log("# e2e:kerst overgeslagen onder node --test — draai: npm run e2e:kerst"); return 0; }
  const SUITES = { solo, samen };
  const pick = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const unknown = pick.filter((n) => !SUITES[n]);
  if (unknown.length) { console.error("Onbekende suite:", unknown.join(", "), "— kies uit", Object.keys(SUITES).join(", ")); return 2; }
  const names = pick.length ? pick : Object.keys(SUITES);
  const env = await createEnv({ shots: SHOTS });
  const watchdog = setTimeout(() => { console.error("✗ e2e:kerst duurt te lang (> 10 min)"); process.exit(1); }, 10 * 60e3);
  watchdog.unref();
  let steps = 0, failed = null;
  env.step = async (name, fn) => {
    log("▶ " + name);
    const t = Date.now();
    try { await fn(); steps++; log(`  ✓ ${((Date.now() - t) / 1000).toFixed(1)}s`); }
    catch (e) { log("  ✗ " + e.message); await Promise.all(env.phones.map((p) => p.shot("FOUT"))); throw e; }
  };
  try {
    for (const n of names) { log(`===== kerst: ${n} =====`); await SUITES[n](env); }
  } catch (e) {
    failed = e;
    if (!(e && e.constructor && e.constructor.name === "TestError")) console.error(e);
  }
  await sleep(400);
  const errors = env.errors.slice();
  const loaded = new Set();
  for (const p of env.phones) for (const u of p.loaded || []) if (u.startsWith(env.origin)) loaded.add(u.slice(env.origin.length).split("?")[0]);
  await env.close();
  console.log("");
  console.log(`Stappen geslaagd: ${steps} · screenshots: ${SHOTS}`);
  console.log(`Geladen paden (${loaded.size}): ${[...loaded].sort().join(", ")}`);
  if (errors.length) console.log(`✗ ${errors.length} fout(en) in console/netwerk:\n  ` + errors.join("\n  "));
  else console.log("✓ geen console-fouten, geen 404's, geen mislukte verzoeken");
  if (failed) console.log("✗ MISLUKT: " + failed.message);
  else if (!errors.length) console.log("✓ e2e:kerst geslaagd");
  return failed || errors.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
