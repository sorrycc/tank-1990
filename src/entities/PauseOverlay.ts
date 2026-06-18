import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { t, CONTROLS_ROWS } from '../i18n/index.js'

// ── RunInfo (F7 Rich playability §5.3, D3) ── a plain, already-assembled snapshot of the live run, handed to
// the overlay via getInfo(). The overlay knows NOTHING about RunState (SOLID/decoupled — the reference's
// getBuild idiom): GameScene owns the run logic + assembles this; the overlay only formats + lays out. The world
// is FROZEN while paused, so this is read ONCE on open (the run cannot change while paused — KISS, no per-frame re-read).
export interface RunInfo {
  stage: number // the human stage number (stageIndex + 1).
  score: number // the shared run score.
  enemiesLeft: number // enemies remaining to clear this stage (queued + alive).
  p1Lives: number // P1 lives.
  p2Lives: number // P2 lives, or -1 when solo (no P2 — the line is hidden).
}

interface PauseOverlayOpts {
  getInfo(): RunInfo // GameScene → a plain run snapshot (read once on open; the world is frozen).
  onClose(): void // GameScene → _closePause() (clear `paused` + consume the pending P/ESC edge).
}

// ── PauseOverlay — the read-only PAUSE modal (F7 Rich playability §5.3, Decisions D3/D9, AC4) ──
// A camera-FIXED modal drawn ON TOP of the (frozen) GameScene — programmer-art primitives + text only (AC4).
// Ported from the read-only `dead-cell` reference's PauseOverlay, TRIMMED to a tank game (D3): a dim backdrop,
// a slate-framed panel, a title, a CONTROLS section (the shared CONTROLS_ROWS — DRY with the Title), a small
// RUN summary (stage / score / enemies-left / P1·P2 lives), and a resume hint. It is NOT a separate Scene (a
// parallel Scene would need its own input plumbing + a pause handshake — the reference rejects that exact thing);
// instead it is a self-contained UI object GameScene news up on _openPause() and tears on _closePause(), while
// GameScene FREEZES gameplay via its `paused` flag (the SAME update() gate the gameOver branch uses). KISS +
// decoupled (SOLID): the overlay is handed ONE getInfo() reader (a plain snapshot) + an onClose() callback, so
// the run logic + the unfreeze logic stay in ONE place (the scene), exactly like the reference's getBuild/onClose.
//
// READ-ONLY (D9): there is nothing to select or confirm — it is an INFORMATION panel. No cursor bar, no UP/DOWN,
// no quit/options rows. It binds ONLY keydown-P and keydown-ESC → onClose (NOTHING else: no fire/start edge),
// so no gameplay edge can leak onto the resume frame (D4/D9).
//
// INPUT OWNERSHIP (the JustDown footgun, mirrored from the reference): core/Input owns the JustDown pause edge
// over P/ESC. This overlay uses its OWN scene.input.keyboard.on('keydown-…') handlers (added in the ctor, removed
// in _teardown) — the Phaser event bus is SEPARATE from the JustDown flags Input reads. BUT both fire on the SAME
// physical close-press in the SAME frame (Phaser dispatches keyboard events BEFORE scene.update), so the keydown-P
// close + Input's JustDown(P) would race: the close-press would re-open pause on the next sample(). GameScene
// ._closePause() calls input2.consumePause() to swallow the pending edge (the close→reopen race fix — D4).

const PANEL_W = 640
const PANEL_H = 460
const COL_KEY_DX = 220 // px from each section's left edge to the value/keys column (two fixed-x cells per row — CJK-safe).
const PANEL_COLOR = 0x10141c
const PANEL_STROKE = 0x5c6b7a // a neutral SLATE frame (the reference's neutral pause colour).

export class PauseOverlay {
  private scene: Phaser.Scene
  private _getInfo: () => RunInfo
  private _onClose: () => void
  private _destroyed: boolean
  private _objs: Phaser.GameObjects.GameObject[]
  private _handlers!: { close: () => void }

  // scene: GameScene. opts: { getInfo(), onClose() }. getInfo() returns the live run snapshot (read once);
  // onClose() tears the overlay down + resumes gameplay (GameScene owns the `paused` flag + the edge-consume).
  constructor(scene: Phaser.Scene, { getInfo, onClose }: PauseOverlayOpts) {
    this.scene = scene
    this._getInfo = getInfo
    this._onClose = onClose
    this._destroyed = false
    this._objs = []

    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2
    const panelLeft = cx - PANEL_W / 2
    const panelTop = cy - PANEL_H / 2
    const DEPTH = 200 // above everything in the world (the reference's modal depth band).

    // A dimming backdrop over the whole frozen scene (camera-fixed) so the overlay reads as a modal.
    this._add(
      scene.add
        .rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, 0x000000, 0.6)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(DEPTH),
    )

    // The panel + a neutral slate frame.
    const panel = scene.add
      .rectangle(cx, cy, PANEL_W, PANEL_H, PANEL_COLOR, 0.96)
      .setScrollFactor(0)
      .setDepth(DEPTH + 1)
    panel.setStrokeStyle(3, PANEL_STROKE, 0.9)
    this._add(panel)

