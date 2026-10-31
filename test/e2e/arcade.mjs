// E2E arcade (minimaal): één telefoon maakt een kamer via #online, kiest Minigames, start alleen, speelt vonken
// (DVMini.testFinish), ziet de uitslag met record en stand, gaat naar de volgende keuze en sluit de kamer.
import { assert, eq, until, sleep, log } from "./lib.mjs";

export default async function arcade(env) {
  const { step } = env;
  const p = await env.phone("Solo");
  const S = () => until(async () => { const r = await p.hostRoom(); return r && r.state; }, { msg: "host-state lezen" });

  await step("alleen: kamer maken, Minigames kiezen, starten met 1 speler", async () => {
    await p.goto(p.app("&test#online"));
    await p.page.waitForSelector("#olHome .o-brand");
    eq(await p.page.$$eval("#olHome .o-teaser b", (b) => b.map((x) => x.textContent)), ["Vuurwacht", "Minigames", "Infiltrant"], "#online toont de drie spellen");
    await p.page.fill('#olHome [data-act="name"]', "Solo");
    await p.tap('#olHome [data-act="create"]');
    await p.waitPhase("lobby", 25000);
    await p.tap('[data-act="game"][data-v="arcade"]');
    await until(async () => (await S()).game === "arcade", { msg: "arcade gekozen" });
    // de lobby wisselt met een View Transition: wachten tot de arcade-lobby er staat
    await until(async () => (await p.text(".o-need")).trim() === "Je kunt alleen beginnen, maar samen is leuker 🔥", { msg: "lobbytekst voor 1 speler" });
    eq(await p.page.getAttribute('section[data-screen="room"]', "data-game"), "arcade", "data-game");
    await p.shot("80-arcade-lobby");
    await p.tap('[data-act="start"]');
    await p.waitPhase("pick", 15000);
    eq(await p.page.$$eval(".ar-card", (c) => c.length), 7, "zeven minigames in de kiezer");
    await p.shot("81-arcade-kiezer");
  });
  await step("vonken: kiezen → spelen (testFinish) → uitslag met record → volgende minigame", async () => {
    await p.tap('.ar-card[data-mini="vonken"]');
    await p.tap('.sv-root [data-act="pick"]');
    const st = await until(async () => { const s = await S(); return s.phase === "mini" ? s : null; }, { msg: "minigame gestart" });
    eq([st.mini.id, st.mini.pids.length], ["vonken", 1], "vonken, alleen");
    await p.waitPhase("mini", 15000);
    await p.page.waitForFunction((n) => { const a = window.DVMini.active; return !!(a && a.nonce === n); }, st.mini.nonce, { timeout: 15000 });
    await p.shot("82-arcade-vonken");
    await until(() => p.page.evaluate(() => window.DVMini.testFinish({ caught: 12, missed: 2 })), { msg: "testFinish" });
    const res = await until(async () => { const s = await S(); return s.phase === "miniResult" ? s : null; }, { msg: "uitslag" });
    eq([res.miniResult.id, res.miniResult.record, res.miniResult.logs > 0], ["vonken", true, true], "eerste potje = record");
    eq(res.scores[st.mini.pids[0]], res.miniResult.points[st.mini.pids[0]], "punten op het scorebord");
    await p.waitPhase("miniResult", 15000);
    await sleep(2000);
    assert(/Nieuw record/.test(await p.text(".ar-res")), "uitslag meldt het record");
    await p.shot("83-arcade-uitslag");
    await p.tap('.sv-root [data-act="next"]');
    await p.waitPhase("pick", 15000);
    assert(/Record/.test(await p.text('.ar-card[data-mini="vonken"] .rec')), "record staat bij de kaart");
    log("   vonken:", res.miniResult.logs, "blokken,", res.miniResult.points[st.mini.pids[0]], "punten");
  });
  await step("kamer sluiten", async () => {
    await p.tap('[data-act="leave"]');
    await p.tap('[data-act="confirm"]');
    await p.page.waitForSelector('section[data-screen="online"].active', { timeout: 10000 });
  });
}
