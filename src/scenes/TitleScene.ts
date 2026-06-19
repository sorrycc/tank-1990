import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT, MAX_START_STAGE } from '../config/constants.js'
import { t, CONTROLS_ROWS } from '../i18n/index.js'
import { Sound } from '../audio/Sound.js'
import { createMetaState } from '../core/MetaState.js'
import { loadSettings, saveSettings } from '../util/settings.js'
import type { Difficulty } from '../config/stages.js'

// ── TitleScene (F0 scaffold §5.3 → F5 §5.4 → F6 §5.4, Decision 2/4/D12/D9, AC7/AC9) ──
// Shows the game title + a Start prompt and routes to the HUB on a key OR a pointer (the flow is
// Title → Hub → Game). All text is positioned from the FIXED design resolution (Decision 1) — never
// window.innerWidth — so it stays centered under Scale.FIT regardless of viewport size. F5 (D12/AC9):
// the F0 inline literals were SWAPPED to t('...') against the same UI_FONT. F6 (D9/AC7): a both-players
// CONTROLS reference (the reference's CONTROLS_ROWS pattern — two fixed-x columns per row) so a first-time
// player discovers every binding (P1 = WASD + J · P2 = arrows + Numpad0 · SPACE/ENTER start · M mute), and a
// menu Sound for the start blip (a no-op under NoAudio — AC6). The live locale is set ONCE at boot in main.ts.
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title')
  }

  create(): void {
    const cx = DESIGN_WIDTH / 2

    // F6 (D6/AC6) — the menu-blip façade (shares Phaser's ONE AudioContext; a no-op under NoAudio). The Title's
    // start gesture is the FIRST user gesture, which resumes Phaser's suspended context — so this blip may be
    // silent on the very first press but every later sound (the Hub/game) plays.
    const sfx = new Sound(this)

    // Heading + subtitle near the TOP (repositioned to make room for the controls reference below — every Y is
    // off the FIXED design resolution so it stays centered under Scale.FIT, the existing Title discipline).
    this.add
      .text(cx, 120, t('title.heading'), {
        fontFamily: UI_FONT,
        fontSize: '80px',
        color: '#e6edf3',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, 196, t('title.subtitle'), {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // ── F7 (D6/AC6) — the BEST line under the subtitle + the high-score table below the controls ── read
    // MetaState ONCE in create() (the impure save boundary — createMetaState() load()s a fresh view); the same
    // instance feeds the BEST line here AND the top-5 table further down (DRY). A fresh save reads 0/0 + an empty
    // table (the defensive save degrades to defaults — never blank/crash). Localised via t('title.best', {score,
    // stage}); positioned off the FIXED design resolution (cx + a fixed Y) so it centers under Scale.FIT.
    const meta = createMetaState()
    this.add
      .text(cx, 234, t('title.best', { score: meta.getBestScore(), stage: meta.getBestStage() }), {
        fontFamily: UI_FONT,
        fontSize: '18px',
        color: '#feca57', // gold — matches the score/best chrome.
      })
      .setOrigin(0.5)

    // ── F-difficulty-select chooser (difficulty-select §5.4, D7, AC7) ── the Title difficulty/start-stage row,
    // positioned in the gap under the BEST line (off the FIXED design resolution so it centers under Scale.FIT — the
    // Title's discipline). loadSettings() reads the persisted preference ONCE here (the impure save boundary, like
    // createMetaState() above); a mutable local mirrors it. The difficulty label + the three levels render on ONE
    // centered row (the SELECTED level highlighted); a start-stage readout + a key hint sit just below. ←/→ cycle the
    // difficulty, ↑/↓ adjust the start stage (clamped [0, MAX_START_STAGE]); each change saveSettings()s + re-renders
    // the row + plays the existing uiMove blip (a no-op under NoAudio). The start gesture (SPACE/ENTER/pointer) is
    // UNCHANGED — it still routes to 'Hub' (the flow is intact); only the persisted preference is set before the run.
    const settings = loadSettings()
    const LEVELS: Difficulty[] = ['easy', 'normal', 'hard']

    // The difficulty label (left of the level chips) + one chip per level on the SAME centered row. Fixed-x columns
    // (the CJK-safe alignment discipline — never derived from a label's pixel width). The chip Text objects are
    // captured so a key change re-tints them in place (the selected one bright, the rest dim) — no scene rebuild.
    const DIFF_Y = 258
    this.add
      .text(cx - 200, DIFF_Y, t('title.difficulty'), { fontFamily: UI_FONT, fontSize: '20px', color: '#8b949e' })
      .setOrigin(0, 0.5)
    const chips: Phaser.GameObjects.Text[] = []
    const CHIP_X0 = cx - 40 // the first chip's left x; each subsequent chip is offset by CHIP_DX (fixed, CJK-safe).
    const CHIP_DX = 110
    for (let i = 0; i < LEVELS.length; i++) {
      chips.push(
        this.add
          .text(CHIP_X0 + i * CHIP_DX, DIFF_Y, t(`title.diff.${LEVELS[i]}`), {
            fontFamily: UI_FONT,
            fontSize: '20px',
            color: '#8b949e',
          })
          .setOrigin(0, 0.5),
      )
    }
    // The start-stage readout + the one-line key hint, just below the chooser row (same centered discipline).
    const startStageText = this.add
      .text(cx, DIFF_Y + 28, t('title.startStage', { n: settings.startStage }), {
        fontFamily: UI_FONT,
        fontSize: '18px',
        color: '#c9d1d9',
      })
      .setOrigin(0.5)
    this.add
      .text(cx, DIFF_Y + 50, t('title.diffHint'), { fontFamily: UI_FONT, fontSize: '15px', color: '#5c6b7a' })
      .setOrigin(0.5)

    // Re-render the chooser from the current `settings` (the selected level bright green, the rest dim; the
    // start-stage readout re-interpolated). Called once now + after every key change (DRY — one render path).
    const renderChooser = (): void => {
      for (let i = 0; i < LEVELS.length; i++) {
        chips[i].setColor(LEVELS[i] === settings.difficulty ? '#58d68d' : '#8b949e')
      }
      startStageText.setText(t('title.startStage', { n: settings.startStage }))
    }
    renderChooser()

    // ←/→ cycle the difficulty (wrapping over the three levels); ↑/↓ adjust the start stage within [0, MAX_START_STAGE].
    // Each change persists (saveSettings) + re-renders + blips (uiMove — the quiet nav tick; a no-op under NoAudio).
    const cycleDiff = (dir: number): void => {
      const idx = LEVELS.indexOf(settings.difficulty)
      settings.difficulty = LEVELS[(idx + dir + LEVELS.length) % LEVELS.length]
      saveSettings(settings)
      renderChooser()
      sfx.uiMove()
    }
    const adjustStage = (delta: number): void => {
      const next = Math.max(0, Math.min(MAX_START_STAGE, settings.startStage + delta))
      if (next === settings.startStage) return // already at a bound — no save / blip (the Hub's "no-op on a clamp" feel).
      settings.startStage = next
      saveSettings(settings)
      renderChooser()
      sfx.uiMove()
    }
    this.input.keyboard!.on('keydown-LEFT', () => cycleDiff(-1))
    this.input.keyboard!.on('keydown-RIGHT', () => cycleDiff(1))
    this.input.keyboard!.on('keydown-UP', () => adjustStage(1))
    this.input.keyboard!.on('keydown-DOWN', () => adjustStage(-1))

    // ── Controls reference (F6 §5.4, D9, AC7) — the shared CONTROLS_ROWS so a first-time player discovers BOTH
    // schemes. Two fixed-x columns per row (action label | keys), the CJK-safe alignment discipline (D9 — never
    // padEnd, which only aligns under monospace). Six rows in ONE centered column block; the key TOKENS stay
    // literal (they name physical keys). All positions derive from DESIGN_WIDTH/DESIGN_HEIGHT (never
    // window.innerWidth) so it centers under Scale.FIT — the existing Title layout discipline.
    // (F-difficulty-select §5.4) — the controls block is pushed DOWN below the new chooser row above (it occupies the
    // 258–308 band); ROW_H tightened 34→30 so the controls + the hi-score table below still clear the start prompt.
    this.add
      .text(cx, 336, t('controls.title'), { fontFamily: UI_FONT, fontSize: '22px', color: '#5c6b7a', fontStyle: 'bold' })
      .setOrigin(0.5)

    const ROW_H = 30
    const rowsTop = 372
    const LABEL_X = cx - 140 // the action-label column (left-anchored, fixed x — CJK-safe).
    const KEYS_X = cx + 30 // the keys column (left-anchored, fixed x — never derived from the label's width).
    for (let i = 0; i < CONTROLS_ROWS.length; i++) {
      const y = rowsTop + i * ROW_H
      const [actionKey, keysKey] = CONTROLS_ROWS[i]
      this.add
        .text(LABEL_X, y, t(actionKey), { fontFamily: UI_FONT, fontSize: '18px', color: '#8b949e' })
        .setOrigin(0, 0.5)
      this.add
        .text(KEYS_X, y, t(keysKey), { fontFamily: UI_FONT, fontSize: '18px', color: '#c9d1d9' })
        .setOrigin(0, 0.5)
    }

    // ── High-score table (the persistent top-5 — D5/AC3) ── read off the SAME MetaState instance as the BEST
    // line (one extra getHighScores() read — DRY). A heading + up to 5 rows (rank · score · stage) via t(),
    // or a single empty-state line for a fresh save. All Y off the FIXED design resolution (centers under
    // Scale.FIT), positioned below the controls block — the Title's existing layout discipline.
    const HI_TITLE_Y = rowsTop + CONTROLS_ROWS.length * ROW_H + 18
    this.add
      .text(cx, HI_TITLE_Y, t('hi.title'), { fontFamily: UI_FONT, fontSize: '22px', color: '#5c6b7a', fontStyle: 'bold' })
      .setOrigin(0.5)
    const scores = meta.getHighScores()
    if (scores.length === 0) {
      this.add
        .text(cx, HI_TITLE_Y + 34, t('hi.empty'), { fontFamily: UI_FONT, fontSize: '18px', color: '#8b949e' })
        .setOrigin(0.5)
    } else {
      const HI_ROW_H = 26
      for (let i = 0; i < scores.length; i++) {
        const { score, stage } = scores[i]
        this.add
          .text(cx, HI_TITLE_Y + 32 + i * HI_ROW_H, t('hi.row', { rank: i + 1, score, stage }), {
            fontFamily: UI_FONT,
            fontSize: '18px',
            color: '#c9d1d9',
          })
          .setOrigin(0.5)
      }
    }

    this.add
      .text(cx, DESIGN_HEIGHT - 72, t('title.start'), {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#58d68d',
      })
      .setOrigin(0.5)

    // Enter the HUB on key OR pointer. `once` so a held key / double-tap can't fire the transition
    // twice (AC6). Pointer is bound on the scene input so a click anywhere counts. Each target ('Hub')
    // is a registered scene (main.ts), so the flow is reachable. F6 (D6/AC6) — a start blip on the gesture.
    const enterHub = () => {
      sfx.uiSelect() // F6 (AC6) — the Title start blip (the first gesture also resumes the context).
      this.scene.start('Hub')
    }
    this.input.keyboard!.once('keydown-SPACE', enterHub)
    this.input.keyboard!.once('keydown-ENTER', enterHub)
    this.input.once('pointerdown', enterHub)
  }
}
