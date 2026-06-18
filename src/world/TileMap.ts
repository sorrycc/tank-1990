import Phaser from 'phaser'
import {
  PLAYFIELD_X,
  PLAYFIELD_Y,
  TILE_SIZE,
  SUB_CELLS,
  SUB_CELL_SIZE,
} from '../config/constants.js'
import { TILE, TILE_PROPS } from '../config/tiles.js'
import type { TileValue } from '../config/tiles.js'
import type { StageDescription } from './LevelGenerator.js'

// ── TileMap — render + body a stage description (F2 Procedural stages §5.2/§5.3, Decisions D6/D7/D8/D13,
// AC10) ──
// Phaser-COUPLED (imports Phaser, owns GameObjects + Arcade bodies). It is NEVER imported by the headless
// verifier — that would throw under node, which is the whole point of keeping LevelGenerator pure (D1/D9).
// Given a PURE StageDescription (GRID-SPACE tiles + window-center spawn coords — D13) it builds the
// programmer-art terrain (no external asset / `load.*` — AC11) + the Arcade bodies tanks collide with.
//
// THE GRID→SCREEN MAP (D13, the ONE convention): `desc.tiles` is pure GRID-SPACE data. A cell (col,row)'s
// top-left maps to screen by `screenX = PLAYFIELD_X + col·TILE_SIZE`, `screenY = PLAYFIELD_Y + row·TILE_SIZE`
// — so the whole stage renders INSIDE the centered playfield, lane-aligned with the F1 Tank._recenterCross
// origin (PLAYFIELD_X/Y). A static body is positioned by its CENTER, so each rect is drawn at its center.
//
// PER-TILE construction (D6/D7/D8):
//   • BRICK  → SUB_CELLS² (2×2 = 4) INDEPENDENT static sub-cell bodies (each SUB_CELL_SIZE px) added to
//     `solidBodies`, tracked by (col,row,subCol,subRow) so `destroyBrickSubCell` removes exactly one
//     (sub-cell erosion — the classic quarter-brick chip; the bullet damage feature calls the seam, LATER).
//   • STEEL / BASE → one TILE_SIZE static body added to `solidBodies` (tank-blocking).
//   • WATER → one TILE_SIZE static body added to `waterBodies` (tank-blocking; tagged so the LATER bullet×
//     terrain collision lets bullets fly OVER it — the classic water semantic, D7).
//   • TREES → one rect at a HIGH depth (ABOVE tanks — overdraw cover), NO body (everything passes, D8).
//   • ICE   → one rect at terrain depth, NO body, tagged for the LATER low-friction feel (D8).
// `destroy()` mirrors the reference TileMap: clear(true,true) each static group + destroy it, destroy
// every tracked loose object, null the array — the in-place stage→stage rebuild leaks nothing (D6).

// Depths: terrain sits BELOW tanks (which render at the default depth 0); trees overdraw ABOVE them.
const DEPTH_TERRAIN = -5
const DEPTH_TREES = 50

// A drawn rect that remembers its grid cell — for the brick sub-cell erosion seam + ice/water tagging.
type TileRect = Phaser.GameObjects.Rectangle & {
  tileCol?: number
  tileRow?: number
  subCol?: number
  subRow?: number
  tileKind?: number // a TILE value — the LATER bullet×terrain collision reads it (water-passes, ice-tag).
}

export class TileMap {
  scene: Phaser.Scene
  desc: StageDescription
  // STEEL + BASE + every BRICK sub-cell — tank-blocking static bodies (tanks collide; AC10).
  solidBodies!: Phaser.Physics.Arcade.StaticGroup
  // WATER — tank-blocking static bodies in a DISTINCT group so the LATER bullet collision can point at
  // `solidBodies` (bullets stop) but NOT `waterBodies` (bullets pass over water — D7). Tanks collide with both.
  waterBodies!: Phaser.Physics.Arcade.StaticGroup
  // The bodiless decorations (TREES overdraw, ICE tag) + the playfield backdrop — tracked for teardown only.
  private _objects!: Phaser.GameObjects.GameObject[]
  // The brick sub-cell rects, keyed by `${col},${row},${subCol},${subRow}` so destroyBrickSubCell finds one.
  private _brickSubCells!: Map<string, TileRect>

