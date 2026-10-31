// Kwaliteitschecks voor de Infiltrant-woordparen (online/words.js)
const test = require("node:test");
const assert = require("node:assert/strict");
const { DV_WORDCATS, DV_WORDPAIRS } = require("../online/words.js");

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

test("exports categorieën en paren", () => {
  assert.equal(typeof DV_WORDCATS, "object");
  assert.ok(Array.isArray(DV_WORDPAIRS));
  const ids = Object.keys(DV_WORDCATS);
  assert.ok(ids.length >= 8, "minstens 8 categorieën");
  for (const id of ids) {
    assert.match(id, /^[a-z]+$/, `categorie-id ${id}`);
    assert.equal(typeof DV_WORDCATS[id], "string");
    assert.ok(/^\P{L}+ \p{Lu}/u.test(DV_WORDCATS[id]), `label met emoji: ${DV_WORDCATS[id]}`);
  }
});

test("genoeg paren, elke categorie gevuld", () => {
  assert.ok(DV_WORDPAIRS.length >= 220, `aantal paren: ${DV_WORDPAIRS.length}`);
  const perCat = {};
  for (const p of DV_WORDPAIRS) perCat[p.c] = (perCat[p.c] || 0) + 1;
  for (const id of Object.keys(DV_WORDCATS)) assert.ok((perCat[id] || 0) >= 15, `categorie ${id}: ${perCat[id] || 0} paren`);
});

test("structuur en vorm van elk paar", () => {
  for (const p of DV_WORDPAIRS) {
    assert.deepEqual(Object.keys(p).sort(), ["a", "b", "c"]);
    assert.ok(Object.prototype.hasOwnProperty.call(DV_WORDCATS, p.c), `onbekende categorie ${p.c}`);
    for (const w of [p.a, p.b]) {
      assert.equal(typeof w, "string");
      assert.equal(w, w.trim(), `spaties rond "${w}"`);
      assert.ok(w.length >= 2 && w.length <= 18, `lengte "${w}"`);
      assert.ok(w.split(" ").length <= 2, `max 2 woorden: "${w}"`);
      assert.match(w, /^\p{Lu}[\p{L} -]*$/u, `hoofdletter/tekens "${w}"`);
      assert.doesNotMatch(w, /\s{2}/, `dubbele spatie "${w}"`);
    }
    assert.notEqual(norm(p.a), norm(p.b), `a === b in ${p.a}/${p.b}`);
  }
});

test("geen dubbele paren (ook niet omgedraaid)", () => {
  const seen = new Set();
  for (const p of DV_WORDPAIRS) {
    const key = [norm(p.a), norm(p.b)].sort().join("|");
    assert.ok(!seen.has(key), `dubbel paar ${p.a}/${p.b}`);
    seen.add(key);
  }
});

test("geen woord in meer dan 2 paren", () => {
  const count = {};
  for (const p of DV_WORDPAIRS) for (const w of [p.a, p.b]) count[norm(w)] = (count[norm(w)] || 0) + 1;
  const over = Object.entries(count).filter(([, n]) => n > 2);
  assert.deepEqual(over, []);
});

test("geen woord is onderdeel van zijn partner (te makkelijk)", () => {
  for (const p of DV_WORDPAIRS) {
    const a = norm(p.a), b = norm(p.b);
    assert.ok(!a.includes(b) && !b.includes(a), `${p.a}/${p.b} lijken te veel op elkaar`);
  }
});
