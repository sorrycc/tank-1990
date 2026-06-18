# Tank 1990 — F2 Procedural Stages (seeded, verifiable 13×13 terrain)

> Design doc for **F2 Procedural Stages**, the terrain-generation feature of Tank 1990 (a faithful
> Battle City / 坦克大战 clone). Format mirrors the read-only reference `dead-cell` design docs
> EXACTLY: Background → Requirements Summary → Acceptance Criteria → Decision Log → Design → Files →
> Verification. F0 stood up the booting skeleton (six scenes, pure RNG, defensive save, shared
> constants, a green `typecheck`/`build`/`verify` STUB). F1 made a drivable tank sandbox on a
> hand-built STEEL-walled test arena. F2 replaces that test arena with a **PURE, SEEDED, VERIFIABLE
> 13×13 stage**: a pure tile config (`config/tiles.ts`), a pure per-stage difficulty config
> (`config/stages.ts`), a pure `world/LevelGenerator.ts` that emits a deterministic level
> description (terrain grid + eagle base + spawn points), a Phaser-coupled `world/TileMap.ts` that
> renders + bodies it (brick eroding at sub-cell granularity), a REAL headless `scripts/verify-gen.mjs`
> harness as the quality gate, and a `GameScene` that builds the generated stage instead of the test
> arena. No enemy AI, no power-ups, no eagle-loss / win condition yet (YAGNI — each lands in its own
> later feature). This is the terrain FOUNDATION every later combat/enemy feature stands on.

---

## 1. Background

Battle City stages are a **13×13 tile** battlefield: a destructible-brick / indestructible-steel /
tank-blocking-water / overdraw-trees / low-friction-ice terrain map, with the **eagle base**
walled in brick at the bottom-center, enemy tanks streaming in from three top spawn points, and the
two players spawning either side of the base at the bottom. The locked design (discovery COMPLETE)
makes these stages **PROCEDURAL + SEEDED** via a PURE generator gated by a REAL headless verify
harness — the same quality-gate convention the read-only reference `dead-cell` uses for its
platformer levels.

F0 delivered the PURE `config/constants.ts` owning the grid math (`GRID_COLS=13`, `GRID_ROWS=13`,
`TILE_SIZE=48`, `SUB_CELLS=2`, `SUB_CELL_SIZE=24`, `PLAYFIELD_X/Y/W/H`, `MAX_CONCURRENT_ENEMIES=4`,
`ENEMIES_PER_STAGE=20`, `BOSS_STAGE_EVERY=5`), the byte-identical `mulberry32` RNG, the defensive
save, and a determinism+purity verifier STUB. F1 added the Phaser-coupled `core/Input`,
`entities/Tank`, `combat/BulletPool`, and a `GameScene` that builds a hand-made STEEL-walled test
arena. F2 turns the verifier STUB into the REAL stage-generation gate the F0 doc always promised
("F2 fills in the seeded-stage sweep") and replaces the test arena with a generated stage.

This feature mirrors the reference's procedural architecture EXACTLY, adapting it from a wide
side-scrolling platformer to a fixed-size top-down grid:

- **`src/config/tiles.ts` (PURE — NO Phaser):** the `TILE` enum (`EMPTY/BRICK/STEEL/WATER/TREES/
  ICE/BASE`) + a per-tile property table (`passableByTank`, `passableByBullet`, `destructible`,
  `color`). The reference owns its tile ints + props inside `LevelGenerator.ts`; Tank 1990 has SEVEN
  terrain kinds with distinct movement/bullet/erosion semantics, so they earn their OWN small pure
  module that the generator, `TileMap`, and the verifier all import (DRY — one source of truth).
- **`src/config/stages.ts` (PURE — NO Phaser):** per-stage difficulty params (terrain densities,
  enemy roster weights, total + concurrent enemy counts) + a `stageConfig(stageIndex)` selector that
  scales difficulty **monotonically** with the stage number. This is Tank 1990's analogue of the
  reference's `config/biomes.ts` + `config/difficulty.ts` — except the game is ENDLESS, so instead of
  a fixed ordered biome list it is a pure FUNCTION of `stageIndex` that never decreases difficulty.
- **`src/world/LevelGenerator.ts` (PURE — NO Phaser):** `generateStage(seed, stageConfig)` →
  a plain `StageDescription` (pure data, no functions, serializes for a regression pin): a 2-D tile
  grid (GRID-SPACE row-major data, NO pixel offset baked in), the eagle `BASE` at bottom-center
  enclosed by a brick ring, the three top enemy spawn points (left/center/right), and the two player
  spawn points (bottom, flanking the base). Every `base`/spawn `x/y` is the **2×2 TANK-WINDOW CENTER
  in ABSOLUTE screen coords** — `x = PLAYFIELD_X + (col+1)·TILE_SIZE`, `y = PLAYFIELD_Y + (row+1)·
  TILE_SIZE` — the SINGLE coordinate convention shared by TileMap (render), GameScene (tank-body
  spawn), and the verifier (the AC8 pin). ONE `mulberry32` threads the whole generation
  (deterministic). The generator may import `PLAYFIELD_X/Y` + `TILE_SIZE` from the PURE `constants.ts`
  (they are Phaser-free numeric constants), so emitting absolute world coords keeps the module pure
  and the verifier node-imports it. Mirrors the reference's `generateLevel(seed, biomeConfig)`
  contract + its pure-data discipline; the ONE deliberate divergence from the reference's
  world-origin `(col+0.5)·tileSize` formula is the **PLAYFIELD offset + 2×2-window center** demanded
  by Tank 1990's centered playfield + right-side HUD panel + 2-tile tank footprint (Decision D13).
- **`src/world/TileMap.ts` (Phaser-coupled):** renders the grid as programmer-art primitives + builds
  Arcade bodies — BRICK as `SUB_CELLS²` (2×2=4) destructible sub-cells per tile (each its own static
  body, so erosion is per-sub-cell), STEEL static bodies, a WATER body that blocks tanks (bullets pass
  — handled in collision later), TREES drawn ABOVE tanks with no body, an ICE marker for low friction,
  and the eagle base drawn + bodied. `destroy()` leaks nothing (the in-place stage→stage rebuild later).
  Mirrors the reference's `TileMap.ts` (merged-run static bodies, `destroy()` discipline) — adapted to
  brick sub-cells + the top-down terrain kinds.
- **`scripts/verify-gen.mjs`:** REPLACE the F0 stub with REAL checks over N seeds × several stages:
  (a) determinism (deep-equal), (b) bounds (grid dims + counts within config bounds — the terrain
  bound is an explicit ABSOLUTE max-count ceiling the binomial scatter provably never exceeds, NOT
  `density·N`, so the sweep is reproducibly green — D14), (c) eagle present + fully enclosed +
  REACHABLE from a top enemy spawn via a footprint-aware BFS over tank-standable 2×2 windows whose
  GOAL is a `tankFits` window orthogonally adjacent to a fort-ring BRICK cell (D15), (d) every spawn
  point's full 2×2 footprint clear AND its emitted `x/y` exactly equals the pinned 2×2-window-center
  formula (D13), (e) difficulty monotonic across `stageConfig(0..K)` — including the precisely-defined
  normalized HARD-TYPE enemy-weight SHARE (D16). Exits non-zero on any failure. Mirrors the
  reference's RE-DERIVED BFS + bounds + determinism sweep.
- **`GameScene`:** builds the generated stage (the current `stageIndex`) via `TileMap` instead of the
  hand-made test arena.

**Conventions mirrored from `dead-cell` (read-only, NEVER modified):** the PURE/COUPLED split
(`config/tiles.ts`, `config/stages.ts`, `world/LevelGenerator.ts` import NOTHING from Phaser, so the
verifier imports them headlessly under plain node; `world/TileMap.ts` + scenes are Phaser-coupled and
NEVER imported by the verifier); ONE seeded `mulberry32` threading the whole generation; a pure-data
description that serializes for a regression pin; an INDEPENDENT verifier that RE-DERIVES reachability/
spawn-validity from the EMITTED tiles (a proof, not self-certification); the merged-run static-body +
`destroy()` discipline in `TileMap`; heavy intent-revealing comments citing the section + AC + Decision
numbers. Governing conventions: **KISS, YAGNI, DRY, SOLID**.

---

## 2. Requirements Summary

