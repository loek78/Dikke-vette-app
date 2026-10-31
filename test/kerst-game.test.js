// Tests voor de KERSTDROOM-runner (kerst/game.js). Draai met: node --test test/kerst-game.test.js
// De Playwright-autopilot (echte browser, 30 s normaal + stoer, rAF p95) draait alleen met KERST_E2E=1.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const L = require("../kerst/level.js");
const Gm = require("../kerst/game.js");

const DT = Gm.DT;
const canvas = () => ({ width: 390, height: 844, getContext: () => null });

// Dezelfde autopilot als de e2e: leest obstaclesAhead en tikt/veegt. skip = obstakel (type@x) dat we bewust negeren.
function autopilot(st, g, skip) {
  if (st.phase === "fading") { g.input("tap"); return; }
  if (st.flying || st.sled) return;
  const v = st.speed;
  for (const o of st.obstaclesAhead) {
    if (o.x + o.w < st.x) continue;
    if (skip && skip(o)) continue;
    const d = o.x - st.x;
    const slide = o.needs === "slide" || o.alt === "slide";
    if (slide) { if (d > 0 && d < v * 0.3 && st.onGround && st.anim !== "slide") g.input("swipeDown"); }
    else if (d > 0 && d < v * 0.22 && st.onGround) g.input("tap");
    break;
  }
}
function make(opts, hooks) {
  const log = [];
  const g = Gm.create(canvas(), Object.assign({ seed: 7, difficulty: "normaal", hooks: Object.assign({
    onEvent: (id, d) => log.push({ t: +g.state.t.toFixed(3), id, d }),
    onEnd: (r) => log.push({ t: +g.state.t.toFixed(3), id: "END", r }),
  }, hooks || {}) }, opts || {}));
  g.start(null);
  return { g, log };
}
// Speel `secs` seconden met de autopilot (beslissingen op 60 Hz)
function play(g, secs, skip) {
  for (let i = 0; i < Math.round(secs * 60); i++) { const st = g.state; if (st.phase === "end") break; autopilot(st, g, skip); g.advance(1 / 60); }
  return g.state;
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} ≠ ${b} (±${tol})`);

test("module: exports, aanmaken zonder DOM, standaardwaarden", () => {
  assert.equal(typeof Gm.create, "function");
  assert.ok(Gm.PHYS.g > 0 && Gm.PHYS.jumpV > 0 && Gm.PHYS.coyote === 0.1 && Gm.PHYS.buffer === 0.12);
  assert.deepEqual(Object.keys(Gm.POWERUPS).sort(), ["dubbelsterren", "magneet", "rendiervlucht", "sleetje", "sneeuwbol", "snoepregen"]);
  for (const id of Object.keys(Gm.POWERUPS)) assert.ok(Gm.POWERUPS[id].dur >= 6 && Gm.POWERUPS[id].dur <= 10, id);
  assert.deepEqual(Object.keys(Gm.EVENTS).sort(), ["droomflip", "finale", "kerstman", "noorderlicht", "peperkoek", "rendiervlucht", "reuzenboom", "schaatsbaan", "sneeuwbol", "sneeuwpop", "snoepregen", "sterrenregen"]);
  assert.equal(Gm.EVENT_GAP, 10);
  const g = Gm.create(canvas(), {});
  const st = g.state;
  assert.equal(st.phase, "ready");
  assert.equal(st.difficulty, "normaal");
  assert.equal(st.animal, "hert");
  assert.equal(st.name, "Vlok", "de ree heet standaard Vlok");
  assert.equal(st.hearts, 3);
  assert.equal(Gm.create(canvas(), { animal: "uil" }).state.name, "Oeki");
  assert.equal(Gm.create(canvas(), { animal: "hert", fawnName: "Sneeuwvlokje" }).state.name, "Sneeuwvlokje");
  assert.equal(Gm.create(canvas(), { animal: "draak", difficulty: "insane" }).state.animal, "hert");
  assert.equal(Gm.create(canvas(), { difficulty: "insane" }).state.difficulty, "normaal");
  assert.equal(Gm.create(canvas(), { difficulty: "stoer" }).state.speed, L.DIFFS.stoer.v0);
  assert.equal(g.fx, null, "geen KerstFX in Node");
  assert.equal(typeof g.level.ensure, "function");
  g.destroy(); g.destroy();
  assert.equal(Gm.create(canvas()).state.phase, "ready", "opts is optioneel");
});

test("game.state heeft de afgesproken vorm", () => {
  const { g } = make();
  g.advance(1);
  let st = g.state;
  for (let i = 0; i < 20 * 60 && !st.obstaclesAhead.length; i++) { autopilot(st, g); g.advance(1 / 60); st = g.state; }
  const types = { x: "number", y: "number", speed: "number", stars: "number", hearts: "number", meters: "number", phase: "string", combo: "number", maxCombo: "number", paused: "boolean", t: "number", anim: "string", onGround: "boolean", flip: "number", theme: "string", candies: "number", bells: "number", gifts: "number", revived: "boolean", wishWindow: "boolean", droomster: "number", candyRain: "boolean", name: "string", animal: "string", difficulty: "string" };
  for (const k of Object.keys(types)) assert.equal(typeof st[k], types[k], k);
  assert.ok(st.powerup === null || typeof st.powerup.id === "string");
  assert.ok(st.event === null || typeof st.event.id === "string");
  assert.ok(st.countdown === null || typeof st.countdown === "number");
  assert.ok(st.prompt === null || typeof st.prompt === "string");
  assert.ok(Array.isArray(st.ghosts) && Array.isArray(st.obstaclesAhead));
  assert.ok(st.obstaclesAhead.length > 0, "er komt iets aan");
  for (const o of st.obstaclesAhead) {
    assert.ok(["log", "icicles", "snowman", "pinecone", "gap"].includes(o.type), o.type);
    for (const k of ["x", "w", "h", "dist"]) assert.equal(typeof o[k], "number", k);
    assert.ok(o.needs === "jump" || o.needs === "slide");
    near(o.dist, o.x - st.x, 1e-9, "dist");
  }
  for (let i = 1; i < st.obstaclesAhead.length; i++) assert.ok(st.obstaclesAhead[i].x >= st.obstaclesAhead[i - 1].x, "gesorteerd");
  assert.equal(st.theme, "nacht");
  assert.equal(st.phase, "run");
  assert.equal(st.meters, Math.round(st.x / L.METER));
});

test("botsingswiskunde", () => {
  assert.ok(Gm.overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }));
  assert.ok(!Gm.overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), "raken telt niet");
  assert.ok(!Gm.overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 10, w: 10, h: 10 }));
  assert.ok(!Gm.overlaps({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 11, w: 1, h: 1 }));
  const stand = Gm.playerBox(1000, 0, false), slide = Gm.playerBox(1000, 0, true);
  assert.ok(stand.h > slide.h && slide.w > stand.w, "glijden = lager en langer");
  assert.ok(stand.w < Gm.PLAYER_BOX.w, "hitbox is vergevingsgezind kleiner dan het dier");
  const log = Gm.obstacleBox({ x: 1000, w: 60, h: 44, y0: 0 });
  const icicles = Gm.obstacleBox({ x: 1000, w: 64, h: 160, y0: 72 });
  const snowman = Gm.obstacleBox({ x: 1000, w: 56, h: 50, y0: 42 });
  assert.ok(Gm.overlaps(stand, log) && Gm.overlaps(slide, log), "een stam raak je staand én glijdend");
  assert.ok(Gm.overlaps(stand, icicles) && !Gm.overlaps(slide, icicles), "ijspegels: alleen staand raak");
  assert.ok(Gm.overlaps(stand, snowman) && !Gm.overlaps(slide, snowman), "sneeuwpop: eronderdoor glijden mag");
  assert.ok(!Gm.overlaps(Gm.playerBox(1000, 50, false), log), "op 50 hoogte spring je over een stam");
  assert.ok(Gm.overlaps(Gm.playerBox(1000, 30, false), log), "op 30 hoogte nog niet");
  assert.ok(!Gm.overlaps(Gm.playerBox(1000, 100, false), snowman));
  assert.ok(!Gm.overlaps(Gm.playerBox(1000, 240, false), icicles), "hoog genoeg boven de ijspegels");
  assert.ok(!Gm.overlaps(Gm.playerBox(1100, 0, false), log), "ernaast");
  const wob = Gm.obstacleBox({ x: 1000, w: 56, h: 50, y0: 42 }, 10);
  assert.equal(wob.x, log.x + 2 + 10 - 0, "waggel verschuift de box");
  assert.deepEqual(Gm.playerCenter(10, 0, false), { x: 10, y: 45 });
  assert.deepEqual(Gm.playerCenter(10, 0, true), { x: 10, y: 22 });
});

test("sprong: hoogte ≈170, luchttijd ≈0,8 s; dubbele sprong hoger; uil klapwiekt", () => {
  const { g } = make({ seed: 1 });
  g.input("tap");
  let apex = 0, landed = null;
  for (let i = 1; i <= 240; i++) {
    g.advance(DT);
    const st = g.state;
    apex = Math.max(apex, st.y);
    if (landed === null && i > 2 && st.onGround) landed = i * DT;
  }
  near(apex, L.JUMP.height, 3, "apex");
  near(landed, L.JUMP.airTime, 0.03, "luchttijd");
  // Dubbele sprong op het hoogste punt
  const { g: g2 } = make({ seed: 1 });
  g2.input("tap"); g2.advance(0.4); g2.input("tap");
  let apex2 = 0;
  for (let i = 0; i < 200; i++) { g2.advance(DT); apex2 = Math.max(apex2, g2.state.y); }
  assert.ok(apex2 > apex + 100, `dubbele sprong ${apex2}`);
  // Derde tik in de lucht doet niets
  const { g: g3 } = make({ seed: 1 });
  g3.input("tap"); g3.advance(0.4); g3.input("tap"); g3.advance(0.2);
  const yBefore = g3.state.y; g3.input("tap"); g3.advance(0.05);
  assert.ok(g3.state.y < yBefore + 760 * 0.05, "geen derde sprong");
  // Uil: dubbele sprong = vliegen/zweven
  const { g: owl } = make({ seed: 1, animal: "uil" });
  owl.input("tap"); owl.advance(0.4); owl.input("tap"); owl.advance(0.1);
  assert.equal(owl.state.anim, "fly");
  const { g: deer } = make({ seed: 1, animal: "hert" });
  deer.input("tap"); deer.advance(0.4); deer.input("tap"); deer.advance(0.1);
  assert.equal(deer.state.anim, "jump");
  // swipeUp springt ook
  const { g: g4 } = make({ seed: 1 });
  g4.input("swipeUp"); g4.advance(0.1);
  assert.ok(g4.state.y > 40 && !g4.state.onGround);
});

test("invoerbuffer: tik net vóór de landing springt bij de landing", () => {
  const { g } = make({ seed: 1 });
  g.input("tap"); g.advance(0.4); g.input("tap"); // dubbel; landing ≈ 1,29 s
  g.advance(1.22 - 0.4);
  assert.ok(!g.state.onGround, "nog in de lucht");
  g.input("tap"); // 0,07 s te vroeg → gebufferd
  g.advance(0.2);
  assert.ok(!g.state.onGround && g.state.y > 30, `sprong bij landing (y=${g.state.y.toFixed(0)})`);
  // Te vroege tik (> 120 ms) vervalt
  const { g: g2 } = make({ seed: 1 });
  g2.input("tap"); g2.advance(0.4); g2.input("tap"); g2.advance(1.0 - 0.4);
  g2.input("tap"); // ≈0,29 s voor de landing
  g2.advance(0.4);
  assert.ok(g2.state.onGround, "vervallen tik springt niet");
});

test("coyote-tijd: net van de rand gelopen → springen mag nog", () => {
  // normaal, geen hulpje; zoek het eerste gat en loop er met de autopilot naartoe, maar spring NIET voor dit gat
  const { g, log } = make({ seed: 4 });
  g.level.ensure(30000);
  const gap = g.level.grounds.find((x) => x.kind === "gap");
  assert.ok(gap, "level heeft een gat");
  const skip = (o) => o.type === "gap" && Math.abs(o.x - gap.x0) < 1;
  let st = g.state;
  for (let i = 0; i < 60 * 60 && !(st.x > gap.x0 + 6 && !st.onGround); i++) { autopilot(st, g, skip); g.advance(DT); st = g.state; }
  assert.ok(st.x > gap.x0 && st.x < gap.x0 + 40 && !st.onGround && st.y <= 0, `van de rand (x=${(st.x - gap.x0).toFixed(1)} na de rand)`);
  g.advance(0.05); // binnen 100 ms
  g.input("tap"); g.advance(0.1);
  assert.ok(g.state.y > 20, `coyote-sprong (y=${g.state.y.toFixed(0)})`);
  play(g, 1.5, skip);
  assert.equal(g.state.hearts, 3, "veilig overgesprongen");
  assert.ok(!log.some((e) => e.id === "hurt"));
});

test("in een gat vallen: plons, hartje kwijt, verder op de overkant", () => {
  const { g, log } = make({ seed: 4 });
  g.level.ensure(30000);
  const gap = g.level.grounds.find((x) => x.kind === "gap");
  const skip = (o) => o.type === "gap" && Math.abs(o.x - gap.x0) < 1;
  let st = g.state;
  for (let i = 0; i < 60 * 60 && st.x < gap.x1 + 200; i++) { autopilot(st, g, skip); g.advance(1 / 60); st = g.state; }
  assert.equal(st.hearts, 2);
  const h = log.find((e) => e.id === "hurt");
  assert.ok(h && h.d.reason === "gap", JSON.stringify(h));
  assert.ok(st.x >= gap.x1, "aan de overkant neergezet");
  assert.equal(st.phase, "run");
});

test("obstakels raken: struikelen, hartjes, sterren vallen, onkwetsbaar; wakker worden → tik → verder dromen → einde", () => {
  const { g, log } = make({ seed: 3, difficulty: "stoer" }); // geen hulpje, niets doen
  let st = g.state, firstHit = null, starsBefore = 0;
  for (let i = 0; i < 120 * 60 && st.hearts === 3; i++) { starsBefore = st.stars; g.advance(1 / 60); st = g.state; }
  assert.equal(st.hearts, 2);
  firstHit = st.t;
  assert.equal(st.anim, "stumble");
  assert.ok(st.invuln, "even onkwetsbaar");
  assert.ok(st.stars <= starsBefore, "sterren vallen (of er waren er geen)");
  assert.equal(st.combo, 0);
  // Binnen 1,5 s geen tweede hartje kwijt
  g.advance(1.2);
  assert.ok(g.state.hearts === 2, "onkwetsbaarheid");
  const hurts = log.filter((e) => e.id === "hurt");
  for (let i = 1; i < hurts.length; i++) assert.ok(hurts[i].t - hurts[i - 1].t >= Gm.PHYS.invuln - 1e-6);
  // Door naar 0 hartjes
  for (let i = 0; i < 120 * 60 && g.state.phase === "run"; i++) g.advance(1 / 60);
  st = g.state;
  assert.equal(st.phase, "fading");
  assert.equal(st.hearts, 0);
  assert.equal(st.prompt, "Tik om verder te dromen");
  const xFade = st.x;
  g.advance(1);
  assert.ok(g.state.x - xFade < st.speed * 0.5, "slow motion");
  assert.equal(g.state.phase, "fading", "wacht op de tik");
  g.input("tap"); g.advance(DT);
  st = g.state;
  assert.equal(st.phase, "run");
  assert.equal(st.hearts, 3);
  assert.equal(st.revived, true);
  assert.equal(st.prompt, null);
  assert.ok(log.some((e) => e.id === "revive"));
  // Tweede keer 0 hartjes → zacht einde
  for (let i = 0; i < 180 * 60 && g.state.phase !== "end"; i++) { if (g.state.phase === "fading") g.input("tap"); g.advance(1 / 60); }
  st = g.state;
  assert.equal(st.phase, "end");
  const end = log.find((e) => e.id === "END");
  assert.ok(end, "onEnd aangeroepen");
  assert.equal(log.filter((e) => e.id === "END").length, 1, "onEnd precies één keer");
  const r = end.r;
  for (const k of ["stars", "meters", "maxCombo", "powerups", "events", "candies", "bells", "gifts", "hearts", "revived", "jumps", "maxHeight", "duration", "name", "animal", "difficulty", "seed"]) assert.ok(k in r, k);
  assert.ok(Array.isArray(r.events) && Array.isArray(r.powerupList));
  assert.equal(r.revived, true);
  assert.equal(r.hearts, 0);
  assert.equal(r.meters, Math.round(st.x / L.METER));
  assert.deepEqual(st.result, r);
  const xEnd = st.x; g.advance(2);
  assert.equal(g.state.x, xEnd, "na het einde beweegt niets meer");
  assert.ok(firstHit > 0);
});

test("wakker worden zonder tik: na 8 s eindigt de droom", () => {
  const { g, log } = make({ seed: 3, difficulty: "stoer" });
  for (let i = 0; i < 120 * 60 && g.state.phase !== "fading"; i++) g.advance(1 / 60);
  assert.equal(g.state.phase, "fading");
  g.advance(Gm.PHYS.fadeTimeout + 0.5);
  assert.equal(g.state.phase, "end");
  assert.equal(log.filter((e) => e.id === "END").length, 1);
});

test("testhaak game.hurt(reason, force): hartjes af, door het schild heen, 0 → 'Tik om verder te dromen' → einde", () => {
  const { g, log } = make({ seed: 7 });
  g.advance(1);
  assert.equal(g.hurt("test"), 2, "één hartje kwijt");
  assert.equal(g.hurt("test"), 2, "zonder force telt de onkwetsbaarheid");
  assert.equal(g.hurt("test", true), 1, "force negeert de onkwetsbaarheid");
  g.grantPowerup("sneeuwbol");
  assert.equal(g.state.powerup.id, "sneeuwbol");
  assert.equal(g.hurt("test", true), 0, "force gaat ook door de sneeuwbol heen");
  assert.equal(g.state.powerup, null, "schild weg");
  assert.equal(g.state.phase, "fading");
  assert.equal(g.state.prompt, "Tik om verder te dromen");
  g.input("tap"); g.advance(DT);
  assert.equal(g.state.phase, "run");
  assert.equal(g.state.hearts, 3);
  for (let i = 0; i < 3; i++) g.hurt("test", true);
  assert.equal(g.state.phase, "ending", "tweede keer: de droom vervaagt");
  g.advance(3);
  assert.equal(g.state.phase, "end");
  assert.equal(log.filter((e) => e.id === "END").length, 1, "onEnd precies één keer");
  assert.equal(log.filter((e) => e.id === "hurt").length, 6, "elke echte klap meldt zich via onEvent");
  assert.equal(g.state.dpr, 1, "zonder DOM blijft de canvas-schaal 1");
});

test("autopilot haalt 45 s zonder hartjes te verliezen (normaal, stoer, makkelijk)", () => {
  for (const difficulty of ["normaal", "stoer", "makkelijk"]) {
    for (const seed of [0, 1, 2, 3, "RIVKA"]) {
      const { g, log } = make({ seed, difficulty });
      const st = play(g, 45);
      assert.equal(st.hearts, 3, `${difficulty} seed ${seed}: ${log.filter((e) => e.id === "hurt").map((e) => e.d.reason)}`);
      assert.ok(st.meters >= 200, `${difficulty} seed ${seed}: ${st.meters} m`);
      assert.ok(st.stars > 10, "sterren verzameld");
      assert.ok(st.maxCombo >= 3);
    }
  }
});

test("makkelijk: auto-spring hulpje zonder enige invoer haalt alle spring-obstakels", () => {
  const { g, log } = make({ seed: 5, difficulty: "makkelijk" });
  for (let i = 0; i < 40 * 60; i++) g.advance(1 / 60); // helemaal niets doen
  const reasons = log.filter((e) => e.id === "hurt").map((e) => e.d.reason);
  assert.ok(!reasons.includes("log") && !reasons.includes("gap") && !reasons.includes("pinecone") && !reasons.includes("snowman"), `geraakt: ${reasons}`);
  assert.ok(g.state.meters > 200);
});

test("ijspegels: blijft laag zolang er iets boven je hangt (dubbele rij)", () => {
  // zoek een stoer-level met een dubbele ijspegelrij en speel er met één veeg onderdoor
  let found = null;
  for (let seed = 0; seed < 30 && !found; seed++) {
    const lv = L.generate(seed, "stoer"); lv.ensure(14000);
    const o = lv.obstacles.find((x) => x.type === "icicles" && x.n === 2 && x.x < 12000);
    if (o) found = { seed, o };
  }
  assert.ok(found, "dubbele ijspegelrij gevonden");
  const { g, log } = make({ seed: found.seed, difficulty: "stoer" });
  let st = g.state, slidingAtExit = null;
  for (let i = 0; i < 90 * 60 && st.x < found.o.x + found.o.w / 2 + 300; i++) {
    autopilot(st, g); g.advance(1 / 60); st = g.state;
    if (slidingAtExit === null && st.x > found.o.x + found.o.w / 2) slidingAtExit = st.anim;
  }
  assert.equal(st.hearts, 3, `geraakt: ${log.filter((e) => e.id === "hurt").map((e) => e.d.reason)}`);
  assert.equal(slidingAtExit, "slide", "nog aan het glijden bij het verlaten van de rij");
});

test("dennenappel valt als je dichtbij komt (zichtbaar in obstaclesAhead.state)", () => {
  let found = null;
  for (let seed = 0; seed < 40 && !found; seed++) {
    const lv = L.generate(seed, "normaal"); lv.ensure(14000);
    const o = lv.obstacles.find((x) => x.type === "pinecone" && x.x < 12000);
    if (o) found = { seed, o };
  }
  assert.ok(found);
  const { g } = make({ seed: found.seed });
  const states = new Set();
  let st = g.state;
  for (let i = 0; i < 90 * 60 && st.x < found.o.x + 200; i++) {
    const p = st.obstaclesAhead.find((x) => x.type === "pinecone" && Math.abs(x.x + x.w / 2 - found.o.x) < 1);
    if (p) states.add(p.state);
    autopilot(st, g); g.advance(1 / 60); st = g.state;
  }
  assert.ok(states.has("hang") && states.has("fall") && states.has("landed"), [...states].join(","));
  assert.equal(st.hearts, 3);
});

test("power-ups: timer, ring-waarden, vervanging", () => {
  const { g, log } = make({ seed: 1 });
  g.grantPowerup("dubbelsterren");
  let pw = g.state.powerup;
  assert.equal(pw.id, "dubbelsterren"); assert.equal(pw.total, 10); near(pw.left, 10, 1e-9);
  assert.equal(pw.icon, Gm.POWERUPS.dubbelsterren.icon);
  play(g, 4);
  near(g.state.powerup.left, 6, 0.05, "na 4 s");
  g.grantPowerup("magneet");
  assert.equal(g.state.powerup.id, "magneet", "vervangt");
  near(g.state.powerup.left, 10, 1e-9);
  play(g, 10.2);
  assert.equal(g.state.powerup, null, "afgelopen");
  assert.ok(log.filter((e) => e.id === "powerup").length === 2);
  assert.ok(g.state.result === null);
  const { g: g2 } = make({ seed: 1 }); g2.grantPowerup("onzin");
  assert.equal(g2.state.powerup, null);
});

test("dubbelsterren verdubbelt de sterren", () => {
  const { g: a } = make({ seed: 2 }); const { g: b } = make({ seed: 2 });
  b.grantPowerup("dubbelsterren");
  const sa = play(a, 6), sb = play(b, 6);
  assert.ok(sa.stars > 0);
  assert.equal(sb.stars, sa.stars * 2);
});

test("sneeuwbol: één botsing opgevangen, geen hartje kwijt", () => {
  const { g, log } = make({ seed: 3, difficulty: "stoer" });
  g.grantPowerup("sneeuwbol");
  for (let i = 0; i < 20 * 60 && g.state.powerup; i++) g.advance(1 / 60); // niets doen tot de bol knapt
  assert.equal(g.state.powerup, null, "bol geknapt");
  assert.equal(g.state.hearts, 3);
  assert.ok(!log.some((e) => e.id === "hurt"));
});

test("sleetje: sneller, zweeft, onkwetsbaar, zachte landing", () => {
  const { g, log } = make({ seed: 3, difficulty: "stoer" });
  const v0 = g.state.speed;
  g.grantPowerup("sleetje");
  g.advance(2);
  assert.equal(g.state.sled, true);
  assert.ok(g.state.speed > v0 * 1.3, `boost ${g.state.speed}`);
  near(g.state.y, Gm.PHYS.sledHover, 2, "zweefhoogte");
  g.advance(6.5); // niets doen: zonder sleetje zou je stammen raken
  assert.equal(g.state.sled, false);
  assert.equal(g.state.powerup, null);
  assert.ok(!log.some((e) => e.id === "hurt" && e.t < 8), "geen botsing tijdens het sleetje");
  g.advance(0.6);
  assert.ok(g.state.onGround, "geland");
});

test("rendiervlucht: opstijgen, klapwieken, veilig landen", () => {
  const { g, log } = make({ seed: 3, difficulty: "stoer" });
  g.grantPowerup("rendiervlucht");
  g.advance(1.5);
  assert.equal(g.state.flying, true);
  assert.ok(g.state.y > 150, `hoog (${g.state.y.toFixed(0)})`);
  assert.equal(g.state.anim, "fly");
  const y1 = g.state.y;
  g.input("tap"); g.advance(0.25);
  assert.ok(g.state.y > y1 - 40, "klapwieken remt het vallen");
  const stars0 = g.state.stars;
  g.advance(9);
  assert.equal(g.state.flying, false);
  g.advance(1.5);
  assert.ok(g.state.onGround);
  assert.ok(!log.some((e) => e.id === "hurt"), "niets geraakt tijdens/na de vlucht");
  assert.ok(g.state.stars >= stars0, "sterrensporen in de lucht");
});

test("magneet trekt sterren aan (meer sterren dan zonder)", () => {
  const { g: a } = make({ seed: 6 }); const { g: b } = make({ seed: 6 });
  b.grantPowerup("magneet");
  const sa = play(a, 9), sb = play(b, 9);
  assert.ok(sb.stars > sa.stars, `${sb.stars} > ${sa.stars}`);
});

test("snoepregen: via power-up meldt onCandyRain, via triggerEvent niet (extern)", () => {
  let rain = 0;
  const { g, log } = make({ seed: 1 }, { onCandyRain: () => rain++ });
  g.grantPowerup("snoepregen");
  assert.equal(rain, 1);
  assert.equal(g.state.candyRain, true);
  play(g, 3);
  assert.ok(g.state.candies > 0, "snoepjes gevangen");
  play(g, 4);
  assert.equal(g.state.candyRain, false);
  const { g: g2, log: log2 } = make({ seed: 1 }, { onCandyRain: () => rain++ });
  assert.equal(g2.triggerEvent("snoepregen", { by: "Rivka" }), true);
  assert.equal(rain, 1, "extern → niet opnieuw rondsturen");
  assert.equal(g2.state.candyRain, true);
  const ev = log2.find((e) => e.id === "snoepregen");
  assert.ok(ev && ev.d.external === true && ev.d.by === "Rivka");
  assert.equal(g2.state.event, null, "snoepregen bezet het event-slot niet");
  assert.ok(log.length >= 1);
});

test("events van buiten: thema's, droomflip, sterrenregen-wens, vervanging", () => {
  const { g, log } = make({ seed: 1 });
  g.advance(0.5);
  assert.equal(g.triggerEvent("peperkoek"), true);
  assert.equal(g.state.theme, "peperkoek");
  assert.equal(g.state.event.id, "peperkoek");
  near(g.state.event.total, 15, 1e-9);
  assert.equal(log.find((e) => e.id === "peperkoek").d.external, true);
  assert.equal(g.triggerEvent("onzin"), false);
  // extern vervangt het lopende event
  assert.equal(g.triggerEvent("droomflip"), true);
  assert.equal(g.state.event.id, "droomflip");
  assert.equal(g.state.theme, "nacht", "peperkoek netjes afgesloten");
  assert.equal(g.state.flip, 0);
  play(g, 3);
  assert.ok(g.state.flip > 0.9, `omgekeerd (${g.state.flip.toFixed(2)})`);
  play(g, 8);
  assert.equal(g.state.event, null);
  assert.ok(g.state.flip < 0.1, `terug (${g.state.flip.toFixed(2)})`);
  // sterrenregen: wens-venster en +25
  const { g: g2, log: log2 } = make({ seed: 1 });
  g2.triggerEvent("sterrenregen");
  let sawWindow = false;
  for (let i = 0; i < 2.0 * 60 && !g2.state.wishWindow; i++) { g2.advance(1 / 60); }
  sawWindow = g2.state.wishWindow;
  assert.ok(sawWindow, "wensvenster opent");
  const before = g2.state.stars;
  g2.input("tap"); g2.advance(DT);
  assert.ok(g2.state.stars >= before + Gm.SCORE.wish, "wens = +25 ⭐");
  assert.ok(log2.some((e) => e.id === "wens" && e.d.stars === 25));
  assert.equal(g2.state.wishWindow, false, "één wens per vallende ster");
  // noorderlicht → aurora, sneeuwbol vult een hartje
  const { g: g3 } = make({ seed: 3, difficulty: "stoer" });
  for (let i = 0; i < 60 * 60 && g3.state.hearts === 3; i++) g3.advance(1 / 60);
  assert.equal(g3.state.hearts, 2);
  g3.triggerEvent("sneeuwbol");
  assert.equal(g3.state.hearts, 3);
  g3.triggerEvent("noorderlicht");
  assert.equal(g3.state.theme, "aurora");
});

test("eventplanning: mijlpaal op 80 m, nooit twee tegelijk, ≥10 s rust, afwisseling", () => {
  for (const [seed, difficulty] of [[7, "normaal"], [11, "stoer"], [2, "makkelijk"]]) {
    const { g, log } = make({ seed, difficulty });
    const starts = []; let prev = null;
    for (let i = 0; i < 150 * 60; i++) {
      const st = g.state;
      const id = st.event ? st.event.id : null;
      if (id !== prev) {
        if (prev && starts.length) starts[starts.length - 1].end = st.t; // (ook bij een directe overgang A→B)
        if (id) starts.push({ id, t: st.t, end: null });
        prev = id;
      }
      autopilot(st, g); g.advance(1 / 60);
    }
    assert.ok(starts.length >= 6, `${difficulty}: ${starts.length} events`);
    const first = starts[0];
    assert.equal(first.id, "noorderlicht");
    const atMeters = log.find((e) => e.id === "noorderlicht").d.milestone;
    assert.equal(atMeters, 80);
    const ids = new Set(starts.map((s) => s.id));
    assert.ok(ids.size >= 4, `afwisseling: ${[...ids]}`);
    for (let i = 1; i < starts.length; i++) {
      const a = starts[i - 1], b = starts[i];
      assert.ok(a.end !== null && b.t >= a.end - 1e-6, `${difficulty}: ${a.id} en ${b.id} overlappen`);
      if (a.id !== "schaatsbaan" && b.id !== "schaatsbaan") assert.ok(b.t - a.end >= Gm.EVENT_GAP - 0.05, `${difficulty}: ${a.id}→${b.id} ${(b.t - a.end).toFixed(1)} s`);
    }
    // schaatsbaan alleen op het ijs; onEvent voor elk event precies één keer
    for (const e of log.filter((x) => Gm.EVENTS[x.id])) assert.equal(e.d.external, undefined);
    assert.equal(log.filter((e) => e.id === "noorderlicht").length, 1);
    const r = g.state;
    assert.ok(r.hearts === 3, `${difficulty}: autopilot gezond`);
  }
});

test("schaatsbaan: begint bij het betreden van de vijver, driedubbele sterren", () => {
  let found = null;
  for (let seed = 0; seed < 30 && !found; seed++) {
    const lv = L.generate(seed, "normaal"); lv.ensure(20000);
    const p = lv.grounds.find((x) => x.kind === "pond");
    if (p && p.x0 < 16000) found = { seed, p };
  }
  assert.ok(found);
  const { g, log } = make({ seed: found.seed });
  let st = g.state, starsIn = 0, starsBefore = null;
  for (let i = 0; i < 120 * 60 && st.x < found.p.x1 + 100; i++) {
    autopilot(st, g); g.advance(1 / 60); st = g.state;
    if (st.onPond && starsBefore === null) starsBefore = st.stars;
    if (st.onPond) starsIn = st.stars - starsBefore;
  }
  assert.ok(log.some((e) => e.id === "schaatsbaan"), "schaatsbaan-event");
  assert.ok(starsIn >= 9, `op het ijs ${starsIn} ⭐ (×3)`);
});

test("multiplayer-run van 90 s: finale in de laatste 10 s, einde op 90 s", () => {
  const { g, log } = make({ seed: 8, durationSec: 90 });
  let finaleAt = null;
  for (let i = 0; i < 100 * 60 && g.state.phase !== "end"; i++) { const st = g.state; if (st.phase === "finale" && finaleAt === null) finaleAt = st.t; autopilot(st, g); g.advance(1 / 60); }
  assert.equal(g.state.phase, "end");
  near(finaleAt, 80, 0.05, "finale start");
  near(g.state.t, 90, 0.05, "einde");
  const fin = log.find((e) => e.id === "finale");
  assert.ok(fin && Array.isArray(fin.d.names) && fin.d.names[0] === "Vlok");
  const end = log.find((e) => e.id === "END");
  assert.ok(end && end.r.events.includes("finale"));
  near(end.r.duration, 90, 0.1);
  // geen gewoon event begint na 68 s (zou de finale raken)
  for (const e of log.filter((x) => Gm.EVENTS[x.id] && x.id !== "finale")) assert.ok(e.t <= 90 - 22 + 1e-6, `${e.id} op ${e.t}`);
  // extern 'finale' (droomster vol) start de finale eerder
  const { g: g2 } = make({ seed: 8, durationSec: 90 });
  play(g2, 20);
  g2.triggerEvent("finale", { names: ["Luke", "Viola", "Rivka", "Zara"] });
  assert.equal(g2.state.phase, "finale");
  assert.equal(g2.state.event.id, "finale");
  g2.setDroomster(1); assert.equal(g2.state.droomster, 1);
  g2.setDroomster(7); assert.equal(g2.state.droomster, 1);
});

test("solo: elke 500 m vuurwerk", () => {
  const { g, log } = make({ seed: 7, difficulty: "stoer" });
  play(g, 70);
  const fins = log.filter((e) => e.id === "finale");
  assert.ok(fins.length >= 1, "minstens één finale na 500 m");
  assert.ok(fins[0].d.solo === true && fins[0].d.meters === 500);
  assert.ok(g.state.phase === "run");
});

test("geesten: interpolatie, naamplaatjes, verdwijnen", () => {
  const { g } = make({ seed: 1 });
  g.setGhosts([{ pid: "a", name: "Luke", animal: "vos", x: 500, y: 0, anim: "run", stars: 3, hearts: 3 }, { pid: "b", name: "Zara", animal: "konijn", x: 100, y: 50 }]);
  let gh = g.state.ghosts;
  assert.equal(gh.length, 2);
  assert.deepEqual(gh.map((x) => x.name), ["Luke", "Zara"]);
  assert.equal(gh[0].x, 500);
  assert.equal(gh[1].animal, "konijn");
  g.advance(0.2);
  g.setGhosts([{ pid: "a", name: "Luke", animal: "vos", x: 560, y: 0 }]);
  g.advance(0.1);
  gh = g.state.ghosts;
  assert.equal(gh.length, 1, "Zara weg");
  assert.ok(gh[0].x > 500 && gh[0].x < 700, `glijdt naar het doel (${gh[0].x.toFixed(0)})`);
  g.advance(1);
  assert.ok(gh[0].x < g.state.ghosts[0].x, "beweegt door op geschatte snelheid");
  g.setGhosts(null);
  assert.deepEqual(g.state.ghosts, []);
  g.setGhosts([{ pid: "c", animal: "draak" }]);
  assert.equal(g.state.ghosts[0].animal, "hert");
  assert.equal(g.state.ghosts[0].name, "?");
});

test("hooks: onPos elke 200 ms, onStats bij veranderingen", () => {
  const pos = [], stats = [];
  const { g } = make({ seed: 1 }, { onPos: (p) => pos.push(p), onStats: (s) => stats.push(s) });
  play(g, 2.0);
  assert.ok(pos.length >= 9 && pos.length <= 11, `onPos ${pos.length}×`);
  for (const p of pos) { for (const k of ["x", "y", "anim", "stars", "hearts", "meters", "t"]) assert.ok(k in p, k); assert.ok(p.pw === null || typeof p.pw === "string"); }
  assert.ok(pos[1].x > pos[0].x);
  assert.ok(stats.length >= 2);
  assert.ok("stars" in stats[0] && "hearts" in stats[0] && "phase" in stats[0]);
});

test("pauze en hervatten (3-2-1), aftellen bij start, tapMoon-geheimpje", () => {
  const { g } = make({ seed: 1 });
  play(g, 1);
  const x = g.state.x;
  g.pause();
  assert.equal(g.state.paused, true);
  g.advance(1);
  assert.equal(g.state.x, x, "stilgezet");
  g.input("tap"); g.advance(0.5);
  assert.equal(g.state.x, x);
  g.resume();
  assert.equal(g.state.paused, false);
  assert.equal(g.state.countdown, 3);
  g.advance(0.5); // testhelper slaat het aftellen over
  assert.ok(g.state.x > x);
  // start met toekomstig tijdstip → aftellen
  const g2 = Gm.create(canvas(), { seed: 1 });
  g2.start(performance.now() + 2000);
  assert.equal(g2.state.phase, "countdown");
  assert.ok(g2.state.countdown > 1.5 && g2.state.countdown <= 2);
  g2.advance(0.1);
  assert.equal(g2.state.phase, "run");
  // geheimpje: 3× op de maan tikken in de lobby → kerstmuts
  const g3 = Gm.create(canvas(), { seed: 1 });
  assert.equal(g3.state.hat, null);
  g3.input("tapMoon"); g3.input("tapMoon");
  assert.equal(g3.state.hat, null);
  g3.input("tapMoon");
  assert.equal(g3.state.hat, "kerstmuts");
  g3.start(null); g3.input("tapMoon");
  assert.equal(g3.state.hat, "kerstmuts");
  assert.equal(Gm.create(canvas(), { hat: "kerstmuts" }).state.hat, "kerstmuts");
  // start() is eenmalig, destroy stopt invoer
  g3.start(null); g3.destroy(); g3.input("tap");
  assert.equal(g3.triggerEvent("peperkoek"), false);
});

test("determinisme: zelfde seed + zelfde invoer = zelfde run (ook events en resultaten)", () => {
  const run = () => { const { g, log } = make({ seed: "BAKO", difficulty: "stoer" }); const st = play(g, 50); return { st, log }; };
  const a = run(), b = run();
  assert.equal(a.st.x, b.st.x);
  assert.equal(a.st.stars, b.st.stars);
  assert.equal(a.st.hearts, b.st.hearts);
  assert.deepEqual(a.log, b.log);
  assert.deepEqual(a.st.obstaclesAhead, b.st.obstaclesAhead);
  const c = make({ seed: "BAKU", difficulty: "stoer" });
  play(c.g, 50);
  assert.notEqual(c.g.state.x, a.st.x);
});

test("bellen: melodie-combo telt op en reset bij een gemiste bel", () => {
  // bells1 is een intro-chunk: zoek een seed waar hij als 2e chunk komt
  let seed = null;
  for (let s = 0; s < 60 && seed === null; s++) { const lv = L.generate(s, "normaal"); lv.ensure(3000); if (lv.chunks[1].id === "bells1") seed = s; }
  assert.ok(seed !== null);
  const { g } = make({ seed });
  const lv = g.level; lv.ensure(3000);
  const bells = lv.items.filter((i) => i.kind === "bell");
  assert.equal(bells.length, 4);
  let st = g.state, maxCombo = 0;
  for (let i = 0; i < 20 * 60 && st.x < bells[3].x + 50; i++) { autopilot(st, g); g.advance(1 / 60); st = g.state; maxCombo = Math.max(maxCombo, st.bellCombo); }
  assert.equal(maxCombo, 4);
  assert.equal(st.bells, 4);
  g.advance(1.5);
  assert.equal(g.state.bellCombo, 4, "nog niets gemist");
});

// ---------- Playwright-autopilot (echte Chromium): KERST_E2E=1 ----------
const E2E = process.env.KERST_E2E === "1";
test("e2e: 30 s autopilot in Chromium (normaal + stoer), ≥200 m, geen console-fouten, rAF p95", { skip: !E2E && "zet KERST_E2E=1 voor de browsertest", timeout: 180000 }, async () => {
  const { chromium } = require("playwright");
  const { serveStatic } = await import("../tools/dev.mjs");
  const root = path.join(__dirname, "..");
  const srv = await serveStatic(0, { root, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${srv.port}/`;
  const optional = ["kerst/art.js", "kerst/effects.js", "kerst/fx.js", "kerst/audio.js"].filter((f) => process.env.KERST_E2E_ART !== "0" && fs.existsSync(path.join(root, f)));
  const shotsDir = process.env.KERST_SHOTS || "";
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
  const scripts = ["kerst/level.js", ...optional, "kerst/game.js"].map((f) => `<script src="${base}${f}"></script>`).join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style></head>
