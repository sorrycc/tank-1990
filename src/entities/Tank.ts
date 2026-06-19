import Phaser from 'phaser'
import {
  TANK_SIZE,
  TILE_SIZE,
  LANE_INSET,
  PLAYFIELD_X,
  PLAYFIELD_Y,
  LANE_SNAP_EPSILON,
  SPAWN_IFRAME,
  AI_REDECIDE_MIN,
  AI_REDECIDE_MAX,
  AI_SEEK_BIAS,
  TELEGRAPH_FILL,
  ICE_FRICTION,
  ICE_GLIDE_CUTOFF,
} from '../config/constants.js'
import { TILE } from '../config/tiles.js' // PURE (no Phaser) — the ice-slide tile-kind probe; the split is intact.
import type { PlayerIntent } from '../core/Input.js'
import type { BulletPool } from '../combat/BulletPool.js'
import type { TankSpec } from '../config/tanks.js'

// ── Tank entity (F1 Tank core §5.2/§5.3, Decisions 1/5/6/7/12, AC3/AC4/AC6) ──
// A plain class — the SAME shape as the read-only `dead-cell` reference's entities/Player.ts (Decision 1):
// it HOLDS a Phaser.GameObjects.Rectangle that owns the Arcade body + a SEPARATE visible rect, owns ALL
// its feel state, and is news'd-up + ticked by GameScene each frame — NOT on the display-list lifecycle.
// Keeping the controller off that lifecycle puts the movement logic in one readable place (SOLID).
//
// COLLIDER / RECT SPLIT (Decision 1/6 — the reference's review-issue #6 lesson): `collider` OWNS the
// Arcade body and is INVISIBLE (alpha 0); Arcade owns ITS position (it writes the resolved x/y back in
// postUpdate). We NEVER hand-move it except the ONE gated turn-time re-center (§5.3 step 4). The VISIBLE
// `rect` (a composed Container — F8 §5.1) is positioned TO the body's center each frame + ROTATED by facing
// — moving/rotating it never touches the body. Arcade derives the body position from the owning object's
// transform, so hand-setting the body-owner's x/y each frame would fight Arcade's write-back → jitter. The
// split kills that. (F8: the single flat visible rect became hull + treads + turret + barrel children — a
// purely cosmetic swap; the collider/body and the no-diagonal spine below are byte-unchanged.)
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
//     CROSS corner to its nearest 1-TILE corridor lane — the TILE lattice OFFSET by LANE_INSET, so a
//     ~1-tile tank lands EXACTLY centered in its lane (a 2px inset) — in ONE discrete write to
//     body.position[cross] (the cross VELOCITY stays 0 — still no diagonal), gated by a LANE_SNAP_EPSILON
//     dead-band (no oscillation) and a !blocked/!touching collision check (never fight a resolving collider).

export type TankSide = 'player' | 'enemy'
export type Facing = 'up' | 'down' | 'left' | 'right'

// F4 (§5.2, D1): the body fill now comes from the per-type TankSpec (`spec.color`), NOT a hardcoded
// per-side colour — so each enemy archetype reads distinctly (red grunt / orange scout / green gunner /
// blue heavy) and a red-flash carrier swaps to `spec.colorFlash`. The two old per-side constants are gone
// (the spec is the single colour owner now — D1; exactly like tiles.ts colours).
const BARREL_COLOR = 0xdfe6e9 // light gun barrel marker so the facing reads.
const BARREL_LEN = TANK_SIZE * 0.55 // px — barrel length along facing (auto-scales from the ~1-tile TANK_SIZE).
const BARREL_THICK = 6 // px — barrel thickness across facing (matches the smaller ~1-tile tank).

// ── F8 visual richness (§5.1, D1/D2) — the composed-silhouette geometry, drawn ONCE in LOCAL space with the
// canonical facing UP (the container is rotated per facing). All sizes derive from TANK_SIZE so the look scales
// with the ~1-tile tank (DRY). LOCAL render constants (owned by this ONE file — they are not shared, so they do
// NOT belong in the constants.ts owner; D6). The tread/turret tints are fixed programmer-art (no asset, AC11).
const HULL_INSET = 2 // px — the hull is a hair inside TANK_SIZE so the tread strips frame it.
const TREAD_W = 5 // px — width of each side tread strip (across facing).
const TREAD_COLOR = 0x2d3436 // dark slate tread (the dark "track" band down each side — reads against any hull).
const TURRET_SIZE = TANK_SIZE * 0.42 // px — the small centered turret block.
const TURRET_COLOR = 0xf5f6fa // a light turret cap so the body center reads (distinct from the hull fill).
// A brief per-hit hull flash so a multi-hit tank (ARMOR, boss) reads each surviving hit (combat progress).
// A LOCAL render constant (owned by this ONE file — render-only feel, not shared, so it stays out of the
// constants.ts owner / the verifier-imported path, exactly like the HULL_INSET/TREAD_W locals above — D6/D4).
const HIT_FLASH_SEC = 0.08 // s — the white-tint pop on a NON-lethal hit (decays in update; restores spec.color).
const HIT_FLASH_COLOR = 0xffffff // the white flash tint (programmer-art primitive — like the telegraph fill).
// A RESTING hull tint for multi-hit tanks (ARMOR, boss) that darkens as HP drops — the classic "the armored
// tank visibly wears down" cue (the per-hit flash above is a momentary pop; THIS is the sustained read of how
// much wall is left). A LOCAL render constant (owned by this ONE file — render-only feel, not shared, so it
// stays out of the constants.ts owner / the verifier-imported path, like the HIT_FLASH_* locals above — D6/D4).
const DAMAGED_TINT = 0x4a3b3b // the dark, desaturated shade the hull lerps TOWARD as hp/maxHp drops (full HP = spec.color).

