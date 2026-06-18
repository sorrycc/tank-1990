import Phaser from 'phaser'
import {
  TANK_SIZE,
  TANK_SPEED,
  FIRE_COOLDOWN,
  MAX_PLAYER_BULLETS,
  SUB_CELL_SIZE,
  PLAYFIELD_X,
  PLAYFIELD_Y,
  LANE_SNAP_EPSILON,
  TANK_MAX_HP,
  SPAWN_IFRAME,
} from '../config/constants.js'
import type { PlayerIntent } from '../core/Input.js'
import type { BulletPool } from '../combat/BulletPool.js'

// ── Tank entity (F1 Tank core §5.2/§5.3, Decisions 1/5/6/7/12, AC3/AC4/AC6) ──
// A plain class — the SAME shape as the read-only `dead-cell` reference's entities/Player.ts (Decision 1):
// it HOLDS a Phaser.GameObjects.Rectangle that owns the Arcade body + a SEPARATE visible rect, owns ALL
// its feel state, and is news'd-up + ticked by GameScene each frame — NOT on the display-list lifecycle.
// Keeping the controller off that lifecycle puts the movement logic in one readable place (SOLID).
//
// COLLIDER / RECT SPLIT (Decision 1/6 — the reference's review-issue #6 lesson): `collider` OWNS the
// Arcade body and is INVISIBLE (alpha 0); Arcade owns ITS position (it writes the resolved x/y back in
// postUpdate). We NEVER hand-move it except the ONE gated turn-time re-center (§5.3 step 4). The VISIBLE
// `rect` + `barrel` are positioned TO the body's center each frame — scaling/moving them never touches
// the body. Arcade derives the body position from the owning object's transform, so hand-setting the
// body-owner's x/y each frame would fight Arcade's write-back → jitter. The split kills that.
//
// dt UNITS (the project's dt convention): GameScene converts at the boundary — `tank.update(delta/1000,…)`
// clamped to MAX_DT — so `update(dt, intent)` here ALWAYS treats `dt` as SECONDS. The cooldown decay is in
// seconds; movement is velocity-based (px/s) so it is framerate-independent without integrating dt itself.
//
// CLASSIC BATTLE CITY MOVEMENT (Decision 5/6, AC3) — the no-diagonal invariant is STRUCTURAL:
//   • Steady driving is strictly SINGLE-AXIS: the body moves at ±TANK_SPEED along the faced cardinal and
//     the CROSS-axis velocity component is held at EXACTLY 0. We NEVER set both components non-zero in one
//     frame, so Arcade can NEVER integrate a diagonal — AC3 is structural, not emergent.
//   • On a TURN (facing switches between a horizontal and a vertical cardinal) we re-center the body's
//     CROSS corner to its nearest SUB_CELL_SIZE (24 px) lane in ONE discrete write to body.position[cross]
//     (the cross VELOCITY stays 0 — still no diagonal), gated by a LANE_SNAP_EPSILON dead-band (no
//     oscillation) and a !blocked/!touching collision check (never fight a collider Arcade is resolving).

export type TankSide = 'player' | 'enemy'
export type Facing = 'up' | 'down' | 'left' | 'right'

const BODY_COLOR_PLAYER = 0x6ab04c // green player tank (programmer-art primitive — AC11).
const BODY_COLOR_ENEMY = 0xeb4d4b // red enemy tank (reserved — F1 only ever builds 'player' tanks, D7).
const BARREL_COLOR = 0xdfe6e9 // light gun barrel marker so the facing reads.
const BARREL_LEN = TANK_SIZE * 0.55 // px — barrel length along facing.
const BARREL_THICK = 8 // px — barrel thickness across facing.

export class Tank {
  scene: Phaser.Scene
  collider: Phaser.GameObjects.Rectangle // OWNS the Arcade body (alpha 0); Arcade owns its position.
  body: Phaser.Physics.Arcade.Body
  rect: Phaser.GameObjects.Rectangle // the visible tank; positioned TO the body center each frame.
  barrel: Phaser.GameObjects.Rectangle // a small facing marker (the gun); positioned TO the body center.

