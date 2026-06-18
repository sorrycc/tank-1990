// ── Procedural stage generator (F2 Procedural stages §5.2/§5.3, Decisions D1/D4/D5/D13/D14/D15, AC3–AC8) ──
// 100% PURE module — NO Phaser import — so scripts/verify-gen.mjs imports it under plain node and asserts
// determinism + enclosure + reachability + spawn validity HEADLESSLY (the mandated convention, D1/D9). A
// successful node-import RE-PROVES its purity (a stray `import 'phaser'` here throws under node — AC11).
// Given a (seed, StageConfig) it returns a plain `StageDescription` (pure data — NO functions on it, so it
// serializes for the regression pin, AC5). The SAME (seed, cfg) is byte-identical every call because ONE
// seeded mulberry32 threads the whole generation (D1, AC4).
//
// THE CONTRACT — mirrors the reference's `generateLevel(seed, biomeConfig) → LevelDescription` 1:1,
// adapted from a wide side-scrolling platformer to a fixed 17×17 TOP-DOWN grid. The reference proves
// "entrance → exit traversable BY CONSTRUCTION" via a reach-bounded staircase walk; Tank 1990 proves
// "the eagle fort is ENCLOSED + REACHABLE from every top enemy spawn BY CONSTRUCTION" via a fort ring +
// guaranteed FOOTPRINT-wide carved corridors (D4) — and the verifier's footprint-aware BFS re-derives it
// from the EMITTED tiles (a PROOF, not a filter-and-retry; D9).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ONE COORDINATE CONVENTION (D13 — the load-bearing geometry claim).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// `desc.tiles` is PURE GRID-SPACE data (row-major `tiles[row][col]`, TILE ints, NO pixel offset) — the
// serializable pin payload + the verifier's re-derivation source. But every `base`/spawn `x/y` is the
// ABSOLUTE FOOTPRINT×FOOTPRINT-TANK-WINDOW CENTER in SCREEN coords: a tank is a `TANK_SIZE` body anchored
// at a FOOTPRINT×FOOTPRINT window, so its real body CENTER is the center of that window =
//   x = PLAYFIELD_X + (col + FOOTPRINT/2)·TILE_SIZE,  y = PLAYFIELD_Y + (row + FOOTPRINT/2)·TILE_SIZE
// — the FOOTPRINT-aware window center (at FOOTPRINT=1 the single-tile center `(col+0.5)·TILE_SIZE`; the
// PLAYFIELD_X/Y offset accounts for the centered playfield). GameScene spawns each Tank body at (x,y), so
// the body straddles EXACTLY the footprint `tankFits` cleared; the verifier pins the SAME formula (AC8).
// The generator imports PLAYFIELD_X/Y + TILE_SIZE from the PURE constants.ts (Phaser-free numbers), so
// emitting ABSOLUTE coords keeps the module node-importable (the verifier still re-proves purity).

import { mulberry32 } from '../util/rng.js'
import type { RNG } from '../util/rng.js'
import { GRID_COLS, GRID_ROWS, TILE_SIZE, TANK_SIZE, PLAYFIELD_X, PLAYFIELD_Y } from '../config/constants.js'
import { TILE } from '../config/tiles.js'
import { isTankPassable } from '../config/tiles.js'
import type { StageConfig } from '../config/stages.js'

// ── The tank FOOTPRINT in tiles (D5) ── `ceil(TANK_SIZE / TILE_SIZE)` = ceil(36/40) = 1. A NAMED
// derivation, NOT a magic number: a tank spans this many tiles per side, so a "tank-standable" window is
// a FOOTPRINT×FOOTPRINT block (the reference's body-aware-clearance lesson — its 36×52 body vs. a 1-tile
// channel — applied to the grid). The generator carves corridors this wide + the verifier's BFS walks
// windows of this size, so a verifier PASS means a REAL tank reaches the base (sound, never a false pass).
export const FOOTPRINT = Math.ceil(TANK_SIZE / TILE_SIZE) // = 1 tile.

// ── Shared data shapes (FOUNDATION exports) — TileMap + GameScene + the verifier read these. ──

