import Phaser from 'phaser'
import {
  PLAYFIELD_X,
  PLAYFIELD_Y,
  PLAYFIELD_W,
  PLAYFIELD_H,
} from '../config/constants.js'
import type { Tank, TankSide, Facing } from '../entities/Tank.js'

// ── Bullet pool (F1 Tank core §5.2/§5.3, Decisions 8/9/12, AC4/AC5/AC9) ──
// Phaser-COUPLED — owns real Arcade bodies, so (like the read-only `dead-cell` reference's
// combat/ProjectilePool.ts) it is NEVER imported by scripts/verify-gen.mjs (the pure/coupled split, AC10).
// It mirrors the reference's pooling DISCIPLINE 1:1 (Decision 8): a FIXED set of pre-created
// rectangle+body members, acquire/release/releaseAll, ZERO per-shot allocation after warm-up. The
// reference's per-shot dedup hitSet / 2-D aim / pierce / status / onRelease hook are DROPPED here (YAGNI):
// F1 has NO collision targets yet — bullets only despawn at the arena bounds. A later combat feature
// re-adds the dedup/collision plumbing EXACTLY as the reference does, plugging into this same seam.
//
// HAND-INTEGRATED TRAVEL (Decision 8, §5.3): tick(dt) advances each live bullet's position OURSELVES
// (rect.x += vx·dt) on a dt in SECONDS — mirroring the reference so a FUTURE hit-stop can pass dt=0 to
// freeze every live shot in place. The Arcade body velocity stays 0 (no double-integration); we nudge
// the body alongside the rect so the out-of-bounds read below is fresh THIS frame.
//
// PER-TANK LIVE CAP (Decision 8/12, AC4/AC5): each live bullet stores its `ownerSide` + a back-ref to the
// firing Tank, so on release the tank's live-bullet count decrements (`owner.onBulletReleased()`) — the
// classic "you may only have N shots out at once" rule. releaseAll() does NOT fire that callback (a pool
// rebuild/teardown is not a despawn).

const BULLET_W = 8 // px — programmer-art bullet (a small square, primitives only — AC11). This is the COLLISION
const BULLET_H = 8 // px.  body size (set on the Arcade body, fixed) — the visible rect is restyled per shot below.
const BULLET_COLOR = 0xf0e68c // light khaki bolt; reads against the dark playfield.
const MUZZLE_STANDOFF = 6 // px — spawn the bullet a hair ahead of the tank along its facing (no self-overlap).

// ── Travel TRACER (cosmetic — purely the VISIBLE rect; the collision body stays the fixed BULLET_W×BULLET_H) ──
// A flat 8×8 dot reads as static even at speed, so a fast POWER/boss bolt is hard to perceive as moving. On
// acquire we ELONGATE the visible rect along its travel axis into a short bright streak (long on the travel
// axis, the normal 8px across) + brighten the tint, so a moving bolt reads as a streak — and a faster bolt's
// equal-length streak simply covers more ground per frame (the "this one is faster" cue). rect.setSize ONLY
// resizes the GameObject's drawing; the Arcade body keeps its fixed 8×8 (body.setSize is NEVER called), so
// every collision (bullet×tank / bullet×terrain / bullet×bullet) is byte-identical to a plain square.
const BULLET_TRACER_LEN = 16 // px — the streak length along the travel axis (the visible rect; body is unchanged).
const BULLET_TRACER_COLOR = 0xfffbd6 // a brighter near-white bolt head so the moving streak reads against the dark field.

// The per-bullet context, mutated on acquire (never re-allocated → no per-shot GC, AC9). Carried on the
// rect's `bx` property (parallels the reference's `pj`). EXPORTED so the F3 GameScene's bullet×bullet scan
// + the overlap callbacks read the struck shot's `active`/`ownerSide` off it (DRY — one struct, F3 §5.3).
export interface BulletContext {
  active: boolean
  ownerSide: TankSide
  owner: Tank | null // back-ref so release decrements the firer's live count (AC4/AC5).
  vx: number // px/s — hand-integrated travel velocity along the firing facing.
  vy: number
  // Steel-break (max-star player only): a SNAPSHOT of the firer's `spec.canBreakSteel` taken at fire time
  // (like `ownerSide`), so the hit site reads a plain bullet flag — it never re-derives the star tier nor
  // reaches back into the firing Tank (which may already be dead by the time the deferred destroy runs).
  // false for every enemy/boss/sub-tier-player shot; only a tier-3 player folds the flag → true.
  canBreakSteel: boolean
  // boat-drill — DRILL pierce: a SNAPSHOT of the firer's live `owner.drill` flag taken at fire time (exactly like
  // `canBreakSteel`), so the hit site reads a plain bullet flag — it never re-derives the drill timer nor reaches
  // back into the firing Tank. true only while a player's drill window is active (the scene sets owner.drill each
  // frame from RunState.drillTimer > 0); on a BRICK hit a drill bullet chips the brick + CONTINUES (the scene
  // clears this flag so the SECOND brick stops it — it pierces exactly ONE layer). false for every enemy shot.
  drill: boolean
}

