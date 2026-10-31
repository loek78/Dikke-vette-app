// DVArcadeUI — "Minigames": kamer-UI van de arcade (SPEC-3 §4/§7). Bouwt op DVStoryUI.shell (zelfde HUD-vuurmeter,
// haard, minigame-podium en uitslagblokken), dus online/story-ui.js moet eerder geladen zijn.
//
//   DVArcadeUI.render(root, { pub, priv, me, players, api })   — idempotent, net als DVStoryUI.render
//     pub (DVArcade.publicView): { game: "arcade", phase: "lobby"|"pick"|"mini"|"miniResult", fire, maxFire, settings: { difficulty },
//            scores: { [pid]: punten }, stats: { arcade: { records: { [miniId]: { best, plays, last } } } }, mini, miniResult, lastMini }
//     miniResult: { id, logs, lines, mvp, perPlayer, verdict, fireBefore, fireAfter, points: { pid: n }, record, best, nonce }
//     acties via api.send: settings { difficulty } (host, live voor de rest), pick { id, difficulty } (host: kiest én start),
//                          mini { k, nonce, r|a } (via de runner), next {} (host: uitslag → kiezen), skipMini {} (host)
//   DVArcadeUI.destroy(root)
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const UI = () => window.DVStoryUI;
  const DIFF = [{ n: 1, name: "Rustig", sub: "chill" }, { n: 2, name: "Stevig", sub: "normaal" }, { n: 3, name: "Heet", sub: "pittig" }];
  const KIND = { local: "Ieder zelf", net: "Samen" };

  // Punten voor deze ronde: engine-waarde als die er is, anders de gebruikelijke rekensom (blokken + 1 voor de mvp).
  function roundPoints(r, pid) {
    const pp = r.points && typeof r.points === "object" ? r.points[pid] : null;
    if (Number.isFinite(pp)) return pp;
    return Math.max(0, Number(r.logs) || 0) + (r.mvp === pid ? 1 : 0);
  }
  const fmtPts = (n) => (n > 0 ? "+" + n : String(n));

  const recordsOf = (pub) => (pub.stats && pub.stats.arcade && pub.stats.arcade.records) || pub.records || {};
  const pointsOf = (pub) => (pub.scores && typeof pub.scores === "object" ? pub.scores : pub.points) || {};
  const diffOf = (pub) => { const d = pub.settings && +pub.settings.difficulty; return d >= 1 && d <= 3 ? d : 2; };

  // ---------- Kiezen ----------
  function pickView(S, c) {
    const P = UI().parts, h = P.h;
    const minis = window.DVMini ? window.DVMini.list() : [];
    let sel = null, diff = diffOf(c.pub), sent = false, diffTouched = false;
    const stand = h("div", { class: "ar-stand", role: "list" });
    const grid = h("div", { class: "ar-grid", role: "group", "aria-label": "Minigames" });
    const cards = new Map();
    minis.forEach((def, i) => {
      const rec = h("div", { class: "rec" });
      const card = h("button", { class: "ar-card", type: "button", "data-mini": def.id, style: { "--i": i }, onclick() {
        if (!c.me.isHost || sent) return;
        sel = def.id; P.sfx.beep(620, 0.05, "triangle", 0.08); P.sfx.buzz(8); paint(c);
      } }, h("span", { class: "chk", text: "✓" }), h("span", { class: "ic", text: def.icon || "🎮" }), h("b", { text: def.title || def.id }),
        h("span", { class: "kind " + def.kind, text: KIND[def.kind] || "" }), rec);
      cards.set(def.id, { card, rec });
      grid.append(card);
    });
    const diffBox = h("div", { class: "ar-diff", role: "group", "aria-label": "Moeilijkheid" }, DIFF.map((d) => h("button", { type: "button", "data-diff": d.n, onclick() {
      if (!c.me.isHost || sent) return;
      diff = d.n; diffTouched = true; P.sfx.beep(520 + d.n * 80, 0.05, "triangle", 0.08);
      c.send("settings", { difficulty: d.n }); // live zichtbaar voor de rest
      paint(c);
    } }, d.name, h("i", { text: d.sub }))));
    const play = h("button", { class: "sv-btn wide", type: "button", "data-act": "pick", text: "Speel", onclick() {
      if (!sel || sent) return;
      sent = true; P.sfx.beep(700, 0.08, "triangle", 0.1); P.sfx.buzz(14);
      c.send("pick", { id: sel, difficulty: diff });
      paint(c);
    } });
    const wait = h("div", { class: "ar-wait" });
    const plays = Object.values(recordsOf(c.pub)).reduce((s, r) => s + ((r && r.plays) || 0), 0);
    const el = h("div", { class: "sv-view" }, h("div", { class: "ar-pick" },
      h("div", { class: "ar-head" }, h("div", null, h("p", { class: "sv-kicker", text: `Arcade${plays ? " · " + plays + (plays === 1 ? " potje" : " potjes") + " gespeeld" : ""}` }), h("h1", { class: "sv-h1", text: "Minigames" }))),
      stand, grid, diffBox), h("div", { class: "ar-foot sv-actions" }, play, wait));
    function paint(cc) {
      c = cc;
      const recs = recordsOf(c.pub);
      const pts = pointsOf(c.pub);
      if (!c.me.isHost || !diffTouched) diff = diffOf(c.pub);
      cards.forEach(({ card, rec }, id) => {
        card.classList.toggle("sel", sel === id);
        card.disabled = !c.me.isHost || sent;
        const r = recs[id];
        const txt = r && r.plays > 0 ? ["Record ", h("b", { text: fmtPts(r.best) }), ` · ${r.plays}× gespeeld`] : ["Nog niet gespeeld"];
        rec.replaceChildren(...txt.map((t) => (typeof t === "string" ? document.createTextNode(t) : t)));
      });
      [...diffBox.children].forEach((b) => { b.classList.toggle("on", +b.dataset.diff === diff); b.disabled = !c.me.isHost || sent; });
      const ranked = c.active.slice().sort((a, b) => (pts[b.pid] || 0) - (pts[a.pid] || 0));
      const top = ranked.length ? pts[ranked[0].pid] || 0 : 0;
      P.keyed(stand, ranked, (p) => p.pid, (p) => h("span", { class: "s", role: "listitem" }, P.avatar(p, "xs"), h("span"), h("b")), (elm, p) => {
        P.setText(elm.children[1], p.name); P.setText(elm.children[2], String(pts[p.pid] || 0));
        elm.classList.toggle("lead", top > 0 && (pts[p.pid] || 0) === top);
      });
      const def = sel && window.DVMini ? window.DVMini.get(sel) : null;
      play.hidden = !c.me.isHost;
      play.disabled = !sel || sent;
      P.setText(play, sent ? "Starten…" : def ? `Speel ${def.title} →` : "Kies een minigame");
      wait.hidden = c.me.isHost;
      const host = c.P(c.pub.hostPid);
      P.setText(wait, `${(host && host.name) || "De host"} kiest een minigame… · niveau ${DIFF[diff - 1] ? DIFF[diff - 1].name : diff}`);
    }
    return { el, update: paint, destroy() {} };
  }

  // ---------- Spelen ----------
  function miniView(S, c) {
    const P = UI().parts;
    const stage = P.miniStage(S, c, { intro: null });
    const el = P.h("div", { class: "sv-view" }, stage.el);
    return { el, update(cc) { stage.sync(cc); }, mounted(cc) { stage.fit(); stage.sync(cc); }, destroy() { stage.destroy(); } };
  }

  // ---------- Uitslag + stand ----------
  function resultView(S, c) {
    const P = UI().parts, h = P.h;
    const T = P.timers();
    const r = c.pub.miniResult || {};
    const def = P.miniDef(r.id || (c.pub.mini && c.pub.mini.id));
    const head = P.resultHead(r, def);
    const isRecord = !!r.record && (Number(r.logs) || 0) > 0 && def;
    const table = h("div", { class: "ar-table", role: "list" });
    const host = c.P(c.pub.hostPid);
    const next = h("button", { class: "sv-btn wide", type: "button", "data-act": "next", text: "Volgende minigame →", onclick() { next.disabled = true; P.sfx.beep(600, 0.08, "triangle", 0.1); c.send("next", {}); } });
    const wait = h("div", { class: "ar-wait" });
    const el = h("div", { class: "sv-view" }, h("div", { class: "sv-res ar-res" },
      head.el,
      isRecord ? h("div", { style: { "text-align": "center" } }, h("span", { class: "ar-rec", text: `🏆 Nieuw record voor ${def.title}: ${fmtPts(r.logs)}` })) : null,
      P.resultLines(r.lines),
      P.resultPlayers(c, r, { points: (pid) => fmtPts(roundPoints(r, pid)) }),
      h("p", { class: "sv-kicker ash", text: "Stand" }), table),
      h("div", { class: "sv-actions" }, next, wait));
    const alreadyIn = Array.isArray(c.pub.ready) && c.pub.ready.includes(c.me.pid);
    return {
      el,
      update(cc) {
        c = cc;
        const pts = pointsOf(c.pub);
        const ranked = c.active.slice().sort((a, b) => (pts[b.pid] || 0) - (pts[a.pid] || 0));
        P.keyed(table, ranked, (p) => p.pid, (p, i) => h("div", { class: "r", role: "listitem", style: { "animation-delay": (1 + i * 0.1).toFixed(2) + "s" } }, h("span", { class: "rk" }), P.avatar(p, "sm"), h("span", { class: "nm" }), h("span", { class: "pt" })), (elm, p, i) => {
          P.setText(elm.children[0], i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1));
          P.setText(elm.children[2], p.name);
          elm.children[3].replaceChildren(document.createTextNode(String(pts[p.pid] || 0)), h("small", { text: fmtPts(roundPoints(r, p.pid)) }));
          elm.classList.toggle("first", i === 0);
        });
        next.hidden = !c.me.isHost;
        wait.hidden = c.me.isHost;
        P.setText(wait, `${(host && host.name) || "De host"} kiest zo de volgende minigame…`);
      },
      mounted() {
        if (alreadyIn) return;
        if (head.verdict === "win") { P.sfx.fanfare(); P.sfx.buzz([30, 40, 30, 40, 80]); } else if (head.verdict === "lose") { P.sfx.beep(220, 0.3, "sine", 0.08); P.sfx.buzz(60); } else P.sfx.beep(520, 0.1, "triangle", 0.08);
        P.animateLogs(S, head, r, T, c.pub.maxFire);
      },
      destroy() { T.clear(); S.hud.show(null); },
    };
  }

  function render(root, data) {
    const U = UI();
    if (!root || !U) return;
    const S = U.shell(root);
    const c = U.ctxOf(data);
    const p = c.pub, ph = p.phase || "lobby", n = p.mini ? p.mini.nonce : 0;
    let key, make, o = { phase: "ar-" + ph, mood: "warm", hud: "compact", hearth: "xs", frost: "off" };
    const last = p.lastMini && p.lastMini.nonce != null ? p.lastMini.nonce : p.miniResult && p.miniResult.nonce != null ? p.miniResult.nonce : 0;
    switch (ph) {
      case "pick": key = `ar:pick:${last}`; make = pickView; break;
      case "mini": key = `ar:mini:${n}`; make = miniView; o.hearth = null; break;
      case "miniResult": {
        key = `ar:res:${p.miniResult && p.miniResult.nonce != null ? p.miniResult.nonce : n}`; make = resultView;
        const v = p.miniResult && (p.miniResult.verdict || (p.miniResult.logs < 0 ? "lose" : "win"));
        o.mood = v === "lose" ? "cold" : v === "meh" ? "tense" : "warm";
        break;
      }
      default: key = "ar:" + ph; make = (SS, cc) => U.parts.VIEWS.plain(SS, cc, "De host zet de arcade klaar…", "🎮"); o.hud = false; o.hearth = null;
    }
    S.apply(c, o);
    S.setView(key, make, c);
    return S;
  }

  window.DVArcadeUI = { render, destroy(root) { const U = UI(); if (U) U.destroy(root); } };
})();
