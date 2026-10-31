// Preview / design-QA voor Infiltrant online: ?preview=<fase> rendert het kamerscherm met vaste,
// realistische fixture-states (6 spelers) zonder netwerk. Wordt alleen door online/ui.js geladen als ?preview er is.
//
// Fases: lobby, lobby-host, lobby-wait, reveal, reveal-blind-infiltrant, hints, hints-myturn, vote, vote-revote,
//        voted-waiting, guess, guess-me, elim-infiltrant, elim-burger, elim-tie, over-burgers, over-infiltranten,
//        connecting, closed, kicked
// Extra: &open=1 (geheime kaart open), &host=1 (bekijk als host), &me=p3 (bekijk als andere speler)
(() => {
  "use strict";
  const O = window.DVOnline;
  if (!O) return;
  const q = new URLSearchParams(location.search);
  const phase = q.get("preview") || "lobby";

  const PLAYERS = [
    { pid: "p1", name: "Loek", avatar: "😎", color: "#ff2e93" },
    { pid: "p2", name: "Sanne", avatar: "🦊", color: "#22e6ff" },
    { pid: "p3", name: "Jeroen", avatar: "🤖", color: "#9dff3d" },
    { pid: "p4", name: "Fleur", avatar: "🦄", color: "#ffe03d" },
    { pid: "p5", name: "Mo", avatar: "👽", color: "#8b5cff" },
    { pid: "p6", name: "Iris", avatar: "🐸", color: "#ff8a00" },
  ];
  const now = Date.now();
  function base(over) {
    const s = {
      v: 1, code: "BAKO", hostPid: "p1", phase: "lobby", gameNo: 2, round: 1, updatedAt: now,
      settings: { mode: "woord", infiltrants: 1, hintRounds: 1, timer: 0, categories: [] },
      players: PLAYERS.map((p) => Object.assign({}, p, { alive: true, spectator: false, left: false })),
      scores: { p1: 4, p2: 3, p3: 2, p4: 0, p5: 5, p6: 1 },
      acks: { p1: 12, p2: 8, p3: 7, p4: 6, p5: 9, p6: 7 }, removed: [],
      order: ["p3", "p1", "p6", "p2", "p5", "p4"],
      turn: null, hints: [], ready: [], voted: [], candidates: null, revote: false,
      lastVote: null, guess: null, result: null, infiltrantCount: 1,
    };
    return Object.assign(s, over || {});
  }
  const dead = (s, ...pids) => { s.players.forEach((p) => { if (pids.includes(p.pid)) p.alive = false; }); return s; };
  const ROUND1 = [
    { pid: "p3", text: "ochtend", round: 1, hintRound: 1 },
    { pid: "p1", text: "warm", round: 1, hintRound: 1 },
    { pid: "p6", text: "kopje", round: 1, hintRound: 1 },
    { pid: "p2", text: "bruin", round: 1, hintRound: 1 },
    { pid: "p5", text: "", round: 1, hintRound: 1 },
    { pid: "p4", text: "Engeland", round: 1, hintRound: 1 },
  ];
  const ROUND2 = [
    { pid: "p1", text: "cafeïne", round: 2, hintRound: 1 },
    { pid: "p6", text: "met melk 🥛", round: 2, hintRound: 1 },
    { pid: "p2", text: "", round: 2, hintRound: 1, skipped: true },
  ];
  const VOTE_R1 = { tally: { p4: 3, p6: 2 }, votes: { p1: "p4", p2: "p6", p3: "p4", p5: "p4", p4: "p6", p6: "p3" }, eliminated: "p4", role: "burger", tie: false, revote: false, round: 1 };
  const WOORD = { v: 1, gameNo: 2, word: "Koffie", category: "eten", role: null, knowsRole: false };

  let me = "p2", priv = WOORD, host = null, pub, presence = {}, ended = null, myVote = null, after = null, pending = [];
  switch (phase) {
    case "lobby":
      pub = base({ phase: "lobby", round: 0, players: base().players.slice(0, 5) });
      presence = { p4: false };
      priv = null;
      break;
    case "lobby-host":
      me = "p1";
      pub = base({ phase: "lobby", round: 0, players: base().players.slice(0, 4), settings: { mode: "woord", infiltrants: 1, hintRounds: 2, timer: 30, categories: ["eten", "dieren", "nl"] } });
      priv = null;
      break;
    case "lobby-wait":
      me = "p1";
      pub = base({ phase: "lobby", gameNo: 0, round: 0, players: base().players.slice(0, 2), scores: { p1: 0, p2: 0 } });
      priv = null;
      break;
    case "reveal":
      pub = base({ phase: "reveal", ready: ["p1", "p3", "p5"] });
      break;
    case "reveal-blind-infiltrant":
      pub = base({ phase: "reveal", settings: Object.assign(base().settings, { mode: "blind" }), ready: ["p3"] });
      priv = { v: 1, gameNo: 2, word: null, category: "eten", role: "infiltrant", knowsRole: true };
      after = () => document.querySelector(".o-card3d").classList.add("open");
      break;
    case "hints":
      pub = dead(base({ phase: "hints", round: 2, settings: Object.assign(base().settings, { timer: 30 }), hints: ROUND1.concat(ROUND2.slice(0, 1)), turn: { pid: "p6", hintRound: 1, startedAt: now - 9000 }, lastVote: VOTE_R1 }), "p4");
      break;
    case "hints-myturn":
      pub = dead(base({ phase: "hints", round: 2, hints: ROUND1.concat(ROUND2.slice(0, 2)), turn: { pid: "p2", hintRound: 1, startedAt: now }, lastVote: VOTE_R1 }), "p4");
      break;
    case "vote":
      pub = dead(base({ phase: "vote", round: 2, hints: ROUND1.concat(ROUND2), voted: ["p1", "p5"], lastVote: VOTE_R1 }), "p4");
      after = () => { const b = document.querySelector('[data-act="vote-pick"][data-pid="p6"]'); if (b) b.click(); };
      break;
    case "vote-revote":
      pub = dead(base({ phase: "vote", round: 2, hints: ROUND1.concat(ROUND2), voted: ["p3"], candidates: ["p6", "p3"], revote: true, lastVote: VOTE_R1 }), "p4");
      break;
    case "voted-waiting":
      pub = dead(base({ phase: "vote", round: 2, hints: ROUND1.concat(ROUND2), voted: ["p1", "p2", "p5"], lastVote: VOTE_R1 }), "p4");
      myVote = "p6";
      break;
    case "guess":
    case "guess-me":
      if (phase === "guess-me") me = "p6";
      pub = dead(base({
        phase: "guess", round: 2, settings: Object.assign(base().settings, { mode: "blind" }), hints: ROUND1.concat(ROUND2),
        lastVote: { tally: { p6: 4, p3: 1 }, votes: { p1: "p6", p2: "p6", p3: "p6", p5: "p6", p6: "p3" }, eliminated: "p6", role: "infiltrant", tie: false, revote: false, round: 2 },
        guess: { pid: "p6", text: null, correct: null },
      }), "p4", "p6");
      priv = me === "p6" ? { v: 1, gameNo: 2, word: null, category: "eten", role: "infiltrant", knowsRole: true } : { v: 1, gameNo: 2, word: "Koffie", category: "eten", role: "burger", knowsRole: true };
      break;
    case "elim-infiltrant":
      me = "p1";
      host = { pendingWinner: "burgers" };
      pub = dead(base({
        phase: "elim", round: 2, hints: ROUND1.concat(ROUND2),
        lastVote: { tally: { p6: 3, p3: 1, p1: 1 }, votes: { p1: "p6", p2: "p6", p3: "p1", p5: "p6", p6: "p3" }, eliminated: "p6", role: "infiltrant", tie: false, revote: false, round: 2 },
      }), "p4", "p6");
      break;
    case "elim-burger":
      pub = dead(base({ phase: "elim", round: 1, hints: ROUND1, lastVote: { tally: { p3: 3, p6: 2, p1: 1 }, votes: { p1: "p3", p2: "p6", p4: "p3", p5: "p3", p6: "p1", p3: "p6" }, eliminated: "p3", role: "burger", tie: false, revote: false, round: 1 } }), "p3");
      break;
    case "elim-tie":
      me = "p1";
      host = { pendingWinner: null };
      pub = dead(base({ phase: "elim", round: 2, hints: ROUND1.concat(ROUND2), lastVote: { tally: { p6: 2, p3: 2 }, votes: { p1: "p6", p2: "p3", p3: "p6", p6: "p3" }, eliminated: null, role: null, tie: true, revote: true, round: 2 } }), "p4", "p5");
      break;
    case "over-burgers":
      me = "p1";
      pub = dead(base({
        phase: "over", round: 2, hints: ROUND1.concat(ROUND2), scores: { p1: 7, p2: 6, p3: 4, p4: 2, p5: 8, p6: 1 },
        lastVote: { tally: { p6: 3, p3: 1, p1: 1 }, votes: { p1: "p6", p2: "p6", p3: "p1", p5: "p6", p6: "p3" }, eliminated: "p6", role: "infiltrant", tie: false, revote: false, round: 2 },
        result: { winner: "burgers", roles: { p1: "burger", p2: "burger", p3: "burger", p4: "burger", p5: "burger", p6: "infiltrant" }, words: { burger: "Koffie", infiltrant: "Thee" }, category: "eten", delta: { p1: 3, p2: 3, p3: 2, p4: 2, p5: 3, p6: 0 } },
      }), "p4", "p6");
      break;
    case "over-infiltranten":
      pub = dead(base({
        phase: "over", round: 3, hints: ROUND1.concat(ROUND2), scores: { p1: 4, p2: 3, p3: 2, p4: 0, p5: 5, p6: 6 },
        result: { winner: "infiltranten", roles: { p1: "burger", p2: "burger", p3: "burger", p4: "burger", p5: "burger", p6: "infiltrant" }, words: { burger: "Koffie", infiltrant: "Thee" }, category: "eten", delta: { p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 5 } },
      }), "p4", "p3", "p5");
      break;
    case "connecting":
      pub = null; priv = null;
      break;
    case "closed":
    case "kicked":
      pub = base({ phase: phase === "closed" ? "closed" : "lobby" });
      ended = phase === "closed" ? "closed" : "removed";
      break;
    default:
      pub = base({ phase: "lobby", round: 0 });
      priv = null;
  }
  if (q.get("me")) me = q.get("me");
  const isHost = q.get("host") === "1" || me === "p1";
  if (q.get("host") === "1" && pub) pub.hostPid = me;

  O.preview({ pub, priv, me: { pid: me, key: "k-" + me, isHost, code: "BAKO" }, host: isHost ? host || { pendingWinner: null } : null, presence, status: "online", ended, pending, myVote });
  setTimeout(() => {
    if (after) after();
    if (q.get("open") === "1") { const c = document.querySelector(".o-card3d"); if (c) c.classList.add("open"); }
  }, 900);
})();
