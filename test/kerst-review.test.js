// Tests uit de kindertest/review van KERSTDROOM: grond vóór de start, hartje terug na sterren, het makkelijk-hulpje voor
// ijspegels en te vroege sprongen, fx.end bij vervangen events, en de wachttijd op de uitslag (net.js).
// Draai met: node --test test/kerst-review.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../kerst/level.js");
const Gm = require("../kerst/game.js");
const FX = require("../kerst/effects.js");
const Net = require("../kerst/net.js");

const canvas = () => ({ width: 390, height: 844, getContext: () => null });
function make(opts, hooks) {
  const log = [];
  const g = Gm.create(canvas(), Object.assign({ seed: 7, difficulty: "normaal", hooks: Object.assign({ onEvent: (id, d) => log.push({ t: +g.state.t.toFixed(3), id, d }) }, hooks || {}) }, opts || {}));
  g.start(null);
  return { g, log };
}
// Speel zonder enige invoer `secs` seconden (wakker worden → tik)
function idle(g, secs) {
  for (let i = 0; i < Math.round(secs * 60); i++) { const st = g.state; if (st.phase === "end") break; if (st.phase === "fading") g.input("tap"); g.advance(1 / 60); }
  return g.state;
}
// Eerste obstakel van een type vooruit (world x van de linkerrand)
function firstAhead(g, type, maxX) {
  const lvl = g.level; lvl.ensure(maxX);
  for (const o of lvl.obstacles) if (o.type === type && o.x > 200) return o;
  return null;
}
// Dezelfde autopilot als de e2e (springt/bukt netjes)
function autopilot(st, g) {
  if (st.phase === "fading") { g.input("tap"); return; }
  if (st.flying || st.sled) return;
  const v = st.speed;
  for (const o of st.obstaclesAhead) {
    if (o.x + o.w < st.x) continue;
    const d = o.x - st.x, slide = o.needs === "slide" || o.alt === "slide";
    if (slide) { if (d > 0 && d < v * 0.3 && st.onGround && st.anim !== "slide") g.input("swipeDown"); }
    else if (d > 0 && d < v * 0.22 && st.onGround) g.input("tap");
    break;
  }
}
// Ren zonder invoer tot `x` en voer dan `fn` uit
function runTo2(g, x, fn) {
  for (let i = 0; i < 60 * 60; i++) { if (g.state.x >= x) break; g.advance(1 / 60); }
  if (fn) fn();
}
// Ren (met autopilot, zodat je er heelhuids komt) tot `x` en voer dan `fn` uit
function runTo(g, x, fn) {
  for (let i = 0; i < 60 * 60; i++) { const st = g.state; if (st.x >= x) break; autopilot(st, g); g.advance(1 / 60); }
  if (fn) fn();
}

test("grond en bos staan er al tijdens het aftellen (level is vooraf gegenereerd)", () => {
  const g = Gm.create(canvas(), { seed: 3 });
  assert.equal(g.state.phase, "ready");
  assert.ok(g.level.grounds.length > 0 && g.level.endX >= 4000, "grond tot minstens 4000 units vóór de eerste stap");
  assert.ok(g.level.grounds[0].x0 === 0 && g.level.grounds[0].kind === "snow", "begint op sneeuw");
});

