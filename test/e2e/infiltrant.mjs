// E2E Infiltrant: 6 telefoons (iPhone 13, touch) spelen echte potjes via de UI tegen een lokale broker.
//  a) kamer maken + meedoen (code typen én deellink), instellingen live bij iedereen, woord-modus tot de uitslag, "Nog een potje"
//  d) dubbel tikken telt één keer, speler herlaadt (zelfde plek + woord), speler 5 s offline, host herlaadt tijdens stemmen
//  c) gelijkspel → herstemming → weer gelijk → "Niemand eruit!"; laatkomer kijkt mee en speelt het volgende potje
//  b) blind-modus: infiltrant ontmaskerd en raadt het woord → infiltrant wint
//  e) host zet iemand uit de kamer, speler vertrekt, host sluit de kamer
// Wie de infiltrant is, leest de test uit de host-opslag (dva:hostRoom) — net als de host-telefoon zelf.
import { createRequire } from "node:module";
import { assert, eq, until, sleep, log } from "./lib.mjs";

const require = createRequire(import.meta.url);
const { DV_WORDCATS } = require("../../online/words.js");

const PROFILES = {
  Loek: { avatar: "😎", color: "#ff6a1a" },
  Sanne: { avatar: "🦊", color: "#5aa9ff" },
  Jeroen: { avatar: "🤖", color: "#ffc247" },
  Fleur: { avatar: "🦄", color: "#ffe7b8" },
  Mo: { avatar: "👽", color: "#c98f5a" },
};
const VERDICT = { inf: "WAS DE INFILTRANT", burg: "was een burger 😇", tie: "Niemand eruit!" };
const IN = (sel) => `#olHome ${sel}`;

