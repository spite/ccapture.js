// Browser smoke test: serves the repo, opens a headless Chromium, records a
// short clip in each format, and verifies the output actually decodes/plays —
// plus checks motion-blur averaging (CPU and, if supported, GPU).
//
//   npm run test:browser
//
// Requires Chromium + its system libs (see test/browser/README.md).

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { chromium } from "playwright-core";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
      const file = join(repoRoot, rel);
      if (!file.startsWith(repoRoot)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const body = await readFile(file);
      const ext = file.slice(file.lastIndexOf("."));
      res.writeHead(200, {
        "content-type": MIME[ext] || "application/octet-stream",
        "cache-control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port })
    );
  });
}

const args = [
  "--no-sandbox",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
];

async function main() {
  const { server, port } = await startServer();
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  let results;
  try {
    await page.goto(`http://127.0.0.1:${port}/test/browser/index.html`, {
      waitUntil: "load",
    });
    await page.waitForFunction(() => window.__results, null, { timeout: 120000 });
    results = await page.evaluate(() => window.__results);
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n=== capabilities ===");
  console.log(results.caps);
  console.log("");
  for (const r of results.results) {
    const mark = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "–";
    const tail = r.status === "skip" ? ` (skipped: ${r.error})` : "";
    console.log(`  ${mark} ${r.name}${tail}`);
    if (r.status === "fail") console.log(`      ${r.error}`);
  }

  if (consoleErrors.length) {
    console.log("\n=== page console errors ===");
    for (const e of consoleErrors) console.log("  " + e);
  }

  console.log(
    `\n${results.failed ? "FAIL" : "PASS"} — ${results.passed}/${results.total} passed` +
      (results.skipped ? `, ${results.skipped} skipped` : "") +
      (results.failed ? `, ${results.failed} failed` : "")
  );
  process.exit(results.failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