  side: TankSide
  behavior: string // 'player' for F1; the enemy FSM extends this later (D7 — 'basic'|'fast'|'power'|'armor'|'boss').
  facing: Facing
  lastDriveAxis: 'x' | 'y' | null // the axis we drove LAST frame; a TURN = chosen ≠ this (§5.3 step 2/4).

  cooldownTimer: number // s — decays by dt; a fire is allowed at ≤ 0 (AC4).
  liveBullets: number // current shots out (incremented on fire, decremented on release — AC4/AC5).
  maxBullets: number // the per-tank live cap (MAX_PLAYER_BULLETS — the classic "N shots out" rule).

  // ── F3 combat state (F3 §5.2, Decision D7/D11, AC5/AC8) — additive over the F1 spine ──
  // hp/maxHp: the hit-funnel HP (TANK_MAX_HP = 1 default; an armor enemy is constructed with hp > 1 for
  // multi-hit "for free" via the same subtraction — D7). alive: the death guard so onHit's death path runs
  // ONCE. spawnIframe: SECONDS of post-respawn invulnerability (ticked down in update; isHittable() false
  // while > 0 so a fresh respawn can't be instantly re-killed — D7/D11). onDeath: the scene wires the
  // life/respawn-or-stay-down path (SOLID — the Tank reports its death, the scene owns the run economy, D11).
  hp: number
  maxHp: number
  alive: boolean
  spawnIframe: number
  onDeath: (() => void) | null

  constructor(scene: Phaser.Scene, x: number, y: number, side: TankSide, behavior = 'player', hp = TANK_MAX_HP) {
    this.scene = scene
    this.side = side
    this.behavior = behavior
    this.facing = 'up' // tanks start facing up (the classic player spawn orientation).
    this.lastDriveAxis = null
    this.cooldownTimer = 0
    this.liveBullets = 0
    this.maxBullets = MAX_PLAYER_BULLETS

    // F3 combat state — a fresh tank is alive at full HP with NO spawn i-frames (the scene arms them on a
    // respawn via respawnAt). onDeath is wired by the scene after construction (D11).
    this.maxHp = hp
    this.hp = hp
    this.alive = true
    this.spawnIframe = 0
    this.onDeath = null

    const fill = side === 'player' ? BODY_COLOR_PLAYER : BODY_COLOR_ENEMY

    // ── Physics collider (owns the body) + separate visual rect (Decision 1/6 — the reference's split) ──
    // `collider` owns the Arcade body, is INVISIBLE (alpha 0). Arcade owns its position; we only hand-write
    // body.position on the gated turn-time re-center (§5.3 step 4), never per-frame. Body size FIXED here.
    this.collider = scene.add.rectangle(x, y, TANK_SIZE, TANK_SIZE, fill).setAlpha(0)
    scene.physics.add.existing(this.collider)
    this.body = this.collider.body as Phaser.Physics.Arcade.Body
    // Tanks are SOLID movers that push against walls/each other (no overlap) — Arcade separates them.
    this.body.setCollideWorldBounds(false) // the test arena's STEEL walls (static bodies) bound it, not world bounds.

    // The VISIBLE tank rect + the barrel marker, positioned TO the body center each frame (decoupled from
    // the body — moving them never touches the body). Drawn with primitives only (AC11).
    this.rect = scene.add.rectangle(x, y, TANK_SIZE, TANK_SIZE, fill)
    this.barrel = scene.add.rectangle(x, y, BARREL_THICK, BARREL_LEN, BARREL_COLOR)
    this._orientBarrel() // initial orientation matches `facing`.
  }

