// ── Tile kinds + per-tile semantics (F2 Procedural stages §5.2, Decision D2, AC1) ──
// PURE module — NO Phaser import — so the seeded generator (world/LevelGenerator.ts), the
// Phaser-coupled renderer (world/TileMap.ts), AND the headless verifier (scripts/verify-gen.mjs) all
// import the SAME terrain truth under whichever runtime they run in (plain node for the generator +
// verifier, the browser for TileMap). A successful node-import of this module by the verifier RE-PROVES
// its purity (a stray `import 'phaser'` here would throw under node — AC11).
//
// WHY ITS OWN MODULE (D2): the read-only `dead-cell` reference keeps a tiny 4-value TILE const inline in
// LevelGenerator.ts with NO prop table — its tiles (SOLID/ONEWAY/HAZARD) carry their semantics in the
// generator/TileMap code directly. Tank 1990 has SEVEN terrain kinds with DISTINCT tank/bullet/erosion
// semantics consumed by THREE modules, so a shared semantic table owned ONCE (DRY) means the generator's
// "keep a tank corridor clear", TileMap's "which tiles get a tank-blocking body", and the verifier's
// "tank-passable BFS" all read the SAME truth — they CANNOT disagree. KISS: a flat lookup table, no classes.

// ── The tile enum (D2, AC1) ── small ints so the grid serializes trivially for the regression pin
// (AC5) and the three consumers share ONE definition (DRY). EMPTY=0 so a fresh grid (zero-fill) is
// all-empty (§5.3 step 1). The mirror of the reference's `export const TILE = { EMPTY: 0, ... }`.
export const TILE = {
  EMPTY: 0, // open ground — a tank drives through, a bullet flies through.
  BRICK: 1, // destructible brick — blocks tanks + bullets; erodes at sub-cell granularity (the classic).
  STEEL: 2, // indestructible steel — blocks tanks + bullets (until a max-star tank, a LATER feature).
  WATER: 3, // water — blocks TANKS but bullets PASS over it (the classic water semantic).
  TREES: 4, // trees — everything passes; overdraw cover (rendered ABOVE tanks, no body).
  ICE: 5, // ice — everything passes; low friction (a LATER feel feature; the tile is the seam).
  BASE: 6, // the eagle base — blocks tanks + bullets; losing it ends the run (a LATER feature).
} as const

// The union of valid tile values (so TILE_PROPS is a total Record keyed by every tile — AC1).
export type TileValue = (typeof TILE)[keyof typeof TILE]

// ── Per-tile semantic properties (D2, AC1) ── the SINGLE source of the classic Battle City terrain
// rules. `passableByTank`/`passableByBullet`/`destructible` are the booleans the generator + verifier +
// TileMap read (never re-encoded as inline literals at a use site — DRY). `color` is the programmer-art
// fill TileMap draws (the generator + verifier IGNORE it — it is render-only, AC11).
export interface TileProps {
  passableByTank: boolean // can a tank occupy this cell? (EMPTY/TREES/ICE yes; BRICK/STEEL/WATER/BASE no)
  passableByBullet: boolean // does a bullet fly through? (EMPTY/WATER/TREES/ICE yes; BRICK/STEEL/BASE no)
  destructible: boolean // can a bullet erode it? (BRICK yes; STEEL not this phase; the rest no)
  color: number // programmer-art fill (TileMap ONLY; the pure generator/verifier never read it)
}

// The classic semantics encoded ONCE (AC1). A `Record<TileValue, …>` so TypeScript proves EVERY tile
// value has a row (a missing tile is a compile error — the totality the verifier also asserts at runtime).
export const TILE_PROPS: Record<TileValue, TileProps> = {
  [TILE.EMPTY]: { passableByTank: true, passableByBullet: true, destructible: false, color: 0x11161f },
  [TILE.BRICK]: { passableByTank: false, passableByBullet: false, destructible: true, color: 0xb5651d },
  [TILE.STEEL]: { passableByTank: false, passableByBullet: false, destructible: false, color: 0x8d99ae },
  [TILE.WATER]: { passableByTank: false, passableByBullet: true, destructible: false, color: 0x2e86de },
  [TILE.TREES]: { passableByTank: true, passableByBullet: true, destructible: false, color: 0x2d6a4f },
  [TILE.ICE]: { passableByTank: true, passableByBullet: true, destructible: false, color: 0xcfe8ef },
  [TILE.BASE]: { passableByTank: false, passableByBullet: false, destructible: false, color: 0xf6e58d },
}

// ── Semantic helpers (D2, AC1) — READ the table, never re-encode the literals (DRY). ──
// Each takes a raw `number` (the grid stores plain ints) + defends an out-of-range value with `false`
// (an unknown tile is conservatively impassable/indestructible — never a crash). The generator's
// corridor carve, TileMap's body decisions, and the verifier's BFS all funnel through these THREE, so
// the terrain rules live in exactly one place (the reference's "shared predicate" stance, e.g. its
// `canReachStep`). KISS: a single table lookup + a defensive default.
export function isTankPassable(t: number): boolean {
  const p = TILE_PROPS[t as TileValue]
  return p ? p.passableByTank : false
}
export function isBulletPassable(t: number): boolean {
  const p = TILE_PROPS[t as TileValue]
  return p ? p.passableByBullet : false
}
export function isDestructible(t: number): boolean {
  const p = TILE_PROPS[t as TileValue]
  return p ? p.destructible : false
}
