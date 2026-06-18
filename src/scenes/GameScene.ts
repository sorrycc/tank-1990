import Phaser from 'phaser'
import {
  DESIGN_WIDTH,
  UI_FONT,
  PLAYFIELD_X,
  PLAYFIELD_Y,
  PLAYFIELD_W,
  PLAYFIELD_H,
  TILE_SIZE,
  TANK_SIZE,
  STEEL_WALL_THICKNESS,
  TWO_PLAYER,
  MAX_DT,
} from '../config/constants.js'
import { Input } from '../core/Input.js'
import { Tank } from '../entities/Tank.js'
import { BulletPool } from '../combat/BulletPool.js'

// ── GameScene (F0 scaffold §5.3 + F1 Tank core §5.4, Decisions 3/9/10/12, AC2/AC4/AC6/AC7/AC8) ──
// The run scene — the only scene with an Arcade physics world (gravity 0; F0 Decision 3 — top-down: tanks
// move on a grid, bullets travel straight, nothing falls; no `world.gravity` is ever set). F0 shipped a
// STUB drawing one placeholder playfield rect; F1 turns it into a DRIVABLE tank sandbox: a centered
// SQUARE test arena bounded by four STEEL border walls (static Arcade bodies), P1 (and P2 behind the
// TWO_PLAYER flag), the SINGLE Input owner, one pooled BulletPool, and a sample-ONCE tick loop.
//
// The real terrain grid + a SEEDED generated stage (F2), bullet↔terrain/tank/eagle COLLISION + damage,
// the eagle base, enemy tanks + the ONE FSM, the 4 enemy types, power-ups, the boss, and score/lives/HUD
// readouts each land in their own LATER feature (YAGNI). F1's hand-made arena is deliberately minimal —
// just enough to prove movement, walls, firing, and bullet despawn (Decision 10).
//
// dt BOUNDARY (Decision 9, AC7): update() computes the dt in SECONDS ONCE — `dt = min(delta/1000, MAX_DT)`
// — and feeds that to every tank.update + the pool.tick. No feel/cooldown/travel formula consumes the raw
// millisecond delta; the MAX_DT clamp means a tab-refocus spike can't teleport a body through a wall.
//
// INPUT SAMPLE-ONCE (Decision 12, AC2): update() calls `this.input2.sample()` EXACTLY once per frame and
// stores the snapshot — the sole-owner invariant for the two fire JustDown edges (see core/Input.ts).

const STEEL_COLOR = 0x8d99ae // slate steel border wall (programmer-art primitive — AC11).

export class GameScene extends Phaser.Scene {
  // F1 gameplay state (Phaser-coupled — the scene owns the world resources, SOLID). Null until create().
  private input2!: Input
  private bullets!: BulletPool
  private p1!: Tank
  private p2: Tank | null = null

  constructor() {
    super('Game')
  }

