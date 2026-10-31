// Lokale ontwikkelserver: statische bestanden + MQTT-broker over WebSocket.
// Open daarna http://localhost:8000/?broker=ws://localhost:8883 op meerdere tabbladen/telefoons.
//   PORT=8000 BROKER_PORT=8883 npm run dev
// De e2e-tests (test/e2e/run.mjs) gebruiken serveStatic() en startBroker() op vrije poorten (port 0).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startBroker } from "./broker.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".woff2": "font/woff2", ".md": "text/plain; charset=utf-8",
};

// Statische server op `port` (0 = vrije poort) → { server, port, url, close() }. host null = alle adressen (ook IPv6).
export async function serveStatic(port = 8000, { root = ROOT, host = "0.0.0.0" } = {}) {
  const base = root.endsWith(sep) ? root : root + sep;
  const server = http.createServer(async (req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400).end(); return; }
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(base, p));
    if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch { res.writeHead(404).end("not found"); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, ...(host ? [host] : []), resolve); });
  const actual = server.address().port;
  return {
    server, port: actual, url: `http://localhost:${actual}/`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = +(process.env.PORT || 8000);
  const BROKER_PORT = +(process.env.BROKER_PORT || 8883);
  await serveStatic(PORT);
  console.log(`app    → http://localhost:${PORT}/?broker=ws://localhost:${BROKER_PORT}`);
  await startBroker(BROKER_PORT);
}
