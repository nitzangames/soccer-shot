# Screenshot Mode — Design

## Goal

When SoccerShot is loaded with `?screenshot=1`, auto-start gameplay and produce
a visually active frame (player moving, ball(s) in flight, score > 0) so the
GamesPlatform screenshot script can capture gameplay instead of the title screen.

## PlaySDK contract

- `window.PlaySDK.screenshotMode` returns `true` when the URL has `?screenshot=1`.
- The game reads this once at init; no new SDK API is required.

## Game changes (`game.js`)

At the end of init (after the loop starts), if `window.PlaySDK?.screenshotMode` is true:

1. Call `startGame()` to skip menu.
2. Seed state for immediate visual interest:
   - `game.score = 12`
   - `game.consecutive = 8` (close to 2x combo threshold — not over it, keep it honest)
   - One ball already in flight via `spawnBall(game.playerX)`.
3. Schedule two additional `spawnBall` calls at ~1.5s and ~3.0s via `setTimeout`
   so subsequent screenshots also show active gameplay.

No other gameplay behavior changes. When `screenshotMode` is false (normal play),
the file is unchanged in behavior.

## Local capture script (`screenshot.js`)

A Node script (already listed in `.zipignore`) that:

1. Starts a tiny static file server on `127.0.0.1:<port>` rooted at the project dir.
2. Launches Puppeteer at viewport 430×932, `deviceScaleFactor: 3` (→ 1290×2796
   backing store, matching the 6.7" iPhone size the platform uses).
3. Navigates to `http://127.0.0.1:<port>/index.html?screenshot=1`.
4. Waits + screenshots at five offsets: 0.8s, 1.8s, 2.8s, 4.0s, 5.5s.
5. Writes `screenshot-1.png` … `screenshot-5.png` to the project dir.

The script is for local verification only. It is not deployed (already in `.zipignore`).

## Risks / edge cases

- **No PlaySDK present locally.** The game also reads `screenshot=1` directly as a
  fallback so the capture script works against a raw `file://`-style static serve
  without the SDK loaded. The guard is:
  ```js
  const screenshotMode = (window.PlaySDK && window.PlaySDK.screenshotMode)
    || new URLSearchParams(location.search).get('screenshot') === '1';
  ```
- **Audio.** `ensureAudio()` is still gated on user gesture; the auto-started game
  won't produce SFX in screenshot mode. That's fine — screenshots are silent.
- **Version bump.** Per `GAME_DEV_NOTES.md`, bump `VERSION` since this is a
  user-visible change to init behavior.

## Update (2026-11-06)

Fixed-time `setTimeout` kicks sometimes landed between goals, so captures
showed misses and a reset streak. Kicks are now driven from the game loop:
before each capture offset there is a window (350 ms → 80 ms before the
capture) and the kick fires only while the striker is within 50 px of a goal
centre. Every capture gets a ball that is in flight or has just scored.
`game.consecutive` is seeded at 9, so the first goal crosses into 2x and the
goals are on fire for the remaining captures (still not over the threshold at
load).
