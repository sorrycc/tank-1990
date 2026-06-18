# Tank 1990 — HUD enemy-queue icons + STAGE N intro curtain

> Design doc for a focused PLAYABILITY pass on the finished Tank 1990 (a faithful Battle City /
> 坦克大战 clone). Format mirrors the read-only reference `dead-cell` design docs (and the prior F7
> doc): Background → Requirements Summary → Acceptance Criteria → Decision Log → Design → Files →
> Verification. The run loop is complete (F0–F7): six scenes, a PURE seeded 13×13 generator with a
> headless verifier gate, drivable co-op tanks, pooled bullets, the four enemy types + a milestone
> boss, the six power-ups, banking + a Hub, a registry-decoupled HUD, synthesized SFX, stage layout
> motifs, a pause overlay, and kill juice. This pass adds the two classic HUD/flow touches still
> missing against the original: the **enemy-queue icon grid** (the column of little tank icons that
> shows how many enemies are left to clear) and a brief **"STAGE N" intro curtain** before each
> stage so a stage begins on a beat instead of cold. It ships NO new scene, NO new pure module, and
> leaves the headless verifier untouched (both changes are Phaser-coupled — the verifier never imports
> them).

---

## 1. Background

Tank 1990 is a complete endless run. But two classic Battle City presentation cues are still absent:

- **No enemy-queue icons.** The original draws a column of small tank icons in the side panel — one
  per enemy still to clear — that empties as you destroy them. Tank 1990 shows only the text readout
  `ENEMIES {n}` (`hud.enemies`). The icon grid is the at-a-glance pressure cue the classic leans on.
- **Stages begin cold.** A stage is built and gameplay starts on the same frame — enemies stream in
  immediately. The original shows a brief "STAGE N" curtain first (a centered label over a flat
  field) so the player reads which stage they are on before the action. Tank 1990 has a `STAGE N`
  side-panel readout + a STAGE-N-CLEARED *clear* banner, but no *intro* beat.

Both are presentation-only and slot into the existing seams with no new architecture:

- The enemy-queue grid is a HUDScene `_render` extension — a fixed pool of small tank-icon primitives
  whose VISIBLE count is set each frame from the same registry value the text readout already reads
  (`hud.enemies`). Decoupled (no reach into the world), inside the existing HUD panel band.
- The intro curtain is a GameScene state gate. A `curtain` flag (the SAME freeze idiom the existing
  `paused`/`gameOver` branches use) holds the spawn loop + enemy tick for a short window after each
  `_buildStage`, while a centered "STAGE N" label is published to the registry for the HUD to render
  (reusing the existing banner-mirroring pattern — GameScene owns WHEN, the HUD owns HOW).

**Conventions mirrored from the existing code:** the registry-decoupled HUD (`_render` reads the
registry, never the world); the fixed-GameObject-pool-updated-in-place `_render` idiom (no per-frame
GameObject churn); the `paused`/`gameOver` freeze-gate idiom in `update()`; the banner string
published to the registry + mirrored by the HUD (`hud.banner`); all UI text through `t(...)` with keys
in BOTH locales (the verifier asserts ZH ⊆ EN); programmer-art primitives only (no assets). Governing
conventions: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** add the classic enemy-queue icon grid to the HUD panel and a brief "STAGE N" intro curtain
before each stage, without breaking the existing STAGE-N-CLEARED banner or the green gate.

**In scope:**

- **`src/scenes/HUDScene.ts` (CHANGED):** ADD a grid of small tank-icon primitives in the right-side
  HUD panel band representing the enemies REMAINING to clear this stage. Create a FIXED pool of icon
  Rectangles once in `create()` (laid out in a grid inside `HUD_PANEL_X` / `HUD_PANEL_WIDTH`); in
  `_render()` set each icon's visibility from the registry `hud.enemies` count (decoupled read; capped
  at the pool size). Reuse the existing `_render` pattern + layout owners.