    // Title + a resume hint.
    this._text(cx, panelTop + 28, t('pause.title'), { fontSize: '34px', color: '#e6edf3', fontStyle: 'bold' }, DEPTH + 2).setOrigin(0.5)
    this._text(cx, panelTop + PANEL_H - 22, t('pause.help'), { fontSize: '16px', color: '#8b949e' }, DEPTH + 2).setOrigin(0.5)

    // ── Two side-by-side sections: RUN (left) and CONTROLS (right). Each row is two fixed-x Text cells (label |
    // value), the CJK-safe column discipline (D9 — never padEnd, which only aligns under monospace). ──
    const sectionTop = panelTop + 84
    const leftX = panelLeft + 36
    const rightX = cx + 20
    this._renderRun(leftX, sectionTop, DEPTH + 2)
    this._renderControls(rightX, sectionTop, DEPTH + 2)

    // ── Dedicated CLOSE handlers (removed in _teardown) — the overlay's own bus, separate from Input's JustDown
    // reads. It binds ONLY P and ESC (no fire/start), so no gameplay edge leaks on resume (D9). The pending P/ESC
    // edge that races this close is swallowed by GameScene._closePause → input2.consumePause() (D4). ──
    this._handlers = { close: () => this._close() }
    const kb = scene.input.keyboard!
    kb.on('keydown-P', this._handlers.close)
    kb.on('keydown-ESC', this._handlers.close)
  }

  // ── RUN section (D3/AC4) — the live run snapshot, read ONCE (the world is frozen). Labelled lines reusing the
  // HUD's semantic colours (gold score, orange enemies, green lives). The P2 line is hidden when solo (p2Lives < 0). ──
  private _renderRun(x: number, top: number, depth: number) {
    const info = this._getInfo()
    const ROW = 34
    let y = top
    this._text(x, y, t('pause.run'), { fontSize: '20px', color: '#5c6b7a', fontStyle: 'bold' }, depth)
    y += ROW + 6
    this._label(x, y, t('pause.stage'), String(info.stage), '#e6edf3', depth)
    y += ROW
    this._label(x, y, t('pause.score'), String(info.score), '#feca57', depth)
    y += ROW
    this._label(x, y, t('pause.enemies'), String(info.enemiesLeft), '#f0932b', depth)
    y += ROW
    this._label(x, y, t('pause.p1Lives'), String(info.p1Lives), '#58d68d', depth)
    y += ROW
    if (info.p2Lives >= 0) this._label(x, y, t('pause.p2Lives'), String(info.p2Lives), '#58d68d', depth)
  }

  // ── CONTROLS section (D3) — the shared CONTROLS_ROWS as two fixed-x columns per row (action | keys), DRY with
  // the Title. ──
  private _renderControls(x: number, top: number, depth: number) {
    const ROW = 34
    let y = top
    this._text(x, y, t('controls.title'), { fontSize: '20px', color: '#5c6b7a', fontStyle: 'bold' }, depth)
    y += ROW + 6
    for (const [actionKey, keysKey] of CONTROLS_ROWS) {
      this._label(x, y, t(actionKey), t(keysKey), '#c9d1d9', depth)
      y += ROW
    }
  }

  // A two-cell row: a muted label (left) + a coloured value (right), each its own fixed-x Text (CJK-safe).
  private _label(x: number, y: number, label: string, value: string, valueColor: string, depth: number) {
    if (label) this._text(x, y, label, { fontSize: '17px', color: '#8b949e' }, depth)
    if (value) this._text(x + COL_KEY_DX, y, value, { fontSize: '17px', color: valueColor }, depth)
  }

  private _text(x: number, y: number, str: string, style: Phaser.Types.GameObjects.Text.TextStyle, depth: number): Phaser.GameObjects.Text {
    const txt = this.scene.add
      .text(x, y, str, { fontFamily: UI_FONT, ...style })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth)
    this._objs.push(txt)
    return txt
  }

  private _add(obj: Phaser.GameObjects.GameObject) {
    this._objs.push(obj)
  }

  // Close via the overlay's own P/ESC handler: tear down FIRST (so a second keypress can't double-fire), THEN
  // route to onClose() (GameScene._closePause — clear `paused` + consumePause for the pending P/ESC edge).
  private _close() {
    if (this._destroyed) return
    this._teardown()
    this._onClose()
  }

  // Tear down all GameObjects + remove the keyboard handlers (idempotent via the _destroyed guard). Split from
  // _close so GameScene's run-end / teardown paths can also force-close the overlay (the reference's split).
  private _teardown() {
    if (this._destroyed) return
    this._destroyed = true
    const kb = this.scene.input.keyboard!
    kb.off('keydown-P', this._handlers.close)
    kb.off('keydown-ESC', this._handlers.close)
    for (const o of this._objs) {
      if (o && o.active) o.destroy()
    }
    this._objs = []
  }

  // Force-close WITHOUT firing onClose (GameScene's _closePause + defensive teardown paths). GameScene drives the
  // unfreeze itself on those paths. Idempotent via the _destroyed guard (mirrors the reference's close()).
  close() {
    this._teardown()
  }
}