// A pooled rectangle member carries its context on a `bx` property. EXPORTED so the F3 scene's overlap
// callbacks + the bullet×bullet scan type the struck/iterated rect (F3 §5.3).
export type BulletRect = Phaser.GameObjects.Rectangle & { bx: BulletContext }

export class BulletPool {
  private scene: Phaser.Scene
  group: Phaser.Physics.Arcade.Group
  private _items: BulletRect[]

  // size: the pool high-water mark. Sized well above MAX_PLAYER_BULLETS × 2 players so a dropped shot
  // (acquire returns null when momentarily exhausted) never happens in normal play — and even then a
  // dropped shot is cosmetic, never a correctness bug (Decision 8 / the reference's note).
  constructor(scene: Phaser.Scene, size = 16) {
    this.scene = scene
    // A physics group so a later combat feature can register overlaps against terrain/tanks/the eagle.
    // No gravity (top-down — F0 Decision 3). Members are parked + disabled until acquired.
    this.group = scene.physics.add.group({ allowGravity: false })

    this._items = []
    for (let i = 0; i < size; i++) {
      const rect = scene.add
        .rectangle(0, 0, BULLET_W, BULLET_H, BULLET_COLOR)
        .setVisible(false) as BulletRect
      this.group.add(rect)
      const body = rect.body as Phaser.Physics.Arcade.Body
      body.setAllowGravity(false)
      // The per-bullet context, mutated on acquire (never re-allocated → no per-shot GC, AC9).
      rect.bx = { active: false, ownerSide: 'player', owner: null, vx: 0, vy: 0, canBreakSteel: false, drill: false }
      this._disable(rect)
      this._items.push(rect)
    }
  }

  // ── Fire a bullet from `owner` at (cx, cy) along `facing` at `speed` px/s (F1 Decision 8/12 + F4 §5.2 issue
  // #1, AC4/AC5). The F4 GENERALIZATION: a trailing `speed` parameter REPLACES the hardcoded BULLET_SPEED in the
  // four facing branches, so a per-tank bullet speed is honoured — POWER's faster bullet (its higher
  // `bulletSpeed`) is REAL, not a no-op. A player passes PLAYER_BASE.bulletSpeed (= BULLET_SPEED), so the F1
  // feel is byte-identical. Everything else (the muzzle standoff, vx/vy on the context, the hand-integrated
  // tick, release) is UNCHANGED — only the velocity MAGNITUDE source moved from the module constant to an
  // argument. Returns the rect, or null if the pool is momentarily exhausted (a dropped shot is cosmetic). ──
  acquire(owner: Tank, cx: number, cy: number, facing: Facing, speed: number): BulletRect | null {
    const rect = this._items.find((r) => !r.bx.active)
    if (!rect) return null

    // Velocity along the single faced cardinal — exactly one component non-zero (a bullet, like a tank,
    // never travels diagonally). The muzzle standoff is placed along that same direction. `speed` (the
    // per-tank bullet speed) replaces the old hardcoded BULLET_SPEED here (the F4 seam — issue #1).
    let vx = 0
    let vy = 0
    let mx = cx
    let my = cy
    switch (facing) {
      case 'up':
        vy = -speed
        my = cy - MUZZLE_STANDOFF
        break
      case 'down':
        vy = speed
        my = cy + MUZZLE_STANDOFF
        break
      case 'left':
        vx = -speed
        mx = cx - MUZZLE_STANDOFF
        break
      case 'right':
        vx = speed
        mx = cx + MUZZLE_STANDOFF
        break
    }

    const body = rect.body as Phaser.Physics.Arcade.Body
    body.reset(mx, my) // snap body to the muzzle, clearing residual velocity. Body stays the fixed BULLET_W×BULLET_H.
    body.enable = true
    body.setVelocity(0, 0) // Arcade velocity 0 — we hand-integrate (no double-step; freezes on a future hit-stop).
    // Cosmetic travel TRACER: stretch the VISIBLE rect into a bright streak along the travel axis (horizontal
    // facings → long X, vertical → long Y). setSize touches the drawing ONLY — the collision body above is the
    // fixed 8×8 (never resized), so the streak cannot alter any collision. Re-set each acquire (a parked rect
    // is reused for any facing), so no reset on _disable is needed.
    if (vx !== 0) rect.setSize(BULLET_TRACER_LEN, BULLET_H)
    else rect.setSize(BULLET_W, BULLET_TRACER_LEN)
    rect.setFillStyle(BULLET_TRACER_COLOR)
    rect.setVisible(true)
    rect.setPosition(mx, my)

    const bx = rect.bx
    bx.active = true
    bx.ownerSide = owner.side
    bx.owner = owner
    bx.vx = vx
    bx.vy = vy
    // Steel-break: snapshot the firer's reserved spec flag (the single source — config/tanks.ts). Only a
    // max-star (tier 3) player folds `canBreakSteel: true`; every enemy/boss/sub-tier spec omits it → false.
    bx.canBreakSteel = owner.spec.canBreakSteel === true
    // boat-drill — snapshot the firer's LIVE drill flag (the scene sets owner.drill from RunState.drillTimer > 0
    // on each player tank in update()). true only for a player firing during an active drill window; the hit site
    // chips one brick then clears it (pierces ONE layer). false for every enemy/boss shot (they leave owner.drill false).
    bx.drill = owner.drill === true
    return rect
  }

