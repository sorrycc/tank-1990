// ── Procedural stage generator (F2 Procedural stages §5.2/§5.3, Decisions D1/D4/D5/D13/D14/D15, AC3–AC8) ──
// 100% PURE module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and asserts
// determinism + enclosure + reachability + spawn validity HEADLESSLY (the mandated convention, D1/D9). A
// successful node-import RE-PROVES its purity (a stray `import 'phaser'` here throws under node — AC11).
// Given a (seed, StageConfig) it returns a plain `StageDescription` (pure data — NO functions on it, so it
// serializes for the regression pin, AC5). The SAME (seed, cfg) is byte-identical every call because ONE
// seeded mulberry32 threads the whole generation (D1, AC4).
//
// THE CONTRACT — mirrors the reference's `generateLevel(seed, biomeConfig) → LevelDescription` 1:1,
// adapted from a wide side-scrolling platformer to a fixed 13×13 TOP-DOWN grid. The reference proves
// "entrance → exit traversable BY CONSTRUCTION" via a reach-bounded staircase walk; Tank 1990 proves
// "the eagle fort is ENCLOSED + REACHABLE from every top enemy spawn BY CONSTRUCTION" via a fort ring +
// guaranteed 2-tile-wide carved corridors (D4) — and the verifier's footprint-aware BFS re-derives it
// from the EMITTED tiles (a PROOF, not a filter-and-retry; D9).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ONE COORDINATE CONVENTION (D13 — the load-bearing geometry claim).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// `desc.tiles` is PURE GRID-SPACE data (row-major `tiles[row][col]`, TILE ints, NO pixel offset) — the
// serializable pin payload + the verifier's re-derivation source. But every `base`/spawn `x/y` is the
// ABSOLUTE 2×2-TANK-WINDOW CENTER in SCREEN coords: a tank is a `TANK_SIZE` (≈2-tile) body anchored at a
// 2×2 window, so its real body CENTER is the center of that window =
//   x = PLAYFIELD_X + (col+1)·TILE_SIZE,  y = PLAYFIELD_Y + (row+1)·TILE_SIZE
// — NOT the single-tile center `(col+0.5)·TILE_SIZE` the reference uses (Tank 1990 has a centered
// playfield offset by PLAYFIELD_X/Y + a 2-tile footprint). GameScene spawns each Tank body at (x,y), so
// the body straddles EXACTLY the 2×2 footprint `tankFits` cleared; the verifier pins the SAME formula
// (AC8). The generator imports PLAYFIELD_X/Y + TILE_SIZE from the PURE constants.ts (Phaser-free numbers),
// so emitting ABSOLUTE coords keeps the module node-importable (the verifier still re-proves purity).

import { mulberry32 } from '../util/rng.js'
import type { RNG } from '../util/rng.js'
import { GRID_COLS, GRID_ROWS, TILE_SIZE, TANK_SIZE, PLAYFIELD_X, PLAYFIELD_Y } from '../config/constants.js'
import { TILE } from '../config/tiles.js'
import { isTankPassable } from '../config/tiles.js'
import type { StageConfig } from '../config/stages.js'

// ── The tank FOOTPRINT in tiles (D5) ── `ceil(TANK_SIZE / TILE_SIZE)` = ceil(92/48) = 2. A NAMED
// derivation, NOT a magic 2: a tank spans this many tiles per side, so a "tank-standable" window is a
// FOOTPRINT×FOOTPRINT block (the reference's body-aware-clearance lesson — its 36×52 body vs. a 1-tile
// channel — applied to the grid). The generator carves corridors this wide + the verifier's BFS walks
// windows of this size, so a verifier PASS means a REAL tank reaches the base (sound, never a false pass).
export const FOOTPRINT = Math.ceil(TANK_SIZE / TILE_SIZE) // = 2 tiles.

// ── Shared data shapes (FOUNDATION exports) — TileMap + GameScene + the verifier read these. ──

// A grid anchor (the 2×2-window top-left tile) + its ABSOLUTE 2×2-window-center screen coords (D13).
export interface GridPoint {
  col: number
  row: number
  x: number // = PLAYFIELD_X + (col+1)·TILE_SIZE — the tank-body center, NOT (col+0.5)·TILE_SIZE.
  y: number // = PLAYFIELD_Y + (row+1)·TILE_SIZE.
}

