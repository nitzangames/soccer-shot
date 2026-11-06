// Soccer Shot — tap to shoot a ball into 5 goals while the player slides.
// Single-file canvas game for play.nitzan.games.

const VERSION = 'v0.5.0';

// ── Canvas ──────────────────────────────────────────────────────────────────
const CANVAS_W = 1080;
const CANVAS_H = 1920;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Older Safari lacks roundRect; a small arcTo fallback keeps the rounded look.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const rr = Math.max(0, Math.min(typeof r === 'number' ? r : 0, Math.abs(w) / 2, Math.abs(h) / 2));
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
  };
}

// ── Layout ──────────────────────────────────────────────────────────────────
const FIELD_MARGIN = 30;
const GOAL_COUNT = 5;
const GOAL_W = 160;
const GOAL_GAP = 50;
const GOAL_ROW_LEFT = 40;                  // first goal left edge
const GOAL_CROSSBAR_Y = 280;               // where ball scores (goal line)
const GOAL_NET_H = 180;                    // visual depth of goal
const GOAL_TOP_Y = GOAL_CROSSBAR_Y - GOAL_NET_H; // 100 — top of visual goal
const FOUL_LINE_Y = 900;
// PLAYER_Y is the feet baseline. The sprite extends upward from here.
const PLAYER_Y = FOUL_LINE_Y + 30;
const PLAYER_HALF_W = 40;
const SPRITE_HEAD_TOP = 160; // distance above feet to top of head
const PLAYER_MIN_X = FIELD_MARGIN + PLAYER_HALF_W;
const PLAYER_MAX_X = CANVAS_W - FIELD_MARGIN - PLAYER_HALF_W;
const BALL_R = 24;
const STANDS_H = 96;                       // crowd strip behind the goals

// Goal center X for each goal index (0..4)
const GOAL_CENTERS = (() => {
  const out = [];
  for (let i = 0; i < GOAL_COUNT; i++) {
    out.push(GOAL_ROW_LEFT + GOAL_W / 2 + i * (GOAL_W + GOAL_GAP));
  }
  return out;
})();
const goalLeft = (i) => GOAL_ROW_LEFT + i * (GOAL_W + GOAL_GAP);

// ── Gameplay tuning ─────────────────────────────────────────────────────────
const PLAYER_SPEED = 612;      // px/s (v0.2: slowed 10%)
const BALL_SPEED_UP = 1450;    // px/s
const MAX_MISSES = 3;
const COMBO_2X_AT = 10;        // consecutive hits to unlock 2x
const COMBO_3X_AT = 20;        // consecutive hits to unlock 3x
const MAX_BALLS = 8;
const KICK_TIME = 0.2;         // seconds the kick pose is held

// ── Look: "Matchday" ────────────────────────────────────────────────────────
const FONT_FAMILY = '"Lilita One", system-ui, -apple-system, sans-serif';
const font = (px) => `${px}px ${FONT_FAMILY}`;
const TAU = Math.PI * 2;

const NAVY = '#1d2340';
const WHITE = '#ffffff';
const YELLOW = '#ffd23f';
const MISS_RED = '#ff5a5f';
const COMBO_RED = '#ff5a22';
const COMBO_BLUE = '#3aa0ff';
const GRASS = '#41b65b';
const NET_COLOR = 'rgba(255,255,255,0.6)';
const NET_INTERIOR = 'rgba(10,40,20,0.32)';
const OVERLAY = 'rgba(22,29,69,';   // + alpha + ')'
const BRAND_COLORS = ['#ff5a5f', '#ffd23f', '#3bceac', '#5e60ce', '#ff8c42'];

const KIT_SKIN = '#f2c299';
const KIT_JERSEY = '#e63946';
const KIT_STRIPE = '#ffffff';
const KIT_SHORTS = '#ffffff';
const KIT_SOCK = '#ffffff';
const KIT_SOCK_BAND = '#e63946';
const KIT_BOOT = NAVY;
const KIT_HAIR = '#3b2414';
const KIT_NUMBER_STROKE = '#9b1c28';

// Desktop gets keyboard prompts; touch devices keep "tap".
const IS_DESKTOP = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
const PROMPT_PLAY = IS_DESKTOP ? 'PRESS SPACE TO PLAY' : 'TAP TO PLAY';
const PROMPT_CONTINUE = IS_DESKTOP ? 'PRESS SPACE' : 'TAP TO CONTINUE';

// ── PlaySDK ─────────────────────────────────────────────────────────────────
const LEADERBOARD_BOARD = 'score';
const LEADERBOARD_LIMIT = 10;
const hasSdk = () => typeof window !== 'undefined' && !!window.PlaySDK;