**Goal:** Replace F1's hand-made test arena with PROCEDURAL, SEEDED, headlessly-VERIFIED 13×13 stages
whose difficulty scales monotonically with the stage number — terrain grid + an enclosed reachable
eagle base + valid spawn points — rendered + bodied by a leak-free `TileMap`, all green on
`typecheck`/`build`/`verify`.

**In scope (F2):**

- **`src/config/tiles.ts` (PURE):** `export const TILE = { EMPTY, BRICK, STEEL, WATER, TREES, ICE,
  BASE }` (small ints, `EMPTY=0` so a fresh grid is all-empty); a `TileProps` interface +
  `TILE_PROPS[tile]` table with `{ passableByTank, passableByBullet, destructible, color }`; small
  pure helpers `isTankPassable(tile)` / `isBulletPassable(tile)` / `isDestructible(tile)` reading the
  table (DRY — the generator/TileMap/verifier never re-encode the semantics). NO Phaser.
- **`src/config/stages.ts` (PURE):** a `StageConfig` interface (the params the generator reads:
  `stageIndex`, `brickDensity`, `steelDensity`, `waterDensity`, `treesDensity`, `iceDensity`,
  `totalEnemies`, `concurrentEnemies`, `enemyWeights`, `isBoss`); `stageConfig(stageIndex:number):
  StageConfig` — a PURE selector that scales difficulty MONOTONICALLY (terrain densities + enemy
  counts non-decreasing, the NORMALIZED `hardShare = (power+armor)/(basic+fast+power+armor)`
  non-decreasing — D16, not each raw weight) with the stage number, clamped to sane caps, and flags
  every `BOSS_STAGE_EVERY`-th stage `isBoss:true`; a `hardShare(cfg)` helper + bound constants
  (`STEEL_DENSITY_MAX`, `TOTAL_ENEMIES_MAX`, etc.) the verifier asserts against. Reuses
  `ENEMIES_PER_STAGE`/`MAX_CONCURRENT_ENEMIES`/`BOSS_STAGE_EVERY`/`GRID_*` from `constants.ts` (DRY).
  NO Phaser.
- **`src/world/LevelGenerator.ts` (PURE):** shared data shapes (`GridPoint`, `SpawnPoint`,
  `StageDescription`) + the shared predicates `tankFits`/`windowCenter`/`isFortApproachWindow`;
  `generateStage(seed:number, cfg:StageConfig): StageDescription`. ONE `mulberry32(seed)` threads it.
  Builds: a `GRID_ROWS×GRID_COLS` GRID-SPACE tile grid (row-major `tiles[row][col]`, NO pixel offset);
  the eagle `BASE` tile at bottom-center with a BRICK ring around its three open sides (the classic
  fort); the three top enemy spawn points (left / center / right columns, top row area) at `tankFits`
  anchors; the two player spawn points (bottom row, flanking the base) at `tankFits` anchors — every
  `base`/spawn `x/y` filled via `windowCenter` = the ABSOLUTE 2×2-WINDOW CENTER
  `(PLAYFIELD_X+(col+1)·TILE_SIZE, PLAYFIELD_Y+(row+1)·TILE_SIZE)` (D13, the tank-body center); a
  guaranteed 2-tile-wide tank-passable corridor carved from each top spawn to a `isFortApproachWindow`
  GOAL window (D15) so reachability holds BY CONSTRUCTION; and a seeded terrain scatter
  (brick/steel/water/trees/ice) by the config densities, KEPT OFF the base enclosure / spawn footprints
  / corridors, recording `scatterCells` (the exact eligible-cell count — the AC6 ceiling, D14). Returns
  plain data (no functions) so it serializes for the regression pin. Imports `PLAYFIELD_X/Y`/`TILE_SIZE`/
  `TANK_SIZE`/`GRID_*` from the PURE `constants.ts` — NO Phaser.
- **`src/world/TileMap.ts` (Phaser-coupled):** `new TileMap(scene, desc)` renders + bodies the grid
  with primitives — BRICK split into `SUB_CELLS²` (4) independently-destructible sub-cell static
  bodies; STEEL one static body per tile; WATER a tank-blocking static body (rendered blue; bullets
  pass — the body is tagged so the later bullet collision lets bullets through); TREES drawn at a HIGH
  depth ABOVE tanks with NO body; ICE rendered + tagged for low friction (no body — tanks drive over
  it); the eagle BASE drawn + bodied. A `destroyBrickSubCell(col,row,subCol,subRow)` seam (erosion at
  sub-cell granularity) and a leak-free `destroy()` (clears every group + tracked object). Mirrors the
  reference `TileMap` exactly (merged-or-per-cell static bodies, tracked `_objects`, `destroy()`).
- **`scripts/verify-gen.mjs` (REAL harness — replaces the stub):** keep the F0 rng/constants/save
  asserts; ADD a stage sweep over N seeds × the first K stages (incl. a boss stage) that re-derives
  every property from the EMITTED description: (a) determinism (two generations deep-equal); (b) a
  regression pin (one fixed seed+stage → a COMPUTED reference description, deep-equal); (c) bounds
  (grid dims == `GRID_ROWS×GRID_COLS`; tile values all valid `TILE` ints; enemy counts within the
  `stageConfig` bounds; each terrain count ≤ `desc.scatterCells` — the absolute max-count ceiling, D14);
  (d) eagle present + fully enclosed (every orthogonally-adjacent non-base neighbour of the BASE is
  BRICK or STEEL or the grid edge) + REACHABLE from ≥1 top enemy spawn via a footprint-aware BFS over
  tank-standable 2×2 windows whose GOAL is a `isFortApproachWindow` window adjacent to the fort ring
  (D15); (e) every spawn point a `tankFits` anchor AND its `x/y` == the 2×2-window-center pin (D13);
  (f) difficulty MONOTONIC across `stageConfig(0..K)` (densities + counts + `hardShare` + boss cadence
  non-decreasing/correct, D16).
  Exits non-zero on any failure. Imports ONLY pure modules (`tiles.ts`, `stages.ts`,
  `LevelGenerator.ts`, `constants.ts`, `rng.ts`, `save.ts`) — never `TileMap`/scenes.
- **`src/scenes/GameScene.ts`:** build the generated stage for the current `stageIndex` (default 0,
  seed from a fixed dev seed for now) via `TileMap`; collide tanks ↔ the `TileMap`'s tank-blocking
  bodies (STEEL/BRICK/WATER/BASE) instead of the four test-arena walls; keep the F1 tanks + input +
  bullet pool + tick loop. (Bullet↔terrain collision + damage, the eagle-loss condition, enemies,
  power-ups, the live HUD are LATER features.)

**Out of scope (F2 — later features):** bullet↔terrain / bullet↔tank / bullet↔eagle COLLISION +
damage (brick erosion is WIRED — the `destroyBrickSubCell` seam + per-sub-cell bodies — but nothing
SHOOTS them yet); the eagle-loss → GameOver condition; enemy tanks + the ONE FSM + the 4 enemy types
+ staggered spawns; the boss tank entity (the stage is FLAGGED `isBoss` but no boss spawns); the 6
power-ups; ICE actually altering tank friction (the tile is rendered + tagged; the movement change is
a later feel feature); score/lives/HUD readouts; the Hub upgrade trees; i18n strings. F2 ships ONLY a
generated, verified, rendered, tank-collidable stage with an enclosed reachable eagle.

---

## 3. Acceptance Criteria

> All testable. §7 maps each AC to a `typecheck`/`build`/`verify` check, a code-presence grep, or a
> manual `npm run dev` drive-test. The verifier (headless) proves the PURE-module ACs (AC4–AC9);
> `TileMap`/`GameScene` ACs (AC10–AC11) are coupled, so they are grep/drive-tested, NOT verifier-imported.

1. **AC1 — Pure tile config.** `src/config/tiles.ts` imports NOTHING from Phaser (node-importable). It
   exports `TILE` (`EMPTY=0` … `BASE`), a `TileProps` shape, a `TILE_PROPS` table covering EVERY
   `TILE` value with `{ passableByTank, passableByBullet, destructible, color }`, and helpers
   `isTankPassable`/`isBulletPassable`/`isDestructible` that READ the table (no re-encoded literals).
   Semantics are classic: BRICK = destructible, blocks tanks + bullets; STEEL = indestructible (this
   phase), blocks tanks + bullets; WATER = blocks tanks, bullets PASS; TREES = passable by both
   (overdraw cover); ICE = passable by both (low friction); BASE = blocks tanks + bullets;
   EMPTY = passable by both.
