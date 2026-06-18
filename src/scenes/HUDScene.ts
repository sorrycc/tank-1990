import Phaser from 'phaser'
import { UI_FONT, HUD_PANEL_X, PLAYFIELD_Y } from '../config/constants.js'

// ── HUDScene (F0 scaffold §5.3, Decision 4, AC6) ──
// Runs in PARALLEL over GameScene (launched, not started). F0 ships a STUB: a small corner label in
// the right-side HUD panel band so the parallel overlay visibly runs. It is DECOUPLED from gameplay
// (SOLID): a LATER feature wires the live readouts (lives per player, score, the shared-currency
// bank, the staged enemy-queue icons, the "STAGE N CLEARED" boss banner) by reading the scene
// REGISTRY that GameScene writes — never reaching into the world directly. GameScene owns this
// scene's lifecycle. No network load.* — programmer-art only (AC11).
export class HUDScene extends Phaser.Scene {
  constructor() {
    super('HUD')
  }

  create(): void {
    // Corner label anchored to the right-side HUD-panel band (positions from the single constants
    // owner, DRY). Live readouts replace this in a later feature.
    this.add.text(HUD_PANEL_X, PLAYFIELD_Y, 'HUD', {
      fontFamily: UI_FONT,
      fontSize: '20px',
      color: '#8b949e',
    })
  }
}
