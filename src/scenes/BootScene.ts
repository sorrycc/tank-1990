import Phaser from 'phaser'

// ── BootScene (F0 scaffold §5.3, Decision 4, AC6/AC11) ──
// The FIRST registered scene, so it auto-starts. F0 has no assets to load (programmer-art only —
// no network load.* calls, runs offline / from file://, AC11), so Boot does its (currently empty)
// one-time setup and immediately hands off to Title. Later features may bake a few solid-color
// primitive textures here via make.graphics().generateTexture() for reuse (tank/brick/eagle
// sprites); that hook lives in create().
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    // (F1+: bake reusable programmer-art primitive textures here — tanks, terrain, the eagle.)
    this.scene.start('Title')
  }
}