// A grid anchor (the FOOTPRINT×FOOTPRINT-window top-left tile) + its ABSOLUTE window-center screen coords (D13).
export interface GridPoint {
  col: number
  row: number
  x: number // = PLAYFIELD_X + (col + FOOTPRINT/2)·TILE_SIZE — the FOOTPRINT-aware tank-body center.
  y: number // = PLAYFIELD_Y + (row + FOOTPRINT/2)·TILE_SIZE.
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
  motif: string // F7 (D1/D2) — the seed-chosen layout MOTIF id (one of STAGE_MOTIFS) that shaped the scatter.
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// ── F7 STAGE MOTIFS (F7 Rich playability §5.2, Decisions D1/D2, AC1/AC2/AC3) ──────────────────────────────
// The seed-chosen LAYOUT VARIETY, mirroring the read-only reference's `LAYOUT_TEMPLATES`/`selectTemplate`/
// `tplRng` idiom EXACTLY (its `['staircase','shaft','islands']` off an off-the-main-thread sub-RNG). Tank
// 1990's 17×17 grid has a STRUCTURALLY-REQUIRED reachable enclosed fort, so a per-motif *builder* would risk
// the reachability/enclosure proofs the verifier depends on (D1). Instead the MOTIF parameterizes ONLY the
// step-5 terrain SCATTER over the NON-RESERVED cells: it reshapes the EMPTY/BRICK/STEEL *bias* of those cells
// WITHOUT touching any reserved base/fort/spawn/corridor cell — so enclosure + reachability + the
// `scatterCells` ceiling hold BY CONSTRUCTION (the verifier re-proves them generically for every motif).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════

// ── MOTIF_SALT (D2) ── the OFF-THE-MAIN-THREAD motif sub-RNG salt (the reference's `seed ^ 0x7e3415a7`). The
// motif pick draws from `mulberry32((seed ^ MOTIF_SALT) >>> 0)` — a SEPARATE stream from the main scatter
// `rng`, so the main draw SEQUENCE is structurally unchanged (the scatter still draws ONE rng() per eligible
// cell). A fixed seed stays byte-deterministic (the sub-RNG is seeded from the same seed). A NAMED constant.
export const MOTIF_SALT = 0x5a17b00c

// ── STAGE_MOTIFS (D1, AC1) ── the known motif ids (the reference's LAYOUT_TEMPLATES shape). The verifier
// asserts every emitted `desc.motif` is one of these AND that the sweep exercises ≥ 2 of them (no dead shape).
export const STAGE_MOTIFS: string[] = ['open', 'fortress', 'maze', 'corridors']

// ── MotifParams (D1) ── the per-motif scatter shaping. `brickMul`/`steelMul` SCALE the stage's base
// brick/steel densities (so `open` thins the walls, `fortress` thickens them). `lattice` (maze) biases BRICK
// on even interior cells; `bands` (corridors) biases BRICK on alternating interior columns. The shaping always
// keeps the scatter to ONE rng() draw + AT MOST one placed tile per non-reserved cell (so `scatterCells`
// counting + the ≤ ceiling hold unchanged, D2). PLAIN data (no functions) so it serializes + the verifier reads it.
export interface MotifParams {
  brickMul: number // multiplier on cfg.brickDensity for this motif's NON-reserved cells.
  steelMul: number // multiplier on cfg.steelDensity for this motif's NON-reserved cells.
  lattice?: boolean // maze: BRICK-bias every even interior cell (a brick lattice reads "latticed").
  bands?: boolean // corridors: BRICK-bias alternating interior columns (reads "banded").
}

// ── MOTIF_PARAMS (D1) ── the motif → params table. The multipliers are chosen so NO motif drives the
// effective brick+steel band past 1 (the bands still partition [0,1)); the lattice/band BRICK bias only LIFTS
// the brick propensity of selected cells toward (but not over) a capped maximum — the scatter still places AT
// MOST one tile per cell. The reserved-cell skip is unchanged, so a motif can NEVER touch a base/fort/spawn/
// corridor cell — enclosure + reachability hold BY CONSTRUCTION for every motif (D1/AC2).
export const MOTIF_PARAMS: Record<string, MotifParams> = {
  open: { brickMul: 0.45, steelMul: 0.5 }, // sparser walls — an OPEN battlefield reads roomy.
  fortress: { brickMul: 1.7, steelMul: 1.8 }, // denser brick/steel walls — a WALLED fortress reads heavy.
  maze: { brickMul: 1.0, steelMul: 1.0, lattice: true }, // a brick LATTICE over even interior cells reads maze-y.
  corridors: { brickMul: 1.0, steelMul: 1.0, bands: true }, // BRICK BANDS on alternating cols read as corridors.
}

// ── DEFAULT_MOTIF_WEIGHTS (D1/D7) ── the shared motif mix `selectMotif` weights its seeded pick over when a
// stage carries no `motifWeights` override (the reference's DEFAULT_LAYOUT_WEIGHTS). `open` keeps the highest
// weight (the readable baseline); the other three add spatial surprise. The sweep proves ≥ 2 appear (AC1).
const DEFAULT_MOTIF_WEIGHTS: { id: string; w: number }[] = [
  { id: 'open', w: 3 },
  { id: 'fortress', w: 2 },
  { id: 'maze', w: 2 },
  { id: 'corridors', w: 2 },
]

// ── selectMotif(seed, cfg) → a motif id (D1/D2, AC1/AC3) ── a PURE weighted pick over the stage's
// `motifWeights` (or the shared DEFAULT_MOTIF_WEIGHTS) OFF the OFF-THE-MAIN-THREAD motif sub-RNG
// `mulberry32((seed ^ MOTIF_SALT) >>> 0)` — so the MAIN scatter draw sequence is untouched (D2). The
// reference's `selectTemplate` body verbatim in shape. TOTAL: an all-zero-weights roster falls through to the
// last id (never undefined — the reference's float-rounding fallback), and an unknown override id is tolerated
// (it just may not match MOTIF_PARAMS — generateStage falls back to a neutral params lookup, defensive).
export function selectMotif(seed: number, cfg: StageConfig): string {
  const rng: RNG = mulberry32((seed ^ MOTIF_SALT) >>> 0) // the off-the-main-thread sub-RNG (D2).
  const weights = cfg.motifWeights && cfg.motifWeights.length ? cfg.motifWeights : DEFAULT_MOTIF_WEIGHTS
  const total = weights.reduce((s, e) => s + (e.w || 0), 0)
  if (total <= 0) return weights[weights.length - 1].id // all-zero weights → the last id (the total fallback).
  let r = rng() * total
  for (const entry of weights) {
    r -= entry.w || 0
    if (r <= 0) return entry.id
  }
  return weights[weights.length - 1].id // float-rounding fallthrough → the last id (KISS, the reference's fallback).
}

// ── windowCenter(col,row) (D13 — the shared grid→absolute-coord map) ── the ABSOLUTE FOOTPRINT×FOOTPRINT
// -window CENTER screen coords: PLAYFIELD_X/Y + (col/row + FOOTPRINT/2)·TILE_SIZE. At FOOTPRINT=1 that is
// the single-tile center; it generalizes to any footprint. The generator fills every base/spawn x/y with
// it; the verifier RE-derives the SAME formula for its AC8 coordinate pin (DRY) so render == verified
// geometry. Imports PLAYFIELD_X/Y + TILE_SIZE from the PURE constants.ts (Phaser-free), so this stays
// node-importable.
export function windowCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: PLAYFIELD_X + (col + FOOTPRINT / 2) * TILE_SIZE,
    y: PLAYFIELD_Y + (row + FOOTPRINT / 2) * TILE_SIZE,
  }
}

