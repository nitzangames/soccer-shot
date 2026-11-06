#!/usr/bin/env node
// Render thumbnail.png (312x312) with the game's own drawing code.
//
// game.js keeps its functions in module scope, so this script serves a page
// that inlines game.js with one extra line exposing the drawing helpers on
// window.__ss, pauses the game loop, and composes a zoomed-in hero shot:
// title, three goals on fire, a ball heading in, and the striker mid-kick.
// Dev-only: listed in .zipignore.

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('/usr/local/lib/node_modules/puppeteer');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'thumbnail.png');
const SIZE = 312;

const EXPOSE = `
window.__ss = { ctx, game, pause, drawGoal, drawGoalFire, drawPlayer, drawBallBody,
  outlinedText, goalLeft, KICK_TIME, GOAL_COUNT, GOAL_W, NAVY, WHITE, YELLOW, GRASS, BRAND_COLORS };
`;

function page() {
  const src = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8') + EXPOSE;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Lilita One'; src: url('fonts/LilitaOne-Regular.woff2') format('woff2'); }
body { margin: 0; background: #000; }
</style></head><body>
<canvas id="game" width="1080" height="1920"></canvas>
<script type="module">${src}</script>
</body></html>`;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/__thumb.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page());
        return;
      }
      const file = path.join(ROOT, urlPath);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream' });
        res.end(buf);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Runs in the page. Draws a 1080x1080 composition on the game canvas, then
// downsamples it in two steps for a clean 312px result.
async function compose(size) {
  const S = window.__ss;
  const { ctx, game } = S;
  S.pause();
  await document.fonts.load('64px "Lilita One"');

  const V = 1080;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 1080, 1920);

  // Grass with a large mowing checker (zoomed-in camera)
  ctx.fillStyle = S.GRASS;
  ctx.fillRect(0, 0, V, V);
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 4; c++) {
      if ((r + c) % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(c * 280, r * 170, 280, 170); }
    }
  }

  // Goals: world → screen at 1.3x, goal row centred, goal tops at y=460
  const GS = 1.3;
  ctx.setTransform(GS, 0, 0, GS, 540 - 540 * GS, 460 - 100 * GS);
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-200, 288); ctx.lineTo(1300, 288); ctx.stroke();
  game.fireTime = 0.37;
  for (let i = 0; i < S.GOAL_COUNT; i++) S.drawGoalFire(S.goalLeft(i), i * 1.3, i % 2 === 1);
  game.goalRipple[2] = 0.55;
  game.goalRippleX[2] = 540;
  for (let i = 0; i < S.GOAL_COUNT; i++) S.drawGoal(i);

  // Ball heading into the middle goal, trail reaching back toward the striker
  const by = 205;
  ctx.fillStyle = S.WHITE;
  for (let k = 0; k < 8; k++) {
    const ty = by + 18 + k * 26;
    if (ty > 360) break;
    ctx.globalAlpha = (1 - k / 8) * 0.4;
    ctx.beginPath(); ctx.arc(540, ty, 24 * (1 - k / 11), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  S.drawBallBody(540, by, 0.6, 1, 1, true);

  // Confetti around the goal mouth
  const conf = [[-170, 300, 0.4], [-120, 250, 2.1], [-210, 210, 1.2], [150, 290, 0.9], [205, 235, 2.6], [120, 205, 1.7],
    [-60, 330, 2.9], [80, 335, 0.2], [250, 320, 1.4], [-250, 300, 2.3]];
  for (let k = 0; k < conf.length; k++) {
    const [dx, y, rot] = conf[k];
    ctx.save();
    ctx.translate(540 + dx, y);
    ctx.rotate(rot);
    ctx.fillStyle = S.BRAND_COLORS[k % S.BRAND_COLORS.length];
    ctx.fillRect(-9, -5, 18, 10);
    ctx.restore();
  }

  // Striker: 1.8x, feet near the bottom edge, mid-kick
  const PS = 1.8;
  ctx.setTransform(PS, 0, 0, PS, 540 - 540 * PS, 1062 - 930 * PS);
  game.playerX = 540;
  game.playerDir = 1;
  game.walkPhase = 1.1;
  game.kickTime = S.KICK_TIME * 0.5;
  S.drawPlayer();

  // Title
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.translate(540, 125);
  ctx.rotate(-0.05);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  S.outlinedText('SOCCER', 0, 0, 175, S.WHITE, S.NAVY, 24);
  S.outlinedText('SHOT', 0, 170, 215, S.YELLOW, S.NAVY, 26);
  ctx.restore();

  // Soft vignette
  const vg = ctx.createRadialGradient(540, 560, 380, 540, 560, 820);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, V, V);

  // Two-step downsample: 1080 → 624 → 312
  const src = document.getElementById('game');
  const mid = document.createElement('canvas');
  mid.width = mid.height = size * 2;
  const m = mid.getContext('2d');
  m.imageSmoothingQuality = 'high';
  m.drawImage(src, 0, 0, V, V, 0, 0, size * 2, size * 2);
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const o = out.getContext('2d');
  o.imageSmoothingQuality = 'high';
  o.drawImage(mid, 0, 0, size, size);
  return out.toDataURL('image/png');
}

async function run() {
  const server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/__thumb.html`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const pageObj = await browser.newPage();
  const errors = [];
  pageObj.on('pageerror', (e) => errors.push(e.message));
  await pageObj.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
  await pageObj.waitForFunction(() => !!window.__ss, { timeout: 5000 });
  const dataUrl = await pageObj.evaluate(compose, SIZE);
  fs.writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await browser.close();
  server.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(`  ✓ ${path.basename(OUT)} (${SIZE}x${SIZE})`);
}

run().catch((e) => { console.error(e); process.exit(1); });