- **`src/scenes/GameScene.ts` (CHANGED):** ADD a `curtain` flag + a brief intro curtain shown before
  each stage begins. `_buildStage()` arms the curtain (a short timer); `update()` gates the spawn loop
  + enemy tick on it (the world is otherwise built + visible but enemies do not spawn/act); the curtain
  publishes a centered "STAGE N" string to the registry for the HUD to render, then clears so gameplay
  proceeds. Does NOT disturb the existing STAGE-N-CLEARED clear banner or the run-end/pause gates.
- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts` (CHANGED):** ADD the `hud.stageIntro` label key (the
  "STAGE N" curtain text) in BOTH locales.

**Out of scope (explicitly NOT built):** a new scene; per-enemy-TYPE icon colours (the classic uses a
single icon shape — one colour is the faithful KISS choice; per-type icons would need to read the
unspawned roster, coupling the HUD to the world — YAGNI); an animated curtain wipe / sliding shutters
(a centered timed label is the minimal faithful intro — KISS); skippable curtain on key-press (YAGNI —
the window is short); any change to the pure generator, `config/*`, or the verifier (both features are
Phaser-coupled presentation — the verifier never imports them).

---

## 3. Acceptance Criteria

1. **AC1 — the HUD shows an enemy-queue icon grid.** HUDScene draws a grid of small tank-icon
   primitives in the right-side panel band (within `HUD_PANEL_X` / `HUD_PANEL_WIDTH`); the number of
   VISIBLE icons equals the enemies-remaining count read from the registry (`hud.enemies`), updated
   each frame, capped at the pool size. The read is registry-decoupled (no reach into the world).
   Programmer-art Rectangles only.
2. **AC2 — a STAGE N intro curtain plays before each stage.** Before each stage's gameplay begins, a
   centered "STAGE N" label shows for a brief window (~1.2–1.6 s); during it enemy spawning + AI are
   paused (no enemy spawns, no enemy moves/fires). When the window elapses the label clears and
   gameplay proceeds normally. The label localises via `t('hud.stageIntro', { n })` and the key exists
   in BOTH locales.
3. **AC3 — the existing flow still works.** The STAGE-N-CLEARED clear banner, pause, run-end, and the
   stage advance are unchanged: the intro curtain plays on the first stage AND on every advance; it
   does not fire while paused/gameOver and does not block the clear banner.
4. **AC4 — green gate + offline.** `npm run typecheck` (strict) + `npm run build` exit 0; `npm run
   verify` prints OK + exits 0 (UNCHANGED — both features are Phaser-coupled, never verifier-imported).
   New i18n key exists in BOTH locales (the verifier's ZH ⊆ EN check stays green). Programmer-art
   primitives only.

---

## 4. Decision Log

1. **D1 — The enemy-queue grid is a FIXED icon pool whose VISIBLE count tracks the registry, mirroring
   the existing `_render` idiom.** HUDScene already creates fixed Text lines once + fills them in place
   each frame (no per-frame GameObject churn). The icon grid follows the SAME pattern: a fixed array of
   small Rectangle icons created once in `create()` (sized to the stage's `totalEnemies` ceiling so it
   never runs short), with `_render()` flipping each icon's `visible` from the `hud.enemies` registry
   value. *Rationale:* reusing the proven decoupled-`_render` pattern means no new state, no world
   coupling (KISS/DRY); the icons are a VIEW of the value the text readout already shows (SOLID — the
   HUD owns HOW, GameScene owns the value). Programmer-art Rectangles only (no asset).
2. **D2 — A single icon shape/colour, NOT per-enemy-type icons.** The classic varies the queue icons
   by type, but knowing the unspawned roster mix would require the HUD to read the world's pending
   spawn picks (the seeded `rosterPick` stream) — coupling the decoupled HUD to GameScene's internals.
   *Rationale:* a uniform icon is the faithful at-a-glance "how many left" cue with ZERO coupling
   (YAGNI — per-type icons add real coupling for a cosmetic nicety); the existing `ENEMIES {n}` text
   already gives the exact number. KISS.
3. **D3 — The intro curtain is a GameScene `curtain` state gate reusing the existing freeze idiom +
   the registry-mirrored banner pattern, NOT a new scene or overlay object.** `update()` already gates
   gameplay behind `gameOver`/`paused`; the curtain is one more gate of the SAME shape (the spawn loop
   + enemy tick are skipped while the curtain is up; the world is built + drawn). `_buildStage()` arms
   a `curtainTimer`; `update()` decays it on the real dt and clears the flag at 0. The "STAGE N" label
   is published to the registry (`hud.stageIntro`) while the curtain is up + `''` otherwise, and the
   HUD renders it centered over the playfield — EXACTLY the pattern the STAGE-N-CLEARED banner already
   uses (`hud.banner`). *Rationale:* a flag + a timer + a registry write is far less than a parallel
   curtain scene with its own lifecycle (KISS/YAGNI); it reuses the freeze idiom + the banner-mirror
   pattern verbatim (DRY); the HUD owns the render, GameScene owns the timing (SOLID — the reference's
   HUD/registry split). NO new scene, NO new entity.
4. **D4 — The curtain gates ONLY enemy spawning/AI, not the whole world.** Per the spec ("pause enemy
   spawning/AI"), the player can already move during the curtain (the world is live); only
   `_spawnStep`/`_tickEnemies` are skipped (the SAME pair the freeze/transition branch already skips).
   *Rationale:* the spec asks to gate the spawn timer on the curtain state — gating exactly the spawn
   loop + enemy tick (the existing `!this.transitioning && !frozen` block) is the minimal faithful
   change (KISS); a full `paused`-style hard freeze would also stop the player + bullets, which the
   spec does not ask for (YAGNI). The curtain is cleared while gameOver so a run-end mid-build can't
   strand it (belt-and-braces, matching the existing guards).
5. **D5 — A separate `hud.stageIntro` registry key + i18n string (NOT reusing `hud.banner` or the
   STAGE-N-CLEARED key).** The intro curtain and the clear banner can never overlap (the intro is at
   stage START, the clear banner at stage END), but giving the intro its own registry key + label
   keeps the two render paths independent + self-documenting. *Rationale:* a separate key is one extra
   registry write + one i18n entry — trivially cheap — and avoids any coupling between the two banners'
   timings (KISS/SOLID); the HUD renders each in its own label so neither can clobber the other.

---

## 5. Design

### 5.1 Module layout (this pass)

```
src/
  scenes/
    HUDScene.ts   # CHANGED: + a fixed enemy-queue icon pool, visible count ← hud.enemies (D1/D2, AC1).
    GameScene.ts  # CHANGED: + a `curtain` flag/timer armed per _buildStage; gates spawn/AI; publishes
                  #   hud.stageIntro (D3/D4/D5, AC2/AC3). NEVER verifier-imported.
  i18n/
    en.ts         # CHANGED (PURE): + hud.stageIntro (the EN source).
    zh-CN.ts      # CHANGED (PURE): + the zh-CN hud.stageIntro override.
docs/designs/
  2026-06-19-hud-stage-flow.md  # NEW: this design doc.
```

### 5.2 The enemy-queue icon grid (`HUDScene`)

- A `STAGE_INTRO_*`-independent constant block: `QUEUE_COLS` (icons per row), `QUEUE_ICON` (icon px
  size), `QUEUE_GAP` (px between icons), and the icon colour (the panel's enemy-readout orange, DRY
  with `enemiesLabel`).
- In `create()`, after the existing readout column, build a FIXED array of `QUEUE_MAX` small Rectangle
  icons laid out left-to-right, top-to-bottom in a grid anchored at `HUD_PANEL_X` / advancing `y` (so
  it sits inside the panel band, below the existing lines). `QUEUE_MAX` is sized to the deepest stage's
  `totalEnemies` ceiling (`TOTAL_ENEMIES_MAX`) so the grid never runs short of the live count. All icons
  start hidden (primed by `_render`).
- In `_render()`, read `hud.enemies` (the SAME value the text readout reads — DRY), clamp to `[0,
  QUEUE_MAX]`, and set each icon's `visible` to `i < count`. One loop, no allocation. (A small
  programmer-art "tank" = a body Rectangle; KISS — a single square reads as a queue pip; the doc keeps
  it to one primitive per icon.)

### 5.3 The STAGE N intro curtain (`GameScene`)

- ADD `private curtainTimer = 0` (seconds remaining on the intro curtain). A `STAGE_INTRO_SEC`
  constant (~1.4 s — within the ~1.2–1.6 s window) owns the duration; KISS — define it beside the
  GameScene field with an intent comment (it is a coupled-scene tunable, not a shared pure number, so
  it stays local rather than in `constants.ts`).
- In `_buildStage()` (the SHARED builder create() + every advance call), arm `this.curtainTimer =
  STAGE_INTRO_SEC` at the end. So every stage — the first AND each advance — opens on the curtain.
- In `update()`, decay `curtainTimer` on the REAL dt (BEFORE the gameplay block, beside the existing
  banner decay) so it counts down regardless of the gameplay-dt freeze; clamp at 0. Define `const
  curtain = this.curtainTimer > 0`.
- Gate the spawn loop + enemy tick: extend the existing `if (!this.transitioning && !frozen)` guard to
  `if (!this.transitioning && !frozen && !curtain)` so no enemy spawns/ticks while the curtain is up
  (D4 — the player + bullets stay live; only the enemy pair is gated).
- In `_publishHud()`, publish `hud.stageIntro` = `curtainTimer > 0 ? t('hud.stageIntro', { n:
  stageIndex + 1 }) : ''` (the SAME mirror pattern as `hud.banner` — D3/D5).
- The curtain is implicitly cleared on a run-end (gameOver freezes `update` before the gameplay gate,
  and a fresh `create()` re-arms it via `_buildStage`); paused does not decay it but also does not need
  to (the spawn gate already covers it). No new teardown needed.

### 5.4 The HUD curtain label (`HUDScene`)

- ADD an `introLabel` centered over the playfield (the SAME geometry as the existing `bannerLabel` —
  `PLAYFIELD_X + PLAYFIELD_W/2`, `PLAYFIELD_Y + PLAYFIELD_H/2`), depth above the readouts, programmer-
  art bold Text. In `_render()` mirror `hud.stageIntro` into it (blank when no curtain — the SAME
  pattern as `bannerLabel` mirroring `hud.banner`). It uses the panel-grey/neutral chrome colour to
  read as an intro (distinct from the gold clear banner).

### 5.5 Integration points (what does NOT change)

- The combat/spawn/advance/boss/clear-banner/pause/run-end paths are otherwise UNCHANGED — the curtain
  is one extra gate on the existing enemy-pair block + one extra registry write.
- The pure generator, `config/*`, the RunState, and the verifier are UNTOUCHED (both features are
  Phaser-coupled presentation).

---

## 6. Files

**New:**

- `docs/designs/2026-06-19-hud-stage-flow.md` — this design doc.

**Changed:**

- `src/scenes/HUDScene.ts` — the enemy-queue icon grid + the intro curtain label (registry-decoupled).
- `src/scenes/GameScene.ts` — the `curtain` flag/timer (armed per `_buildStage`, gates the spawn/AI
  block, publishes `hud.stageIntro`).
- `src/i18n/en.ts` + `src/i18n/zh-CN.ts` — the `hud.stageIntro` curtain label (both locales).

---

## 7. Verification

- **AC1 (enemy-queue grid) — manual `npm run dev` drive + read.** Start a run → the side panel shows a
  grid of small icons; as enemies are destroyed the visible icon count drops in step with the
  `ENEMIES {n}` readout. Grep the icon pool + the `hud.enemies` read in `HUDScene.ts`.
- **AC2 (intro curtain) — manual drive + read.** Each stage opens with a centered "STAGE N" label for
  ~1.4 s during which no enemy spawns/moves; then the label clears and enemies stream in. Grep
  `curtain`/`curtainTimer`/`hud.stageIntro` in `GameScene.ts` + `HUDScene.ts`.
- **AC3 (existing flow intact) — drive.** Clear a stage → the gold STAGE-N-CLEARED banner still shows;
  the next stage opens on its own intro curtain; pause/run-end still behave.
- **AC4 (green gate) — `npm run typecheck` + `npm run build` + `npm run verify`.** All exit 0 / print
  OK; the verifier is byte-unchanged (the features are Phaser-coupled). `hud.stageIntro` exists in BOTH
  `en.ts` + `zh-CN.ts` (ZH ⊆ EN stays green). Programmer-art primitives only.