// ── Audio ───────────────────────────────────────────────────────────────────
let audioCtx = null;
function ensureAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (_) {
    audioCtx = null;
  }
}
function beep(freq, dur, type = 'sine', vol = 0.22) {
  if (!audioCtx || audioCtx.state === 'suspended') return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
function sfxKick()  { beep(180, 0.08, 'square', 0.18); }
function sfxGoal()  { beep(620, 0.08, 'triangle', 0.25); setTimeout(() => beep(880, 0.12, 'triangle', 0.25), 60); }
function sfxMiss()  { beep(220, 0.22, 'sawtooth', 0.15); }
function sfxOver()  { beep(200, 0.2, 'square', 0.2); setTimeout(() => beep(140, 0.3, 'square', 0.2), 160); }
function sfxCombo() { beep(880, 0.09, 'triangle', 0.25); setTimeout(() => beep(1320, 0.12, 'triangle', 0.25), 80); }

// ── Game state ──────────────────────────────────────────────────────────────
const STATE_MENU = 'menu';
const STATE_PLAYING = 'playing';
const STATE_GAME_OVER = 'gameover';

const game = {
  state: STATE_MENU,
  score: 0,
  misses: 0,
  consecutive: 0,   // consecutive hits (resets on miss)
  best: 0,
  newBest: false,   // set at game over when the run beat the stored best
  playerX: CANVAS_W / 2,
  playerDir: 1,     // 1 = moving right, -1 = moving left
  balls: [],        // pool of active balls
  goalFlashes: new Array(GOAL_COUNT).fill(0), // seconds of flash remaining per goal
  goalRipple: new Float32Array(GOAL_COUNT),   // 1 → 0 net ripple strength per goal
  goalRippleX: new Float32Array(GOAL_COUNT),  // x where the ball hit the net
  fireTime: 0,      // global time used to animate fire, crowd, pulses
  shakeTime: 0,     // screen shake seconds remaining
  kickTime: 0,      // kick pose seconds remaining
  scorePop: 0,      // 1 → 0 bump on the HUD score after a goal
  menuPulse: 0,
  overScreenAge: 0,
  walkPhase: 0,     // advances with horizontal movement, drives leg/arm cycle
};

// Persisted best score
try {
  const saved = parseInt(localStorage.getItem('soccerShot.best') || '0', 10);
  if (!Number.isNaN(saved)) game.best = saved;
} catch (_) {}

function saveBest() {
  try { localStorage.setItem('soccerShot.best', String(game.best)); } catch (_) {}
}

// Leaderboard: null=loading, []=empty, [{rank,name,value,isMe}...]
let leaderboard = null;

// ── Combo helpers ───────────────────────────────────────────────────────────
function comboMultiplier(c) {
  if (c >= COMBO_3X_AT) return 3;
  if (c >= COMBO_2X_AT) return 2;
  return 1;
}
function comboColor(mult) {
  if (mult >= 3) return COMBO_BLUE;
  if (mult === 2) return COMBO_RED;
  return YELLOW;
}

// ── Particles (fixed pool, parallel arrays, swap-remove) ────────────────────
const PART_MAX = 256;
const PK_CONFETTI = 0;
const PK_PUFF = 1;
const PK_EMBER = 2;
const PART_COLORS = ['#ff5a5f', '#ffd23f', '#3bceac', '#5e60ce', '#ffffff', '#ff8c42',
  'rgba(255,255,255,0.7)', '#ffc23a', '#9ad8ff'];
const PC_PUFF = 6;
const PC_EMBER_RED = 7;
const PC_EMBER_BLUE = 8;
const pX = new Float32Array(PART_MAX);
const pY = new Float32Array(PART_MAX);
const pVX = new Float32Array(PART_MAX);
const pVY = new Float32Array(PART_MAX);
const pLife = new Float32Array(PART_MAX);
const pMax = new Float32Array(PART_MAX);
const pSize = new Float32Array(PART_MAX);
const pRot = new Float32Array(PART_MAX);
const pVR = new Float32Array(PART_MAX);
const pG = new Float32Array(PART_MAX);
const pDrag = new Float32Array(PART_MAX);
const pKind = new Uint8Array(PART_MAX);
const pColor = new Uint8Array(PART_MAX);
let partCount = 0;

function spawnParticle(kind, x, y, vx, vy, life, size, color, g, drag, rot, vr) {
  if (partCount >= PART_MAX) return;
  const i = partCount++;
  pKind[i] = kind; pX[i] = x; pY[i] = y; pVX[i] = vx; pVY[i] = vy;
  pLife[i] = life; pMax[i] = life; pSize[i] = size; pColor[i] = color;
  pG[i] = g; pDrag[i] = drag; pRot[i] = rot; pVR[i] = vr;
}
function copyParticle(from, to) {
  pKind[to] = pKind[from]; pX[to] = pX[from]; pY[to] = pY[from]; pVX[to] = pVX[from]; pVY[to] = pVY[from];
  pLife[to] = pLife[from]; pMax[to] = pMax[from]; pSize[to] = pSize[from]; pColor[to] = pColor[from];
  pG[to] = pG[from]; pDrag[to] = pDrag[from]; pRot[to] = pRot[from]; pVR[to] = pVR[from];
}
function updateParticles(dt) {
  for (let i = partCount - 1; i >= 0; i--) {
    pLife[i] -= dt;
    if (pLife[i] <= 0) {
      const last = --partCount;
      if (i !== last) copyParticle(last, i);
      continue;
    }
    const d = 1 - pDrag[i] * dt;
    pVY[i] += pG[i] * dt;
    pVX[i] *= d;
    pVY[i] *= d;
    pX[i] += pVX[i] * dt;
    pY[i] += pVY[i] * dt;
    pRot[i] += pVR[i] * dt;
  }
}
function burstConfetti(x) {
  for (let k = 0; k < 30; k++) {
    const a = Math.PI * (0.1 + Math.random() * 0.8);
    const sp = 300 + Math.random() * 600;
    const vx = Math.cos(a) * sp * (Math.random() < 0.5 ? -1 : 1);
    const vy = Math.sin(a) * sp * 0.6 - 200;
    spawnParticle(PK_CONFETTI, x, GOAL_CROSSBAR_Y + 6, vx, vy, 1.1, 14 + Math.random() * 8,
      k % 6, 1100, 1.2, Math.random() * 6, (Math.random() - 0.5) * 20);
  }
}
function burstPuff(x) {
  for (let k = 0; k < 8; k++) {
    spawnParticle(PK_PUFF, x, GOAL_CROSSBAR_Y, (Math.random() - 0.5) * 300, Math.random() * 200,
      0.5, 12, PC_PUFF, 0, 3, 0, 0);
  }
}
function spawnEmber(blue) {
  const gi = (Math.random() * GOAL_COUNT) | 0;
  const x = goalLeft(gi) + 10 + Math.random() * (GOAL_W - 20);
  spawnParticle(PK_EMBER, x, GOAL_TOP_Y - 30, (Math.random() - 0.5) * 60, -120 - Math.random() * 120,
    0.7, 4 + Math.random() * 3, blue ? PC_EMBER_BLUE : PC_EMBER_RED, 0, 0, 0, 0);
}

// ── Popups ("+2", "MISS", "2X COMBO!") — small fixed ring of reusable slots ─
const POPUP_MAX = 8;
const popups = [];
for (let i = 0; i < POPUP_MAX; i++) {
  popups.push({ active: false, x: 0, y: 0, text: '', life: 0, max: 1, color: WHITE, big: false });
}
let popupNext = 0;
function spawnPopup(x, y, text, color, big, life) {
  const p = popups[popupNext];
  popupNext = (popupNext + 1) % POPUP_MAX;
  p.active = true; p.x = x; p.y = y; p.text = text; p.color = color; p.big = big;
  p.life = life; p.max = life;
}
function updatePopups(dt) {
  for (let i = 0; i < POPUP_MAX; i++) {
    const p = popups[i];
    if (!p.active) continue;
    p.life -= dt;
    if (p.life <= 0) p.active = false;
  }
}
function clearEffects() {
  partCount = 0;
  for (let i = 0; i < POPUP_MAX; i++) popups[i].active = false;
  game.goalRipple.fill(0);
  game.scorePop = 0;
  game.kickTime = 0;
}

// ── Ball pool ───────────────────────────────────────────────────────────────
function spawnBall(x) {
  if (game.balls.length >= MAX_BALLS) return;
  const y = PLAYER_Y - SPRITE_HEAD_TOP - BALL_R - 2;
  game.balls.push({ x, y, startY: y, vy: -BALL_SPEED_UP, scored: false, spin: Math.random() * Math.PI * 2 });
  game.kickTime = KICK_TIME;
  sfxKick();
}

// Find which goal (0..4) contains this x, or -1 if none.
function goalIndexAt(x) {
  for (let i = 0; i < GOAL_COUNT; i++) {
    const left = goalLeft(i);
    if (x >= left && x <= left + GOAL_W) return i;
  }
  return -1;
}

// ── Transitions ─────────────────────────────────────────────────────────────
function startGame() {
  ensureAudio();
  game.state = STATE_PLAYING;
  game.score = 0;
  game.misses = 0;
  game.consecutive = 0;
  game.newBest = false;
  game.balls.length = 0;
  game.goalFlashes.fill(0);
  game.shakeTime = 0;
  game.playerX = CANVAS_W / 2;
  game.playerDir = 1;
  clearEffects();
}

function endGame() {
  game.state = STATE_GAME_OVER;
  game.newBest = game.score > game.best;
  if (game.newBest) {
    game.best = game.score;
    saveBest();
  }
  sfxOver();
  leaderboard = null;
  submitAndFetchLeaderboard();
}

function backToMenu() {
  game.state = STATE_MENU;
  game.balls.length = 0;
  clearEffects();
}

function submitAndFetchLeaderboard() {
  if (!hasSdk()) { leaderboard = []; return; }
  const sdk = window.PlaySDK;
  const doFetch = () => {
    sdk.getLeaderboard(LEADERBOARD_BOARD, LEADERBOARD_LIMIT)
      .then((data) => {
        if (!data || !data.entries) { leaderboard = []; return; }
        leaderboard = data.entries.map((e) => ({
          rank: e.rank,
          name: (e.metadata && (e.metadata.displayName || e.metadata.name)) || 'Player',
          value: e.value,
          isMe: !!e.isMe,
        }));
      })
      .catch(() => { leaderboard = []; });
  };
  if (sdk.isSignedIn && game.score > 0) {
    sdk.submitScore(LEADERBOARD_BOARD, game.score, 'desc', {}).then(doFetch).catch(doFetch);
  } else {
    doFetch();
  }
}

// Prefetch leaderboard on load so menu can show it.
submitAndFetchLeaderboard();

// ── Input ───────────────────────────────────────────────────────────────────
let canvasRect = canvas.getBoundingClientRect();
let canvasScaleX = canvas.width / canvasRect.width;
window.addEventListener('resize', () => {
  canvasRect = canvas.getBoundingClientRect();
  canvasScaleX = canvas.width / canvasRect.width;
});

function onTap() {
  ensureAudio();
  if (game.state === STATE_MENU) {
    startGame();
    return;
  }
  if (game.state === STATE_GAME_OVER) {
    // Small debounce — require the over-screen to have been up a bit.
    if (game.overScreenAge > 0.6) backToMenu();
    return;
  }
  if (game.state === STATE_PLAYING) {
    spawnBall(game.playerX);
  }
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  onTap();
}, { passive: false });

