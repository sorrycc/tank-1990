# Tank 1990 — F7 Rich playability (stage variety, pause, juice, high scores, HUD polish)

> Design doc for **F7 Rich playability**, a focused ENRICHMENT pass over the finished Tank 1990 (a
> faithful Battle City / 坦克大战 clone). Format mirrors the read-only reference `dead-cell` design
> docs EXACTLY: Background → Requirements Summary → Acceptance Criteria → Decision Log → Design →
> Files → Verification. F0 stood up the booting skeleton (six scenes, pure RNG, defensive save). F1
> made a drivable tank firing pooled bullets. F2 built the PURE, SEEDED, headlessly-VERIFIED 13×13
> stage (terrain + an enclosed reachable eagle + spawns). F3 made the bullets MATTER (every collision
> resolved, the eagle-loss run-over, pooled FX, respawn, co-op FF off). F4 filled in the game loop
> (the four classic enemy types on the ONE Tank FSM, the staggered/capped spawn loop, the stage-clear
> advance, the run economy on `core/RunState.ts`). F5 closed the meta loop (the six classic power-ups,
> the two-column Hub, banking, the full HUD, the i18n layer). F6 was the capstone (the boss milestone
> tank + "STAGE N CLEARED" banner, co-op finalized, the WebAudio SFX façade, the Title controls
> reference, a balance pass). **F7 is the playability polish:** it adds STAGE LAYOUT VARIETY
> (seed-chosen terrain MOTIFS in the pure generator — open / fortress / maze / corridors — while the
> verifier's enclosure + reachability + max-count invariants stay green), a PAUSE overlay (the
> reference's `PauseOverlay` pattern — P / Esc, freezing gameplay), KILL/SCORE JUICE (floating score
> popups + a kill flash via a trimmed Effects extension), HIGH SCORES surfaced on Title + Hub
> (`bestScore` / `bestStage` from MetaState), HUD POLISH (power-up TIMER BARS + a clearer side panel),
> and a README rewrite describing the finished game. It ships NO new scene, NO new enemy/power-up
> type, and leaves the headless verifier GREEN (the new motif selector gets REAL determinism +
> invariant assertions in the sweep; the layout motifs only widen the SHAPE space — they never break
> enclosure/reachability/the scatter ceiling).

---

## 1. Background

Through F6, Tank 1990 is a COMPLETE endless run loop: the four classic enemy types, the six
power-ups, the boss milestone + banner, the two-column Hub, banking, a full HUD, synthesized SFX,
and a headless quality gate. It is *good enough to ship*. But a playthrough surfaces six concrete
PLAYABILITY GAPS that the read-only reference `dead-cell` solves and Tank 1990 has so far left flat:

- **Every stage looks the SAME.** `world/LevelGenerator.ts` builds EXACTLY one shape on every seed:
  init grid → eagle + fort ring → spawns → carve corridors → a single uniform per-cell Bernoulli
  terrain SCATTER. Only the per-stage DENSITIES vary (more brick/steel deeper). There is no notion
  of a layout MOTIF — the reference's `LevelGenerator` picks one of several `LAYOUT_TEMPLATES`
  (`staircase` / `shaft` / `islands`) off the seed, so its rooms read distinctly. Tank 1990 has the
  identical "uniform scatter forever" gap the reference's enrichment round-2 fixed; F7 fixes it the
  SAME way — a seeded MOTIF selector that biases the terrain scatter into recognizable shapes
  (open / fortress / maze / corridors), with the generator's existing reachability + enclosure
  invariants preserved BY CONSTRUCTION (the motif only changes the EMPTY/BRICK/STEEL *bias* of the
  NON-reserved cells; it never touches the reserved base/fort/spawn/corridor cells the verifier proves).
- **No pause.** The reference has a `PauseOverlay` (a camera-fixed read-only modal GameScene news up;
  P / Esc freeze the world via a `pauseOpen` flag that gates `update()`; a `consumePause()` swallows
  the close-press edge). Tank 1990's `GameScene.update()` has no pause gate at all — there is no way
  to stop the action. F7 ports the pattern, trimmed to a tank game (a CONTROLS + current-run summary
  panel; no build/skill machinery).
- **Kills have no JUICE.** `effects.explosion(x,y,{big})` pops sparks + a shake on a kill, but the
  SCORE a kill banks is invisible at the kill site — the only score readout is the side-panel number
  ticking up. The reference's `Effects` floats a damage NUMBER at each impact (`spawnNumber`). F7
  reuses the SAME pooled-number idea: a floating "+N" SCORE popup at a tank/boss kill, plus a brief
  KILL FLASH. (Spawn-telegraph blink + base-fortify visual already exist from F4/F5; F7 surfaces the
  score feedback that's missing.)
- **High scores are BURIED.** `MetaState` persists `bestScore`/`bestStage`, and `GameOverScene`
  shows them on the run-end screen — but the Title (the first thing a player sees) and the Hub (the
  run lobby) show NOTHING. The reference surfaces best/progress on its menus. F7 reads
  `bestScore`/`bestStage` from MetaState and shows them on Title + Hub.
- **The HUD side panel reads flat.** The power-up line shows "POWER FREEZE 7s" as TEXT only — no
  visual sense of how much time is left. The reference's HUD draws cooldown/charge BARS (a track rect
  + a fill rect resized each frame). F7 adds a power-up TIMER BAR (a track + a draining fill) under
  the power-up line + tightens the panel layout (a header rule, a divider), all registry-decoupled.
- **The README is a stale F0 stub.** It still says "F0 — scaffold … There is no gameplay yet". F7
  rewrites it to describe the FINISHED game (what it is, controls, the run/build/verify commands).

F7 resolves all six, mirroring the reference's conventions EXACTLY, adapted to the faithful-classic
shape:

