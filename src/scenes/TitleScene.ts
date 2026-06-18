import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'

// ── TitleScene (F0 scaffold §5.3, Decision 2/4, AC6) ──
// Shows the game title + a Start prompt and routes to the HUB on a key OR a pointer (the flow is
// Title → Hub → Game; the Hub is the between-runs upgrade lobby — its real two-column P1|P2 trees +
// shared-currency readout are a LATER feature, this is a stub). All text is positioned from the
// FIXED design resolution (Decision 1) — never window.innerWidth — so it stays centered under
// Scale.FIT regardless of viewport size. Strings are inline literals in F0 (the i18n layer lands in
// F1, then every text site swaps to t('...') against the same UI_FONT).
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title')
  }

  create(): void {
    const cx = DESIGN_WIDTH / 2

    this.add
      .text(cx, 220, 'TANK 1990', {
        fontFamily: UI_FONT,
        fontSize: '88px',
        color: '#e6edf3',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, 312, '坦克大战 — Battle City', {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, DESIGN_HEIGHT - 120, 'Press SPACE / ENTER or click to start', {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#58d68d',
      })
      .setOrigin(0.5)

    // Enter the HUB on key OR pointer. `once` so a held key / double-tap can't fire the transition
    // twice (AC6). Pointer is bound on the scene input so a click anywhere counts. Each target ('Hub')
    // is a registered scene (main.ts), so the flow is reachable.
    const enterHub = () => this.scene.start('Hub')
    this.input.keyboard!.once('keydown-SPACE', enterHub)
    this.input.keyboard!.once('keydown-ENTER', enterHub)
    this.input.once('pointerdown', enterHub)
  }
}
