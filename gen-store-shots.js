#!/usr/bin/env node
// Captioned store screenshots: harmony/screenshots/screenshot-N.png (1440x2560, 9:16,
// the portrait shape Harmony crops screenshots to; it stores them at 720x1280).
// Takes screenshot-1..5.png (run screenshot.js first), crops the letterbox
// bars, and puts a short headline above each in the game's font. One word
// per caption is highlighted in yellow. Dev-only: listed in .zipignore.

const fs = require('fs');
const path = require('path');
const puppeteer = require('/usr/local/lib/node_modules/puppeteer');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'harmony', 'screenshots');
const W = 1440;
const H = 2560;
// screenshot.js captures 430x932 @3x = 1290x2796; the 9:16 canvas fills the width, centred.
const SRC_W = 1290;
const SRC_H = 2796;
const CANVAS_Y = Math.round((SRC_H - Math.round(SRC_W * 16 / 9)) / 2);
const SHOT_TOP = 500;
const SHOT_H = H - SHOT_TOP - 90;
const SHOT_W = Math.round(SHOT_H * 9 / 16);

// [before, highlighted, after]
const CAPTIONS = [
  ['TAP TO ', 'SHOOT', ''],
  ['SCORE IN ', 'ANY GOAL', ''],
  ['CHAIN GOALS FOR ', '2X', ''],
  ['KEEP THE ', 'FIRE', ' BURNING'],
  ['3 MISSES AND IT\'S ', 'FULL TIME', ''],
];

function html(imgB64, [a, hi, b]) {
  const font = fs.readFileSync(path.join(ROOT, 'fonts', 'LilitaOne-Regular.woff2')).toString('base64');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Lilita One'; src: url(data:font/woff2;base64,${font}) format('woff2'); }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
body { background: radial-gradient(ellipse at 50% 0%, #2b377a 0%, #161d45 60%); font-family: 'Lilita One', sans-serif; }
h1 { position: absolute; top: 100px; left: 70px; right: 70px; margin: 0; text-align: center;
  font-size: 132px; line-height: 1.02; font-weight: 400; color: #fff; letter-spacing: 1px;
  -webkit-text-stroke: 0; text-shadow: 0 12px 0 #0d1230; }
h1 span { color: #ffd23f; }
.shot { position: absolute; left: 50%; top: ${SHOT_TOP}px; width: ${SHOT_W}px; height: ${SHOT_H}px;
  transform: translateX(-50%); border-radius: 56px; overflow: hidden;
  box-shadow: 0 30px 80px rgba(0,0,0,0.45), 0 0 0 10px #1d2340, 0 0 0 16px rgba(255,255,255,0.15); }
.shot img { position: absolute; left: 0; width: ${SHOT_W}px; top: -${Math.round(CANVAS_Y * SHOT_W / SRC_W)}px; }
</style></head><body>
<h1>${a}<span>${hi}</span>${b}</h1>
<div class="shot"><img src="data:image/png;base64,${imgB64}"></div>
</body></html>`;
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    for (let i = 0; i < CAPTIONS.length; i++) {
      const src = path.join(ROOT, `screenshot-${i + 1}.png`);
      await page.setContent(html(fs.readFileSync(src).toString('base64'), CAPTIONS[i]), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const out = path.join(OUT_DIR, `screenshot-${i + 1}.png`);
      await page.screenshot({ path: out });
      console.log(`  ✓ ${path.relative(ROOT, out)}  "${CAPTIONS[i].join('')}"`);
    }
  } finally {
    await browser.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
