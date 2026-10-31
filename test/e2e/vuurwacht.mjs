// E2E Vuurwacht: twee telefoons ("Loek" + "Jacques", iPhone 13, touch) spelen het HELE verhaal via de echte schermen
// tegen een lokale broker, daarna de vuur-uit-en-opnieuw-route, een derde telefoon, Infiltrant en de arcade.
//  1) eén-knop-start: home "Speel samen" → naam → kamer; de tweede telefoon opent de deellink zonder profiel → naam → lobby;
//     spelkiezer: Vuurwacht aanbevolen voor 2, Infiltrant uit ("Vanaf 3 spelers"); niet-host ziet de keuze alleen-lezen.
//  2) het hele verhaal: scènes door te tikken, keuzes (één verdeeld → muntworp), lokale minigames via DVMini.testFinish (&test),
//     bijl écht gespeeld met synthetische tikken (20 s), slot opgelost via de echte ringen met de aanwijzingen van de gids
//     (def.solve + def._solution als orakel), echo met een echte convergentie in 2 rondes, verhaal met echte vlammen;
//     herladen midden in een scène (Jacques), midden in een lokale minigame (host) en midden in echo (Jacques); einde "Legende".
//  3) pittig + slechte resultaten → "Het vuur is uit" → host probeert opnieuw (checkpoint) → terug naar de lobby.
//  4) Sanne komt erbij → Infiltrant beschikbaar → wissel (spelers/keys/acks gaan mee) → één potje tot de uitslag → lobby →
//     arcade → één minigame met z'n drieën → uitslag en stand (scores van Infiltrant tellen door) → kamer sluiten.
// De geheime host-state leest de test uit dva:hostRoom, net als de host-telefoon zelf.
import { createRequire } from "node:module";
import { assert, eq, until, sleep, log } from "./lib.mjs";

const require = createRequire(import.meta.url);
const DV_STORY = require("../../online/story.js");
require("../../online/minis/core.js");
const SLOT = require("../../online/minis/slot.js");

const IN = (sel) => `#olHome ${sel}`;
const READY = '.sv-root [data-act="ready"]';
// Stemplan per keuze (index per telefoon [Loek, Jacques]); "fles" is bewust verdeeld → muntworp.
const PLAN = { belofte: [0, 0], bijl: [1, 1], kleed: [0, 0], kist: [0, 0], mist: [0, 0], aanbod: [1, 1], fles: [0, 1] };
// Sterke resultaten voor de lokale minigames die niet "echt" gespeeld worden (vorm: zie score() van de minigame).
const GOOD = { blaasbalg: { total: 24, hits: 24, perfect: 22, misses: 0, stray: 0, combo: 24 }, vonken: { caught: 18, missed: 1, big: 2, combo: 9 }, snel: { times: [180, 200, 170] } };
const BAD = { blaasbalg: { total: 24, hits: 0, perfect: 0, misses: 24 }, bijl: { logs: 0, perfect: 0, misses: 20 } };