  create(): void {
    // Launch the HUD as a PARALLEL overlay (launch, NOT start, so GameScene keeps running underneath).
    // GameScene owns the HUD's lifecycle; a later feature stops it on shutdown. (F0 AC6 — HUD parallel.)
    this.scene.launch('HUD')

    // The centered 13×13 square playfield outline (kept from F0), drawn with a Graphics primitive (no
    // external assets — programmer-art only, AC11). Coordinates come from the single constants owner (DRY).
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

    // ── Steel-walled test arena (Decision 10, AC6) ── four thin STEEL rectangles as STATIC Arcade bodies
    // hugging the playfield INNER edges. Tanks collide with them (registered below) so a tank driving into
    // a wall stops at it (no tunnel, no escape). The real terrain grid replaces this in F2.
    const walls = this.physics.add.staticGroup()
    this._addWall(walls, PLAYFIELD_X, PLAYFIELD_Y, PLAYFIELD_W, STEEL_WALL_THICKNESS) // top.
    this._addWall(walls, PLAYFIELD_X, PLAYFIELD_Y + PLAYFIELD_H - STEEL_WALL_THICKNESS, PLAYFIELD_W, STEEL_WALL_THICKNESS) // bottom.
    this._addWall(walls, PLAYFIELD_X, PLAYFIELD_Y, STEEL_WALL_THICKNESS, PLAYFIELD_H) // left.
    this._addWall(walls, PLAYFIELD_X + PLAYFIELD_W - STEEL_WALL_THICKNESS, PLAYFIELD_Y, STEEL_WALL_THICKNESS, PLAYFIELD_H) // right.

    // ── The SINGLE Input owner + one shared BulletPool (Decision 12, AC2/AC9) ── Input always returns BOTH
    // players' intents; the SCENE (here) owns the 2-player policy via TWO_PLAYER. The pool is the shared
    // world resource the tanks fire into (the tank owns its cooldown/cap; the scene owns the pool — SOLID).
    this.input2 = new Input(this)
    this.bullets = new BulletPool(this)

    // ── Spawn the player tank(s) (Decision 10, AC8) ── at the classic bottom row, roughly the original P1
    // (left of center) + P2 (right of center) start cells. Grid-aligned to a tile lane so the first turn
    // re-center is a no-op. The body is TANK_SIZE (≈2 tiles).
    const bottomY = PLAYFIELD_Y + PLAYFIELD_H - STEEL_WALL_THICKNESS - TANK_SIZE / 2 - 2
    const p1x = PLAYFIELD_X + TILE_SIZE * 4 + TANK_SIZE / 2
    this.p1 = new Tank(this, p1x, bottomY, 'player')
    this.physics.add.collider(this.p1.collider, walls) // AC6 — P1 stops at the steel walls.

    if (TWO_PLAYER) {
      const p2x = PLAYFIELD_X + TILE_SIZE * 8 + TANK_SIZE / 2
      this.p2 = new Tank(this, p2x, bottomY, 'player')
      this.physics.add.collider(this.p2.collider, walls) // AC6 — P2 stops at the steel walls.
      this.physics.add.collider(this.p1.collider, this.p2.collider) // AC6 — the two tanks can't overlap.
    }
  }

  // Add ONE static-body steel border-wall rectangle to the group (programmer-art primitive — AC11). x/y is
  // the TOP-LEFT; a static body is positioned by its center, so we offset to the center on add.
  private _addWall(
    group: Phaser.Physics.Arcade.StaticGroup,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const rect = this.add.rectangle(x + w / 2, y + h / 2, w, h, STEEL_COLOR)
    group.add(rect)
    ;(rect.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject()
  }

  // ── Per-frame tick (Decision 9/12, AC2/AC4/AC7) ── dt in SECONDS, clamped, computed ONCE; sample the
  // input ONCE; resolve each player's fire off its edge (the scene owns the pool — Decision 12); tick the
  // tanks + the bullet pool. P2 is gated on TWO_PLAYER (AC8 — single-player works, P2 simply absent).
  update(_time: number, delta: number): void {
    // dt in SECONDS, clamped (AC7) — fed to every tank.update + the pool.tick; no raw delta reaches a formula.
    const dt = Math.min(delta / 1000, MAX_DT)

    // Sample the SINGLE Input owner ONCE this frame (AC2 — the sole JustDown owner for the fire edges).
    const s = this.input2.sample()

    // P1 — fire off the edge (the scene owns the pool, Decision 12), then tick movement/facing/cooldown.
    if (s.p1.firePressed) this.p1.tryFire(this.bullets)
    this.p1.update(dt, s.p1)

    // P2 — gated on TWO_PLAYER (AC8). Input still returned p2 (cheap); the SCENE decides whether to drive it.
    if (TWO_PLAYER && this.p2) {
      if (s.p2.firePressed) this.p2.tryFire(this.bullets)
      this.p2.update(dt, s.p2)
    }

    // Advance every live bullet (hand-integrated travel; despawn off the playfield bounds — AC5/AC9).
    this.bullets.tick(dt)
  }
}