  // ── Tick one frame (Decision 5/6/12, AC3/AC4) — dt in SECONDS. Order mirrors §5.3:
  //   1) cooldown decay → 2) pick the ONE driving axis (4-dir, no diagonal) + facing → 3) drive (exactly
  //      one velocity component non-zero) → 4) turn-time re-center (gated discrete snap) → 5) visuals. ──
  update(dt: number, intent: PlayerIntent): void {
    // F3 (D7/D11, AC8) — a DEAD tank is parked: the scene stops driving it until a respawn, but a defensive
    // guard here means a stray tick can't move/fire a corpse. Hold the body still + leave the visual hidden.
    if (!this.alive) {
      this.body.setVelocity(0, 0)
      return
    }

    // F3 spawn i-frames (D7/D11, AC5/AC8) — decay the post-respawn invulnerability window + BLINK the visual
    // while it ticks (the cue that the tank can't be hit). isHittable() reads this same timer, so the gate +
    // the cue can never disagree. Restore full alpha the frame it expires.
    if (this.spawnIframe > 0) {
      this.spawnIframe = Math.max(0, this.spawnIframe - dt)
      // A fast alpha pulse (~10 Hz) off the scene clock — purely cosmetic (the body is unaffected).
      const blink = Math.floor(this.scene.time.now / 100) % 2 === 0 ? 0.35 : 1
      this.rect.setAlpha(this.spawnIframe > 0 ? blink : 1)
      if (this.spawnIframe === 0) this.rect.setAlpha(1)
    }

    // 1) Cooldown decay (seconds) — a fire is allowed once this hits 0 (AC4).
    this.cooldownTimer = Math.max(0, this.cooldownTimer - dt)

    // 2) Pick the ONE driving axis (4-dir, no diagonal — Decision 5/AC3). Opposing keys on an axis already
    // cancelled to 0 in Input (dirX/dirY ∈ {−1,0,1}). We choose EXACTLY ONE cardinal so motion is strictly
    // 4-directional: prefer the still-held CURRENT facing axis (no turn), else adopt a newly-pressed axis.
    const { dirX, dirY } = intent
    const currentAxisHeld =
      (this.facing === 'left' || this.facing === 'right') ? dirX !== 0 : dirY !== 0

    let driveAxis: 'x' | 'y' | null = null
    if (currentAxisHeld) {
      // Keep driving the current facing's axis (no turn) — update facing to its held sign in case the
      // player reversed along the same axis (e.g. left→right is a same-axis flip, not a cross-axis turn).
      driveAxis = this.facing === 'left' || this.facing === 'right' ? 'x' : 'y'
    } else if (dirX !== 0) {
      driveAxis = 'x'
    } else if (dirY !== 0) {
      driveAxis = 'y'
    }

    if (driveAxis === 'x') {
      this.facing = dirX > 0 ? 'right' : 'left'
    } else if (driveAxis === 'y') {
      this.facing = dirY > 0 ? 'down' : 'up'
    }

    // A TURN is when the chosen driving axis DIFFERS from the axis we drove last frame (so `turned` is true
    // ONLY on the frame a player switches between a horizontal and a vertical cardinal — §5.3 step 2).
    const turned = driveAxis !== null && this.lastDriveAxis !== null && driveAxis !== this.lastDriveAxis

    // 3) Drive — exactly ONE velocity component non-zero (Decision 5/AC3). The cross component is held at
    // EXACTLY 0, so Arcade never integrates a diagonal (the no-diagonal invariant is STRUCTURAL). Idle → 0,0.
    if (driveAxis === 'x') {
      this.body.setVelocity(this.facing === 'right' ? TANK_SPEED : -TANK_SPEED, 0)
    } else if (driveAxis === 'y') {
      this.body.setVelocity(0, this.facing === 'down' ? TANK_SPEED : -TANK_SPEED)
    } else {
      this.body.setVelocity(0, 0)
    }

    // 4) Turn-time re-center — a DISCRETE, collision-aware, velocity-ONLY snap (Decision 5/6, AC3), run
    // ONLY on a turn frame. On a non-turn frame do NOTHING here (steady single-axis driving already holds
    // the cross velocity at 0, so the tank stays in its lane). On a turn we re-center the body's CROSS
    // corner to its nearest SUB_CELL_SIZE (24 px) lane in ONE write to body.position[cross] (the cross
    // VELOCITY stays 0 — no diagonal). TANK_SIZE=92 is NOT a multiple of 24, so we snap the CORNER (not the
    // center) to keep laneIndex/target exact + integer-clean.
    if (turned) {
      if (driveAxis === 'x') {
        // Driving horizontally → the CROSS axis is Y; snap the body's TOP corner to the 24 px Y-lane.
        this._recenterCross('y', this.body.y, PLAYFIELD_Y)
      } else if (driveAxis === 'y') {
        // Driving vertically → the CROSS axis is X; snap the body's LEFT corner to the 24 px X-lane.
        this._recenterCross('x', this.body.x, PLAYFIELD_X)
      }
    }

    // Record the axis we drove THIS frame so the next frame can detect a turn. A null (idle) frame leaves
    // lastDriveAxis at its prior value so resuming the SAME axis after a pause is not falsely a "turn".
    if (driveAxis !== null) this.lastDriveAxis = driveAxis

    // 5) Visuals — position the visible rect + barrel TO the body center; orient the barrel along facing.
    const cx = this.body.center.x
    const cy = this.body.center.y
    this.rect.setPosition(cx, cy)
    this.barrel.setPosition(cx, cy)
    this._orientBarrel()
  }

