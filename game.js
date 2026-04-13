// Soccer Shot — tap to shoot a ball into 5 goals while the player slides.
// Single-file canvas game for play.nitzan.games.

const VERSION = 'v0.4.0';

// ── Canvas ──────────────────────────────────────────────────────────────────
const CANVAS_W = 1080;
const CANVAS_H = 1920;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ── Layout ──────────────────────────────────────────────────────────────────
const FIELD_MARGIN = 30;
const GOAL_COUNT = 5;
const GOAL_W = 160;
const GOAL_GAP = 50;
const GOAL_ROW_LEFT = 40;                  // first goal left edge
const GOAL_CROSSBAR_Y = 280;               // where ball scores (goal line)
const GOAL_NET_H = 180;                    // visual depth of goal
const GOAL_TOP_Y = GOAL_CROSSBAR_Y - GOAL_NET_H; // 100 — top of visual goal
const GOAL_POST_W = 10;
const FOUL_LINE_Y = 900;
// PLAYER_Y is the feet baseline. The sprite extends upward from here.
const PLAYER_Y = FOUL_LINE_Y + 30;
const PLAYER_HALF_W = 40;
const SPRITE_HEAD_TOP = 160; // distance above feet to top of head
const PLAYER_MIN_X = FIELD_MARGIN + PLAYER_HALF_W;
const PLAYER_MAX_X = CANVAS_W - FIELD_MARGIN - PLAYER_HALF_W;
const BALL_R = 24;

// Goal center X for each goal index (0..4)
const GOAL_CENTERS = (() => {
  const out = [];
  for (let i = 0; i < GOAL_COUNT; i++) {
    out.push(GOAL_ROW_LEFT + GOAL_W / 2 + i * (GOAL_W + GOAL_GAP));
  }
  return out;
})();

// ── Gameplay tuning ─────────────────────────────────────────────────────────
const PLAYER_SPEED = 612;      // px/s (v0.2: slowed 10%)
const BALL_SPEED_UP = 1450;    // px/s
const MAX_MISSES = 3;
const COMBO_2X_AT = 10;        // consecutive hits to unlock 2x
const COMBO_3X_AT = 20;        // consecutive hits to unlock 3x
const MAX_BALLS = 8;

// ── Colors ──────────────────────────────────────────────────────────────────
const GRASS_LIGHT = '#5bc15b';
const GRASS_DARK  = '#4aa84a';
const GRASS_STRIPE = 'rgba(0,0,0,0.06)';
const LINE_WHITE = '#ffffff';
const POST_WHITE = '#f4f4f4';
const NET_COLOR = 'rgba(255,255,255,0.55)';
const BALL_DARK = '#111';
const BALL_PANEL = '#fafafa';

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
  playerX: CANVAS_W / 2,
  playerDir: 1,     // 1 = moving right, -1 = moving left
  balls: [],        // pool of active balls
  goalFlashes: new Array(GOAL_COUNT).fill(0), // seconds of flash remaining per goal
  fireTime: 0,      // global time used to animate fire
  shakeTime: 0,     // screen shake seconds remaining
  menuPulse: 0,
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
function comboFireColor(c) {
  if (c >= COMBO_3X_AT) return 'blue';
  if (c >= COMBO_2X_AT) return 'red';
  return null;
}

// ── Ball pool ───────────────────────────────────────────────────────────────
function spawnBall(x) {
  if (game.balls.length >= MAX_BALLS) return;
  const y = PLAYER_Y - SPRITE_HEAD_TOP - BALL_R - 2;
  game.balls.push({ x, y, vy: -BALL_SPEED_UP, scored: false, spin: Math.random() * Math.PI * 2 });
  sfxKick();
}

