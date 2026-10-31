// Lokale ontwikkelserver: statische bestanden + MQTT-broker over WebSocket.
// Open daarna http://localhost:8000/?broker=ws://localhost:8883 op meerdere tabbladen/telefoons.
//   PORT=8000 BROKER_PORT=8883 npm run dev
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { startBroker } from "./broker.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const PORT = +(process.env.PORT || 8000);
const BROKER_PORT = +(process.env.BROKER_PORT || 8883);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".md": "text/plain; charset=utf-8",
};

http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = normalize(join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch { res.writeHead(404).end("not found"); }
}).listen(PORT, "0.0.0.0", () => console.log(`app    → http://localhost:${PORT}/?broker=ws://localhost:${BROKER_PORT}`));

await startBroker(BROKER_PORT);