  // ── Turn-time cross-axis re-center (Decision 6, §5.3 step 4) — snap the body's CROSS corner to its
  // nearest SUB_CELL_SIZE lane in ONE discrete write, with three guards in order:
  //   • Dead-band: within LANE_SNAP_EPSILON of the target lane → no-op (stops per-frame oscillation).
  //   • Collision guard: blocked/touching on the cross axis → SKIP (a wall/tank is being resolved on that
  //     axis; snapping would fight Arcade — retry on the next clear turn frame).
  //   • Otherwise: body.position[cross] = target (the cross velocity stays 0 — no diagonal introduced).
  // This is the ONLY place the entity touches body.position, gated to the turn frame + these conditions,
  // honouring D6's "Arcade owns the body / never fight the collider" contract. ──
  private _recenterCross(cross: 'x' | 'y', corner: number, origin: number): void {
    const laneIndex = Math.round((corner - origin) / SUB_CELL_SIZE)
    const target = origin + laneIndex * SUB_CELL_SIZE
    const delta = target - corner
    if (Math.abs(delta) <= LANE_SNAP_EPSILON) return // dead-band — already lane-aligned.
    // Collision guard — read both blocked + touching on the specific cross axis (a wall vs a tank are
    // reported separately). If either is set, SKIP the snap (Arcade is resolving a collider on that axis;
    // snapping would fight it) and retry on the next clear turn frame.
    const blockedCross =
      cross === 'x'
        ? this.body.blocked.left || this.body.blocked.right || this.body.touching.left || this.body.touching.right
        : this.body.blocked.up || this.body.blocked.down || this.body.touching.up || this.body.touching.down
    if (blockedCross) return
    if (cross === 'x') this.body.position.x = target
    else this.body.position.y = target
  }

  // Orient the barrel marker along the current facing: a vertical bar for up/down, a horizontal bar for
  // left/right, offset from center so it visibly "points" the held way (Decision 5 — the facing cue, AC3).
  private _orientBarrel(): void {
    const half = TANK_SIZE / 2
    switch (this.facing) {
      case 'up':
        this.barrel.setSize(BARREL_THICK, BARREL_LEN)
        this.barrel.y = this.body.center.y - half + BARREL_LEN / 2
        this.barrel.x = this.body.center.x
        break
      case 'down':
        this.barrel.setSize(BARREL_THICK, BARREL_LEN)
        this.barrel.y = this.body.center.y + half - BARREL_LEN / 2
        this.barrel.x = this.body.center.x
        break
      case 'left':
        this.barrel.setSize(BARREL_LEN, BARREL_THICK)
        this.barrel.x = this.body.center.x - half + BARREL_LEN / 2
        this.barrel.y = this.body.center.y
        break
      case 'right':
        this.barrel.setSize(BARREL_LEN, BARREL_THICK)
        this.barrel.x = this.body.center.x + half - BARREL_LEN / 2
        this.barrel.y = this.body.center.y
        break
    }
  }