export class Tank {
  scene: Phaser.Scene
  collider: Phaser.GameObjects.Rectangle // OWNS the Arcade body (alpha 0); Arcade owns its position.
  body: Phaser.Physics.Arcade.Body
  // F8 (§5.1, D1/D2): the visible tank is now a composed CONTAINER (hull + two tread strips + a turret + the
  // barrel), positioned TO the body center each frame + ROTATED by facing. Still named `rect` so GameScene's
  // setVisible/destroy contract is byte-unchanged (a Container cascades both to its children). The `hull` child
  // is the fill-cue target (a Rectangle has setFillStyle; a Container does not) — the carrier flash + the boss
  // telegraph recolour it; the spawn-iframe blink sets the CONTAINER alpha (the whole tank blinks — D3).
  rect: Phaser.GameObjects.Container // the visible tank; positioned + oriented TO the body each frame.
  private hull: Phaser.GameObjects.Rectangle // the body fill (spec.color) — the fill-cue target (carrier/telegraph).
  barrel: Phaser.GameObjects.Rectangle // a small facing marker (the gun); a container child (rides the rotation).

  side: TankSide
  behavior: string // 'player' for F1; the enemy FSM extends this later (D7 — 'basic'|'fast'|'power'|'armor'|'boss').
  facing: Facing
  lastDriveAxis: 'x' | 'y' | null // the axis we drove LAST frame; a TURN = chosen ≠ this (§5.3 step 2/4).

  // ── F-ice-slide (ice-slide §2, D1/D2/D3) — the low-friction "ice glide" momentum, additive over the F1 spine ──
  // `onSampleTile` is the SCENE-injected tile-kind probe (SOLID — keeps Tank.ts off TileMap): GameScene wires it on
  // the two PLAYER tanks only (enemies leave it null → no glide, the existing instant-stop path runs byte-identically
  // — D2/D7). A null sampler makes update() behave EXACTLY as today, so this is additive + zero-risk. `glideVel` is the
  // SIGNED coasting speed (px/s) carried along `glideAxis` — the ONE axis the tank was last driving — so momentum is
  // single-axis ONLY (the no-diagonal invariant stays structural: the cross axis is never written non-zero — D1).
  onSampleTile: ((x: number, y: number) => number) | null // null on enemies/tests → no glide (the instant-stop path).
  private glideVel: number // px/s — the signed coasting speed carried along glideAxis while sliding on ice (0 = at rest).
  private glideAxis: 'x' | 'y' | null // the axis glideVel rides (= the last-driven axis); null when not gliding.
  private wasGliding: boolean // true if the PREVIOUS frame deferred the lane snap (a coast); drives the ONE re-settle.

  cooldownTimer: number // s — decays by dt; a fire is allowed at ≤ 0 (AC4).
  liveBullets: number // current shots out (incremented on fire, decremented on release — AC4/AC5).
  maxBullets: number // the per-tank live cap (from spec.maxBullets — the classic "N shots out" rule).

  // ── F4 per-tank feel (F4 §5.2, D2/D3, AC4 — issue #2) ── the spec's tunable MAGNITUDES, copied onto
  // per-tank fields in the ctor so update()/tryFire() read the FIELD (not a global). This is what makes the
  // four enemy types ACTUALLY differ at runtime: FAST drives at its higher moveSpeed, POWER fires its faster
  // bulletSpeed, every type fires on its own fireCooldown beat. The player's fields equal the F1 constants
  // (PLAYER_BASE), so threading the spec is behaviour-preserving for the player. The movement GEOMETRY is
  // byte-identical — only the magnitude SOURCE moved from constants to the spec (the no-diagonal invariant holds).
  spec: TankSpec // the per-tank tuning row (also the colour source for the visual — D1).
  moveSpeed: number // px/s — the grid drive speed (was the hardcoded TANK_SPEED in update; now from spec).
  bulletSpeed: number // px/s — passed into pool.acquire so POWER's bullet is faster (was implicit BULLET_SPEED).
  fireCooldown: number // s — the attack-beat cadence (was the hardcoded FIRE_COOLDOWN in tryFire; now from spec).

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

  // ── F4 enemy-AI + carrier state (F4 §5.2, D2/D3/D4, AC3/AC7) ── additive over the F1/F3 spine. A PLAYER
  // tank leaves carrier/onDropFlag at their defaults + never runs updateAI (the scene drives it from Input).
  // `carrier`: the red-flash power-up carrier flag (the spawn loop rolls it — AC7); the visual flashes
  // spec.colorFlash while set. `onDropFlag`: fired ONCE at death with the death center (the F5 pickup seam —
  // the same one-shot discipline as onDeath). The AI FSM is a re-decide timer + a stored intent (the wander/
  // seek state); `updateAI` rebuilds the intent each tick + the scene feeds it through the SAME update() spine.
  carrier: boolean
  onDropFlag: ((x: number, y: number) => void) | null
  private aiRedecideTimer: number // s — decays by dt; at ≤ 0 (or when blocked) the AI re-decides a cardinal (D4).
  aiIntent: PlayerIntent // the PlayerIntent-shaped snapshot updateAI emits; the scene drives update(gdt, this.aiIntent).

