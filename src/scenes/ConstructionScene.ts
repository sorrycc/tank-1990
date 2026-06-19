import Phaser from 'phaser'
import {
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
  UI_FONT,
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  PLAYFIELD_X,
  PLAYFIELD_Y,
  PLAYFIELD_W,
  PLAYFIELD_H,
} from '../config/constants.js'
import { TILE, TILE_PROPS } from '../config/tiles.js'
import type { TileValue } from '../config/tiles.js'
import { t } from '../i18n/index.js'
import { Sound } from '../audio/Sound.js'
import { loadCustomMap, saveCustomMap } from '../util/customMap.js'
import { loadSettings, saveSettings } from '../util/settings.js'

// ── ConstructionScene (construction-mode §5.4, Decision D4) ──
// The Battle City CONSTRUCTION (level editor) scene — its OWN Phaser scene (the brief's "its own scene", SOLID),
// reachable from the Title (`T`). Phaser-COUPLED (it owns GameObjects) → NEVER imported by the headless verifier
// (the editor reuses the SAME programmer-art palette + grid→screen map the live TileMap uses, but the SEAM it
// feeds — buildCustomStage + the saved grid — lives in PURE config/customStage.ts + util/customMap.ts which the
// verifier drives, §5). Modelled on SettingsScene/HubScene: every position derives from the FIXED design
// resolution / the playfield origin so it centers under Scale.FIT; all labels read via t() (no inlined string).
//
// THE ONE LOCAL GRID + ONE PAINT PATH (D4, KISS): the scene keeps a local `grid: number[][]` (seeded from
// loadCustomMap() or all-EMPTY) + a cursor (col,row) + a brush (the current tile). Keys: arrows move the cursor;
// SPACE/ENTER paint the brush at the cursor; B cycles the brush through the 7 tiles; C clears to EMPTY; S saves;
// P saves + sets playCustom=true + starts GameScene on the authored map; ESC saves + returns to the Title
// (playCustom=false). A pointerdown on a grid cell moves the cursor + paints (one handler, reusing the SAME paint
// path — no second code path). No undo stack / multi-map slots (YAGNI). The grid renders as one Graphics primitive
// redrawn on every edit (KISS — a 17×17 = 289-rect redraw is cheap + avoids 289 tracked GameObjects).
//
// THE BASE BRUSH IS SINGLE-INSTANCE (D5): painting BASE first clears any existing BASE cell, so the grid has AT
// MOST one eagle (the combat assumes one desc.base; buildCustomStage finds it, or defaults bottom-center).

// The brush cycle order (construction-mode §6 / AC2) — EMPTY→BRICK→STEEL→WATER→TREES→ICE→BASE. The seven tile
// values + their i18n name key, paired so the brush label + the cycle read the SAME ordered list (DRY).
const BRUSHES: ReadonlyArray<{ tile: TileValue; nameKey: string }> = [
  { tile: TILE.EMPTY, nameKey: 'construction.tile.empty' },
  { tile: TILE.BRICK, nameKey: 'construction.tile.brick' },
  { tile: TILE.STEEL, nameKey: 'construction.tile.steel' },
  { tile: TILE.WATER, nameKey: 'construction.tile.water' },
  { tile: TILE.TREES, nameKey: 'construction.tile.trees' },
  { tile: TILE.ICE, nameKey: 'construction.tile.ice' },
  { tile: TILE.BASE, nameKey: 'construction.tile.base' },
]

// The cursor outline + grid-line colours (LOCAL coupled-scene render tunables — single-site, so NOT in
// constants.ts, the SAME rule SettingsScene's pixel offsets follow — D4/§5).
const GRID_LINE_COLOR = 0x30363d // the faint cell grid lines (matches the GameScene playfield outline).
const CURSOR_COLOR = 0xfeca57 // a bright amber cursor outline so the painted cell is unmistakable.
const CURSOR_THICK = 3 // px — the cursor outline thickness.

export class ConstructionScene extends Phaser.Scene {
  // The ONE local grid (row-major GRID-SPACE TILE ints — the SAME shape buildCustomStage/TileMap read). Seeded
  // from the saved map or all-EMPTY in create(); mutated by paint/clear; saved on S/P/ESC.
  private grid: number[][] = []
  private cursorCol = 0
  private cursorRow = 0
  private brushIndex = 0 // the index into BRUSHES of the current brush.

  // The render layers: ONE Graphics for the cells + grid lines + cursor (redrawn on every edit), the brush label
  // Text, the save-blip Text (shown briefly on S), and the menu-blip Sound (a no-op under NoAudio — the Title/Settings precedent).
  private gfx!: Phaser.GameObjects.Graphics
  private brushText!: Phaser.GameObjects.Text
  private savedText!: Phaser.GameObjects.Text
  private sfx!: Sound

  constructor() {
    super('Construction')
  }

