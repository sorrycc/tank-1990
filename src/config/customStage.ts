// ── Custom-stage seam (construction-mode §2/§5, Decision D1/D5) ──
// PURE module — NO Phaser import — so scripts/verify-gen.mjs node-imports it under plain node and asserts its
// round-trip HEADLESSLY (a stray `import 'phaser'` here would throw under node — re-proving purity, the same
// convention config/* + world/LevelGenerator.ts keep). It is the ONE clean seam the Construction (level editor)
// feature feeds into GameScene: it takes a hand-painted `number[][]` tile grid and returns the SAME
// `StageDescription` shape the PROCEDURAL `generateStage(seed, cfg)` returns — so the WHOLE downstream
// (TileMap render + the eagle wiring + the player/enemy spawns + the entire F3 combat spine) is reused with NO
// new gameplay branch (DRY/SOLID — GameScene gets a StageDescription whether the stage is procedural or authored).
//
// THE CONTRACT (D1): given ANY 17×17 grid it returns a TOTAL, VALID StageDescription —
//   • `tiles` is the grid itself (GRID-SPACE row-major TILE ints — the SAME convention generateStage emits, D13).
//   • `base` is derived from the SINGLE BASE cell the player painted (the editor keeps at most one — D5); if none
//     was painted it defaults to the generator's bottom-center `(floor(cols/2), rows-1)`, so an un-authored eagle
//     is still PLAYABLE (defensive — the eagle wiring never crashes).
//   • `enemySpawns` (3, top band) + `playerSpawns` (2, bottom band) are placed EXACTLY like generateStage's
//     steps 2–3 (the SAME `windowCenter`/`FOOTPRINT` math — DRY), so spawns land where the procedural path puts
//     them and read as valid tankFits anchors over the EMITTED grid (the verifier re-derives it).
//   • `seed` is a fixed sentinel, `isBoss` false, `motif: 'custom'`, `scatterCells` = the grid's non-base cell
//     count (the same "eligible cells" ceiling field — purely informational for an authored grid; no scatter ran).
//
// CRITICAL: the PURE procedural generator is BYTE-UNTOUCHED — this is a SEPARATE function, so the determinism +
// procedural-stage verifier gates run on the unchanged generateStage and stay green by construction (§5).

import { GRID_COLS, GRID_ROWS, TILE_SIZE } from './constants.js'
import { TILE } from './tiles.js'
import { windowCenter, FOOTPRINT } from '../world/LevelGenerator.js'
import type { StageDescription, GridPoint, SpawnPoint } from '../world/LevelGenerator.js'

// ── CUSTOM_STAGE_SEED (D1) ── the fixed sentinel seed a custom stage carries on its description. An authored
// stage has NO procedural seed (no scatter ran), but the StageDescription shape requires the field; a stable
// recognizable constant keeps the description trivially serializable + deterministic. Never feeds a generator
// draw (buildCustomStage runs no RNG) — it is metadata only.
export const CUSTOM_STAGE_SEED = 0xc0570de // a fixed recognizable sentinel ("CUSTOM"-ish) — the authored-stage seed.

// ── CUSTOM_MOTIF (D1) ── the motif id a custom stage reports. It is NOT one of the procedural STAGE_MOTIFS (no
// seeded scatter shaped it), so the value is purely cosmetic metadata; the verifier asserts the procedural
// descriptions carry a known motif but does NOT route a custom grid through that check (it drives buildCustomStage
// on its OWN assertions — §5). A distinct string makes an authored stage self-identifying in any debug dump.
export const CUSTOM_MOTIF = 'custom'

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

// ── buildCustomStage(grid) → StageDescription (D1/D5) ── PURE + TOTAL. Mirrors generateStage's steps 2–3 for the
// base + spawn placement (reusing windowCenter/FOOTPRINT — DRY) but takes the TERRAIN from the hand-painted grid
// instead of a seeded scatter. The grid is consumed AS-IS for `tiles` (the editor already validated dims + cell
// values via util/customMap.ts; this function additionally finds the base + clamps the spawn anchors defensively,
// so even a raw grid yields a sane description — never throws).
export function buildCustomStage(grid: number[][]): StageDescription {
  const cols = GRID_COLS
  const rows = GRID_ROWS

  // ── 1) The base = the single painted BASE cell (D5) ── scan the grid for a TILE.BASE; the editor keeps at most
  // one, so the FIRST one found IS the eagle. If none was painted, default to the generator's bottom-center
  // `(floor(cols/2), rows-1)` (so an un-authored map is still PLAYABLE — the eagle wiring never sees a null base).
  let baseCol = Math.floor(cols / 2)
  let baseRow = rows - 1
  let foundBase = false
  for (let r = 0; r < rows && !foundBase; r++) {
    for (let c = 0; c < cols && !foundBase; c++) {
      if (grid[r]?.[c] === TILE.BASE) {
        baseCol = c
        baseRow = r
        foundBase = true
      }
    }
  }
  const base: GridPoint = { col: baseCol, row: baseRow, ...windowCenter(baseCol, baseRow) }

  // ── 2) Enemy spawns (3 — the top band, left/center/right columns, like generateStage step 3) ── each anchor is
  // a FOOTPRINT window in the top row; x/y = the ABSOLUTE window center (D13). Clamped to a valid in-bounds anchor
  // (defensive — the editor's grid is always 17 wide, so the clamps are no-ops, but they keep the function total).
  const topRow = 0
  const enemyAnchors: Array<[SpawnPoint['which'], number]> = [
    ['enemyL', 0], // left column.
    ['enemyC', baseCol - FOOTPRINT + 1], // centered over the painted base column.
    ['enemyR', cols - FOOTPRINT], // right column.
  ]
  const enemySpawns: SpawnPoint[] = enemyAnchors.map(([which, col]) => {
    const c = clampInt(col, 0, cols - FOOTPRINT)
    return { which, col: c, row: topRow, ...windowCenter(c, topRow) }
  })

  // ── 3) Player spawns (2 — the bottom band, flanking the base column, like generateStage step 3) ── P1 to the
  // left of the eagle, P2 to the right. The SAME anchor math the procedural path uses (DRY).
  const playerRow = rows - FOOTPRINT
  const p1Col = clampInt(baseCol - FOOTPRINT - 2, 0, cols - FOOTPRINT)
  const p2Col = clampInt(baseCol + 2, 0, cols - FOOTPRINT)
  const playerSpawns: SpawnPoint[] = [
    { which: 'p1', col: p1Col, row: playerRow, ...windowCenter(p1Col, playerRow) },
    { which: 'p2', col: p2Col, row: playerRow, ...windowCenter(p2Col, playerRow) },
  ]

  // ── 4) scatterCells (D1) ── the non-base eligible-cell count (informational only — no scatter ran on an
  // authored grid). Keeping the field populated keeps the description shape identical to the procedural one.
  let scatterCells = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r]?.[c] !== TILE.BASE) scatterCells++
    }
  }

  // ── 5) Emit the plain-data StageDescription (the SAME shape generateStage returns — D1) ── stageIndex 0 (the
  // custom grid seeds the FIRST stage of the run; advance() then chains the procedural generator — D7), isBoss
  // false, the sentinel seed + the 'custom' motif metadata.
  return {
    cols,
    rows,
    tileSize: TILE_SIZE,
    tiles: grid,
    base,
    enemySpawns,
    playerSpawns,
    scatterCells,
    stageIndex: 0,
    isBoss: false,
    seed: CUSTOM_STAGE_SEED,
    motif: CUSTOM_MOTIF,
  }
}