// Keyboard (desktop): Space / Enter / ↑ / W act exactly like a tap.
// Held keys don't auto-fire — every shot is a fresh press.
const SHOOT_KEYS = new Set([' ', 'Spacebar', 'Enter', 'ArrowUp', 'w', 'W']);
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!SHOOT_KEYS.has(e.key)) return;
  e.preventDefault();
  if (e.repeat) return;
  onTap();
});

// ── Update ──────────────────────────────────────────────────────────────────
function updatePlayer(dt) {
  const move = PLAYER_SPEED * game.playerDir * dt;
  game.playerX += move;
  game.walkPhase += Math.abs(move) * 0.022; // radians per pixel of travel
  if (game.playerX >= PLAYER_MAX_X) {
    game.playerX = PLAYER_MAX_X;
    game.playerDir = -1;
  } else if (game.playerX <= PLAYER_MIN_X) {
    game.playerX = PLAYER_MIN_X;
    game.playerDir = 1;
  }
}

function updateBalls(dt) {
  const balls = game.balls;
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    if (b.scored) {
      // After scoring, the ball has a target y at the back of the net. Ease
      // toward it, hold briefly, then fade and disappear.
      b.y += (b.targetY - b.y) * Math.min(1, dt * 10);
      b.spin += dt * 2;
      b.lifetime -= dt;
      if (b.lifetime < 0.35) b.alpha = Math.max(0, b.lifetime / 0.35);
      if (b.lifetime <= 0) balls.splice(i, 1);
      continue;
    }
    b.y += b.vy * dt;
    b.spin += dt * 8;
    if (b.y <= GOAL_CROSSBAR_Y) {
      // Ball has reached goal line — decide hit or miss.
      const gi = goalIndexAt(b.x);
      if (gi >= 0) {
        // GOAL!
        const prevMult = comboMultiplier(game.consecutive);
        game.score += 1 * prevMult;
        game.consecutive += 1;
        const newMult = comboMultiplier(game.consecutive);
        game.goalFlashes[gi] = 0.5;
        game.goalRipple[gi] = 1;
        game.goalRippleX[gi] = b.x;
        game.scorePop = 1;
        b.scored = true;
        // Stop inside the net, near the back (≈75% of net depth).
        b.targetY = GOAL_TOP_Y + GOAL_NET_H * 0.25;
        b.lifetime = 0.9;
        b.alpha = 1;
        b.vy = 0;
        sfxGoal();
        burstConfetti(b.x);
        spawnPopup(b.x, GOAL_CROSSBAR_Y + 80, '+' + prevMult, YELLOW, false, 0.9);
        // Combo threshold crossed?
        if (newMult > prevMult) {
          sfxCombo();
          spawnPopup(CANVAS_W / 2, 640, newMult + 'X COMBO!', comboColor(newMult), true, 1.5);
        }
      } else {
        // MISS
        game.misses += 1;
        game.consecutive = 0;
        game.shakeTime = 0.25;
        sfxMiss();
        burstPuff(b.x);
        spawnPopup(b.x, GOAL_CROSSBAR_Y + 80, 'MISS', MISS_RED, false, 0.9);
        balls.splice(i, 1);
        if (game.misses >= MAX_MISSES) {
          endGame();
          return;
        }
      }
    }
  }
}

