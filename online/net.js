/*
 * DVNet — transport for online "Infiltrant" (Dikke Vette App v2): MQTT over (secure) WebSocket via public brokers.
 * UMD: browser global `window.DVNet` + CommonJS `module.exports`.
 * Uses an injected mqtt lib: `opts.mqtt` (Node tests: require("mqtt")), default `window.mqtt` (vendor/mqtt.min.js).
 *
 * Topics (prefix `dva/v1/<CODE>/`):
 *   state          host → all, retained QoS 1, JSON public state
 *   host           player → host, QoS 1, JSON action envelope (only the host subscribes)
 *   p/<key>        host → one player, retained QoS 1, JSON private payload
 *   presence/<pid> retained "1" on every (re)connect, Last-Will retained "0", retained "0" on graceful close
 *
 * API
 *   DVNet.BROKERS                     public brokers, tried in order
 *   DVNet.brokerList()                → [url]; `?broker=<ws(s)://…>` overrides (only that broker), persisted in
 *                                       sessionStorage["dva:broker"]; `?broker=default` clears the override
 *   DVNet.brokerOverride()            → url | null (share/join links must then carry `&broker=…`)
 *   DVNet.randomCode()                4 letters CVCV, e.g. "BAKO"
 *   DVNet.randomId(len = 16)          [a-z2-9] via crypto.getRandomValues (Math.random fallback)
 *   DVNet.topics(code)                → { prefix, state, host, priv(key), presence(pid) }
 *
 *   const room = await DVNet.open({ code, pid, brokerUrl?, brokerIndex?, brokers?, mqtt?, onStatus?, timeoutMs? })
 *       Resolves after the first connect (rejects after timeoutMs, default 12 s; the client is then cleaned up).
 *       onStatus(s): "connecting" | "online" | "reconnecting" | "offline" (only on change).
 *       On every connect: presence "1" is republished; mqtt.js resubscribes automatically.
 *       Browser: visibilitychange hidden → visible (and window "online") reconnects when disconnected.
 *   room.code, room.pid, room.brokerIndex, room.brokerUrl, room.status, room.connected, room.client
 *   room.subscribeState(cb)           cb(stateObj | null)  null = retained cleared          → unsubscribe()
 *   room.subscribePrivate(key, cb)    cb(payload | null)                                    → unsubscribe()
 *   room.subscribeHost(cb)            host only: cb(envelope)                               → unsubscribe()
 *   room.subscribePresence(cb)        cb(pid, online:boolean)                               → unsubscribe()
 *   room.onReconnect(cb)              cb() after every connect except the first             → unsubscribe()
 *   room.publishState(obj)            retained QoS 1           → Promise<boolean> (true after PUBACK)
 *   room.publishPrivate(key, obj)     retained QoS 1           → Promise<boolean>
 *   room.clearPrivate(key)            retained empty payload   → Promise<boolean>
 *   room.send(envelope)               to `host`, QoS 1         → Promise<boolean>
 *   room.setPresence(online)          retained "1"/"0" (also used on later reconnects)
 *   room.close()                      graceful: presence "0", disconnect → Promise (never rejects; idempotent)
 *
 *   await DVNet.findRoom(code, { preferIndex?, brokers?, mqtt?, timeoutMs = 3500, connectTimeout = 6000, maxAgeMs = 12h })
 *       → { brokerIndex, brokerUrl, state } | null. Probes all brokers in parallel but honours the order
 *       (preferIndex first, then the list order): the first broker in that order with a retained, non-closed,
 *       not-stale state wins. Never rejects.
 *   await DVNet.claimCode({ brokers?, mqtt?, preferIndex?, genCode?, waitMs = 1200, maxTries = 12 })
 *       → { code, brokerIndex, brokerUrl } on the first reachable broker (in order); skips codes that have a
 *       retained non-closed state younger than 6 h. Rejects only when no broker is reachable / no free code.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DVNet = api;
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt", "wss://test.mosquitto.org:8081/mqtt"];
  const OVERRIDE_KEY = "dva:broker";
  const CONSONANTS = "BDFGHJKLMNPRSTVZ";
  const VOWELS = "AEIOU";
  const ID_CHARS = "abcdefghijkmnpqrstuvwxyz23456789"; // 32 tekens → byte & 31 is uniform
  const OCCUPIED_MS = 6 * 3600e3;
  const STALE_MS = 12 * 3600e3;
  const noop = () => {};

  // ---------- random ----------
  function randomBytes(n) {
    const out = new Uint8Array(n);
    const c = root && root.crypto;
    if (c && typeof c.getRandomValues === "function") {
      try { c.getRandomValues(out); return out; } catch (e) { /* val terug op Math.random */ }
    }
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
    return out;
  }
  function randomId(len = 16) {
    const b = randomBytes(len);
    let s = "";
    for (let i = 0; i < len; i++) s += ID_CHARS[b[i] & 31];
    return s;
  }
  // 16 medeklinkers (& 15) en 5 klinkers (modulo op 32-bit waarde: verwaarloosbare bias)
  function randomCode() {
    const b = randomBytes(8);
    const u = (i) => (b[i] << 8) | b[i + 1];
    return CONSONANTS[b[0] & 15] + VOWELS[u(2) % 5] + CONSONANTS[b[1] & 15] + VOWELS[u(4) % 5];
  }

  // ---------- brokers ----------
  function brokerOverride() {
    let url = null;
    try {
      if (typeof location !== "undefined" && location.search) url = new URLSearchParams(location.search).get("broker");
    } catch (e) { url = null; }
    try {
      if (typeof sessionStorage !== "undefined") {
        if (url === "default") { sessionStorage.removeItem(OVERRIDE_KEY); url = null; }
        else if (url) sessionStorage.setItem(OVERRIDE_KEY, url);
        else url = sessionStorage.getItem(OVERRIDE_KEY);
      }
    } catch (e) { /* storage geblokkeerd: alleen de query telt */ }
    return url && /^wss?:\/\/\S+$/i.test(url) ? url : null;
  }
  function brokerList() {
    const o = brokerOverride();
    return o ? [o] : BROKERS.slice();
  }

  // ---------- helpers ----------
  function cleanCode(code) { return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
  function topics(code) {
    const prefix = "dva/v1/" + cleanCode(code) + "/";
    return {
      prefix,
      state: prefix + "state",
      host: prefix + "host",
      priv: (key) => prefix + "p/" + key,
      presence: (pid) => prefix + "presence/" + pid,
    };
  }
  function getLib(lib) {
    const m = lib || (root && root.mqtt);
    if (!m || typeof m.connect !== "function") throw new Error("mqtt-bibliotheek ontbreekt");
    return m;
  }
  function clientOptions(extra) {
    return Object.assign({
      clientId: "dva_" + randomId(12), clean: true, keepalive: 20, reconnectPeriod: 2000, connectTimeout: 6000,
      protocolVersion: 4, resubscribe: true,
    }, extra);
  }
  function text(payload) {
    if (payload == null) return "";
    return typeof payload === "string" ? payload : payload.toString();
  }
  // → { ok:true, value } ; leeg = null; ongeldige JSON → { ok:false }
  function parseJSON(payload) {
    const s = text(payload);
    if (!s) return { ok: true, value: null };
    try { return { ok: true, value: JSON.parse(s) }; } catch (e) { return { ok: false }; }
  }
  // MQTT-topicfilter (+ en #)
  function topicMatch(filter, topic) {
    if (filter === topic) return true;
    const f = filter.split("/"), t = topic.split("/");
    for (let i = 0; i < f.length; i++) {
      if (f[i] === "#") return true;
      if (i >= t.length) return false;
      if (f[i] !== "+" && f[i] !== t[i]) return false;
    }
    return f.length === t.length;
  }
  function brokerOrder(n, prefer) {
    const order = [];
    if (Number.isInteger(prefer) && prefer >= 0 && prefer < n) order.push(prefer);
    for (let i = 0; i < n; i++) if (i !== prefer) order.push(i);
    return order;
  }
  function endClient(c) { try { c.removeAllListeners("message"); c.end(true); } catch (e) { /* al dicht */ } }
  function isLive(st, maxAgeMs) {
    if (!st || typeof st !== "object" || st.phase === "closed") return false;
    return !(typeof st.updatedAt === "number" && Date.now() - st.updatedAt > maxAgeMs);
  }

  // Kortlevende probe-verbinding (geen reconnect). Resolvet met client of null; nooit reject.
  // `bag` houdt bij welke probes nog open zijn zodat findRoom/claimCode alles netjes kunnen sluiten.
  function makeBag() {
    const clients = new Set();
    return {
      closed: false, clients,
      close() { this.closed = true; for (const c of clients) endClient(c); clients.clear(); },
    };
  }
  function connectProbe(lib, url, connectTimeout, bag) {
    return new Promise((resolve) => {
      if (bag.closed) { resolve(null); return; }
      let client, timer, done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!ok || bag.closed) { if (client) { bag.clients.delete(client); endClient(client); } resolve(null); return; }
        resolve(client);
      };
      try {
        client = lib.connect(url, clientOptions({ reconnectPeriod: 0, connectTimeout }));
      } catch (e) { finish(false); return; }
      bag.clients.add(client);
      client.on("error", noop);
      client.once("connect", () => finish(true));
      client.once("close", () => finish(false));
      timer = setTimeout(() => finish(false), connectTimeout + 500);
    });
  }
  // Wacht op het retained bericht van `topic`. → { value } | null (geen bericht / verbinding weg). Nooit reject.
  function readRetained(client, topic, waitMs) {
    return new Promise((resolve) => {
      if (!client.connected || client.disconnecting) { resolve(null); return; }
      let timer, done = false;
      const finish = (res) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        client.removeListener("message", onMsg);
        client.removeListener("close", onClose);
        if (client.connected && !client.disconnecting) { try { client.unsubscribe(topic, noop); } catch (e) { /* */ } }
        resolve(res);
      };
      const onMsg = (t, payload) => {
        if (t !== topic) return;
        const p = parseJSON(payload);
        finish({ value: p.ok ? p.value : null });
      };
      const onClose = () => finish(null);
      client.on("message", onMsg);
      client.on("close", onClose);
      timer = setTimeout(() => finish({ value: null, timeout: true }), waitMs);
      try { client.subscribe(topic, { qos: 1 }, (err) => { if (err) finish(null); }); } catch (e) { finish(null); }
    });
  }

  // ---------- open ----------
  function open(opts) {
    const o = opts || {};
    let lib;
    try { lib = getLib(o.mqtt); } catch (e) { return Promise.reject(e); }
    const list = o.brokers || brokerList();
    let brokerIndex = Number.isInteger(o.brokerIndex) ? o.brokerIndex : o.brokerUrl ? list.indexOf(o.brokerUrl) : 0;
    const brokerUrl = o.brokerUrl || list[brokerIndex] || list[0];
    if (!o.brokerUrl && !list[brokerIndex]) brokerIndex = 0;
    const code = cleanCode(o.code);
    const pid = o.pid ? String(o.pid) : null;
    const T = topics(code);
    const hasDoc = typeof document !== "undefined" && document && typeof document.addEventListener === "function";
    const hasWin = typeof window !== "undefined" && window && typeof window.addEventListener === "function";

    const subs = new Map(); // filter → Set(handler(topic, payload))
    const reconnectCbs = new Set();
    let status = null, closed = false, presenceOn = true, connects = 0, wasHidden = false;
    let closing = null;

    const setStatus = (s) => {
      if (s === status) return;
      status = s;
      if (typeof o.onStatus === "function") { try { o.onStatus(s); } catch (e) { console.error(e); } }
    };
    setStatus("connecting");

    const extra = { reconnectPeriod: o.reconnectPeriod != null ? o.reconnectPeriod : 2000 };
    if (o.keepalive != null) extra.keepalive = o.keepalive;
    if (pid) extra.will = { topic: T.presence(pid), payload: "0", retain: true, qos: 1 };
    let client;
    try { client = lib.connect(brokerUrl, clientOptions(extra)); } catch (e) { return Promise.reject(e); }

    const pub = (topic, payload, retain) => new Promise((resolve) => {
      if (closed) { resolve(false); return; }
      try { client.publish(topic, payload, { qos: 1, retain: !!retain }, (err) => resolve(!err)); } catch (e) { resolve(false); }
    });
    const publishPresence = () => (pid ? pub(T.presence(pid), presenceOn ? "1" : "0", true) : Promise.resolve(false));

    client.on("error", noop); // mqtt.js blijft zelf opnieuw verbinden
    client.on("connect", () => {
      if (closed) return;
      connects++;
      setStatus("online");
      publishPresence();
      if (connects > 1) for (const cb of [...reconnectCbs]) { try { cb(); } catch (e) { console.error(e); } }
    });
    client.on("reconnect", () => { if (!closed) setStatus("reconnecting"); });
    client.on("offline", () => { if (!closed) setStatus("offline"); });
    client.on("close", () => { if (!closed && status === "online") setStatus("reconnecting"); });
    client.on("message", (topic, payload) => {
      if (closed) return;
      for (const [filter, set] of subs) {
        if (!topicMatch(filter, topic)) continue;
        for (const fn of [...set]) { try { fn(topic, payload); } catch (e) { console.error(e); } }
      }
    });

    // Telefoon uit standby / netwerk terug: meteen opnieuw verbinden i.p.v. op de timer te wachten
    const kick = () => {
      if (closed || client.connected || client.disconnecting) return;
      try { client.reconnect(); } catch (e) { /* volgende poging via timer */ }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { wasHidden = true; return; }
      if (wasHidden) { wasHidden = false; kick(); }
    };
    if (hasDoc) document.addEventListener("visibilitychange", onVisibility);
    if (hasWin) window.addEventListener("online", kick);
    const detach = () => {
      if (hasDoc) document.removeEventListener("visibilitychange", onVisibility);
      if (hasWin) window.removeEventListener("online", kick);
    };

    const subscribe = (filter, fn) => {
      let set = subs.get(filter);
      if (!set) { set = new Set(); subs.set(filter, set); }
      set.add(fn);
      if (!closed) { try { client.subscribe(filter, { qos: 1 }, noop); } catch (e) { /* */ } }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        set.delete(fn);
        if (set.size || subs.get(filter) !== set) return;
        subs.delete(filter);
        if (!closed) { try { client.unsubscribe(filter, noop); } catch (e) { /* */ } }
      };
    };
    const jsonHandler = (cb, allowNull) => (topic, payload) => {
      const p = parseJSON(payload);
      if (!p.ok || (!allowNull && p.value == null)) return;
      cb(p.value);
    };

    const room = {
      code, pid, brokerIndex, brokerUrl, client,
      get status() { return status; },
      get connected() { return !closed && client.connected; },
      subscribeState: (cb) => subscribe(T.state, jsonHandler(cb, true)),
      subscribePrivate: (key, cb) => subscribe(T.priv(key), jsonHandler(cb, true)),
      subscribeHost: (cb) => subscribe(T.host, jsonHandler(cb, false)),
      subscribePresence: (cb) => subscribe(T.prefix + "presence/+", (topic, payload) => {
        cb(topic.slice((T.prefix + "presence/").length), text(payload) === "1");
      }),
      onReconnect(cb) { reconnectCbs.add(cb); return () => reconnectCbs.delete(cb); },
      publishState: (obj) => pub(T.state, JSON.stringify(obj), true),
      publishPrivate: (key, obj) => pub(T.priv(key), JSON.stringify(obj), true),
      clearPrivate: (key) => pub(T.priv(key), "", true),
      send: (env) => pub(T.host, JSON.stringify(env), false),
      setPresence(online) { presenceOn = !!online; return client.connected ? publishPresence() : Promise.resolve(false); },
      close() {
        if (closing) return closing;
        closing = new Promise((resolve) => {
          const wasConnected = client.connected;
          let safety;
          const done = () => { clearTimeout(safety); resolve(); };
          // Eerst presence "0" (met PUBACK), dan nette DISCONNECT. Lukt dat niet snel: hard dicht (LWT doet dan de "0").
          const finish = (acked) => {
            closed = true;
            detach();
            subs.clear();
            reconnectCbs.clear();
            setStatus("offline");
            safety = setTimeout(() => { try { if (client.stream) client.stream.destroy(); } catch (e) { /* */ } done(); }, 1500);
            try { client.end(!acked, done); } catch (e) { done(); }
          };
          if (!wasConnected || !pid) { finish(false); return; }
          presenceOn = false;
          let t = null;
          const ack = (ok) => { if (t === false) return; clearTimeout(t); t = false; finish(ok); };
          t = setTimeout(() => ack(false), 1200);
          pub(T.presence(pid), "0", true).then(ack);
        });
        return closing;
      },
    };

    return new Promise((resolve, reject) => {
      if (client.connected) { resolve(room); return; }
      const timeoutMs = o.timeoutMs != null ? o.timeoutMs : 12000;
      const timer = setTimeout(() => {
        client.removeListener("connect", onFirst);
        closed = true;
        detach();
        setStatus("offline");
        try { client.end(true); } catch (e) { /* */ }
        reject(new Error("Geen verbinding met de server"));
      }, timeoutMs);
      const onFirst = () => { clearTimeout(timer); resolve(room); };
      client.once("connect", onFirst);
    });
  }

  // ---------- findRoom ----------
  async function findRoom(code, opts) {
    const o = opts || {};
    let lib;
    try { lib = getLib(o.mqtt); } catch (e) { return null; }
    const list = o.brokers || brokerList();
    const topic = topics(code).state;
    const waitMs = o.timeoutMs != null ? o.timeoutMs : 3500;
    const connectTimeout = o.connectTimeout != null ? o.connectTimeout : 6000;
    const maxAgeMs = o.maxAgeMs != null ? o.maxAgeMs : STALE_MS;
    const bag = makeBag();
    const probes = brokerOrder(list.length, o.preferIndex).map((idx) => (async () => {
      const c = await connectProbe(lib, list[idx], connectTimeout, bag);
      if (!c) return null;
      const res = await readRetained(c, topic, waitMs);
      bag.clients.delete(c);
      endClient(c);
      const st = res && res.value;
      return isLive(st, maxAgeMs) ? { brokerIndex: idx, brokerUrl: list[idx], state: st } : null;
    })().catch(() => null));
    try {
      for (const p of probes) {
        const r = await p;
        if (r) return r;
      }
      return null;
    } finally {
      bag.close();
    }
  }

  // ---------- claimCode ----------
  async function claimCode(opts) {
    const o = opts || {};
    const lib = getLib(o.mqtt);
    const list = o.brokers || brokerList();
    const gen = typeof o.genCode === "function" ? o.genCode : randomCode;
    const waitMs = o.waitMs != null ? o.waitMs : 1200;
    const maxTries = o.maxTries != null ? o.maxTries : 12;
    const connectTimeout = o.connectTimeout != null ? o.connectTimeout : 6000;
    const bag = makeBag();
    const order = brokerOrder(list.length, o.preferIndex);
    const conns = order.map((idx) => connectProbe(lib, list[idx], connectTimeout, bag));
    let reachable = false;
    try {
      for (let i = 0; i < order.length; i++) {
        const c = await conns[i];
        if (!c) continue;
        reachable = true;
        for (let n = 0; n < maxTries; n++) {
          const code = cleanCode(gen());
          const res = await readRetained(c, topics(code).state, waitMs);
          if (!res) break; // verbinding weg → volgende broker
          const st = res.value;
          const occupied = st && typeof st === "object" && st.phase !== "closed" &&
            !(typeof st.updatedAt === "number" && Date.now() - st.updatedAt >= OCCUPIED_MS);
          if (!occupied) return { code, brokerIndex: order[i], brokerUrl: list[order[i]] };
        }
      }
    } finally {
      bag.close();
    }
    throw new Error(reachable ? "Geen vrije kamercode gevonden" : "Geen verbinding met de server");
  }

  return {
    BROKERS, brokerList, brokerOverride, randomCode, randomId, topics, topicMatch,
    open, findRoom, claimCode,
  };
});
