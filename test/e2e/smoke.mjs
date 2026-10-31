// E2E smoke: de oude tools werken nog (vingerkiezer, rad, kaarten, teams, dobbelstenen) zonder console-fouten,
// geen horizontale scroll, en de service worker cachet ALLE runtime-bestanden (elk pad geeft 200) zonder MQTT te storen.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { ROOT, assert, eq, until, sleep, log } from "./lib.mjs";

// ASSETS + VERSION uit sw.js (zonder de service worker uit te voeren)
function swConfig() {
  const src = readFileSync(join(ROOT, "sw.js"), "utf8");
  const version = /const VERSION = "([^"]+)"/.exec(src);
  const assets = /const ASSETS = (\[[\s\S]*?\]);/.exec(src);
  assert(version && assets, "VERSION/ASSETS niet gevonden in sw.js");
  return { version: version[1], assets: vm.runInNewContext(assets[1]) };
}
// Alles wat de app tijdens het draaien laadt: index.html (scripts, css, preload, iconen, manifest), het manifest
// (iconen), fonts uit de css en scripts die ui.js zelf laadt (online/preview.js).
function runtimeFiles() {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const files = new Set(["./", "index.html"]);
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) if (!/^(https?:)?\/\//.test(m[1])) files.add(m[1]);
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.webmanifest"), "utf8"));
  for (const i of manifest.icons || []) files.add(i.src.replace(/^\.\//, ""));
  for (const css of [...files].filter((f) => f.endsWith(".css"))) {
    const dir = css.includes("/") ? css.slice(0, css.lastIndexOf("/") + 1) : "";
    for (const m of readFileSync(join(ROOT, css), "utf8").matchAll(/url\("?([^")]+)"?\)/g)) {
      if (m[1].startsWith("data:") || m[1].startsWith("#")) continue; // data-URI of SVG-id (url(#grad)) is geen bestand
      files.add(new URL(m[1], "http://x/" + dir).pathname.slice(1));
    }
  }
  const ui = readFileSync(join(ROOT, "online/ui.js"), "utf8");
  for (const m of ui.matchAll(/\.src = "([^"]+\.js)"/g)) files.add(m[1]);
  return [...files];
}

export default async function smoke(env) {
  const { step } = env;
  const p = await env.phone("Tools", { viewport: { width: 360, height: 740 } });
  const overflow = () => p.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

  await step("home: tegels, geen horizontale scroll (360/390/430 px, ook tijdens het wiebelende logo)", async () => {
    await p.goto(env.origin);
    await p.page.waitForSelector('[data-screen="home"].active .t-online');
    eq(await p.page.$$eval(".tiles .tile", (t) => t.length), 6, "6 tegels (Infiltrant + 5 tools)");
    eq(await p.page.getAttribute(".tiles .tile:first-child", "data-go"), "online", "Infiltrant-tegel bovenaan");
    for (const width of [360, 390, 430]) {
      await p.page.setViewportSize({ width, height: 740 });
      let max = 0;
      for (let i = 0; i < 16; i++) { max = Math.max(max, await overflow()); await sleep(100); } // logo-animatie duurt 3 s
      eq(max, 0, `home scrollt niet zijwaarts op ${width} px`);
    }
    await p.page.setViewportSize({ width: 360, height: 740 });
    await p.shot("20-home");
  });
  await step("vingerkiezer: twee vingers (multi-touch) → één winnaar", async () => {
    await p.tap('[data-go="finger"]');
    await p.page.waitForSelector('[data-screen="finger"].active #fingerHint');
    const cdp = await p.ctx.newCDPSession(p.page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 100, y: 330, id: 1 }, { x: 260, y: 520, id: 2 }] });
    await until(() => p.page.$$eval("#fingerArea .finger.win", (f) => f.length), { timeout: 6000, msg: "een vinger wint" });
    eq(await p.page.$$eval("#fingerArea .finger.lose", (f) => f.length), 1, "de andere vinger verliest");
    await p.shot("21-vingerkiezer");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await p.page.goBack();
  });
  await step("rad van fortuin: DRAAI → uitslag", async () => {
    await p.goto(env.origin + "#wheel");
    await p.page.waitForSelector('[data-screen="wheel"].active #spinBtn');
    await p.tap("#spinBtn");
    const res = await until(async () => { const t = (await p.text("#wheelResult")).trim(); return t.startsWith("🎉") && t; }, { timeout: 12000, msg: "rad stopt met een uitslag" });
    log("   rad:", res);
    eq(await overflow(), 0, "rad scrollt niet zijwaarts");
  });
  await step("kaartspel: tik → volgende kaart", async () => {
    await p.goto(env.origin + "#cards");
    await p.page.waitForSelector('[data-screen="cards"].active #card');
    const before = await p.text("#cardText");
    await p.tap("#card");
    await until(async () => (await p.text("#cardText")) !== before, { timeout: 4000, msg: "nieuwe kaart" });
  });
  await step("teams maken: Verdeel! → teams", async () => {
    await p.goto(env.origin + "#teams");
    await p.page.waitForSelector('[data-screen="teams"].active #makeTeams');
    await p.tap("#makeTeams");
    await until(() => p.page.$$eval("#teamsOut .team", (t) => t.length >= 2), { timeout: 4000, msg: "minstens 2 teams" });
  });
  await step("dobbelstenen: tik → worp", async () => {
    await p.goto(env.origin + "#dice");
    await p.page.waitForSelector('[data-screen="dice"].active #diceBoard');
    await p.tap("#diceBoard");
    await until(async () => /\d/.test(await p.text("#diceTotal")), { timeout: 4000, msg: "totaal van de worp" });
  });
  await step("#online en de preview-schermen scrollen niet zijwaarts (360 px)", async () => {
    await p.goto(env.origin + "#online");
    await p.page.waitForSelector('[data-screen="online"].active #olHome .o-brand');
    eq(await overflow(), 0, "#online");
    for (const ph of ["lobby-host", "reveal", "hints-myturn", "vote", "elim-infiltrant", "over-burgers"]) {
      await p.goto(`${env.origin}?preview=${ph}`);
      await p.page.waitForSelector('section[data-screen="room"].active .o-view');
      await sleep(300);
      eq(await overflow(), 0, "preview " + ph);
    }
  });

  await step("service worker: ASSETS bevat elk runtime-bestand en elk pad geeft 200", async () => {
    const { version, assets } = swConfig();
    assert(/^dva-v\d+$/.test(version), "VERSION " + version);
    const missing = runtimeFiles().filter((f) => !assets.includes(f));
    eq(missing, [], "runtime-bestanden die niet in sw.js ASSETS staan");
    for (const a of assets) {
      const res = await fetch(new URL(a, env.origin));
      eq(res.status, 200, "GET " + a);
    }
    log(`   ${version}: ${assets.length} assets, allemaal 200`);
  });
  await step("service worker installeert, cachet alles en laat MQTT met rust", async () => {
    const { version, assets } = swConfig();
    const sw = await env.phone("Offline", { serviceWorkers: "allow" });
    await sw.goto(sw.app("#online"));
    await sw.page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    const cached = await until(() => sw.page.evaluate(async (v) => {
      if (!(await caches.has(v))) return null;
      const keys = await (await caches.open(v)).keys();
      return keys.map((r) => new URL(r.url).pathname);
    }, version), { timeout: 15000, msg: "cache " + version });
    const want = assets.map((a) => new URL(a, "http://x/").pathname);
    eq(want.filter((x) => !cached.includes(x)), [], "assets die niet in de cache staan");
    // Pagina onder controle van de SW: een kamer maken via MQTT werkt gewoon
    await sw.page.reload();
    assert(await sw.page.evaluate(() => !!navigator.serviceWorker.controller), "pagina wordt door de service worker bediend");
    await sw.page.fill('#olHome [data-act="name"]', "Offline");
    await sw.tap('#olHome [data-act="create"]');
    await sw.waitPhase("lobby", 25000);
    await sw.tap('[data-act="leave"]');
    await sw.tap('[data-act="confirm"]');
    await sw.page.waitForSelector('section[data-screen="online"].active', { timeout: 10000 });
    // Offline openen: de app komt uit de cache
    await sw.ctx.setOffline(true);
    await sw.page.reload();
    await sw.page.waitForSelector('[data-screen="online"].active #olHome .o-brand', { timeout: 10000 });
    await sw.ctx.setOffline(false);
  });
}
