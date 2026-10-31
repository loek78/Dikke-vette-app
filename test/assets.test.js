// Platformcontrole (SPEC-3 §7): de scriptvolgorde in index.html, en sw.js die élk runtime-bestand cachet onder VERSION dva-v3.
// De e2e-smoke controleert daarnaast dat elk asset ook echt met 200 wordt geserveerd.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f === "./" ? "index.html" : f));

function swConfig() {
  const src = read("sw.js");
  const version = /const VERSION = "([^"]+)"/.exec(src);
  const assets = /const ASSETS = (\[[\s\S]*?\]);/.exec(src);
  assert.ok(version && assets, "VERSION/ASSETS niet gevonden in sw.js");
  return { version: version[1], assets: Array.from(vm.runInNewContext(assets[1])) }; // Array.from: eigen Array.prototype, niet die van de vm-context
}
const scripts = () => [...read("index.html").matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
// Alles wat de app tijdens het draaien laadt: index.html (scripts, css, preload, iconen, manifest), het manifest (iconen),
// url() uit de css (fonts) en scripts die ui.js zelf bijlaadt (online/preview.js).
function runtimeFiles() {
  const html = read("index.html");
  const files = new Set(["./", "index.html"]);
  for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) if (!/^(https?:)?\/\//.test(m[1])) files.add(m[1]);
  const manifest = JSON.parse(read("manifest.webmanifest"));
  for (const i of manifest.icons || []) files.add(i.src.replace(/^\.\//, ""));
  for (const css of [...files].filter((f) => f.endsWith(".css"))) {
    const dir = css.includes("/") ? css.slice(0, css.lastIndexOf("/") + 1) : "";
    for (const m of read(css).matchAll(/url\("?([^")]+)"?\)/g)) {
      if (m[1].startsWith("data:") || m[1].startsWith("#")) continue;
      files.add(new URL(m[1], "http://x/" + dir).pathname.slice(1));
    }
  }
  for (const m of read("online/ui.js").matchAll(/\.src = "([^"]+\.js)"/g)) files.add(m[1]);
  return [...files];
}
const MINIS = fs.readdirSync(path.join(ROOT, "online/minis")).filter((f) => f.endsWith(".js") && f !== "core.js").map((f) => "online/minis/" + f).sort();

test("index.html laadt de scripts in de volgorde van SPEC-3 §7", () => {
  const list = scripts();
  const minis = list.filter((s) => /^online\/minis\/(?!core\.js)/.test(s));
  assert.deepEqual(minis.slice().sort(), MINIS, "alle minigames staan in index.html");
  const want = ["data.js", "data-vuur.js", "vendor/mqtt.min.js", "vendor/qrcode.js", "fire.js", "online/words.js", "online/room.js",
    "online/engine.js", "online/minis/core.js", ...minis, "online/story.js", "online/story-engine.js", "online/arcade.js",
    "online/net.js", "app.js", "online/story-ui.js", "online/arcade-ui.js", "online/ui.js"];
  assert.deepEqual(list, want);
  const at = (f) => list.indexOf(f);
  // De afhankelijkheden die ertoe doen: DVRoom vóór de engines, de DVMini-registry vóór de minigames en de engines,
  // app.js (window.DVA) en de spel-UI's vóór ui.js.
  assert.ok(at("online/room.js") < at("online/story-engine.js") && at("online/room.js") < at("online/arcade.js"));
  assert.ok(at("online/minis/core.js") < Math.min(...minis.map(at)) && Math.max(...minis.map(at)) < at("online/story-engine.js"));
  assert.ok(at("online/story.js") < at("online/story-engine.js"));
  assert.ok(at("app.js") < at("online/story-ui.js") && at("online/story-ui.js") < at("online/arcade-ui.js") && at("online/arcade-ui.js") < at("online/ui.js"));
  assert.match(read("index.html"), /<link rel="stylesheet" href="online\/story\.css">/);
});

test("de engines krijgen hun context: ctx.story = DV_STORY en ctx.minis = DVMini in de host-loop", () => {
  const ui = read("online/ui.js");
  assert.match(ui, /story: window\.DV_STORY, minis: window\.DVMini/);
  assert.match(ui, /DVRoom\.carryFrom\(/, "spelwissel via carry");
  assert.match(ui, /DVStoryUI\b/);
  assert.match(ui, /DVArcadeUI\b/);
});

test("sw.js: VERSION dva-v3, ASSETS dekt elk runtime-bestand en elk asset bestaat", () => {
  const { version, assets } = swConfig();
  assert.equal(version, "dva-v3");
  assert.equal(new Set(assets).size, assets.length, "geen dubbele assets");
  const missing = runtimeFiles().filter((f) => !assets.includes(f));
  assert.deepEqual(missing, [], "runtime-bestanden die niet in sw.js ASSETS staan");
  for (const mini of MINIS) assert.ok(assets.includes(mini), mini + " in ASSETS");
  for (const f of ["online/room.js", "online/story.js", "online/story-engine.js", "online/arcade.js", "online/story-ui.js", "online/arcade-ui.js", "online/story.css"]) {
    assert.ok(assets.includes(f), f + " in ASSETS");
  }
  const absent = assets.filter((a) => !exists(a));
  assert.deepEqual(absent, [], "assets die niet bestaan");
  assert.ok(!assets.some((a) => a.startsWith("kerst/")), "kerst/ heeft z'n eigen pagina en hoort niet in deze cache");
});