2. **AC2 — Pure, monotonic stage config.** `src/config/stages.ts` imports NOTHING from Phaser.
   `stageConfig(stageIndex)` is a PURE function returning a `StageConfig` whose difficulty params
   (terrain densities, `totalEnemies`, `concurrentEnemies`, harder-enemy weights) are MONOTONICALLY
   non-decreasing in `stageIndex`, clamped to named caps, with `isBoss === (stageIndex % BOSS_STAGE_EVERY
   === BOSS_STAGE_EVERY-1)` (every `BOSS_STAGE_EVERY`-th stage). `concurrentEnemies ≤ MAX_CONCURRENT_ENEMIES`
   and `totalEnemies ≥ concurrentEnemies` for every stage. The verifier asserts the monotonicity across
   `stageConfig(0..K)` (AC9).
3. **AC3 — Pure deterministic generator.** `src/world/LevelGenerator.ts` imports NOTHING from Phaser.
   `generateStage(seed, cfg)` threads ONE `mulberry32(seed)` and returns plain data (no functions on
   the description), so the SAME `(seed, cfg)` is byte-identical every call (AC4) and serializes for the
   pin (AC5).
4. **AC4 — Determinism.** For N seeds × the first K stages, `generateStage` called twice is element-wise
   DEEP-EQUAL (over the int grid + every field). Verifier-asserted.