function updateGoalFlashes(dt) {
  for (let i = 0; i < GOAL_COUNT; i++) {
    if (game.goalFlashes[i] > 0) game.goalFlashes[i] = Math.max(0, game.goalFlashes[i] - dt);
    if (game.goalRipple[i] > 0) game.goalRipple[i] = Math.max(0, game.goalRipple[i] - dt * 1.5);
  }
}

function update(dt) {
  game.fireTime += dt;
  if (game.shakeTime > 0) game.shakeTime = Math.max(0, game.shakeTime - dt);
  if (game.kickTime > 0) game.kickTime = Math.max(0, game.kickTime - dt);
  if (game.scorePop > 0) game.scorePop = Math.max(0, game.scorePop - dt * 4);
  updateParticles(dt);
  updatePopups(dt);

  if (game.state === STATE_PLAYING) {
    updatePlayer(dt);
    updateBalls(dt);
    updateGoalFlashes(dt);
    const mult = comboMultiplier(game.consecutive);
    if (mult > 1 && Math.random() < dt * 30) spawnEmber(mult >= 3);
  } else if (game.state === STATE_MENU) {
    game.menuPulse += dt;
    // let player animate in background for life
    updatePlayer(dt);
  }
  // STATE_GAME_OVER: world freezes; loop() tracks overScreenAge.
}

// ── Static art (built once) ─────────────────────────────────────────────────
function seededRandom(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Crowd in the stands: parallel arrays, drawn batched by colour.
const CROWD_COLORS = ['#ff5a5f', '#ffd23f', '#ffffff', '#3bceac', '#5e60ce', '#ff8c42', '#e0e6ff'];
const CROWD_PER_ROW = Math.ceil((CANVAS_W - 10) / 22);
const CROWD_N = CROWD_PER_ROW * 3;
const crowdX = new Float32Array(CROWD_N);
const crowdY = new Float32Array(CROWD_N);
const crowdPh = new Float32Array(CROWD_N);
const crowdC = new Uint8Array(CROWD_N);
(() => {
  const rnd = seededRandom(7);
  let n = 0;
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < CROWD_PER_ROW; k++) {
      crowdX[n] = 10 + k * 22 + rnd() * 8 + (row % 2) * 11;
      crowdY[n] = 18 + row * 20;
      crowdC[n] = (rnd() * CROWD_COLORS.length) | 0;
      crowdPh[n] = rnd() * 6;
      n++;
    }
  }
})();

// Grass, mowing pattern, stands backdrop, ad boards, and pitch markings never
// change, so they're painted once into an offscreen layer.
const fieldLayer = document.createElement('canvas');
fieldLayer.width = CANVAS_W;
fieldLayer.height = CANVAS_H;
function buildFieldLayer() {
  const c = fieldLayer.getContext('2d');
  c.fillStyle = GRASS;
  c.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Checkered mowing + darker horizontal bands
  c.fillStyle = 'rgba(255,255,255,0.05)';
  for (let r = 0; r < 16; r++) {
    for (let col = 0; col < 5; col++) if ((r + col) % 2 === 0) c.fillRect(col * 216, r * 120, 216, 120);
  }
  c.fillStyle = 'rgba(0,40,0,0.05)';
  for (let y = 0; y < CANVAS_H; y += 240) c.fillRect(0, y, CANVAS_W, 120);
  // Stands
  const sg = c.createLinearGradient(0, 0, 0, STANDS_H);
  sg.addColorStop(0, '#161d45');
  sg.addColorStop(1, '#2b377a');
  c.fillStyle = sg;
  c.fillRect(0, 0, CANVAS_W, STANDS_H);
  // Ad boards
  c.font = font(18);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (let k = 0; k < 5; k++) {
    c.fillStyle = BRAND_COLORS[k];
    c.fillRect(k * 216, 74, 216, 24);
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.fillText('SOCCER SHOT', k * 216 + 108, 87);
  }
  c.fillStyle = 'rgba(0,0,0,0.2)';
  c.fillRect(0, 98, CANVAS_W, 8);
  // Pitch markings
  c.strokeStyle = 'rgba(255,255,255,0.92)';
  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.lineCap = 'round';
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(FIELD_MARGIN, GOAL_CROSSBAR_Y + 8);
  c.lineTo(CANVAS_W - FIELD_MARGIN, GOAL_CROSSBAR_Y + 8);
  c.stroke();
  c.lineWidth = 9;
  c.beginPath();
  c.moveTo(FIELD_MARGIN, FOUL_LINE_Y);
  c.lineTo(CANVAS_W - FIELD_MARGIN, FOUL_LINE_Y);
  c.stroke();
  c.lineWidth = 7;
  c.beginPath();
  c.arc(CANVAS_W / 2, FOUL_LINE_Y, 160, Math.PI, 0, false);
  c.stroke();
  c.beginPath();
  c.arc(CANVAS_W / 2, FOUL_LINE_Y - 80, 9, 0, TAU);
  c.fill();
  // Soft shadow at the base of each goal
  c.fillStyle = 'rgba(10,50,20,0.18)';
  for (let i = 0; i < GOAL_COUNT; i++) c.fillRect(goalLeft(i) + 4, GOAL_CROSSBAR_Y + 4, GOAL_W + 6, 12);
}
buildFieldLayer();
// Rebuild once the web font arrives so the ad boards use it.
if (document.fonts && document.fonts.load) {
  document.fonts.load(font(64)).then(buildFieldLayer).catch(() => {});
}

