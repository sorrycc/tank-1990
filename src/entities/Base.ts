import type Phaser from 'phaser'
import { TILE_SIZE } from '../config/constants.js'

// ── Base entity — the eagle (F3 Combat & terrain §5.2, Decision D3/D6, AC6/AC10) ──
// Phaser-COUPLED (owns a GameObject) — NEVER imported by the headless verifier (AC11). A plain entity that
// holds ONLY the eagle's VISUAL + a one-shot destroyed guard + the scene's run-over callback. It deliberately
// does NOT create its own collision body: F2's TileMap ALREADY emitted a tank-blocking static body for the
// TILE.BASE cell into `solidBodies` (tagged tileKind=TILE.BASE). The scene back-references THAT existing body
// to this Base (`solidRect.baseRef = base`), and the SINGLE bullet×solidBodies terrain callback resolves a
// tileKind===TILE.BASE hit to `base.onHit()` (D3). So one body does double duty — tanks still can't drive
// onto the eagle (it's in solidBodies, which the F2 tank×solidBodies collider blocks) AND a bullet reaching it
// triggers the eagle-loss. No second base body, no separate bullet×base overlap (the reviewer's F2-integration
// fix — a duplicate scene body would be UNREACHABLE behind the existing solidBodies BASE body).
//
// THE ONE-SHOT GUARD (D6, AC6/AC10): `onHit()` flips `destroyed` EXACTLY once (mirroring the reference's
// gameOver/broken guards), FLASHES the eagle visual white→rubble (F9 — a distinct loss beat), and fires
// `onDestroyed` (which the scene wires to its guarded _triggerGameOver). A multi-frame overlap / a same-frame second bullet can't double-fire —
// the entity guard + the scene's gameOver guard funnel the run-over to a single transition. The base destroys
// NO body (the rubble stays in solidBodies as tank-blocking — the classic), so the scene needs no defer here.

const EAGLE_COLOR = 0xe8d44d // the eagle (programmer-art primitive — a bright marker, AC11).
const RUBBLE_COLOR = 0x6b3f2a // destroyed: a dull brown rubble swap (the loss cue).
const EAGLE_SIZE = TILE_SIZE - 8 // px — the eagle rect, a hair inset inside its BASE tile so the wall reads.
const FLASH_COLOR = 0xffffff // the destroy FLASH peak — the eagle blows WHITE before settling to rubble (F9 §5.2, D1/D2).
const FLASH_MS = 320 // ms — the white→rubble fade so the loss reads as a blast, not a flat colour swap.

export class Base {
  scene: Phaser.Scene
  rect: Phaser.GameObjects.Rectangle // the eagle VISUAL; flashes white→rubble on destroy.
  destroyed: boolean // one-shot guard (D6) — onHit flips it exactly once.
  onDestroyed: (() => void) | null // the scene wires its run-over edge (SOLID — the base never reaches in).
  private _flashTween: Phaser.Tweens.Tween | null // F9 (D2) — the tracked white→rubble fade; killed in destroy().

  // (x,y) = the BASE tile's window-center (F2 windowCenter, D13) — the same coord the TileMap drew its body at.
  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene
    this.destroyed = false
    this.onDestroyed = null
    this._flashTween = null
    // Drawn ABOVE the terrain body (which sits at DEPTH_TERRAIN = -5) but below the tanks (depth 0) so a tank
    // can't be hidden behind it. Programmer-art only (AC11).
    this.rect = scene.add.rectangle(x, y, EAGLE_SIZE, EAGLE_SIZE, EAGLE_COLOR).setDepth(-4)
  }

  // ── isHittable() (D6, AC6) ── false once destroyed, so a second bullet reaching the rubble is a no-op (the
  // scene's terrain callback just despawns it). Mirrors the reference's isHittable() victim filter (DRY).
  isHittable(): boolean {
    return !this.destroyed
  }

  // ── onHit() (D6, AC6/AC10 — the ONE-SHOT loss edge) ── flip `destroyed` EXACTLY once (the guard), FLASH the
  // visual white→rubble, and fire `onDestroyed` (the scene's guarded run-over). Destroys NO body — the eagle's
  // rubble stays tank-blocking in solidBodies (the classic), so no delayedCall is needed here (D3/AC10).
  // F9 (§5.2, D1/D2, AC1): the loss is the run's most dramatic beat, so instead of a flat colour swap the eagle
  // blows WHITE then fades to RUBBLE_COLOR over a short beat via a TRACKED scene tween (killed in destroy() so a
  // teardown mid-flash can't tick a destroyed rect). The blast + camera punch are the scene's TILE.BASE branch (D3/D4).
  onHit(): void {
    if (this.destroyed) return // one-shot guard — a multi-frame overlap / a second bullet can't double-fire.
    this.destroyed = true
    this.rect.setFillStyle(FLASH_COLOR) // the flash peak: the eagle blows white before settling to rubble.
    // Tween the fill white→rubble (an RGB lerp on a 0→1 counter). Tracked so destroy() can kill it (D2/AC4).
    this._flashTween = this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: FLASH_MS,
      onUpdate: (tw) => this.rect.setFillStyle(lerpColor(FLASH_COLOR, RUBBLE_COLOR, tw.getValue() ?? 1)),
      onComplete: () => this.rect.setFillStyle(RUBBLE_COLOR), // settle exactly on rubble (no float drift).
    })
    this.onDestroyed?.() // → the scene's _triggerGameOver (itself gameOver-guarded — the run-over fires once).
  }

  // ── destroy() (F9 §5.2, D2/AC4) ── kill the tracked flash tween (idempotent — null/already-stopped is a no-op)
  // BEFORE destroying the rect, so a stage teardown DURING the flash can't tick the tween onUpdate against a dead
  // GameObject (Phaser's GameObject.destroy() does NOT auto-stop tweens). The scene's _teardownStage calls THIS
  // instead of base.rect.destroy() — the owner kills its own tween (the project's teardown discipline).
  destroy(): void {
    this._flashTween?.stop()
    this._flashTween = null
    this.rect.destroy()
  }
}

// Lerp between two 0xRRGGBB colours per channel (t in [0,1]). Local — no new util for a single call site (KISS).
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
