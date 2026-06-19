import Phaser from 'phaser'

// ── BootScene (F0 scaffold §5.3, Decision 4, AC6/AC11; [start-jingle]) ──
// The FIRST registered scene, so it auto-starts. It preloads the project's ONE bundled asset file —
// the Battle City "Game Start" jingle played at the start of every stage (by GameScene) — then hands
// off to Title. Everything else is programmer-art / synthesized WebAudio (runs offline / from file://, AC11).
// Later features may bake a few solid-color primitive textures here via
// make.graphics().generateTexture() for reuse (tank/brick/eagle sprites); that hook lives in create().
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  // Load the one bundled clip. Relative path (no leading slash) so it resolves under Vite's relative
  // base ('./') in dev, the dist/ build, and from file://. Under a NoAudio sound manager the loader
  // still fetches it harmlessly; nothing plays it there ([start-jingle]).
  preload(): void {
    this.load.audio('startJingle', 'audio/start.mp3')
  }

  create(): void {
    // (F1+: bake reusable programmer-art primitive textures here — tanks, terrain, the eagle.)
    this.scene.start('Title')
  }
}