// Gradients that never move are created once. Flame and ball gradients live in
// local (translated/scaled) space so one instance serves every draw.
const VIGNETTE = (() => {
  const g = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H * 0.45, CANVAS_W * 0.35, CANVAS_W / 2, CANVAS_H * 0.45, CANVAS_H * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  return g;
})();
function flameGradient(c0, c1, c2) {
  const g = ctx.createLinearGradient(0, -1, 0, 0);
  g.addColorStop(0, c0);
  g.addColorStop(0.35, c1);
  g.addColorStop(1, c2);
  return g;
}
const FLAME_RED = [
  flameGradient('rgba(255,200,60,0)', 'rgba(255,120,20,0.92)', 'rgba(210,30,0,0.9)'),
  flameGradient('rgba(255,255,200,0)', 'rgba(255,240,120,0.95)', '#fff6c0'),
];
const FLAME_BLUE = [
  flameGradient('rgba(120,200,255,0)', 'rgba(80,160,255,0.9)', 'rgba(30,40,220,0.9)'),
  flameGradient('rgba(230,250,255,0)', 'rgba(210,245,255,0.95)', '#ffffff'),
];
const BALL_GRAD = (() => {
  const g = ctx.createRadialGradient(-8, -8, 2, 0, 0, BALL_R);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#d5dbe6');
  return g;
})();

// ── Render helpers ──────────────────────────────────────────────────────────
function outlinedText(text, x, y, size, fill, stroke, lineWidth) {
  ctx.font = font(size);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}
function outlinedRoundRect(x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.stroke();
}
function outlinedCircle(x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.stroke();
}
// Rounded button-like pill, centred on (cx, cy).
function drawPill(cx, cy, text, size, fill, textColor, scale) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.font = font(size);
  const w = ctx.measureText(text).width + size * 1.4;
  const h = size * 1.7;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2 + 8, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 3);
  ctx.restore();
}
function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// ── Render: world ───────────────────────────────────────────────────────────
function drawCrowd() {
  let cheering = false;
  for (let i = 0; i < GOAL_COUNT; i++) if (game.goalFlashes[i] > 0) cheering = true;
  const t = game.fireTime;
  for (let ci = 0; ci < CROWD_COLORS.length; ci++) {
    ctx.fillStyle = CROWD_COLORS[ci];
    ctx.beginPath();
    for (let k = 0; k < CROWD_N; k++) {
      if (crowdC[k] !== ci) continue;
      const bob = cheering ? Math.abs(Math.sin(t * 18 + crowdPh[k])) * 7 : Math.sin(t * 2 + crowdPh[k]) * 1.5;
      const y = crowdY[k] - bob;
      ctx.moveTo(crowdX[k] + 8, y);
      ctx.arc(crowdX[k], y, 8, 0, TAU);
    }
    ctx.fill();
  }
}

