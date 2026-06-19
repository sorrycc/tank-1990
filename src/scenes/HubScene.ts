import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT, TWO_PLAYER } from '../config/constants.js'
import { createMetaState } from '../core/MetaState.js'
import type { MetaStateInstance } from '../core/MetaState.js'
import { TANK_UPGRADES } from '../config/tank-upgrades.js'
import { t, tName, tDesc } from '../i18n/index.js'
import { Sound } from '../audio/Sound.js'

// ── HubScene (F0 scaffold §5.3 → F5 §5.4, Decision 4/D8/D9/D12, AC6/AC7/AC9) ──
// The between-runs META HUB — the LOCKED two-column shared-bank layout (D9). A SHARED currency header; a P1
// upgrade column (left) + a P2 upgrade column (right), each rendered GENERICALLY off TANK_UPGRADES (no
// per-upgrade UI code — the reference's generic-row stance, DRY); two cursors (P1 navigates the left column
// with WASD + buys with J; P2 the right with arrows + buys with Numpad0 OR Shift — the SAME physical keys the run uses,
// so no new key wiring, D9). Space/Enter = START RUN. In 1-PLAYER (TWO_PLAYER false) the P2 column is HIDDEN and
// the lone P1 cursor drives the single column (a buy via J OR Space; Enter = START RUN). A buy debits the SHARED
// currency + increments THAT player's level (the locked "shared bank, per-player trees" — the two trees COMPETE
// for one bank). Reachable from BOTH Title and GameOver (banked currency immediately spendable — AC7).
//
// DECOUPLED (D8, the reference's rule): it reads + writes meta ONLY through MetaState (never util/save.ts
// directly, never a live GameScene — the run ended). MetaState's save.ts try/catch makes a disabled storage
// degrade to in-memory (the Hub still works — AC5). All chrome via t('...'); the per-upgrade name/desc via
// tName/tDesc('upgrade', id, en) (the EN source is the row's own name/desc — AC9).

// Layout (positioned from the FIXED design resolution — Decision 1 — so it stays centered under Scale.FIT).
const HEADER_Y = 70 // px — y of the HUB title.
const CURRENCY_Y = 122 // px — y of the shared-currency readout (the ONE bank — D9).
const BEST_Y = 152 // px — F7 (D6/AC6) — y of the BEST line under the currency header.
const COL_TITLE_Y = 184 // px — y of the per-column "PLAYER N" heading.
const LIST_TOP = 218 // px — y of the FIRST upgrade row in each column.
const ROW_H = 56 // px — vertical spacing between upgrade rows (two text lines per row).
const FOOTER_Y = DESIGN_HEIGHT - 44 // px — y of the controls footer.
const CURSOR_COLOR = 0x2c3e50 // the highlight bar behind a column's selected row.

// The two columns' left x-anchors. In co-op the playfield splits L|R; in 1P the lone column is centered.
const COL1_X = TWO_PLAYER ? 150 : DESIGN_WIDTH / 2 - 280
const COL2_X = DESIGN_WIDTH / 2 + 70
const COL_W = 540 // px — a column's content width (the highlight bar + the row text fit within it).

// One column's per-player cursor + its rendered Text cells (created once, refilled on every nav/buy — DRY).
interface Column {
  slot: 1 | 2
  x: number
  cursor: number
  title: Phaser.GameObjects.Text
  bar: Phaser.GameObjects.Rectangle
  nameCells: Phaser.GameObjects.Text[] // per upgrade row: the "name · Lv o/max · cost" line.
  descCells: Phaser.GameObjects.Text[] // per upgrade row: the one-line effect desc.
}

export class HubScene extends Phaser.Scene {
  private meta!: MetaStateInstance
  private currencyHeader!: Phaser.GameObjects.Text
  private columns: Column[] = []
  private sfx!: Sound // the menu-blip façade (the TitleScene precedent; a no-op under NoAudio — AC6).

  constructor() {
    super('Hub')
  }

