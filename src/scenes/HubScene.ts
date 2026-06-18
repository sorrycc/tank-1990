import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'

// ── HubScene (F0 scaffold §5.3, Decision 4, AC6) ──
// The between-runs META HUB lobby. F0 ships a STUB: a heading + a START prompt that launches the
// run. The REAL Hub (a LATER feature) is the two-column layout — a P1 upgrade tree | a P2 upgrade
// tree with two cursors and ONE shared-currency readout, where a buy debits the shared pool and
// applyUpgrades(slot) folds each player's tree over the tank base stats (the locked meta-hub
// decision). A 1-player session will hide the P2 column. Reachable from BOTH Title and (later)
// GameOver so banked currency is immediately spendable. All text is positioned from the FIXED design
// resolution (Decision 1) so it stays centered under Scale.FIT.
export class HubScene extends Phaser.Scene {
  constructor() {
    super('Hub')
  }

  create(): void {
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    this.add
      .text(cx, cy - 120, 'HUB', {
        fontFamily: UI_FONT,
        fontSize: '64px',
        color: '#e6edf3',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, cy - 40, 'Permanent upgrades (P1 | P2) — coming soon', {
        fontFamily: UI_FONT,
        fontSize: '22px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    this.add
      .text(cx, cy + 80, 'Press SPACE / ENTER or click to START', {
        fontFamily: UI_FONT,
        fontSize: '26px',
        color: '#58d68d',
      })
      .setOrigin(0.5)

    // Launch the run on key OR pointer. `once` so a held key can't double-fire (AC6). 'Game' is a
    // registered scene (main.ts), so the Hub → Game transition is reachable.
    const startRun = () => this.scene.start('Game')
    this.input.keyboard!.once('keydown-SPACE', startRun)
    this.input.keyboard!.once('keydown-ENTER', startRun)
    this.input.once('pointerdown', startRun)
  }
}