  // ── F6 boss telegraph (F6 §5.3, D2, AC2) ── additive over the F4 AI spine. `telegraphSec` (copied from the
  // spec in the ctor; 0 = no telegraph, the IDENTITY for every non-boss spec) is the pre-fire wind-up window.
  // `telegraphTimer`/`telegraphing` are the runtime wind-up state: when a boss's fire beat elapses it ARMS the
  // timer + sets `telegraphing` (holding fire during the visible warning blink) instead of firing immediately,
  // then fires the frame the timer elapses (updateAI). A spec with telegraphSec === 0 NEVER touches these — the
  // gated branch is skipped, so the four archetypes + the player take the existing immediate-fire path unchanged.
  telegraphSec: number // s — the pre-fire wind-up window (from spec.telegraphSec ?? 0; > 0 only for the boss).
  telegraphing: boolean // true while a shot is winding up (the render cue blinks the warning fill — issue #4).
  private telegraphTimer: number // s — decays by dt while telegraphing; at ≤ 0 the held shot fires (updateAI).

  // ── Per-hit hull flash (D2/D3) ── armed by onHit on a NON-lethal hit (hp > 0 after subtraction); decays
  // by dt in update while the hull tints white (the carrier/telegraph fill-cue pattern, a third gated branch).
  // > 0 = flashing. Every multi-hit tank (ARMOR, boss) gets it for free through the one onHit funnel (DRY).
  private hitFlashTimer: number // s — decays by dt; while > 0 the hull tints HIT_FLASH_COLOR (then restores).

  constructor(scene: Phaser.Scene, x: number, y: number, side: TankSide, spec: TankSpec) {
    this.scene = scene
    this.side = side
    // F4 (§5.2, issue #2): the spec is the canonical source of ALL per-tank tunables. Copy its behaviour +
    // feel magnitudes onto per-tank fields so update()/tryFire() read the FIELD, not a module global.
    this.spec = spec
    this.behavior = spec.behavior // (was the `behavior` ctor arg in F1).
    this.facing = 'up' // tanks start facing up (the classic player spawn orientation).
    this.lastDriveAxis = null
    // F-ice-slide (D2) — no probe + no momentum on a fresh tank. The scene wires onSampleTile on PLAYER tanks only.
    this.onSampleTile = null
    this.glideVel = 0
    this.glideAxis = null
    this.wasGliding = false
    this.cooldownTimer = 0
    this.liveBullets = 0
    this.maxBullets = spec.maxBullets // (was MAX_PLAYER_BULLETS; now from the spec).
    this.moveSpeed = spec.moveSpeed // (was the hardcoded TANK_SPEED read in update).
    this.bulletSpeed = spec.bulletSpeed // (was the implicit BULLET_SPEED in pool.acquire).
    this.fireCooldown = spec.fireCooldown // (was the hardcoded FIRE_COOLDOWN read in tryFire).

    // F3 combat state — a fresh tank is alive at full HP with NO spawn i-frames (the scene arms them on a
    // respawn via respawnAt, or on an enemy spawn-blink). onDeath is wired by the scene after construction (D11).
    this.maxHp = spec.maxHp // (was the `hp` ctor arg; ARMOR passes ARMOR_TANK_HP=4 via its spec — multi-hit, AC4).
    this.hp = spec.maxHp
    this.alive = true
    this.spawnIframe = 0
    this.onDeath = null

    // F4 enemy-AI + carrier defaults — a player never carries / never AI-decides (the scene drives it).
    this.carrier = false
    this.onDropFlag = null
    this.aiRedecideTimer = 0 // re-decide immediately on the first AI tick.
    this.aiIntent = { up: false, down: false, left: false, right: false, dirX: 0, dirY: 0, firePressed: false }

    // F6 boss telegraph (D2) — copy the spec's pre-fire wind-up window (default 0 = no telegraph, the identity
    // for every non-boss spec → the gated branch in updateAI is skipped). The runtime wind-up state starts clear.
    this.telegraphSec = spec.telegraphSec ?? 0
    this.telegraphing = false
    this.telegraphTimer = 0

    // Per-hit hull flash (D2) — a fresh tank carries no flash (armed only by a surviving onHit).
    this.hitFlashTimer = 0

    const fill = spec.color // F4 (D1): the body fill is the spec's colour (per-type distinct).

    // ── Physics collider (owns the body) + separate visual rect (Decision 1/6 — the reference's split) ──
    // `collider` owns the Arcade body, is INVISIBLE (alpha 0). Arcade owns its position; we only hand-write
    // body.position on the gated turn-time re-center (§5.3 step 4), never per-frame. Body size FIXED here.
    this.collider = scene.add.rectangle(x, y, TANK_SIZE, TANK_SIZE, fill).setAlpha(0)
    scene.physics.add.existing(this.collider)
    this.body = this.collider.body as Phaser.Physics.Arcade.Body
    // Tanks are SOLID movers that push against walls/each other (no overlap) — Arcade separates them.
    // The Arcade world bounds are set to the playfield rectangle (GameScene.create), so opting the body in here
    // makes a tank stop at the playfield edges — it can no longer drive out of the scene. (Was `false` with a
    // stale F1 comment about a "test arena" of steel border walls that the procedural generator never builds.)
    this.body.setCollideWorldBounds(true)

    // ── F8 (§5.1, D1/D2) — the VISIBLE tank: a composed CONTAINER (hull + two tread strips + a turret + the
    // barrel) built ONCE in LOCAL space (origin 0,0 = body center) with the canonical facing UP, then
    // positioned TO the body center each frame + ROTATED by facing (cheap — no per-frame allocation, AC3).
    // Children are LOCAL-relative; the container's transform places + orients them. Primitives only (AC11).
    const hullSize = TANK_SIZE - HULL_INSET // the hull is a hair inside TANK_SIZE so the tread strips frame it.
    this.hull = scene.add.rectangle(0, 0, hullSize, hullSize, fill) // the body fill (spec.color) — the fill-cue target.
    // Two dark tread strips down the LEFT/RIGHT sides (the classic "track" bands) — run along the facing axis.
    const treadX = (TANK_SIZE - TREAD_W) / 2
    const treadL = scene.add.rectangle(-treadX, 0, TREAD_W, TANK_SIZE, TREAD_COLOR)
    const treadR = scene.add.rectangle(treadX, 0, TREAD_W, TANK_SIZE, TREAD_COLOR)
    // A small light turret cap at the body center so the center reads (distinct from the hull fill).
    const turret = scene.add.rectangle(0, 0, TURRET_SIZE, TURRET_SIZE, TURRET_COLOR)
    // The barrel (the gun) — a vertical bar reaching UP from center in the canonical frame; it rides the
    // container rotation so it always points the driven way (the facing cue is structural — D2).
    this.barrel = scene.add.rectangle(0, -(TANK_SIZE / 2 - BARREL_LEN / 2), BARREL_THICK, BARREL_LEN, BARREL_COLOR)
    this.rect = scene.add.container(x, y, [treadL, treadR, this.hull, turret, this.barrel])
    this._orient() // initial container rotation matches `facing`.
  }