5. **AC5 — Regression pin.** ONE fixed `(seed, stageIndex)` produces a description deep-equal to a
   COMPUTED reference (the real function's output, never hand-invented), so a silent generator change
   fails loudly. Verifier-asserted.
6. **AC6 — Bounds.** Every generated grid is exactly `GRID_ROWS × GRID_COLS`; every tile is a valid
   `TILE` int; the enemy total + concurrent counts are within the `stageConfig` bounds; and each
   per-terrain tile COUNT is `≤` an explicit ABSOLUTE max-count ceiling, NOT a statistical
   `density · interiorCells`. The scatter (§5.3 step 5) draws a per-cell Bernoulli over the eligible
   (non-reserved interior) cells, so a realized count is a BINOMIAL that exceeds `density · N` on ~half
   the seeds — asserting that mean would fail nondeterministically. Instead the generator emits, in
   the description, the EXACT eligible-cell count it scattered over (`scatterCells`), and the verifier
   asserts `count(kind) ≤ terrainMaxCount(kind, cfg)` where `terrainMaxCount = scatterCells` (the hard
   ceiling the per-cell scatter can NEVER exceed — at most one tile is placed per eligible cell). This
   bound is reproducibly green on EVERY seed. (The exact formula is pinned in §7; D14 gives the
   rationale.) Verifier-asserted (RE-derived from the EMITTED tiles/counts).
7. **AC7 — Eagle present, enclosed, and reachable.** Exactly ONE `BASE` tile exists at bottom-center;
   it is FULLY ENCLOSED (every orthogonal neighbour cell that is inside the grid and not part of the
   base is BRICK or STEEL — the classic brick fort, so the eagle is never exposed at spawn); and a top
   enemy spawn can REACH the eagle fort via a footprint-aware BFS over tank-standable 2×2 windows
   (`tankFits` true). The BFS GOAL is precisely **"≥1 reached `tankFits` window orthogonally adjacent
   to a fort-ring BRICK cell"** — a 2-tile-standable window whose footprint has a cell exactly one
   orthogonal step from a fort wall (the closest a 2×2 body can park to shoot the eagle). Because the
   base + its fort ring are BASE/BRICK (never tank-passable), NO `tankFits` window can CONTAIN a
   base-adjacent cell, so the goal is a WINDOW-graph node ADJACENT to the ring, NOT a single cell next
   to the BASE; such a window provably EXISTS for the odd 13-wide grid + even 2-tile footprint + fort
   at col 6 (D15 enumerates them, e.g. the windows anchored at (5,9)/(6,9), and the generator carves
   its corridor to terminate at exactly one), so the goal is reachable, not a phantom target.
   Verifier-asserted via a BFS RE-derived from the EMITTED grid.
8. **AC8 — Spawn validity + coordinate pin.** All three top enemy spawn points AND both player spawn
   points are `tankFits` anchors (the full 2×2 footprint is tank-passable + in-bounds — a tank fits
   there), are distinct + in-bounds, AND each spawn's emitted `(x, y)` EXACTLY equals the 2×2
   TANK-WINDOW CENTER `x = PLAYFIELD_X + (col+1)·tileSize`, `y = PLAYFIELD_Y + (row+1)·tileSize` (NOT
   the single-tile center `(col+0.5)·tileSize`), so the GameScene tank body placed at `desc…x/y`
   straddles EXACTLY the 2×2 footprint `tankFits` cleared — render == verified geometry (D13). The
   `base.x/y` obeys the SAME window-center formula. Verifier-asserted (RE-derived from the EMITTED
   tiles + the pinned formula).
9. **AC9 — Monotonic difficulty.** Across `stageConfig(0)…stageConfig(K)` every difficulty axis is
   non-decreasing in the EXACT sense pinned in D16: each terrain density, `totalEnemies`, and
   `concurrentEnemies` (up to its `MAX_CONCURRENT_ENEMIES` cap) is non-decreasing; AND the NORMALIZED
   HARD-TYPE SHARE `hardShare(cfg) = (enemyWeights.power + enemyWeights.armor) / (basic + fast + power
   + armor)` is non-decreasing — the easy weights (`basic`/`fast`) MAY DECREASE while the hard share
   rises, so the verifier asserts `hardShare(stageConfig(i)) ≤ hardShare(stageConfig(i+1))`, NOT a
   per-raw-field non-decreasing check. The boss cadence is exactly every `BOSS_STAGE_EVERY`-th stage.
   Verifier-asserted.
10. **AC10 — TileMap renders + collides + erodes at sub-cell granularity.** `world/TileMap.ts` renders
    the grid with primitives only (no external asset / `load.*`); BRICK is built as `SUB_CELLS²` (4)
    INDEPENDENT static sub-cell bodies (a `destroyBrickSubCell` seam removes one without touching the
    others — sub-cell erosion); STEEL/WATER/BASE are tank-blocking static bodies; TREES draw ABOVE
    tanks with NO body; ICE has no body. Tanks collide with the tank-blocking bodies (a tank stops at
    brick/steel/water/the base). `destroy()` clears every group + tracked object (no leak — the later
    in-place rebuild). Grep + drive-test.
11. **AC11 — Green gate, pure/coupled split, offline.** `npm run typecheck` (strict) + `npm run build`
    exit 0; `npm run verify` runs the REAL sweep + exits 0 (non-zero on any seeded failure). The
    verifier imports ONLY pure modules (`tiles.ts`/`stages.ts`/`LevelGenerator.ts`/`constants.ts`/
    `rng.ts`/`save.ts`) — a Phaser import in any would throw under node, so a green `verify` re-proves
    their purity; it imports NO `TileMap`/scene. Programmer-art primitives only; runs from `file://`.

---

## 4. Decision Log

> Each decision notes how it stays KISS/YAGNI/DRY/SOLID and preserves the pure/coupled split.

1. **D1 — Mirror the reference's procedural architecture, adapted top-down.** Keep the reference's
   FOUR seams 1:1: a pure tile/props source, a pure per-stage config, a pure
   `generate*(seed, config) → plain description`, and a Phaser-coupled `TileMap` that renders + bodies
   it, gated by a headless verifier that RE-DERIVES properties from the EMITTED grid. *Rationale:* the
   brief mandates mirroring `dead-cell` EXACTLY; reusing the proven pure/coupled split + the
   re-derived-proof verifier is KISS/DRY and keeps every later feature plugging into the SAME seams. The
   adaptation is purely DATA-shape (a fixed 13×13 top-down grid with 7 terrain kinds vs. a wide
   platformer with solid/oneway/hazard) — no new architecture is invented.
2. **D2 — `config/tiles.ts` is its OWN pure module (not inlined in the generator).** The reference
   keeps a 4-value `TILE` const + no prop table inside `LevelGenerator.ts`. Tank 1990 has SEVEN terrain
   kinds with DISTINCT tank/bullet/erosion semantics that THREE modules consume (generator, TileMap,
   verifier). *Rationale:* a shared semantic table (`passableByTank`/`passableByBullet`/`destructible`/
   `color`) owned ONCE (DRY) means the generator's "keep a tank corridor clear", TileMap's "which tiles
   get a blocking body", and the verifier's "tank-passable BFS" all read the SAME truth — they CANNOT
   disagree (the reference's "shared predicate" pattern, e.g. `canReachStep`). Keeping it pure preserves
   the split (the verifier node-imports it). KISS: a flat lookup table, no classes.
3. **D3 — Difficulty is a PURE FUNCTION of `stageIndex`, not an ordered list (the endless analogue).**
   The reference walks a fixed `BIOME_ORDER` with per-biome bands + a `difficultyTier`. Tank 1990 is
   ENDLESS (locked), so there is no terminal list — `stageConfig(stageIndex)` is a closed-form selector
   that scales densities + counts monotonically and caps them (so deep stages stay PLAYABLE, not a solid
   wall of steel). *Rationale:* endless escalation is the locked decision; a pure monotone function is
   the minimal, testable shape (the verifier sweeps `stageConfig(0..K)` for monotonicity — AC9, the
   exact analogue of the reference's "tiers non-decreasing along BIOME_ORDER"). Caps keep it KISS +
   solvable; no speculative per-stage hand-authoring (YAGNI). It reuses `ENEMIES_PER_STAGE`/
   `MAX_CONCURRENT_ENEMIES`/`BOSS_STAGE_EVERY` from `constants.ts` (DRY) as the anchor values it scales
   around.
4. **D4 — The eagle fort + the guaranteed corridor make AC7 hold BY CONSTRUCTION.** The generator
   (a) stamps the BASE at bottom-center, (b) rings its open sides with BRICK (the classic fort), and
   (c) carves a guaranteed tank-passable path from each top spawn toward the base BEFORE the random
   terrain scatter, and the scatter NEVER overwrites the base ring, the spawn cells, or that corridor.
   *Rationale:* this is the reference's "traversable BY CONSTRUCTION" stance (its staircase walk) — the
   verifier's BFS is then a PROOF, not a filter+retry (which would be non-deterministic in spirit). It
   guarantees enemies can always reach + attack the eagle (the level is never a sealed box) AND the
   eagle is never exposed at spawn, both in ONE pass. KISS: carve-then-scatter with a reserved mask, no
   reject-and-retry loop.
5. **D5 — BFS reachability + spawn validity use the TANK FOOTPRINT (2×2 tiles), not a point mass.** A
   Tank 1990 tank spans ~2×2 tiles (`TANK_SIZE ≈ 2·TILE_SIZE`). A point-mass BFS could call a 1-tile slot
   "reachable" that a real tank can't enter. *Rationale:* this is the reference's body-aware-clearance
   lesson (its 36×52 body vs. a 1-tile channel) applied to the grid: a cell is tank-standable iff the
   2×2 block anchored there is fully tank-passable + in-bounds, and a BFS edge connects two such windows
   that are orthogonally adjacent. The generator's corridor is carved 2 tiles wide; the verifier's BFS
   re-derives the SAME footprint window — so a PASS means a REAL tank reaches the base (sound, never a
   false pass). A shared `tankFits(tiles, col, row)` helper in the PURE generator (imported by the
   verifier) keeps the generator + verifier checking the SAME graph (DRY — the `canReachStep` pattern).
6. **D6 — BRICK = `SUB_CELLS²` independent sub-cell bodies (sub-cell erosion); the OTHER kinds = one
   body per tile.** `TileMap` builds each BRICK tile as 4 separate static sub-cell rectangles+bodies
   (each `SUB_CELL_SIZE`=24 px) with a `destroyBrickSubCell` seam; STEEL/WATER/BASE are one static body
   per tile. *Rationale:* the locked decision is "each BRICK tile = 4 destructible sub-cells" — a bullet
   chips a quarter-brick (the classic feel), which REQUIRES per-sub-cell bodies. The reference merges
   runs for FEWER bodies; here per-sub-cell granularity is the REQUIREMENT, so we don't merge brick
   (the other kinds, never sub-divided, are one body each — KISS). The damage feature (later) calls the
   `destroyBrickSubCell` seam; F2 only WIRES it (YAGNI — nothing shoots yet). `destroy()` leaks nothing
   (the reference's `clear(true,true)` + tracked-objects discipline).
7. **D7 — WATER blocks tanks with a tagged body; bullets-pass is handled in the LATER bullet collision.**
   `TileMap` gives WATER a tank-blocking static body in a `waterBodies` group, distinct from the
   `solidBodies` group, and the body is tagged so the later bullet×terrain collision can let bullets fly
   over water (the classic). *Rationale:* F2 has no bullet×terrain collision yet (out of scope), but the
   TANK×water block IS in scope (a tank can't drive into water). Separating the water group now means the
   later feature wires "tanks collide with water, bullets don't" by pointing colliders at the right group
   — no refactor (SOLID — the groups encode the semantic split the `tiles.ts` props declare). KISS.
8. **D8 — TREES draw ABOVE tanks (overdraw), ICE is render+tag-only, both bodiless.** TREES rects are
   added at a HIGH depth so they overdraw tanks/bullets (cover); ICE rects are drawn at terrain depth
   with no body and tagged for the later low-friction feel. *Rationale:* the locked terrain semantics —
   "TREES: overdraw cover, everything passes; ICE: low friction, everything passes" — mean NEITHER gets
   a collision body (everything passes), so the only F2 work is render depth (trees) + a tag (ice). The
   actual ice-friction movement change is a feel feature (YAGNI now — the tile + tag are the seam).
9. **D9 — The verifier RE-DERIVES every property from the EMITTED grid (an independent proof).** Bounds,
   eagle enclosure, reachability, and spawn validity are computed from `desc.tiles`/`desc.spawns`, NOT
   trusted from the generator's intent — exactly the reference's stance (its BFS rebuilds the graph from
   the emitted platforms). *Rationale:* a generator bug that "intended" a solvable stage is caught HERE,
   not trusted. The shared `tankFits`/`isTankPassable` helpers keep the verifier's re-derivation byte-
   consistent with the generator's placement (DRY) while the CHECKS are independent (the verifier owns
   its own BFS + count scans). Importing only pure modules re-proves the split (a Phaser import would
   throw under node — the reference's convention).
10. **D10 — A regression pin via a SPECIFIED serialization, like the reference + the F0 rng pin.** Pin
    ONE `(seed, stageIndex)` to the COMPUTED `StageDescription` (deep-equal over the int grid + fields),
    never a vague hash. *Rationale:* the reference pins a full reference description ("the COMPUTED
    output of the real function, never hand-invented"); the F0 doc already pins the rng prefix this way.
    A full deep-equal pin catches ANY silent generator drift loudly (the point), and is KISS (reuse the
    F0 `deepEqual` helper). The pin lives on a SMALL fixed stage so it stays readable.
11. **D11 — GameScene builds the generated stage; the F1 test-arena walls are REPLACED, the rest kept.**
    `GameScene.create` calls `generateStage(seed, stageConfig(stageIndex))` + `new TileMap(this, desc)`,
    collides each tank against the TileMap's tank-blocking bodies, and spawns the players at the
    description's player spawn points. The F1 Input + BulletPool + tick loop are UNCHANGED. *Rationale:*
    the feature's stated scope is "GameScene builds the generated stage instead of the test arena". Keeping
    the F1 movement/fire spine (DRY) and only swapping the world (the arena → a TileMap) is the minimal
    change (KISS); the generated terrain replaces the four hand-made steel walls (the world bounds are the
    13×13 playfield). No enemies/eagle-loss yet (YAGNI — later features).
12. **D12 — No new save schema, no i18n yet.** F2 touches no persisted state and adds no user-facing
    strings. *Rationale:* the stage is derived from a seed + `stageIndex` held in scene state (the run/
    persistence wiring is a later feature). YAGNI — F2 is terrain generation, not run management.
13. **D13 — ONE coordinate convention end-to-end: GRID-SPACE tiles + ABSOLUTE 2×2-window-center spawn
    coords (resolves reviewer blockers #1 + #2).** The reference's generator emits world coords as
    `(col+0.5)·tileSize` from a world ORIGIN (its verifier asserts exactly that), but Tank 1990's F1
    code is already committed to ABSOLUTE screen coords offset by `PLAYFIELD_X/PLAYFIELD_Y` (the
    centered playfield + right-side HUD panel): `GameScene` draws/spawns at `PLAYFIELD_X+…` and
    `Tank._recenterCross` snaps lanes to the `PLAYFIELD_X/PLAYFIELD_Y` origin (`Tank.ts:148/151`).
    Copying the reference formula verbatim would emit playfield-RELATIVE coords; the stage would draw
    at the canvas top-left, OUTSIDE the centered playfield, and fight the lane-snap. SO F2 pins ONE
    convention, stated explicitly for each consumer:
    - **`desc.tiles` is pure GRID-SPACE data** (row-major `tiles[row][col]`, TILE ints, NO pixel
      offset baked in) — the serializable regression-pin payload + the verifier's re-derivation source.
    - **`TileMap` (render + bodies)** maps grid→screen by `screenX = PLAYFIELD_X + col·TILE_SIZE`,
      `screenY = PLAYFIELD_Y + row·TILE_SIZE` (a tile's top-left), so the whole stage renders INSIDE
      the centered playfield, lane-aligned with the F1 tank lane-snap origin.
    - **`base`/spawn `x/y` are ABSOLUTE 2×2-TANK-WINDOW CENTERS** (also resolving blocker #2): a tank
      is a `TANK_SIZE = 2·TILE_SIZE − 4` (≈2-tile) body anchored at a 2×2 window `[col..col+1] ×
      [row..row+1]`, so its real body CENTER is the center of that 2×2 window =
      `(PLAYFIELD_X + (col+1)·TILE_SIZE, PLAYFIELD_Y + (row+1)·TILE_SIZE)`, NOT the single-tile center
      `(col+0.5)·TILE_SIZE` the reference uses. `GameScene.create` places each `new Tank(this,
      desc…x, desc…y, …)` at that body center, so the 2×2 body straddles EXACTLY the four cells
      `tankFits` cleared — never one cell up-left into uncleared territory.
    *Rationale:* the generator imports `PLAYFIELD_X/Y` + `TILE_SIZE` from the PURE `constants.ts`
    (Phaser-free numbers), so emitting ABSOLUTE coords keeps it node-importable (the verifier still
    re-proves purity). Pinning the SAME `PLAYFIELD_X + (col+1)·TILE_SIZE` formula in the generator,
    the AC8 verifier assertion, AND the GameScene spawn means render == verified geometry — one truth,
    no top-left drift, no footprint straddle (KISS/DRY/SOLID). This is the ONE deliberate divergence
    from the reference's `(col+0.5)·tileSize` world-origin formula, demanded by the centered-playfield
    layout + the 2-tile footprint.
14. **D14 — AC6 terrain bound is an ABSOLUTE max-count ceiling, not `density·N` (resolves blocker
    #4).** §5.3-step-5 scatters terrain by an independent per-cell Bernoulli draw (`rng() < density`)
    over the eligible non-reserved interior cells, so the realized count of each kind is a BINOMIAL —
    it exceeds the mean `density · N` on ~half the seeds. Asserting the count `≤ density · N` would
    make `npm run verify` FAIL nondeterministically across the seed sweep. FIX: the generator records,
    in the description, `scatterCells` = the EXACT number of eligible cells the scatter pass iterated
    (interior cells minus the reserved base/fort/spawn/corridor mask — a deterministic count for a
    given `(seed, cfg)`), and the verifier asserts `count(kind) ≤ scatterCells` for each kind. Since
    the scatter places AT MOST one tile per eligible cell, the realized count for ANY kind is provably
    `≤ scatterCells` on EVERY seed — a hard ceiling the Bernoulli can never break (reproducibly
    green). The density still SHAPES the expected fill (so deep stages get denser terrain — the
    difficulty knob) while the verifier asserts only the provable structural bound. *Rationale:* a
    verifier check must be a TRUE invariant on every seed, not a statistical expectation (the
    reference's "bounds hold by construction, re-derived from the EMITTED tiles" stance). KISS:
    one extra integer field + a `≤` compare; no shuffle/exact-K placement machinery (YAGNI — the
    Bernoulli scatter is the simplest seeded fill, and the structural ceiling makes it verifiable).
    The density caps (`BRICK_DENSITY_MAX` etc., AC2/D3) remain the per-stage scaling clamp; they are a
    SEPARATE assertion on `stageConfig`, distinct from this realized-count ceiling on the EMITTED grid.
15. **D15 — AC7 BFS goal is a `tankFits` window ORTHOGONALLY ADJACENT to a fort-ring BRICK cell, and
    such a window provably EXISTS (resolves blocker #3).** Every in-grid cell touching the BASE is a
    BRICK fort-ring cell (or the BASE itself) — NONE is tank-passable — so no tank-standable 2×2
    window can CONTAIN a base-adjacent cell, and "reach a single cell adjacent to the ring" is not a
    node in the window graph. The prior AC7 conflated a single-cell goal with the 2×2-window BFS. F2
    pins the goal precisely: a `tankFits` window `W` is a GOAL iff some cell of `W`'s 2×2 footprint is
    orthogonally adjacent (Manhattan distance 1) to a fort-ring BRICK cell. The BFS over tank-standable
    windows (nodes = `tankFits` anchors, edges = orthogonally-adjacent windows) PASSES iff a goal
    window is reached from a top-spawn window.
    *EXISTENCE PROOF (the load-bearing argument).* Grid is 13×13 (cols 0–12, rows 0–12), `BASE` at
    (col 6, row 12), fort ring at (6,11)/(5,12)/(7,12). A 2×2 window anchored at (col,row) spans
    cols [col,col+1] × rows [row,row+1] (valid anchors col∈[0,11], row∈[0,11]). Consider the window
    anchored at **(5,9)**: it spans cols [5,6] × rows [9,10]; none of its four cells is the BASE or a
    fort-ring cell (all rows ≤10 < 11), so it CAN be `tankFits` (all four cells made tank-passable by
    the corridor carve); and its cell (6,10) is orthogonally adjacent to the fort-top BRICK (6,11)
    (Δrow=1). So (5,9) is a valid goal window — likewise (6,9), (4,10), (7,10), etc. (an enumerated
    set of 6 such windows exists, none colliding with the fort). The generator (D4) carves a 2-tile-
    wide corridor from each top spawn DOWN to one of these goal windows (forcing its cells EMPTY +
    reserving them), so a goal window is reachable BY CONSTRUCTION and the verifier's BFS is a PROOF,
    never a phantom target that always fails. *Rationale:* the BFS must terminate at a node that
    genuinely exists in the window graph, or it is either always-red or checking nothing. Carving to
    an enumerated, proven-existent goal window keeps the reference's "traversable BY CONSTRUCTION"
    stance sound for the 2-tile footprint (KISS — a single fixed goal-window predicate shared by the
    generator's carve target + the verifier's goal test, DRY).
16. **D16 — AC9 monotonicity is pinned to the NORMALIZED hard-type SHARE (resolves blocker #5).**
    `StageConfig.enemyWeights` is four RAW weights whose sums need not be 1, so "the harder-enemy
    weight share is non-decreasing" was ambiguous and a naive per-field non-decreasing check is WRONG
    (the easy weights `basic`/`fast` may DECREASE as difficulty rises while the hard share climbs). F2
    pins the EXACT monotone quantity: `hardShare(cfg) = (enemyWeights.power + enemyWeights.armor) /
    (basic + fast + power + armor)` ∈ [0,1] (the normalized share of the two HARD enemy types), and
    `stageConfig` is authored so `hardShare(stageConfig(i)) ≤ hardShare(stageConfig(i+1))` for all i.
    The verifier asserts THIS aggregate across `stageConfig(0..K)` (plus the per-density / `totalEnemies`
    / `concurrentEnemies` non-decreasing checks of AC2/AC9), NOT each raw weight field. *Rationale:* a
    concrete, true, single-number invariant (the reference's "tiers non-decreasing along BIOME_ORDER"
    analogue) makes AC9 a real assertion against the live `stageConfig`, robust to the easy weights
    being tapered down — KISS/DRY (one `hardShare` helper, exported, used by both `stageConfig`'s
    intent + the verifier's check).

---

## 5. Design

### 5.1 Module layout (this phase)

Mirrors the reference's layered tree; F2 adds the `world/` layer (created by this feature) + the two
new `config/` modules, rewrites the verifier, and updates `GameScene`:

```
src/
  config/
    constants.ts          # UNCHANGED (reused: GRID_*, TILE_SIZE, SUB_CELLS, SUB_CELL_SIZE, PLAYFIELD_*,
                          #   ENEMIES_PER_STAGE, MAX_CONCURRENT_ENEMIES, BOSS_STAGE_EVERY, TANK_SIZE)
    tiles.ts              # NEW (PURE): TILE enum + TILE_PROPS table + isTankPassable/isBulletPassable/isDestructible
    stages.ts             # NEW (PURE): StageConfig + stageConfig(stageIndex) monotone selector + bound caps
  world/
    LevelGenerator.ts     # NEW (PURE): generateStage(seed, cfg) → StageDescription; tankFits/isStandable helpers
    TileMap.ts            # NEW (Phaser-coupled): render + body the grid; brick sub-cells; destroy(); seams
  scenes/
    GameScene.ts          # CHANGED: build generated stage via TileMap (replaces the F1 test arena)
scripts/
  verify-gen.mjs          # CHANGED: REAL stage sweep (determinism+pin+bounds+eagle-reach+spawn+monotonic)
```

### 5.2 Key types & constants

**`src/config/tiles.ts`** (PURE — no Phaser):

```ts
export const TILE = { EMPTY: 0, BRICK: 1, STEEL: 2, WATER: 3, TREES: 4, ICE: 5, BASE: 6 } as const
export type TileValue = (typeof TILE)[keyof typeof TILE]

export interface TileProps {
  passableByTank: boolean    // can a tank occupy this cell?  (EMPTY/TREES/ICE yes; BRICK/STEEL/WATER/BASE no)
  passableByBullet: boolean  // does a bullet fly through?    (EMPTY/WATER/TREES/ICE yes; BRICK/STEEL/BASE no)
  destructible: boolean      // can a bullet erode it?        (BRICK yes; STEEL not this phase; rest no)
  color: number              // programmer-art fill (TileMap only; the generator/verifier ignore it)
}

export const TILE_PROPS: Record<TileValue, TileProps> = { /* one row per TILE value */ }

export function isTankPassable(t: number): boolean   // reads TILE_PROPS[t].passableByTank (defensive default false)
export function isBulletPassable(t: number): boolean
export function isDestructible(t: number): boolean
```

Classic semantics encoded ONCE: EMPTY (pass/pass/—), BRICK (block/block/destructible), STEEL
(block/block/—), WATER (block/PASS/—), TREES (pass/pass/—), ICE (pass/pass/—), BASE (block/block/—).

**`src/config/stages.ts`** (PURE — no Phaser):

```ts
export interface StageConfig {
  stageIndex: number
  brickDensity: number; steelDensity: number; waterDensity: number   // 0..1 — fraction of interior cells
  treesDensity: number; iceDensity: number
  totalEnemies: number; concurrentEnemies: number                    // counts (concurrent ≤ MAX_CONCURRENT_ENEMIES)
  enemyWeights: { basic: number; fast: number; power: number; armor: number }  // weighted roster (sums need not be 1)
  isBoss: boolean
}
// Named caps the verifier asserts against (so "monotone but bounded" is checked vs. the real source):
export const STEEL_DENSITY_MAX = 0.18
export const BRICK_DENSITY_MAX  = 0.32
// … water/trees/ice caps + TOTAL_ENEMIES_MAX, etc.
export function stageConfig(stageIndex: number): StageConfig
// hardShare(cfg) = (power + armor) / (basic + fast + power + armor) — the EXACT monotone enemy-mix
// quantity AC9/D16 pins. Exported so both stageConfig's authoring intent AND the verifier check it
// (DRY). ∈ [0,1]; the verifier asserts hardShare(stageConfig(i)) ≤ hardShare(stageConfig(i+1)).
export function hardShare(cfg: StageConfig): number
```

`stageConfig` scales each axis monotonically (e.g. `steelDensity = min(STEEL_DENSITY_MAX, base + k·stageIndex)`),
biases the enemy weights toward the HARD types as `stageIndex` grows so the NORMALIZED `hardShare`
(`(power+armor)/(basic+fast+power+armor)`, D16) is non-decreasing — note the easy weights
(`basic`/`fast`) MAY taper DOWN while the hard share climbs, which is WHY the verifier checks
`hardShare`, not each raw weight field — ramps `totalEnemies` from `ENEMIES_PER_STAGE` and
`concurrentEnemies` toward `MAX_CONCURRENT_ENEMIES` (clamped), and sets `isBoss = stageIndex %
BOSS_STAGE_EVERY === BOSS_STAGE_EVERY - 1`.

**`src/world/LevelGenerator.ts`** (PURE — no Phaser):

```ts
// (col,row) = the 2×2-window ANCHOR (top-left tile). x,y = the ABSOLUTE 2×2-WINDOW-CENTER screen
// coords (D13): x = PLAYFIELD_X + (col+1)·TILE_SIZE, y = PLAYFIELD_Y + (row+1)·TILE_SIZE — the tank
// body center, NOT (col+0.5)·TILE_SIZE. GameScene spawns the Tank body at (x,y); the verifier pins it.
export interface GridPoint { col: number; row: number; x: number; y: number }
export interface SpawnPoint extends GridPoint { which: string }                 // 'enemyL'|'enemyC'|'enemyR'|'p1'|'p2'
export interface StageDescription {
  cols: number; rows: number; tileSize: number
  tiles: number[][]                       // row-major GRID-SPACE TILE ints — NO pixel offset (pure data — serializes, D13)
  base: GridPoint                         // the eagle BASE cell (bottom-center); base.x/y = window-center (D13)
  enemySpawns: SpawnPoint[]               // [left, center, right] — each a tankFits anchor; x/y = window-center
  playerSpawns: SpawnPoint[]              // [p1, p2] — each a tankFits anchor; x/y = window-center
  scatterCells: number                    // EXACT eligible-cell count the terrain scatter visited (the AC6 max-count ceiling, D14)
  stageIndex: number; isBoss: boolean; seed: number
}
// The 2×2 footprint predicate (D5/D9). 2 = ceil(TANK_SIZE / TILE_SIZE), a NAMED derivation, not magic.
export function tankFits(tiles: number[][], cols: number, rows: number, col: number, row: number): boolean
// The shared grid→absolute-window-center map (D13). Used by the generator to fill GridPoint.x/y AND
// re-derived by the verifier's AC8 pin (DRY): windowCenter(col,row) = { x: PLAYFIELD_X+(col+1)·TILE_SIZE,
// y: PLAYFIELD_Y+(row+1)·TILE_SIZE }. Imports PLAYFIELD_X/Y + TILE_SIZE from the PURE constants.ts.
export function windowCenter(col: number, row: number): { x: number; y: number }
// The AC7 goal predicate (D15) — true iff the tankFits window anchored at (col,row) has a footprint cell
// orthogonally adjacent to a fort-ring BRICK cell (the closest a 2×2 body parks to the eagle). Shared by
// the generator's corridor-carve TARGET + the verifier's BFS goal test (DRY) so they cannot disagree.
export function isFortApproachWindow(tiles: number[][], cols: number, rows: number, col: number, row: number, base: GridPoint): boolean
export function generateStage(seed: number, cfg: StageConfig): StageDescription
```

`tankFits` = the 2×2 window anchored at (col,row) is in-bounds + every cell tank-passable (the shared
footprint predicate the generator + verifier both use — D5/D9). `isFortApproachWindow` is the AC7 GOAL
node (D15): a `tankFits` window whose 2×2 footprint touches a fort-ring cell orthogonally — the BFS
target that provably exists (e.g. the windows anchored at (5,9)/(6,9) for the col-6 fort).

**`src/world/TileMap.ts`** (Phaser-coupled — the reference `TileMap` shape):

```ts
export class TileMap {
  scene: Phaser.Scene; desc: StageDescription
  solidBodies: Phaser.Physics.Arcade.StaticGroup   // STEEL + BASE + each BRICK sub-cell (tank-blocking)
  waterBodies: Phaser.Physics.Arcade.StaticGroup   // WATER (tank-blocking; bullets pass — later collision)
  // TREES (high-depth, bodiless) + ICE (terrain-depth, bodiless) are tracked in _objects for teardown.
  constructor(scene: Phaser.Scene, desc: StageDescription)
  destroyBrickSubCell(col: number, row: number, subCol: number, subRow: number): void  // erosion seam (later)
  destroy(): void                                  // clears every group + tracked object (no leak)
}
```

### 5.3 Algorithms

**`generateStage(seed, cfg)` — order (ONE `mulberry32(seed)` threads it):**

1. **Init grid:** a `GRID_ROWS×GRID_COLS` array filled `TILE.EMPTY` (`tiles[row][col]`). `EMPTY=0` so
   this is a zero-fill.
2. **Place the eagle BASE + fort (D4):** set the bottom-center cell to `TILE.BASE`; stamp BRICK on its
   exposed orthogonal neighbours inside the grid (the classic fort ring) — this is the enclosure AC7
   checks. Reserve the base cell + its ring in an `occupied`/`reserved` mask so the scatter never
   overwrites them.
3. **Place spawn points (D4/D13):** the three top enemy spawns (left / center / right columns, top row
   band) and the two player spawns (bottom row, flanking the base), each placed at a `tankFits` ANCHOR
   (the 2×2 footprint `[col..col+1]×[row..row+1]` all tank-passable + in-bounds); mark those footprints
   reserved. Fill each spawn's `x/y` via `windowCenter(col,row)` = the ABSOLUTE 2×2-WINDOW CENTER
   `(PLAYFIELD_X+(col+1)·TILE_SIZE, PLAYFIELD_Y+(row+1)·TILE_SIZE)` (D13 — the tank-body center, NOT
   the single-tile center), and `base.x/y` the same way. This is the ONE coordinate convention shared
   with TileMap (render) + GameScene (spawn) + the verifier (the AC8 pin).
4. **Carve guaranteed corridors to a fort-approach window (D4/D5/D15):** for each top enemy spawn, carve
   a 2-tile-wide tank-passable lane (force EMPTY) from the spawn down to a GOAL window that satisfies
   `isFortApproachWindow` — a `tankFits` window orthogonally adjacent to a fort-ring BRICK cell (e.g.
   the window anchored at (5,9) or (6,9) for the col-6 fort, whose cell (6,10) is one step above the
   fort-top brick (6,11)). Such a goal window provably EXISTS (D15) for the 13-wide grid + 2-tile
   footprint + col-6 fort; carving to it (and reserving the lane) makes the eagle REACHABLE from every
   top spawn BY CONSTRUCTION — the verifier's BFS re-proves it, never a phantom target.
5. **Seeded terrain scatter (by `cfg` densities — D14):** iterate the interior cells NOT reserved,
   COUNTING them into `scatterCells` (the exact eligible-cell total — the AC6 ceiling, D14); for each
   eligible cell draw `rng()` against the per-kind density to place AT MOST ONE of
   BRICK/STEEL/WATER/TREES/ICE (a single seeded pass, densities summing well under 1 so most cells stay
   EMPTY — a drivable battlefield). Reserved cells (base/fort/spawns/corridors) are skipped, so
   reachability + spawn validity are preserved, and since at most one tile lands per eligible cell each
   kind's realized count is provably `≤ scatterCells` (the structural ceiling the verifier asserts).
6. **Emit the `StageDescription`** (plain data): `tiles`, `base`, `enemySpawns`, `playerSpawns`,
   `scatterCells`, `stageIndex`, `isBoss`, `seed`, `cols`/`rows`/`tileSize`.

**`tankFits(tiles, cols, rows, col, row)` (D5 — the shared footprint predicate).** True iff the 2×2
window `[col..col+1]×[row..row+1]` is in-bounds AND every cell is `isTankPassable`. The footprint is
`ceil(TANK_SIZE/TILE_SIZE)` = 2 tiles (a named derivation, not a magic 2). The generator uses it to
place spawns + carve corridors; the verifier uses the SAME function for its BFS windows (DRY).

**`windowCenter(col,row)` (D13 — the shared grid→absolute-coord map).** Returns the ABSOLUTE
2×2-window center `{ x: PLAYFIELD_X+(col+1)·TILE_SIZE, y: PLAYFIELD_Y+(row+1)·TILE_SIZE }`. The
generator fills every `base`/spawn `x/y` with it; the verifier RE-derives the SAME formula for its AC8
coordinate pin (DRY) so render == verified geometry.

**Verifier BFS (AC7 — footprint-aware, RE-derived; D15).** Build the graph of tank-standable 2×2
windows (`tankFits` true) from the EMITTED `tiles` — nodes are `tankFits` anchors, edges connect
orthogonally-adjacent windows. BFS from a window at each top enemy spawn; PASS iff a GOAL window —
one satisfying `isFortApproachWindow` (a `tankFits` window whose footprint touches a fort-ring BRICK
cell orthogonally) — is reached. The goal is a WINDOW-graph node ADJACENT to the ring, NOT a single
cell next to the BASE: the base + fort ring are never tank-passable, so no `tankFits` window can
CONTAIN a base-adjacent cell; the goal-window predicate is the well-defined, provably-existent target
(D15) the corridor carve terminates at.

**`TileMap` construction (D6/D7/D8/D13).** Scan `desc.tiles` (GRID-SPACE data); each cell `(col,row)`
maps to screen via the ONE D13 convention — a tile's top-left is `(PLAYFIELD_X + col·TILE_SIZE,
PLAYFIELD_Y + row·TILE_SIZE)`, so the whole stage renders INSIDE the centered playfield, lane-aligned
with the F1 `Tank._recenterCross` origin (`PLAYFIELD_X/Y`). Per cell:
- BRICK → `SUB_CELLS²` (4) `SUB_CELL_SIZE` rectangles, each added to `solidBodies` (a static body each),
  tracked by `(col,row,subCol,subRow)` so `destroyBrickSubCell` can remove exactly one (sub-cell erosion).
- STEEL / BASE → one `TILE_SIZE` rectangle added to `solidBodies` (tank-blocking).
- WATER → one `TILE_SIZE` rectangle added to `waterBodies` (tank-blocking; tagged so bullets pass later).
- TREES → one rectangle at a HIGH depth (above tanks), NO body, tracked for teardown.
- ICE → one rectangle at terrain depth, NO body, tagged for low-friction (later), tracked.
`destroy()` mirrors the reference: `clear(true,true)` each static group + destroy it, destroy every
tracked loose object, null the array.

### 5.4 GameScene integration

`create()`:
- Pick the stage: `const cfg = stageConfig(this.stageIndex ?? 0)`; `const desc = generateStage(seed,
  cfg)` (seed from a fixed dev seed for now — the run/seed wiring is a later feature).
- `this.tileMap = new TileMap(this, desc)` — replaces the F1 four-wall `staticGroup`; renders at the
  D13 grid→screen offset so the stage sits inside the centered playfield.
- Spawn `this.p1` at `new Tank(this, desc.playerSpawns[0].x, desc.playerSpawns[0].y, 'player')`; if
  `TWO_PLAYER`, `this.p2` at `desc.playerSpawns[1].x/.y`. Those `x/y` are the ABSOLUTE 2×2-WINDOW
  CENTERS (D13), so each tank BODY (`TANK_SIZE` ≈ 2 tiles) is centered on the EXACT 2×2 footprint the
  spawn's `tankFits` cleared — the body never straddles an uncleared up-left cell (blocker #2). This
  REPLACES the F1 `PLAYFIELD_X + TILE_SIZE·n + TANK_SIZE/2` hand-math (the generator now owns it).
- Colliders: each tank ↔ `tileMap.solidBodies` AND ↔ `tileMap.waterBodies` (tank-blocking); tank ↔ tank
  (unchanged). The F1 Input + BulletPool + sample-once tick loop are UNCHANGED.
- `this.scene.launch('HUD')` (unchanged parallel overlay).

`update(_t, delta)`: UNCHANGED from F1 (dt-in-seconds clamp, sample once, fire off edge, tick tanks +
pool). (Bullet↔terrain collision is a later feature; F2's `bullets.tick` still despawns at the playfield
bounds.)

### 5.5 Integration points with existing code

- **`constants.ts`** — UNCHANGED; F2 REUSES `GRID_COLS/ROWS`, `TILE_SIZE`, `SUB_CELLS`, `SUB_CELL_SIZE`,
  `PLAYFIELD_X/Y/W/H`, `ENEMIES_PER_STAGE`, `MAX_CONCURRENT_ENEMIES`, `BOSS_STAGE_EVERY`, `TANK_SIZE`
  (the DRY anchors). No renames. Critically, the PURE generator AND the verifier both read
  `PLAYFIELD_X/Y`/`TILE_SIZE` from here (Phaser-free numbers), so the ONE coordinate convention (D13)
  — grid-space tiles + absolute 2×2-window-center coords — is anchored in a single owner; the F1
  `Tank._recenterCross` lane-snap origin (`PLAYFIELD_X/Y`, `Tank.ts:148/151`) and the TileMap render
  offset agree with it by construction.
- **`rng.ts`** — REUSED (`mulberry32`) by the generator + the verifier (UNCHANGED).
- **`GameScene.ts`** — the F1 Input/BulletPool/tank spawn/tick spine is KEPT; only the WORLD changes
  (the four test-arena walls → a `TileMap`), and the player spawn positions come from the description.
- **`verify-gen.mjs`** — the F0 rng/constants/save asserts are KEPT; the stage sweep is ADDED (the F0
  doc's promised "F2 fills in the seeded-stage sweep"). It imports the new pure modules headlessly.
- **Reserved for later:** `TileMap.destroyBrickSubCell` (the bullet×brick damage feature), the
  `waterBodies` tag + the ICE tag (bullet-over-water + ice-friction feel), `desc.enemySpawns` +
  `cfg.enemyWeights`/`totalEnemies`/`concurrentEnemies` (the enemy-spawn feature), `desc.isBoss` (the
  boss feature), `cfg`/`stageIndex` (the run-management feature).

---

## 6. Files

**New:**

- `src/config/tiles.ts` — PURE: `TILE` enum + `TILE_PROPS` table + `isTankPassable`/`isBulletPassable`/
  `isDestructible`.
- `src/config/stages.ts` — PURE: `StageConfig` + the monotone `stageConfig(stageIndex)` selector + cap
  constants.
- `src/world/LevelGenerator.ts` — PURE: `generateStage(seed, cfg) → StageDescription` + the shared
  `tankFits`/`windowCenter`/`isFortApproachWindow` predicates + the data shapes. Imports
  `PLAYFIELD_X/Y`/`TILE_SIZE`/`TANK_SIZE`/`GRID_*` from the PURE `constants.ts` (Phaser-free) to emit
  ABSOLUTE window-center coords (D13) while staying node-importable.
- `src/world/TileMap.ts` — Phaser-coupled: render + body the grid (brick sub-cells, steel/water/base
  bodies, trees overdraw, ice tag), `destroyBrickSubCell` seam, leak-free `destroy()`.

**Changed:**

- `scripts/verify-gen.mjs` — REPLACE the stub's tail: keep rng/constants/save; ADD the stage sweep
  (determinism + regression pin + bounds + eagle enclosure&reachability + spawn validity + monotonic
  `stageConfig`), importing the new pure modules. Exits non-zero on any failure.
- `src/scenes/GameScene.ts` — build the generated stage via `TileMap` (replace the F1 test arena),
  collide tanks against the TileMap bodies, spawn players at `desc.playerSpawns`.

**Unchanged:** `src/config/constants.ts`, `src/util/rng.ts`, `src/util/save.ts`, `src/core/Input.ts`,
`src/entities/Tank.ts`, `src/combat/BulletPool.ts`, `src/main.ts`, the other scenes.

---

## 7. Verification

How `typecheck`/`build`/`verify` + targeted greps + a manual drive-test prove each AC:

- **AC1 (pure tiles)** — `npm run verify` node-imports `config/tiles.ts` (a Phaser import would throw);
  it asserts `TILE_PROPS` covers every `TILE` value and the helpers read it (a small invariant pin). Grep
  `tiles.ts` for `import 'phaser'` (none).
- **AC2/AC9 (pure, monotone stages)** — `verify` node-imports `config/stages.ts`; it sweeps
  `stageConfig(0..K)` asserting every terrain density + `totalEnemies` + `concurrentEnemies` is
  non-decreasing, the NORMALIZED `hardShare(stageConfig(i)) ≤ hardShare(stageConfig(i+1))` (the EXACT
  enemy-mix monotone quantity, D16 — NOT each raw weight field), every value is within its named cap,
  `concurrentEnemies ≤ MAX_CONCURRENT_ENEMIES`, `totalEnemies ≥ concurrentEnemies`, and `isBoss`
  matches the `BOSS_STAGE_EVERY` cadence. Fails non-zero on any regression.
- **AC3/AC4 (pure deterministic generator + determinism)** — `verify` node-imports
  `world/LevelGenerator.ts`; over N seeds × the first K stages it calls `generateStage` TWICE and asserts
  element-wise deep-equal (the reused `deepEqual`). A Phaser import in the generator would throw under
  node (re-proving purity).
- **AC5 (regression pin)** — `verify` pins ONE fixed `(seed, stageIndex)` to the COMPUTED
  `StageDescription` (deep-equal); a silent generator change fails loudly.
- **AC6 (bounds)** — `verify` RE-derives from each EMITTED `desc`: `tiles` is exactly `GRID_ROWS×GRID_COLS`,
  every tile is a valid `TILE` int, the enemy total + concurrent counts are within the `stageConfig`
  bounds, and for EACH terrain kind `countOf(desc.tiles, kind) ≤ desc.scatterCells` — the explicit
  ABSOLUTE max-count ceiling (D14), provably never exceeded by the per-cell Bernoulli scatter (one tile
  max per eligible cell), so the check is reproducibly green on every seed (NOT a flaky `density·N` mean).
- **AC7 (eagle present/enclosed/reachable)** — `verify` asserts exactly one `BASE` at bottom-center;
  every in-grid orthogonal neighbour of the base that isn't base is BRICK/STEEL (enclosed); and a
  footprint-aware BFS over tank-standable 2×2 windows (`tankFits`) from a top enemy spawn reaches a GOAL
  window satisfying `isFortApproachWindow` — a `tankFits` window orthogonally ADJACENT to a fort-ring
  BRICK cell (D15, the well-defined provably-existent target — NOT a base-adjacent cell, which no
  `tankFits` window can contain). All RE-derived from the EMITTED grid.
- **AC8 (spawn validity + coordinate pin)** — `verify` asserts each of the 3 enemy + 2 player spawns is
  a `tankFits` anchor over the EMITTED tiles (full 2×2 footprint tank-passable + in-bounds), the spawns
  are distinct + in-bounds, AND each spawn's `(x,y)` (and `base.x/y`) EXACTLY equals
  `(PLAYFIELD_X+(col+1)·tileSize, PLAYFIELD_Y+(row+1)·tileSize)` — the 2×2-window-center pin (D13), so
  render == verified geometry.
- **AC10 (TileMap renders/collides/erodes)** — read `world/TileMap.ts`: BRICK builds `SUB_CELLS²` static
  sub-cell bodies with a `destroyBrickSubCell` seam; STEEL/WATER/BASE are static bodies; TREES high-depth
  bodiless; ICE bodiless. `npm run dev`: a tank stops at brick/steel/water/the base (no tunnel); grep for
  `load.` in `TileMap`/scenes (none). `destroy()` clears every group + tracked object.
- **AC11 (green gate / split / offline)** — `npm run typecheck` exits 0 (strict); `npm run build` exits
  0; `npm run verify` runs the REAL sweep + prints OK + exits 0 (non-zero on a seeded failure). The
  verifier imports ONLY pure modules (grep its imports — no `TileMap`/scene/`phaser`); `config/tiles.ts`/
  `config/stages.ts`/`world/LevelGenerator.ts` have no `import 'phaser'`. Programmer-art primitives only;
  runs from `file://`.

**Definition of done:** `npm run typecheck`, `npm run build`, and `npm run verify` all exit 0 (the
verify is the REAL sweep — determinism + pin + bounds + eagle enclosure&reachability + spawn validity +
monotonic difficulty, over N seeds × K stages); a manual `npm run dev` confirms a generated 13×13 stage
renders (brick/steel/water/trees/ice + the eagle fort), both tanks spawn flanking the base and collide
with the terrain; the pure/coupled split is preserved (the verifier imports no Phaser-coupled module).