// ── tankFits(tiles, cols, rows, col, row) → boolean (D5/D9 — the shared FOOTPRINT predicate) ── True iff
// the FOOTPRINT×FOOTPRINT window anchored at (col,row) — spanning cols [col, col+FOOTPRINT-1] ×
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
// True iff the window anchored at (col,row) is `tankFits` AND some cell of its FOOTPRINT footprint is
// orthogonally adjacent (Manhattan distance 1) to a fort-ring BRICK cell — the closest a tank body can
// park to shoot the eagle. This is the AC7 GOAL node, shared by the generator's corridor-carve TARGET +
// the verifier's BFS goal test (DRY) so they cannot disagree.
//
// WHY a WINDOW adjacent to the ring, NOT a cell next to the BASE (D15): the base + every in-grid cell
// touching it are BASE/BRICK (never tank-passable), so NO tankFits window can CONTAIN a base-adjacent cell.
// The goal is therefore a window-graph NODE adjacent to the ring. Such a window provably EXISTS for the
// odd 17-wide grid + 1-tile footprint + col-8 fort (e.g. the window anchored at (8,14): its cell (8,14)
// is one orthogonal step above the fort-top brick (8,15) — D15 enumerates the set), so the goal is
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
  // For the 17×17 grid the base is (col 8, row 16); the ring is (8,15) above + (7,16) left + (9,16) right
  // (the bottom edge needs no ring — it is the grid boundary, which the enclosure check treats as a wall).
  const baseCol = Math.floor(cols / 2) // = 8 (the odd-width center column).
  const baseRow = rows - 1 // = 16 (the bottom row).
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
  // tankFits FOOTPRINT window: at this point the only non-EMPTY cells are the base + fort ring (rows 15–16),
  // so every chosen top-band/bottom-flank window is tank-passable by construction. We mark each footprint
  // reserved + fill its x/y via windowCenter (the ABSOLUTE window center, D13 — the tank-body center).
  const topRow = 0 // enemy spawns anchor at row 0 (the top spawn band; window spans FOOTPRINT rows from 0).
  const enemyAnchors: Array<[SpawnPoint['which'], number]> = [
    ['enemyL', 0], // left column.
    ['enemyC', baseCol - FOOTPRINT + 1], // centered over the fort column (anchor 8 → window col 8).
    ['enemyR', cols - FOOTPRINT], // right column (anchor 16 → window col 16).
  ]
  const enemySpawns: SpawnPoint[] = enemyAnchors.map(([which, col]) => {
    const c = clampInt(col, 0, cols - FOOTPRINT)
    reserveWindow(reserved, cols, rows, c, topRow)
    return { which, col: c, row: topRow, ...windowCenter(c, topRow) }
  })

  // Player spawns: the bottom-row band (anchor row rows-FOOTPRINT = 16, the bottom band), flanking the
  // base column. P1 to the LEFT of the fort, P2 to the RIGHT — the classic player start cells. The anchors
  // are chosen clear of the fort ring (which occupies cols 7–9 on rows 15–16) so each window is tankFits.
  const playerRow = rows - FOOTPRINT // = 16 (the bottom band).
  const p1Col = clampInt(baseCol - FOOTPRINT - 2, 0, cols - FOOTPRINT) // left of the fort (anchor 5).
  const p2Col = clampInt(baseCol + 2, 0, cols - FOOTPRINT) // right of the fort (anchor 10).
  const playerSpawns: SpawnPoint[] = [
    { which: 'p1', col: p1Col, row: playerRow, ...windowCenter(p1Col, playerRow) },
    { which: 'p2', col: p2Col, row: playerRow, ...windowCenter(p2Col, playerRow) },
  ]
  reserveWindow(reserved, cols, rows, p1Col, playerRow)
  reserveWindow(reserved, cols, rows, p2Col, playerRow)

  // ── 4) Carve guaranteed corridors to a fort-approach goal window (§5.3 step 4, D4/D5/D15) ── for each
  // top enemy spawn carve a FOOTPRINT-wide tank-passable lane (force EMPTY + reserve) from the spawn DOWN
  // to a GOAL window that satisfies isFortApproachWindow (a tankFits window orthogonally adjacent to a
  // fort-ring brick — e.g. anchored at (8,14), whose cell (8,14) is one step above the fort-top brick
  // (8,15)). Such a goal window provably EXISTS (D15) for the 17-wide grid + 1-tile footprint + col-8 fort;
  // carving to it makes the eagle REACHABLE from every top spawn BY CONSTRUCTION — the verifier's BFS
  // re-proves it (a PROOF, never a phantom target). The goal anchor sits one footprint-row above the fort
  // ring (row baseRow - FOOTPRINT - 1 = 14) and shares the base column so the goal adjacency holds: at
  // FOOTPRINT=1 the goal must CONTAIN the cell directly above the top ring brick (baseCol, baseRow-1), so
  // goalCol = baseCol (correct for FOOTPRINT 1 AND the old 2 — the window then contained a ring-adjacent cell).
  const goalRow = baseRow - FOOTPRINT - 1 // = 14 (window from row 14; cell at row 14 is adjacent to ring row 15).
  const goalCol = clampInt(baseCol, 0, cols - FOOTPRINT) // = 8 (window col 8; cell (8,14) touches ring (8,15)).
  for (const spawn of enemySpawns) {
    carveCorridor(tiles, reserved, cols, rows, spawn.col, spawn.row, goalCol, goalRow)
  }
  // The goal window itself must be EMPTY + reserved (the corridor terminus). carveWindow does both; it is
  // the node the verifier's BFS terminates at (isFortApproachWindow over the EMITTED tiles — D15).
  carveWindow(tiles, reserved, cols, rows, goalCol, goalRow)

  // ── 4b) Pick the seeded layout MOTIF (F7 §5.2, D1/D2, AC1) ── OFF the OFF-THE-MAIN-THREAD motif sub-RNG, so
  // the main `rng` scatter draw sequence below is structurally unchanged (D2). The chosen motif's params shape
  // step 5's per-cell thresholds; emit the id on the description (the verifier asserts it's a known motif). A
  // neutral fallback params (the identity multipliers, no lattice/bands) if a future override id isn't in the
  // table — defensive, so an unknown motifWeights id never crashes the scatter (still one draw per cell).
  const motif = selectMotif(seed, cfg)
  const mp: MotifParams = MOTIF_PARAMS[motif] ?? { brickMul: 1, steelMul: 1 }

  // ── 5) Seeded terrain scatter (§5.3 step 5, D14 + F7 §5.2/D1/D2 motif shaping) ── iterate every NON-reserved
  // cell, COUNTING the eligible cells into `scatterCells` (the EXACT eligible-cell total — the AC6 max-count
  // ceiling, D14); for each draw ONE rng() and place AT MOST ONE of BRICK/STEEL/WATER/TREES/ICE by the per-kind
  // densities (a single seeded pass; densities sum well under 1 so most cells stay EMPTY — a drivable
  // battlefield). Reserved cells (base/fort/spawns/corridors) are skipped, so reachability + spawn validity hold
  // (D4), and since AT MOST ONE tile lands per eligible cell, each kind's realized count is provably ≤
  // scatterCells (the structural ceiling — a Bernoulli scatter can never break it, D14).
  //
  // THE MOTIF (F7 D1/D2): the chosen motif's params SCALE the brick/steel thresholds (open thins, fortress
  // thickens) and optionally LIFT the brick propensity on a positional rule (maze = even interior cells;
  // corridors = alternating interior columns), so different seeds read as distinct SHAPES — open/sparse,
  // fortress/walled, maze/latticed, corridors/banded. CRITICALLY it still draws ONE rng() per non-reserved cell
  // + places AT MOST one tile (the bands still partition [0,1)), so `scatterCells` counting + the ≤ ceiling are
  // byte-unchanged in DISCIPLINE; and it touches ONLY non-reserved cells (the reserved skip is above), so the
  // base/fort/spawn/corridor cells are byte-identical for EVERY motif — enclosure + reachability hold BY
  // CONSTRUCTION (the verifier re-proves both generically per (seed,stage), covering every motif — AC2).
  let scatterCells = 0
  // The motif-scaled brick/steel densities (clamped to a safe ceiling so brick+steel never reaches 1 and the
  // cumulative bands always partition [0,1) — water/trees/ice keep their base densities, so EMPTY always wins
  // the tail). The lattice/band BRICK lift (below) is applied per-cell on top, also clamped under 1.
  const baseBrick = Math.min(cfg.brickDensity * mp.brickMul, 0.55)
  const baseSteel = Math.min(cfg.steelDensity * mp.steelMul, 0.3)
  const BRICK_LIFT = 0.42 // the extra BRICK propensity a maze-lattice / corridor-band eligible cell gets (clamped under 1).
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (reserved[r][c]) continue // base/fort/spawn/corridor — never scattered (D4) — the motif can't touch these.
      scatterCells++
      // The per-cell BRICK threshold: the motif-scaled base, LIFTED on the motif's positional rule (a maze
      // lattice on even interior cells; a corridor band on alternating interior columns). Clamped under 1 so the
      // cumulative bands still partition [0,1). This is a per-cell THRESHOLD shift only — still ONE rng() draw.
      let tB = baseBrick
      if (mp.lattice && c % 2 === 0 && r % 2 === 0) tB = Math.min(baseBrick + BRICK_LIFT, 0.85)
      else if (mp.bands && c % 3 === 0) tB = Math.min(baseBrick + BRICK_LIFT, 0.85)
      const tS = Math.min(tB + baseSteel, 0.95)
      const tW = tS + cfg.waterDensity
      const tT = tW + cfg.treesDensity
      const tI = tT + cfg.iceDensity
      const x = rng()
      if (x < tB) tiles[r][c] = TILE.BRICK
      else if (x < tS) tiles[r][c] = TILE.STEEL
      else if (x < tW) tiles[r][c] = TILE.WATER
      else if (x < tT) tiles[r][c] = TILE.TREES
      else if (x < tI) tiles[r][c] = TILE.ICE
      // else: stays EMPTY (most cells — the bands sum < 1).
    }
  }

  // ── 6) Emit the plain-data StageDescription (§5.3 step 6, AC5 + F7 motif) ── no functions on it, so it
  // serializes for the regression pin + is deep-equal-comparable for determinism (AC4/AC5). `motif` is the
  // seed-chosen layout id (the verifier asserts it's one of STAGE_MOTIFS + the shape space is used — AC1).
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
    motif,
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
// reserved. A simple L-path (vertical then horizontal) keeps the carve deterministic + FOOTPRINT-wide BY
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
  // carved channel is continuously FOOTPRINT-wide — a real tank can drive its whole length.
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
