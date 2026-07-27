// Static file server for running the test suite (and examples) in a real
// browser. ES modules require HTTP, so open the printed URL rather than file://.
//
//   npm run serve   →   http://localhost:8000/test/browser/

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { networkInterfaces } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.PORT) || 8000;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".css": "text/css",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath.endsWith("/")) urlPath += "index.html";
    const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    const file = join(repoRoot, rel);
    if (!file.startsWith(repoRoot)) return res.writeHead(403).end("forbidden");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[file.slice(file.lastIndexOf("."))] || "application/octet-stream",
      // Always serve fresh code so edits show up on refresh (no stale modules).
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => {
  console.log(`Serving ${repoRoot}\n`);
  console.log(`  Test suite:  http://localhost:${PORT}/test/browser/`);
  console.log(`  Examples:    http://localhost:${PORT}/examples/`);

  // LAN addresses — open these from a phone/tablet on the same network
  // (e.g. iOS Safari for the WebKit engine).
  const lan = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) lan.push(a.address);
    }
  }
  if (lan.length) {
    console.log("\n  On the same Wi-Fi (phone/tablet):");
    for (const ip of lan) console.log(`    http://${ip}:${PORT}/test/browser/`);
  }
  console.log("\nOpen in Chrome / Firefox / Safari. Ctrl+C to stop.");
});