  create(): void {
    const cx = DESIGN_WIDTH / 2

    // The menu-blip façade (the Title/Settings precedent; a no-op under NoAudio). No music in the editor.
    this.sfx = new Sound(this)

    // ── Seed the local grid (D4) ── from the saved custom map if a VALID one exists (re-opening restores it), else
    // all-EMPTY (a fresh board / a corrupt blob degrades to empty — loadCustomMap returns null, never crashes).
    const saved = loadCustomMap()
    this.grid = saved ?? this._emptyGrid()
    this.cursorCol = 0
    this.cursorRow = 0
    this.brushIndex = 0

    // ── Heading near the top (off the FIXED design resolution so it centers under Scale.FIT — the Title's discipline). ──
    this.add
      .text(cx, PLAYFIELD_Y - 56, t('construction.title'), {
        fontFamily: UI_FONT,
        fontSize: '40px',
        color: '#e6edf3',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    // ── The grid render layer (one Graphics, redrawn by _render) + a static playfield outline below the heading. ──
    this.gfx = this.add.graphics()

    // ── The current-brush label (above the playfield, right of the heading band) + the controls hint + the
    // brief save-confirm blip (hidden until S/P). All positioned off the fixed resolution / playfield origin. ──
    this.brushText = this.add
      .text(cx, PLAYFIELD_Y - 24, '', { fontFamily: UI_FONT, fontSize: '20px', color: '#c9d1d9' })
      .setOrigin(0.5)
    this.add
      .text(cx, PLAYFIELD_Y + PLAYFIELD_H + 28, t('construction.controls'), {
        fontFamily: UI_FONT,
        fontSize: '16px',
        color: '#5c6b7a',
      })
      .setOrigin(0.5)
    this.savedText = this.add
      .text(cx, PLAYFIELD_Y + PLAYFIELD_H + 52, '', { fontFamily: UI_FONT, fontSize: '16px', color: '#58d68d' })
      .setOrigin(0.5)

    this._render()

    // ── Keys (D4) ── arrows move the cursor; SPACE/ENTER paint; B cycles the brush; C clears; S saves; P plays;
    // ESC saves + returns to the Title. Each handler re-renders + blips on a change (the SettingsScene precedent).
    this.input.keyboard!.on('keydown-LEFT', () => this._moveCursor(-1, 0))
    this.input.keyboard!.on('keydown-RIGHT', () => this._moveCursor(1, 0))
    this.input.keyboard!.on('keydown-UP', () => this._moveCursor(0, -1))
    this.input.keyboard!.on('keydown-DOWN', () => this._moveCursor(0, 1))
    this.input.keyboard!.on('keydown-SPACE', () => this._paintCursor())
    this.input.keyboard!.on('keydown-ENTER', () => this._paintCursor())
    this.input.keyboard!.on('keydown-B', () => this._cycleBrush())
    this.input.keyboard!.on('keydown-C', () => this._clear())
    this.input.keyboard!.on('keydown-S', () => this._save())
    this.input.keyboard!.on('keydown-P', () => this._play())
    this.input.keyboard!.on('keydown-ESC', () => this._back())

    // ── Touch / pointer paint (D4) ── a pointerdown on a grid cell moves the cursor THERE + paints (the SAME paint
    // path — no second code path). A click outside the grid is ignored (the inverse map clamps + bounds-guards).
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this._paintAt(pointer.worldX, pointer.worldY))
  }

  // ── _emptyGrid() ── a fresh all-EMPTY GRID_ROWS × GRID_COLS grid (TILE.EMPTY = 0, a zero-fill — the §5.3 step-1
  // shape the procedural generator also starts from). Each row is its OWN array (no aliased rows).
  private _emptyGrid(): number[][] {
    const g: number[][] = []
    for (let r = 0; r < GRID_ROWS; r++) g.push(new Array<number>(GRID_COLS).fill(TILE.EMPTY))
    return g
  }

  // ── _moveCursor(dc,dr) ── walk the cursor one cell, clamped to the grid (no wrap — a clamp reads cleaner for an
  // editor than a wrap). Re-render the cursor highlight + blip (a no-op at a bound is fine — cheap).
  private _moveCursor(dc: number, dr: number): void {
    this.cursorCol = Math.max(0, Math.min(GRID_COLS - 1, this.cursorCol + dc))
    this.cursorRow = Math.max(0, Math.min(GRID_ROWS - 1, this.cursorRow + dr))
    this._render()
    this.sfx.uiMove()
  }

  // ── _cycleBrush() ── advance the brush through the 7 tiles (wrapping). Re-text the brush label + blip.
  private _cycleBrush(): void {
    this.brushIndex = (this.brushIndex + 1) % BRUSHES.length
    this._render()
    this.sfx.uiMove()
  }

  // ── _paintCursor() ── paint the current brush at the cursor (the SPACE/ENTER path). Delegates to _paintCell so
  // the keyboard + the pointer share ONE paint implementation (DRY — the single paint path).
  private _paintCursor(): void {
    this._paintCell(this.cursorCol, this.cursorRow)
  }

  // ── _paintAt(worldX,worldY) ── the pointer/touch paint: inverse-map the world pixel to a grid cell, move the
  // cursor THERE, and paint (the SAME _paintCell path). A click outside the playfield is ignored (bounds-guarded).
  private _paintAt(worldX: number, worldY: number): void {
    const col = Math.floor((worldX - PLAYFIELD_X) / TILE_SIZE)
    const row = Math.floor((worldY - PLAYFIELD_Y) / TILE_SIZE)
    if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return // outside the grid — ignore.
    this.cursorCol = col
    this.cursorRow = row
    this._paintCell(col, row)
  }

  // ── _paintCell(col,row) (D5 — the SINGLE paint path) ── write the current brush into the grid. The BASE brush is
  // SINGLE-INSTANCE: painting BASE first clears any existing BASE cell so the grid keeps AT MOST one eagle (the
  // combat assumes one desc.base). Re-render + blip.
  private _paintCell(col: number, row: number): void {
    const tile = BRUSHES[this.brushIndex].tile
    if (tile === TILE.BASE) this._clearExistingBase() // D5 — at most one eagle on the grid.
    this.grid[row][col] = tile
    this._render()
    this.sfx.uiMove()
  }

  // ── _clearExistingBase() (D5) ── scan the grid for an existing BASE cell and revert it to EMPTY, so painting a
  // new BASE leaves exactly one. KISS — a single scan over the 289 cells (cheap; runs only when the BASE brush paints).
  private _clearExistingBase(): void {
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (this.grid[r][c] === TILE.BASE) this.grid[r][c] = TILE.EMPTY
      }
    }
  }

  // ── _clear() ── reset the whole grid to EMPTY (the C key). Re-render + blip.
  private _clear(): void {
    this.grid = this._emptyGrid()
    this._render()
    this.sfx.uiMove()
  }

  // ── _save() ── persist the grid under `tank-1990:custom` (S). Show the brief "Saved" blip + a confirm sound.
  private _save(): void {
    saveCustomMap(this.grid)
    this.savedText.setText(t('construction.saved'))
    this.sfx.uiSelect()
  }

  // ── _play() (D2/D7) ── save the grid, flip settings.playCustom=true (so GameScene's create() builds the FIRST
  // stage from the authored map), and start GameScene. The custom grid seeds ONLY stage 0; advance() then chains
  // the procedural generator (the brief asks to PLAY the custom map, not author an infinite campaign).
  private _play(): void {
    saveCustomMap(this.grid)
    saveSettings({ ...loadSettings(), playCustom: true }) // D2 — flag the run to source stage 0 from the custom grid.
    this.sfx.uiSelect()
    this.scene.start('Game')
  }

  // ── _back() (D2) ── save the grid (so an ESC doesn't lose the edits) + clear playCustom (a Title-launched run is
  // always procedural — the custom flag is only set via PLAY) + return to the Title.
  private _back(): void {
    saveCustomMap(this.grid)
    saveSettings({ ...loadSettings(), playCustom: false }) // D2 — back to the Title implies a procedural next run.
    this.sfx.uiSelect()
    this.scene.start('Title')
  }

  // ── _render() ── the ONE render path: redraw the cell fills (reusing TILE_PROPS[t].color — the SAME palette the
  // live TileMap reads, DRY), the faint grid lines, and the bright cursor outline; re-text the brush label. Called
  // once in create() + after every cursor/brush/paint/clear change (the SettingsScene renderRows pattern — DRY).
  private _render(): void {
    const g = this.gfx
    g.clear()

    // Cell fills at the GRID→SCREEN map (PLAYFIELD_X/Y + col/row·TILE_SIZE — the SAME convention TileMap uses, D13).
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const tile = this.grid[row][col] as TileValue
        g.fillStyle(TILE_PROPS[tile].color, 1)
        g.fillRect(PLAYFIELD_X + col * TILE_SIZE, PLAYFIELD_Y + row * TILE_SIZE, TILE_SIZE, TILE_SIZE)
      }
    }

    // The faint cell grid lines (so each tile reads as its own cell) + the outer playfield border.
    g.lineStyle(1, GRID_LINE_COLOR, 1)
    for (let col = 0; col <= GRID_COLS; col++) {
      const x = PLAYFIELD_X + col * TILE_SIZE
      g.lineBetween(x, PLAYFIELD_Y, x, PLAYFIELD_Y + PLAYFIELD_H)
    }
    for (let row = 0; row <= GRID_ROWS; row++) {
      const y = PLAYFIELD_Y + row * TILE_SIZE
      g.lineBetween(PLAYFIELD_X, y, PLAYFIELD_X + PLAYFIELD_W, y)
    }

    // The bright cursor outline over the focused cell.
    g.lineStyle(CURSOR_THICK, CURSOR_COLOR, 1)
    g.strokeRect(
      PLAYFIELD_X + this.cursorCol * TILE_SIZE,
      PLAYFIELD_Y + this.cursorRow * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
    )

    // The brush label (the current tile's localised name) — a paint/cycle re-shows it. Clear the save blip on any
    // edit so the "Saved" cue doesn't linger after the next change (it reappears on the next S).
    this.brushText.setText(t('construction.brush', { tile: t(BRUSHES[this.brushIndex].nameKey) }))
    this.savedText.setText('')
  }
}
