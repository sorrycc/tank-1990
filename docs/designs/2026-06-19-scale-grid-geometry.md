# Tank 1990 — Scale & grid geometry (17×17 board, 1-tile tank)

> A small, surgical GEOMETRY pass over the finished Tank 1990. It does NOT add a feature — it re-scales
> the world so the battlefield is BIGGER (more tiles) and the tank is ~ONE tile (the classic Battle City
> proportion), instead of the current 2-tile body on a 13×13 board. Format mirrors the existing design
> docs (problem → decisions → per-file changes → verification), trimmed to a re-scale's altitude.

---

## 1. Problem

The current geometry was chosen in F0/F1 and never revisited:

- The board is **13×13** tiles at **48 px** = a 624 px square playfield.
- The tank body is **TANK_SIZE = TILE_SIZE·2 − 4 = 92 px** — a **2-tile** body (`FOOTPRINT =
  ceil(92/48) = 2`). So a tank occupies a 2×2 window, the generator carves 2-wide corridors, and the
  verifier's reachability BFS walks 2×2 windows.

This reads wrong against the classic: in Battle City the player tank is roughly ONE tile, and the
battlefield is a larger grid of SMALLER tiles. A 2-tile tank on a 13×13 board feels cramped and the
tank looks oversized.

The fix is a re-scale, NOT a rewrite: make the tank ~1 tile and grow the board to 17×17 — and the
"bigger battlefield" comes from MORE tiles, not bigger tiles (so each tile shrinks 48 → 40).

The single owner of these numbers is `src/config/constants.ts` (DRY); the generator + the verifier are
already **FOOTPRINT-parameterized**, so once the constants change and `windowCenter` is made
footprint-aware, the carve/spawn/BFS math adapts on its own.

---

## 2. Decisions

- **D1 — 17×17 board from MORE, SMALLER tiles.** `GRID_COLS/ROWS = 17` (was 13), `TILE_SIZE = 40`
  (was 48). The playfield becomes 17·40 = **680 px** square — larger than the old 624, yet it still
  fits the FIXED 1280×720 design resolution beside the 256 px HUD panel (680 + 32 gap + 256 = 968 ≤
  1280; 680 ≤ 720). `PLAYFIELD_W/H/X/Y` + `HUD_PANEL_X` are all DERIVED, so they recompute sanely
  (X = 156, Y = 20). `SUB_CELL_SIZE` derives to 40/2 = **20** (was 24).
