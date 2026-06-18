import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'

// ── GameOverScene (F0 scaffold §5.3, Decision 2/4, AC6) ──
// The run-end screen. Tank 1990 is ENDLESS (Decision 2 — there is NO Victory scene): a run ends ONLY
// when the eagle is destroyed OR all lives are spent, and GameScene hands off here. F0 ships a STUB:
// a heading + a prompt that routes back to Title on a key/click. A LATER feature reads a run-summary
// SNAPSHOT from scene-start data (final score / stage reached), banks the meta currency + bestScore /
// bestStage, and routes to the HUB so banked currency is immediately spendable. It is DECOUPLED
// (SOLID): it never reaches into the live GameScene. Text is positioned from the FIXED design
// resolution (Decision 1) so it stays centered under Scale.FIT.
export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver')
  }

  create(): void {
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    this.add
      .text(cx, cy - 80, 'GAME OVER', {
        fontFamily: UI_FONT,
        fontSize: '72px',
        color: '#e5484d',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, cy + 40, 'Press SPACE / ENTER or click to continue', {
        fontFamily: UI_FONT,
        fontSize: '24px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // Back to Title on key OR pointer. `once` so a held key can't double-fire (AC6). 'Title' is a
    // registered scene (main.ts), so the GameOver → Title transition is reachable.
    const toTitle = () => this.scene.start('Title')
    this.input.keyboard!.once('keydown-SPACE', toTitle)
    this.input.keyboard!.once('keydown-ENTER', toTitle)
    this.input.once('pointerdown', toTitle)
  }
}