  // ── Advance every live bullet by dt (SECONDS, Decision 8/9, AC5/AC9). Hand-integrate position from OUR
  // stored velocity (a future hit-stop passes dt=0 → frozen in place); also nudge the body so the
  // out-of-bounds read below is fresh THIS frame. Release a bullet fully past the playfield bounds so it
  // never flies forever — release decrements the firer's live count (AC5). NO allocation in the steady state. ──
  tick(dt: number): void {
    for (const rect of this._items) {
      const bx = rect.bx
      if (!bx.active) continue
      rect.x += bx.vx * dt
      rect.y += bx.vy * dt
      const body = rect.body as Phaser.Physics.Arcade.Body
      body.x += bx.vx * dt
      body.y += bx.vy * dt
      // Released when FULLY past the playfield rectangle (it never flies forever — AC5).
      const outOfBounds =
        body.right < PLAYFIELD_X ||
        body.left > PLAYFIELD_X + PLAYFIELD_W ||
        body.bottom < PLAYFIELD_Y ||
        body.top > PLAYFIELD_Y + PLAYFIELD_H
      if (outOfBounds) this._disable(rect)
    }
  }

  // Force-release a specific bullet (F3's hit-resolution callbacks + the bounds path call this). Guards a
  // stale handle. The NATURAL release path fires the owner callback so the firer's live count decrements
  // (AC4/AC5). release() only DISABLES the body (never destroys it), so it is SAFE to call inside an Arcade
  // overlap callback (no body is destroyed mid-iteration — F3 §5.3 / the reference's footgun discipline).
  release(rect: BulletRect | null | undefined): void {
    if (rect && rect.bx.active) this._disable(rect)
  }

  // ── forEachActive(fn) (F3 Combat & terrain §5.2/§5.3, Decision D5) ── iterate every LIVE bullet so the
  // scene's bullet×bullet scan reads the handful of in-flight shots (DRY — one iterator the scan + any later
  // pass reuse). Skips parked members. KISS: the live count is single-digit, so a direct scan is trivially
  // cheap (D5). The callback must NOT mutate the pool's membership; it only reads each rect (and may release
  // it — release just disables the body, never touching this _items array).
  forEachActive(fn: (rect: BulletRect) => void): void {
    for (const rect of this._items) if (rect.bx.active) fn(rect)
  }

  // Force-release ALL live bullets (a later level/stage rebuild calls this so an in-flight shot doesn't
  // dangle across a teardown). Pass fireRelease=false: a teardown is NOT a despawn, so it must NOT
  // decrement a tank's live count (the tank may itself be torn down) — mirrors the reference's releaseAll.
  releaseAll(): void {
    for (const rect of this._items) if (rect.bx.active) this._disable(rect, false)
  }

  // Disable a bullet back into the pool: fire the owner callback (NATURAL releases only), kill the body,
  // mark inactive, park it off-field. `fireRelease` (default true — the bounds/hit path) decrements the
  // firer's live count BEFORE the owner ref is cleared; releaseAll passes false (a teardown is not a despawn).
  private _disable(rect: BulletRect, fireRelease = true): void {
    const bx = rect.bx
    if (fireRelease) bx.owner?.onBulletReleased() // AC4/AC5 — the firer may fire again now.
    bx.active = false
    bx.owner = null
    bx.vx = 0
    bx.vy = 0
    bx.canBreakSteel = false // park clean — a reused rect re-snapshots its firer's flag on the next acquire.
    bx.drill = false // boat-drill — park clean (a reused rect re-snapshots the firer's live drill flag next acquire).
    const body = rect.body as Phaser.Physics.Arcade.Body
    body.setVelocity(0, 0)
    body.enable = false
    body.reset(-1000, -1000) // park well off-field so a stray broad-phase pass can't match it.
    rect.setVisible(false)
  }
}
