import Phaser from 'phaser'
import { UI_FONT } from '../config/constants.js'

// ── Pooled spark + floating-number FX (F3 Combat & terrain §5.2 + F7 Rich playability §5.4, Decisions D9/D5, AC7/AC5) ──
// Phaser-COUPLED — owns GameObjects — so (like the read-only `dead-cell` reference's
// effects/ParticlePool.ts) it is NEVER imported by scripts/verify-gen.mjs (the pure/coupled split, AC11).
// A TRIMMED port of the reference's pool: it keeps the proven SHAPE — a FIXED pool of small spark
// rectangles pre-created ONCE in the constructor, flat parallel Float32Array state (no per-spark object in
// the hot path), a rotating free-slot cursor, a REAL-dt tick (gravity arc + exponential drag, scale/alpha =
// life ratio). F3 DROPPED the reference's floating-number Text pool (no damage numbers — YAGNI); F7 ADDS IT
// BACK, trimmed, repurposed as a SCORE popup (the "+N" a kill banks — D5/AC5): a small FIXED pool of Text that
// rises + fades over a short lifetime, ported from the reference's spawnNumber but with a fixed gold colour
// (no crit colours — Tank 1990 has none). ZERO per-pop allocation after warm-up (AC7) — setText is the one
// canvas redraw, only on (re)spawn.
//
// dt (Decision D9/D10): this ticks on REAL dt — the impact "pops" (and the score "+N" rises) even if the world
// were FROZEN by the clock power-up / a pause (the freeze stops the WORLD, never the FX). GameScene passes the real dt.

const SPARK_GRAVITY = 900 // px/s² — sparks arc down so the burst reads as debris (copied from the reference).
const SPARK_DRAG = 2.4 // 1/s — exponential velocity decay so sparks slow as they fade.
const NUMBER_RISE = 70 // px/s — floating SCORE numbers drift UP (F7 D5 — the reference's value).
const NUMBER_LIFE = 0.7 // s — how long a score number lives before returning to the pool (F7 D5).

// F8 (D1/D2/D4, AC1) — the staged expanding BLOOM: a bright square that GROWS from a small flash to a peak +
// fades (the classic multi-frame explosion), OR — with `contract` — starts BIG + faint and CONTRACTS toward a
// point (the spawn-in materialize cue). The base rect is BLOOM_BASE px; we SCALE it (no per-frame setSize
// geometry regen — the spark pool's note). Defaults sized for a small chip; Effects scales `big` / passes the
// shield's peak+life. Same flat-Float32Array + rotating-cursor + REAL-dt discipline as the spark pool (D1).
const BLOOM_BASE = 8 // px — the bloom rect's base size (scaled to the chosen peak).
const BLOOM_LIFE = 0.25 // s — a small (chip) bloom's lifetime (the classic flash→bloom→fade beat).
const BLOOM_PEAK = 26 // px — a small bloom's peak width (the square at full expansion).
const BLOOM_BIG_LIFE = 0.4 // s — a `big` (tank/base kill) bloom lives a touch longer.
const BLOOM_BIG_PEAK = 56 // px — a `big` bloom's peak width (a fuller crunch).
const BLOOM_COLOR = 0xfff3b0 // warm-white kill flash (programmer-art primitive — distinct from the spark yellow).

