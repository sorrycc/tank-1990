# Tank 1990 — Feel + balance (grid-snap + enemy pressure for the larger 17×17 board)

> Design doc for a small FEEL + BALANCE pass on the finished Tank 1990 (a faithful Battle City /
> 坦克大战 clone). It follows the project conventions: a STRICT pure/coupled split (`config/*` +
> `world/LevelGenerator.ts` import NO Phaser and are node-imported by `scripts/verify-gen.mjs`), shared
> numbers owned ONCE in `config/constants.ts` (DRY), programmer-art primitives only, all UI via
> `t(...)`. It ships NO new feature, NO new module: it RETUNES two surfaces — the F1 turn-time lane-snap
> (so the ~1-tile tank ends cleanly CENTERED in a 1-tile corridor on the 40px grid) and the stage
> enemy-pressure ramps (so the 17×17 / 6-concurrent board feels right) — keeping the verifier GREEN.

---

## 1. Problem

The board grew to the classic 17×17 (289 cells) with a 6-tank concurrent cap, and the tank is now a
~1-tile body (`TANK_SIZE = TILE_SIZE − 4 = 36 px` on 40px tiles). Two feel/balance surfaces drift on
the larger board:

- **Turn-time lane-snap is mis-targeted for a 1-tile tank.** `Tank._recenterCross` snaps the body's
  CROSS CORNER to the nearest `SUB_CELL_SIZE` (20px) lattice point. That lattice was right when the
  tank moved on the 20px sub-cell grid, but corridors are now FOOTPRINT = 1 = WHOLE tiles (40px). The
  clean centered position for a 36px body in a 40px corridor tile is its window center — corner at
  `origin + tileIndex·40 + 2` (a 2px inset each side). The 20px lattice's nearest point is the tile
  EDGE (`origin + tileIndex·40`, a 2px error) just as often as the inset position, so after a turn the
  tank can settle 2px off-center in its lane — it grazes one wall of a 1-tile corridor and steering
  reads slightly soft. The 0.5px dead-band can't absorb a 2px error.

- **Enemy pressure ramps too gently for the bigger board.** The concurrent cap reaches its max (6)
  only at stage 20 (`+1 every 4 stages` from a base of 1), and `totalEnemies` starts at 20. On a board
  with 6 concurrent slots and far more room, the early-stage pressure under-uses the board.

## 2. Decisions

- **D1 — Snap the cross corner to the TILE lattice OFFSET by the body inset, not the 20px sub-cell
  lattice.** The clean lane-aligned corner for a 1-tile tank is `origin + laneInset + k·TILE_SIZE`,
  where `laneInset = (TILE_SIZE − TANK_SIZE)/2 = 2px` (the centered-in-tile inset — the SAME value the
  generator's `windowCenter` produces, so a snapped tank lands EXACTLY on a spawn/corridor window
  center). This is the minimal change that makes "a 36px body centers with a 2px inset" literally true.
  It KEEPS the no-diagonal invariant (still a cross-axis-only discrete write, cross velocity stays 0)
  and the "Arcade owns the body" discipline (still the ONE gated turn-frame write — no new per-frame
  position writes). `LANE_INSET` is DERIVED from the existing owners (`TILE_SIZE`/`TANK_SIZE`) so the
  number lives once (DRY). `SUB_CELL_SIZE` stays the brick-rendering owner; it is just no longer the
  tank lane pitch.
- **D2 — Keep a tight dead-band.** With the corner now snapping to the exact centered position,
  `LANE_SNAP_EPSILON` stays sub-pixel (0.5px) — small enough that a real 2px misalignment after a turn
  is always corrected, large enough that an already-aligned tank never oscillates. No change needed; it
  is correct against the new (tile-inset) target.
- **D3 — Reach 6 concurrent enemies sooner + a slightly higher total ramp, MONOTONICITY-PRESERVING.**
  `CONCURRENT_PER_STAGES 4 → 3` (the concurrent cap of 6 is reached by stage 15 instead of 20 — still a
  gentle non-decreasing climb from 1, still clamped to `MAX_CONCURRENT_ENEMIES`). `TOTAL_ENEMIES_PER_STAGE
  1 → 2` (the clear-count climbs a touch faster toward the unchanged `TOTAL_ENEMIES_MAX = 40`). Both are
  `min(cap, base + k·s)` with k > 0 → still provably non-decreasing and bounded by their existing caps —
  the verifier's monotonicity + cap sweep stays green. No cap, density, hardShare, bullet/spawn-scale, or
  boss-cadence ramp changes (those were tuned for the bigger board already).

## 3. Per-file changes

- **`src/config/constants.ts`** — ADD `LANE_INSET` (DERIVED: `(TILE_SIZE − TANK_SIZE)/2`) beside
  `LANE_SNAP_EPSILON`, the new tank lane-snap pitch anchor; refresh the `LANE_SNAP_EPSILON` comment to
  describe the tile-inset target. PURE (no Phaser) — still node-imported by the verifier.
- **`src/entities/Tank.ts`** — `_recenterCross` snaps the corner to `origin + LANE_INSET + round((corner
  − origin − LANE_INSET)/TILE_SIZE)·TILE_SIZE` (the tile lattice offset by the body inset) instead of the
  20px sub-cell lattice. Import `LANE_INSET` + `TILE_SIZE`; drop the now-unused `SUB_CELL_SIZE` import.
  Update the §5.3 step-4 + `_recenterCross` comments that say "nearest SUB_CELL_SIZE (20px) lane".
  No other movement code changes — the no-diagonal spine + the single gated write are byte-identical.
- **`src/config/stages.ts`** — `CONCURRENT_PER_STAGES 4 → 3`, `TOTAL_ENEMIES_PER_STAGE 1 → 2` (the two
  enemy-count ramp constants). PURE — node-imported by the verifier.

## 4. Verification

- `npm run typecheck` — strict TS clean (the dropped `SUB_CELL_SIZE` import + the new `LANE_INSET` /
  `TILE_SIZE` imports type-check; `LANE_INSET` is a `number`).
- `npm run verify` — the stage sweep RE-derives monotonicity (densities, counts incl.
  `concurrentEnemies`/`totalEnemies`, hardShare, bullet/spawn scales) + the named caps over
  `stageConfig(0..30)`; the two ramp tweaks stay `min(cap, base + k·s)` with k > 0, so the sweep stays
  green (concurrent still ≤ `MAX_CONCURRENT_ENEMIES`, total still ≤ `TOTAL_ENEMIES_MAX`). The
  regression pin is INDEPENDENT of the Tank (never imported) + of the enemy COUNTS (the pin asserts the
  emitted tile grid + spawn/base coords + scatterCells + motif, none of which the count ramps touch), so
  it is unaffected. `Tank.ts` is Phaser-coupled + never verifier-imported, so the lane-snap change is
  proved by typecheck + the manual drive, not the headless gate.
- `npm run build` — Vite production build clean.
- Manual (`npm run dev`): drive a tank into a 1-tile corridor and turn repeatedly — it settles centered
  in the lane (no wall-graze drift); enemies build to 6 on-screen by the mid stages.