export default async function infiltrant(env) {
  const { step } = env;
  const host = await env.phone("Loek", { clipboard: true });
  const sanne = await env.phone("Sanne");
  const jeroen = await env.phone("Jeroen");
  const fleur = await env.phone("Fleur");
  const mo = await env.phone("Mo");
  let iris = null;

  const inRoom = new Set();
  const room = () => [...inRoom];
  const all = (fn) => Promise.all(room().map(fn));
  // Volledige (geheime) host-state uit dva:hostRoom; blijft proberen terwijl de host-pagina herlaadt
  const S = () => until(async () => { const r = await host.hostRoom(); return r && r.state; }, { msg: "host-state lezen" });
  const byPid = (pid) => room().find((p) => p.pidv === pid);
  const aliveOf = (st) => st.order.filter((pid) => { const x = st.players.find((q) => q.pid === pid); return x && x.alive && !x.left && !x.spectator; });
  const shots = (label) => Promise.all([host, sanne].filter((p) => inRoom.has(p)).map((p) => p.shot(label)));
  const pill = (p) => p.page.getAttribute(".o-pill", "data-state");
  const rules = (p) => p.page.$$eval(".o-sum .o-sum-t b", (b) => b.map((x) => x.textContent)); // spelregels (niet-host)

  // ---------- hulpjes ----------
  async function setupProfile(p) {
    const prof = PROFILES[p.name];
    await p.goto(p.app("#online"));
    await p.page.waitForSelector(IN('[data-act="name"]'));
    await p.page.fill(IN('[data-act="name"]'), p.name);
    await p.tap(IN(`[data-act="avatar"][data-v="${prof.avatar}"]`));
    await p.tap(IN(`[data-act="color"][data-v="${prof.color}"]`));
    const saved = await p.page.evaluate(() => JSON.parse(localStorage.getItem("dva:profile")));
    eq([saved.name, saved.avatar, saved.color], [p.name, prof.avatar, prof.color], `${p.name}: profiel opgeslagen`);
  }
  async function joinByCode(p, code) {
    await p.tap(IN('[data-act="code"][data-i="0"]'));
    await p.page.keyboard.type(code.toLowerCase(), { delay: 35 });
    const typed = await p.page.$$eval(IN('[data-act="code"]'), (bs) => bs.map((b) => b.value).join(""));
    eq(typed, code, `${p.name}: code-vakjes (hoofdletters + doorspringen)`);
    await p.tap(IN('[data-act="join"]'));
    await p.waitPhase("lobby");
  }
  async function enter(p) { inRoom.add(p); p.pidv = await p.pid(); assert(p.pidv, `${p.name}: geen sessie`); }
  // Twee snelle tikken op dezelfde plek (zoals een ongeduldige duim): de tweede raakt wat er dán ligt.
  // jank = ms dat de pagina na de eerste tik bezig is (trage telefoon): de tweede tik wordt dan pas later verwerkt.
  async function doubleTap(p, sel, gap = 70, { jank = 0 } = {}) {
    const loc = p.page.locator(sel);
    await loc.scrollIntoViewIfNeeded();
    const { x, y } = await until(() => loc.evaluate((el) => {
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const at = document.elementFromPoint(x, y);
      const vt = document.getAnimations().some((a) => a.effect && /view-transition/.test(a.effect.pseudoElement || ""));
      return at && el.contains(at) && !el.disabled && !vt ? { x, y } : null;
    }), { timeout: 8000, msg: `${p.name}: ${sel} is niet aan te tikken` });
    await p.page.touchscreen.tap(x, y);
    if (jank) p.page.evaluate((ms) => new Promise((r) => setTimeout(() => { const t = performance.now(); while (performance.now() - t < ms); r(); }, 0)), jank).catch(() => {});
    await sleep(gap);
    await p.page.touchscreen.tap(x, y);
  }
  // Na een (dubbele) tik: precies één envelop verstuurd en verwerkt
  async function oneEnvelope(p, ack0, what) {
    await until(async () => (await S()).acks[p.pidv] >= ack0 + 1, { msg: `${p.name}: ${what} komt aan bij de host` });
    await sleep(1700); // ruim één herhaal-interval: een eventuele tweede envelop zou nu binnen zijn
    eq((await S()).acks[p.pidv], ack0 + 1, `${p.name}: ${what} na dubbel tikken (acks)`);
    eq((await p.session()).seq, ack0 + 1, `${p.name}: ${what} na dubbel tikken (verstuurde enveloppen)`);
  }
  async function waitWord(p) {
    await p.page.waitForFunction(() => { const w = document.querySelector("[data-word]"); return w && w.textContent && w.textContent !== "…"; }, null, { timeout: 10000 });
  }
  // Houd de geheime kaart echt ingedrukt (muis of touch) → { word, cat }
  async function peekCard(p, { touch = false, shot = null } = {}) {
    await waitWord(p);
    const seen = await p.hold('[data-act="peek-card"]', shot ? 750 : 400, { touch, during: async () => {
      assert(await p.page.$(".o-card3d.open"), `${p.name}: kaart draait niet open bij ingedrukt houden`);
      if (shot) await p.shot(shot);
      return { word: (await p.text("[data-word]")).trim(), cat: (await p.text(".o-c3-cat")).trim() };
    } });
    await until(async () => !(await p.page.$(".o-card3d.open")), { timeout: 3000, msg: `${p.name}: kaart draait terug bij loslaten` });
    return seen;
  }
  async function peekChip(p) {
    await until(async () => { const d = await p.debug(); return d.priv && d.pub && d.priv.gameNo === d.pub.gameNo; }, { msg: `${p.name}: geheim woord binnen` });
    return p.hold('[data-act="peek"]', 350, { during: async () => {
      assert(await p.page.$(".o-peek-wrap.open"), `${p.name}: 👁 Mijn woord opent niet`);
      return (await p.text(".o-peek-word")).trim();
    } });
  }
  async function revealAll({ rapid = null, shotLabel = null } = {}) {
    await all((p) => p.waitPhase("reveal"));
    const st = await S();
    const seen = {};
    let i = 0;
    for (const p of room()) {
      if (!aliveOf(st).includes(p.pidv)) continue;
      seen[p.pidv] = await peekCard(p, { touch: i++ % 2 === 1, shot: shotLabel && (p === host || p === sanne) ? shotLabel : null });
    }
    for (const p of room()) {
      if (!aliveOf(st).includes(p.pidv)) continue;
      if (p === rapid) {
        const a0 = st.acks[p.pidv];
        await doubleTap(p, '[data-act="seen"]');
        await oneEnvelope(p, a0, "Gezien");
      } else await p.tap('[data-act="seen"]');
    }
    await all((p) => p.waitPhase("hints"));
    return seen;
  }

  // Hints tot de stemming (of tot special "stop" zegt). special(spreker, st, nr) → true = hint zelf gegeven
  async function hints(special) {
    for (let nr = 0; nr < 80; nr++) {
      const st = await S();
      if (st.phase !== "hints") return st;
      const sp = byPid(st.turn.pid);
      assert(sp, "geen telefoon voor spreker " + st.turn.pid);
      await sp.page.waitForSelector('[data-act="hint-input"]', { state: "visible", timeout: 10000 });
      for (const p of room()) if (p !== sp) assert(!(await p.visible('[data-act="hint-input"]')), `${p.name} ziet het hint-veld terwijl ${sp.name} aan de beurt is`);
      const n = st.hints.length;
      const done = special ? await special(sp, st, nr) : false;
      if (done === "stop") return S();
      if (!done) {
        if (nr % 4 === 3) await sp.tap('[data-act="hint-aloud"]');
        else {
          await sp.fill('[data-act="hint-input"]', `${sp.name.toLowerCase()} ${st.round}.${st.turn.hintRound}`);
          if (nr % 2) await sp.tap('[data-act="hint-send"]');
          else await sp.press('[data-act="hint-input"]', "Enter"); // enterkeyhint=send
        }
      }
      const after = await until(async () => { const s = await S(); return s.hints.length > n || s.phase !== "hints" ? s : null; }, { msg: `hint van ${sp.name} komt aan` });
      if (after.phase === "hints") {
        await all((p) => p.page.waitForFunction((k) => document.querySelectorAll(".o-stage .o-feed .o-bub").length === k, after.hints.length, { timeout: 10000 }));
      } else await all((p) => p.waitPhase(after.phase));
    }
    throw new Error("hints-lus loopt niet af");
  }

  // Stem via de UI en wacht tot de host hem verwerkt heeft (ack) én hij telt: in `voted`, of de stemming is
  // daardoor afgerond (herstemming, uitslag). Een stem die alleen ge-ackt wordt (ongeldig) telt dus niet.
  async function vote(p, target, { double = false } = {}) {
    const s0 = await S();
    const a0 = s0.acks[p.pidv];
    await p.tap(`[data-act="vote-pick"][data-pid="${target}"]`);
    await p.page.waitForSelector(`[data-act="vote-pick"][data-pid="${target}"].on`, { timeout: 5000 });
    if (double) await doubleTap(p, '[data-act="vote-submit"]');
    else await p.tap('[data-act="vote-submit"]');
    await until(async () => {
      const s = await S();
      if (!(s.acks[p.pidv] > a0)) return false;
      return s.voted.includes(p.pidv) || s.phase !== "vote" || s.revote !== s0.revote || JSON.stringify(s.lastVote) !== JSON.stringify(s0.lastVote);
    }, { timeout: 20000, msg: `stem van ${p.name} telt` });
  }
  // Iedereen die leeft stemt `target` eruit (die stemt zelf op een ander)
  async function voteOut(target, skip = []) {
    const alive = aliveOf(await S());
    const other = alive.find((pid) => pid !== target);
    for (const pid of alive) {
      const p = byPid(pid);
      if (skip.includes(p)) continue;
      await vote(p, pid === target ? other : target);
    }
  }
  async function elim(kind, { next = null, shot = null } = {}) {
    await all((p) => p.waitPhase("elim"));
    if (shot) { await sleep(1500); await shots(shot + "-drama"); }
    await host.page.waitForSelector('[data-act="next"]', { state: "visible", timeout: 15000 }); // na het drama
    for (const p of room()) {
      const t = await p.page.textContent(".o-elim .o-verdict-t", { timeout: 15000 });
      eq(t.trim(), VERDICT[kind], `${p.name}: uitslag van de stemming`);
      assert(await p.visible(".o-elim .o-tally"), `${p.name}: stemmen-overzicht zichtbaar`);
    }
    if (next) eq((await host.text('[data-act="next"] .o-btn-l')).trim(), next, "knop van de host na de stemming");
    if (shot) { await sleep(600); await shots(shot); }
  }
  async function over(winner, shot) {
    await all((p) => p.waitPhase("over"));
    const st = await S();
    const active = st.players.filter((x) => !x.left);
    for (const p of room()) {
      eq(await p.page.getAttribute(".o-win-t", "aria-label"), winner, `${p.name}: winnaar-banner`);
      assert(await p.visible(".o-board"), `${p.name}: scorebord zichtbaar`);
      eq(await p.page.$$eval(".o-board .o-row", (r) => r.length), active.length, `${p.name}: rijen op het scorebord`);
    }
    const shown = await sanne.page.$$eval(".o-board .o-row .o-row-s", (r) => r.map((x) => +x.textContent));
    eq(shown, active.map((x) => st.scores[x.pid] || 0).sort((a, b) => b - a), "scores op het scorebord (Sanne)");
    if (shot) { await sleep(900); await shots(shot); }
    return st;
  }

  // =========================================================
  // a) Kamer maken, meedoen, instellingen, woord-modus
  // =========================================================
  let code = null, link = null;
  await step("profielen instellen op #online", async () => {
    for (const p of [host, sanne, jeroen, fleur, mo]) await setupProfile(p);
    await Promise.all([host, sanne].map((p) => p.shot("01-online")));
  });
  await step("host maakt een kamer (Kamer maken)", async () => {
    await host.tap(IN('[data-act="create"]'));
    await host.waitPhase("lobby", 25000);
    code = (await host.text(".o-bar-code")).trim();
    assert(/^[BDFGHJKLMNPRSTVZ][AEIOU][BDFGHJKLMNPRSTVZ][AEIOU]$/.test(code), "kamercode-patroon: " + code);
    eq((await host.page.$$eval('.o-ticket [data-room-code] .o-tile', (t) => t.map((x) => x.textContent).join(""))), code, "code als lettertegels");
    assert(await host.page.$(".o-ticket .o-qr svg path"), "QR-code in de lobby");
    await enter(host);
    log("   kamercode", code);
  });
  await step("drie spelers typen de code en doen mee", async () => {
    for (const p of [sanne, jeroen, fleur]) { await joinByCode(p, code); await enter(p); }
    await host.page.waitForFunction(() => document.querySelectorAll(".o-pgrid .o-pcell:not(.o-ghost)").length === 4, null, { timeout: 10000 });
  });
  await step("Mo doet mee via de deellink (bestaand profiel → automatisch)", async () => {
    await host.tap('.o-ticket [data-act="share"]');
    await host.page.waitForSelector("#toast.show", { timeout: 5000 });
    link = await host.page.evaluate(() => navigator.clipboard.readText());
    const u = new URL(link);
    eq(u.searchParams.get("join"), code, "deellink: code");
    eq(u.searchParams.get("broker"), env.brokerUrl, "deellink: broker-override");
    await mo.goto(link);
    await mo.waitPhase("lobby", 20000);
    await enter(mo);
    await all((p) => p.page.waitForFunction(() => document.querySelectorAll(".o-pgrid .o-pcell:not(.o-ghost)").length === 5, null, { timeout: 10000 }));
    const names = await sanne.page.$$eval(".o-pgrid .o-pcell-name", (n) => n.map((x) => x.textContent));
    eq(names, ["Loek", "Sanne", "Jeroen", "Fleur", "Mo"], "spelers in de lobby (volgorde van binnenkomst)");
    await shots("02-lobby");
  });
  await step("host kiest Infiltrant in de spelkiezer (vanaf 3 spelers) → iedereen wisselt mee", async () => {
    const before = await S();
    eq(before.game, "story", "een nieuwe kamer begint met Vuurwacht");
    assert(await host.page.$eval('[data-act="game"][data-v="infiltrant"]', (b) => !b.disabled && !b.classList.contains("is-off")), "Infiltrant beschikbaar met 5 spelers");
    await host.tap('[data-act="game"][data-v="infiltrant"]');
    for (const p of room()) await until(async () => (await p.debug()).game === "infiltrant", { msg: `${p.name} ziet Infiltrant` });
    const st = await S();
    eq([st.game, st.players.map((p) => p.pid), st.acks, st.keys], ["infiltrant", before.players.map((p) => p.pid), before.acks, before.keys], "spelers, acks en keys gaan mee");
    await host.page.waitForSelector('[data-act="mode"][data-v="woord"]', { timeout: 5000 });
  });
  await step("host past instellingen aan → iedereen ziet ze", async () => {
    await host.tap('[data-act="seg-infiltrants"][data-v="2"]');
    await host.tap('[data-act="seg-hintRounds"][data-v="2"]');
    await host.tap('[data-act="cat"][data-v="dieren"]');
    for (const p of [sanne, jeroen, fleur, mo]) {
      await until(async () => JSON.stringify(await rules(p)) === JSON.stringify(["Ander woord", "2 infiltranten", "2 hint-rondes", "Geen timer", "Dieren"]),
        { msg: `${p.name} ziet de nieuwe spelregels` });
    }
    eq((await S()).settings, { mode: "woord", infiltrants: 2, hintRounds: 2, timer: 0, categories: ["dieren"] }, "instellingen in de host-state");
    await shots("02b-lobby-regels");
  });

  let g1 = null;
  await step("start → iedereen houdt de kaart ingedrukt → precies 2 spelers een ander woord", async () => {
    await host.tap('[data-act="start"]');
    const seen = await revealAll({ shotLabel: "03-kaart-ingedrukt" });
    const st = await S();
    g1 = st;
    eq(st.infiltrantCount, 2, "aantal infiltranten (5 spelers, instelling 2)");
    eq(st.words.category, "dieren", "woordpaar uit de gekozen categorie");
    const words = room().map((p) => seen[p.pidv].word);
    const count = {};
    words.forEach((w) => (count[w] = (count[w] || 0) + 1));
    const burger = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    eq(words.filter((w) => w !== burger).length, st.infiltrantCount, "spelers met een ánder woord");
    for (const p of room()) {
      eq(seen[p.pidv].word, st.roles[p.pidv] === "infiltrant" ? st.words.infiltrant : st.words.burger, `${p.name}: woord op de kaart`);
      eq(seen[p.pidv].cat, DV_WORDCATS.dieren, `${p.name}: categorie op de kaart`);
    }
    eq((await sanne.debug()).pub.infiltrantCount, 2, "infiltrantCount publiek");
    log("   burgers:", st.words.burger, "· infiltranten:", st.words.infiltrant);
    await all((p) => p.waitPhase("hints"));
  });
  await step("ronde 1: om de beurt een hint (typen, Enter, Hardop gezegd)", async () => {
    await shots("04-hints");
    const st = await hints(async (sp, s, nr) => {
      if (nr === 1) { await shots("04b-hints-beurt"); }
      return false;
    });
    eq(st.phase, "vote", "na alle hints: stemmen");
    eq(st.hints.length, 10, "5 spelers × 2 hint-rondes");
    eq(st.hints.map((x) => x.hintRound), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2], "hint-rondes");
    eq(st.hints.map((x) => x.pid), st.order.concat(st.order), "spreekvolgorde = willekeurige volgorde van het potje");
    assert(st.hints.some((x) => x.text === ""), "minstens één 'Hardop gezegd'");
  });
  await step("ronde 1: iedereen stemt infiltrant 1 eruit", async () => {
    await all((p) => p.waitPhase("vote"));
    const st = await S();
    // grid zonder jezelf
    for (const p of room()) {
      const pids = await p.page.$$eval('[data-act="vote-pick"]', (b) => b.map((x) => x.dataset.pid));
      eq(pids.sort(), aliveOf(st).filter((x) => x !== p.pidv).sort(), `${p.name}: stemkaart zonder jezelf`);
    }
    await shots("05-stemmen");
    const [inf1] = st.order.filter((pid) => st.roles[pid] === "infiltrant");
    await voteOut(inf1);
    await elim("inf", { next: "Volgende ronde", shot: "06-onthulling" });
    const s2 = await S();
    eq(s2.lastVote.eliminated, inf1, "infiltrant 1 ligt eruit");
  });
  await step("ronde 2: hints, infiltrant 2 eruit → BURGERS WINNEN", async () => {
    await host.tap('[data-act="next"]');
    await all((p) => p.waitPhase("hints"));
    const st0 = await S();
    eq(st0.round, 2, "ronde 2");
    const st = await hints();
    eq(st.phase, "vote", "stemmen in ronde 2");
    const inf2 = st.order.find((pid) => st.roles[pid] === "infiltrant" && aliveOf(st).includes(pid));
    await voteOut(inf2);
    await elim("inf", { next: "Uitslag" });
    await host.tap('[data-act="next"]');
    const s = await over("BURGERS WINNEN", "07-uitslag-burgers");
    for (const pid of Object.keys(g1.roles)) {
      eq(s.scores[pid], s.result.delta[pid], "eerste potje: score = punten van dit potje");
      // +1 per stem op een infiltrant (2 beslissende stemmingen) en +2 voor winnende burgers
      if (g1.roles[pid] === "burger") assert(s.result.delta[pid] >= 2 && s.result.delta[pid] <= 4, `burger ${pid}: +2 (+ stempunten)`);
      else assert(s.result.delta[pid] <= 2, `infiltrant ${pid} krijgt geen winpunten`);
    }
    const mine = (await sanne.text(".o-board .o-row.is-me .o-row-d")).trim();
    const d = s.result.delta[sanne.pidv];
    eq(mine, d > 0 ? "+" + d : "±0", "Sanne ziet haar punten van dit potje");
  });
  await step('"Nog een potje" → iedereen in een nieuw potje (via de lobby), scores blijven', async () => {
    const before = (await S()).scores;
    await host.tap('[data-act="again"]');
    await all((p) => p.waitPhase("reveal"));
    const st = await S();
    eq(st.gameNo, 2, "potje 2");
    eq(st.scores, before, "scores blijven staan");
    for (const p of room()) eq((await p.debug()).pub.gameNo, 2, `${p.name}: potje 2`);
  });

  // =========================================================
  // d) Veerkracht + c) gelijkspel, in potje 2
  // =========================================================
  let fleurWord = null;
  await step("potje 2: kaarten bekijken, Sanne tikt dubbel op Gezien (telt één keer)", async () => {
    const seen = await revealAll({ rapid: sanne });
    fleurWord = seen[fleur.pidv].word;
  });
  await step("potje 2 ronde 1: dubbel tikken, XSS-hint, Jeroen 5 s offline, Fleur herlaadt", async () => {
    let xss = false, rapid = false, offline = false, reload = false;
    // Jeroen gaat offline als hij aan de beurt is, geeft z'n hint (blijft in de outbox) en komt na 5 s terug
    async function goOffline(s) {
      offline = true;
      await jeroen.ctx.setOffline(true);
      await until(async () => (await pill(jeroen)) === "wait", { timeout: 8000, msg: "Jeroen ziet 'Verbinden…' als hij offline is" });
      await until(async () => (await host.debug()).presence[jeroen.pidv] === false, { timeout: 8000, msg: "host ziet Jeroen offline (Last Will)" });
      await jeroen.fill('[data-act="hint-input"]', "hint uit de tunnel");
      await jeroen.press('[data-act="hint-input"]', "Enter");
      await jeroen.page.waitForSelector("text=Hint versturen…", { timeout: 5000 });
      await jeroen.shot("08-offline");
      await sleep(5000);
      const mid = await S();
      eq([mid.hints.length, mid.turn.pid], [s.hints.length, jeroen.pidv], "offline hint is nog niet aangekomen");
      await jeroen.ctx.setOffline(false);
      await until(async () => (await S()).hints.length === s.hints.length + 1, { timeout: 15000, msg: "offline hint komt aan na herverbinden" });
      await until(async () => (await jeroen.debug()).outbox.length === 0 && (await pill(jeroen)) === "live", { timeout: 10000, msg: "Jeroen weer Live met lege outbox" });
      await until(async () => (await host.debug()).presence[jeroen.pidv] === true, { timeout: 10000, msg: "host ziet Jeroen weer online" });
      eq((await S()).hints.at(-1).text, "hint uit de tunnel", "Jeroens hint");
      return true;
    }
    // Fleur herlaadt midden in de hints: zelfde pid, zelfde woord, speelt gewoon door
    async function reloadFleur() {
      reload = true;
      const pid0 = fleur.pidv;
      await fleur.page.reload();
      await fleur.waitPhase("hints");
      eq(await fleur.pid(), pid0, "Fleur zit na herladen op dezelfde plek (pid)");
      eq(await peekChip(fleur), fleurWord, "Fleur ziet na herladen hetzelfde woord");
      const me = (await fleur.debug()).pub.players.find((x) => x.pid === pid0);
      assert(me && me.alive && !me.left, "Fleur speelt nog mee");
    }
    const st = await hints(async (sp, s) => {
      // Jeroens eerste beurt valt in hint-ronde 1 → daarna komen er altijd nog beurten (voor het herladen)
      if (!offline && sp === jeroen) return goOffline(s);
      if (offline && !reload) await reloadFleur();
      if (!xss) {
        xss = true;
        await sp.fill('[data-act="hint-input"]', "<b>vet</b>");
        await sp.press('[data-act="hint-input"]', "Enter");
        await until(async () => (await S()).hints.length > s.hints.length, { msg: "xss-hint komt aan" });
        await sanne.page.waitForFunction((k) => document.querySelectorAll(".o-stage .o-feed .o-bub").length === k, s.hints.length + 1);
        const t = await sanne.page.$$eval(".o-stage .o-feed .o-bub-t", (b) => b.map((x) => [x.textContent, x.querySelector("b") ? 1 : 0]));
        assert(t.some(([txt, el]) => txt === "<b>vet</b>" && !el), "hint-tekst wordt als tekst getoond (geen HTML): " + JSON.stringify(t));
        return true;
      }
      if (!rapid && sp !== host && sp !== jeroen) {
        rapid = true;
        const a0 = s.acks[sp.pidv];
        await sp.fill('[data-act="hint-input"]', "dubbel getikt");
        await doubleTap(sp, '[data-act="hint-send"]');
        await oneEnvelope(sp, a0, "hint");
        const mine = (await S()).hints.filter((x) => x.pid === sp.pidv && x.round === s.round && x.hintRound === s.turn.hintRound);
        eq(mine.length, 1, `${sp.name}: één hint na dubbel tikken`);
        return true;
      }
      return false;
    });
    assert(xss && rapid && offline && reload, `alle speciale beurten gehad: ${[xss, rapid, offline, reload]}`);
    eq(st.phase, "vote", "stemmen");
  });
  await step("potje 2 ronde 1: host herlaadt midden in de stemming → spel loopt door", async () => {
    await all((p) => p.waitPhase("vote"));
    const st = await S();
    const [inf1] = st.order.filter((pid) => st.roles[pid] === "infiltrant");
    const alive = aliveOf(st);
    const target = (p) => (p.pidv === inf1 ? alive.find((x) => x !== inf1) : inf1);
    const clients = alive.map(byPid).filter((p) => p !== host);
    const [first, during] = clients;
    const a0 = st.acks[first.pidv];
    await vote(first, target(first), { double: true });
    await oneEnvelope(first, a0, "stem");
    // Host herlaadt; ondertussen stemt `during`: die stem blijft in de outbox en wordt herhaald tot de host terug is
    const reloading = host.page.reload();
    await during.tap(`[data-act="vote-pick"][data-pid="${target(during)}"]`);
    await during.tap('[data-act="vote-submit"]');
    await reloading;
    await host.waitPhase("vote");
    await until(async () => (await S()).voted.includes(during.pidv), { timeout: 20000, msg: "stem van tijdens het herladen telt" });
    const s2 = await S();
    assert(s2.voted.includes(first.pidv) && s2.voted.includes(during.pidv), "stemmen van vóór en tijdens het herladen tellen");
    for (const p of room()) await until(async () => (await pill(p)) === "live", { timeout: 10000, msg: `${p.name}: weer Live na herladen host` });
    await shots("05b-gestemd");
    await voteOut(inf1, [first, during]);
    await elim("inf", { next: "Volgende ronde" });
  });
  await step("laatkomer Iris opent de deellink zonder profiel → kijkt mee", async () => {
    await host.tap('[data-act="next"]');
    await all((p) => p.waitPhase("hints"));
    iris = await env.phone("Iris");
    await iris.goto(link);
    await iris.page.waitForSelector('section[data-screen="online"].active [data-act="quick-name"]');
    await until(async () => (await iris.page.$$eval(IN('[data-act="code"]'), (b) => b.map((x) => x.value).join(""))) === code, { msg: "code voorgevuld vanuit de link" });
    assert(new RegExp("kamer " + code).test(await iris.text(".o-quick")), "zonder profiel: alleen een naamveld voor deze kamer");
    await iris.page.fill(IN('[data-act="quick-name"]'), "Iris");
    await iris.tap(IN('[data-act="quick-go"]'));
    await iris.waitPhase("hints");
    await enter(iris);
    await iris.page.waitForSelector(".o-watch-pill:has-text('Je kijkt mee')", { timeout: 8000 });
    const me = (await iris.debug()).pub.players.find((x) => x.pid === iris.pidv);
    assert(me.spectator && !me.alive, "Iris is toeschouwer");
    await iris.shot("09-meekijken");
  });
  await step("potje 2 ronde 2: host slaat een beurt over, dan 'Nu stemmen'", async () => {
    const st = await hints(async (sp, s, nr) => {
      if (nr === 0) { await host.tap('[data-act="skip"]'); return true; }
      if (s.turn.hintRound === 2) { await host.tap('[data-act="force-vote"]'); return "stop"; }
      return false;
    });
    await all((p) => p.waitPhase("vote"));
    const s = await S();
    eq(s.phase, "vote", "Nu stemmen");
    assert(s.hints.some((x) => x.skipped && x.round === 2), "overgeslagen beurt staat in de hints");
    // "Bekijk hints" tijdens het stemmen: alle hints, de overgeslagen beurt als "—"
    await sanne.tap('[data-act="hints-sheet"]');
    await sanne.page.waitForSelector(".o-sheet-wrap.open .o-feed .o-bub", { timeout: 5000 });
    eq(await sanne.page.$$eval(".o-sheet-wrap.open .o-feed .o-bub", (b) => b.length), s.hints.length, "hints-sheet toont alle hints");
    eq(await sanne.page.$$eval(".o-sheet-wrap.open .o-bub.is-skip .o-bub-t", (b) => b.map((x) => x.textContent)), ["—"], "overgeslagen beurt als —");
    await sanne.shot("09b-hints-sheet");
    await sanne.page.keyboard.press("Escape");
    await sanne.page.waitForSelector(".o-sheet-wrap", { state: "detached", timeout: 5000 });
  });
  await step("gelijkspel → herstemming → weer gelijk → Niemand eruit!", async () => {
    const st = await S();
    const alive = aliveOf(st);
    eq(alive.length, 4, "4 levende spelers");
    const [A, B, X, Y] = alive.map(byPid);
    const plan = [[A, B], [B, A], [X, A], [Y, B]];
    for (const [p, t] of plan) await vote(p, t.pidv);
    await all((p) => p.page.waitForSelector(".o-vote.is-revote .o-revote", { timeout: 15000 }));
    const s1 = await S();
    eq([s1.phase, s1.revote, s1.candidates], ["vote", true, [A.pidv, B.pidv]], "herstemming tussen de koplopers");
    eq((await X.page.$$eval('[data-act="vote-pick"]', (b) => b.map((x) => x.dataset.pid))).sort(), [A.pidv, B.pidv].sort(), "alleen kandidaten op de stemkaart");
    eq(await A.page.$$eval('[data-act="vote-pick"]', (b) => b.map((x) => x.dataset.pid)), [B.pidv], "kandidaat ziet alleen de ander");
    assert(/Gelijkspel! Nog één keer/.test(await sanne.text(".o-stage")), "Sanne ziet 'Gelijkspel! Nog één keer'");
    await iris.page.waitForSelector(".o-locked:has-text('Je kijkt mee')");
    await shots("10-herstemming");
    for (const [p, t] of plan) await vote(p, t.pidv);
    await elim("tie", { next: "Volgende ronde", shot: "11-gelijkspel" });
    const s2 = await S();
    eq([s2.lastVote.eliminated, s2.lastVote.tie, s2.lastVote.revote], [null, true, true], "dubbel gelijkspel: niemand eruit");
    eq(aliveOf(s2).length, 4, "nog steeds 4 levende spelers");
  });
  await step("potje 2 ronde 3 (host zonder animaties, trage telefoon): dubbel tikken op Volgende ronde en Uitslag slaat niets over", async () => {
    // Minder beweging = geen View Transition: het scherm wisselt meteen, net als op iOS < 18. Een tweede tik op
    // dezelfde plek mag dan niet op de knop van de nieuwe fase landen ("Nu stemmen", "Nog een potje"), ook niet
    // als de telefoon even hangt en die tik pas later verwerkt.
    await host.page.emulateMedia({ reducedMotion: "reduce" });
    await doubleTap(host, '[data-act="next"]', 120, { jank: 900 });
    await all((p) => p.waitPhase("hints"));
    await sleep(800);
    const h3 = await S();
    eq([h3.phase, h3.round, h3.hints.filter((x) => x.round === 3).length], ["hints", 3, 0], "na dubbel tikken op Volgende ronde: ronde 3, nog niemand overgeslagen");
    await host.tap('[data-act="force-vote"]');
    await all((p) => p.waitPhase("vote"));
    const st = await S();
    const inf2 = st.order.find((pid) => st.roles[pid] === "infiltrant" && aliveOf(st).includes(pid));
    await voteOut(inf2);
    await elim("inf", { next: "Uitslag" });
    await doubleTap(host, '[data-act="next"]', 120, { jank: 900 });
    await over("BURGERS WINNEN");
    await sleep(1500);
    eq([(await S()).phase, (await S()).gameNo], ["over", 2], "dubbel tikken op Uitslag slaat de uitslag niet over");
    for (const p of room()) eq(await p.phase(), "over", `${p.name}: blijft op de uitslag`);
    await host.page.emulateMedia({ reducedMotion: "no-preference" });
  });
  await step("Naar de lobby → iedereen in de lobby, Iris speelt nu mee", async () => {
    await host.tap('[data-act="to-lobby"]');
    await all((p) => p.waitPhase("lobby"));
    const st = await S();
    eq(st.players.length, 6, "6 spelers in de lobby");
    const me = st.players.find((x) => x.pid === iris.pidv);
    assert(me && !me.spectator && me.alive, "Iris is geen toeschouwer meer");
  });

  // =========================================================
  // b) Blind-modus: infiltrant raadt het woord
  // =========================================================
  await step("blind-modus: instellingen → start → alleen de infiltrant weet het", async () => {
    await host.tap('[data-act="mode"][data-v="blind"]');
    await host.tap('[data-act="seg-infiltrants"][data-v="1"]');
    await host.tap('[data-act="seg-hintRounds"][data-v="1"]');
    await host.tap('[data-act="cat"][data-v=""]');
    for (const p of [sanne, iris]) {
      await until(async () => JSON.stringify(await rules(p)) === JSON.stringify(["Geen woord", "1 infiltrant", "1 hint-ronde", "Geen timer", "Alle categorieën"]),
        { msg: `${p.name} ziet blind-modus` });
    }
    await host.tap('[data-act="start"]');
    const seen = await revealAll({ shotLabel: "12-blind-kaart" });
    const st = await S();
    const infs = Object.keys(st.roles).filter((pid) => st.roles[pid] === "infiltrant");
    eq(infs.length, 1, "1 infiltrant");
    for (const p of room()) {
      const want = st.roles[p.pidv] === "infiltrant" ? "JIJ BENT DE INFILTRANT" : st.words.burger;
      eq(seen[p.pidv].word, want, `${p.name}: blind-kaart`);
      eq(seen[p.pidv].cat, DV_WORDCATS[st.words.category], `${p.name}: categorie zichtbaar`);
    }
  });
  await step("blind: hints, infiltrant ontmaskerd, raadt het woord → INFILTRANT WINT", async () => {
    const st = await hints();
    const inf = Object.keys(st.roles).find((pid) => st.roles[pid] === "infiltrant");
    await voteOut(inf);
    await all((p) => p.waitPhase("guess"));
    const g = byPid(inf);
    await g.page.waitForSelector('[data-act="guess-input"]', { state: "visible", timeout: 15000 });
    for (const p of room()) if (p !== g) await p.page.waitForSelector("text=De infiltrant mag nog één keer raden", { timeout: 15000 });
    await Promise.all([g, room().find((p) => p !== g && (p === host || p === sanne))].map((p) => p.shot("13-raden")));
    const word = st.words.burger;
    await g.fill('[data-act="guess-input"]', ` ${word.toUpperCase()}! `); // hoofdletters/leestekens tellen niet
    const a0 = (await S()).acks[g.pidv];
    await doubleTap(g, '[data-act="guess-send"]');
    if (g !== host) await oneEnvelope(g, a0, "gok");
    await all((p) => p.waitPhase("elim"));
    for (const p of room()) eq((await p.page.textContent(".o-gout-r", { timeout: 10000 })).trim(), "Goed! 😱", `${p.name}: gok goed`);
    await host.page.waitForSelector('[data-act="next"]', { state: "visible", timeout: 15000 });
    eq((await host.text('[data-act="next"] .o-btn-l')).trim(), "Uitslag", "na goede gok: Uitslag");
    await host.tap('[data-act="next"]');
    const s = await over("INFILTRANT WINT", "14-uitslag-infiltrant");
    eq(s.result.winner, "infiltranten", "winnaar");
    for (const p of room()) eq((await p.text(".o-wcard.is-i .o-wcard-w")).trim(), "geen woord", `${p.name}: infiltrant had geen woord`);
  });

  // =========================================================
  // e) Eruit zetten, vertrekken, kamer sluiten
  // =========================================================
  await step("host breekt een lopend potje af via de kamer-sheet ('Potje afbreken') → iedereen terug in de lobby, scores blijven", async () => {
    await host.tap('[data-act="to-lobby"]');
    await all((p) => p.waitPhase("lobby"));
    const scores = (await S()).scores;
    await host.tap('[data-act="start"]');
    await all((p) => p.waitPhase("reveal"));
    assert(!(await sanne.page.$('[data-act="end"]')), "niet-host heeft geen afbreek-knop");
    await host.tap(".o-bar-chip");
    await host.page.waitForSelector('.o-sheet-wrap.open [data-act="end"]', { timeout: 5000 });
    eq((await host.text('.o-sheet-wrap.open [data-act="end"]')).trim(), "Potje afbreken", "Infiltrant: eigen tekst op de knop");
    await host.tap('[data-act="end"]');
    await host.tap('[data-act="confirm"]');
    await all((p) => p.waitPhase("lobby"));
    const s = await S();
    eq([s.phase, s.result, s.scores], ["lobby", null, scores], "afgebroken potje: lobby, geen uitslag, scores onveranderd");
    for (const p of room()) eq((await p.debug()).priv, null, `${p.name}: geen woord meer na afbreken`);
  });
  await step("lobby: host zet Mo uit de kamer", async () => {
    await host.tap(`.o-pgrid [data-pid="${mo.pidv}"]`);
    await host.tap('[data-act="kick"]');
    await mo.waitPhase("ended");
    inRoom.delete(mo);
    assert(/Je bent uit de kamer gezet/.test(await mo.text(".o-stage")), "Mo ziet dat hij eruit is gezet");
    eq(await mo.session(), null, "Mo's sessie is opgeruimd");
    await mo.shot("15-eruit-gezet");
    await all((p) => p.page.waitForFunction(() => document.querySelectorAll(".o-pgrid .o-pcell:not(.o-ghost)").length === 5, null, { timeout: 10000 }));
    assert((await S()).removed.includes(mo.pidv), "Mo staat op de verwijderd-lijst");
  });
  await step("Iris verlaat de kamer", async () => {
    await iris.tap('[data-act="leave"]');
    await iris.tap('[data-act="confirm"]');
    await iris.page.waitForSelector('section[data-screen="online"].active', { timeout: 10000 });
    inRoom.delete(iris);
    await until(async () => (await S()).players.length === 4, { msg: "Iris is weg uit de kamer" });
  });
  await step("host sluit de kamer → iedereen krijgt het eindscherm", async () => {
    await host.tap('[data-act="leave"]');
    await host.tap('[data-act="confirm"]');
    await host.page.waitForSelector('section[data-screen="online"].active', { timeout: 10000 });
    for (const p of [sanne, jeroen, fleur]) {
      await p.waitPhase("ended");
      assert(/De host heeft de kamer gesloten/.test(await p.text(".o-stage")), `${p.name}: kamer gesloten`);
    }
    await sanne.shot("16-kamer-gesloten");
    eq(await host.page.evaluate(() => [localStorage.getItem("dva:session"), localStorage.getItem("dva:hostRoom")]), [null, null], "host-opslag opgeruimd");
  });
}