// Flickering flames above a goal, two layers (outer + hot core).
function drawGoalFire(left, phase, blue) {
  const grads = blue ? FLAME_BLUE : FLAME_RED;
  const t = game.fireTime + phase;
  for (let layer = 0; layer < 2; layer++) {
    ctx.fillStyle = grads[layer];
    for (let k = 0; k < 8; k++) {
      const fx = left + GOAL_W * (k + 0.5) / 8;
      const flick = Math.sin(t * 14 + k * 1.7) * 12 + Math.sin(t * 23 + k * 3.1) * 8;
      const h = layer ? 48 + flick * 0.6 : 86 + flick;
      const hw = layer ? 8 : 15;
      ctx.save();
      ctx.translate(fx, GOAL_TOP_Y);
      ctx.scale(hw, h);
      ctx.beginPath();
      ctx.moveTo(-1, 0);
      ctx.quadraticCurveTo(-0.7, -0.5, 0, -1);
      ctx.quadraticCurveTo(0.7, -0.5, 1, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}

// Net mesh displacement while a goal's ripple is active.
function netBulge(x, y, rv, rx) {
  const dx = x - rx;
  const dy = y - (GOAL_TOP_Y + 60);
  return -rv * 16 * Math.exp(-(dx * dx + dy * dy) / 3000) * Math.cos((1 - rv) * 14);
}

function traceGoalFrame(l, r, t, b, h) {
  ctx.beginPath();
  ctx.moveTo(l + h, b + 2);
  ctx.lineTo(l + h, t + h);
  ctx.lineTo(r - h, t + h);
  ctx.lineTo(r - h, b + 2);
}

// Box goal seen from the front: back-of-net mesh, side panels, outlined frame.
function drawGoal(i) {
  const l = goalLeft(i);
  const r = l + GOAL_W;
  const t = GOAL_TOP_Y;
  const b = GOAL_CROSSBAR_Y;
  const bl = l + 20, br = r - 20, bt = t + 14, bb = b - 30;

  ctx.fillStyle = NET_INTERIOR;
  ctx.fillRect(l + 6, t + 6, GOAL_W - 12, GOAL_NET_H - 6);

  ctx.save();
  ctx.beginPath();
  ctx.rect(l + 6, t + 6, GOAL_W - 12, GOAL_NET_H - 6);
  ctx.clip();
  ctx.strokeStyle = NET_COLOR;
  ctx.lineWidth = 1.6;
  const rv = game.goalRipple[i];
  const rx = game.goalRippleX[i];
  ctx.beginPath();
  if (rv > 0) {
    for (let y = bt; y <= bb; y += 14) {
      for (let x = bl; x <= br; x += 6) {
        const yy = y + netBulge(x, y, rv, rx);
        if (x === bl) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
    }
    for (let x = bl; x <= br; x += 14) {
      for (let y = bt; y <= bb; y += 6) {
        const yy = y + netBulge(x, y, rv, rx);
        if (y === bt) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
    }
  } else {
    for (let y = bt; y <= bb; y += 14) { ctx.moveTo(bl, y); ctx.lineTo(br, y); }
    for (let x = bl; x <= br; x += 14) { ctx.moveTo(x, bt); ctx.lineTo(x, bb); }
  }
  ctx.stroke();
  // Side panels converge from the front posts to the back frame
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  for (let k = 0; k <= 8; k++) {
    const f = k / 8;
    ctx.moveTo(l + 6, t + f * (b - t));
    ctx.lineTo(bl, bt + f * (bb - bt));
    ctx.moveTo(r - 6, t + f * (b - t));
    ctx.lineTo(br, bt + f * (bb - bt));
  }
  ctx.moveTo(bl, bb);
  ctx.lineTo(br, bb);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const flash = game.goalFlashes[i];
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,214,70,${Math.min(0.75, flash * 1.5)})`;
    ctx.fillRect(l, t, GOAL_W, GOAL_NET_H);
  }
  ctx.restore();

  // Frame: navy outline, white posts, a touch of shading
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const pw = 11;
  const h = pw / 2;
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = pw + 7;
  traceGoalFrame(l, r, t, b, h);
  ctx.stroke();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = pw;
  traceGoalFrame(l, r, t, b, h);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(29,35,64,0.25)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(l + h + 3, b);
  ctx.lineTo(l + h + 3, t + h + 3);
  ctx.lineTo(r - h - 3, t + h + 3);
  ctx.moveTo(r - h + 3, t + h + 2);
  ctx.lineTo(r - h + 3, b);
  ctx.stroke();
  ctx.restore();
}

function drawGoals() {
  const mult = comboMultiplier(game.consecutive);
  if (mult > 1) {
    for (let i = 0; i < GOAL_COUNT; i++) drawGoalFire(goalLeft(i), i, mult >= 3);
  }
  for (let i = 0; i < GOAL_COUNT; i++) drawGoal(i);
}

function drawLeg(lx, ly, side, hipY) {
  outlinedRoundRect(lx - 8, hipY, 16, ly - hipY - 8, 6, KIT_SKIN);
  outlinedRoundRect(lx - 9, ly - 30, 18, 22, 4, KIT_SOCK);
  ctx.fillStyle = KIT_SOCK_BAND;
  ctx.fillRect(lx - 8, ly - 28, 16, 5);
  outlinedRoundRect(lx - 11 + side * 2, ly - 12, 22, 13, 5, KIT_BOOT);
}

// Back-view striker with a navy outline. Legs/arms swing with walkPhase, the
// torso leans into the direction of travel, and the right leg lifts on a kick.
function drawPlayer() {
  const cx = game.playerX;
  const fy = PLAYER_Y;
  const walk = Math.sin(game.walkPhase);
  const lean = game.playerDir * 0.06;
  const kick = game.kickTime > 0 ? Math.sin((1 - game.kickTime / KICK_TIME) * Math.PI) : 0;
  const hipY = fy - 58;

  // Shadow
  ctx.fillStyle = 'rgba(0,40,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(cx, fy + 4, 46, 11, 0, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';

  // Legs
  drawLeg(cx - 14 + walk * 6, fy - walk * 4, -1, hipY);
  drawLeg(cx + 14 - walk * 6, fy + walk * 4 - kick * 36, 1, hipY);

  // Torso, arms, shorts (leaning)
  ctx.save();
  ctx.translate(cx, hipY - 4);
  ctx.rotate(lean - kick * 0.08);
  const swing = walk * 10;
  outlinedRoundRect(-44, -56, 13, 42 - swing, 6, KIT_SKIN);
  outlinedRoundRect(31, -56, 13, 42 + swing, 6, KIT_SKIN);
  outlinedRoundRect(-29, -6, 58, 30, 8, KIT_SHORTS);
  outlinedRoundRect(-33, -64, 66, 62, 14, KIT_JERSEY);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-33, -64, 66, 62, 14);
  ctx.clip();
  ctx.fillStyle = KIT_STRIPE;
  ctx.fillRect(-5, -64, 10, 62);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(-33, -64, 66, 12);
  ctx.restore();
  outlinedRoundRect(-45, -60, 15, 15, 6, KIT_JERSEY);
  outlinedRoundRect(30, -60, 15, 15, 6, KIT_JERSEY);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  outlinedText('9', 17, -31, 34, WHITE, KIT_NUMBER_STROKE, 5);
  ctx.restore();

  // Head (upright, gentle bob)
  const hy = hipY - 68 - Math.abs(walk) * 1.5;
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 4;
  outlinedCircle(cx - 22, hy + 2, 6, KIT_SKIN);
  outlinedCircle(cx + 22, hy + 2, 6, KIT_SKIN);
  outlinedCircle(cx, hy, 23, KIT_SKIN);
  ctx.fillStyle = KIT_HAIR;
  ctx.beginPath();
  ctx.arc(cx, hy - 1, 23, Math.PI + 0.1, -0.1);
  ctx.lineTo(cx + 22, hy + 6);
  ctx.quadraticCurveTo(cx, hy + 14, cx - 22, hy + 6);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, hy, 23, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.ellipse(cx - 8, hy - 12, 8, 5, -0.5, 0, TAU);
  ctx.fill();
}

// Classic panel ball. Also used for HUD/menu icons via `scale`.
function drawBallBody(x, y, spin, alpha, scale, shadow) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (shadow) {
    ctx.fillStyle = 'rgba(0,40,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 6 * scale, y + 10 * scale, BALL_R * scale, BALL_R * 0.8 * scale, 0, 0, TAU);
    ctx.fill();
  }
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = BALL_GRAD;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_R, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.rotate(spin);
  ctx.fillStyle = NAVY;
  ctx.beginPath();
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * BALL_R * 0.32, Math.sin(a) * BALL_R * 0.32);
  }
  ctx.fill();
  for (let k = 0; k < 5; k++) {
    ctx.save();
    ctx.rotate((k / 5) * TAU);
    ctx.beginPath();
    ctx.moveTo(-BALL_R * 0.3, -BALL_R * 0.82);
    ctx.lineTo(BALL_R * 0.3, -BALL_R * 0.82);
    ctx.lineTo(BALL_R * 0.18, -BALL_R * 0.5);
    ctx.lineTo(-BALL_R * 0.18, -BALL_R * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_R, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(-8, -10, 6, 4, -0.6, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBalls() {
  const balls = game.balls;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (!b.scored) {
      // Speed trail: the ball travels straight up, so the trail is a fading
      // column of ghosts below it (never below the kick point).
      ctx.fillStyle = WHITE;
      for (let k = 0; k < 10; k++) {
        const ty = b.y + 18 + k * 28;
        if (ty > b.startY) break;
        ctx.globalAlpha = (1 - k / 10) * 0.35;
        ctx.beginPath();
        ctx.arc(b.x, ty, BALL_R * (1 - k / 12), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    drawBallBody(b.x, b.y, b.spin, b.alpha == null ? 1 : b.alpha, 1, true);
  }
}

function drawParticles() {
  for (let i = 0; i < partCount; i++) {
    ctx.globalAlpha = Math.min(1, pLife[i] / (pMax[i] * 0.5));
    ctx.fillStyle = PART_COLORS[pColor[i]];
    const s = pSize[i];
    const kind = pKind[i];
    if (kind === PK_CONFETTI) {
      ctx.save();
      ctx.translate(pX[i], pY[i]);
      ctx.rotate(pRot[i]);
      ctx.fillRect(-s / 2, -s * 0.3, s, s * 0.6);
      ctx.restore();
    } else if (kind === PK_PUFF) {
      ctx.beginPath();
      ctx.arc(pX[i], pY[i], s * (2 - pLife[i] / pMax[i]), 0, TAU);
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      ctx.arc(pX[i], pY[i], s, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  ctx.globalAlpha = 1;
}

function drawPopups() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < POPUP_MAX; i++) {
    const p = popups[i];
    if (!p.active) continue;
    const age = 1 - p.life / p.max;
    const sc = age < 0.15 ? 0.4 + (age / 0.15) * 0.8 : 1.2 - Math.min(0.2, (age - 0.15) * 1.5);
    ctx.save();
    ctx.globalAlpha = p.life < 0.35 ? p.life / 0.35 : 1;
    ctx.translate(p.x, p.y - (p.big ? 0 : age * 90));
    ctx.scale(sc, sc);
    outlinedText(p.text, 0, 0, p.big ? 110 : 64, p.color, NAVY, p.big ? 17 : 12);
    ctx.restore();
  }
}

// ── Render: HUD & screens ───────────────────────────────────────────────────
// The lower half of the pitch is empty during play, so the score lives there.
function drawHud() {
  const cx = CANVAS_W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = font(44);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('SCORE', cx, 1200);
  const pop = game.scorePop;
  const sc = 1 + pop * pop * 0.25;
  ctx.save();
  ctx.translate(cx, 1340);
  ctx.scale(sc, sc);
  outlinedText(String(game.score), 0, 0, 210, WHITE, NAVY, 16);
  ctx.restore();

  // Streak bar toward the next multiplier
  const c = game.consecutive;
  const mult = comboMultiplier(c);
  let frac, next;
  if (mult === 1) { frac = c / COMBO_2X_AT; next = '2X'; }
  else if (mult === 2) { frac = (c - COMBO_2X_AT) / (COMBO_3X_AT - COMBO_2X_AT); next = '3X'; }
  else { frac = 1; next = 'MAX'; }
  const bx = 240, bw = 600, by = 1480;
  const barColor = comboColor(mult);
  ctx.fillStyle = NAVY;
  ctx.beginPath();
  ctx.roundRect(bx - 8, by - 8, bw + 16, 60, 30);
  ctx.fill();
  ctx.fillStyle = barColor;
  ctx.beginPath();
  ctx.roundRect(bx, by, Math.max(44, bw * frac), 44, 22);
  ctx.fill();
  ctx.textAlign = 'left';
  outlinedText('STREAK ' + c, bx + 22, by + 23, 30, WHITE, NAVY, 6);
  ctx.textAlign = 'right';
  outlinedText(next, bx + bw - 20, by + 23, 30, WHITE, NAVY, 6);
  if (mult > 1) {
    const pulse = 1 + Math.sin(game.fireTime * 10) * 0.06;
    ctx.save();
    ctx.translate(bx - 60, by + 22);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = NAVY;
    ctx.lineWidth = 6;
    outlinedCircle(0, 0, 46, barColor);
    ctx.textAlign = 'center';
    ctx.font = font(44);
    ctx.fillStyle = WHITE;
    ctx.fillText(mult + 'x', 0, 2);
    ctx.restore();
  }

  // Misses: three ball icons, crossed out as they're used
  for (let k = 0; k < MAX_MISSES; k++) {
    const x = cx - 80 + k * 80;
    const y = 1630;
    const used = k < game.misses;
    drawBallBody(x, y, 0, used ? 0.35 : 1, 1, false);
    if (used) {
      ctx.strokeStyle = MISS_RED;
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 18, y - 18); ctx.lineTo(x + 18, y + 18);
      ctx.moveTo(x + 18, y - 18); ctx.lineTo(x - 18, y + 18);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  }

  ctx.textAlign = 'center';
  ctx.font = font(36);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('BEST ' + game.best, cx, 1730);

  drawVersion('left');
}

function drawVersion(align) {
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '22px system-ui, -apple-system, sans-serif';
  ctx.textAlign = align;
  ctx.textBaseline = 'bottom';
  ctx.fillText(VERSION, align === 'left' ? 20 : CANVAS_W / 2, CANVAS_H - 14);
}

function drawMenu() {
  ctx.fillStyle = OVERLAY + '0.55)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const cx = CANVAS_W / 2;
  const t = game.menuPulse;

  drawBallBody(cx, 430 + Math.sin(t * 2.2) * 16, t * 1.5, 1, 2.6, false);

  ctx.save();
  ctx.translate(cx, 680);
  ctx.rotate(-0.05);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  outlinedText('SOCCER', 0, 0, 180, WHITE, NAVY, 22);
  outlinedText('SHOT', 0, 190, 240, YELLOW, NAVY, 24);
  ctx.restore();

  drawPill(cx, 1100, PROMPT_PLAY, IS_DESKTOP ? 50 : 56, YELLOW, NAVY, 1 + 0.05 * Math.sin(t * 4.6));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  outlinedText('BEST ' + game.best, cx, 1230, 52, WHITE, NAVY, 10);

  drawLeaderboard(1310, 5);
  drawVersion('center');
}

function drawLeaderboard(topY, maxRows) {
  const cardW = 760;
  const x = (CANVAS_W - cardW) / 2;
  let msg = null;
  let rows = 0;
  if (leaderboard === null) msg = 'Loading…';
  else if (leaderboard.length === 0) msg = 'Sign in on the home page to compete';
  else rows = Math.min(leaderboard.length, maxRows);
  const h = msg ? 170 : 104 + rows * 56;

  ctx.fillStyle = 'rgba(29,35,64,0.88)';
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, topY, cardW, h, 28);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(42);
  ctx.fillStyle = YELLOW;
  ctx.fillText('LEADERBOARD', CANVAS_W / 2, topY + 50);

  if (msg) {
    ctx.font = font(32);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(msg, CANVAS_W / 2, topY + 115);
    return;
  }
  ctx.font = font(34);
  for (let i = 0; i < rows; i++) {
    const e = leaderboard[i];
    const y = topY + 104 + i * 56;
    if (e.isMe) {
      ctx.fillStyle = 'rgba(255,210,63,0.18)';
      ctx.beginPath();
      ctx.roundRect(x + 20, y - 24, cardW - 40, 48, 14);
      ctx.fill();
    }
    ctx.fillStyle = e.isMe ? YELLOW : WHITE;
    ctx.textAlign = 'left';
    ctx.fillText(`${e.rank}.`, x + 44, y);
    const name = e.name.length > 18 ? e.name.slice(0, 17) + '…' : e.name;
    ctx.fillText(name, x + 120, y);
    ctx.textAlign = 'right';
    ctx.fillText(String(e.value), x + cardW - 44, y);
  }
}

function drawGameOver() {
  const age = game.overScreenAge || 0;
  const cx = CANVAS_W / 2;
  ctx.fillStyle = OVERLAY + '0.72)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const ts = age < 0.4 ? Math.max(0.01, easeOutBack(age / 0.4)) : 1;
  ctx.save();
  ctx.translate(cx, 400);
  ctx.rotate(-0.04);
  ctx.scale(ts, ts);
  outlinedText('FULL TIME', 0, 0, 150, WHITE, NAVY, 20);
  ctx.restore();

  ctx.font = font(48);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText('SCORE', cx, 570);
  outlinedText(String(game.score), cx, 710, 230, WHITE, NAVY, 18);

  if (game.newBest) {
    ctx.save();
    ctx.translate(cx, 880);
    ctx.rotate(-0.06);
    drawPill(0, 0, 'NEW BEST!', 56, YELLOW, NAVY, 1 + 0.06 * Math.sin(age * 6));
    ctx.restore();
  } else {
    outlinedText('BEST ' + game.best, cx, 880, 52, YELLOW, NAVY, 10);
  }

  drawLeaderboard(980, 6);

  if (age > 0.6) drawPill(cx, 1700, PROMPT_CONTINUE, 48, WHITE, NAVY, 1 + 0.04 * Math.sin(age * 5));
}

function render() {
  // Screen shake
  let sx = 0, sy = 0;
  if (game.shakeTime > 0) {
    const s = game.shakeTime * 40;
    sx = (Math.random() - 0.5) * s;
    sy = (Math.random() - 0.5) * s;
  }
  ctx.save();
  ctx.translate(sx, sy);

  ctx.drawImage(fieldLayer, 0, 0);
  drawCrowd();
  drawGoals();
  drawBalls();
  drawPlayer();
  drawParticles();

  ctx.restore();

  ctx.fillStyle = VIGNETTE;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (game.state === STATE_PLAYING) {
    drawHud();
    drawPopups();
  } else if (game.state === STATE_MENU) {
    drawMenu();
  } else if (game.state === STATE_GAME_OVER) {
    drawGameOver();
  }
}

// ── Loop with pause/resume ──────────────────────────────────────────────────
let rafId = null;
let lastT = performance.now();
let paused = false;

function loop(t) {
  if (paused) return;
  let dt = (t - lastT) / 1000;
  lastT = t;
  if (dt > 0.1) dt = 0.1; // spiral-of-death cap
  if (game.state === STATE_GAME_OVER) {
    // track overlay age for tap-to-continue debounce and intro animation
    game.overScreenAge = (game.overScreenAge || 0) + dt;
  } else {
    game.overScreenAge = 0;
  }
  update(dt);
  render();
  rafId = requestAnimationFrame(loop);
}

function pause() {
  if (paused) return;
  paused = true;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
}

function resume() {
  if (!paused) return;
  paused = false;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  lastT = performance.now();
  rafId = requestAnimationFrame(loop);
}

// Wire PlaySDK lifecycle if available
if (hasSdk()) {
  if (typeof window.PlaySDK.onPause === 'function') window.PlaySDK.onPause(pause);
  if (typeof window.PlaySDK.onResume === 'function') window.PlaySDK.onResume(resume);
}
// Fallback: browser visibilitychange
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause(); else resume();
});

// Screenshot mode: auto-start gameplay with some visual activity when loaded
// with ?screenshot=1 (via PlaySDK.screenshotMode or URL fallback).
const screenshotMode =
  (typeof window !== 'undefined' && window.PlaySDK && window.PlaySDK.screenshotMode) ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).get('screenshot') === '1');
if (screenshotMode) {
  startGame();
  game.score = 12;
  game.consecutive = 8;
  // Spawn a ball ~150ms before each expected capture time so every screenshot
  // catches a ball mid-flight. Offsets must stay in sync with screenshot.js.
  const captureOffsetsMs = [800, 1800, 2800, 4000, 5500];
  captureOffsetsMs.forEach((t) => {
    setTimeout(() => { if (game.state === STATE_PLAYING) spawnBall(game.playerX); }, Math.max(0, t - 150));
  });
}

// Kick off
rafId = requestAnimationFrame(loop);