// A spawn point = a GridPoint tagged with which actor spawns there. The strings are the spawn roles the
// LATER enemy-spawn + GameScene player-spawn features key off.
export interface SpawnPoint extends GridPoint {
  which: 'enemyL' | 'enemyC' | 'enemyR' | 'p1' | 'p2'
}

// The PURE stage DESCRIPTION generateStage returns — plain data (no functions) so it serializes for the
// regression pin (D10, AC5). `tiles` is GRID-SPACE (no pixel offset); base/spawn x/y are window-centers (D13).
export interface StageDescription {
  cols: number
  rows: number
  tileSize: number
  tiles: number[][] // row-major GRID-SPACE TILE ints — NO pixel offset baked in (the pin payload, D13).
  base: GridPoint // the eagle BASE cell (bottom-center); base.x/y = window-center (D13).
  enemySpawns: SpawnPoint[] // [left, center, right] — each a tankFits anchor; x/y = window-center.
  playerSpawns: SpawnPoint[] // [p1, p2] — each a tankFits anchor; x/y = window-center.
  scatterCells: number // EXACT eligible-cell count the terrain scatter visited (the AC6 max-count ceiling, D14).
  stageIndex: number
  isBoss: boolean
  seed: number
}

// ── windowCenter(col,row) (D13 — the shared grid→absolute-coord map) ── the ABSOLUTE 2×2-window CENTER
// screen coords. The generator fills every base/spawn x/y with it; the verifier RE-derives the SAME
// formula for its AC8 coordinate pin (DRY) so render == verified geometry. Imports PLAYFIELD_X/Y +
// TILE_SIZE from the PURE constants.ts (Phaser-free), so this stays node-importable.
export function windowCenter(col: number, row: number): { x: number; y: number } {
  return { x: PLAYFIELD_X + (col + 1) * TILE_SIZE, y: PLAYFIELD_Y + (row + 1) * TILE_SIZE }
}

// ── tankFits(tiles, cols, rows, col, row) → boolean (D5/D9 — the shared FOOTPRINT predicate) ── True iff
// the FOOTPRINT×FOOTPRINT (2×2) window anchored at (col,row) — spanning cols [col, col+FOOTPRINT-1] ×
// rows [row, row+FOOTPRINT-1] — is fully IN-BOUNDS and every cell is `isTankPassable`. The generator uses
// it to place spawns + carve corridors; the verifier uses the SAME function for its BFS window nodes (DRY,
// the reference's `canReachStep` pattern) — so the two check the IDENTICAL graph. PURE so both agree exactly.
export function tankFits(
  tiles: number[][],
  cols: number,
  rows: number,
  col: number,
  row: number,
): boolean {
  if (col < 0 || row < 0 || col + FOOTPRINT - 1 >= cols || row + FOOTPRINT - 1 >= rows) return false
  for (let r = row; r < row + FOOTPRINT; r++) {
    for (let c = col; c < col + FOOTPRINT; c++) {
      if (!isTankPassable(tiles[r][c])) return false
    }
  }
  return true
}

// ── isFortApproachWindow(tiles, cols, rows, col, row, base) → boolean (D15, AC7 — the BFS GOAL predicate) ──
// True iff the window anchored at (col,row) is `tankFits` AND some cell of its 2×2 footprint is
// orthogonally adjacent (Manhattan distance 1) to a fort-ring BRICK cell — the closest a 2×2 tank body can
// park to shoot the eagle. This is the AC7 GOAL node, shared by the generator's corridor-carve TARGET +
// the verifier's BFS goal test (DRY) so they cannot disagree.
//
// WHY a WINDOW adjacent to the ring, NOT a cell next to the BASE (D15): the base + every in-grid cell
// touching it are BASE/BRICK (never tank-passable), so NO tankFits window can CONTAIN a base-adjacent cell.
// The goal is therefore a window-graph NODE adjacent to the ring. Such a window provably EXISTS for the
// odd 13-wide grid + even 2-tile footprint + col-6 fort (e.g. the window anchored at (5,9): its cell (6,10)
// is one orthogonal step above the fort-top brick (6,11) — D15 enumerates the set), so the goal is
// reachable, never a phantom target.
export function isFortApproachWindow(
  tiles: number[][],
  cols: number,
  rows: number,
  col: number,
  row: number,
  base: GridPoint,
): boolean {
  if (!tankFits(tiles, cols, rows, col, row)) return false
  // The fort-ring cells = the in-grid orthogonal neighbours of the BASE that are not the base itself.
  // A footprint cell is a goal-adjacency iff it is orthogonally adjacent to one of those ring cells.
  for (let r = row; r < row + FOOTPRINT; r++) {
    for (let c = col; c < col + FOOTPRINT; c++) {
      if (isOrthAdjacentToFortRing(tiles, cols, rows, c, r, base)) return true
    }
  }
  return false
}

