// Inhoudschecks voor het Vuurwacht-script (online/story.js) tegen SPEC-3 §1–2.
// Draai: node --test online/minis/__tests__/story-content.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const story = require("../../story.js");

const MINI_IDS = ["blaasbalg", "bijl", "vonken", "slot", "echo", "snel", "verhaal"];
const PLAN = ["blaasbalg", "bijl", "vonken", "slot", "echo", "snel", "verhaal", null]; // minigame per hoofdstuk (SPEC-3 §1)
const MOODS = ["warm", "spooky", "cold", "dawn", "tense"];
const WHO = ["verteller", "gloei", "vorst", "A", "B"];
const PLACEHOLDERS = ["A", "B", "ALLEN", "X", "MVP", "VUUR"];
const STEP_KEYS = {
  scene: ["type", "mood", "lines", "if"],
  choice: ["type", "id", "prompt", "options", "if"],
  mini: ["type", "id", "difficulty", "intro", "win", "meh", "lose", "if"],
  fire: ["type", "delta", "line", "if"],
};
// Mogelijke blokken per minigame (SPEC-3 §5), om alle paden door het verhaal te lopen.
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const MINI_LOGS = {
  blaasbalg: range(-1, 3), bijl: range(-1, 4), vonken: range(-2, 3), slot: range(-1, 4),
  echo: [-1, 1, 2, 3, 4], snel: range(0, 3), verhaal: range(1, 3),
};

const isInt = Number.isInteger;
const keysIn = (obj, allowed, where) => {
  for (const k of Object.keys(obj)) assert.ok(allowed.includes(k), `${where}: onbekend veld "${k}"`);
};
const minutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h < 12 ? h + 24 : h) * 60 + m; // de nacht loopt over middernacht heen
};

// Alle stappen met hun plek, plus elke tekst die op een scherm komt.
function* allSteps() {
  for (const [ci, ch] of story.chapters.entries()) for (const [si, st] of ch.steps.entries()) yield { ci, si, ch, st, at: `${ch.id}[${si}]` };
}
function allTexts() {
  const out = [["titel", story.title], ["ondertitel", story.subtitle]];
  for (const ch of story.chapters) {
    out.push([`${ch.id}.title`, ch.title]);
    if (ch.tagline) out.push([`${ch.id}.tagline`, ch.tagline]);
  }
  for (const { st, at } of allSteps()) {
    if (st.lines) st.lines.forEach((l, i) => out.push([`${at}.lines[${i}]`, l.text]));
    if (st.type === "choice") {
      out.push([`${at}.prompt`, st.prompt]);
      st.options.forEach((o, i) => { out.push([`${at}.options[${i}]`, o.text]); if (o.hint) out.push([`${at}.hint[${i}]`, o.hint]); });
    }
    if (st.type === "mini") for (const k of ["intro", "win", "meh", "lose"]) out.push([`${at}.${k}`, st[k]]);
    if (st.type === "fire" && st.line) out.push([`${at}.line`, st.line.text]);
  }
  for (const e of story.endings) { out.push([`einde ${e.id}.title`, e.title]); e.lines.forEach((l, i) => out.push([`einde ${e.id}[${i}]`, l.text])); }
  out.push(["fail.title", story.fail.title]);
  story.fail.lines.forEach((l, i) => out.push([`fail[${i}]`, l.text]));
  return out;
}
const allLines = () => [
  ...[...allSteps()].flatMap(({ st }) => (st.lines || []).concat(st.line ? [st.line] : [])),
  ...story.endings.flatMap((e) => e.lines),
  ...story.fail.lines,
];

// Welke waarden kan elke flag krijgen (uit choice-opties)?
function flagValues() {
  const vals = {};
  for (const { st } of allSteps()) {
    if (st.type !== "choice") continue;
    for (const o of st.options) for (const [f, v] of Object.entries(o.set || {})) (vals[f] = vals[f] || new Set()).add(v);
  }
  return vals;
}