  // ── Tick one frame (Decision 5/6/12, AC3/AC4) — dt in SECONDS. Order mirrors §5.3:
  //   1) cooldown decay → 2) pick the ONE driving axis (4-dir, no diagonal) + facing → 3) drive (exactly
  //      one velocity component non-zero) → 4) turn-time re-center (gated discrete snap) → 5) visuals. ──
  update(dt: number, intent: PlayerIntent): void {
    // F3 (D7/D11, AC8) — a DEAD tank is parked: the scene stops driving it until a respawn, but a defensive
    // guard here means a stray tick can't move/fire a corpse. Hold the body still + leave the visual hidden.
    if (!this.alive) {
      this.body.setVelocity(0, 0)
      // F-ice-slide (D-defensive) — a corpse carries NO momentum (a stray tick can't coast a dead tank).
      this.glideVel = 0
      this.glideAxis = null
      this.wasGliding = false
      return
    }

    // F3 spawn i-frames (D7/D11, AC5/AC8) — decay the post-respawn invulnerability window + BLINK the visual
    // while it ticks (the cue that the tank can't be hit). isHittable() reads this same timer, so the gate +
    // the cue can never disagree. Restore full alpha the frame it expires.
    if (this.spawnIframe > 0) {
      this.spawnIframe = Math.max(0, this.spawnIframe - dt)
      // A fast alpha pulse (~10 Hz) off the scene clock — purely cosmetic (the body is unaffected). F8 (D3):
      // setAlpha on the CONTAINER fades EVERY child, so the whole silhouette blinks (the same i-frame read).
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

    // F-ice-slide (ice-slide §2, D3) — is the tank's CENTER sitting on a TILE.ICE cell THIS frame? Sampled ONCE
    // via the scene-injected probe (null on enemies/tests → onIce stays false → the existing instant-stop path
    // below runs byte-identically — D2/D7). The classic ice read: the body must be CENTERED over ice to glide.
    const onIce = this.onSampleTile?.(this.body.center.x, this.body.center.y) === TILE.ICE

    // 3) Drive — exactly ONE velocity component non-zero (Decision 5/AC3). The cross component is held at
    // EXACTLY 0, so Arcade never integrates a diagonal (the no-diagonal invariant is STRUCTURAL). F-ice-slide
    // (D5): the drive step is now GATED — OFF ice it is BYTE-IDENTICAL to today (held → ±moveSpeed; released →
    // instant 0,0). ON ice a release COASTS the last-driven axis with momentum decay instead of stopping dead.
    if (driveAxis === 'x') {
      // A key is held on the X axis → drive at ±moveSpeed (as today) AND seed the glide momentum (records the
      // signed speed + axis so a later release coasts; off ice this seed is simply never read — harmless — D5).
      const vx = this.facing === 'right' ? this.moveSpeed : -this.moveSpeed
      this.body.setVelocity(vx, 0)
      this.glideVel = vx
      this.glideAxis = 'x'
    } else if (driveAxis === 'y') {
      const vy = this.facing === 'down' ? this.moveSpeed : -this.moveSpeed
      this.body.setVelocity(0, vy)
      this.glideVel = vy
      this.glideAxis = 'y'
    } else if (onIce && this.glideAxis !== null && Math.abs(this.glideVel) > ICE_GLIDE_CUTOFF) {
      // No key held, but the tank is centered on ICE and still carries glide above the settle floor → KEEP moving
      // along the glide axis (single-axis only — the cross axis stays EXACTLY 0, so no diagonal — D1/AC3), and
      // decay the momentum framerate-independently (`*= ICE_FRICTION ** dt` — the per-second retention factor, D4).
      if (this.glideAxis === 'x') this.body.setVelocity(this.glideVel, 0)
      else this.body.setVelocity(0, this.glideVel)
      this.glideVel *= ICE_FRICTION ** dt
    } else {
      // The existing instant-stop (bare ground OR the glide has settled under the cutoff / left ice — AC2). Clear
      // any residual momentum so a future release on ice starts fresh (no stale glide survives a full stop).
      this.body.setVelocity(0, 0)
      this.glideVel = 0
      this.glideAxis = null
    }

    // Is the tank still carrying glide THIS frame (a post-release ice coast, or the seeded momentum on a turn
    // frame on ice)? While it is, the lane re-center is DEFERRED (the surface is slippery — an instant lane snap
    // would feel sticky — D6). We re-settle the lane ONCE the glide clears (the else branch below).
    const gliding = onIce && this.glideAxis !== null && Math.abs(this.glideVel) > ICE_GLIDE_CUTOFF

    // 4) Turn-time re-center — a DISCRETE, collision-aware, velocity-ONLY snap (Decision 5/6, AC3), run
    // ONLY on a turn frame. On a non-turn frame do NOTHING here (steady single-axis driving already holds
    // the cross velocity at 0, so the tank stays in its lane). On a turn we re-center the body's CROSS
    // corner to its nearest 1-TILE corridor lane in ONE write to body.position[cross] (the cross VELOCITY
    // stays 0 — no diagonal). We snap the body's CORNER (not the center) to the LANE_INSET-offset TILE
    // lattice (D1) so a ~1-tile tank lands EXACTLY centered (a 2px inset) in a 1-tile corridor lane.
    //
    // F-ice-slide (D6) — SLIPPERY TURNS: while `gliding` we SKIP the turn-time snap (the slippery surface lets
    // the new heading take a beat to win). Once the glide settles to rest (cutoff reached) OR the tank leaves ice
    // — i.e. NOT gliding — we run the SAME _recenterCross on the CURRENT heading's cross axis ONCE so the tank
    // re-settles into its lane (no permanent lane drift — AC4), reusing the helper verbatim (DRY, no second path).
    if (gliding) {
      // Sliding — defer the lane discipline (do nothing; the re-settle fires when the glide clears, below).
    } else if (turned) {
      if (driveAxis === 'x') {
        // Driving horizontally → the CROSS axis is Y; snap the body's TOP corner to the centered Y-lane.
        this._recenterCross('y', this.body.y, PLAYFIELD_Y)
      } else if (driveAxis === 'y') {
        // Driving vertically → the CROSS axis is X; snap the body's LEFT corner to the centered X-lane.
        this._recenterCross('x', this.body.x, PLAYFIELD_X)
      }
    } else if (this.wasGliding && this.lastDriveAxis !== null) {
      // Just settled OUT of an ice coast (we deferred the snap last frame; this frame the glide cleared OR a key was
      // re-pressed/the tank left ice). Re-settle the lane ONCE on the LAST sliding heading's cross axis so a tank
      // that slid to a stop lands cleanly back in its corridor (AC4 — no permanent lane drift). The cross-velocity
      // stays 0 (no diagonal — D1). Gating on `wasGliding` (NOT a bare driveAxis===null) keeps OFF-ice behaviour
      // BYTE-IDENTICAL to today (AC2): a tank that never glided never enters this re-settle. Reuses _recenterCross
      // verbatim (DRY — no second snap path); the dead-band makes it a no-op when already lane-aligned.
      if (this.lastDriveAxis === 'x') this._recenterCross('y', this.body.y, PLAYFIELD_Y)
      else this._recenterCross('x', this.body.x, PLAYFIELD_X)
    }

    // F-ice-slide (D6) — remember whether we deferred the snap THIS frame, so the NEXT frame can run the ONE
    // re-settle exactly when the glide clears (the wasGliding edge above). Off ice this is always false → the
    // re-settle branch never fires → behaviour is byte-identical to today (AC2).
    this.wasGliding = gliding

    // Record the axis we drove THIS frame so the next frame can detect a turn. A null (idle) frame leaves
    // lastDriveAxis at its prior value so resuming the SAME axis after a pause is not falsely a "turn".
    if (driveAxis !== null) this.lastDriveAxis = driveAxis

    // 5) Visuals — position the visible container TO the body center + orient it along facing (F8 §5.1). The
    // children (hull/treads/turret/barrel) ride the container transform, so this ONE position+rotate places
    // the whole silhouette (cheap — no per-frame allocation, AC3).
    const cx = this.body.center.x
    const cy = this.body.center.y
    this.rect.setPosition(cx, cy)
    this._orient()

    // F4 (§5.2, AC7) — a red-flash CARRIER pulses spec.colorFlash ↔ spec.color (~5 Hz off the scene clock,
    // a cosmetic fill swap only) so the player can tell which enemy drops a power-up. A non-carrier holds its
    // resting fill. Skipped while spawn-blinking (the i-frame branch above owns the alpha cue then — no clash).
    // F8 (D3): the fill cue targets the HULL child (a Container has no setFillStyle; the hull holds spec.color).
    if (this.carrier && this.spawnIframe <= 0) {
      const flash = Math.floor(this.scene.time.now / 200) % 2 === 0
      this.hull.setFillStyle(flash ? this.spec.colorFlash : this.spec.color)
    }

    // F6 (§5.3 issue #4, D2/AC2) — the TELEGRAPH render cue: a DISTINCT branch (NOT the carrier-flash hook — the
    // boss is a non-carrier (D11), so it could never enter that branch). Fires for ANY tank actively winding up a
    // shot (telegraphing). Gated on spawnIframe <= 0 so it does NOT fight the spawn-blink ALPHA branch above
    // (which owns the alpha while spawnIframe > 0); this branch only ever calls setFillStyle (NEVER setAlpha), so
    // even in an overlap the two write DIFFERENT visual channels. The fill swaps to TELEGRAPH_FILL at ~5 Hz off
    // the scene clock (faster than the carrier pulse — a "charging" cue), resting at the spec fill between blinks.
    else if (this.telegraphing && this.spawnIframe <= 0) {
      const warn = Math.floor(this.scene.time.now / 100) % 2 === 0 // ~5 Hz blink.
      this.hull.setFillStyle(warn ? TELEGRAPH_FILL : this.spec.color) // body warns; resting fill between blinks (F8: the hull child).
      this.barrel.setFillStyle(warn ? TELEGRAPH_FILL : BARREL_COLOR) // the barrel co-warns (the "charging" cue).
    }

    // Per-hit hull FLASH (D2/D3) — a THIRD gated fill-cue branch in the SAME if/else chain, so at most one cue
    // writes the hull per frame. Armed by onHit on a NON-lethal hit; decays on dt, tinting the hull white while
    // > 0, restoring spec.color the frame it elapses. Gated on spawnIframe <= 0 (does NOT run during the spawn-
    // blink, which owns the alpha cue) + touches ONLY setFillStyle (never setAlpha), so it can never fight the
    // blink — the SAME discipline the carrier/telegraph branches above document. Gives every multi-hit tank
    // (ARMOR, boss) per-hit feedback for free through the one onHit funnel (DRY).
    else if (this.hitFlashTimer > 0 && this.spawnIframe <= 0) {
      this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt)
      this.hull.setFillStyle(this.hitFlashTimer > 0 ? HIT_FLASH_COLOR : this.spec.color) // white pop; restores on elapse.
    }

    // HP-stage resting hull tint (D2/D3) — the FINAL gated fill-cue branch, so it is the colour the hull RESTS
    // at when none of the transient cues (carrier/telegraph/hit-flash) is active. Computed ONLY for maxHp > 1
    // (ARMOR, boss) — a 1-HP archetype + the player NEVER enter it, so they rest at exactly spec.color
    // (byte-unchanged). Lerp spec.color (full HP) → DAMAGED_TINT as hp/maxHp drops, so the armored tank visibly
    // wears down (the classic combat-state read). Gated on spawnIframe <= 0 + touches ONLY setFillStyle (never
    // setAlpha), the SAME discipline the branches above document — so it can never fight the spawn-blink alpha.
    // A pure per-frame derivation of live hp/maxHp (no tween, no timer — D1); respawnAt resets the fill, then this
    // re-settles next tick from the refilled HP (a fresh spawn is full HP → spec.color).
    else if (this.maxHp > 1 && this.spawnIframe <= 0) {
      this.hull.setFillStyle(lerpColor(this.spec.color, DAMAGED_TINT, 1 - this.hp / this.maxHp))
    }
  }