  // ── Fire (Decision 12, AC4) — GameScene calls this on the fire EDGE. The Tank owns its cooldown + the
  // live cap; the SCENE owns the pool (the shared world resource) — mirrors the reference's player.attack()
  // (latch intent) → scene spawns the effect split. A press is a NO-OP unless the cooldown has elapsed AND
  // the tank has a free bullet slot. On a successful acquire: arm the cooldown + increment the live count. ──
  tryFire(pool: BulletPool): void {
    if (this.cooldownTimer > 0 || this.liveBullets >= this.maxBullets) return
    // Spawn from the tank's body center along its facing (the pool applies the muzzle standoff).
    const got = pool.acquire(this, this.body.center.x, this.body.center.y, this.facing)
    if (got) {
      this.cooldownTimer = FIRE_COOLDOWN
      this.liveBullets++
    }
  }

  // ── The pool calls this on a bullet's release (Decision 8/12, AC4/AC5) so the firer's live count
  // decrements — the classic "you may fire again once your shot despawns" rule. Floored at 0 defensively. ──
  onBulletReleased(): void {
    this.liveBullets = Math.max(0, this.liveBullets - 1)
  }

  // ── isHittable() (F3 §5.2, D7, AC5/AC8 — the victim filter) ── a bullet only damages a tank that is ALIVE
  // and NOT in its post-respawn i-frame window. Mirrors the reference's isHittable() (the dead / i-frame
  // gate the scene's bullet×tank callback reads before calling onHit). DRY — one entry both filters share.
  isHittable(): boolean {
    return this.alive && this.spawnIframe <= 0
  }

  // ── onHit(damage) (F3 §5.2, D7, AC5/AC8 — the hit FUNNEL) ── the SAME entry both sides use (the scene's
  // bullet×tank callback computes "valid hittable opposing victim?" then calls this — DRY). Subtract HP; at
  // ≤ 0 run the death path EXACTLY ONCE (the `alive` guard), hide the body, and fire `onDeath` (the scene
  // spends a life + respawns or ends the run — D11). An armor tank (hp > 1) survives until its HP is spent —
  // multi-hit "for free" via the same subtraction. Mirrors the reference's enemy.onHit(result) funnel.
  onHit(damage: number): void {
    if (!this.alive) return // already dead — the death path is one-shot (a same-frame double-hit can't re-fire).
    this.hp -= damage
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
      // Hide the body + barrel (the corpse) — the scene's onDeath wiring pops the kill explosion + decides
      // respawn-vs-stay-down. A respawnAt re-shows them. Park the physics body so a stray overlap can't match.
      this.rect.setVisible(false)
      this.barrel.setVisible(false)
      this.body.setVelocity(0, 0)
      this.body.enable = false
      this.onDeath?.()
    }
  }

  // ── respawnAt(x,y) (F3 §5.2, D11, AC8 — the scene's life/respawn path calls this) ── re-place the body to a
  // generated spawn window-center (DRY — the same coord F2's generator emits), refill HP, re-enable + re-show
  // the body, and ARM the SPAWN_IFRAME invulnerability window (isHittable() is false while it ticks down in
  // update, blinking the rect). The scene owns WHEN to respawn (it spends the life first — D11); the Tank only
  // owns its own re-placement. Reset the facing/drive spine so the fresh spawn starts clean (the classic).
  respawnAt(x: number, y: number): void {
    this.body.enable = true
    // body.reset(centerX, centerY): like the BulletPool muzzle reset, it snaps the collider GameObject to
    // (x,y) and centers the body there, clearing residual velocity. (x,y) is the spawn window-center (D13).
    this.body.reset(x, y)
    this.body.setVelocity(0, 0)
    this.hp = this.maxHp
    this.alive = true
    this.spawnIframe = SPAWN_IFRAME // arm the post-respawn invulnerability (D7/D11).
    this.facing = 'up'
    this.lastDriveAxis = null
    this.cooldownTimer = 0
    this.rect.setPosition(x, y).setVisible(true).setAlpha(1)
    this.barrel.setVisible(true)
    this._orientBarrel()
  }
}