// ---------- Interpreter (zoals SPEC-3 §2/§3 het beschrijft) ----------
function passes(cond, st) {
  if (!cond) return true;
  if ("flag" in cond) return "eq" in cond ? st.flags[cond.flag] === cond.eq : st.flags[cond.flag] !== cond.ne;
  if ("fireGte" in cond) return st.fire >= cond.fireGte;
  if ("fireLte" in cond) return st.fire <= cond.fireLte;
  if ("players" in cond) return st.players >= Number(/^>=(\d+)$/.exec(cond.players)[1]);
  throw new Error("onbekende voorwaarde " + JSON.stringify(cond));
}
function endingFor(st) {
  return story.endings.find(({ cond: c }) =>
    (c.fireGte == null || st.fire >= c.fireGte) && (c.fireLte == null || st.fire <= c.fireLte) &&
    (c.flag == null || st.flags[c.flag] === c.eq));
}

// Loopt elk pad door het verhaal: elke keuze-optie × elke minigame-uitkomst (staten worden ontdubbeld).
function walk(players) {
  const clamp = (n) => Math.max(0, Math.min(story.maxFire, n));
  const res = { endings: {}, fails: {}, shown: new Set(), scenes: {}, finals: [] };
  const seen = new Set();
  const stack = [{ ch: 0, si: -1, fire: story.startFire, flags: {}, scenes: 0, players }];
  const failAt = (st) => { const id = story.chapters[st.ch].id; res.fails[id] = (res.fails[id] || 0) + 1; };
  while (stack.length) {
    const st = stack.pop();
    const key = JSON.stringify([st.ch, st.si, st.fire, st.scenes, Object.entries(st.flags).sort()]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (st.ch === story.chapters.length) {
      const e = endingFor(st);
      res.endings[e.id] = (res.endings[e.id] || 0) + 1;
      res.finals.push({ ending: e.id, fire: st.fire, flags: st.flags });
      continue;
    }
    const chap = story.chapters[st.ch];
    const next = (patch) => stack.push(Object.assign({}, st, { si: st.si + 1 }, patch));
    const toFire = (fire, patch) => (fire <= 0 ? failAt(st) : next(Object.assign({ fire }, patch)));
    if (st.si === -1) { toFire(clamp(st.fire - chap.burn), { scenes: 0 }); continue; }
    if (st.si === chap.steps.length) {
      const r = (res.scenes[chap.id] = res.scenes[chap.id] || { min: Infinity, max: 0 });
      r.min = Math.min(r.min, st.scenes);
      r.max = Math.max(r.max, st.scenes);
      stack.push(Object.assign({}, st, { ch: st.ch + 1, si: -1, scenes: 0 }));
      continue;
    }
    const s = chap.steps[st.si];
    if (!passes(s.if, st)) { next({}); continue; }
    res.shown.add(`${chap.id}[${st.si}]`);
    if (s.type === "scene") next({ scenes: st.scenes + 1 });
    else if (s.type === "fire") toFire(clamp(st.fire + s.delta));
    else if (s.type === "mini") {
      for (const logs of MINI_LOGS[s.id] || [0]) toFire(clamp(st.fire + logs)); // onbekende id: zie de structuurtest
    } else if (s.type === "choice") {
      s.options.forEach((o, i) => {
        res.shown.add(`${chap.id}[${st.si}].${i}`);
        toFire(clamp(st.fire + (o.fire || 0)), { flags: Object.assign({}, st.flags, o.set) });
      });
    }
  }
  return res;
}
const walked = {};
const paths = (players) => walked[players] || (walked[players] = walk(players)); // lui: een fout landt in de juiste test

// ---------- Structuur ----------
test("UMD-export en basisvelden", () => {
  assert.equal(require("../../story.js").DV_STORY, story, "ook bruikbaar als { DV_STORY }");
  assert.equal(globalThis.DV_STORY, story, "zet de global DV_STORY");
  keysIn(story, ["id", "title", "subtitle", "startFire", "maxFire", "cast", "chapters", "endings", "fail"], "story");
  assert.equal(story.id, "vuurwacht");
  assert.equal(story.title, "Vuurwacht");
  assert.equal(typeof story.subtitle, "string");
  assert.ok(isInt(story.startFire) && isInt(story.maxFire) && story.startFire > 0 && story.startFire <= story.maxFire);
  assert.equal(story.maxFire, 10);
  for (const k of ["gloei", "vorst", "verteller"]) assert.equal(typeof story.cast[k].name, "string", `cast.${k}.name`);
  for (const k of ["gloei", "vorst"]) assert.match(story.cast[k].color, /^#[0-9a-f]{6}$/i, `cast.${k}.color`);
  assert.deepEqual(JSON.parse(JSON.stringify(story)), story, "puur JSON: geen functies, undefined of cycli");
});

test("hoofdstukken: 20:00 tot 06:00, oplopende tijden, burn", () => {
  const chs = story.chapters;
  assert.equal(chs.length, 8);
  assert.equal(chs[0].time, "20:00");
  assert.equal(chs[chs.length - 1].time, "06:00");
  const ids = new Set();
  chs.forEach((ch, i) => {
    keysIn(ch, ["id", "time", "title", "tagline", "burn", "steps"], `hoofdstuk ${i}`);
    assert.match(ch.id, /^[a-z]+$/, `id ${ch.id}`);
    assert.ok(!ids.has(ch.id), `dubbel id ${ch.id}`);
    ids.add(ch.id);
    assert.match(ch.time, /^([01]\d|2[0-3]):[0-5]\d$/, `tijd ${ch.time}`);
    if (i > 0) assert.ok(minutes(ch.time) > minutes(chs[i - 1].time), `${ch.time} komt na ${chs[i - 1].time}`);
    assert.ok(typeof ch.title === "string" && ch.title.length > 0 && ch.title.length <= 32, `titel ${ch.title}`);
    assert.ok(isInt(ch.burn) && ch.burn >= 0 && ch.burn <= 3, `${ch.id}: burn ${ch.burn}`);
    assert.ok(Array.isArray(ch.steps) && ch.steps.length > 0);
  });
  assert.equal(chs[0].burn, 0, "het proloog-vuur brandt nog niet af");
});

test("stappen hebben de vorm uit SPEC-3 §2", () => {
  const choiceIds = new Set();
  for (const { st, at } of allSteps()) {
    assert.ok(STEP_KEYS[st.type], `${at}: onbekend type ${st.type}`);
    keysIn(st, STEP_KEYS[st.type], at);
    if (st.if) {
      const c = st.if;
      const ok = (Object.keys(c).length === 2 && typeof c.flag === "string" && ("eq" in c || "ne" in c)) ||
        (Object.keys(c).length === 1 && (isInt(c.fireGte) || isInt(c.fireLte) || /^>=\d+$/.test(c.players)));
      assert.ok(ok, `${at}: ongeldige if ${JSON.stringify(c)}`);
    }
    if (st.type === "scene") {
      assert.ok(MOODS.includes(st.mood), `${at}: mood ${st.mood}`);
      assert.ok(st.lines.length >= 3 && st.lines.length <= 8, `${at}: ${st.lines.length} regels (3–8)`);
      for (const l of st.lines) { keysIn(l, ["who", "text"], at); assert.ok(WHO.includes(l.who), `${at}: who ${l.who}`); }
    } else if (st.type === "choice") {
      assert.match(st.id, /^[a-z]+$/);
      assert.ok(!choiceIds.has(st.id), `dubbele keuze ${st.id}`);
      choiceIds.add(st.id);
      assert.ok(st.options.length >= 2 && st.options.length <= 3, `${at}: ${st.options.length} opties (2–3)`);
      for (const o of st.options) {
        keysIn(o, ["text", "hint", "set", "fire"], `${at} optie`);
        assert.ok(o.text.length <= 60, `${at}: optietekst te lang voor een knop: ${o.text}`);
        if (o.hint !== undefined) assert.ok(o.hint.length <= 80, `${at}: hint te lang: ${o.hint}`);
        if (o.fire !== undefined) assert.ok(isInt(o.fire) && o.fire !== 0, `${at}: fire ${o.fire}`);
        assert.ok(o.set && typeof o.set === "object", `${at}: elke optie zet een flag`);
        for (const [f, v] of Object.entries(o.set)) {
          assert.match(f, /^[a-z]+$/, `${at}: flagnaam ${f}`);
          assert.equal(typeof v, "string", `${at}: flagwaarde ${f}`);
        }
      }
      const sets = st.options.map((o) => JSON.stringify(o.set) + "|" + (o.fire || 0));
      assert.equal(new Set(sets).size, sets.length, `${at}: opties met dezelfde gevolgen`);
    } else if (st.type === "mini") {
      assert.ok(MINI_IDS.includes(st.id), `${at}: onbekende minigame ${st.id}`);
      const d = st.difficulty;
      if (typeof d === "number") assert.ok([1, 2, 3].includes(d), `${at}: moeilijkheid ${d}`);
      else {
        keysIn(d, ["base", "ifFlag", "then"], `${at}.difficulty`);
        assert.ok([1, 2, 3].includes(d.base) && [1, 2, 3].includes(d.then) && d.base !== d.then, `${at}: moeilijkheid ${JSON.stringify(d)}`);
        assert.equal(Object.keys(d.ifFlag).length, 1, `${at}: ifFlag met één flag`);
      }
      for (const k of ["intro", "win", "meh", "lose"]) assert.ok(typeof st[k] === "string" && st[k].length > 0, `${at}.${k}`);
    } else if (st.type === "fire") {
      assert.ok(isInt(st.delta) && st.delta !== 0 && Math.abs(st.delta) <= 4, `${at}: delta ${st.delta}`);
      if (st.line) assert.ok(WHO.includes(st.line.who) && typeof st.line.text === "string", `${at}: line`);
    }
  }
});

test("precies de minigame uit de tabel, één per hoofdstuk", () => {
  story.chapters.forEach((ch, i) => {
    const minis = ch.steps.filter((s) => s.type === "mini");
    if (PLAN[i] === null) assert.equal(minis.length, 0, `${ch.id}: geen minigame bij dageraad`);
    else {
      assert.equal(minis.length, 1, `${ch.id}: één minigame`);
      assert.equal(minis[0].id, PLAN[i], `${ch.id}: verwacht ${PLAN[i]}`);
      assert.equal(minis[0].if, undefined, `${ch.id}: de minigame is nooit voorwaardelijk`);
    }
  });
});

test("endings en fail", () => {
  const es = story.endings;
  assert.ok(es.length >= 4, "minstens 4 eindes");
  assert.equal(new Set(es.map((e) => e.id)).size, es.length, "unieke ids");
  for (const e of es) {
    keysIn(e, ["id", "title", "good", "cond", "mood", "lines"], `einde ${e.id}`);
    keysIn(e.cond, ["fireGte", "fireLte", "flag", "eq"], `einde ${e.id}.cond`);
    assert.equal("flag" in e.cond, "eq" in e.cond, `${e.id}: flag en eq horen bij elkaar`);
    assert.ok(MOODS.includes(e.mood), `${e.id}: mood`);
    assert.equal(typeof e.good, "boolean");
    assert.ok(e.lines.length >= 3 && e.lines.length <= 8, `${e.id}: ${e.lines.length} regels`);
    for (const l of e.lines) assert.ok(WHO.includes(l.who));
  }
  assert.deepEqual(es[es.length - 1].cond, {}, "de laatste afloop is het vangnet");
  const legende = es.find((e) => e.id === "legende");
  assert.ok(legende && legende.cond.fireGte === 8 && legende.cond.flag === "belofte", "Legende: vuur ≥ 8 en de belofte");
  assert.equal(typeof story.fail.title, "string");
  keysIn(story.fail, ["title", "lines"], "fail");
  assert.ok(story.fail.lines.length >= 3 && story.fail.lines.length <= 8);
});

// ---------- Tekst ----------
test("teksten: max 140 tekens, alleen bekende placeholders, netjes", () => {
  for (const [at, t] of allTexts()) {
    assert.equal(typeof t, "string", at);
    assert.ok(t.length > 0 && t.length <= 140, `${at}: ${t.length} tekens`);
    assert.equal(t, t.trim(), `${at}: spaties aan de rand`);
    assert.doesNotMatch(t, /\s{2}/, `${at}: dubbele spatie`);
    assert.doesNotMatch(t, /"/, `${at}: gebruik ‘ ’ voor citaten`);
    for (const [, name] of t.matchAll(/\{([^{}]*)\}/g)) assert.ok(PLACEHOLDERS.includes(name), `${at}: onbekende placeholder {${name}}`);
    assert.doesNotMatch(t.replace(/\{(A|B|ALLEN|X|MVP|VUUR)\}/g, ""), /[{}]/, `${at}: losse accolade`);
  }
  for (const l of allLines()) assert.match(l.text, /[.!?…’]$/, `regel zonder slotteken: ${l.text}`);
});

test("placeholders worden echt gebruikt", () => {
  const all = allTexts().map(([, t]) => t).join("\n");
  const count = (p) => all.split(`{${p}}`).length - 1;
  for (const p of ["X", "MVP", "VUUR"]) assert.ok(count(p) >= 2, `{${p}} ${count(p)}×`);
  for (const p of ["A", "B", "ALLEN"]) assert.ok(count(p) >= 1, `{${p}} ontbreekt`);
  for (const l of allLines()) {
    if (l.who === "A") assert.doesNotMatch(l.text, /\{A\}/, "speler A noemt zichzelf niet");
    if (l.who === "B") assert.doesNotMatch(l.text, /\{B\}/, "speler B noemt zichzelf niet");
  }
});

test("stem en toon: geen anglicismen of grofheid, de Vorst schreeuwt nooit", () => {
  const banned = /(^|[^\p{L}])(oké|okay|ok|sorry|deal|cool|game|level|team|nice|chill|relax|fuck|shit|kut|sexy|lol)(?=$|[^\p{L}])/iu;
  for (const [at, t] of allTexts()) assert.doesNotMatch(t, banned, `${at}: ${t}`);
  const lines = allLines();
  const vorst = lines.filter((l) => l.who === "vorst");
  assert.ok(vorst.length >= 8, "de Vorst komt genoeg aan het woord");
  for (const l of vorst) {
    assert.doesNotMatch(l.text, /!/, `de Vorst schreeuwt niet: ${l.text}`);
    assert.doesNotMatch(l.text, /\b\p{Lu}{2,}\b/u, `geen hoofdletters bij de Vorst: ${l.text}`);
    assert.ok(l.text.length <= 100, `de Vorst houdt het kort: ${l.text}`);
  }
  const players = lines.filter((l) => l.who === "A" || l.who === "B").length;
  assert.ok(players / lines.length <= 0.15, `spelers krijgen maar af en toe een regel (${players}/${lines.length})`);
  assert.ok(lines.filter((l) => l.who === "gloei").length >= lines.length / 3, "Gloei is de ster (vindt hij zelf ook)");
});

test("running gags komen terug", () => {
  const perChapter = (re) => story.chapters.filter((ch) => JSON.stringify(ch).match(re)).length;
  assert.ok(perChapter(/kleed/i) >= 4, "het oude kleed");
  assert.ok(perChapter(/die fles/) >= 2, "die fles");
  assert.ok(perChapter(/houtmand/) >= 3, "de lege houtmand");
  assert.ok(perChapter(/beleefd|dank u|neemt u|denkt u|als het u schikt/i) >= 3, "de beleefde Vorst");
  assert.ok(/Vlammetje/.test(JSON.stringify(story.endings.find((e) => e.id === "legende"))), "Gloei's geheim");
});

// ---------- Flags en paden ----------
test("elke flag in een if/cond/ifFlag wordt eerder gezet, met een bestaande waarde", () => {
  const vals = flagValues();
  const setSoFar = new Set();
  const used = new Set();
  const check = (f, v, at) => {
    assert.ok(setSoFar.has(f), `${at}: flag "${f}" wordt pas later (of nooit) gezet`);
    assert.ok(vals[f].has(v), `${at}: "${f}" wordt nooit "${v}"`);
    used.add(f);
  };
  for (const { st, at } of allSteps()) {
    if (st.if && st.if.flag) check(st.if.flag, "eq" in st.if ? st.if.eq : st.if.ne, at);
    if (st.type === "mini" && typeof st.difficulty === "object") for (const [f, v] of Object.entries(st.difficulty.ifFlag)) check(f, v, at);
    if (st.type === "choice") for (const o of st.options) for (const f of Object.keys(o.set || {})) setSoFar.add(f);
  }
  for (const e of story.endings) if (e.cond.flag) check(e.cond.flag, e.cond.eq, `einde ${e.id}`);
  for (const f of Object.keys(vals)) assert.ok(used.has(f), `flag "${f}" wordt gezet maar doet nergens toe`);
});

test("elke keuze heeft gevolgen: elke optie verandert het vuur of een latere stap", () => {
  // "f=v": iets gebeurt als f gelijk is aan v. "f!=w": iets gebeurt als f níét w is (ne, of de base van een ifFlag).
  const eq = new Set(), ne = [];
  for (const { st } of allSteps()) {
    if (st.if && st.if.flag) "eq" in st.if ? eq.add(`${st.if.flag}=${st.if.eq}`) : ne.push([st.if.flag, st.if.ne]);
    if (st.type === "mini" && typeof st.difficulty === "object") {
      for (const [f, v] of Object.entries(st.difficulty.ifFlag)) { eq.add(`${f}=${v}`); ne.push([f, v]); }
    }
  }
  for (const e of story.endings) if (e.cond.flag) eq.add(`${e.cond.flag}=${e.cond.eq}`);
  const matters = (f, v) => eq.has(`${f}=${v}`) || ne.some(([g, w]) => g === f && w !== v);
  for (const { st, at } of allSteps()) {
    if (st.type !== "choice") continue;
    for (const o of st.options) {
      const ok = o.fire || Object.entries(o.set).some(([f, v]) => matters(f, v));
      assert.ok(ok, `${at}: optie "${o.text}" heeft geen gevolg`);
    }
  }
});

test("elk einde is bereikbaar, en het vuur kan ook uitgaan", () => {
  const duo = paths(2);
  for (const e of story.endings) assert.ok(duo.endings[e.id] > 0, `einde ${e.id} is onbereikbaar`);
  assert.ok(Object.keys(duo.fails).length > 0, "het vuur kan uitgaan");
  const legende = duo.finals.filter((f) => f.ending === "legende");
  assert.ok(legende.every((f) => f.flags.belofte === "ja" && f.flags.aanbod === "nee" && f.fire >= 8));
  const nippertje = duo.finals.filter((f) => f.ending === "nippertje");
  assert.ok(nippertje.every((f) => f.fire >= 1 && f.fire <= 3), "Op het nippertje = vuur 1–3");
  assert.ok(duo.finals.filter((f) => f.ending === "vuurwachters").every((f) => f.fire >= 4));
  assert.ok(duo.finals.filter((f) => f.flags.aanbod === "ja").every((f) => f.ending === "koud"), "het aanbod van de Vorst kost je altijd iets");
});

test("elke voorwaardelijke stap en elke optie komt in een pad voor", () => {
  const duo = paths(2), trio = paths(3);
  for (const { st, ch, si, at } of allSteps()) {
    const shown = duo.shown.has(`${ch.id}[${si}]`) || trio.shown.has(`${ch.id}[${si}]`);
    assert.ok(shown, `${at} wordt nooit getoond`);
    if (st.type === "choice") st.options.forEach((o, i) => assert.ok(duo.shown.has(`${ch.id}[${si}].${i}`), `${at}: optie ${i} nooit gekozen`));
  }
  assert.ok(!duo.shown.has(`hout[1]`) && trio.shown.has(`hout[1]`), "de scène voor 3+ spelers verschijnt alleen bij 3+");
});

test("1–3 scènes per hoofdstuk, op elk pad (2 en 3 spelers)", () => {
  for (const res of [paths(2), paths(3)]) {
    for (const ch of story.chapters) {
      const r = res.scenes[ch.id];
      assert.ok(r, `${ch.id} nooit uitgespeeld`);
      assert.ok(r.min >= 1 && r.max <= 3, `${ch.id}: ${r.min}–${r.max} scènes`);
    }
  }
});

test("leeslengte past bij ~25–35 minuten", () => {
  const lines = allLines().length;
  assert.ok(lines >= 90 && lines <= 220, `${lines} regels in totaal`);
  const words = allTexts().reduce((n, [, t]) => n + t.split(/\s+/).length, 0);
  assert.ok(words <= 4500, `${words} woorden`);
});