// A pooled floating-number's lifetime state + the Text it drives (F7 D5 — the reference's NumberText shape).
type NumberFx = { active: boolean; life: number; maxLife: number }
type NumberText = Phaser.GameObjects.Text & { fx: NumberFx }

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
  // F7 (D5) — the floating SCORE-number pool (a small fixed pool of reused Text; canvas redraw only on spawn).
  private numberCap: number
  private _numbers: NumberText[]
  private _nNext: number
  // F8 (D1/AC1) — the staged BLOOM pool: a small fixed pool of reused rects with flat parallel lifetime state
  // (no per-bloom object in the hot path), a rotating cursor, advanced on REAL dt — the spark pool's discipline.
  private bloomCap: number
  private _blooms: Phaser.GameObjects.Rectangle[]
  private _bx: Float32Array
  private _by: Float32Array
  private _blife: Float32Array
  private _bmax: Float32Array
  private _bpeak: Float32Array // peak width (px) the rect grows to / contracts from.
  private _bcontract: Uint8Array // 1 = inward spawn-shield curve, 0 = outward kill bloom (D2/D4).
  private _bactive: boolean[]
  private _bNext: number

  // scene: the GameScene. sparkCap/numberCap/bloomCap: pool high-water (sized for the worst-case concurrent
  // on-screen bursts/pops/blooms; if exhausted the rotating cursor recycles the oldest so we NEVER allocate
  // mid-combat — AC7). bloomCap covers one bloom per kill + a few chips + the spawn shields, concurrently.
  constructor(
    scene: Phaser.Scene,
    { sparkCap = 96, numberCap = 16, bloomCap = 24 }: { sparkCap?: number; numberCap?: number; bloomCap?: number } = {},
  ) {
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

    // ── F7 (D5/AC5) — the floating SCORE-number pool ── reused Text objects (the canvas redraw — setText — is
    // the ONLY expensive call and it happens once per pop, never per frame). Programmer-art TEXT only (no asset,
    // AC5). Depth ABOVE the sparks so a "+N" reads over the kill burst. Parked invisible until acquired.
    this.numberCap = numberCap
    this._numbers = []
    for (let i = 0; i < numberCap; i++) {
      const t = scene.add
        .text(0, 0, '', { fontFamily: UI_FONT, fontSize: '22px', color: '#feca57', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setVisible(false)
        .setDepth(60) as NumberText
      t.fx = { active: false, life: 0, maxLife: NUMBER_LIFE }
      this._numbers.push(t)
    }
    this._nNext = 0

    // ── F8 (D1/D2/D4, AC1) — the staged BLOOM pool ── flat parallel lifetime state (no per-bloom object in the
    // hot path), built ONCE here. Depth BETWEEN the sparks (50) and the numbers (60) so the flash reads OVER the
    // debris but UNDER a "+N". A white BLOOM_BASE px rect recoloured/rescaled per bloom (programmer-art, AC1).
    this.bloomCap = bloomCap
    this._blooms = []
    this._bx = new Float32Array(bloomCap)
    this._by = new Float32Array(bloomCap)
    this._blife = new Float32Array(bloomCap)
    this._bmax = new Float32Array(bloomCap)
    this._bpeak = new Float32Array(bloomCap)
    this._bcontract = new Uint8Array(bloomCap)
    this._bactive = new Array(bloomCap).fill(false)
    this._bNext = 0
    for (let i = 0; i < bloomCap; i++) {
      const r = scene.add.rectangle(0, 0, BLOOM_BASE, BLOOM_BASE, 0xffffff).setVisible(false).setDepth(55)
      this._blooms.push(r)
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

  // ── spawnNumber(x, y, value, opts?) (F7 §5.4, D5, AC5 — ported, trimmed) ── pop a floating SCORE "+N" at
  // (x,y) from the number pool: set its text + colour (a fixed gold by default — no crit colours, Tank 1990 has
  // none), give it a short rise+fade lifetime the existing tick() advances. The Effects.scorePopup façade calls
  // this at a kill site. A tiny horizontal jitter so stacked pops don't perfectly overlap (the reference's touch).
  spawnNumber(
    x: number,
    y: number,
    value: number | string,
    { color = '#feca57', scale = 1 }: { color?: string; scale?: number } = {},
  ): void {
    const slot = this._acquireNumber()
    const t = this._numbers[slot]
    t.setText(String(value)) // the ONE canvas redraw — only on spawn (no per-frame setText, AC7).
    t.setColor(color)
    t.setFontSize(Math.round(22 * scale))
    t.setPosition(x + (Math.random() - 0.5) * 12, y)
    t.setAlpha(1)
    t.setScale(1)
    t.setVisible(true)
    t.setActive(true)
    t.fx.active = true
    t.fx.life = NUMBER_LIFE
    t.fx.maxLife = NUMBER_LIFE
  }

  // ── spawnBloom(x, y, opts?) (F8 §5.2, D1/D2/D4, AC1) ── pop a staged expanding BLOOM at (x,y) from the bloom
  // pool: a bright square the existing tick() GROWS from a small flash to `peak` + fades over `life` (the classic
  // multi-frame explosion). `big` (a tank/base kill) scales the default peak + life up. `contract` flips the
  // curve INWARD — starts big + faint and contracts toward the point — for the spawn-in materialize cue (D4).
  // A NO-ALLOC reuse of pooled slots (the spark pool's discipline — AC7).
  spawnBloom(
    x: number,
    y: number,
    {
      big = false,
      contract = false,
      color = BLOOM_COLOR,
      peak = big ? BLOOM_BIG_PEAK : BLOOM_PEAK,
      life = big ? BLOOM_BIG_LIFE : BLOOM_LIFE,
    }: { big?: boolean; contract?: boolean; color?: number; peak?: number; life?: number } = {},
  ): void {
    const slot = this._acquireBloom()
    this._bx[slot] = x
    this._by[slot] = y
    this._blife[slot] = life
    this._bmax[slot] = life
    this._bpeak[slot] = peak
    this._bcontract[slot] = contract ? 1 : 0
    const r = this._blooms[slot]
    r.setFillStyle(color)
    r.setPosition(x, y)
    // Seed the first frame's scale so there's no one-frame flash at the wrong size before tick() runs.
    r.setScale((contract ? peak : BLOOM_BASE) / BLOOM_BASE)
    r.setAlpha(contract ? 0.6 : 1)
    r.setVisible(true)
    r.setActive(true)
  }

  // ── Advance every live spark + floating number + bloom on REAL dt (D9/D10/F7-D5/F8-D6, AC7/AC5/AC1); return
  // finished ones to the pool. Sparks: integrate velocity (gravity + exponential drag), shrink + fade by the life
  // ratio. Numbers: rise + fade by the life ratio. Blooms: grow (or contract) + fade by the life ratio. NO
  // steady-state allocation. ──
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

    // F7 (D5/AC5) — the floating SCORE numbers: rise + fade by the life ratio, a tiny pop-then-settle scale for
    // punch (the reference's number tick, trimmed). REAL dt — a pause/clock freeze never pauses the pop.
    for (const t of this._numbers) {
      const fx = t.fx
      if (!fx.active) continue
      fx.life -= dt
      if (fx.life <= 0) {
        fx.active = false
        t.setVisible(false).setActive(false)
        continue
      }
      const k = fx.life / fx.maxLife // 1 → 0
      t.y -= NUMBER_RISE * dt
      t.setAlpha(k)
      t.setScale(0.9 + 0.25 * k) // starts a touch big, eases down as it fades.
    }

    // F8 (D2/D4/D6, AC1) — the staged blooms: an OUTWARD kill bloom grows from a small flash to `peak` then fades;
    // an INWARD spawn shield starts at `peak` and contracts toward the point as it fades. `p` is the life PROGRESS
    // (0 → 1) — a square-root ease so the expansion punches early then settles (the classic flash). REAL dt (D6).
    for (let i = 0; i < this.bloomCap; i++) {
      if (!this._bactive[i]) continue
      this._blife[i] -= dt
      const r = this._blooms[i]
      if (this._blife[i] <= 0) {
        this._bactive[i] = false
        r.setVisible(false).setActive(false)
        continue
      }
      const p = 1 - this._blife[i] / this._bmax[i] // 0 → 1 over the life.
      const ease = Math.sqrt(p) // punch early, settle late.
      const peakScale = this._bpeak[i] / BLOOM_BASE
      if (this._bcontract[i]) {
        r.setScale(peakScale * (1 - ease)) // contract toward the point (the materialize-in cue).
        r.setAlpha(0.6 * (1 - p)) // fade out as it closes.
      } else {
        r.setScale(peakScale * ease) // grow from the flash to the peak.
        r.setAlpha(1 - p) // fade out as it expands.
      }
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

  // Acquire a free score-number slot (or recycle the rotating cursor — NEVER allocates, AC7). The reference's
  // _acquireNumber: scan from the cursor for a free slot; if the pool is full recycle the cursor slot (the
  // oldest-ish pop is cut short — cosmetic loss only, never a leak).
  private _acquireNumber(): number {
    for (let n = 0; n < this.numberCap; n++) {
      const i = (this._nNext + n) % this.numberCap
      if (!this._numbers[i].fx.active) {
        this._nNext = (i + 1) % this.numberCap
        return i
      }
    }
    const i = this._nNext
    this._nNext = (i + 1) % this.numberCap
    return i
  }

  // Acquire a free bloom slot (or recycle the oldest via the rotating cursor — NEVER allocates, AC7). The same
  // scan-from-cursor-then-recycle shape as the spark/number pools (DRY). A recycled bloom is cut short (cosmetic).
  private _acquireBloom(): number {
    for (let n = 0; n < this.bloomCap; n++) {
      const i = (this._bNext + n) % this.bloomCap
      if (!this._bactive[i]) {
        this._bNext = (i + 1) % this.bloomCap
        this._bactive[i] = true
        return i
      }
    }
    const i = this._bNext
    this._bNext = (i + 1) % this.bloomCap
    this._bactive[i] = true
    return i
  }
}