// Find which goal (0..4) contains this x, or -1 if none.
function goalIndexAt(x) {
  for (let i = 0; i < GOAL_COUNT; i++) {
    const left = GOAL_ROW_LEFT + i * (GOAL_W + GOAL_GAP);
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
  game.balls.length = 0;
  game.goalFlashes.fill(0);
  game.shakeTime = 0;
  game.playerX = CANVAS_W / 2;
  game.playerDir = 1;
}

function endGame() {
  game.state = STATE_GAME_OVER;
  if (game.score > game.best) {
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
        b.scored = true;
        // Stop inside the net, near the back (≈75% of net depth).
        b.targetY = GOAL_TOP_Y + GOAL_NET_H * 0.25;
        b.lifetime = 0.9;
        b.alpha = 1;
        b.vy = 0;
        sfxGoal();
        // Combo threshold crossed?
        if (newMult > prevMult) sfxCombo();
      } else {
        // MISS
        game.misses += 1;
        game.consecutive = 0;
        game.shakeTime = 0.25;
        sfxMiss();
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
  }
}

function update(dt) {
  game.fireTime += dt;
  if (game.shakeTime > 0) game.shakeTime = Math.max(0, game.shakeTime - dt);

  if (game.state === STATE_PLAYING) {
    updatePlayer(dt);
    updateBalls(dt);
    updateGoalFlashes(dt);
  } else if (game.state === STATE_MENU) {
    game.menuPulse += dt;
    // let player animate in background for life
    updatePlayer(dt);
  } else if (game.state === STATE_GAME_OVER) {
    game.overScreenAge = (game.overScreenAge || 0) + dt;
    // freeze motion
  }
}

// ── Render ──────────────────────────────────────────────────────────────────
function drawField() {
  // Grass base
  ctx.fillStyle = GRASS_LIGHT;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  // Horizontal mowed stripes
  const stripeH = 120;
  ctx.fillStyle = GRASS_STRIPE;
  for (let y = 0; y < CANVAS_H; y += stripeH * 2) {
    ctx.fillRect(0, y, CANVAS_W, stripeH);
  }
  // Sideline (top of field below goals)
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(30, GOAL_CROSSBAR_Y + 8);
  ctx.lineTo(CANVAS_W - 30, GOAL_CROSSBAR_Y + 8);
  ctx.stroke();
  // Foul line: thick solid line across the field, penalty arc curving up
  // toward the goals, and a penalty spot on the goal side of the line.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(30, FOUL_LINE_Y);
  ctx.lineTo(CANVAS_W - 30, FOUL_LINE_Y);
  ctx.stroke();
  // Penalty arc (half-circle on the goal side — i.e. above the line)
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(CANVAS_W / 2, FOUL_LINE_Y, 160, Math.PI, 0, false);
  ctx.stroke();
  // Penalty spot (small filled dot inside the arc)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(CANVAS_W / 2, FOUL_LINE_Y - 80, 8, 0, Math.PI * 2);
  ctx.fill();
}

function drawGoal(i) {
  const left = GOAL_ROW_LEFT + i * (GOAL_W + GOAL_GAP);
  const right = left + GOAL_W;
  const postTop = GOAL_TOP_Y;
  const crossbar = GOAL_CROSSBAR_Y;
  const flash = game.goalFlashes[i];
  const fireColor = comboFireColor(game.consecutive);

  // Fire when combo active
  if (fireColor) drawGoalFire(left, right, postTop, fireColor);

  // Net backdrop (rectangle behind posts)
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(left + GOAL_POST_W, postTop, GOAL_W - GOAL_POST_W * 2, GOAL_NET_H);

  // Diagonal net lines
  ctx.save();
  ctx.beginPath();
  ctx.rect(left + GOAL_POST_W, postTop, GOAL_W - GOAL_POST_W * 2, GOAL_NET_H);
  ctx.clip();
  ctx.strokeStyle = NET_COLOR;
  ctx.lineWidth = 1.5;
  const stepN = 16;
  for (let s = -GOAL_NET_H; s < GOAL_W; s += stepN) {
    ctx.beginPath();
    ctx.moveTo(left + s, postTop);
    ctx.lineTo(left + s + GOAL_NET_H, postTop + GOAL_NET_H);
    ctx.stroke();
  }
  for (let s = 0; s < GOAL_W + GOAL_NET_H; s += stepN) {
    ctx.beginPath();
    ctx.moveTo(left + s, postTop);
    ctx.lineTo(left + s - GOAL_NET_H, postTop + GOAL_NET_H);
    ctx.stroke();
  }
  ctx.restore();

  // Flash fill on recent score
  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 240, 120, ${flash * 0.9})`;
    ctx.fillRect(left + GOAL_POST_W, postTop, GOAL_W - GOAL_POST_W * 2, GOAL_NET_H);
  }

  // Posts and crossbar (white)
  ctx.fillStyle = POST_WHITE;
  ctx.fillRect(left, postTop, GOAL_POST_W, GOAL_NET_H + 4);
  ctx.fillRect(right - GOAL_POST_W, postTop, GOAL_POST_W, GOAL_NET_H + 4);
  ctx.fillRect(left - 2, postTop, GOAL_W + 4, GOAL_POST_W);

  // Goal line dots (mouth of net on the field side)
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const dotY = crossbar + 3;
  const dotN = 6;
  for (let k = 0; k < dotN; k++) {
    const dx = left + GOAL_POST_W + (GOAL_W - GOAL_POST_W * 2) * (k + 0.5) / dotN;
    ctx.beginPath();
    ctx.arc(dx, dotY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Flickering triangular flames above a goal.
function drawGoalFire(left, right, postTop, colorName) {
  const w = right - left;
  const flames = 8;
  const t = game.fireTime;
  for (let k = 0; k < flames; k++) {
    const fx = left + w * (k + 0.5) / flames;
    const baseH = 70;
    const flick = Math.sin(t * 14 + k * 1.7) * 12 + Math.sin(t * 23 + k * 3.1) * 8;
    const h = baseH + flick;
    const topY = postTop - h;
    // Outer flame
    const g = ctx.createLinearGradient(0, topY, 0, postTop);
    if (colorName === 'red') {
      g.addColorStop(0, 'rgba(255, 220, 80, 0.0)');
      g.addColorStop(0.25, 'rgba(255, 180, 40, 0.85)');
      g.addColorStop(0.7, 'rgba(255, 90, 20, 0.9)');
      g.addColorStop(1, 'rgba(200, 20, 0, 0.85)');
    } else {
      g.addColorStop(0, 'rgba(200, 240, 255, 0.0)');
      g.addColorStop(0.25, 'rgba(120, 200, 255, 0.9)');
      g.addColorStop(0.7, 'rgba(60, 110, 255, 0.9)');
      g.addColorStop(1, 'rgba(30, 30, 200, 0.85)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(fx - 14, postTop);
    ctx.quadraticCurveTo(fx - 10, postTop - h * 0.5, fx, topY);
    ctx.quadraticCurveTo(fx + 10, postTop - h * 0.5, fx + 14, postTop);
    ctx.closePath();
    ctx.fill();
  }
  // Glow on crossbar
  const glow = colorName === 'red' ? 'rgba(255,80,20,0.45)' : 'rgba(80,120,255,0.45)';
  ctx.fillStyle = glow;
  ctx.fillRect(left - 4, postTop - 4, w + 8, 10);
}

function drawGoals() {
  for (let i = 0; i < GOAL_COUNT; i++) drawGoal(i);
}

// Back-view humanoid: head + jersey (red with white stripe, number 9) +
// shorts + legs with cleats. Legs alternate based on walkPhase to show motion,
// body leans slightly toward the direction of travel.
function drawPlayer() {
  const cx = game.playerX;
  const feetY = PLAYER_Y;

  // Walk cycle — legs swing opposite of arms
  const walk = Math.sin(game.walkPhase);
  const walkA = walk;       // left leg / right arm
  const walkB = -walk;      // right leg / left arm
  const lean = game.playerDir * 0.06; // radians of torso tilt

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, feetY + 4, 44, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Legs ──
  // Leg origin at hip (feetY - 58). Each leg offsets x by the walk cycle so
  // the striding leg kicks forward (visually left/right for a back-view).
  const hipY = feetY - 58;
  const legLen = 58;
  const legW = 16;
  // Left leg (from viewer's POV = player's left)
  const llx = cx - 14 + walkA * 6;
  const llyBottom = feetY + walkA * -4;
  ctx.fillStyle = '#f0c49a';
  ctx.fillRect(llx - legW / 2, hipY, legW, llyBottom - hipY);
  // Right leg
  const rlx = cx + 14 + walkB * 6;
  const rlyBottom = feetY + walkB * -4;
  ctx.fillRect(rlx - legW / 2, hipY, legW, rlyBottom - hipY);
  // Cleats
  ctx.fillStyle = '#111';
  ctx.fillRect(llx - legW, llyBottom - 10, legW + 6, 10);
  ctx.fillRect(rlx - 6, rlyBottom - 10, legW + 6, 10);
  // Cleat stripe
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(llx - legW + 2, llyBottom - 6, legW + 2, 2);
  ctx.fillRect(rlx - 4, rlyBottom - 6, legW + 2, 2);

  // ── Torso + arms (drawn with slight lean) ──
  ctx.save();
  ctx.translate(cx, hipY - 4);
  ctx.rotate(lean);

  // Shorts
  ctx.fillStyle = '#111';
  ctx.fillRect(-28, -4, 56, 28);
  // Shorts trim
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-28, 20, 56, 3);

  // Jersey
  ctx.fillStyle = '#e63946';
  ctx.fillRect(-32, -62, 64, 58);
  // White vertical stripe (center)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-5, -62, 10, 58);
  // Shoulder highlight
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(-32, -62, 64, 10);
  // Jersey outline
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-32, -62, 64, 58);
  // Shorts outline
  ctx.strokeRect(-28, -4, 56, 28);

  // Number on jersey back
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#a01c27';
  ctx.lineWidth = 3;
  ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText('9', 16, -30);
  ctx.fillText('9', 16, -30);

  // Arms — shoulder at (-32, -58) and (32, -58), swing with walk cycle
  ctx.fillStyle = '#f0c49a';
  const armW = 12;
  const armLen = 40;
  const armSwingA = walkB * 10; // arms opposite to same-side legs
  const armSwingB = walkA * 10;
  // Left arm
  ctx.fillRect(-32 - armW, -58, armW, armLen + armSwingA);
  // Right arm
  ctx.fillRect(32, -58, armW, armLen + armSwingB);
  // Sleeves (red caps)
  ctx.fillStyle = '#e63946';
  ctx.fillRect(-32 - armW, -58, armW, 12);
  ctx.fillRect(32, -58, armW, 12);

  ctx.restore();

  // ── Head (drawn upright, above torso) ──
  const headR = 22;
  const headY = hipY - 66 - Math.abs(walk) * 1.5; // gentle bob
  // Head shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.arc(cx + 2, headY + 2, headR, 0, Math.PI * 2);
  ctx.fill();
  // Skin
  ctx.fillStyle = '#f0c49a';
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  // Hair (from behind — covers top 2/3)
  ctx.fillStyle = '#3a2a1a';
  ctx.beginPath();
  ctx.arc(cx, headY - 2, headR, Math.PI + 0.15, -0.15, false);
  ctx.fill();
  // Hair crown highlight
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(cx - 5, headY - 8, 8, 0, Math.PI * 2);
  ctx.fill();
  // Neck
  ctx.fillStyle = '#dfae85';
  ctx.fillRect(cx - 8, headY + headR - 4, 16, 10);
  // Head outline
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBall(b) {
  ctx.save();
  if (b.alpha != null && b.alpha < 1) ctx.globalAlpha = b.alpha;
  ctx.translate(b.x, b.y);
  ctx.rotate(b.spin);
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(1, 2, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  // White body
  ctx.fillStyle = BALL_PANEL;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  // Pentagon panels (simple)
  ctx.fillStyle = BALL_DARK;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_R * 0.3, 0, Math.PI * 2);
  ctx.fill();
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -BALL_R * 0.45);
    ctx.lineTo(BALL_R * 0.28, -BALL_R * 0.8);
    ctx.lineTo(-BALL_R * 0.28, -BALL_R * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawBalls() {
  for (let i = 0; i < game.balls.length; i++) drawBall(game.balls[i]);
}

function drawHud() {
  // Score centered top
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 6;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 72px system-ui, -apple-system, sans-serif';
  const scoreText = `Score: ${game.score}`;
  ctx.strokeText(scoreText, CANVAS_W / 2, 30);
  ctx.fillText(scoreText, CANVAS_W / 2, 30);

  // Misses (3 dots) top-right
  const mx = CANVAS_W - 40;
  const my = 60;
  for (let i = 0; i < MAX_MISSES; i++) {
    const cx = mx - i * 56;
    ctx.beginPath();
    ctx.arc(cx, my, 18, 0, Math.PI * 2);
    if (i < game.misses) {
      ctx.fillStyle = '#d34646';
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fill();
    }
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Combo multiplier (if active) top-left
  const mult = comboMultiplier(game.consecutive);
  if (mult > 1) {
    ctx.textAlign = 'left';
    ctx.font = 'bold 64px system-ui, -apple-system, sans-serif';
    const color = mult >= 3 ? '#3aa0ff' : '#ff5a22';
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    const txt = `${mult}x`;
    ctx.strokeText(txt, 40, 30);
    ctx.fillText(txt, 40, 30);
    // progress towards next tier (until 3x cap)
    if (mult < 3) {
      const next = COMBO_3X_AT;
      const prev = COMBO_2X_AT;
      const frac = Math.min(1, (game.consecutive - prev) / (next - prev));
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(40, 110, 180, 10);
      ctx.fillStyle = color;
      ctx.fillRect(40, 110, 180 * frac, 10);
    }
  }

  // Version (bottom-left)
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '20px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(VERSION, 20, CANVAS_H - 12);
}

function drawMenu() {
  // Dim overlay
  ctx.fillStyle = 'rgba(0, 30, 0, 0.45)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Title
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0b1a0b';
  ctx.lineWidth = 10;
  ctx.font = 'bold 160px system-ui, -apple-system, sans-serif';
  ctx.strokeText('SOCCER', CANVAS_W / 2, 780);
  ctx.fillText('SOCCER', CANVAS_W / 2, 780);
  ctx.fillStyle = '#ffeb3b';
  ctx.strokeText('SHOT', CANVAS_W / 2, 960);
  ctx.fillText('SHOT', CANVAS_W / 2, 960);

  // Tap prompt (pulsing)
  const pulse = 0.65 + 0.35 * Math.abs(Math.sin(game.menuPulse * 2.3));
  ctx.fillStyle = `rgba(255,255,255,${pulse})`;
  ctx.font = 'bold 64px system-ui, -apple-system, sans-serif';
  ctx.fillText('Tap to play', CANVAS_W / 2, 1180);

  // Best
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px system-ui, -apple-system, sans-serif';
  ctx.fillText(`Best: ${game.best}`, CANVAS_W / 2, 1280);

  // Mini leaderboard
  drawLeaderboard(1360, 5);

  // Version (bottom-center, dim)
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '22px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.fillText(VERSION, CANVAS_W / 2, CANVAS_H - 20);
}

function drawLeaderboard(topY, maxRows) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
  ctx.fillText('Leaderboard', CANVAS_W / 2, topY);

  if (leaderboard === null) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '28px system-ui, -apple-system, sans-serif';
    ctx.fillText('Loading…', CANVAS_W / 2, topY + 60);
    return;
  }
  if (leaderboard.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '26px system-ui, -apple-system, sans-serif';
    ctx.fillText('Sign in on the home page to compete', CANVAS_W / 2, topY + 60);
    return;
  }
  const rows = Math.min(leaderboard.length, maxRows);
  const rowH = 48;
  ctx.font = 'bold 32px system-ui, -apple-system, sans-serif';
  for (let i = 0; i < rows; i++) {
    const e = leaderboard[i];
    const y = topY + 60 + i * rowH;
    ctx.textAlign = 'left';
    ctx.fillStyle = e.isMe ? '#ffeb3b' : '#ffffff';
    ctx.fillText(`${e.rank}.`, CANVAS_W / 2 - 300, y);
    const name = e.name.length > 18 ? e.name.slice(0, 17) + '…' : e.name;
    ctx.fillText(name, CANVAS_W / 2 - 230, y);
    ctx.textAlign = 'right';
    ctx.fillText(String(e.value), CANVAS_W / 2 + 300, y);
  }
}

function drawGameOver() {
  // Dim overlay
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#7a0a0a';
  ctx.lineWidth = 10;
  ctx.font = 'bold 140px system-ui, -apple-system, sans-serif';
  ctx.strokeText('GAME OVER', CANVAS_W / 2, 520);
  ctx.fillText('GAME OVER', CANVAS_W / 2, 520);

  ctx.font = 'bold 72px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`Score: ${game.score}`, CANVAS_W / 2, 700);
  ctx.font = 'bold 44px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#ffeb3b';
  ctx.fillText(`Best: ${game.best}`, CANVAS_W / 2, 790);

  // Leaderboard
  drawLeaderboard(890, 6);

  // Tap to continue
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin((game.overScreenAge || 0) * 3));
  ctx.fillStyle = `rgba(255,255,255,${pulse})`;
  ctx.font = 'bold 48px system-ui, -apple-system, sans-serif';
  ctx.fillText('Tap to continue', CANVAS_W / 2, CANVAS_H - 180);
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

  drawField();
  drawGoals();
  drawBalls();
  drawPlayer();

  ctx.restore();

  if (game.state === STATE_PLAYING) {
    drawHud();
  } else if (game.state === STATE_MENU) {
    drawMenu();
  } else if (game.state === STATE_GAME_OVER) {
    drawHud();
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
    // track overlay age for tap-to-continue debounce
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

// Kick off
rafId = requestAnimationFrame(loop);
