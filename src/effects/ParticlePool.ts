import Phaser from 'phaser'

// ── Pooled spark FX (F3 Combat & terrain §5.2, Decision D9, AC7) ──
// Phaser-COUPLED — owns GameObjects — so (like the read-only `dead-cell` reference's
// effects/ParticlePool.ts) it is NEVER imported by scripts/verify-gen.mjs (the pure/coupled split, AC11).
// A TRIMMED port of the reference's pool: it keeps the proven SHAPE — a FIXED pool of small spark
// rectangles pre-created ONCE in the constructor, flat parallel Float32Array state (no per-spark object in
// the hot path), a rotating free-slot cursor, a REAL-dt tick (gravity arc + exponential drag, scale/alpha =
// life ratio) — but DROPS the reference's floating damage-number Text pool (F3 shows no damage numbers —
// YAGNI, D9). ZERO per-burst allocation after warm-up, so sustained firing shows no GC stutter (AC7).
//
// dt (Decision D9/D10): this ticks on REAL dt — the impact "pops" even if the world were FROZEN by the
// later clock power-up (the freeze stops the WORLD, never the FX). GameScene passes the real dt (D10).

const SPARK_GRAVITY = 900 // px/s² — sparks arc down so the burst reads as debris (copied from the reference).
const SPARK_DRAG = 2.4 // 1/s — exponential velocity decay so sparks slow as they fade.

export class ParticlePool {
  private scene: Phaser.Scene
  private sparkCap: number
  private _sparks: Phaser.GameObjects.Rectangle[]
  private _sx: Float32Array
  private _sy: Float32Array
  private _svx: Float32Array
  private _svy: Float32Array
  private _slife: Float32Array
  private _smax: Float32Array
  private _sactive: boolean[]
  private _sscale: Float32Array
  private _sNext: number

  // scene: the GameScene. sparkCap: pool high-water (sized for the worst-case concurrent on-screen bursts;
  // if exhausted the rotating cursor recycles the oldest so we NEVER allocate mid-combat — AC7).
  constructor(scene: Phaser.Scene, { sparkCap = 96 }: { sparkCap?: number } = {}) {
    this.scene = scene

    // ── Spark pool ── flat parallel state (no per-spark object in the hot path), members built ONCE here.
    this.sparkCap = sparkCap
    this._sparks = []
    this._sx = new Float32Array(sparkCap)
    this._sy = new Float32Array(sparkCap)
    this._svx = new Float32Array(sparkCap)
    this._svy = new Float32Array(sparkCap)
    this._slife = new Float32Array(sparkCap)
    this._smax = new Float32Array(sparkCap)
    this._sactive = new Array(sparkCap).fill(false)
    this._sscale = new Float32Array(sparkCap) // spawn scale (base 6px rect → chosen size).
    this._sNext = 0
    for (let i = 0; i < sparkCap; i++) {
      // Programmer-art primitive (AC11): a 6px white rect, recoloured/rescaled per burst. Depth ABOVE tanks
      // so the impact reads over the bodies. Parked invisible until acquired (no per-burst GameObject churn).
      const r = scene.add.rectangle(0, 0, 6, 6, 0xffffff).setVisible(false).setDepth(50)
      this._sparks.push(r)
    }
  }

  // ── Emit a spark burst at (x,y) — a NO-ALLOC reuse of pooled slots (AC7). count + color + speed scale
  // with the impact strength (Effects sets them — D9). Each spark gets a randomized velocity in a cone + a
  // short life, mirroring the reference's discipline. ──
  spawnSparks(
    x: number,
    y: number,
    { count = 8, color = 0xffe066, speed = 260 }: { count?: number; color?: number; speed?: number } = {},
  ): void {
    for (let k = 0; k < count; k++) {
      const slot = this._acquireSpark()
      const angle = Math.random() * Math.PI * 2
      const s = speed * (0.4 + Math.random() * 0.8)
      const life = 0.18 + Math.random() * 0.22
      const size = 3 + Math.random() * 4
      this._sx[slot] = x
      this._sy[slot] = y
      this._svx[slot] = Math.cos(angle) * s
      this._svy[slot] = Math.sin(angle) * s - speed * 0.3 // bias slightly UP so it sprays.
      this._slife[slot] = life
      this._smax[slot] = life
      // Store the spawn SCALE (base rect is 6px; scale to the chosen size). We shrink via setScale in tick —
      // NOT setSize — so we never regenerate the rect geometry per frame (cheaper, the reference's note).
      this._sscale[slot] = size / 6
      const r = this._sparks[slot]
      r.setFillStyle(color)
      r.setScale(this._sscale[slot])
      r.setPosition(x, y)
      r.setAlpha(1)
      r.setVisible(true)
      r.setActive(true)
    }
  }

  // ── Advance every live spark on REAL dt (D9/D10, AC7); return finished ones to the pool. Integrate
  // velocity (gravity + exponential drag), shrink + fade by the life ratio. NO steady-state allocation. ──
  tick(dt: number): void {
    const drag = Math.exp(-SPARK_DRAG * dt)
    for (let i = 0; i < this.sparkCap; i++) {
      if (!this._sactive[i]) continue
      this._svy[i] += SPARK_GRAVITY * dt
      this._svx[i] *= drag
      this._svy[i] *= drag
      this._sx[i] += this._svx[i] * dt
      this._sy[i] += this._svy[i] * dt
      this._slife[i] -= dt
      const r = this._sparks[i]
      if (this._slife[i] <= 0) {
        this._sactive[i] = false
        r.setVisible(false).setActive(false)
        continue
      }
      const k = this._slife[i] / this._smax[i] // 1 → 0
      r.setPosition(this._sx[i], this._sy[i])
      r.setAlpha(k)
      r.setScale(this._sscale[i] * k) // shrink via scale (no geometry regen).
    }
  }

  // Acquire a free spark slot (or recycle the oldest via the rotating cursor — NEVER allocates, AC7).
  private _acquireSpark(): number {
    for (let n = 0; n < this.sparkCap; n++) {
      const i = (this._sNext + n) % this.sparkCap
      if (!this._sactive[i]) {
        this._sNext = (i + 1) % this.sparkCap
        this._sactive[i] = true
        return i
      }
    }
    // Pool full: recycle the cursor slot (oldest-ish). Cosmetic loss only, never a leak.
    const i = this._sNext
    this._sNext = (i + 1) % this.sparkCap
    this._sactive[i] = true
    return i
  }
}