  // ── Turn-time cross-axis re-center (Decision 6, §5.3 step 4 → feel-balance D1) — snap the body's CROSS
  // corner to its nearest 1-TILE corridor lane in ONE discrete write, with three guards in order:
  //   • Dead-band: within LANE_SNAP_EPSILON of the target lane → no-op (stops per-frame oscillation).
  //   • Collision guard: blocked/touching on the cross axis → SKIP (a wall/tank is being resolved on that
  //     axis; snapping would fight Arcade — retry on the next clear turn frame).
  //   • Otherwise: body.position[cross] = target (the cross velocity stays 0 — no diagonal introduced).
  // The lane lattice is the TILE lattice OFFSET by LANE_INSET (D1) — i.e. `origin + LANE_INSET + k·TILE_SIZE`
  // — which is the windowCenter-derived clean corner for a ~1-tile tank, so the snap lands it EXACTLY
  // centered (a 2px inset) in a 1-tile corridor. This is the ONLY place the entity touches body.position,
  // gated to the turn frame + these conditions, honouring D6's "Arcade owns the body / never fight the
  // collider" contract. ──
  private _recenterCross(cross: 'x' | 'y', corner: number, origin: number): void {
    const laneIndex = Math.round((corner - origin - LANE_INSET) / TILE_SIZE)
    const target = origin + LANE_INSET + laneIndex * TILE_SIZE
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

  // Orient the whole silhouette along the current facing by ROTATING the container (F8 §5.1, D2 — the facing
  // cue, AC3). The children are drawn in the canonical "facing UP" local frame (the barrel points up at -Y),
  // so the rotation alone points the turret + barrel the held way: up = 0, right = +90°, down = 180°, left =
  // +270° (clockwise from up). One transform write per frame — no per-child resize/reposition (cheap, AC3).
  private _orient(): void {
    switch (this.facing) {
      case 'up':
        this.rect.setRotation(0)
        break
      case 'right':
        this.rect.setRotation(Math.PI / 2)
        break
      case 'down':
        this.rect.setRotation(Math.PI)
        break
      case 'left':
        this.rect.setRotation(-Math.PI / 2)
        break
    }
  }

  // ── Fire (Decision 12, AC4 → F6 §5.4 issue #6, D6/AC6) — GameScene calls this on the fire EDGE. The Tank owns
  // its cooldown + the live cap; the SCENE owns the pool (the shared world resource) — mirrors the reference's
  // player.attack() (latch intent) → scene spawns the effect split. A press is a NO-OP unless the cooldown has
  // elapsed AND the tank has a free bullet slot. On a successful acquire: arm the cooldown + increment the live
  // count. F6 (issue #6): RETURNS whether a shot was fired this call (the existing `got` acquire result, coerced to
  // a boolean), so the SCENE — the one audio owner (D6) — can play `sound.fire()` on success; a `false` return
  // means cooldown/cap blocked the shot. This is purely ADDITIVE: a caller that IGNORES the return (the prior
  // behaviour) is unchanged. ──
  tryFire(pool: BulletPool): boolean {
    if (this.cooldownTimer > 0 || this.liveBullets >= this.maxBullets) return false
    // Spawn from the tank's body center along its facing at THIS tank's bulletSpeed (the pool applies the
    // muzzle standoff). F4 (issue #1): passing this.bulletSpeed is what makes POWER's faster bullet real.
    const got = pool.acquire(this, this.body.center.x, this.body.center.y, this.facing, this.bulletSpeed)
    if (got) {
      this.cooldownTimer = this.fireCooldown // F4 (issue #2): the per-tank attack beat (was FIRE_COOLDOWN).
      this.liveBullets++
    }
    return got !== null // F6 (issue #6): the scene plays sound.fire() on a true return (the one audio owner, D6/AC6).
  }

  // ── The pool calls this on a bullet's release (Decision 8/12, AC4/AC5) so the firer's live count
  // decrements — the classic "you may fire again once your shot despawns" rule. Floored at 0 defensively. ──
  onBulletReleased(): void {
    this.liveBullets = Math.max(0, this.liveBullets - 1)
  }

  // ── updateAI(dt, ctx) (F4 §5.2/§5.3, Decisions D2/D3/D4, AC3) — the enemy grid-AI tick ──
  // Builds `this.aiIntent` (a PlayerIntent-shaped snapshot) from a tiny wander/seek FSM, then the SCENE drives
  // `tank.update(gdt, this.aiIntent)` (the SAME 4-dir movement spine the player uses — DRY, D3) and calls
  // `tank.tryFire(bullets)` on a fire frame. So the enemy reuses the F1 no-diagonal grid-snap movement VERBATIM
  // (no second movement code path); the AI is a small INTENT PRODUCER, not a physics actor (SOLID — Input and
  // updateAI are two producers of one intent contract; Tank.update is the one consumer).
  //
  // THE FSM (D4): every random interval in [AI_REDECIDE_MIN, AI_REDECIDE_MAX] (a runtime random OFF the seeded
  // level pin — the verifier never imports Tank), OR immediately when BLOCKED on the current drive axis (turn at
  // the obstacle/wall), pick a new cardinal: with probability AI_SEEK_BIAS step the Manhattan-greedy cardinal
  // toward the target (the eagle base, or the nearest live player if closer), else a random cardinal (wander).
  // Fire on the cooldown beat whenever a bullet slot is free. NO pathfinding (YAGNI — the generator guarantees a
  // carved corridor to the fort, so a seek bias reaches it; A* would be speculative complexity — D4).
  updateAI(dt: number, ctx: { eagle: { x: number; y: number }; players: { x: number; y: number }[] }): void {
    this.aiRedecideTimer = Math.max(0, this.aiRedecideTimer - dt)

    // Blocked on the current drive axis? (Arcade body.blocked — a wall/tank stopped us this frame.) If so we
    // re-decide NOW so the enemy turns at the obstacle instead of grinding into it (D4).
    const drivingX = this.facing === 'left' || this.facing === 'right'
    const blocked = drivingX
      ? this.body.blocked.left || this.body.blocked.right
      : this.body.blocked.up || this.body.blocked.down

    if (this.aiRedecideTimer <= 0 || blocked) {
      // Choose the target: the eagle base, OR the nearest live player if it is Manhattan-closer (AC3). A live
      // player is one present in ctx.players (the scene passes only present + alive players).
      const cx = this.body.center.x
      const cy = this.body.center.y
      let target = ctx.eagle
      let best = Math.abs(ctx.eagle.x - cx) + Math.abs(ctx.eagle.y - cy)
      for (const p of ctx.players) {
        const d = Math.abs(p.x - cx) + Math.abs(p.y - cy)
        if (d < best) {
          best = d
          target = p
        }
      }

      // Seek-bias (AI_SEEK_BIAS) the greedy cardinal toward the target, else wander a random cardinal. The
      // greedy cardinal picks the axis with the LARGER Manhattan gap (KISS — no pathfinding, D4).
      let dirX = 0
      let dirY = 0
      if (Math.random() < AI_SEEK_BIAS) {
        const gx = target.x - cx
        const gy = target.y - cy
        if (Math.abs(gx) >= Math.abs(gy)) dirX = gx >= 0 ? 1 : -1
        else dirY = gy >= 0 ? 1 : -1
      } else {
        // A random cardinal (wander): pick one of the four with equal weight.
        const r = Math.floor(Math.random() * 4)
        if (r === 0) dirX = 1
        else if (r === 1) dirX = -1
        else if (r === 2) dirY = 1
        else dirY = -1
      }

      // Write the cardinal into the intent (dirX/dirY + the derived held booleans, exactly as Input shapes it —
      // the one intent contract). Re-arm the re-decide timer with a fresh runtime random (D4).
      this.aiIntent.dirX = dirX
      this.aiIntent.dirY = dirY
      this.aiIntent.left = dirX < 0
      this.aiIntent.right = dirX > 0
      this.aiIntent.up = dirY < 0
      this.aiIntent.down = dirY > 0
      this.aiRedecideTimer = AI_REDECIDE_MIN + Math.random() * (AI_REDECIDE_MAX - AI_REDECIDE_MIN)
    }

    // Fire on the attack beat (AC3): firePressed is true whenever the cooldown has elapsed (the scene gates the
    // actual acquire on a free bullet slot via tryFire — the same edge-driven fire path the player uses, D3).
    //
    // F6 (§5.3, D2/AC2) — the TELEGRAPH branch is gated behind telegraphSec > 0, so a non-boss tank takes the
    // EXISTING immediate-fire path BYTE-UNCHANGED (no behaviour change for the four archetypes — the boss is a
    // purely additive variant, DRY: one fire decision, a telegraphed wind-up for the boss). The wind-up:
    //   • cooldown elapsed AND not yet telegraphing → ARM the wind-up (telegraphTimer = telegraphSec, telegraphing
    //     = true); firePressed stays false (holding fire — the warning blink shows; the render cue reads this flag).
    //   • telegraphing → decay telegraphTimer on dt; firePressed = (telegraphTimer <= 0); when it elapses, fire THIS
    //     frame + clear telegraphing (the cooldown then re-arms on the successful tryFire in the scene's tick).
    // The timer decays on the GAMEPLAY dt the scene passes (so a clock freeze pauses the wind-up too — the SAME
    // "freeze pauses every gameplay timer" contract every enemy obeys; §5.4 issue (a)).
    if (this.telegraphSec > 0) {
      if (this.telegraphing) {
        this.telegraphTimer = Math.max(0, this.telegraphTimer - dt)
        this.aiIntent.firePressed = this.telegraphTimer <= 0
        if (this.telegraphTimer <= 0) this.telegraphing = false // fire this frame; the wind-up is done.
      } else if (this.cooldownTimer <= 0) {
        this.telegraphing = true // ARM the wind-up (the warning blink begins); hold fire until it elapses.
        this.telegraphTimer = this.telegraphSec
        this.aiIntent.firePressed = false
      } else {
        this.aiIntent.firePressed = false // still on cooldown — nothing to telegraph yet.
      }
    } else {
      // The existing immediate-fire path (telegraphSec === 0) — byte-unchanged for the four archetypes + player.
      this.aiIntent.firePressed = this.cooldownTimer <= 0
    }
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
      // (a lethal hit takes the death path below — no flash; the kill explosion is its feedback — D2.)
      // Hide the visible silhouette (the corpse) — the scene's onDeath wiring pops the kill explosion + decides
      // respawn-vs-stay-down. A respawnAt re-shows it. Park the physics body so a stray overlap can't match.
      // F8 (D1): setVisible on the CONTAINER hides every child (hull/treads/turret/barrel) in one call; the
      // separate barrel.setVisible(false) below is a now-redundant child op kept harmless for clarity.
      this.rect.setVisible(false)
      this.barrel.setVisible(false)
      this.body.setVelocity(0, 0)
      this.body.enable = false
      this.onDeath?.()
    } else {
      // Survived the hit (hp > 0 — an ARMOR/boss multi-hit, D2) — arm the brief white hull flash so the player
      // reads the landed hit (update() decays it + tints the hull). Free for EVERY multi-hit tank via this funnel.
      this.hitFlashTimer = HIT_FLASH_SEC
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
    // F-ice-slide (D-defensive) — a fresh spawn carries no glide momentum (no momentum survives across lives, AC6).
    this.glideVel = 0
    this.glideAxis = null
    this.wasGliding = false
    this.cooldownTimer = 0
    this.telegraphing = false // F6 — a fresh spawn starts with no shot winding up (defensive; the boss never respawns).
    this.telegraphTimer = 0
    this.hitFlashTimer = 0 // a fresh spawn clears any pending hit flash (defensive; the hull fill is reset below).
    // F8 (§5.1): re-show + reposition the container; restore full alpha + reset the fill cues so a respawn clears
    // any mid-telegraph/carrier-flash tint (defensive — the hull/barrel rest at spec.color/BARREL_COLOR).
    this.rect.setPosition(x, y).setVisible(true).setAlpha(1)
    this.hull.setFillStyle(this.spec.color)
    this.barrel.setFillStyle(BARREL_COLOR).setVisible(true)
    this._orient()
  }
}

// Lerp between two 0xRRGGBB colours per channel (t in [0,1]) — the HP-stage tint's hull recolour (the same
// channel-lerp Base.ts proves; a LOCAL helper, no new util for a single call site — KISS, D4).
function lerpColor(from: number, to: number, t: number): number {
  const fr = (from >> 16) & 0xff
  const fg = (from >> 8) & 0xff
  const fb = from & 0xff
  const tr = (to >> 16) & 0xff
  const tg = (to >> 8) & 0xff
  const tb = to & 0xff
  const r = Math.round(fr + (tr - fr) * t)
  const g = Math.round(fg + (tg - fg) * t)
  const b = Math.round(fb + (tb - fb) * t)
  return (r << 16) | (g << 8) | b
}
