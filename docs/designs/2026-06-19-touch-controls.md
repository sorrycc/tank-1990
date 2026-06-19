# Touch controls — on-screen D-pad + fire button feeding the P1 PlayerIntent

## 1. Background / Intent

`core/Input.ts` is the SINGLE owner of the per-frame `InputSnapshot` (`{ p1, p2, pausePressed }`),
and `Tank.update(gdt, intent)` is the SOLE consumer of a `PlayerIntent` (the one movement/fire
spine — DRY, F1 D3). Today the ONLY producer of held cardinals + the fire edge is the keyboard
(`Input.readPlayer`). On a touch device (phone/tablet) there is no keyboard, so the game is
unplayable.

GOAL: add programmer-art on-screen controls — a 4-way D-pad (left cluster) + a FIRE button (right) —
that appear/activate ONLY on touch-capable devices (never interfering with desktop keyboard play),
and feed the SAME `p1` `PlayerIntent` Input already builds. No new movement path, no second intent
consumer. Camera-fixed, drawn above the playfield, pause-aware, and leaking NO input on resume.
KISS: P1 only (a single local player is the touch use-case; P2 needs a second physical device).

## 2. Key Decisions

1. **Input stays the SOLE snapshot owner; touch is MERGED inside `sample()` (DRY, SOLID).** We do
   NOT add a second producer that Tank reads. Instead `Input` gets one optional collaborator
   `touch: TouchState | null` (a tiny interface `{ up,down,left,right: boolean; consumeFire(): boolean }`).
   `sample()` reads the keyboard `p1` exactly as today, then — if a touch source is wired — OR-merges
   the touch held cardinals into p1's `up/down/left/right`, RE-DERIVES `dirX/dirY` from the merged
   booleans (opposing still cancels — the SAME formula), and OR-s `consumeFire()` into
   `p1.firePressed`. Keyboard and touch thus compose; neither steals the other. The touch source is
   pure-data to Input (no Phaser leaks into Input beyond what it already has). `TouchState` is the
   minimal seam — Input never imports the Phaser-coupled control object.

