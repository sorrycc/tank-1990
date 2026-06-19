// ── Persisted custom-map wrapper (construction-mode §2/§5, Decision D3) ──
// PURE of Phaser — safe to import anywhere, including headless (scripts/verify-gen.mjs node-imports it under plain
// node — re-proving purity; a stray Phaser import would throw). Layered over util/save.ts's defensive get/set (the
// SAME try/catch wrapper the meta + settings schemas use — DRY) but under a SEPARATE `tank-1990:custom` key, NOT
// the settings/meta schema (D3): the painted grid is BULK DATA (a 17×17 tile array), a different concern from the
// player PREFERENCE (settings.ts) or the run ECONOMY (save.ts meta), so it belongs in its OWN key (mirroring how
// `tank-1990:settings` separates from `tank-1990:meta` — SOLID, one owner per concern).
//
// THE SCHEMA + SANITIZE (D3): this module is the SINGLE owner of the saved-grid shape + validation. loadCustomMap()
// validates dims (GRID_ROWS × GRID_COLS) + every cell being a known TILE int, returning null on ANYTHING corrupt
// (wrong shape / a NaN / an out-of-range tile / a disabled storage) — never throws (it inherits save.ts's
// error-swallowing). So a corrupt blob degrades to "no custom map" (the editor opens all-EMPTY; GameScene falls
// back to the procedural path), never a crash. PURE → the verifier drives the validate/round-trip headlessly.

import { get, set } from './save.js'
import { GRID_COLS, GRID_ROWS } from '../config/constants.js'
import { TILE } from '../config/tiles.js'

// The dedicated bulk-data key — SEPARATE from settings.ts's `tank-1990:settings` + save.ts's `tank-1990:meta` (D3).
const CUSTOM_KEY = 'tank-1990:custom'

// The set of valid tile ints (a painted cell must be one of these) — derived from the TILE enum (DRY, never a
// duplicated literal list). A cell value outside this set means a corrupt blob → loadCustomMap returns null.
const VALID_TILES: ReadonlySet<number> = new Set<number>(Object.values(TILE))

// ── isValidGrid(grid) → boolean (D3) ── the single sanitize predicate: true iff `grid` is a GRID_ROWS × GRID_COLS
// 2-D array of KNOWN tile ints. Total + defensive (a non-array / wrong dims / a non-int / an unknown tile → false),
// so a hand-edited or older-build localStorage blob can NEVER feed an invalid grid into buildCustomStage/TileMap.
function isValidGrid(grid: unknown): grid is number[][] {
  if (!Array.isArray(grid) || grid.length !== GRID_ROWS) return false
  for (const row of grid) {
    if (!Array.isArray(row) || row.length !== GRID_COLS) return false
    for (const cell of row) {
      if (typeof cell !== 'number' || !VALID_TILES.has(cell)) return false
    }
  }
  return true
}

// ── loadCustomMap() → number[][] | null (D3) ── read the saved grid, validate it, and return it — or null if it
// is missing / corrupt / a disabled storage (over save.ts's get, which never throws). The caller (the editor seed
// + GameScene's custom-path guard) treats null as "no custom map" (the editor opens all-EMPTY; the run is procedural).
export function loadCustomMap(): number[][] | null {
  const stored = get<unknown>(CUSTOM_KEY, null)
  return isValidGrid(stored) ? stored : null
}

// ── saveCustomMap(grid) → boolean (D3) ── write the painted grid under the dedicated key (over save.ts's set, which
// never throws — returns false if storage is unavailable/full). The editor calls it on S / before PLAY. A grid that
// fails the shape check is REJECTED (not persisted) so a malformed in-memory grid never poisons the saved slot.
export function saveCustomMap(grid: number[][]): boolean {
  if (!isValidGrid(grid)) return false
  return set(CUSTOM_KEY, grid)
}

// ── hasCustomMap() → boolean (D3) ── true iff a VALID custom map is currently saved (GameScene's PLAY-custom guard
// reads it alongside the settings.playCustom flag). Reuses loadCustomMap's validate (DRY) so "has" and "load" can
// never disagree (a corrupt blob is "not present").
export function hasCustomMap(): boolean {
  return loadCustomMap() !== null
}
