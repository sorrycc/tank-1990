import type Phaser from 'phaser'
import { ParticlePool } from './ParticlePool.js'

// ── Juice façade (F3 Combat & terrain §5.2, Decision D9, AC7) ──
// Phaser-COUPLED (owns the pool + drives the camera) — NEVER imported by the headless verifier (AC11).
// ONE call site per impact: GameScene's collision resolution calls `effects.explosion(x, y, opts)` and gets
// a pooled spark burst + a small camera shake. This is the single juice façade (SOLID): the hit sites never
// touch the pool / camera directly. Mirrors the reference's effects/Effects.ts role — but TRIMMED to a
// bullet game: NO floating damage numbers, NO hit-stop request, NO status/parry machinery (the reference's
// are for a melee brawler with crits + DoT; F3 has none — YAGNI, D9). Just sparks + shake.
//
// dt (D9/D10): tick() forwards the REAL dt to the pool — the impact "pops" even if the later clock power-up
// freezes the WORLD (the freeze stops gameplay, never the FX). GameScene passes the real dt (D10).

const SPARK_COLOR = 0xffe066 // warm-yellow impact spark (programmer-art primitive — AC11).

// A small bullet-impact burst (brick/steel/bullet meet) vs. a BIG tank/base kill burst — count + speed +
// shake all scale up on `big` so a kill crunches harder than a chip (the reference's strength scaling, KISS).
const IMPACT_COUNT = 8 // sparks on a small terrain/bullet impact.
const IMPACT_SPEED = 220 // px/s — small-burst spark speed.
const KILL_COUNT = 20 // sparks on a tank/base kill (a fuller pop).
const KILL_SPEED = 320 // px/s — kill-burst spark speed.
const SHAKE_MS = 60 // ms — base camera shake on an impact.
const SHAKE_INTENSITY = 0.003 // base shake intensity (fraction of viewport).
const KILL_SHAKE_MULT = 2.2 // a kill shakes harder than a chip.

export class Effects {
  private scene: Phaser.Scene
  private pool: ParticlePool

  // scene: the GameScene (owns the camera the shake drives + the pool's GameObjects).
  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.pool = new ParticlePool(scene)
  }

  // ── The single impact call (AC7). (x,y) = impact point. opts.big → a fuller burst + stronger shake for a
  // tank/base KILL vs. a small bullet/terrain chip. NO numbers / hit-stop / status (YAGNI — D9). ──
  explosion(x: number, y: number, { big = false }: { big?: boolean } = {}): void {
    this.pool.spawnSparks(x, y, {
      count: big ? KILL_COUNT : IMPACT_COUNT,
      color: SPARK_COLOR,
      speed: big ? KILL_SPEED : IMPACT_SPEED,
    })
    // Phaser applies the shake framerate-aware. A kill shakes harder than a chip (the strength cue).
    this.scene.cameras.main.shake(SHAKE_MS, SHAKE_INTENSITY * (big ? KILL_SHAKE_MULT : 1))
  }

  // ── scorePopup(x, y, value) (F7 §5.4, D5, AC5 — the kill JUICE) ── a floating "+N" SCORE popup at a tank/boss
  // KILL, reusing the pooled floating-number primitive. Trimmed from the reference's hit(): NO damage/crit/
  // hit-stop (Tank 1990 banks SCORE, not damage — YAGNI), NO shake here (the kill's explosion({big}) already
  // shook). Just the number — gold (the HUD's '#feca57'), floated a touch ABOVE the kill center so it reads over
  // the burst. ONE call site per kill (GameScene._onEnemyKilled); brick chips / bullet cancels do NOT call it (AC5).
  scorePopup(x: number, y: number, value: number): void {
    this.pool.spawnNumber(x, y - 18, `+${value}`, { color: '#feca57' })
  }

  // Forward the per-frame tick to the pool. REAL dt (the freeze must not pause the pop — D9/D10).
  tick(dt: number): void {
    this.pool.tick(dt)
  }
}
