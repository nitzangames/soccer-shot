#!/usr/bin/env node
// Render the playharmony.ai listing art with the game's own drawing code:
//   harmony/banner.png  1440x810   hero art, no text (Harmony overlays the logo on the left)
//   harmony/logo.png    1024x1024  transparent title wordmark
//   harmony/thumb.png   1280x720   card thumbnail: scene + title
// Same technique as gen-thumbnail.js: inline game.js with its helpers exposed
// on window.__ss, pause the loop, compose. Dev-only: listed in .zipignore.

const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('/usr/local/lib/node_modules/puppeteer');

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'harmony');

const EXPOSE = `
window.__ss = { ctx, game, pause, drawGoal, drawGoalFire, drawPlayer, drawBallBody, drawCrowd,
  outlinedText, goalLeft, fieldLayer, KICK_TIME, GOAL_COUNT, NAVY, WHITE, YELLOW, GRASS, BRAND_COLORS };
`;

function page() {
  const src = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8') + EXPOSE;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Lilita One'; src: url('fonts/LilitaOne-Regular.woff2') format('woff2'); }
body { margin: 0; }
</style></head><body>
<canvas id="game" width="1080" height="1920"></canvas>
<script type="module">${src}</script>
</body></html>`;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      if (urlPath === '/__art.html') {
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

// Runs in the page.
async function renderAll() {
  const S = window.__ss;
  const { ctx, game } = S;
  S.pause();
  await document.fonts.load('64px "Lilita One"');
  const cv = document.getElementById('game');
  const TAU = Math.PI * 2;

  // Stadium scene composed in a 1440x810 frame: stands and goals across the
  // top, the striker big on the right, a ball flying into goal 3. The left
  // side stays calm because Harmony puts the logo and blurb there.
  function scene(W, H) {
    ctx.save();
    ctx.scale(W / 1440, H / 810);
    ctx.fillStyle = S.GRASS;
    ctx.fillRect(0, 0, 1440, 810);
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 9; c++) {
        if ((r + c) % 2 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(c * 160, r * 135, 160, 135); }
      }
    }
    const gs = 1.35;
    ctx.save();
    ctx.transform(gs, 0, 0, gs, (1440 - 1080 * gs) / 2, 0);
    ctx.drawImage(S.fieldLayer, 0, 0, 1080, 106, 0, 0, 1080, 106);
    game.fireTime = 0.37;
    S.drawCrowd();
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-50, 288); ctx.lineTo(1130, 288); ctx.stroke();
    for (let i = 0; i < S.GOAL_COUNT; i++) S.drawGoalFire(S.goalLeft(i), i * 1.3, i % 2 === 1);
    game.goalRipple[3] = 0.55;
    game.goalRippleX[3] = 750;
    for (let i = 0; i < S.GOAL_COUNT; i++) S.drawGoal(i);
    const by = 200;
    ctx.fillStyle = S.WHITE;
    for (let k = 0; k < 8; k++) {
      const ty = by + 18 + k * 24;
      if (ty > 330) break;
      ctx.globalAlpha = (1 - k / 8) * 0.4;
      ctx.beginPath(); ctx.arc(750, ty, 24 * (1 - k / 11), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    S.drawBallBody(750, by, 0.6, 1, 1, true);
    const conf = [[-150, 300, 0.4], [-100, 250, 2.1], [-190, 215, 1.2], [140, 295, 0.9], [190, 240, 2.6], [110, 210, 1.7],
      [-50, 330, 2.9], [70, 335, 0.2], [230, 320, 1.4], [-230, 300, 2.3]];
    for (let k = 0; k < conf.length; k++) {
      const [dx, y, rot] = conf[k];
      ctx.save();
      ctx.translate(750 + dx, y);
      ctx.rotate(rot);
      ctx.fillStyle = S.BRAND_COLORS[k % S.BRAND_COLORS.length];
      ctx.fillRect(-9, -5, 18, 10);
      ctx.restore();
    }
    ctx.restore();

    const ps = 2.1;
    const playerScreenX = (1440 - 1080 * gs) / 2 + 750 * gs;
    ctx.save();
    ctx.transform(ps, 0, 0, ps, playerScreenX - 750 * ps, 800 - 930 * ps);
    game.playerX = 750;
    game.playerDir = 1;
    game.walkPhase = 1.1;
    game.kickTime = S.KICK_TIME * 0.5;
    S.drawPlayer();
    ctx.restore();

    const vg = ctx.createRadialGradient(900, 420, 300, 900, 420, 1100);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, 1440, 810);
    ctx.restore();
  }

  // Title wordmark centred on (cx, cy), designed at ~1024px.
  function logo(cx, cy, k) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    S.drawBallBody(250, -250, 0.5, 1, 3.2, false);
    ctx.rotate(-0.05);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const word = (text, y, size, fill, lw) => {
      S.outlinedText(text, 0, y + size * 0.06, size, S.NAVY, S.NAVY, lw); // extrusion
      S.outlinedText(text, 0, y, size, fill, S.NAVY, lw);
    };
    word('SOCCER', -60, 250, S.WHITE, 34);
    word('SHOT', 170, 320, S.YELLOW, 38);
    ctx.restore();
  }

  const shot = (W, H, draw) => {
    cv.width = W;
    cv.height = H;
    ctx.clearRect(0, 0, W, H);
    draw();
    return cv.toDataURL('image/png');
  };

  return {
    banner: shot(1440, 810, () => scene(1440, 810)),
    logo: shot(1024, 1024, () => logo(512, 560, 1)),
    thumb: shot(1280, 720, () => {
      scene(1280, 720);
      const g = ctx.createLinearGradient(0, 0, 760, 0);
      g.addColorStop(0, 'rgba(22,29,69,0.45)');
      g.addColorStop(1, 'rgba(22,29,69,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1280, 720);
      logo(340, 400, 0.58);
    }),
  };
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const errors = [];
  try {
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`http://127.0.0.1:${server.address().port}/__art.html`, { waitUntil: 'networkidle0', timeout: 20000 });
    await p.waitForFunction(() => !!window.__ss, { timeout: 5000 });
    const out = await p.evaluate(renderAll);
    for (const [name, dataUrl] of Object.entries(out)) {
      const file = path.join(OUT_DIR, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`  ✓ ${path.relative(ROOT, file)}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
}

run().catch((e) => { console.error(e); process.exit(1); });