  // ── F5 shovel seam (F5 §5.5, D4a) ── the shovel power-up swaps the eagle's fort-ring brick to STEEL for a
  // timed window, then reverts it to EXACTLY its pre-fortify brick state (erosion-lossless). The ring is built as
  // 4 independent sub-cell bodies per tile (_addBrick) while steel is one TILE_SIZE body (_addSolidTile) — so a
  // fortify CANNOT recolour in place: it must destroy the surviving brick sub-cells + add a steel body, and the
  // revert must rebuild EXACTLY the surviving sub-cells (including any quarter-brick erosion). _fortifyBodies holds
  // the temporary steel bodies; _fortifyState records, per ring tile, the (subCol,subRow) set that survived at
  // fortify time so the revert restores it byte-for-byte. Null _fortifyState = nothing fortified (idempotent).
  private _fortifyBodies!: Phaser.Physics.Arcade.StaticGroup // the temporary STEEL ring bodies (tank-blocking).
  private _fortifyState: Map<string, Array<[number, number]>> | null = null // per-cell `${col},${row}` → surviving (subCol,subRow)[].

  // scene: GameScene. desc: a StageDescription from generateStage (pure data; never mutated here).
  constructor(scene: Phaser.Scene, desc: StageDescription) {
    this.scene = scene
    this.desc = desc
    this.solidBodies = scene.physics.add.staticGroup()
    this.waterBodies = scene.physics.add.staticGroup()
    this._fortifyBodies = scene.physics.add.staticGroup() // F5 (D4a) — the shovel's temporary STEEL ring bodies.
    this._fortifyState = null // F5 (D4a) — nothing fortified yet (idempotent guard).
    this._objects = []
    this._brickSubCells = new Map<string, TileRect>()

    // A dark playfield backdrop band so the stage reads against the page letterbox (cosmetic; below the
    // terrain). Drawn at the GRID→SCREEN origin sized to the full grid. Tracked for teardown.
    const bg = scene.add
      .rectangle(PLAYFIELD_X, PLAYFIELD_Y, desc.cols * TILE_SIZE, desc.rows * TILE_SIZE, TILE_PROPS[TILE.EMPTY].color)
      .setOrigin(0, 0)
      .setDepth(DEPTH_TERRAIN - 1)
    this._objects.push(bg)

    // Scan the GRID-SPACE tiles (D13) and build each cell's render + body per its kind (D6/D7/D8).
    for (let row = 0; row < desc.rows; row++) {
      for (let col = 0; col < desc.cols; col++) {
        const t = desc.tiles[row][col] as TileValue
        switch (t) {
          case TILE.BRICK:
            this._addBrick(col, row)
            break
          case TILE.STEEL:
          case TILE.BASE:
            this._addSolidTile(col, row, t)
            break
          case TILE.WATER:
            this._addWaterTile(col, row)
            break
          case TILE.TREES:
            this._addDecoration(col, row, TILE.TREES, DEPTH_TREES)
            break
          case TILE.ICE:
            this._addDecoration(col, row, TILE.ICE, DEPTH_TERRAIN)
            break
          // TILE.EMPTY → nothing (the backdrop shows through). KISS.
        }
      }
    }
  }

  // The GRID→SCREEN top-left of cell (col,row) — the ONE D13 convention. A static body is positioned by
  // its center, so callers add half the rect size to these.
  private _cellX(col: number): number {
    return PLAYFIELD_X + col * TILE_SIZE
  }
  private _cellY(row: number): number {
    return PLAYFIELD_Y + row * TILE_SIZE
  }

  // BRICK → SUB_CELLS² (2×2 = 4) independent static sub-cell bodies (D6). Each is built by _addBrickSubCell so
  // the F5 shovel-revert can rebuild a SINGLE surviving sub-cell with the IDENTICAL construction (DRY — D4a).
  private _addBrick(col: number, row: number): void {
    for (let sr = 0; sr < SUB_CELLS; sr++) {
      for (let sc = 0; sc < SUB_CELLS; sc++) {
        this._addBrickSubCell(col, row, sc, sr)
      }
    }
  }