test("hartje terug: na HEAL_STARS sterren sinds de botsing, nooit boven 3, teller reset bij een nieuwe botsing", () => {
  const { g, log } = make({ seed: 11 });
  g.advance(1);
  assert.equal(g.hurt("test", true), 2, "één hartje kwijt");
  assert.equal(g.state.healStars, 0);
  // sterren erbij zonder te rennen: via het testhaakje grantPowerup? nee — we simuleren met echte pickups: ren door
  let healed = log.filter((e) => e.id === "hartje").length;
  assert.equal(healed, 0);
  const st0 = g.state;
  for (let i = 0; i < 60 * 60 && g.state.hearts < 3; i++) { const st = g.state; if (st.phase === "fading") g.input("tap"); // autopilot (zelfde als de e2e)
    const v = st.speed; for (const o of st.obstaclesAhead) { if (o.x + o.w < st.x) continue; const d = o.x - st.x; const slide = o.needs === "slide" || o.alt === "slide"; if (slide) { if (d > 0 && d < v * 0.3 && st.onGround && st.anim !== "slide") g.input("swipeDown"); } else if (d > 0 && d < v * 0.22 && st.onGround) g.input("tap"); break; }
    g.advance(1 / 60); }
  const st1 = g.state;
  assert.equal(st1.hearts, 3, `hartje terug na sterren (⭐ ${st0.stars} → ${st1.stars})`);
  assert.ok(st1.stars - st0.stars >= Gm.HEAL_STARS, `minstens ${Gm.HEAL_STARS} sterren gepakt (${st1.stars - st0.stars})`);
  assert.equal(log.filter((e) => e.id === "hartje").length, 1, "één 'hartje'-event");
  assert.equal(st1.heals, 1);
  assert.equal(st1.healStars, 0, "met volle hartjes wordt niets opgespaard");
  // nog 100 sterren met volle hartjes → geen extra heal, en na een botsing begint de teller op 0
  g.hurt("test", true);
  assert.equal(g.state.healStars, 0);
  assert.equal(g.state.hearts, 2);
});

test("makkelijk: zonder enige invoer worden óók ijspegels gebukt (geen hartje kwijt in 40 s, 3 seeds)", () => {
  // drie seeds met een ijspegelrij binnen de eerste 8000 units (≈ 33 s op makkelijk)
  const seeds = [];
  for (let s = 1; s < 80 && seeds.length < 3; s++) { const p = Gm.create(canvas(), { seed: s, difficulty: "makkelijk" }); if (firstAhead(p, "icicles", 8000) && firstAhead(p, "icicles", 8000).x < 8000) seeds.push(s); }
  assert.equal(seeds.length, 3, "drie seeds met ijspegels gevonden");
  for (const seed of seeds) {
    const { g, log } = make({ seed, difficulty: "makkelijk" });
    const ice = firstAhead(g, "icicles", 8000);
    const st = idle(g, 40);
    assert.equal(st.hearts, 3, `seed ${seed}: 3 hartjes na 40 s zonder invoer (hurt: ${log.filter((e) => e.id === "hurt").map((e) => e.d.reason).join(",")})`);
    assert.ok(st.x > ice.x + 100, `seed ${seed}: voorbij de eerste ijspegels (${st.x | 0} > ${ice.x | 0})`);
  }
  // normaal: zonder invoer loop je er wél tegenaan
  const { g, log } = make({ seed: 5, difficulty: "normaal" });
  idle(g, 40);
  assert.ok(log.some((e) => e.id === "hurt"), "normaal zonder invoer: botsingen");
});

test("makkelijk: te vroeg gesprongen en op een stam landen → dubbele sprong cadeau (normaal: botsing)", () => {
  const seed = 9;
  for (const [diff, expectHit] of [["makkelijk", false], ["normaal", true]]) { // elke moeilijkheid heeft zijn eigen level
    const { g, log } = make({ seed, difficulty: diff });
    const log0 = firstAhead(g, "log", 12000);
    assert.ok(log0, `${diff}: er is een stam`);
    // spring als de stam nog 0,55 s weg is: de sprong (0,8 s) landt dan precies óp de stam
    runTo(g, log0.x - 700, null);
    const v = g.state.speed;
    const jumpAt = log0.x - log0.w / 2 - v * 0.55;
    runTo2(g, jumpAt, () => g.input("tap"));
    for (let i = 0; i < 60 * 3; i++) { if (g.state.x > log0.x + 200) break; g.advance(1 / 60); }
    const hit = log.some((e) => e.id === "hurt");
    assert.equal(hit, expectHit, `${diff}: ${expectHit ? "botsing verwacht" : "gered door het hulpje"} (hurt: ${log.filter((e) => e.id === "hurt").map((e) => e.d.reason).join(",") || "-"})`);
  }
});

