// Minimale MQTT-over-WebSocket broker (aedes) voor lokaal testen en e2e-tests.
import { createRequire } from "node:module";
import { WebSocketServer, createWebSocketStream } from "ws";

const require = createRequire(import.meta.url);

export async function startBroker(port = 8883, { quiet = false } = {}) {
  const mod = require("aedes");
  const Aedes = mod.Aedes || mod.default || mod;
  const aedes = typeof Aedes.createBroker === "function" ? await Aedes.createBroker() : new Aedes();
  const wss = new WebSocketServer({ port, handleProtocols: (protocols) => (protocols.has("mqtt") ? "mqtt" : false) });
  wss.on("connection", (ws) => aedes.handle(createWebSocketStream(ws)));
  await new Promise((r) => wss.on("listening", r));
  if (!quiet) console.log(`broker → ws://localhost:${port}`);
  return {
    aedes, wss,
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => aedes.close(r)); }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) startBroker(+(process.env.BROKER_PORT || 8883));
