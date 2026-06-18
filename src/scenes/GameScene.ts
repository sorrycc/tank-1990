import Phaser from 'phaser'
import {
  DESIGN_WIDTH,
  UI_FONT,
  PLAYFIELD_X,
  PLAYFIELD_Y,
  PLAYFIELD_W,
  PLAYFIELD_H,
  TWO_PLAYER,
  MAX_DT,
} from '../config/constants.js'
import { Input } from '../core/Input.js'
import { Tank } from '../entities/Tank.js'
import { BulletPool } from '../combat/BulletPool.js'
import { stageConfig } from '../config/stages.js'
import { generateStage } from '../world/LevelGenerator.js'
import { TileMap } from '../world/TileMap.js'

// ── GameScene (F0 scaffold §5.3 + F1 Tank core §5.4 + F2 Procedural stages §5.4, Decisions 3/9/12 +
// D11/D13, AC2/AC4/AC7/AC8/AC10/AC11) ──
// The run scene — the only scene with an Arcade physics world (gravity 0; F0 Decision 3 — top-down: tanks
// move on a grid, bullets travel straight, nothing falls; no `world.gravity` is ever set). F0 shipped a
// STUB; F1 made a DRIVABLE tank sandbox on a hand-built STEEL-walled test arena. F2 REPLACES that test
// arena with a PROCEDURAL, SEEDED, headlessly-VERIFIED 13×13 stage (D11): `generateStage(seed,
// stageConfig(stageIndex))` → a `TileMap` that renders + bodies the terrain, with the two players spawned
// at the description's player-spawn window-centers (D13). The F1 Input + BulletPool + sample-once tick
// loop are UNCHANGED — only the WORLD swaps (the four hand-made walls → a generated TileMap).
//
// The seeded run/stage wiring (the seed + stageIndex come from a fixed dev value for now — D11/D12),
// bullet↔terrain/tank/eagle COLLISION + damage, the eagle-loss condition, enemy tanks + the ONE FSM, the
// 4 enemy types, power-ups, the boss, and score/lives/HUD readouts each land in their own LATER feature
// (YAGNI). F2's scope is "GameScene builds the generated stage instead of the test arena" (D11).
//
// dt BOUNDARY (Decision 9, AC7): update() computes the dt in SECONDS ONCE — `dt = min(delta/1000, MAX_DT)`
// — and feeds that to every tank.update + the pool.tick. No feel/cooldown/travel formula consumes the raw
// millisecond delta; the MAX_DT clamp means a tab-refocus spike can't teleport a body through a wall.
//
// INPUT SAMPLE-ONCE (Decision 12, AC2): update() calls `this.input2.sample()` EXACTLY once per frame and
// stores the snapshot — the sole-owner invariant for the two fire JustDown edges (see core/Input.ts).

// A fixed dev seed for the generated stage (D11/D12 — the run/seed wiring is a LATER feature; F2 builds a
// stable stage so the sandbox is reproducible). The stageIndex defaults to 0 (the first stage).
const DEV_SEED = 0x7a4b1990
const DEV_STAGE_INDEX = 0

export class GameScene extends Phaser.Scene {
  // F1 gameplay state (Phaser-coupled — the scene owns the world resources, SOLID). Null until create().
  private input2!: Input
  private bullets!: BulletPool
  private p1!: Tank
  private p2: Tank | null = null
  // F2 — the generated terrain (renders + bodies the stage; tanks collide with its tank-blocking bodies).
  private tileMap!: TileMap

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
    g.lineStyle(2, 0x30363d, 1) // subtle border (the TileMap backdrop fills the interior).
    g.strokeRect(PLAYFIELD_X, PLAYFIELD_Y, PLAYFIELD_W, PLAYFIELD_H)

    this.add
      .text(DESIGN_WIDTH / 2, PLAYFIELD_Y - 28, `STAGE ${DEV_STAGE_INDEX + 1}`, {
        fontFamily: UI_FONT,
        fontSize: '20px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // ── Build the generated stage (F2 §5.4, D11/D13, AC10) ── pick the stage's difficulty params via the
    // PURE stageConfig(stageIndex), generate a SEEDED 13×13 description (terrain grid + enclosed reachable
    // eagle fort + spawn points — the verifier proves these headlessly), and render + body it via TileMap.
    // This REPLACES the F1 four-wall test arena; the generated terrain bounds the tanks now.
    const cfg = stageConfig(DEV_STAGE_INDEX)
    const desc = generateStage(DEV_SEED, cfg)
    this.tileMap = new TileMap(this, desc)

    // ── The SINGLE Input owner + one shared BulletPool (Decision 12, AC2/AC9) ── Input always returns BOTH
    // players' intents; the SCENE (here) owns the 2-player policy via TWO_PLAYER. The pool is the shared
    // world resource the tanks fire into (the tank owns its cooldown/cap; the scene owns the pool — SOLID).
    this.input2 = new Input(this)
    this.bullets = new BulletPool(this)

    // ── Spawn the player tank(s) at the description's player spawns (F2 §5.4, D11/D13, AC8) ── each spawn
    // x/y is the ABSOLUTE 2×2-WINDOW CENTER (D13), so the TANK_SIZE (≈2-tile) body straddles EXACTLY the
    // 2×2 footprint the spawn's tankFits cleared — never one cell up-left into uncleared territory. This
    // REPLACES the F1 hand-math; the generator owns the spawn geometry now.
    const sp1 = desc.playerSpawns[0]
    this.p1 = new Tank(this, sp1.x, sp1.y, 'player')
    this._collideTankWithTerrain(this.p1) // AC10 — P1 stops at brick/steel/water/the base.

    if (TWO_PLAYER) {
      const sp2 = desc.playerSpawns[1]
      this.p2 = new Tank(this, sp2.x, sp2.y, 'player')
      this._collideTankWithTerrain(this.p2) // AC10 — P2 stops at the terrain.
      this.physics.add.collider(this.p1.collider, this.p2.collider) // the two tanks can't overlap.
    }
  }

  // Collide a tank against BOTH tank-blocking body groups (F2 §5.4, D7/D11, AC10): `solidBodies` (STEEL +
  // BASE + every BRICK sub-cell) AND `waterBodies` (WATER blocks tanks; bullets pass over it LATER, D7).
  private _collideTankWithTerrain(tank: Tank): void {
    this.physics.add.collider(tank.collider, this.tileMap.solidBodies)
    this.physics.add.collider(tank.collider, this.tileMap.waterBodies)
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