  create(): void {
    // Load a FRESH view of the persistent meta (reflects any prior buys / the just-banked run — D8). A factory,
    // so each Hub entry re-reads the SAME storage; the save.ts try/catch makes a disabled storage degrade silently.
    this.meta = createMetaState()
    this.columns = []
    // The menu-blip façade (shares Phaser's ONE AudioContext; resumed by the Title's first gesture — so the Hub's
    // blips play). A no-op under NoAudio (AC6). The scene owns audio (D6); _move/_buy/_startRun call sfx.* below.
    this.sfx = new Sound(this)

    // ── Header: the HUB title + the SHARED currency readout (the ONE bank both trees spend — D9). ──
    this.add
      .text(DESIGN_WIDTH / 2, HEADER_Y, t('hub.title'), {
        fontFamily: UI_FONT,
        fontSize: '52px',
        color: '#e6edf3',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
    this.currencyHeader = this.add
      .text(DESIGN_WIDTH / 2, CURRENCY_Y, '', { fontFamily: UI_FONT, fontSize: '26px', color: '#4dd0e1' })
      .setOrigin(0.5)

    // ── F7 (D6/AC6) — the BEST line near the currency header ── the Hub already loaded MetaState (this.meta), so
    // this is one extra getBestScore/getBestStage read (DRY). A fresh save reads 0/0 (the defensive save degrades
    // to defaults — never blank/crash). Localised; positioned off the FIXED design resolution (centered).
    this.add
      .text(DESIGN_WIDTH / 2, BEST_Y, t('hub.best', { score: this.meta.getBestScore(), stage: this.meta.getBestStage() }), {
        fontFamily: UI_FONT,
        fontSize: '17px',
        color: '#feca57', // gold — matches the best chrome on the Title / GameOver.
      })
      .setOrigin(0.5)

    // ── Build the P1 column always; the P2 column only in co-op (the lone column is hidden in 1P — D9/AC6). ──
    this.columns.push(this._buildColumn(1, COL1_X, 'hub.p1'))
    if (TWO_PLAYER) this.columns.push(this._buildColumn(2, COL2_X, 'hub.p2'))

    // ── Controls footer (localised; the SAME keys the run uses — D9). Co-op vs solo wording differs. ──
    this.add
      .text(DESIGN_WIDTH / 2, FOOTER_Y, t(TWO_PLAYER ? 'hub.footerCoop' : 'hub.footerSolo'), {
        fontFamily: UI_FONT,
        fontSize: '17px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    this._render()

    // ── Keyboard wiring (D9 — the SAME physical keys the run uses, so no Hub-only bindings) ──
    // P1: WASD navigate the left column + J buys. P2 (co-op only): arrows navigate the right column + Numpad0
    // OR Shift buys (Shift = the run's laptop alt fire; MacBooks have no numpad). Space/Enter = START RUN (a buy
    // in 1P is ALSO J or Space — the lone column). `.on` (the scene is
    // single-instance + torn down on start). The buy/move handlers no-op on a maxed/unaffordable buy (MetaState guards).
    const kb = this.input.keyboard!
    kb.on('keydown-W', () => this._move(1, -1))
    kb.on('keydown-S', () => this._move(1, 1))
    kb.on('keydown-J', () => this._buy(1)) // P1 fire = J (the run's P1 fire key — DRY).
    if (TWO_PLAYER) {
      kb.on('keydown-UP', () => this._move(2, -1))
      kb.on('keydown-DOWN', () => this._move(2, 1))
      kb.on('keydown-NUMPAD_ZERO', () => this._buy(2)) // P2 fire = Numpad0 (the run's P2 fire key — DRY).
      kb.on('keydown-SHIFT', () => this._buy(2)) // P2 fire ALT = Shift (the run's laptop alt fire — DRY; co-op only).
    } else {
      // Solo: the lone P1 column is ALSO drivable with the arrows + buyable with Space (the brief's 1P affordance).
      kb.on('keydown-UP', () => this._move(1, -1))
      kb.on('keydown-DOWN', () => this._move(1, 1))
      kb.on('keydown-SPACE', () => this._buy(1))
    }
    // START RUN: Enter always; Space in co-op (in solo Space buys the lone column, so Enter is the start key).
    kb.on('keydown-ENTER', () => this._startRun())
    if (TWO_PLAYER) kb.on('keydown-SPACE', () => this._startRun())
  }

  // ── _buildColumn(slot, x, titleKey) (D9) ── construct one player's column: the "PLAYER N" heading, the
  // cursor highlight bar, and one (name-line + desc-line) Text pair per TANK_UPGRADES row (generic — no
  // per-upgrade code). Returns the Column record the cursor + _render mutate. Created once; refilled each frame.
  private _buildColumn(slot: 1 | 2, x: number, titleKey: string): Column {
    const title = this.add.text(x, COL_TITLE_Y, t(titleKey), {
      fontFamily: UI_FONT,
      fontSize: '24px',
      color: slot === 1 ? '#58d68d' : '#4d96ff', // P1 green, P2 blue — match the two tanks' identity.
      fontStyle: 'bold',
    })

    // The cursor highlight bar (a rectangle moved behind the selected row). Origin top-left so its y aligns to a row.
    const bar = this.add.rectangle(x - 8, LIST_TOP, COL_W, ROW_H - 8, CURSOR_COLOR).setOrigin(0, 0)

    const nameCells: Phaser.GameObjects.Text[] = []
    const descCells: Phaser.GameObjects.Text[] = []
    for (let i = 0; i < TANK_UPGRADES.length; i++) {
      const y = LIST_TOP + i * ROW_H
      nameCells.push(this.add.text(x, y + 4, '', { fontFamily: UI_FONT, fontSize: '19px', color: '#e6edf3' }))
      descCells.push(this.add.text(x, y + 28, '', { fontFamily: UI_FONT, fontSize: '15px', color: '#8b949e' }))
    }
    return { slot, x, cursor: 0, title, bar, nameCells, descCells }
  }

  // ── _move(slot, dir) (D9/AC6) ── move that player's cursor within its column (clamped to the row range) +
  // re-render so the highlight + affordability refresh. A move past either end is a no-op (clamped, no wrap — KISS).
  private _move(slot: 1 | 2, dir: number): void {
    const col = this.columns.find((c) => c.slot === slot)
    if (!col) return
    const before = col.cursor
    col.cursor = Phaser.Math.Clamp(col.cursor + dir, 0, TANK_UPGRADES.length - 1)
    if (col.cursor !== before) this.sfx.uiMove() // tick ONLY on a real move — a clamped no-move at an end is silent (D4).
    this._render()
  }

  // ── _buy(slot) (D8/D9/AC6) ── buy the NEXT level of THAT player's selected upgrade out of the SHARED bank.
  // MetaState.buy debits the shared currency + increments upgrades[slot][id] + SAVEs if affordable AND not maxed;
  // it is a NO-OP (returns false) otherwise (the Hub treats false as "nothing happened"). Re-render to reflect
  // the new shared currency + that player's owned level + the affordability colours.
  private _buy(slot: 1 | 2): void {
    const col = this.columns.find((c) => c.slot === slot)
    if (!col) return
    const row = TANK_UPGRADES[col.cursor]
    // Capture the result (REPLACES the bare buy() — a second call would double-debit the shared bank). buy()
    // debits + ++upgrades[slot][id] + SAVEs on success, returns false on a no-op (maxed/unaffordable — D8). The
    // confirm blip on success, the denied buzz on a no-op (success-vs-rejection by ear — D6).
    const bought = this.meta.buy(slot, row.id)
    if (bought) this.sfx.uiSelect()
    else this.sfx.denied()
    this._render()
  }

  // ── _startRun() (D8/AC6/AC7) ── launch Game. GameScene re-loads MetaState in create() + folds each player's
  // tree via startSpec(slot) into the run-start spec (the bought upgrades visibly change that player's tank next
  // run — AC6). `once`-free: the scene tears down on start, so a held key can't double-launch the same instance.
  private _startRun(): void {
    this.sfx.uiSelect() // the start-run confirm blip (the Game's stageStart fanfare follows on the next scene — D6).
    this.scene.start('Game')
  }

  // ── _render() (D9/AC6) ── refill the whole Hub from the current MetaState (cheap — a handful of rows; only on
  // change). The SHARED currency header; per column, each row's "name · Lv o/max · cost(or MAX)" + the desc,
  // colour-hinting affordability (grey maxed, white affordable, red can't-afford); the cursor bar tracks each
  // column's cursor. All chrome via t/tName/tDesc (AC9). KISS — one pass over the two columns' rows.
  private _render(): void {
    const currency = this.meta.getCurrency()
    this.currencyHeader.setText(t('hub.currency', { n: currency }))

    for (const col of this.columns) {
      for (let i = 0; i < TANK_UPGRADES.length; i++) {
        const row = TANK_UPGRADES[i]
        const owned = this.meta.getUpgradeLevel(col.slot, row.id)
        const maxed = owned >= row.maxLevel
        const cost = maxed ? null : row.costs[owned]
        const affordable = !maxed && currency >= (cost as number)
        // The name line: "<name>   Lv o/max   <cost or MAX>". tName localises the row name (EN source = row.name).
        const lv = t('hub.lv', { owned, max: row.maxLevel })
        const costText = maxed ? t('hub.max') : t('hub.cost', { cost: cost as number })
        const color = maxed ? '#8b949e' : affordable ? '#e6edf3' : '#e5484d' // grey maxed / white ok / red can't afford.
        col.nameCells[i].setText(`${tName('upgrade', row.id, row.name)}   ${lv}   ${costText}`).setColor(color)
        col.descCells[i].setText(tDesc('upgrade', row.id, row.desc))
      }
      // The cursor bar tracks this column's cursor (top-left origin → y = the row's top).
      col.bar.y = LIST_TOP + col.cursor * ROW_H
    }
  }
}