export default async function vuurwacht(env) {
  const { step } = env;
  const loek = await env.phone("Loek", { clipboard: true });
  const jacques = await env.phone("Jacques");
  let sanne = null;
  const duo = [loek, jacques];
  const all = () => duo.concat(sanne ? [sanne] : []);
  const S = () => until(async () => { const r = await loek.hostRoom(); return r && r.state; }, { msg: "host-state lezen" });
  const keyOf = (st) => `${st.phase}:${st.chapter}:${st.step}`;
  const shots = (label, who) => Promise.all((who || duo).map((p) => p.shot(label)));
  const once = new Set();
  const shotOnce = async (label, who) => { if (once.has(label)) return; once.add(label); await shots(label, who); };
  const stepDef = (st) => (DV_STORY.chapters[st.chapter] && DV_STORY.chapters[st.chapter].steps[st.step]) || null;
  async function enter(p) { p.pidv = await p.pid(); assert(p.pidv, `${p.name}: geen sessie`); }
  const byPid = (pid) => all().find((p) => p.pidv === pid);

  // ---------- verhaal-hulpjes ----------
  // Telefoon toont dezelfde stap als de host (publieke state én de verhaal-UI)
  async function synced(p, st) {
    await until(async () => {
      const d = await p.debug();
      if (!d.pub || d.pub.phase !== st.phase || d.pub.chapter !== st.chapter || d.pub.step !== st.step) return false;
      return p.page.$eval(".sv-root", (r) => r.dataset.phase, ).catch(() => null).then((ph) => ph === st.phase);
    }, { timeout: 20000, msg: `${p.name} toont ${keyOf(st)}` });
  }
  // Door de regels tikken tot "Klaar ✓" kan (scène, vuur-stap), of gewoon wachten tot de knop actief is (muntworp).
  async function readUntilReady(p) {
    for (let i = 0; i < 60; i++) {
      const s = await p.page.evaluate((sel) => { const b = document.querySelector(sel); return !b ? "none" : b.hidden ? "hidden" : b.disabled ? "off" : "on"; }, READY);
      if (s === "on") return;
      if (s === "hidden") throw new Error(`${p.name} kijkt alleen mee`);
      if (s === "off" && (await p.page.$(".sv-root .sv-dlg"))) await p.tap(".sv-root .sv-dlg");
      await sleep(s === "none" ? 200 : 60);
    }
    throw new Error(`${p.name}: Klaar-knop wordt niet actief`);
  }
  async function ready(p) { await readUntilReady(p); await p.tap(READY); }
  const readyAll = () => Promise.all(duo.map(ready));
  const moved = (key) => until(async () => { const st = await S(); return keyOf(st) !== key ? st : null; }, { timeout: 40000, msg: "verder na " + key });
  async function finishLocal(result, who) {
    for (const p of who || duo) {
      await until(() => p.page.evaluate((r) => window.DVMini.testFinish(r), result), { timeout: 15000, msg: `${p.name}: testFinish` });
    }
  }
  const miniMounted = (p, nonce) => p.page.waitForFunction((n) => { const a = window.DVMini.active; return !!(a && a.nonce === n && document.querySelector(".sv-minirun")); }, nonce, { timeout: 20000 });
  const hudFire = (p) => p.page.$eval(".sv-hud .sv-fire-n b", (b) => +b.textContent).catch(() => null);

  // Bijl écht spelen: Start, aftellen, dan tikken zodra de naald in het vak staat (via het testhaakje root._bijl), 20 s lang.
  async function playBijl(p) {
    await p.page.waitForSelector(".sv-minirun .bj .bj-btn", { timeout: 15000 });
    await p.tap(".sv-minirun .bj .bj-btn");
    await p.page.waitForFunction(() => { const r = document.querySelector(".bj"); return r && r._bijl && r._bijl.phase === "play"; }, null, { timeout: 15000 });
    if (p === loek) await p.shot("25-mini-bijl-spel");
    const out = await p.page.evaluate(() => new Promise((resolve) => {
      const root = document.querySelector(".bj"), B = root._bijl, t0 = performance.now();
      let taps = 0;
      const tick = () => {
        if (!root.isConnected || B.phase !== "play") return resolve({ taps, ms: performance.now() - t0, result: B.result() });
        const z = B.zone, n = B.needle;
        if (!B.busy && z && Math.abs(n - z.c) <= z.w * 0.3) {
          root.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "touch", isPrimary: true }));
          taps++;
        }
        requestAnimationFrame(tick);
      };
      tick();
    }));
    assert(out.ms >= 3000 && out.taps >= 3, `${p.name}: bijl echt gespeeld (${out.taps} tikken in ${Math.round(out.ms)} ms)`);
    log(`   ${p.name}: bijl ${out.taps} klappen, ${out.result.logs} blokken, ${out.result.perfect} perfect, ${out.result.misses} mis`);
    return out.result;
  }
  // Slot: de gids leest zijn aanwijzingen (tekst in de UI = aanwijzingen in de host-state), samen leveren ze precies één code op
  // (def.solve) die gelijk is aan def._solution; de ander draait de ringen via de pijltjes en probeert.
  async function playSlot(st) {
    const roles = st.mini.roles;
    const slotP = duo.find((p) => roles[p.pidv] === "slot"), gidsP = duo.find((p) => roles[p.pidv] === "gids");
    assert(slotP && gidsP, "rollen slot + gids verdeeld: " + JSON.stringify(roles));
    log(`   slot: ${slotP.name} draait, ${gidsP.name} leest voor`);
    for (const p of duo) await p.tap(".sv-minirun .sl .sl-btn");
    await slotP.page.waitForFunction(() => { const r = document.querySelector(".sl"); return r && r._slot && r._slot.phase === "play"; }, null, { timeout: 15000 });
    await gidsP.page.waitForSelector(".sl .sl-clues .sl-clue", { timeout: 15000 });
    const shared = (await S()).miniShared;
    const shown = await gidsP.page.$$eval(".sl .sl-clues .sl-clue", (li) => li.map((x) => x.dataset.clue));
    eq(shown, shared.hold[gidsP.pidv].map((id) => shared.clues[id].text), "gids ziet precies zijn aanwijzingen");
    const code = SLOT._solution(shared);
    eq(SLOT.solve(shared.clues.map((c) => c.spec), shared.rep), [code], "de aanwijzingen leiden samen tot precies één code: de oplossing");
    assert(!(await slotP.page.$(".sl .sl-clues")), "het slot ziet geen aanwijzingen");
    await Promise.all([slotP.shot("29-mini-slot-slot"), gidsP.shot("29-mini-slot-gids")]);
    const cur = await slotP.page.evaluate(() => document.querySelector(".sl")._slot.rings);
    for (let k = 0; k < 4; k++) {
      const diff = (((code[k] - cur[k]) % 6) + 6) % 6, up = diff <= 3, n = up ? diff : 6 - diff;
      for (let i = 0; i < n; i++) { await slotP.tap(`.sl .sl-rings .sl-ring:nth-child(${k + 1}) .sl-arr:${up ? "first-of-type" : "last-of-type"}`); await sleep(140); }
    }
    await until(() => slotP.page.evaluate((c) => JSON.stringify(document.querySelector(".sl")._slot.rings) === JSON.stringify(c), code), { msg: "ringen staan op de code" });
    await until(async () => JSON.stringify((await S()).miniShared.rings) === JSON.stringify(code), { msg: "host kent de ringstand" });
    await slotP.tap(".sl .sl-try");
    await until(async () => { const sh = (await S()).miniShared; return !sh || sh.done; }, { msg: "slot open" });
  }
  // Echo: ronde 1 verschillende woorden, Jacques herlaadt met zijn woord ingeleverd, ronde 2 hetzelfde woord → de Mist trekt op.
  async function echoWord(p, w) {
    await p.page.waitForFunction(() => { const r = document.querySelector(".ec"), f = r && r.querySelector(".ec-form"); return !!(r && r._echo && r._echo.phase === "play" && !r._echo.busy && f && f.style.display !== "none"); }, null, { timeout: 20000 });
    await p.fill(".ec .ec-form input", w);
    await p.press(".ec .ec-form input", "Enter");
  }
  async function playEcho() {
    for (const p of duo) await p.tap(".sv-minirun .ec .ec-btn");
    await Promise.all(duo.map((p) => p.page.waitForFunction(() => { const r = document.querySelector(".ec"); return r && r._echo && r._echo.phase === "play"; }, null, { timeout: 15000 })));
    await echoWord(jacques, "kachel");
    await until(async () => { const sh = (await S()).miniShared; return sh && typeof sh.cur[jacques.pidv] === "string"; }, { msg: "woord van Jacques bij de host" });
    await jacques.page.reload();
    await jacques.waitPhase("mini", 20000);
    await jacques.page.waitForFunction(() => { const r = document.querySelector(".ec"); return r && r._echo && r._echo.phase === "play"; }, null, { timeout: 20000 });
    eq((await jacques.text(".ec .ec-lock strong")).trim(), "kachel", "Jacques herlaadt midden in echo: zijn woord staat nog vast");
    await shots("31-mini-echo-wachten");
    await echoWord(loek, "vuur");
    await until(async () => { const sh = (await S()).miniShared; return sh && sh.rounds.length === 1; }, { msg: "ronde 1 onthuld" });
    eq((await S()).miniShared.rounds[0].match, false, "ronde 1: verschillende woorden, geen match");
    await sleep(1600);
    await shots("32-mini-echo-onthulling");
    await echoWord(loek, "hout");
    await echoWord(jacques, "hout");
    // De engine rondt de minigame af in dezelfde stap als het laatste woord (miniShared is dan al leeg): kijk naar de uitslag.
    const r = await until(async () => { const s = await S(); return s.phase === "miniResult" && s.miniResult ? s.miniResult : null; }, { msg: "echo klaar" });
    eq([r.id, r.logs], ["echo", 3], "op één lijn in ronde 2 = 3 blokken");
    assert(r.lines.some((l) => /ronde 2/.test(l)), "uitslag noemt ronde 2: " + JSON.stringify(r.lines));
  }
  // Verhaal: om de beurt vertellen (Klaar na 3 s opwarmen), de ander geeft 3 vlammen.
  async function playVerhaal() {
    for (const p of duo) await p.tap(".sv-minirun .vh .vh-howto .vh-btn");
    for (let turn = 0; turn < 2; turn++) {
      const sh = await until(async () => { const s = (await S()).miniShared; return s && s.stage === "tell" && s.turn === turn ? s : null; }, { msg: "verteller " + (turn + 1) });
      const teller = byPid(sh.tellers[turn]), rater = duo.find((p) => p !== teller);
      await teller.page.waitForFunction(() => { const b = document.querySelector(".vh .vh-play .vh-btn"); return b && !b.disabled; }, null, { timeout: 20000 });
      if (turn === 0) await Promise.all([teller.shot("35-mini-verhaal-vertellen"), rater.shot("35-mini-verhaal-luisteren")]);
      await teller.tap(".vh .vh-play .vh-btn");
      await rater.page.waitForSelector('.vh .vh-rb[data-n="3"]', { timeout: 15000 });
      await rater.tap('.vh .vh-rb[data-n="3"]');
      if (turn === 0) await rater.shot("36-mini-verhaal-vlammen");
      await rater.page.waitForFunction(() => { const b = document.querySelector(".vh .vh-play .vh-btn"); return b && !b.disabled; }, null, { timeout: 5000 });
      await rater.tap(".vh .vh-play .vh-btn");
    }
    const r = await until(async () => { const s = await S(); return s.phase === "miniResult" && s.miniResult ? s.miniResult : null; }, { msg: "verhalen klaar" });
    eq([r.id, r.logs], ["verhaal", 3], "twee verhalen met 3 vlammen = 3 blokken");
    for (const p of duo) assert(/3/.test(r.perPlayer[p.pidv] || ""), `${p.name}: 3 vlammen in de uitslag (${r.perPlayer[p.pidv]})`);
  }
  async function playMini(st) {
    const id = st.mini.id, nonce = st.mini.nonce;
    await Promise.all(duo.map((p) => miniMounted(p, nonce)));
    await shotOnce(`20-mini-${id}-uitleg`);
    switch (id) {
      case "blaasbalg": await finishLocal(GOOD.blaasbalg); break;
      case "bijl": await Promise.all(duo.map(playBijl)); break;
      case "vonken": {
        // Host herlaadt midden in een minigame: zelfde minigame komt terug, daarna speelt iedereen gewoon uit
        await loek.page.reload();
        await loek.waitPhase("mini", 25000);
        await miniMounted(loek, nonce);
        eq((await S()).mini.nonce, nonce, "host herlaadt midden in een minigame: dezelfde minigame");
        await finishLocal(GOOD.vonken);
        break;
      }
      case "slot": await playSlot(st); break;
      case "echo": await playEcho(); break;
      case "snel": await finishLocal(GOOD.snel); break;
      case "verhaal": await playVerhaal(); break;
      default: throw new Error("onbekende minigame " + id);
    }
    const r = (await until(async () => { const s = await S(); return s.phase === "miniResult" ? s : null; }, { timeout: 40000, msg: "uitslag van " + id })).miniResult;
    eq([r.id, r.skipped], [id, false], "uitslag hoort bij " + id);
    return r;
  }
  // Eén stap van het verhaal afhandelen; → de nieuwe host-state
  async function playStep(st, { reloadScene = false } = {}) {
    const key = keyOf(st);
    await Promise.all(duo.map((p) => synced(p, st)));
    switch (st.phase) {
      case "title": await shotOnce("10-titel"); await readyAll(); break;
      case "card": await shotOnce(`11-hoofdstuk-${st.chapter}`); await readyAll(); break;
      case "scene": {
        const def = stepDef(st);
        if (reloadScene) {
          await jacques.page.reload();
          await jacques.waitPhase("scene", 20000);
          await synced(jacques, st);
          assert(await jacques.page.$(".sv-root .sv-dlg"), "Jacques herlaadt midden in een scène: scène is terug");
        }
        if (def && def.lines[0] && def.lines[0].who === "gloei") await shotOnce("12-scene-gloei");
        if (def && def.lines.some((l) => l.who === "vorst")) {
          // naar de eerste Vorst-regel tikken voor de rijp-foto
          const i = def.lines.findIndex((l) => l.who === "vorst");
          for (let k = 0; k <= i && k < 12; k++) await loek.tap(".sv-root .sv-dlg");
          await sleep(500);
          await shotOnce("13-scene-vorst", [loek]);
        }
        await readyAll();
        break;
      }
      case "fire": await sleep(1100); await shotOnce("14-vuurstap"); await readyAll(); break;
      case "choice": {
        const def = stepDef(st), votes = PLAN[def.id];
        assert(votes, "stemplan voor keuze " + def.id);
        await shotOnce("15-keuze");
        await loek.tap(`.sv-root [data-act="vote"][data-option="${votes[0]}"]`);
        await shotOnce("16-keuze-gestemd", [loek]);
        await jacques.tap(`.sv-root [data-act="vote"][data-option="${votes[1]}"]`);
        const nx = await moved(key);
        if (votes[0] === votes[1]) eq([nx.lastChoice.id, nx.lastChoice.option, nx.lastChoice.unanimous], [def.id, votes[0], true], "unanieme keuze " + def.id);
        else eq([nx.phase, nx.flip.id, nx.flip.options], ["flip", def.id, [0, 1]], "verdeelde keuze → muntworp");
        return nx;
      }
      case "flip": {
        await sleep(2900);
        await shotOnce("17-muntworp");
        const win = await loek.page.$eval(".sv-flip .sv-opt.win", (el) => +el.dataset.option);
        eq(win, st.flip.result, "de munt landt op de uitkomst van de engine");
        await readyAll();
        const nx = await moved(key);
        eq([nx.lastChoice.flip, nx.lastChoice.option], [true, st.flip.result], "muntworp toegepast");
        return nx;
      }
      case "mini": {
        const r = await playMini(st);
        const nx = await S();
        eq(nx.fire, r.fireAfter, "vuur na de minigame");
        await Promise.all(duo.map((p) => synced(p, nx)));
        return nx;
      }
      case "miniResult": {
        const r = st.miniResult;
        await until(async () => (await hudFire(loek)) === st.fire && (await hudFire(jacques)) === st.fire, { timeout: 15000, msg: "vuurmeter op beide telefoons = " + st.fire });
        await shotOnce(`21-uitslag-${r.id}`);
        for (const p of duo) {
          const t = await p.text(".sv-res .sv-verdict");
          assert(t && t.trim(), `${p.name}: uitslagkop`);
          eq(await p.page.$$eval(".sv-res .sv-pp .row", (r0) => r0.length), 2, `${p.name}: uitslag per speler`);
        }
        await readyAll();
        break;
      }
      default: throw new Error("onverwachte fase " + key);
    }
    return moved(key);
  }

  // =========================================================
  // 1) Eén knop, deellink zonder profiel, spelkiezer
  // =========================================================
  let code = null, link = null;
  await step("home: '🔥 Speel samen' → naam (eerste keer) → kamer gemaakt, link + QR vooraan", async () => {
    await loek.goto(loek.app("&test"));
    await loek.page.waitForSelector('[data-screen="home"].active .t-online');
    await loek.shot("01-home");
    await loek.tap(".tile.t-online");
    await loek.page.waitForSelector('[data-screen="online"].active [data-act="quick-name"]', { timeout: 8000 });
    assert(!(await loek.page.evaluate(() => sessionStorage.getItem("dva:autocreate"))), "snelstart-vlaggetje is verbruikt");
    await loek.shot("02-snelstart");
    await loek.page.fill('[data-act="quick-name"]', "Loek");
    await loek.tap('[data-act="quick-go"]');
    await loek.waitPhase("lobby", 25000);
    await enter(loek);
    code = (await loek.text(".o-bar-code")).trim();
    assert(/^[BDFGHJKLMNPRSTVZ][AEIOU][BDFGHJKLMNPRSTVZ][AEIOU]$/.test(code), "kamercode " + code);
    assert(await loek.page.$(".o-ticket .o-qr svg path"), "QR-code in de lobby");
    const prof = await loek.page.evaluate(() => JSON.parse(localStorage.getItem("dva:profile")));
    eq(prof.name, "Loek", "naam bewaard in het profiel");
    eq((await S()).game, "story", "nieuwe kamer begint met Vuurwacht");
    log("   kamercode", code);
  });
  await step("spelkiezer (1 speler): Vuurwacht aan, Infiltrant uit met 'Vanaf 3 spelers'", async () => {
    const cards = await loek.page.$$eval('[data-act="game"]', (bs) => bs.map((b) => ({ v: b.dataset.v, on: b.classList.contains("on"), off: b.classList.contains("is-off"), dis: b.disabled, badge: b.querySelector(".o-gm-badge").textContent })));
    eq(cards.map((c) => c.v), ["story", "arcade", "infiltrant"], "drie spellen");
    assert(cards[0].on && !cards[0].off, "Vuurwacht gekozen");
    assert(!cards[1].off && !cards[1].dis, "Minigames kan al met 1 speler");
    assert(cards[2].off && cards[2].dis && cards[2].badge === "Vanaf 3 spelers", "Infiltrant uit: " + JSON.stringify(cards[2]));
    await loek.shot("03-lobby-alleen");
  });
  await step("Jacques opent de deellink zonder profiel → alleen een naam → lobby", async () => {
    await loek.tap('.o-ticket [data-act="share"]');
    await loek.page.waitForSelector("#toast.show", { timeout: 5000 });
    link = await loek.page.evaluate(() => navigator.clipboard.readText());
    eq(new URL(link).searchParams.get("join"), code, "deellink: code");
    await jacques.goto(link + "&test");
    await jacques.page.waitForSelector('[data-screen="online"].active [data-act="quick-name"]', { timeout: 8000 });
    assert(new RegExp("kamer " + code).test(await jacques.text(".o-quick")), "snelstart noemt de kamer");
    assert(!(await jacques.page.$eval('[data-screen="online"]', (s) => s.querySelector('[data-act="create"]').offsetParent !== null)), "geen afleiding: alleen naam + Meedoen");
    await jacques.shot("04-snelstart-meedoen");
    await jacques.page.fill('[data-act="quick-name"]', "Jacques");
    await jacques.tap('[data-act="quick-go"]');
    await jacques.waitPhase("lobby", 25000);
    await enter(jacques);
    await until(async () => (await S()).players.length === 2, { msg: "2 spelers bij de host" });
    for (const p of duo) await p.page.waitForFunction(() => document.querySelectorAll(".o-pgrid .o-pcell:not(.o-ghost)").length === 2, null, { timeout: 10000 });
    eq(await jacques.page.$$eval(".o-pgrid .o-pcell-name", (n) => n.map((x) => x.textContent)), ["Loek", "Jacques"], "spelers in de lobby");
  });
  await step("spelkiezer (2 spelers): 'Aanbevolen voor 2', Infiltrant nog uit; niet-host alleen-lezen; wissel heen en terug", async () => {
    eq(await loek.page.$eval('[data-act="game"][data-v="story"] .o-gm-badge', (x) => x.textContent), "Aanbevolen voor 2", "badge");
    assert(await loek.page.$eval('[data-act="game"][data-v="infiltrant"]', (b) => b.disabled && b.classList.contains("is-off")), "Infiltrant uit met 2");
    assert(await jacques.page.$$eval('[data-act="game"]', (bs) => bs.every((b) => b.disabled) && bs[0].classList.contains("on")), "Jacques ziet de keuze, kan niet kiezen");
    eq((await jacques.text(".o-dock .o-wait")).trim(), "Wachten tot de host Vuurwacht start…", "wachttekst noemt het spel");
    await shots("05-lobby-twee");
    const acks0 = (await S()).acks;
    await loek.tap('[data-act="game"][data-v="arcade"]');
    await until(async () => (await jacques.debug()).game === "arcade", { msg: "Jacques ziet Minigames" });
    eq((await S()).game, "arcade", "host-state is arcade");
    await loek.page.waitForSelector('[data-act="seg-difficulty"][data-v="2"]', { timeout: 5000 });
    await shots("06-lobby-arcade");
    await loek.tap('[data-act="game"][data-v="story"]');
    await until(async () => (await jacques.debug()).game === "story", { msg: "Jacques ziet Vuurwacht" });
    const st = await S();
    eq([st.acks, Object.keys(st.keys).length, st.players.length], [acks0, 2, 2], "keys/acks/spelers gaan mee bij een spelwissel");
    // moeilijkheid instellen: live bij de ander
    await loek.tap('[data-act="seg-difficulty"][data-v="chill"]');
    await until(async () => (await jacques.debug()).pub.settings.difficulty === "chill", { msg: "Jacques ziet chill" });
    await loek.tap('[data-act="seg-difficulty"][data-v="normaal"]');
    await until(async () => (await jacques.debug()).pub.settings.difficulty === "normaal", { msg: "Jacques ziet normaal" });
    assert(await jacques.page.$$eval('[data-act="seg-difficulty"]', (bs) => bs.every((b) => b.disabled)), "Jacques kan de moeilijkheid niet aanpassen");
  });

  // =========================================================
  // 2) Het hele verhaal
  // =========================================================
  let run1 = null;
  await step("start Vuurwacht → titel op beide telefoons; publieke state zonder geheimen", async () => {
    await loek.tap('[data-act="start"]');
    await Promise.all(duo.map((p) => p.waitPhase("title", 15000)));
    const st = await S();
    eq([st.phase, st.runNo, st.fire], ["title", 1, DV_STORY.startFire], "run 1 begint op het startvuur");
    const pub = (await jacques.debug()).pub;
    for (const k of ["keys", "votes", "miniResults", "miniShared"]) assert(!(k in pub), "publiek zonder " + k);
    eq(pub.game, "story", "pub.game");
  });
  await step("hoofdstuk 1 (20:00): scènes, belofte, blaasbalg (testFinish) → vuur stijgt", async () => {
    let st = await S();
    while (st.chapter <= 0) st = await playStep(st);
    const r = st.runStats.minis[0];
    eq([r.id, r.logs, r.verdict], ["blaasbalg", 3, "win"], "blaasbalg: strak in de maat");
    eq(st.flags.belofte, "ja", "erewoord gegeven");
    eq(st.fire, DV_STORY.startFire + 3 - 1, "vuur op de kaart van hoofdstuk 2: +3 blaasbalg, −1 brand van het nieuwe uur");
  });
  await step("hoofdstuk 2 (21:00): Jacques herlaadt midden in een scène; bijl écht gespeeld; natte takjes −1", async () => {
    let st = await S();
    eq([st.phase, st.chapter], ["card", 1], "titelkaart hoofdstuk 2");
    st = await playStep(st);
    st = await playStep(st, { reloadScene: true });
    while (st.chapter <= 1) st = await playStep(st);
    const r = st.runStats.minis[1];
    eq([r.id, r.difficulty], ["bijl", 1], "handbijl (takken) = moeilijkheid 1");
    assert(r.logs >= 0, "echt gespeeld: geen verlies (" + r.logs + ")");
    eq(st.fire, 6 + r.logs - 1 - 1, "vuur op de kaart van hoofdstuk 3: bijl, −1 natte takjes, −1 brand");
  });
  await step("hoofdstuk 3 (22:00): host herlaadt midden in vonken; kleed voor de deur", async () => {
    let st = await S();
    while (st.chapter <= 2) st = await playStep(st);
    eq(st.runStats.minis[2].id, "vonken", "vonken gespeeld");
    eq(st.flags.kleed, "deur", "kleed tegen de kier");
  });
  await step("hoofdstuk 4 (23:00): het ringslot écht opgelost met de aanwijzingen; eikenhout +2", async () => {
    let st = await S();
    while (st.chapter <= 3) st = await playStep(st);
    const r = st.runStats.minis[3];
    eq(r.id, "slot", "slot gespeeld");
    assert(r.logs >= 3, "slot in één keer open (" + r.logs + " blokken)");
    eq(st.flags.kist, "hout", "eikenhout mee");
  });
  await step("hoofdstuk 5 (00:00): de Mist — echo met een echte convergentie in 2 rondes, Jacques herlaadt tussendoor", async () => {
    let st = await S();
    while (st.chapter <= 4) st = await playStep(st);
    const r = st.runStats.minis[4];
    eq([r.id, r.logs], ["echo", 3], "op één lijn in ronde 2 = 3 blokken");
  });
  await step("hoofdstuk 6 (02:00): nee tegen de Vorst, snel (testFinish, sweep)", async () => {
    let st = await S();
    while (st.chapter <= 5) st = await playStep(st);
    eq(st.flags.aanbod, "nee", "deur blijft dicht");
    eq([st.runStats.minis[5].id, st.runStats.minis[5].logs], ["snel", 4], "sneller dan de Vorst in elke ronde");
  });
  await step("hoofdstuk 7 (04:00): verdeelde keuze → muntworp; verhalen met echte vlammen", async () => {
    let st = await S();
    while (st.chapter <= 6) st = await playStep(st);
    eq(st.runStats.flips, 1, "precies één muntworp (de fles)");
    eq([st.runStats.minis[6].id, st.runStats.minis[6].logs], ["verhaal", 3], "verhalen: 3 blokken");
    assert(st.fire >= 8, "vuur voor de dageraad: " + st.fire);
  });
  await step("hoofdstuk 8 (06:00): dageraad → einde 'Legende' op beide telefoons, badge, terug naar de lobby", async () => {
    let st = await S();
    while (st.phase !== "ending") st = await playStep(st);
    run1 = st;
    eq(st.ending.id, "legende", "einde: Legende (vuur ≥ 8 en erewoord gehouden)");
    await Promise.all(duo.map((p) => p.waitPhase("ending", 15000)));
    for (const p of duo) {
      for (let i = 0; i < 12 && !(await p.page.$(".sv-root .sv-actions.show")); i++) { await p.tap(".sv-root .sv-end"); await sleep(120); }
      await p.page.waitForSelector(".sv-root .sv-actions.show", { timeout: 10000 });
      eq((await p.text(".sv-end .sv-h1")).trim(), "Legende", `${p.name}: titel van het einde`);
      assert(await p.page.$(".sv-end .sv-badge"), `${p.name}: Vuurwachters-badge`);
      eq((await p.text(".sv-stats .sv-stat b")).trim(), `${st.fire}/${st.maxFire}`, `${p.name}: vuur bij dageraad`);
    }
    assert(await jacques.page.$eval('.sv-root [data-act="next"]', (b) => b.hidden), "alleen de host brengt iedereen terug");
    await sleep(800);
    await shots("40-einde-legende");
    await loek.tap('.sv-root [data-act="next"]');
    await Promise.all(duo.map((p) => p.waitPhase("lobby", 15000)));
    const s2 = await S();
    eq([s2.stats.story.runs, s2.stats.story.finished, s2.stats.story.bestEnding], [1, 1, "legende"], "statistieken na run 1");
  });

  // =========================================================
  // 3) Vuur uit → opnieuw
  // =========================================================
  await step("pittig + slechte resultaten → 'Het vuur is uit' → host probeert opnieuw vanaf het checkpoint → lobby", async () => {
    await loek.tap('[data-act="seg-difficulty"][data-v="pittig"]');
    await until(async () => (await S()).settings.difficulty === "pittig", { msg: "pittig" });
    await loek.tap('[data-act="start"]');
    let st = await until(async () => { const s = await S(); return s.phase === "title" ? s : null; }, { msg: "run 2 start" });
    eq(st.runNo, 2, "run 2");
    const badPlan = { belofte: [1, 1], bijl: [1, 1] };
    let guard = 0;
    while (st.phase !== "fail" && guard++ < 40) {
      const key = keyOf(st);
      await Promise.all(duo.map((p) => synced(p, st)));
      if (st.phase === "choice") {
        const v = badPlan[stepDef(st).id];
        await loek.tap(`.sv-root [data-act="vote"][data-option="${v[0]}"]`);
        await jacques.tap(`.sv-root [data-act="vote"][data-option="${v[1]}"]`);
      } else if (st.phase === "mini") {
        await Promise.all(duo.map((p) => miniMounted(p, st.mini.nonce)));
        await finishLocal(BAD[st.mini.id]);
      } else if (st.phase === "miniResult") {
        await shotOnce("50-uitslag-verlies");
        await readyAll();
      } else await readyAll();
      st = await moved(key);
    }
    eq(st.phase, "fail", "het vuur is uit");
    eq([st.fire, st.checkpoint.chapterIdx, st.checkpoint.fire], [0, 1, 3], "checkpoint: hoofdstuk 2 met 3 blokken");
    await Promise.all(duo.map((p) => p.waitPhase("fail", 15000)));
    await sleep(2500);
    await shots("51-vuur-uit");
    assert(await jacques.page.$eval('.sv-root [data-act="retry"]', (b) => b.hidden), "alleen de host mag opnieuw");
    await loek.tap('.sv-root [data-act="retry"]');
    st = await until(async () => { const s = await S(); return s.phase === "card" ? s : null; }, { msg: "opnieuw vanaf het checkpoint" });
    eq([st.chapter, st.fire, st.runStats.fails], [1, 3, 1], "opnieuw bij hoofdstuk 2 met 3 blokken");
    await Promise.all(duo.map((p) => synced(p, st)));
    await shots("52-opnieuw");
    // host: terug naar de lobby via de kamer-sheet
    await loek.tap(".o-bar-chip");
    await loek.page.waitForSelector('.o-sheet-wrap.open [data-act="end"]', { timeout: 5000 });
    await loek.tap('[data-act="end"]');
    await loek.tap('[data-act="confirm"]');
    await Promise.all(duo.map((p) => p.waitPhase("lobby", 15000)));
    eq((await S()).stats.story.fails, 1, "mislukking geteld");
  });

  // =========================================================
  // 4) Derde telefoon → Infiltrant → arcade
  // =========================================================
  await step("Sanne (met profiel) komt erbij via de link → Infiltrant beschikbaar", async () => {
    sanne = await env.phone("Sanne");
    await sanne.goto(sanne.app("&test#online"));
    await sanne.page.waitForSelector(IN('[data-act="name"]'));
    await sanne.page.fill(IN('[data-act="name"]'), "Sanne");
    await sanne.tap(IN('[data-act="avatar"][data-v="🦊"]'));
    await sanne.tap(IN('[data-act="color"][data-v="#5aa9ff"]'));
    await sanne.goto(link + "&test");
    await sanne.waitPhase("lobby", 20000);
    await enter(sanne);
    await until(async () => (await S()).players.length === 3, { msg: "3 spelers" });
    await until(() => loek.page.$eval('[data-act="game"][data-v="infiltrant"]', (b) => !b.disabled && !b.classList.contains("is-off")), { msg: "Infiltrant beschikbaar met 3" });
    eq(await loek.page.$eval('[data-act="game"][data-v="story"] .o-gm-badge', (x) => x.textContent), "", "geen 'aanbevolen voor 2' meer");
    await shots("60-lobby-drie", all());
  });
  await step("host kiest Infiltrant: iedereen gaat mee (keys/acks/scores), spelregels zichtbaar", async () => {
    const before = await S();
    await loek.tap('[data-act="game"][data-v="infiltrant"]');
    await until(async () => (await S()).game === "infiltrant", { msg: "host-state infiltrant" });
    for (const p of all()) await until(async () => (await p.debug()).game === "infiltrant", { msg: `${p.name} ziet Infiltrant` });
    const st = await S();
    eq([st.players.map((p) => p.pid), st.acks, st.keys, st.scores], [before.players.map((p) => p.pid), before.acks, before.keys, before.scores], "spelers, acks, keys en scores gaan mee");
    assert(st.stats && st.stats.story && st.stats.story.runs === 2, "verhaal-statistieken reizen mee naar Infiltrant");
    await loek.page.waitForSelector('[data-act="mode"][data-v="woord"]', { timeout: 5000 });
    await jacques.page.waitForSelector(".o-sum .o-sum-t b", { timeout: 5000 });
    await shots("61-lobby-infiltrant", all());
  });
  await step("één potje Infiltrant met z'n drieën: woorden, hints, infiltrant eruit → BURGERS WINNEN → lobby", async () => {
    await loek.tap('[data-act="start"]');
    await Promise.all(all().map((p) => p.waitPhase("reveal", 15000)));
    for (const p of all()) {
      await p.page.waitForFunction(() => { const w = document.querySelector("[data-word]"); return w && w.textContent && w.textContent !== "…"; }, null, { timeout: 10000 });
      await p.tap('[data-act="seen"]');
    }
    await Promise.all(all().map((p) => p.waitPhase("hints", 15000)));
    for (let i = 0; i < 3; i++) {
      const st = await S();
      const sp = byPid(st.turn.pid);
      await sp.fill('[data-act="hint-input"]', `hint ${i + 1}`);
      await sp.press('[data-act="hint-input"]', "Enter");
      await until(async () => (await S()).hints.length === i + 1, { msg: "hint " + (i + 1) });
    }
    await Promise.all(all().map((p) => p.waitPhase("vote", 15000)));
    const st = await S();
    const inf = Object.keys(st.roles).find((pid) => st.roles[pid] === "infiltrant");
    const other = st.players.find((p) => p.pid !== inf).pid;
    for (const p of all()) {
      const target = p.pidv === inf ? other : inf;
      await p.tap(`[data-act="vote-pick"][data-pid="${target}"]`);
      await p.tap('[data-act="vote-submit"]');
      await until(async () => { const s = await S(); return s.voted.includes(p.pidv) || s.phase !== "vote"; }, { msg: `stem van ${p.name}` });
    }
    await Promise.all(all().map((p) => p.waitPhase("elim", 15000)));
    await loek.page.waitForSelector('[data-act="next"]', { state: "visible", timeout: 15000 });
    eq((await loek.text('[data-act="next"] .o-btn-l')).trim(), "Uitslag", "na de ontmaskering: Uitslag");
    await loek.tap('[data-act="next"]');
    await Promise.all(all().map((p) => p.waitPhase("over", 15000)));
    eq((await S()).result.winner, "burgers", "burgers winnen");
    await shots("62-infiltrant-uitslag", all());
    await loek.tap('[data-act="to-lobby"]');
    await Promise.all(all().map((p) => p.waitPhase("lobby", 15000)));
    const s2 = await S();
    assert(Object.values(s2.scores).some((x) => x > 0), "er zijn punten verdiend");
  });
  await step("terug naar de arcade: één minigame met z'n drieën → uitslag, punten bovenop de Infiltrant-scores → volgende", async () => {
    const before = await S();
    await loek.tap('[data-act="game"][data-v="arcade"]');
    await until(async () => (await S()).game === "arcade", { msg: "arcade" });
    const st0 = await S();
    eq(st0.scores, before.scores, "scores gaan mee naar de arcade");
    eq(st0.stats.story.runs, 2, "verhaal-statistieken nog steeds aanwezig");
    await loek.tap('[data-act="start"]');
    await Promise.all(all().map((p) => p.waitPhase("pick", 15000)));
    await loek.page.waitForSelector('.ar-card[data-mini="snel"]', { timeout: 5000 });
    await loek.tap('.ar-card[data-mini="snel"]');
    await loek.tap('.ar-diff button[data-diff="1"]');
    await until(async () => (await S()).settings.difficulty === 1, { msg: "niveau 1" });
    await shots("70-arcade-kiezen", all());
    await loek.tap('.sv-root [data-act="pick"]');
    const st = await until(async () => { const s = await S(); return s.phase === "mini" ? s : null; }, { msg: "arcade-minigame" });
    eq([st.mini.id, st.mini.difficulty, st.mini.pids.length], ["snel", 1, 3], "snel op niveau 1 met z'n drieën");
    await Promise.all(all().map((p) => p.waitPhase("mini", 15000)));
    await Promise.all(all().map((p) => miniMounted(p, st.mini.nonce)));
    await finishLocal({ times: [200, 220, 210] }, all());
    const res = await until(async () => { const s = await S(); return s.phase === "miniResult" ? s : null; }, { msg: "arcade-uitslag" });
    const r = res.miniResult;
    eq([r.id, r.logs, r.record], ["snel", 4, true], "sweep = 4 blokken, nieuw record");
    for (const pid of st.mini.pids) eq(res.scores[pid], (before.scores[pid] || 0) + r.points[pid], `punten van ${byPid(pid).name} erbij op het scorebord`);
    await Promise.all(all().map((p) => p.waitPhase("miniResult", 15000)));
    await sleep(2200);
    for (const p of all()) eq(await p.page.$$eval(".ar-table .r", (rows) => rows.length), 3, `${p.name}: stand met 3 spelers`);
    await shots("71-arcade-uitslag", all());
    await loek.tap('.sv-root [data-act="next"]');
    await Promise.all(all().map((p) => p.waitPhase("pick", 15000)));
    eq((await S()).stats.arcade.records.snel.plays, 1, "record geteld");
  });
  await step("host sluit de kamer → iedereen krijgt het eindscherm", async () => {
    await loek.tap('[data-act="leave"]');
    await loek.tap('[data-act="confirm"]');
    await loek.page.waitForSelector('section[data-screen="online"].active', { timeout: 10000 });
    for (const p of [jacques, sanne]) {
      await p.waitPhase("ended");
      assert(/De host heeft de kamer gesloten/.test(await p.text(".o-stage")), `${p.name}: kamer gesloten`);
    }
    eq(await loek.page.evaluate(() => [localStorage.getItem("dva:session"), localStorage.getItem("dva:hostRoom")]), [null, null], "host-opslag opgeruimd");
    log(`   run 1: ${run1.runStats.minis.map((m) => m.id + ":" + m.logs).join(" ")} → ${run1.ending.id} met ${run1.fire} blokken`);
  });
}