test("makkelijk: te vroeg gesprongen bij het beekje → dubbele sprong, geen plons (normaal: plons)", () => {
  const seed = 2;
  for (const [diff, expectHit] of [["makkelijk", false], ["normaal", true]]) {
    const { g, log } = make({ seed, difficulty: diff });
    g.level.ensure(20000);
    const gap = g.level.grounds.find((s) => s.kind === "gap" && s.x0 > 300);
    assert.ok(gap, `${diff}: er is een beekje`);
    runTo(g, gap.x0 - 700, null); // netjes tot vlak voor het beekje (met de autopilot), dan zonder hulp verder
    const v = g.state.speed;
    runTo2(g, gap.x0 - v * 0.42, () => g.input("tap")); // 0,42 s te vroeg: landing midden in het beekje
    // in het beekje vallen = onder de grondlijn komen (y < 0) boven het gat; gered = altijd boven de grond blijven
    let minY = 99;
    for (let i = 0; i < 60 * 3; i++) { const x0 = g.state.x; if (x0 > gap.x1 + 150) break; g.advance(1 / 60); const st = g.state; if (st.x > gap.x0 - 30 && st.x < gap.x1 + 60) minY = Math.min(minY, st.y); }
    const fell = minY < -30;
    assert.equal(fell, expectHit, `${diff}: ${expectHit ? "plons verwacht" : "gered door een dubbele sprong"} (laagste punt boven het beekje: ${minY.toFixed(0)}; hurt: ${log.filter((e) => e.id === "hurt").map((e) => e.d.reason).join(",") || "-"})`);
    if (!expectHit) assert.ok(!log.some((e) => e.id === "hurt" && e.d.reason === "gap"), "makkelijk: geen plons");
  }
});

test("fx.end(id): een vervangen event stopt ook in KerstFX (thema terug naar nacht)", () => {
  const fx = FX.create(null, { seed: 1 });
  assert.equal(typeof fx.end, "function");
  fx.trigger("peperkoek", {});
  fx.update(0.1, { cam: { x: 0, y: 0 }, w: 390, h: 844, player: { x: 0, y: 0 }, speed: 0, t: 0 });
  assert.equal(fx.theme, "peperkoek");
  fx.end("peperkoek");
  assert.equal(fx.theme, "nacht");
  assert.deepEqual(fx.events, []);
  fx.end("peperkoek"); // idempotent
  // en vanuit het spel: extern event vervangt het lopende → fx volgt
  const g = Gm.create(canvas(), { seed: 4 });
  g.start(null); g.advance(7);
  g.triggerEvent("peperkoek", {});
  assert.equal(g.state.event.id, "peperkoek");
  g.triggerEvent("sneeuwbol", {});
  assert.equal(g.state.event.id, "sneeuwbol");
  assert.equal(g.state.theme, "nacht", "peperkoek-palet is weg zodra het event vervangen is");
});

test("net: resultsWaitMs wacht tot de run voorbij is (+ gratie), daarna hooguit RESULTS_WAIT_MS", () => {
  const st = { startAt: 1000000, durationSec: 90, phase: "run" };
  // eerste uitslag na 20 s: wachten tot 90 s + gratie
  assert.equal(Net.resultsWaitMs(st, 1000000 + 20000), 70000 + Net.RESULTS_GRACE_MS);
  // eerste uitslag na het einde: de standaard wachttijd op laatkomers
  assert.equal(Net.resultsWaitMs(st, 1000000 + 91000), Net.RESULTS_WAIT_MS);
  // zonder startAt: standaard
  assert.equal(Net.resultsWaitMs({}, 5), Net.RESULTS_WAIT_MS);
  assert.equal(Net.resultsWaitMs(null, 5), Net.RESULTS_WAIT_MS);
  assert.equal(Net.resultsWaitMs({ startAt: 0, durationSec: 25 }, 1000), Math.max(Net.RESULTS_WAIT_MS, 24000 + Net.RESULTS_GRACE_MS));
});