// True iff cell (c,r) is orthogonally adjacent to a fort-ring BRICK cell. A fort-ring cell is an in-grid
// orthogonal neighbour of the BASE that is BRICK. PURE helper shared by the goal predicate (above).
function isOrthAdjacentToFortRing(
  tiles: number[][],
  cols: number,
  rows: number,
  c: number,
  r: number,
  base: GridPoint,
): boolean {
  for (const [dc, dr] of ORTHO) {
    const nc = c + dc
    const nr = r + dr
    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
    // Is (nc,nr) a fort-ring cell? It is a BRICK cell orthogonally adjacent to the BASE.
    if (tiles[nr][nc] !== TILE.BRICK) continue
    if (Math.abs(nc - base.col) + Math.abs(nr - base.row) === 1) return true
  }
  return false
}

// The four orthogonal steps (the BFS + adjacency neighbourhood). Module-level so it isn't re-allocated.
const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

// Force the FOOTPRINT×FOOTPRINT window anchored at (col,row) to EMPTY (the corridor carve) and mark it
// reserved so the terrain scatter never overwrites it. Clamped to a valid in-bounds anchor (defensive).
function carveWindow(
  tiles: number[][],
  reserved: boolean[][],
  cols: number,
  rows: number,
  col: number,
  row: number,
): void {
  const c0 = clampInt(col, 0, cols - FOOTPRINT)
  const r0 = clampInt(row, 0, rows - FOOTPRINT)
  for (let r = r0; r < r0 + FOOTPRINT; r++) {
    for (let c = c0; c < c0 + FOOTPRINT; c++) {
      tiles[r][c] = TILE.EMPTY
      reserved[r][c] = true
    }
  }
}

