// Gedeelde hulpjes voor de e2e-tests: lokale broker + statische server op vrije poorten, Playwright-"telefoons"
// (iPhone 13, touch) met eigen opslag, console-fouten verzamelen en screenshots. Geen bijeffecten bij importeren.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startBroker } from "../../tools/broker.mjs";
import { serveStatic } from "../../tools/dev.mjs";

const require = createRequire(import.meta.url);
export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
export const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6) + "s ", ...a);

export class TestError extends Error {}
export function assert(ok, msg) { if (!ok) throw new TestError(msg); }
export function eq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new TestError(`${msg}: verwacht ${JSON.stringify(expected)}, kreeg ${JSON.stringify(actual)}`);
}

// Pollt `fn` (async) tot die iets truthy geeft → die waarde. Faalt met `msg` na `timeout` ms.
export async function until(fn, { timeout = 15000, interval = 100, msg = "voorwaarde" } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    if (Date.now() - t0 > timeout) throw new TestError(`time-out (${timeout} ms): ${msg}${last ? " — " + last.message.split("\n")[0] : ""}`);
    await sleep(interval);
  }
}

function playwright() {
  try { return require("playwright"); } catch (e) {
    throw new Error("Playwright niet gevonden: require('playwright') moet werken (globaal geïnstalleerd of via NODE_PATH).");
  }
}

const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Start broker + server + browser. → env met phone(), shot(), close() en de verzamelde fouten.
export async function createEnv({ shots } = {}) {
  const { chromium, devices } = playwright();
  const broker = await startBroker(0, { quiet: true });
  const bport = broker.wss.address().port;
  const web = await serveStatic(0, { host: null });
  const origin = `http://localhost:${web.port}/`;
  const brokerUrl = `ws://localhost:${bport}`;
  const browser = await chromium.launch();
  const iphone = Object.assign({}, devices["iPhone 13"]);
  delete iphone.defaultBrowserType; // we draaien Chromium met de iPhone-viewport, touch en UA
  const errors = [];
  const phones = [];
  if (shots) mkdirSync(shots, { recursive: true });

  // Een "telefoon": eigen browsercontext (eigen localStorage), touch, console-fouten → errors
  async function phone(name, { serviceWorkers = "block", clipboard = false, viewport } = {}) {
    const opts = Object.assign({}, iphone, { serviceWorkers });
    if (viewport) opts.viewport = viewport;
    const ctx = await browser.newContext(opts);
    if (clipboard) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await ctx.addInitScript(() => { try { localStorage.setItem("dva:iosHint", "true"); } catch (e) { /* */ } });
    const page = await ctx.newPage();
    const p = {
      name, ctx, page,
      app: (suffix = "") => `${origin}?broker=${brokerUrl}${suffix}`,
      async goto(url) { await page.goto(url); },
      phase: () => page.getAttribute('section[data-screen="room"]', "data-phase"),
      waitPhase: (ph, timeout = 20000) => page.waitForSelector(`section[data-screen="room"].active[data-phase="${ph}"]`, { timeout }),
      debug: () => page.evaluate(() => window.DVOnline.debug()),
      session: () => page.evaluate(() => JSON.parse(localStorage.getItem("dva:session") || "null")),
      hostRoom: () => page.evaluate(() => JSON.parse(localStorage.getItem("dva:hostRoom") || "null")),
      async pid() { const s = await p.session(); return s && s.pid; },
      tap: (sel, o) => page.tap(sel, o),
      // Invullen/toets: pas als het veld echt bruikbaar is (zichtbaar, niet in een `inert` verse fase)
      async fill(sel, text) {
        await page.waitForFunction((s) => { const el = document.querySelector(s); return el && el.offsetParent && !el.closest("[inert]") && !el.disabled; }, sel, { timeout: 10000 });
        await page.fill(sel, text);
      },
      async press(sel, key) {
        await page.waitForFunction((s) => { const el = document.querySelector(s); return el && !el.closest("[inert]") && !el.disabled; }, sel, { timeout: 10000 });
        await page.press(sel, key);
      },
      text: (sel) => page.textContent(sel),
      visible: (sel) => page.isVisible(sel),
      // Echt ingedrukt houden: muis (pointerType mouse) of touch via CDP (pointerType touch)
      async hold(sel, ms, { touch = false, during } = {}) {
        const loc = page.locator(sel);
        await loc.scrollIntoViewIfNeeded();
        // Wacht tot een vinger het element echt raakt (niet tijdens een View Transition of onder een sheet)
        const hit = await until(() => loc.evaluate((el) => {
          const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          const at = document.elementFromPoint(x, y);
          const vt = document.getAnimations().some((a) => a.effect && /view-transition/.test(a.effect.pseudoElement || ""));
          return at && el.contains(at) && !vt ? { x, y } : null;
        }), { timeout: 5000, msg: `${name}: ${sel} is niet aan te raken` });
        const { x, y } = hit;
        let cdp = null;
        if (touch) {
          cdp = await ctx.newCDPSession(page);
          await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        } else { await page.mouse.move(x, y); await page.mouse.down(); }
        let out;
        try { await sleep(ms); if (during) out = await during(); } finally {
          if (touch) { await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await cdp.detach(); }
          else await page.mouse.up();
        }
        return out;
      },
      async shot(label) {
        if (!shots) return;
        await page.screenshot({ path: join(shots, `e2e-${label}-${slug(name)}.png`) }).catch(() => {});
      },
    };
    page.on("console", (m) => { if (m.type() === "error") errors.push(`[${p.name}] console.error: ${m.text()}`); });
    page.on("pageerror", (e) => errors.push(`[${p.name}] pageerror: ${e.message}`));
    page.on("dialog", (d) => { errors.push(`[${p.name}] onverwachte dialog: ${d.message()}`); d.dismiss().catch(() => {}); });
    phones.push(p);
    return p;
  }

  async function close() {
    await browser.close().catch(() => {});
    await web.close().catch(() => {});
    await broker.close().catch(() => {});
  }
  return { origin, brokerUrl, browser, broker, errors, phones, phone, close, shots, devices };
}