- **Stage variety is a PURE seeded MOTIF selector in `world/LevelGenerator.ts`, mirroring the
  reference's `LAYOUT_TEMPLATES` / `selectTemplate`.** A `STAGE_MOTIFS` list (`open` / `fortress` /
  `maze` / `corridors`) + a `selectMotif(seed, cfg)` weighted pick OFF A SEPARATE SUB-RNG (the
  reference's off-the-main-thread `tplRng` discipline) so the main draw sequence is structurally
  unchanged; the chosen motif parameterizes the EXISTING terrain scatter (it reshapes the
  EMPTY/BRICK/STEEL *bias* of the non-reserved cells) WITHOUT touching any reserved cell — so the
  enclosure + reachability + scatter-ceiling invariants hold BY CONSTRUCTION (the verifier re-proves
  them generically for EVERY motif). The motif id is emitted on the description (`desc.motif`), so the
  verifier asserts it is always one of the known set AND that the shape space is actually used.
- **Pause is the reference's `PauseOverlay` pattern — a camera-fixed modal GameScene owns, NOT a new
  scene.** GameScene gates `update()` behind a `paused` flag (the SAME freeze idiom the gameOver
  branch already uses), tears the world's per-frame work, and the overlay binds ONLY P/ESC → close.
  A `consumePause()`-style edge guard (mirrored from the reference) prevents the close-press
  re-opening pause on the resume frame.
- **Juice is a TRIMMED extension of the existing `Effects` façade — a floating SCORE number + a kill
  flash, reusing the reference's pooled-number primitive.** `ParticlePool` gains a `spawnNumber`
  (ported from the reference, trimmed) and `Effects` gains a `scorePopup(x,y,value)` the kill sites
  call. No new subsystem — one pool method + one façade method (KISS/DRY).
- **High scores + HUD bars are registry/MetaState reads — no new state.** Title/Hub read MetaState
  in `create()`; the HUD reads the existing `hud.powerSecs` (+ a new `hud.powerMaxSecs` for the bar
  fraction) from the registry (decoupled — the reference's HUD/registry split).

**Conventions mirrored from `dead-cell` (read-only, NEVER modified):** the PURE/COUPLED split (the
motif selector + the scatter shaping live in PURE `world/LevelGenerator.ts` node-imported by the
verifier; `PauseOverlay`, `Effects`, `ParticlePool`, the scenes are Phaser-coupled and NEVER
imported by the verifier); the reference's `LAYOUT_TEMPLATES` / `selectTemplate` / off-the-main-
thread sub-RNG idiom (so a regression pin stays controllable); the reference's `PauseOverlay`
(camera-fixed read-only modal, P/ESC, `consumePause` edge guard); the reference's `Effects.spawnNumber`
floating-number primitive; the registry-decoupled HUD; `dt` in SECONDS at the boundary (the pause
freeze sets `gdt`'s gate; FX tick on REAL dt, unchanged); heavy intent-revealing comments citing the
section + AC + Decision numbers. Governing conventions: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** Make Tank 1990 visibly richer + more playable in one focused pass: add SEED-CHOSEN STAGE
LAYOUT MOTIFS to the pure generator (open / fortress / maze / corridors) keeping the verifier's
reachability + enclosure + scatter-ceiling invariants green; add a PAUSE overlay (P / Esc) that
freezes gameplay; add KILL/SCORE JUICE (a floating "+N" score popup + a kill flash); surface
`bestScore` / `bestStage` on the Title + Hub; polish the HUD (a power-up timer BAR + a clearer side
panel); rewrite the README. All green on `typecheck` / `build` / `verify`.

**In scope (F7):**

- **`src/world/LevelGenerator.ts` (CHANGED, PURE):** ADD a `STAGE_MOTIFS` exported id list
  (`['open','fortress','maze','corridors']`), a `MotifParams` shape (per-motif scatter biases +
  optional structural deltas), a `MOTIF_PARAMS` table, and a `selectMotif(seed, cfg)` PURE weighted
  pick OFF A SEPARATE seeded sub-RNG (`mulberry32((seed ^ MOTIF_SALT) >>> 0)` — the reference's
  off-the-main-thread `tplRng`, so the MAIN `rng` draw sequence is byte-untouched). The chosen motif
  parameterizes the EXISTING step-5 terrain scatter: it scales the per-cell BRICK/STEEL/EMPTY
  *propensity* of the NON-RESERVED cells (e.g. `fortress` biases more brick/steel walls, `open`
  biases EMPTY, `maze` lays a brick lattice over interior cells, `corridors` biases brick bands).
  CRITICALLY it touches ONLY non-reserved cells via the EXISTING `reserved` mask, so the base/fort/
  spawn/carved-corridor cells are byte-identical and the enclosure + reachability proofs hold BY
  CONSTRUCTION. The description gains `motif: string`. The boss-arena branch (if any) and the
  determinism (one main `rng`) are unchanged. PURE — verifier-imported.
- **`src/config/stages.ts` (CHANGED, PURE — small):** OPTIONAL per-stage `motifWeights?` field on
  `StageConfig` (default absent → the shared `DEFAULT_MOTIF_WEIGHTS` in the generator) so a future
  tune can flavour a stage's motif mix WITHOUT a generator edit (the reference's `layoutWeights`
  biome override). F7 does NOT set per-stage weights (every stage uses the default mix) — the field
  is the seam. No new ramps, no monotonicity change (the field is unread by the existing sweep). PURE.
- **`src/entities/PauseOverlay.ts` (NEW; Phaser-coupled):** the reference's `PauseOverlay`, TRIMMED
  to a tank game. A camera-fixed dim backdrop + a slate-framed panel drawn ON TOP of the frozen
  GameScene (programmer-art primitives + text only); a title, a CONTROLS section (the shared
  `CONTROLS_ROWS` — DRY with the Title), a small RUN summary (stage · score · enemies left · lives),
  and a resume hint. It binds ONLY `keydown-P` + `keydown-ESC` → `onClose` (NOTHING else — no fire/
  start edge leaks on resume). It is handed a `getInfo()` snapshot reader + an `onClose()` callback
  (decoupled — it knows nothing about RunState; GameScene assembles the snapshot, exactly like the
  reference's `getBuild`/`onClose`). NEVER imported by the verifier.
- **`src/scenes/GameScene.ts` (CHANGED):** ADD a `paused` flag + `_openPause()`/`_closePause()`. On
  the P/ESC edge (read via `Input` — see §5.4) when NOT gameOver/transitioning, open the overlay +
  set `paused = true`; `update()` early-returns its gameplay work while paused (it still ticks the FX
  pool on REAL dt so the freeze is clean, NOT a hard `return` — the reference's frozen-FX discipline,
  matching the gameOver branch) so the world is fully frozen but the overlay renders. `_closePause()`
  tears the overlay, clears `paused`, and consumes the pending P/ESC edge (the close→reopen race fix,
  mirrored from the reference). At kill sites (`_onEnemyKilled`, the boss kill) call the new
  `effects.scorePopup(x, y, value)` (the floating "+N") in ADDITION to the existing `explosion(...,
  {big})`. Publish `hud.powerMaxSecs` (the active power-up's FULL duration) so the HUD draws the bar
  fraction. The score-popup + pause are purely additive — no existing combat/spawn/advance path changes.
- **`src/effects/Effects.ts` (CHANGED, Phaser-coupled):** ADD `scorePopup(x, y, value)` — a floating
  upward "+N" number (reuses the new `ParticlePool.spawnNumber`) + a brief gold tint flash via the
  EXISTING shake (KISS — no new camera owner). Trimmed from the reference's `hit()` (NO damage/crit/
  hit-stop — Tank 1990 banks SCORE, not damage; YAGNI). NEVER verifier-imported.
- **`src/effects/ParticlePool.ts` (CHANGED, Phaser-coupled):** ADD `spawnNumber(x, y, value, opts)` —
  a pooled floating Text that rises + fades over a short lifetime, ported from the reference's
  `spawnNumber` TRIMMED to Tank 1990's needs (a fixed colour + scale; no crit colours). Reuses the
  pool's existing tick lifetime machinery (DRY). NEVER verifier-imported.
- **`src/scenes/HUDScene.ts` (CHANGED):** ADD a power-up TIMER BAR (a track Rectangle + a fill
  Rectangle resized each frame to `powerSecs / powerMaxSecs`, hidden when no power-up is active) +
  a small panel HEADER + a divider rule for a cleaner read. ALL registry-decoupled (reads the
  existing `hud.powerKind`/`hud.powerSecs` + the new `hud.powerMaxSecs`). Programmer-art primitives.
- **`src/scenes/TitleScene.ts` (CHANGED):** read MetaState in `create()` and show a BEST line
  (`bestScore` · `bestStage`) under the subtitle (hidden / "—" when no run banked yet), localised
  via `t('...')`. Positioned off the FIXED design resolution.
- **`src/scenes/HubScene.ts` (CHANGED):** show the same BEST line near the currency header (the Hub
  already loads MetaState — DRY, one extra `getBestScore`/`getBestStage` read). Localised.
- **`src/i18n/en.ts` + `src/i18n/zh-CN.ts` (CHANGED, PURE):** ADD the new chrome strings — the
  `title.best` / `hub.best` best-line templates, the `pause.*` overlay strings (title, the run-summary
  labels, the resume hint) — in BOTH locales. PURE.
- **`scripts/verify-gen.mjs` (CHANGED):** EXTEND the existing stage sweep — for every (seed, stage)
  ASSERT `desc.motif` is one of `STAGE_MOTIFS`; ASSERT `selectMotif` is DETERMINISTIC (two calls →
  the same id) and total (always returns a known id, incl. a degenerate all-zero weights fallback);
  ASSERT the motif shaping preserves EVERY existing invariant (enclosure + footprint-BFS reachability
  + `scatterCells` ceiling — these already run per (seed,stage) in `checkDescription`, so they cover
  EVERY motif for FREE); ASSERT the MOTIF SPACE is actually exercised across the sweep (the set of
  distinct `desc.motif` values over the 200-seed × 7-stage sweep has size ≥ 2 — no dead motif / no
  single-shape collapse, the reference's "shape space is used" check). RECOMPUTE the regression pin
  (the ONE fixed `(PIN_SEED, PIN_STAGE)`) to the new generator output (the motif reshapes its scatter
  — the pin is re-pinned to the REAL function output, never hand-invented; D10's "computed reference"
  discipline) and ADD `motif` to the pinned fields. EXTEND (do NOT rewrite) the verifier; every other
  F0–F6 section stays byte-unchanged except the one re-pinned PIN block.

**Out of scope (F7 — explicitly NOT built):** a new SCENE of any kind (pause is a GameScene-owned
overlay; high scores are menu reads — no scene); a new enemy / power-up / boss type; ICE low-friction
sliding FEEL (the brief lists it as a candidate, but it touches the Tank movement spine + the
no-diagonal invariant — a risk to the F1 structural guarantee; YAGNI for a polish pass — the ICE tile
already scatters + renders, the feel is a later feature); hit-stop / a new camera owner (the reference's
hit-stop is for a melee brawler; Tank 1990 has none — the score popup reuses the existing shake);
floating numbers on EVERY impact (only on KILLS — a brick chip flooding "+0" popups is noise; KISS); a
persisted "show best" preference / a high-score TABLE (just the single best score/stage — YAGNI); any
change to the seeded MAIN draw sequence (the motif uses an off-the-main-thread sub-RNG so determinism +
the rest of the pin are structurally stable); a pause MENU with quit/options rows (the overlay is
read-only info + resume — the reference's read-only stance; quitting mid-run is YAGNI). F7 ships ONLY
the stage motifs, the pause overlay, the kill/score juice, the Title/Hub best lines, the HUD timer bar
+ panel polish, and the README.

---

## 3. Acceptance Criteria

> All testable. §7 maps each AC to a `typecheck`/`build`/`verify` check, a code-presence grep, or a
> manual `npm run dev` drive-test. The motif selector + the scatter shaping are PURE and gain REAL
> headless assertions in the verifier; the pause overlay, the juice, the menu best lines, and the HUD
> bar are Phaser-coupled (the overlay/Effects/scenes) and are proved by grep + the manual drive.

1. **AC1 — stages have visible LAYOUT VARIETY chosen by seed.** `world/LevelGenerator.ts` exports
   `STAGE_MOTIFS` (≥ 3 distinct motif ids — `open` / `fortress` / `maze` / `corridors`) and a PURE
   `selectMotif(seed, cfg)` that returns one of them off a SEPARATE seeded sub-RNG. `generateStage`
   emits the chosen `motif` on the description and parameterizes its terrain scatter by it, so two
   different seeds visibly differ in terrain SHAPE (an `open` stage reads sparse; a `fortress` reads
   walled; a `maze` reads latticed; `corridors` reads banded), NOT just in density. Across the
   verifier sweep, ≥ 2 distinct motifs actually appear (no dead/collapsed shape space).
2. **AC2 — the motif NEVER breaks the proven invariants.** For EVERY (seed, stage) the motif shaping
   leaves the eagle present + bottom-center + enclosed by BRICK/STEEL (enclosure), every top enemy
   spawn footprint-BFS-reaches a fort-approach window (reachability), and every per-terrain tile count
   stays ≤ `scatterCells` (the scatter ceiling). This holds BY CONSTRUCTION (the motif reshapes only
   the bias of the NON-RESERVED cells via the existing `reserved` mask — the reserved base/fort/spawn/
   corridor cells are byte-identical), and the verifier RE-DERIVES it from the EMITTED tiles for every
   motif (the existing `checkDescription` runs per (seed,stage), so it covers every motif for free).
3. **AC3 — `generateStage` stays DETERMINISTIC + the pin holds.** `generateStage(seed, cfg)` twice →
   DEEP-EQUAL (the motif sub-RNG is seeded from the same seed). The regression pin (the ONE fixed
   `(PIN_SEED, PIN_STAGE)`) matches a COMPUTED reference (re-pinned to the REAL function output after
   the motif change — never hand-invented), and the pin now includes `motif`. `selectMotif` is total
   (always a known id, incl. an all-zero-weights fallback).
4. **AC4 — a PAUSE overlay freezes gameplay on P / Esc.** During a run, pressing `P` OR `Esc` opens a
   camera-fixed read-only overlay (a dim backdrop + a slate-framed panel showing the CONTROLS + the
   current run summary + a resume hint) and FREEZES the world: no tank drives/fires, no enemy spawns/
   ticks, no bullet travels, no collision resolves — only the FX pool settles. Pressing `P` or `Esc`
   again closes it + resumes; the close-press does NOT re-open pause or fire a shot on the resume
   frame (the edge is consumed). Pause is unavailable once the run has ended (gameOver) or mid stage-
   transition. The overlay is NOT a separate scene.
5. **AC5 — kills show SCORE JUICE.** On a tank/boss KILL, a floating "+N" score popup (N = the
   killed tank's `scoreValue`) rises + fades at the kill center (reusing a pooled floating-number
   primitive), alongside the existing kill burst + shake. The popup uses programmer-art Text only (no
   asset). A brick chip / a bullet-vs-bullet cancel does NOT spawn a score popup (kills only — KISS).
6. **AC6 — high scores are surfaced on Title + Hub.** `TitleScene` and `HubScene` read
   `bestScore`/`bestStage` from MetaState and show a localised BEST line (best score · best stage),
   positioned off the FIXED design resolution. A fresh save (no run banked) reads 0/0 and shows a sane
   "—"/0 line (never a blank or a crash — the defensive save degrades to defaults).
7. **AC7 — the HUD power-up line gains a TIMER BAR + the panel reads cleaner.** While a timed
   power-up is active (`hud.powerKind` set + `hud.powerSecs > 0`), the HUD draws a track + a draining
   fill bar (width ∝ `powerSecs / powerMaxSecs`) under the power-up text line; it hides when no
   power-up is active. The side panel gains a header + a divider rule for a clearer read. ALL reads are
   registry-only (decoupled — no reach into the world). Programmer-art primitives.
8. **AC8 — the README describes the FINISHED game.** `README.md` no longer says "F0 — scaffold … no
   gameplay yet"; it describes Tank 1990 (what it is — endless Battle City clone), the controls (P1
   WASD+J, P2 arrows+Numpad0, P/Esc pause, M mute), the power-ups + boss + co-op, and the run/build/
   verify commands. The architecture section stays accurate (the pure/coupled split + the verifier
   gate).
9. **AC9 — pure/coupled split + green gate + offline.** `npm run typecheck` (strict) + `npm run
   build` exit 0; `npm run verify` prints OK + exits 0 with the NEW motif assertions (determinism +
   known-id + shape-space-used + the re-pinned PIN incl. `motif`) PLUS the F0–F6 sweep otherwise
   UNCHANGED (enclosure/reachability/ceiling already cover every motif; only the ONE PIN block is
   re-pinned). `world/LevelGenerator.ts` + `config/stages.ts` import NO Phaser (node-imported by the
   verifier — re-proving purity); `entities/PauseOverlay.ts`, `effects/*`, `world/TileMap.ts`, and the
   scenes import Phaser and are NEVER imported by the verifier. Programmer-art primitives + synthesized
   audio only; runs offline / `file://`.

---

## 4. Decision Log

> Each decision notes how it stays KISS/YAGNI/DRY/SOLID and preserves the pure/coupled split.

1. **D1 — Stage variety is a PURE seeded MOTIF selector that RESHAPES the existing terrain scatter,
   NOT a new layout algorithm — mirroring the reference's `LAYOUT_TEMPLATES`/`selectTemplate`/`tplRng`
   idiom.** The reference picks one of `['staircase','shaft','islands']` off an off-the-main-thread
   `tplRng` and runs a DIFFERENT builder per template. Tank 1990's grid is a FIXED 13×13 with a
   structurally-required reachable enclosed fort, so a per-motif *builder* would risk the
   reachability/enclosure proofs the verifier depends on. Instead F7 keeps the ONE proven generation
   skeleton (init → fort → spawns → carve corridors → scatter) and makes the MOTIF parameterize ONLY
   step 5 (the terrain scatter over NON-RESERVED cells): `selectMotif(seed, cfg)` returns one of
   `STAGE_MOTIFS`, and `MOTIF_PARAMS[motif]` supplies per-cell BRICK/STEEL/EMPTY *bias multipliers* (or
   a lattice/band rule) applied INSIDE the existing scatter loop, which already skips reserved cells.
   *Rationale:* reshaping the scatter (not the skeleton) means the base/fort/spawn/corridor cells are
   byte-identical for every motif, so enclosure + reachability + the `scatterCells` ceiling hold BY
   CONSTRUCTION — the verifier re-proves them generically with ZERO new proof code (the existing
   `checkDescription` covers every motif). KISS — one selector + a small params table + a few lines in
   the existing loop; YAGNI — no per-motif builder, no second skeleton; DRY — the reference's exact
   `selectTemplate` shape; SOLID — the motif is DATA (the params table), the scatter loop is the
   behaviour. PURE — verifier-imported (a stray Phaser import throws under node).
2. **D2 — The motif selector uses an OFF-THE-MAIN-THREAD seeded sub-RNG, so the MAIN `rng` draw
   sequence is structurally unchanged + determinism + most of the pin are stable.** Like the
   reference's `tplRng = mulberry32((seed ^ 0x7e3415a7) >>> 0)` (and Tank 1990's own existing
   `branchRng`/`recoveryRng` off-thread sub-RNGs in the reference), `selectMotif` draws from
   `mulberry32((seed ^ MOTIF_SALT) >>> 0)` — it consumes NO draw from the main `rng` that threads the
   scatter. The motif then only CHANGES THE BIASES the scatter loop applies (it does not add/remove
   `rng()` draws — it still draws ONE `rng()` per eligible cell, so `scatterCells` counting is
   unchanged and the per-cell selection stays a single seeded draw). *Rationale:* keeping the motif
   pick off the main thread means a fixed seed is still byte-deterministic (the sub-RNG is seeded from
   the same seed) AND the scatter's *draw count* per cell is unchanged — the only thing the motif
   moves is the THRESHOLDS the single per-cell draw is compared against. The PIN tile grid DOES change
   (the thresholds moved), so the pin is RE-PINNED (D10); but determinism, the spawn/base coords, and
   the structural invariants do NOT. KISS/DRY — the exact off-thread sub-RNG discipline the generator
   already uses; SOLID — the salt is a named constant.
3. **D3 — The pause overlay is the reference's `PauseOverlay`: a camera-fixed READ-ONLY modal
   GameScene news up + destroys, NOT a separate scene; gameplay freezes via a `paused` flag gating
   `update()` (the SAME idiom the gameOver branch uses).** The reference's `PauseOverlay` is a
   self-contained UI object (a dim backdrop + a panel + text, depth 200, scrollFactor 0) the scene
   opens on the P edge while it freezes the world via `pauseOpen`; it binds ONLY P/ESC → `onClose` and
   is handed a `getBuild()` snapshot + an `onClose()` callback (it knows NOTHING about the run state).
   F7 ports it trimmed: the panel shows CONTROLS (the shared `CONTROLS_ROWS` — DRY with the Title) + a
   tiny run summary (stage/score/enemies-left/lives) read ONCE via a `getInfo()` snapshot. GameScene
   gates its `update()` gameplay block behind `paused` (early-returns after ticking the FX pool on REAL
   dt — the SAME frozen-FX discipline as the gameOver branch, NOT a hard `return`). *Rationale:* a
   2-line freeze gate + a self-contained overlay is far less than a parallel pause SCENE (which would
   need its own input plumbing + a pause handshake — the reference rejects that exact thing). KISS/
   YAGNI — no new scene, no menu rows; DRY — reuses `CONTROLS_ROWS` + the gameOver freeze idiom; SOLID
   — the overlay formats + lays out, GameScene owns the freeze + the snapshot (the reference's split).
   PURE/coupled: the overlay is Phaser-coupled (never verifier-imported).
4. **D4 — The pause edge is read through the SINGLE `Input` owner (a `JustDown`-style pause edge) +
   the close-press is CONSUMED, mirroring the reference's `consumePause()` close→reopen race fix.** The
   reference's lesson (its PauseOverlay header BLOCKER): Phaser dispatches keyboard events BEFORE
   `scene.update`, so the overlay's own `keydown-P` close handler + the scene's `JustDown(P)` would
   race — the close-press would re-open pause on the next sample. F7 mirrors the fix: `Input` owns a
   pause edge (`pausePressed`, a `JustDown` over P/ESC) the scene reads to OPEN pause; the overlay
   binds its OWN `keydown-P`/`keydown-ESC` to CLOSE; `_closePause()` calls `input2.consumePause()` to
   swallow the pending edge so the close-press cannot re-open pause (or leak a fire) on the resume
   frame. *Rationale:* the single-Input-owner rule (the project's locked convention) + the reference's
   proven edge-consume keeps pause toggling clean (no double-toggle, no leaked fire — AC4). KISS — one
   edge + one consume; DRY — the same `JustDown` machinery the fire edges use; SOLID — `Input` owns the
   edge, GameScene owns the open/freeze, the overlay owns the close. (P and ESC are NOT P1/P2 movement
   or fire keys, so adding the edge cannot conflict — Input still returns both players' intents.)
5. **D5 — Kill JUICE is a TRIMMED extension of the existing `Effects` façade + `ParticlePool` — a
   floating SCORE number, reusing the reference's `spawnNumber` primitive; NO hit-stop / crit / new
   camera owner.** The reference's `Effects.hit()` floats a damage NUMBER (`pool.spawnNumber`) +
   sparks + shake + a hit-stop request. Tank 1990's `Effects` (F3) already pops sparks + shake but has
   NO number (it was YAGNI'd out — "NO floating damage numbers"). F7 adds back JUST the number, repurposed
   as a SCORE popup: `ParticlePool.spawnNumber(x, y, value, opts)` (ported + trimmed — a fixed gold
   colour, a short rise+fade lifetime reusing the pool's existing tick) + `Effects.scorePopup(x, y,
   value)` the kill sites call alongside `explosion(..., {big})`. NO hit-stop (the reference's is for a
   melee crunch; a tank game freezes only on pause/clock — adding a hit-stop boundary is a refactor
   risk for no faithful-classic gain — YAGNI), NO crit colours (Tank 1990 has no crits), NO new camera
   owner (the existing `Effects` shake is the only camera FX). *Rationale:* the missing feedback is
   "what did that kill earn?" — a "+N" at the kill IS that, reusing the proven pooled-number primitive
   (DRY — one pool method, one façade method). KISS/YAGNI — trimmed to the one thing the classic shows;
   SOLID — `Effects` is the one juice façade, the kill sites call ONE method. Coupled (never
   verifier-imported).
6. **D6 — High scores + the HUD bar are READS of existing persisted/registry state — F7 adds NO new
   state field.** `MetaState` already persists `bestScore`/`bestStage` and exposes `getBestScore()`/
   `getBestStage()` (the Hub already loads MetaState; the GameOver already reads them). Title + Hub
   just call those readers in `create()` and render a localised line. The HUD timer bar reads the
   existing `hud.powerKind`/`hud.powerSecs` (registry, decoupled) plus ONE new published value
   `hud.powerMaxSecs` (the active power-up's FULL duration, so the bar fraction `powerSecs/powerMaxSecs`
   is computable) — GameScene already knows the full duration (`HELMET_SHIELD_SEC`/`CLOCK_FREEZE_SEC`/
   `SHOVEL_FORTIFY_SEC` from `config/powerups.ts`), so publishing it is one extra registry write in the
   existing `_publishHud` block. *Rationale:* the data already exists — surfacing it is a read, not a
   new subsystem (KISS/DRY). The registry-decoupled HUD stays decoupled (it never reaches into the
   world — the reference's HUD/registry split, AC7). SOLID — GameScene owns WHEN (publishes), the HUD/
   menus own HOW (render).
7. **D7 — `config/stages.ts` gains an OPTIONAL `motifWeights?` seam (the reference's biome
   `layoutWeights` override) but F7 sets NONE — the default mix flavours every stage.** The reference
   lets a biome override the template mix via `layoutWeights`; Tank 1990's analogue is a per-stage
   `motifWeights?` on `StageConfig` (default absent → `selectMotif` uses the generator's
   `DEFAULT_MOTIF_WEIGHTS`). F7 does NOT populate it (every stage uses the default mix) — the field is
   purely the FUTURE seam (a later tune could make deep stages bias `fortress`/`maze`). *Rationale:*
   adding the seam now (an optional field, unread by the existing sweep, defaulting to the shared mix)
   costs one line + keeps the door open WITHOUT speculative behaviour (YAGNI — no per-stage weights
   shipped; KISS — an optional field; DRY — one default mix owned in the generator). PURE — the field
   is plain data; the existing monotonicity sweep does not read it, so it cannot break the gate.
8. **D8 — The regression pin is RE-PINNED to the REAL new generator output (a COMPUTED reference,
   never hand-invented) + gains `motif`; determinism + the spawn/base coords stay structurally
   stable.** The motif reshapes the scatter THRESHOLDS, so the pinned tile grid + `scatterCells` for
   the fixed `(PIN_SEED, PIN_STAGE)` change. Following the reference/F2's D10 pin discipline (the pin
   is "the real function's output, computed once + pinned as literals — never hand-invented"), F7
   RE-COMPUTES the pin from one run of the updated `generateStage` and writes the new `PIN_TILES`/
   `PIN_SCATTER` literals + adds `PIN_MOTIF`. The base/spawn coords + `isBoss` are UNCHANGED (the
   motif touches only the non-reserved scatter, not the spawn/base geometry), so those pin fields stay
   byte-identical — only the tile grid + scatter count + the new motif field move. *Rationale:* a pin
   that drifts silently is the failure D10 guards against; re-pinning to the computed output keeps the
   pin an HONEST regression catch for the NEW generator (KISS — recompute + paste; the verifier proves
   determinism + the invariants independently, so the pin is a change-detector, not the correctness
   proof). The verifier's determinism + invariant sweeps are what PROVE correctness; the pin only
   catches accidental drift.
9. **D9 — The pause overlay is READ-ONLY (info + resume), NOT a menu with quit/options — the
   reference's read-only stance.** The reference's PauseOverlay (its Decision 4) is "an INFORMATION
   panel — nothing to select or confirm". F7 mirrors that: the overlay shows CONTROLS + the run
   summary + "press P/ESC to resume" and binds ONLY P/ESC. No quit-to-Title row, no volume slider, no
   restart. *Rationale:* a quit/restart/options menu is scope the brief doesn't ask for + would need
   confirm flows + more input plumbing (YAGNI); a read-only freeze panel is the minimal faithful pause
   (KISS). SOLID — the overlay is presentation; resume is its only action (delegated to `onClose`).
10. **D10 — ICE sliding feel, hit-stop, and per-impact numbers are deliberately OUT of F7.** The
    brief lists "ice sliding feel" + "hit-stop on big explosions" as juice candidates. ICE feel
    touches the Tank movement spine + the STRUCTURAL no-diagonal/lane-snap invariant (F1's load-bearing
    guarantee) — a risk disproportionate to a polish pass (the ICE tile already scatters + renders; the
    feel is a clean later feature). Hit-stop needs a new gameplay-dt freeze boundary (the reference's is
    for a melee brawler; Tank 1990 freezes only on pause/clock) — a refactor for no faithful-classic
    gain. Per-impact numbers (every brick chip) would flood the screen with noise. *Rationale:* F7
    picks the HIGHEST-IMPACT, LOWEST-RISK juice (score popups + a kill flash) and the highest-value
    variety (stage motifs) — keeping scope sane + the F1 structural invariant untouched (YAGNI/KISS:
    do the items that add the most feel without endangering the proven core). Each omitted item stays a
    clean future feature behind an existing seam (the ICE tile, the gameplay-dt boundary).

---

## 5. Design

### 5.1 Module layout (this phase)

Mirrors the reference's layered tree; F7 ADDS `entities/PauseOverlay.ts`; CHANGES
`world/LevelGenerator.ts` (the motif selector + scatter shaping), `config/stages.ts` (the
`motifWeights?` seam), `effects/Effects.ts` + `effects/ParticlePool.ts` (the score popup),
`scenes/GameScene.ts` (the pause + the score-popup wiring + `hud.powerMaxSecs`), `scenes/HUDScene.ts`
(the timer bar + panel polish), `scenes/TitleScene.ts` + `scenes/HubScene.ts` (the best line),
`core/Input.ts` (the pause edge + consume), `i18n/*` (the new chrome), the verifier, and the README:

```
src/
  core/
    Input.ts            # CHANGED: + a JustDown pause edge (P/ESC) + consumePause() (D4). NEVER verifier-imported.
  config/
    stages.ts           # CHANGED (PURE): + optional StageConfig.motifWeights? seam (D7). No Phaser. Verifier-imported.
  world/
    LevelGenerator.ts   # CHANGED (PURE): + STAGE_MOTIFS / MOTIF_PARAMS / selectMotif + scatter shaping +
                        #   desc.motif (D1/D2). Off-the-main-thread motif sub-RNG. No Phaser. Verifier-imported.
  entities/
    PauseOverlay.ts     # NEW (Phaser-coupled): the reference's read-only pause modal, trimmed (D3/D9).
  effects/
    Effects.ts          # CHANGED (Phaser-coupled): + scorePopup(x,y,value) (D5). NEVER verifier-imported.
    ParticlePool.ts     # CHANGED (Phaser-coupled): + spawnNumber(x,y,value,opts) (ported, trimmed — D5).
  scenes/
    GameScene.ts        # CHANGED: paused flag + _openPause/_closePause; scorePopup at kill sites;
                        #   hud.powerMaxSecs publish (D3/D4/D5/D6).
    HUDScene.ts         # CHANGED: + the power-up timer bar + a panel header/divider (D6, AC7).
    TitleScene.ts       # CHANGED: + the best line (MetaState read, D6/AC6).
    HubScene.ts         # CHANGED: + the best line (MetaState read, D6/AC6).
  i18n/
    en.ts               # CHANGED (PURE): + title.best/hub.best + pause.* chrome (the EN source).
    zh-CN.ts            # CHANGED (PURE): + the zh-CN overrides for the new chrome.
scripts/
  verify-gen.mjs        # CHANGED: + motif assertions (known-id + deterministic + total + shape-space-used) +
                        #   the existing per-(seed,stage) invariants now cover every motif; RE-PIN the one PIN block.
README.md               # CHANGED: rewrite for the finished game (what/controls/run/build/verify).
```

### 5.2 Stage motifs (PURE — `world/LevelGenerator.ts` + `config/stages.ts`)

- **`STAGE_MOTIFS` (NEW exported `string[]`):** `['open', 'fortress', 'maze', 'corridors']` — the
  known motif ids (the reference's `LAYOUT_TEMPLATES` shape). The verifier asserts every emitted
  `desc.motif` is one of these AND that the sweep exercises ≥ 2 of them.
- **`MotifParams` (NEW type) + `MOTIF_PARAMS` (NEW table):** per-motif scatter shaping. Each entry
  supplies *bias multipliers* the scatter loop applies to the stage's base densities (e.g. `open`:
  `{ brickMul: 0.4, steelMul: 0.4 }` → sparser walls; `fortress`: `{ brickMul: 1.6, steelMul: 1.8 }`
  → denser walls; `corridors`: a band rule that biases BRICK on alternating interior ROWS/COLS;
  `maze`: a lattice rule that biases BRICK on even interior cells). The multipliers SCALE the existing
  per-cell thresholds — the scatter still draws ONE `rng()` per non-reserved cell + places AT MOST one
  tile, so `scatterCells` counting + the "≤ scatterCells ceiling" hold unchanged (D1/D2). The
  multipliers are chosen so NO motif drives a density past its `*_DENSITY_MAX` clamp would allow at
  the eligible-cell level — and crucially the motif only affects NON-RESERVED cells (the corridors the
  generator carved to the fort stay clear FOR EVERY motif, so reachability holds — AC2).
- **`selectMotif(seed, cfg)` (NEW PURE fn):** `const r = mulberry32((seed ^ MOTIF_SALT) >>> 0)`; a
  weighted pick over `cfg.motifWeights ?? DEFAULT_MOTIF_WEIGHTS` (the reference's `selectTemplate`
  body verbatim in shape). Total: an all-zero-weights roster falls through to the last id (never
  undefined — the reference's float-rounding fallback). Off the main thread (D2).
- **`generateStage` integration:** after step 4 (carve corridors), `const motif = selectMotif(seed,
  cfg)`; pass `MOTIF_PARAMS[motif]` into the step-5 scatter so its per-cell thresholds are scaled/
  shaped; emit `motif` on the returned description. The reserved-cell skip in the scatter loop is
  UNCHANGED, so the motif cannot touch a reserved cell. `StageDescription` gains `motif: string`.
- **`config/stages.ts`:** `StageConfig` gains `motifWeights?: { id: string; w: number }[]` (OPTIONAL,
  unset by F7 — the D7 seam). The existing monotonicity sweep does not read it.

### 5.3 The pause overlay (`entities/PauseOverlay.ts` + `GameScene` + `Input`)

- **`PauseOverlay` (NEW, ported from the reference, trimmed):** ctor `(scene, { getInfo, onClose })`.
  Draws (camera-fixed, depth 200): a `0.6`-alpha black backdrop over the full design rect; a slate-
  framed panel; a title (`t('pause.title')`); a CONTROLS section (iterate the shared `CONTROLS_ROWS`,
  two fixed-x columns per row — the CJK-safe discipline, DRY with the Title); a RUN section (the
  `getInfo()` snapshot — stage / score / enemies-left / P1 lives [/ P2 lives in co-op]); a resume hint
  (`t('pause.help')`). Binds `keydown-P` + `keydown-ESC` → an internal `_close()` that tears down +
  calls `onClose`. `_teardown()` removes the handlers + destroys the GameObjects (idempotent). A
  `close()` force-tears WITHOUT firing `onClose` (GameScene's shutdown path).
- **`Input` (CHANGED):** add a `pausePressed` edge to the per-frame intent snapshot (a `JustDown` over
  the P key and the ESC key — added to the key map in `Input`'s ctor) + a `consumePause()` that swallows
  the pending edge (the reference's `consumePause`). The P/ESC keys are NEITHER player's move/fire
  keys, so the edge is conflict-free (D4).
- **`GameScene` (CHANGED):** a `paused` flag + a `pauseOverlay` ref. In `update()`, AFTER sampling
  Input + BEFORE the gameOver early-return path: if NOT gameOver/transitioning/paused AND
  `s.pausePressed`, call `_openPause()`. `_openPause()` sets `paused = true` + news the overlay with a
  `getInfo()` that returns a snapshot off RunState (read once) + an `onClose` = `_closePause`.
  `update()` gates its gameplay block: while `paused` (or gameOver), tick the FX pool on REAL dt then
  early-return (the frozen-FX discipline). `_closePause()` calls `pauseOverlay.close()`, clears
  `paused`, and calls `input2.consumePause()` (the close-press edge swallow). The stage-teardown /
  run-end paths force-close the overlay defensively.

### 5.4 Kill JUICE (`effects/ParticlePool.ts` + `effects/Effects.ts` + `GameScene`)

- **`ParticlePool.spawnNumber(x, y, value, opts?)` (NEW, ported trimmed):** acquire a pooled Text from
  a small number-pool (or reuse the existing pool's lifetime list — DRY), set it to `+value` at (x,y),
  give it an upward velocity + a short lifetime; the existing `tick(dt)` rises + fades + releases it.
  A fixed gold colour + an optional scale (no crit colours — Tank 1990 has none, D5). REAL dt (a pause/
  clock freeze never pauses the pop — the F3 FX contract).
- **`Effects.scorePopup(x, y, value)` (NEW):** `this.pool.spawnNumber(x, y - 18, value, { color:
  '#feca57' })` (the HUD's gold) — the one juice call site for a kill's score. NO shake here (the
  kill's `explosion({big})` already shook); just the number (KISS).
- **`GameScene` (CHANGED):** at `_onEnemyKilled` (after banking `enemy.spec.scoreValue`) call
  `this.effects.scorePopup(enemy.collider.x, enemy.collider.y, enemy.spec.scoreValue)`. The boss routes
  through the SAME `_onEnemyKilled`, so the boss's big `scoreValue` pops for FREE (DRY). Brick chips /
  bullet cancels do NOT call it (kills only — AC5).

### 5.5 HUD polish + high scores (`HUDScene` + `TitleScene` + `HubScene`)

- **HUD timer bar (`HUDScene`):** a track Rectangle + a fill Rectangle created once under the power-up
  text line. In `_render()`, when `hud.powerKind` is set + `hud.powerSecs > 0`, show both + set the
  fill width to `BAR_W * clamp(powerSecs / powerMaxSecs, 0, 1)` (reading the new `hud.powerMaxSecs`);
  hide both when no power-up is active. A panel header + a divider Rectangle for a cleaner read. All
  registry reads (decoupled — AC7).
- **`GameScene._publishHud` (CHANGED):** publish `hud.powerMaxSecs` = the FULL duration of the active
  power-up (the `HELMET_SHIELD_SEC`/`CLOCK_FREEZE_SEC`/`SHOVEL_FORTIFY_SEC` constant matching
  `activeKind`), so the HUD computes the bar fraction. One extra write in the existing block.
- **Title/Hub best line:** `TitleScene.create()` + `HubScene.create()` read `meta.getBestScore()`/
  `meta.getBestStage()` (the Hub already has `this.meta`; the Title news a `createMetaState()` — the
  impure read boundary, once in create) and render `t('title.best'/'hub.best', { score, stage })`.

### 5.6 Integration points with existing code (what does NOT change)

- The seeded MAIN `rng` thread, the spawn/base geometry, `tankFits`/`isFortApproachWindow`/the carve,
  and `TileMap` are UNCHANGED — the motif only scales the step-5 scatter thresholds over non-reserved
  cells (so `TileMap` renders the new bias with zero edits — it reads `desc.tiles` as before).
- The combat/spawn/advance/boss/banner paths are UNCHANGED — pause is a `paused` gate + an overlay;
  the score popup is one additive call at the existing kill site.
- The MetaState schema is UNCHANGED — the best line is a read; the HUD bar is a read + one extra
  publish. No save migration.

---

## 6. Files

**New:**

- `src/entities/PauseOverlay.ts` — the reference's read-only pause modal, trimmed (Phaser-coupled).
- `docs/designs/2026-06-18-rich-playability.md` — this design doc.

**Changed:**

- `src/world/LevelGenerator.ts` — `STAGE_MOTIFS` / `MotifParams` / `MOTIF_PARAMS` / `selectMotif` +
  the motif-shaped step-5 scatter + `desc.motif` (PURE; off-the-main-thread motif sub-RNG).
- `src/config/stages.ts` — the optional `StageConfig.motifWeights?` seam (PURE; unset by F7).
- `src/core/Input.ts` — a `JustDown` pause edge (P/ESC) on the intent snapshot + `consumePause()`.
- `src/effects/ParticlePool.ts` — `spawnNumber(x, y, value, opts?)` (ported, trimmed).
- `src/effects/Effects.ts` — `scorePopup(x, y, value)`.
- `src/scenes/GameScene.ts` — the `paused` flag + `_openPause`/`_closePause`; the score-popup call at
  the kill sites; the `hud.powerMaxSecs` publish.
- `src/scenes/HUDScene.ts` — the power-up timer bar + a panel header/divider.
- `src/scenes/TitleScene.ts` — the best line (MetaState read).
- `src/scenes/HubScene.ts` — the best line (MetaState read).
- `src/i18n/en.ts` + `src/i18n/zh-CN.ts` — `title.best` / `hub.best` + `pause.*` chrome (both locales).
- `scripts/verify-gen.mjs` — the motif assertions + the per-(seed,stage) invariants covering every
  motif + the re-pinned PIN block (incl. `motif`).
- `README.md` — rewritten for the finished game.

---

## 7. Verification

> Each AC maps to a `typecheck` / `build` / `verify` gate, a code-presence grep, or a manual
> `npm run dev` drive. The PURE motif work is HEADLESSLY proven; the coupled pause/juice/menu/HUD work
> is grep + drive (the verifier never imports Phaser-coupled modules — AC9).

- **AC1 (stage variety / motif selector) — `npm run verify` + grep.** The verifier asserts
  `STAGE_MOTIFS.length ≥ 3`, that `selectMotif(seed, cfg)` returns a member of `STAGE_MOTIFS` for
  every sweep (seed, stage), and that the SET of distinct `desc.motif` values over the 200-seed ×
  7-stage sweep has size ≥ 2 (the shape space is exercised — no dead/collapsed motif). Grep
  `STAGE_MOTIFS` / `selectMotif` / `desc.motif` in `LevelGenerator.ts`.
- **AC2 (invariants preserved for every motif) — `npm run verify`.** The EXISTING `checkDescription`
  (enclosure: base bottom-center + BRICK/STEEL neighbours; reachability: footprint-BFS from each top
  spawn reaches a fort-approach window; ceiling: each per-terrain count ≤ `scatterCells`) runs PER
  (seed, stage) — and since the motif is chosen inside `generateStage`, it covers EVERY motif the
  sweep produces with no new proof code. A motif that sealed a corridor or exposed the eagle would FAIL
  the existing BFS/enclosure assertion loudly.
- **AC3 (determinism + pin) — `npm run verify`.** The existing determinism check
  (`generateStage(seed,cfg)` twice → DEEP-EQUAL) now also covers `motif` (deep-equal includes it). The
  RE-PINNED `PIN` block (recomputed `PIN_TILES`/`PIN_SCATTER` + new `PIN_MOTIF`) deep-equals the real
  output; the base/spawn coords + `isBoss` pin fields are byte-unchanged (the motif touches only the
  scatter). A new `selectMotif`-totality check drives a degenerate all-zero weights roster → a known id.
- **AC4 (pause freezes gameplay) — grep + manual drive.** Grep `paused` / `_openPause` / `_closePause`
  / `consumePause` in `GameScene.ts` + `Input.ts`; grep `PauseOverlay` + the P/ESC handlers in
  `PauseOverlay.ts`. Manual: `npm run dev` → start a run → press `P` (then `Esc`): the world freezes
  (no tank/enemy/bullet motion), the overlay shows; press again → resume with NO leaked fire / no
  re-pause. Verify pause is inert after gameOver.
- **AC5 (kill juice) — grep + manual drive.** Grep `scorePopup` in `Effects.ts` + `GameScene.ts` and
  `spawnNumber` in `ParticlePool.ts`. Manual: kill an enemy → a floating "+N" rises at the kill center;
  a brick chip spawns NO popup.
- **AC6 (high scores on Title/Hub) — grep + manual drive.** Grep `getBestScore` / `getBestStage` /
  `title.best` / `hub.best` in `TitleScene.ts` / `HubScene.ts`. Manual: finish a run (banks a best) →
  return to Title/Hub → the BEST line shows the banked score/stage; a fresh save shows 0/0.
- **AC7 (HUD timer bar + panel polish) — grep + manual drive.** Grep `powerMaxSecs` in `GameScene.ts`
  (publish) + `HUDScene.ts` (read) + the bar Rectangles in `HUDScene.ts`. Manual: pick up a FREEZE/
  SHIELD/FORTIFY power-up → a draining fill bar appears under the power-up line + empties as the timer
  runs down; no power-up → the bar is hidden.
- **AC8 (README) — read.** `README.md` describes the finished game (endless Battle City clone),
  controls (P1 WASD+J · P2 arrows+Numpad0 · P/Esc pause · M mute), power-ups + boss + co-op, and the
  run/build/verify commands; the pure/coupled split + verifier gate stay accurate.
- **AC9 (green gate + pure/coupled + offline) — `npm run typecheck` + `npm run build` + `npm run
  verify`.** All exit 0 / print OK. The verifier node-imports `world/LevelGenerator.ts` +
  `config/stages.ts` (re-proving purity — a stray Phaser import throws); it NEVER imports
  `entities/PauseOverlay.ts`, `effects/*`, `world/TileMap.ts`, or the scenes. `npm run build` (relative
  `base`) runs from `file://`; programmer-art primitives + synthesized audio only. Every F0–F6 verifier
  section is byte-unchanged except the ONE re-pinned `PIN` block + the additive motif section.