// ── generateStage(seed, cfg) → StageDescription (the contract — §5.2/§5.3, AC3–AC8) ──
// PURE. ONE mulberry32(seed) threads the whole generation so the SAME (seed, cfg) is byte-identical
// (AC4). Returns plain data (no functions) so it serializes for the regression pin (AC5). Order mirrors
// §5.3: init grid → place base+fort → place spawns → carve corridors → seeded terrain scatter → emit.
export function generateStage(seed: number, cfg: StageConfig): StageDescription {
  const cols = GRID_COLS
  const rows = GRID_ROWS
  const rng: RNG = mulberry32(seed)

  // ── 1) Init grid (§5.3 step 1) ── a rows×cols array filled TILE.EMPTY (=0, a zero-fill). Row-major
  // tiles[row][col]. A parallel `reserved` mask records the base/fort/spawn/corridor cells the terrain
  // scatter must never overwrite (so reachability + spawn validity are preserved BY CONSTRUCTION — D4).
  const tiles: number[][] = []
  const reserved: boolean[][] = []
  for (let r = 0; r < rows; r++) {
    tiles.push(new Array<number>(cols).fill(TILE.EMPTY))
    reserved.push(new Array<boolean>(cols).fill(false))
  }

  // ── 2) Place the eagle BASE + fort ring (§5.3 step 2, D4) ── the bottom-center cell is BASE; its
  // EXPOSED in-grid orthogonal neighbours are stamped BRICK (the classic fort that AC7 checks is enclosed).
  // For the 13×13 grid the base is (col 6, row 12); the ring is (6,11) above + (5,12) left + (7,12) right
  // (the bottom edge needs no ring — it is the grid boundary, which the enclosure check treats as a wall).
  const baseCol = Math.floor(cols / 2) // = 6 (the odd-width center column).
  const baseRow = rows - 1 // = 12 (the bottom row).
  tiles[baseRow][baseCol] = TILE.BASE
  reserved[baseRow][baseCol] = true
  for (const [dc, dr] of ORTHO) {
    const nc = baseCol + dc
    const nr = baseRow + dr
    if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue // the bottom edge → no ring cell (the wall).
    tiles[nr][nc] = TILE.BRICK
    reserved[nr][nc] = true
  }
  const base: GridPoint = { col: baseCol, row: baseRow, ...windowCenter(baseCol, baseRow) }

  // ── 3) Place spawn points (§5.3 step 3, D4/D13) ── the three top enemy spawns (left/center/right
  // columns in the top row band) + the two player spawns (bottom row, flanking the base). Each anchor is a
  // tankFits 2×2 window: at this point the only non-EMPTY cells are the base + fort ring (rows 11–12), so
  // every chosen top-band/bottom-flank window is tank-passable by construction. We mark each footprint
  // reserved + fill its x/y via windowCenter (the ABSOLUTE 2×2-window center, D13 — the tank-body center).
  const topRow = 0 // enemy spawns anchor at row 0 (the window spans rows 0–1, the classic top spawn band).
  const enemyAnchors: Array<[SpawnPoint['which'], number]> = [
    ['enemyL', 0], // left column.
    ['enemyC', baseCol - FOOTPRINT + 1], // centered over the fort column (anchor 5 → window cols 5–6).
    ['enemyR', cols - FOOTPRINT], // right column (anchor 11 → window cols 11–12).
  ]
  const enemySpawns: SpawnPoint[] = enemyAnchors.map(([which, col]) => {
    const c = clampInt(col, 0, cols - FOOTPRINT)
    reserveWindow(reserved, cols, rows, c, topRow)
    return { which, col: c, row: topRow, ...windowCenter(c, topRow) }
  })

  // Player spawns: the bottom-row band (anchor row rows-FOOTPRINT = 11, window rows 11–12), flanking the
  // base column. P1 to the LEFT of the fort, P2 to the RIGHT — the classic player start cells. The anchors
  // are chosen clear of the fort ring (which occupies cols 5–7 on rows 11–12) so each window is tankFits.
  const playerRow = rows - FOOTPRINT // = 11 (window spans rows 11–12, the bottom band).
  const p1Col = clampInt(baseCol - FOOTPRINT - 2, 0, cols - FOOTPRINT) // left of the fort (anchor 2).
  const p2Col = clampInt(baseCol + 2, 0, cols - FOOTPRINT) // right of the fort (anchor 8).
  const playerSpawns: SpawnPoint[] = [
    { which: 'p1', col: p1Col, row: playerRow, ...windowCenter(p1Col, playerRow) },
    { which: 'p2', col: p2Col, row: playerRow, ...windowCenter(p2Col, playerRow) },
  ]
  reserveWindow(reserved, cols, rows, p1Col, playerRow)
  reserveWindow(reserved, cols, rows, p2Col, playerRow)

  // ── 4) Carve guaranteed corridors to a fort-approach goal window (§5.3 step 4, D4/D5/D15) ── for each
  // top enemy spawn carve a FOOTPRINT-wide tank-passable lane (force EMPTY + reserve) from the spawn DOWN
  // to a GOAL window that satisfies isFortApproachWindow (a tankFits window orthogonally adjacent to a
  // fort-ring brick — e.g. anchored at (5,9), whose cell (6,10) is one step above the fort-top brick
  // (6,11)). Such a goal window provably EXISTS (D15) for the 13-wide grid + 2-tile footprint + col-6 fort;
  // carving to it makes the eagle REACHABLE from every top spawn BY CONSTRUCTION — the verifier's BFS
  // re-proves it (a PROOF, never a phantom target). The goal anchor sits one footprint-row above the fort
  // ring (row baseRow - FOOTPRINT - 1 = 9) and shares the base column band so the goal adjacency holds.
  const goalRow = baseRow - FOOTPRINT - 1 // = 9 (window rows 9–10; cell at row 10 is adjacent to ring row 11).
  const goalCol = clampInt(baseCol - 1, 0, cols - FOOTPRINT) // = 5 (window cols 5–6; cell (6,10) touches (6,11)).
  for (const spawn of enemySpawns) {
    carveCorridor(tiles, reserved, cols, rows, spawn.col, spawn.row, goalCol, goalRow)
  }
  // The goal window itself must be EMPTY + reserved (the corridor terminus). carveWindow does both; it is
  // the node the verifier's BFS terminates at (isFortApproachWindow over the EMITTED tiles — D15).
  carveWindow(tiles, reserved, cols, rows, goalCol, goalRow)

  // ── 5) Seeded terrain scatter (§5.3 step 5, D14) ── iterate every NON-reserved cell, COUNTING the
  // eligible cells into `scatterCells` (the EXACT eligible-cell total — the AC6 max-count ceiling, D14);
  // for each draw ONE rng() and place AT MOST ONE of BRICK/STEEL/WATER/TREES/ICE by the per-kind densities
  // (a single seeded pass; densities sum well under 1 so most cells stay EMPTY — a drivable battlefield).
  // Reserved cells (base/fort/spawns/corridors) are skipped, so reachability + spawn validity hold (D4),
  // and since AT MOST ONE tile lands per eligible cell, each kind's realized count is provably ≤ scatterCells
  // (the structural ceiling the verifier asserts — a Bernoulli scatter can never break it, D14).
  let scatterCells = 0
  // Cumulative thresholds so a single rng() draw selects at most one kind (the bands partition [0, sum)).
  const tB = cfg.brickDensity
  const tS = tB + cfg.steelDensity
  const tW = tS + cfg.waterDensity
  const tT = tW + cfg.treesDensity
  const tI = tT + cfg.iceDensity
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (reserved[r][c]) continue // base/fort/spawn/corridor — never scattered (D4).
      scatterCells++
      const x = rng()
      if (x < tB) tiles[r][c] = TILE.BRICK
      else if (x < tS) tiles[r][c] = TILE.STEEL
      else if (x < tW) tiles[r][c] = TILE.WATER
      else if (x < tT) tiles[r][c] = TILE.TREES
      else if (x < tI) tiles[r][c] = TILE.ICE
      // else: stays EMPTY (most cells — densities sum < 1).
    }
  }

  // ── 6) Emit the plain-data StageDescription (§5.3 step 6, AC5) ── no functions on it, so it serializes
  // for the regression pin + is deep-equal-comparable for determinism (AC4/AC5).
  return {
    cols,
    rows,
    tileSize: TILE_SIZE,
    tiles,
    base,
    enemySpawns,
    playerSpawns,
    scatterCells,
    stageIndex: cfg.stageIndex,
    isBoss: cfg.isBoss,
    seed,
  }
}

