import Phaser from 'phaser'
import {
  DESIGN_WIDTH,
  UI_FONT,
  PLAYFIELD_X,
  PLAYFIELD_Y,
  PLAYFIELD_W,
  PLAYFIELD_H,
} from '../config/constants.js'

// ── GameScene (F0 scaffold §5.3, Decision 3/4, AC5/AC6) ──
// The run scene. F0 ships a STUB: it draws ONE placeholder rectangle (the centered square playfield
// outline) so the scene visibly runs, then launches the parallel HUD overlay. NO gameplay yet — the
// terrain/tank/bullet/eagle entities, the seeded 13×13 stage generator, the input intent snapshot +
// per-frame dt handling, the enemy FSM, power-ups, and the boss each land in their own LATER feature
// (YAGNI). It opts NO Arcade gravity (Decision 3 — top-down: tanks move on a grid, nothing falls).
export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game')
  }

  create(): void {
    // Launch the HUD as a PARALLEL overlay (launch, NOT start, so GameScene keeps running underneath).
    // GameScene owns the HUD's lifecycle; a later feature stops it on shutdown. (AC6 — HUD parallel.)
    this.scene.launch('HUD')

    // Placeholder: the centered 13×13 square playfield outline, drawn with a Graphics primitive (no
    // external assets — programmer-art only, AC11). Later features draw the terrain grid, the eagle
    // base, and the tanks inside this rect. Coordinates come from the single constants owner (DRY).
    const g = this.add.graphics()
    g.fillStyle(0x11161f, 1) // dark playfield fill.
    g.fillRect(PLAYFIELD_X, PLAYFIELD_Y, PLAYFIELD_W, PLAYFIELD_H)
    g.lineStyle(2, 0x30363d, 1) // subtle border.
    g.strokeRect(PLAYFIELD_X, PLAYFIELD_Y, PLAYFIELD_W, PLAYFIELD_H)

    this.add
      .text(DESIGN_WIDTH / 2, PLAYFIELD_Y - 28, 'STAGE (placeholder)', {
        fontFamily: UI_FONT,
        fontSize: '20px',
        color: '#8b949e',
      })
      .setOrigin(0.5)
  }
}