- **D2 — The tank is ~1 tile → `FOOTPRINT = 1`.** `TANK_SIZE = TILE_SIZE − 4 = 36` (a hair inset so
  adjacent-lane colliders don't graze). `FOOTPRINT = ceil(36/40) = 1` (was 2). A tank now occupies a
  single tile; the generator's spawn/carve windows + the verifier's BFS windows are 1×1.
- **D3 — `windowCenter` becomes FOOTPRINT-aware (the load-bearing geometry change).** The old map baked
  the 2-tile footprint as `(col+1)·TILE_SIZE`. The general form is the CENTER of the FOOTPRINT×FOOTPRINT
  window: `x = PLAYFIELD_X + (col + FOOTPRINT/2)·TILE_SIZE`, `y = PLAYFIELD_Y + (row + FOOTPRINT/2)·
  TILE_SIZE`. At FOOTPRINT=1 that is the single-tile center `(col+0.5)·TILE_SIZE`; at the old FOOTPRINT=2
  it reduces to the old `(col+1)·TILE_SIZE` — so the formula is correct for BOTH (no regression in
  meaning, just generalized). The verifier re-derives the SAME formula (DRY), so render == verified.
- **D4 — The corridor goal column is `baseCol`, not `baseCol − 1`.** At FOOTPRINT=1 the fort-approach
  goal must be the single cell directly above the top fort-ring brick at `(baseCol, baseRow−1)` — i.e.
  the window anchored at `(baseCol, baseRow−2)`, whose cell touches the ring brick. `baseCol` is the
  correct goal column for FOOTPRINT 1 AND for the old FOOTPRINT 2 (the 2×2 window at `(baseCol, …)`
  still contained a ring-adjacent cell), so the change is safe across footprints. `isFortApproachWindow`
  still finds the goal — the verifier's BFS PROVES it.
- **D5 — `MAX_CONCURRENT_ENEMIES = 6` (was 4).** The larger board affords more on-screen pressure; the
  stage difficulty selector already clamps `concurrentEnemies ≤ MAX_CONCURRENT_ENEMIES`, and the
  verifier's monotonicity sweep re-checks the bound, so lifting the cap is a one-line data change.
- **D6 — The regression pin RE-PINS to the legitimately-changed geometry.** The pinned stage's tile
  grid (17×17 now), `scatterCells`, base/spawn anchors, and window-center coords all change with the new
  board/footprint. The pin is RE-COMPUTED from the REAL `generateStage` output (never hand-invented),
  exactly as the D10 pin discipline requires; NO check is weakened or removed.
- **D7 — Smaller tank visual.** `Tank.BARREL_THICK = 6` (was 8) to match the smaller body; `BARREL_LEN`
  already auto-scales from `TANK_SIZE` (0.55·36 ≈ 19.8). The turn-time lane-snap reads `SUB_CELL_SIZE`
  (now 20) and auto-adapts — NO movement-logic change.

---

## 3. Per-file changes

- **`src/config/constants.ts` (PURE):** `GRID_COLS/ROWS 13 → 17`; `TILE_SIZE 48 → 40`; `TANK_SIZE =
  TILE_SIZE − 4` (= 36); `MAX_CONCURRENT_ENEMIES 4 → 6`. `SUB_CELL_SIZE` derives to 20; `PLAYFIELD_*` /
  `HUD_PANEL_X` recompute from the derivations. Rewrite the stale comments (the grid header, `TILE_SIZE`,
  `PLAYFIELD_W/H`, and the `TANK_SIZE` block — drop the "2-tile body (92)" / "not a multiple of SUB_CELL"
  notes).
- **`src/world/LevelGenerator.ts` (PURE):** `windowCenter` → footprint-aware (D3); update the D13 header
  comment + the `GridPoint.x/y` field comments (drop the "(col+1)·TILE_SIZE, NOT (col+0.5)" claim — now
  the footprint-aware center). Corridor `goalCol = clampInt(baseCol, …)` (D4). Refresh the `FOOTPRINT`
  derivation comment (`ceil(36/40)=1`), the 13×13 mentions, and the base/goal worked-example numbers to
  the 17×17 grid. All other FOOTPRINT-derived spawn/carve math is already parameterized — unchanged.
- **`scripts/verify-gen.mjs`:** the hardcoded `13x13` constants assertion → `17x17`; the window-center
  re-derivation → the FOOTPRINT-aware formula (FOOTPRINT is already imported); RE-PIN the D10 block
  (`PIN_TILES`/`PIN_SCATTER`/`PIN_BASE`/`PIN_ENEMY`/`PIN_PLAYER` to the new geometry — computed from the
  real output). No check weakened.
- **`src/entities/Tank.ts`:** `BARREL_THICK 8 → 6`; refresh the stale comments mentioning `TANK_SIZE=92`
  and the "24 px lane" (now 20 px). The lane-snap reads `SUB_CELL_SIZE` — no logic change.

---

## 4. Verification

- **`npm run typecheck`** (strict) — exits 0 (all changed numbers are typed constants; no shape change).
- **`npm run verify`** — exits 0 / prints OK. It re-derives EVERY invariant from the EMITTED tiles for
  the new geometry: the constants assertion now reports **17×17**; the spawn/base window-center pin uses
  the FOOTPRINT-aware formula; the footprint-aware reachability BFS (now over 1×1 windows) reaches the
  fort from every top spawn for all 200 seeds × 7 stages; the enclosure + scatter-ceiling checks hold;
  the RE-PINNED D10 block deep-equals the real output. The closing report prints `FOOTPRINT=1`.
- **`npm run build`** — Vite build exits 0.
- The PURE/COUPLED split is untouched: `constants.ts` + `LevelGenerator.ts` import NO Phaser and stay
  node-importable by the verifier (a stray Phaser import would throw under node).
