// E2E-tests met Playwright (Chromium, iPhone 13-viewport + touch) tegen een lokale MQTT-broker en statische server,
// beide op vrije poorten. Elke "telefoon" is een eigen browsercontext (eigen opslag), net als echte telefoons.
//   npm run e2e                       alle suites
//   npm run e2e -- infiltrant         alleen één suite (infiltrant | smoke)
//   E2E_SHOTS=<map> npm run e2e       screenshots van elke fase (standaard test-results/e2e/)
// Faalt bij elke mislukte stap én bij elke console-fout / pageerror op welke telefoon dan ook.
import { join } from "node:path";
import { createEnv, ROOT, log, sleep } from "./lib.mjs";
import infiltrant from "./infiltrant.mjs";
import smoke from "./smoke.mjs";

const SUITES = { infiltrant, smoke };

async function main() {
  if (process.env.NODE_TEST_CONTEXT) { // via `node --test` opgepikt: e2e draait alleen via npm run e2e
    console.log("# e2e overgeslagen onder node --test — draai: npm run e2e");
    return 0;
  }
  const pick = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const unknown = pick.filter((n) => !SUITES[n]);
  if (unknown.length) { console.error("Onbekende suite:", unknown.join(", "), "— kies uit", Object.keys(SUITES).join(", ")); return 2; }
  const names = pick.length ? pick : Object.keys(SUITES);
  const shots = process.env.E2E_SHOTS || join(ROOT, "test-results", "e2e");
  const env = await createEnv({ shots });
  const watchdog = setTimeout(() => { console.error("✗ e2e duurt te lang (> 12 min)"); process.exit(1); }, 12 * 60e3);
  watchdog.unref();
  let steps = 0, failed = null;
  env.step = async (name, fn) => {
    log("▶ " + name);
    const t = Date.now();
    try {
      await fn();
      steps++;
      log(`  ✓ ${((Date.now() - t) / 1000).toFixed(1)}s`);
    } catch (e) {
      log("  ✗ " + e.message);
      await Promise.all(env.phones.map((p) => p.shot("FOUT")));
      throw e;
    }
  };
  try {
    for (const n of names) {
      log(`===== ${n} =====`);
      await SUITES[n](env);
    }
  } catch (e) {
    failed = e;
    if (!(e && e.constructor && e.constructor.name === "TestError")) console.error(e);
  }
  await sleep(300); // late console-meldingen nog meenemen
  const errors = env.errors.slice();
  await env.close();
  console.log("");
  console.log(`Suites: ${names.join(", ")} · stappen geslaagd: ${steps} · screenshots: ${shots}`);
  if (errors.length) console.log(`✗ ${errors.length} console-fout(en):\n  ` + errors.join("\n  "));
  else console.log("✓ geen console-fouten");
  if (failed) console.log("✗ MISLUKT: " + failed.message);
  else if (!errors.length) console.log("✓ e2e geslaagd");
  return failed || errors.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