  // ── _addBrickSubCell(col,row,sc,sr) (D6 + F5 §5.5 D4a) ── build ONE brick sub-cell: a SUB_CELL_SIZE rect
  // promoted to its OWN static body + tracked by (col,row,subCol,subRow), so destroyBrickSubCell removes exactly
  // one without touching the others (the classic quarter-brick chip) AND revertBaseRing rebuilds exactly the
  // surviving set. Idempotent w.r.t. the map (a re-add overwrites the key's rect — but callers never double-add).
  private _addBrickSubCell(col: number, row: number, sc: number, sr: number): void {
    const ox = this._cellX(col)
    const oy = this._cellY(row)
    const x = ox + sc * SUB_CELL_SIZE + SUB_CELL_SIZE / 2
    const y = oy + sr * SUB_CELL_SIZE + SUB_CELL_SIZE / 2
    const rect = this.scene.add.rectangle(x, y, SUB_CELL_SIZE, SUB_CELL_SIZE, TILE_PROPS[TILE.BRICK].color) as TileRect
    rect.setDepth(DEPTH_TERRAIN)
    rect.tileCol = col
    rect.tileRow = row
    rect.subCol = sc
    rect.subRow = sr
    rect.tileKind = TILE.BRICK
    this.solidBodies.add(rect) // staticGroup.add promotes it to a static Arcade body automatically.
    this._brickSubCells.set(brickKey(col, row, sc, sr), rect)
  }

  // STEEL / BASE → one TILE_SIZE tank-blocking static body in `solidBodies` (D6). One rect per tile.
  private _addSolidTile(col: number, row: number, kind: TileValue): void {
    const rect = this.scene.add.rectangle(
      this._cellX(col) + TILE_SIZE / 2,
      this._cellY(row) + TILE_SIZE / 2,
      TILE_SIZE,
      TILE_SIZE,
      TILE_PROPS[kind].color,
    ) as TileRect
    rect.setDepth(DEPTH_TERRAIN)
    rect.tileCol = col
    rect.tileRow = row
    rect.tileKind = kind
    this.solidBodies.add(rect)
  }

  // WATER → one TILE_SIZE tank-blocking static body in the DISTINCT `waterBodies` group (D7). Tagged so the
  // LATER bullet×terrain collider points at solidBodies (bullets stop) but lets bullets pass over water.
  private _addWaterTile(col: number, row: number): void {
    const rect = this.scene.add.rectangle(
      this._cellX(col) + TILE_SIZE / 2,
      this._cellY(row) + TILE_SIZE / 2,
      TILE_SIZE,
      TILE_SIZE,
      TILE_PROPS[TILE.WATER].color,
    ) as TileRect
    rect.setDepth(DEPTH_TERRAIN)
    rect.tileCol = col
    rect.tileRow = row
    rect.tileKind = TILE.WATER
    this.waterBodies.add(rect)
  }

  // TREES / ICE → one bodiless rect (everything passes — D8). TREES draw at DEPTH_TREES (ABOVE tanks —
  // overdraw cover); ICE at terrain depth, tagged for the LATER low-friction feel. Tracked for teardown.
  private _addDecoration(col: number, row: number, kind: TileValue, depth: number): void {
    const rect = this.scene.add.rectangle(
      this._cellX(col) + TILE_SIZE / 2,
      this._cellY(row) + TILE_SIZE / 2,
      TILE_SIZE,
      TILE_SIZE,
      TILE_PROPS[kind].color,
    ) as TileRect
    rect.setDepth(depth)
    rect.tileCol = col
    rect.tileRow = row
    rect.tileKind = kind
    this._objects.push(rect)
  }

  // ── destroyBrickSubCell(col,row,subCol,subRow) (D6, AC10 — the EROSION seam) ── remove exactly ONE
  // brick sub-cell's rect + its static body, leaving the other three of that brick tile intact (the
  // classic quarter-brick chip). The bullet×brick damage feature (LATER) calls this; F2 only WIRES it —
  // nothing shoots yet (YAGNI). Idempotent: a missing key is a no-op (a re-call after a chip never throws).
  destroyBrickSubCell(col: number, row: number, subCol: number, subRow: number): void {
    const key = brickKey(col, row, subCol, subRow)
    const rect = this._brickSubCells.get(key)
    if (!rect) return
    this._brickSubCells.delete(key)
    this.solidBodies.remove(rect, true, true) // remove from the group + destroy the GameObject + its body.
  }

