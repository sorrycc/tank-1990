import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT } from './config/constants.js'
import { BootScene } from './scenes/BootScene.js'
import { TitleScene } from './scenes/TitleScene.js'
import { HubScene } from './scenes/HubScene.js'
import { GameScene } from './scenes/GameScene.js'
import { HUDScene } from './scenes/HUDScene.js'
import { GameOverScene } from './scenes/GameOverScene.js'
import { SettingsScene } from './scenes/SettingsScene.js'
import { setLocale, detectLocale } from './i18n/index.js'
import { loadSettings, saveSettings, hasStoredSettings } from './util/settings.js'

// ── Single boot site (F0 scaffold §5.3, Decision 1/2/3, AC4/AC5/AC6) ──
// Builds ONE Phaser.Game config and registers all SIX scenes. The scene registration ORDER
// matters: the first entry (Boot) auto-starts (AC6); every other scene is inert until explicitly
// started via a transition, so the world/HUD never double-runs. There is NO Victory scene
// (Decision 2) — Tank 1990 is ENDLESS: a run ends only on eagle-death / lives spent → GameOver.
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, // WebGL with a Canvas fallback.

  // Mount into #game (index.html). Phaser appends its <canvas> here.
  parent: 'game',

  // ── Fixed design resolution + FIT letterboxing (Decision 1, AC4) ──
  // The world is a CONSTANT 1280×720 coordinate system; Scale.FIT scales that to the viewport
  // preserving aspect (letterbox bars where needed) and CENTER_BOTH centers it. A stable world is
  // what the centered 13×13 playfield, the seeded stage generator, and tile math (later phases) need.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
  },

  // ── Physics: Arcade enabled, gravity NOT set (top-down, Decision 3, AC5) ──
  // Battle City is TOP-DOWN — tanks move on a grid, bullets travel straight, nothing falls. Arcade is
  // available to any scene that opts bodies in later (GameScene), but NO `gravity` key is set here, so
  // the menu/overlay scenes never run a gravity world (SOLID — per-scene concerns stay isolated).
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },

  backgroundColor: '#0b0e14', // Dark slate so primitive rectangles read clearly.

  scene: [BootScene, TitleScene, HubScene, GameScene, HUDScene, GameOverScene, SettingsScene],
}

const game = new Phaser.Game(config)

// ── Apply the persisted player preferences ONCE at boot (F-settings §5.3, D2/D4, AC2/AC3) ── AFTER building the
// game (so `game.sound` exists) but BEFORE the first scene renders chrome (the existing locale boot-order
// discipline). loadSettings() reads + clamps the persisted blob (never throws — it inherits save.ts's try/catch).
const settings = loadSettings()
// D4 — honor today's browser auto-detect on a TRULY fresh save (no stored blob yet) so a zh browser still opens in
// Chinese for a new player; once a settings blob exists, use the STORED locale (the sticky, runtime-switchable
// choice). On a fresh save we then saveSettings the detected locale ONCE so it becomes the persisted default.
const fresh = !hasStoredSettings()
const locale = fresh ? detectLocale() : settings.locale
setLocale(locale)
// D2 — push the master level into Phaser's GLOBAL sound.volume; audio/Sound.ts already multiplies it into every
// synthesized tone (so this single write wires volume end-to-end — no per-sound plumbing). 1 by default = unchanged.
game.sound.volume = settings.volume
if (fresh) saveSettings({ ...settings, locale }) // seed the detected locale into the persisted default (D4).

// DEV-ONLY debug handle (stripped from the production build — Vite tree-shakes the `import.meta.env.DEV`
// branch out of `npm run build`). Exposes the live game on window so a dev/headless smoke test can inspect
// the active scene without any production coupling. NEVER read by game code. The inline `ImportMeta` cast
// is copied VERBATIM from the reference (Decision 11): under strict `tsc --noEmit` with no `vite/client`
// reference, a bare `import.meta.env.DEV` would not typecheck (AC2 would go red); the cast widens
// ImportMeta ONLY at this one call site.
if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env && (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env!.DEV) {
  ;(window as Window & { __game?: Phaser.Game }).__game = game
}
