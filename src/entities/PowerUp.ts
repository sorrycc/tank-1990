import Phaser from 'phaser'
import { POWERUP_BY_ID } from '../config/powerups.js'
import type { PowerUpKind } from '../config/powerups.js'

// ── Pooled power-up (F5 Power-ups & meta §5.2, Decisions D1/D2, AC1/AC2) ──
// Phaser-COUPLED — owns real Arcade bodies, so (like BulletPool / ParticlePool / the read-only `dead-cell`
// reference's entities/Pickup.ts PickupPool) it is NEVER imported by scripts/verify-gen.mjs (the pure/coupled
// split, AC11). It mirrors the reference's PickupPool DISCIPLINE 1:1 (D1): a FIXED set of pre-created
// rectangle+sensor-body members, acquire/release/releaseAll, ZERO per-pickup allocation after warm-up. The
// per-pickup state (`pu`) is mutated on acquire, never re-allocated.
//
// THE TOP-DOWN DIVERGENCE (D2 — the ONE deliberate change from the reference's pickup): the reference's pickup
// pops UPWARD under Arcade gravity and settles (a side-scroller). Tank 1990 is TOP-DOWN (no gravity world —
// constants D3): a power-up is placed at the drop window-center, sits as a STATIC sensor body (no gravity, no
// velocity), pulses its kind colour (the classic Battle City blink), and is collected on a player-tank overlap.
// An arc has no meaning on a top-down grid — the classic power-up sits on the field until driven over (KISS — no
// physics, just a sensor overlap).
//
// DECOUPLING (D1): the pool knows NOTHING about the economy — it only places/pulses/recycles rectangles tagged
// with a `kind`. GameScene wires ONE overlap (each player.collider × the pool group) and the CALLBACK reads
// `rect.pu.kind` to resolve the effect (the scene's _applyPowerUp switch), then release()s. So the six effects
// live in ONE scene switch (SOLID — the pool is a placement device, the scene is the economy). The pool
// PERSISTS within a stage (it is run-scoped, beside BulletPool); live pickups are released on a stage rebuild.
//
// release() only DISABLES a body (safe inside an Arcade overlap step — the F3/F4 footgun discipline): the scene
// calls it from the player×pickup overlap callback, so it must NOT destroy a body there (D10).

const POWERUP_SIZE = 40 // px — a chunky grid-aligned power-up square (programmer-art primitive — AC11).
const POWERUP_DEPTH = 45 // above the terrain + tanks (so the drop is always visible), below the trees overdraw.
const PULSE_HZ = 4 // the classic blink cadence — ~4 Hz between the resting fill and a brighter pulse.

// Per-pickup mutable state stored on the rect (mutated on acquire — never re-allocated → no per-pickup GC).
interface PowerUpState {
  active: boolean
  kind: PowerUpKind | null
  color: number // the kind's resting fill (the pulse alternates this with a brightened tint).
}

// A pool rect carries its state on a `pu` property (parallels BulletPool's `bx` / the reference's `pk`). EXPORTED
// so GameScene's overlap callback types the struck pickup + reads `rect.pu.kind` to resolve the effect.
export type PowerUpRect = Phaser.GameObjects.Rectangle & { pu: PowerUpState }

export class PowerUpPool {
  private scene: Phaser.Scene
  group: Phaser.Physics.Arcade.Group
  private _items: PowerUpRect[]

  // size: the pool high-water mark — a small handful. Drops are sparse (only a red carrier's death — CARRIER_RATE
  // of ~20 enemies/stage) and collected fast, so a handful never exhausts in normal play; recycling the oldest on
  // exhaustion is cosmetic-only (a stale drop vanishes), never a leak (the reference's PickupPool note).
  constructor(scene: Phaser.Scene, size = 8) {
    this.scene = scene
    // The overlap group GameScene registers against each player collider. NO gravity (top-down — D2): members are
    // STATIC sensors (immovable, overlap-only — never separated), parked + disabled until acquired.
    this.group = scene.physics.add.group({ allowGravity: false })

    this._items = []
    for (let i = 0; i < size; i++) {
      const rect = scene.add
        .rectangle(0, 0, POWERUP_SIZE, POWERUP_SIZE, 0xffffff)
        .setVisible(false)
        .setDepth(POWERUP_DEPTH) as PowerUpRect
      this.group.add(rect)
      const body = rect.body as Phaser.Physics.Arcade.Body
      body.setAllowGravity(false)
      body.setImmovable(true) // a sensor that never gets pushed by the overlapping tank (overlap-only).
      body.setSize(POWERUP_SIZE, POWERUP_SIZE, true)
      rect.pu = { active: false, kind: null, color: 0xffffff } // per-pickup state, mutated on acquire (no GC).
      this._disable(rect)
      this._items.push(rect)
    }
  }

  // ── acquire(x, y, kind) (D1/D2, AC1) ── place a power-up at the drop window-center (x,y) grid-aligned, tag it
  // with its kind + the kind's resting colour, enable its sensor body, and show it. Returns the rect (or null is
  // impossible — pool exhaustion recycles the oldest below so a drop is never lost). NO arc/velocity (D2 — static).
  acquire(x: number, y: number, kind: PowerUpKind): PowerUpRect {
    let rect = this._items.find((r) => !r.pu.active)
    if (!rect) {
      // Pool full: recycle the first (oldest-ish) — cosmetic loss only, never a leak (the reference's stance).
      rect = this._items[0]
      this._disable(rect)
    }

    const color = POWERUP_BY_ID[kind]?.color ?? 0xffffff
    const body = rect.body as Phaser.Physics.Arcade.Body
    body.reset(x, y) // snap the collider + center the body at the drop window-center (no residual velocity).
    body.enable = true
    rect.setPosition(x, y).setFillStyle(color).setVisible(true)

    const pu = rect.pu
    pu.active = true
    pu.kind = kind
    pu.color = color
    return rect
  }

  // ── tick() (D2) ── pulse every LIVE pickup's fill between its resting colour and a brightened tint (the classic
  // Battle City blink) off the scene clock. Purely cosmetic — the static body never moves, so there is no
  // body→rect position sync to do (the reference's PickupPool ticks the gravity-settled body; a top-down static
  // pickup has none). KISS — a fill swap on a ~PULSE_HZ beat. No GameObject is created/destroyed per tick.
  tick(): void {
    const pulseOn = Math.floor(this.scene.time.now / (1000 / PULSE_HZ / 2)) % 2 === 0
    for (const rect of this._items) {
      if (!rect.pu.active) continue
      rect.setFillStyle(pulseOn ? rect.pu.color : 0xffffff) // alternate the kind fill with a bright white pulse.
    }
  }

  // Release a collected pickup back into the pool (the scene calls this from the overlap callback — release()
  // only DISABLES the body, safe inside the Arcade step; the footgun discipline — D10/AC10).
  release(rect: PowerUpRect): void {
    if (rect && rect.pu.active) this._disable(rect)
  }

  // Release ALL live pickups (a stage rebuild teardown — power-ups don't carry across stages, AC10).
  releaseAll(): void {
    for (const rect of this._items) if (rect.pu.active) this._disable(rect)
  }

  // Park + disable a pickup (the idle pool state). Clears the kind + parks the body off-screen so a stale overlap
  // can't match. Never DESTROYS the body (a teardown destroys the whole scene's group via Phaser; the pool reuses).
  private _disable(rect: PowerUpRect): void {
    rect.pu.active = false
    rect.pu.kind = null
    const body = rect.body as Phaser.Physics.Arcade.Body
    body.enable = false
    body.reset(-1000, -1000)
    rect.setVisible(false)
  }
}