  // ── fortifyBaseRing(cells) (F5 §5.5, D4a, AC2/AC10 — the shovel rising edge) ── swap the eagle's fort-ring
  // BRICK to STEEL. For each ring tile (col,row): RECORD the (subCol,subRow) set of its surviving brick sub-cells
  // (0..4 — a partially-eroded ring fortifies whatever brick remains), DESTROY those sub-cell bodies via the
  // EXISTING destroyBrickSubCell path, then add ONE TILE_SIZE STEEL static body (the _addSolidTile shape) into
  // _fortifyBodies tagged by (col,row). Idempotent: if _fortifyState is already non-null (already fortified) it is
  // a no-op (a double-fortify can't stack steel). `cells` = the fort-ring tile coords (GameScene derives them
  // from desc.base — DRY, no generator call). The scene DEFERS this out of the overlap callback (D10).
  fortifyBaseRing(cells: Array<{ col: number; row: number }>): void {
    if (this._fortifyState) return // already fortified — idempotent no-op (D4a).
    const state = new Map<string, Array<[number, number]>>()
    for (const { col, row } of cells) {
      // Record the surviving sub-cells of this ring tile, then destroy them (so the steel body replaces the brick).
      const survivors: Array<[number, number]> = []
      for (let sr = 0; sr < SUB_CELLS; sr++) {
        for (let sc = 0; sc < SUB_CELLS; sc++) {
          if (this._brickSubCells.has(brickKey(col, row, sc, sr))) {
            survivors.push([sc, sr])
            this.destroyBrickSubCell(col, row, sc, sr) // the SAME chip path the bullet erosion uses (DRY).
          }
        }
      }
      state.set(cellKey(col, row), survivors) // record EXACTLY what was there (lossless revert — even if 0 left).
      // Add ONE TILE_SIZE STEEL static body (the _addSolidTile shape) into the temporary fortify group.
      const rect = this.scene.add.rectangle(
        this._cellX(col) + TILE_SIZE / 2,
        this._cellY(row) + TILE_SIZE / 2,
        TILE_SIZE,
        TILE_SIZE,
        TILE_PROPS[TILE.STEEL].color,
      ) as TileRect
      rect.setDepth(DEPTH_TERRAIN)
      rect.tileCol = col
      rect.tileRow = row
      rect.tileKind = TILE.STEEL
      this._fortifyBodies.add(rect)
    }
    this._fortifyState = state // non-null = fortified (the revert + the idempotent guard read it).
  }

  // ── revertBaseRing() (F5 §5.5, D4a, AC2/AC3/AC10 — the shovel falling edge) ── un-fortify: destroy every
  // temporary STEEL body, then for each recorded ring tile REBUILD exactly the surviving brick sub-cells (the
  // _addBrickSubCell construction, restricted to the recorded set) so the pre-fortify erosion state is restored
  // byte-for-byte (a quarter-chipped ring reverts to a quarter-chipped ring — the classic shovel). Idempotent: if
  // _fortifyState is null (nothing fortified) it is a no-op. The scene DEFERS this out of the timer step (D10).
  revertBaseRing(): void {
    if (!this._fortifyState) return // nothing fortified — idempotent no-op (D4a).
    this._fortifyBodies.clear(true, true) // destroy every temporary STEEL body + its Arcade body.
    for (const [key, survivors] of this._fortifyState) {
      const [col, row] = key.split(',').map(Number)
      for (const [sc, sr] of survivors) this._addBrickSubCell(col, row, sc, sr) // rebuild EXACTLY what survived.
    }
    this._fortifyState = null // back to un-fortified (the idempotent guard re-arms).
  }

  // ── destroy() (D6 + F5 §5.5 D4a, AC10) ── tear down EVERY GameObject + body this TileMap created (the in-place
  // stage→stage rebuild depends on leaking nothing — the reference's clear(true,true) + tracked-objects
  // discipline). staticGroup.clear(true,true) destroys members + their bodies; we also destroy the tracked
  // loose decorations (bg, trees, ice) + the groups themselves + drop the sub-cell map + the F5 fortify group/state
  // (so a stage rebuild while fortified leaks nothing — AC10).
  destroy(): void {
    this.solidBodies.clear(true, true)
    this.waterBodies.clear(true, true)
    this._fortifyBodies.clear(true, true) // F5 (D4a) — destroy any live steel ring bodies before the group goes.
    this.solidBodies.destroy(true)
    this.waterBodies.destroy(true)
    this._fortifyBodies.destroy(true)
    this._fortifyState = null
    for (const o of this._objects) if (o && o.active) o.destroy()
    this._objects = []
    this._brickSubCells.clear()
  }
}

// The brick sub-cell tracking key (one place, DRY) so the constructor's `set` + destroyBrickSubCell's
// `get`/`delete` agree byte-for-byte.
function brickKey(col: number, row: number, subCol: number, subRow: number): string {
  return `${col},${row},${subCol},${subRow}`
}

// The fortify-ring per-tile key (F5 §5.5, D4a) — one place (DRY) so fortifyBaseRing's `set` + revertBaseRing's
// split agree. `${col},${row}` so the revert's `.split(',').map(Number)` recovers the exact (col,row).
function cellKey(col: number, row: number): string {
  return `${col},${row}`
}
