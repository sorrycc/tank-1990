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

  // scene: GameScene. desc: a StageDescription from generateStage (pure data; never mutated here).
  constructor(scene: Phaser.Scene, desc: StageDescription) {
    this.scene = scene
    this.desc = desc
    this.solidBodies = scene.physics.add.staticGroup()
    this.waterBodies = scene.physics.add.staticGroup()
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

  // BRICK → SUB_CELLS² (2×2 = 4) independent static sub-cell bodies (D6). Each is a SUB_CELL_SIZE rect
  // promoted to its OWN static body + tracked by (col,row,subCol,subRow), so destroyBrickSubCell removes
  // exactly one without touching the others (sub-cell erosion — the classic quarter-brick chip).
  private _addBrick(col: number, row: number): void {
    const ox = this._cellX(col)
    const oy = this._cellY(row)
    for (let sr = 0; sr < SUB_CELLS; sr++) {
      for (let sc = 0; sc < SUB_CELLS; sc++) {
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
    }
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

  // ── destroy() (D6, AC10) ── tear down EVERY GameObject + body this TileMap created (the in-place
  // stage→stage rebuild depends on leaking nothing — the reference's clear(true,true) + tracked-objects
  // discipline). staticGroup.clear(true,true) destroys members + their bodies; we also destroy the tracked
  // loose decorations (bg, trees, ice) + the groups themselves + drop the sub-cell map.
  destroy(): void {
    this.solidBodies.clear(true, true)
    this.waterBodies.clear(true, true)
    this.solidBodies.destroy(true)
    this.waterBodies.destroy(true)
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