// Reserve a FOOTPRINT×FOOTPRINT window without changing its tiles (used for the spawn footprints, which
// are already EMPTY at placement time — §5.3 step 3). carveWindow forces EMPTY too; this only reserves.
function reserveWindow(
  reserved: boolean[][],
  cols: number,
  rows: number,
  col: number,
  row: number,
): void {
  const c0 = clampInt(col, 0, cols - FOOTPRINT)
  const r0 = clampInt(row, 0, rows - FOOTPRINT)
  for (let r = r0; r < r0 + FOOTPRINT; r++) {
    for (let c = c0; c < c0 + FOOTPRINT; c++) reserved[r][c] = true
  }
}

// ── carveCorridor(...) (§5.3 step 4, D4/D5) ── force a FOOTPRINT-wide tank-passable lane from the spawn
// anchor (sc,sr) DOWN-then-ACROSS to the goal anchor (gc,gr), forcing every window along the path EMPTY +
// reserved. A simple L-path (vertical then horizontal) keeps the carve deterministic + 2-tile-wide BY
// CONSTRUCTION (each step carves the full FOOTPRINT window at the current anchor). This is the reference's
// "traversable BY CONSTRUCTION" stance — the verifier's footprint-aware BFS re-derives reachability from
// the EMITTED tiles (D9), never a filter-and-retry. KISS: a monotone L, no pathfinding.
function carveCorridor(
  tiles: number[][],
  reserved: boolean[][],
  cols: number,
  rows: number,
  sc: number,
  sr: number,
  gc: number,
  gr: number,
): void {
  let c = clampInt(sc, 0, cols - FOOTPRINT)
  let r = clampInt(sr, 0, rows - FOOTPRINT)
  const tc = clampInt(gc, 0, cols - FOOTPRINT)
  const tr = clampInt(gr, 0, rows - FOOTPRINT)
  // Carve the start window, then walk vertically toward the goal row, then horizontally to the goal col,
  // carving the full FOOTPRINT window at every anchor. Adjacent windows overlap (a 1-tile step), so the
  // carved channel is continuously FOOTPRINT-wide — a real 2×2 tank can drive its whole length.
  carveWindow(tiles, reserved, cols, rows, c, r)
  while (r !== tr) {
    r += r < tr ? 1 : -1
    carveWindow(tiles, reserved, cols, rows, c, r)
  }
  while (c !== tc) {
    c += c < tc ? 1 : -1
    carveWindow(tiles, reserved, cols, rows, c, r)
  }
}
