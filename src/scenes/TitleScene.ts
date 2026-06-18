import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { t, CONTROLS_ROWS } from '../i18n/index.js'
import { Sound } from '../audio/Sound.js'
import { createMetaState } from '../core/MetaState.js'

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

    // ── F7 (D6/AC6) — the BEST line under the subtitle ── read MetaState ONCE in create() (the impure save
    // boundary — createMetaState() load()s a fresh view). A fresh save reads 0/0 (the defensive save degrades to
    // defaults — never blank/crash). Localised via t('title.best', {score, stage}); positioned off the FIXED
    // design resolution (cx + a fixed Y) so it centers under Scale.FIT — the Title's existing layout discipline.
    const meta = createMetaState()
    this.add
      .text(cx, 234, t('title.best', { score: meta.getBestScore(), stage: meta.getBestStage() }), {
        fontFamily: UI_FONT,
        fontSize: '18px',
        color: '#feca57', // gold — matches the score/best chrome.
      })
      .setOrigin(0.5)

    // ── Controls reference (F6 §5.4, D9, AC7) — the shared CONTROLS_ROWS so a first-time player discovers BOTH
    // schemes. Two fixed-x columns per row (action label | keys), the CJK-safe alignment discipline (D9 — never
    // padEnd, which only aligns under monospace). Six rows in ONE centered column block; the key TOKENS stay
    // literal (they name physical keys). All positions derive from DESIGN_WIDTH/DESIGN_HEIGHT (never
    // window.innerWidth) so it centers under Scale.FIT — the existing Title layout discipline.
    this.add
      .text(cx, 280, t('controls.title'), { fontFamily: UI_FONT, fontSize: '22px', color: '#5c6b7a', fontStyle: 'bold' })
      .setOrigin(0.5)

    const ROW_H = 34
    const rowsTop = 320
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