<body><canvas id="c"></canvas>${scripts}
<script>
window.__frames = []; (function rec(){ let last = performance.now(); function f(t){ window.__frames.push(t - last); last = t; requestAnimationFrame(f); } requestAnimationFrame(f); })();
window.__boot = function (difficulty, seed) {
  const events = [];
  const game = KerstGame.create(document.getElementById("c"), { seed, difficulty, animal: "hert", name: "Rivka", drawText: true,
    hooks: { onEvent: (id, d) => events.push({ id, t: game.state.t }), onEnd: () => events.push({ id: "END" }) } });
  window.__kerst = { game, get state() { return game.state; }, events };
  game.start(null);
  const ghosts = [["p1","Luke","vos"],["p2","Viola","uil"],["p3","Zara","konijn"],["p4","Papa","hert"]];
  function tick() {
    const st = game.state;
    if (st.phase === "end") return;
    if (st.phase === "fading") game.input("tap");
    else if (!st.flying && !st.sled) {
      const v = st.speed;
      for (const o of st.obstaclesAhead) {
        if (o.x + o.w < st.x) continue;
        const d = o.x - st.x;
        const slide = o.needs === "slide" || o.alt === "slide";
        if (slide) { if (d > 0 && d < v * 0.3 && st.onGround && st.anim !== "slide") game.input("swipeDown"); }
        else if (d > 0 && d < v * 0.22 && st.onGround) game.input("tap");
        break;
      }
    }
    // 4 geesten die rond de speler rennen
    game.setGhosts(ghosts.map(([pid, name, animal], i) => ({ pid, name, animal, x: st.x + Math.sin(st.t * 0.7 + i) * 220 - 60, y: Math.max(0, Math.sin(st.t * 3 + i) * 120), anim: "run", stars: i * 7, hearts: 3 })));
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
};
</script></body></html>`;
  const browser = await chromium.launch();
  try {
    for (const difficulty of ["normaal", "stoer"]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(([d, s]) => window.__boot(d, s), [difficulty, 2024]);
      await page.waitForTimeout(5000);
      await page.evaluate(() => { window.__frames.length = 0; window.__kerst.game.triggerEvent("snoepregen", { by: "Zara" }); });
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `e2e-${difficulty}-snoepregen.png`) });
      await page.waitForTimeout(25000);
      const r = await page.evaluate(() => {
        const fr = window.__frames.slice().sort((a, b) => a - b);
        const st = window.__kerst.state;
        return { meters: st.meters, stars: st.stars, hearts: st.hearts, phase: st.phase, p95: fr[Math.floor(fr.length * 0.95)] || 0, p50: fr[Math.floor(fr.length * 0.5)] || 0, frames: fr.length, events: window.__kerst.events.map((e) => e.id) };
      });
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `e2e-${difficulty}-30s.png`) });
      const os = require("node:os");
      const load = os.loadavg()[0], cores = os.cpus().length || 1;
      console.log(`e2e ${difficulty}:`, JSON.stringify(r), optional.length ? `(met ${optional.join(", ")})` : "(fallback-tekening)", `load ${load.toFixed(1)}/${cores} cores`);
      assert.deepEqual(errors, [], `${difficulty}: console-fouten`);
      assert.ok(r.meters >= 200, `${difficulty}: ${r.meters} m`);
      assert.ok(r.phase === "run" || r.phase === "finale", r.phase);
      assert.ok(r.frames > 600, "rAF liep");
      // rAF p95 ≤ 20 ms (SPEC-4 §7). Op een overbelaste machine (load > 1,5× cores) zegt de meting niets: dan alleen rapporteren.
      const limit = process.env.KERST_P95_MS ? +process.env.KERST_P95_MS : 20;
      if (load > cores * 1.5) console.log(`  (p95 ${r.p95.toFixed(1)} ms niet beoordeeld: machine overbelast)`);
      else assert.ok(r.p95 <= limit, `${difficulty}: rAF p95 ${r.p95.toFixed(1)} ms`);
      await page.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
