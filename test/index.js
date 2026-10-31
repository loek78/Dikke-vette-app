// `node --test test/` (zoals in de spec) behandelt de map op Node 22 als één module en draait dan dit bestand:
// het laadt alle unit-tests uit test/ en online/minis/__tests__/. `npm test` gebruikt globs en slaat dit bestand over.
// De e2e-tests (test/e2e/) draaien alleen via `npm run e2e`.
"use strict";
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

const dirs = [__dirname, join(__dirname, "..", "online", "minis", "__tests__")];
for (const dir of dirs) {
  let files = [];
  try { files = readdirSync(dir); } catch (e) { continue; }
  for (const f of files.filter((n) => /\.test\.(c?js|mjs)$/.test(n)).sort()) {
    import(pathToFileURL(join(dir, f)).href).catch((e) => { console.error(e); process.exitCode = 1; });
  }
}
