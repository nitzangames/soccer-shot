#!/usr/bin/env node
// Capture 5 gameplay screenshots from Soccer Shot using screenshot mode.
// Serves this directory on a random port and loads index.html?screenshot=1.
// Output: screenshot-1.png ... screenshot-5.png at 1290x2796 (6.7" iPhone).

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('/usr/local/lib/node_modules/puppeteer');

const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.css':  'text/css; charset=utf-8',
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Staggered capture offsets (seconds) — spread across a ball's arc so each
// screenshot shows the game at a visually distinct moment.
const OFFSETS = [0.8, 1.8, 2.8, 4.0, 5.5];

async function run() {
  const server = await startServer();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/index.html?screenshot=1`;
  console.log(`Serving ${ROOT} on :${port}`);
  console.log(`Loading ${url}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 3 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });

  const t0 = Date.now();
  for (let i = 0; i < OFFSETS.length; i++) {
    const targetMs = OFFSETS[i] * 1000;
    const waitMs = Math.max(0, targetMs - (Date.now() - t0));
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    const file = path.join(ROOT, `screenshot-${i + 1}.png`);
    await page.screenshot({ path: file });
    console.log(`  ✓ screenshot-${i + 1}.png  (t=${OFFSETS[i]}s)`);
  }

  await browser.close();
  server.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
