# Pause overlay z-index — hide the HUD scene while paused

## 1. Background

When the game is paused, the read-only PAUSE modal (`已暂停`) is drawn underneath
the right-side HUD readouts. The HUD's lines (`关卡 / 分数 / 货币 / 剩余敌人 /
P1 生命 / P2 生命`), enemy-queue icons, power bar and banners bleed through on top
of the modal, and the HUD lives in a column that geometrically overlaps the modal
panel, producing garbled, colliding text (the screenshot's `PW A1 SsD 3`).

## 2. Requirements Summary

Make the pause overlay read as a clean modal **above** the HUD. While paused,
nothing from the HUD should render over the overlay. On resume, the HUD returns
exactly as before.

## 3. Acceptance Criteria

1. While paused, no HUD content (`关卡/分数/货币/剩余敌人/P1生命/P2生命`, queue
   icons, power bar, centered banners) renders over the pause overlay — no text
   collision.
2. The pause overlay (backdrop + panel + RUN/CONTROLS sections) is the topmost
   visible layer; nothing from the HUD bleeds through.
3. On resume (P / ESC), the HUD reappears fully and correctly (all readouts; the
   P2 line honoring the 1P/2P rule).
4. If the run ends **while paused** (gameOver-while-paused path), the next run
   launches with a fully visible HUD (no stuck-hidden HUD).
5. `npm run typecheck` (`tsc --noEmit`, the repo's readiness gate) passes; no
   regression to the pause-freeze or the close→reopen-race handling.

## 4. Problem Analysis

Root cause — cross-scene render order, not depth:

- `HUDScene` is a **separate** Phaser scene, registered **after** `GameScene` in
  the scene list (`src/main.ts:47` → `[…, GameScene, HUDScene, …]`). Phaser draws
  scenes in list order, so `HUD` always renders on top of `GameScene`.
- The `PauseOverlay` is created **inside** `GameScene` at `depth = 200`
  (`src/entities/PauseOverlay.ts:71-100`). Phaser `depth` only orders objects
  **within a single scene** — it cannot lift the overlay above a sibling scene.
- Geometry makes the collision visible: the centered pause panel spans x ≈ 320–960
  (`PANEL_W = 640`), but `HUD_PANEL_X = 868` (`src/config/constants.ts:52`), so the
  HUD column (868–1124) overlaps the panel's right portion.

Approaches evaluated:

- **A — Hide the `HUD` scene while paused** (`scene.setVisible(false,'HUD')` on
  open, `true` on close) -> cleanest: zero HUD pixels during pause. The overlay
  already carries its own RUN summary (stage/score/enemies/lives), so no needed
  information is lost. **Chosen.**
- **B — `bringToTop()` GameScene while paused** -> leaves half-clipped, dimmed HUD
  text peeking past the opaque panel edge (x > 960); uglier, and adds its own
  scene-order state to manage across stop/relaunch. Rejected.
- **C — Move `PauseOverlay` into `HUDScene` / a new always-top scene** -> most
  invasive: `PauseOverlay` binds keyboard handlers and `getInfo`/`onClose` to
  `GameScene` (the JustDown close→reopen race fix lives there). Over-engineered for
  a render-order bug (YAGNI). Rejected.

## 5. Decision Log

**1. How to put the overlay above the HUD?**

- Options: A) hide the HUD scene while paused · B) bringToTop GameScene · C) move
  the overlay into a top scene
- Decision: **A)** — directly realizes "overlay above the HUD", ~2 lines,
  reversible, and consistent with the existing model where `GameScene` already owns
  the HUD lifecycle (`scene.launch('HUD')` / `scene.stop('HUD')`).

**2. Where do the visibility toggles live?**

- Options: A) in `GameScene._openPause` / `_closePause` (the pause owner) · B) a
  `hud.paused` registry flag the HUD reads to hide its own objects
- Decision: **A)** — `GameScene` already owns the HUD scene's lifecycle, so the
  toggle sits beside `scene.launch`/`scene.stop`. B duplicates the per-object
  hide/show logic the scene-level toggle gives for free (DRY).

**3. Does a run that ends WHILE paused leave the next run's HUD hidden? (AC4)**

- No. Verified against the bundled Phaser source: `Systems.start()` unconditionally
  sets `settings.visible = true` (`node_modules/phaser/src/scene/Systems.js:748`).
  The gameOver-while-paused path (`_triggerGameOver`, `GameScene.ts:994-1017`) tears
  the overlay and calls `scene.stop('HUD')` (HUD → SHUTDOWN, `visible=false`); the
  next run's `create()` calls `scene.launch('HUD')`, which queues a `start` op
  (`ScenePlugin.js:485`) → on the next SceneManager update `sys.start()` runs and
  re-shows the HUD.
- Decision: **no defensive code needed** — AC4 holds for free via `sys.start()`. (An
  earlier draft added a `setVisible(true,'HUD')` after `launch()` in `create()`;
  dropped — `launch()` is deferred, so that line runs on the still-SHUTDOWN scene
  and is overwritten to `true` by the queued `start` anyway. Dead code justified by
  a non-existent footgun — KISS/YAGNI.)

**4. Non-goal — surface 货币 (currency) on the pause overlay?**

- The overlay's RUN summary intentionally omits currency
  (`PauseOverlay._renderRun`). Hiding the HUD hides currency for the pause duration.
- Decision: **out of scope (YAGNI)** — it returns instantly on resume; the overlay
  is a deliberately trimmed snapshot. Flag in review if wrong.

## 6. Design

Two one-line edits in `src/scenes/GameScene.ts`, using
`ScenePlugin.setVisible(value, 'HUD')`. `setVisible` toggles only the scene's
RENDER — the HUD's `update()`/`_render()` keep running and mirroring the registry
each frame; it simply isn't drawn (no perf concern at this scale, and a future
reader should not "optimize" this via `scene.sleep`, which adds wake/visible state):

- `_openPause()`: `this.scene.setVisible(false, 'HUD')` — hide while the modal is up.
- `_closePause()`: `this.scene.setVisible(true, 'HUD')` — restore on resume.

The gameOver-while-paused path (`_triggerGameOver`) needs no change: it stops the
HUD, and the next run's `scene.launch('HUD')` → `sys.start()` re-shows it (Decision 3).

While paused the world is frozen (`paused` gates `update()`'s gameplay block), so
the HUD's registry values cannot change; hiding the scene loses nothing — the
overlay's own once-read snapshot is the source of truth while paused.

## 7. Files Changed

- `src/scenes/GameScene.ts` — hide the `HUD` scene on pause-open, re-show on
  pause-close.

## 8. Verification

1. [AC1/AC2] Run a stage, press P/ESC: the pause modal shows clean — no HUD text or
   icons over it.
2. [AC3] Press P/ESC again: the full HUD returns (stage/score/currency/enemies/
   lives; P2 line per 1P/2P).
3. [AC4] Pause, then let the eagle die / lose last life while paused (or trigger
   gameOver) → return to a new run via Title: the HUD is fully visible.
4. [AC5] `npm run typecheck` is green; pause freeze and the P/ESC close→reopen race
   behave as before.