2. **`TouchControls` is a self-contained Phaser UI object, modelled on `PauseOverlay` (KISS).** It
   lives in `src/entities/TouchControls.ts` (Phaser-coupled, like PauseOverlay). It draws camera-fixed
   primitives (`setScrollFactor(0)`, a depth band BELOW the pause modal's 200), tracks held direction
   + a pending fire EDGE in its own fields, and exposes the `TouchState` shape (Decision 1). GameScene
   news it up in `create()` and wires it as `this.input2.touch = this.touchControls` (mirroring how it
   wires `input2`). No new scene, no input handshake — the existing single-snapshot flow absorbs it.

3. **Gate on touch capability ONCE at build, default OFF (no desktop interference, AC).** GameScene
   constructs `TouchControls` only when `this.sys.game.device.input.touch` is true (Phaser's device
   probe — the standard, file://-safe check; no asset, no network). On a non-touch device
   `this.touchControls` stays null, `input2.touch` stays null, and `sample()` is BYTE-IDENTICAL to
   today (the merge branch is skipped). Desktop keyboard play is provably unaffected.

4. **Fire is an EDGE, drained once per frame (the JustDown discipline, AC).** The FIRE button's
   pointerdown sets a `_firePending` latch (like a keyboard JustDown). `consumeFire()` returns it and
   clears it — so a single tap fires exactly once, and a HELD finger does NOT machine-gun (matches the
   keyboard "fire once per press"). `sample()` is the sole caller of `consumeFire()` (called once per
   frame from GameScene — the existing sole-owner site), so the edge can't be double-drained.

5. **D-pad = held booleans via Phaser zone pointer events (KISS, no per-frame hit-test).** Each of the
   4 D-pad arrows is an interactive rect; `pointerdown`/`pointerover` (with `pointer.isDown`) sets its
   held bool, `pointerup`/`pointerout`/`pointerupoutside` clears it. A multi-arrow press is naturally
   OR'd by Input (opposing cancels via the re-derive). We bind to the SCENE input plugin and store the
   handlers so `_teardown()` can remove them — no leaked listener across a scene shutdown.

6. **Pause-aware via show/hide, NOT a second freeze path (DRY).** GameScene already FREEZES the world
   on `paused`/`gameOver`/`transitioning` by early-returning before the P1 drive. The touch merge only
   matters when that drive runs, so no extra gate is needed for movement. BUT to avoid a stale held
   bool surviving across a pause (a finger lifted while the pad was hidden), `_openPause()` calls
   `touchControls?.reset()` (clear all held bools + the fire latch + dim/hide the pad) and
   `_closePause()` calls `touchControls?.show()`. The pause modal (depth 200) already draws above the
   pad (lower depth), so the modal stays readable. This is the "do not leak input on resume" guarantee
   — symmetric with `input2.consumePause()`.

7. **Teardown on scene shutdown (no leaked listeners, AC).** GameScene registers
   `this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.touchControls?.destroy())` beside the
   existing teardown wiring. `TouchControls.destroy()` removes its pointer handlers + destroys its
   rects (idempotent `_destroyed` guard, copied from PauseOverlay). A stage rebuild does NOT touch it
   (it is RUN-scoped, camera-fixed chrome — like `input2`), so it survives `_teardownStage()`.

## 3. Files to touch

- **`src/config/constants.ts`** (PURE) — add the touch-pad geometry constants in the heavy-comment
  style, beside the other layout anchors (DRY, single owner): `TOUCH_DPAD_BTN` (arrow button px),
  `TOUCH_DPAD_MARGIN` (px from the screen edge to the pad cluster), `TOUCH_FIRE_RADIUS`,
  `TOUCH_FIRE_MARGIN`, and `TOUCH_ALPHA` (the translucent overlay alpha). NO Phaser import — purity
  preserved; the verifier still node-imports this file cleanly.

- **`src/core/Input.ts`** (Phaser-coupled, but the merge adds NO new Phaser API) — export the
  `TouchState` interface (Decision 1); add a public field `touch: TouchState | null = null`; in
  `sample()`, after building `p1` via `readPlayer('p1')`, if `this.touch` apply Decision 1's OR-merge +
  `dirX/dirY` re-derive + fire OR. Keyboard-only path (`touch` null) is unchanged. Heavy comment
  explaining the compose + the re-derive (opposing-still-cancels) invariant.

- **`src/entities/TouchControls.ts`** (NEW, Phaser-coupled) — the camera-fixed D-pad + fire button UI
  object implementing `TouchState`: held cardinal bools, the `_firePending` edge + `consumeFire()`,
  pointer handlers (Decisions 4/5), `reset()` / `show()` / `hide()` (Decision 6), and `destroy()`
  (Decision 7). Programmer-art only (rects/arcs via Phaser Graphics, `setScrollFactor(0)`, a depth
  band below 200). Labels read via `t()` (Decision below).

- **`src/scenes/GameScene.ts`** (Phaser-coupled) — in `create()`, after `this.input2 = new Input(this)`,
  build `TouchControls` ONLY when `this.sys.game.device.input.touch` (Decision 3) and wire
  `this.input2.touch = this.touchControls`; register the SHUTDOWN teardown (Decision 7). In
  `_openPause()` add `this.touchControls?.reset()`; in `_closePause()` add `this.touchControls?.show()`
  (Decision 6). No change to the P1 drive block — it already reads `s.p1` (the merged intent).

- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts`** — add the FIRE button label key (Decision below).

NO change to any PURE module beyond the additive geometry constants. `LevelGenerator.ts`, `tiles.ts`,
`config/stages.ts`, and the rest of the verifier-imported set are untouched.

## 4. Acceptance criteria

1. On a touch-capable device, an on-screen 4-way D-pad (left) + FIRE button (right) are visible,
   camera-fixed, drawn above the playfield and below the pause modal.
2. Pressing a D-pad arrow drives P1 along that cardinal via the EXISTING `Tank.update` spine — no new
   movement code path; opposing simultaneous presses cancel (the re-derived `dirX/dirY`).
3. Tapping FIRE fires exactly ONE shot per tap; holding does NOT machine-gun (the consumed edge).
4. On a non-touch (desktop) device the controls never appear and `Input.sample()` is byte-identical
   to today — keyboard play is provably unaffected.
5. Keyboard + touch compose: with both wired, either can drive/fire; neither suppresses the other.
6. Opening pause hides/resets the pad (no held bool or fire edge survives); resuming re-shows it with
   no leaked input on the first resume frame.
7. A scene shutdown / GameOver transition removes the pointer handlers + destroys the pad (no leaked
   listeners, no orphan rects).
8. `npm run typecheck`, `npm run verify`, and `npm run build` all stay green.

## 5. How `npm run verify` stays green

- The verifier node-imports ONLY the PURE modules (`config/*`, `world/LevelGenerator.ts`, `util/*`,
  `i18n/*`). This feature adds only numeric layout constants to `config/constants.ts` (no Phaser
  import) and two locale strings to `i18n/en.ts`/`zh-CN.ts` (the dictionary-shape assertion still
  passes — additive keys). Every behavioural change is in Phaser-coupled files the verifier never
  imports (`core/Input.ts`, `entities/TouchControls.ts`, `scenes/GameScene.ts`). The pure/coupled
  enclosure is intact; no Phaser import is added to any verifier-imported file.
- No RNG, no stage-generation, no tile/grid change: `generateStage`, the seed pin, and the
  procedural-stage monotonicity gate are byte-unaffected — touch controls are pure input chrome.
- The new constants are layout scalars read only by the coupled UI object; no verifier invariant
  (four-types-distinct, boss-HP monotonicity, currency range) references them.

## 6. i18n keys to add

- `touch.fire` — the FIRE button label. EN: `'FIRE'`; zh-CN: `'开火'`. (The D-pad arrows are drawn as
  triangle glyphs, not text, so they need no string — KISS.) Added to BOTH `src/i18n/en.ts` and
  `src/i18n/zh-CN.ts`, read via `t('touch.fire')` in `TouchControls`. The literal key tokens already
  in `controls.*` (WASD/J) are unchanged — touch is a separate, device-gated scheme.
