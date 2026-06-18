import Phaser from 'phaser'
import { DESIGN_WIDTH, DESIGN_HEIGHT, UI_FONT } from '../config/constants.js'
import { t } from '../i18n/index.js'

// ── GameOverScene (F0 scaffold §5.3 → F5 §5.4, Decision 2/4/D8/D12, AC5/AC7/AC9) ──
// The run-end screen. Tank 1990 is ENDLESS (Decision 2 — there is NO Victory scene): a run ends ONLY
// when the eagle is destroyed OR all lives are spent, and GameScene hands off here. F5 (D8/AC5): this
// scene is DECOUPLED (SOLID, the reference's HUD/registry split) — it reads a run-summary SNAPSHOT from
// scene-start DATA and NEVER reaches into the live GameScene. It DISPLAYS the summary (score / stage
// reached / CURRENCY BANKED / best score / best stage) with primitives + t('...'), then routes to the HUB
// on a key/click so banked currency is immediately spendable (the loop closes — AC7). It does NOT itself
// save — banking is GameScene's job (the single writer under the gameOver guard, D8); this scene only shows.

// The run-summary snapshot GameScene passes as scene-start DATA (D8/AC5). Safe defaults so the scene is
// navigable even if launched bare (e.g. a dev tool / a direct scene.start) — it never reads a missing field.
interface RunSummary {
  score: number
  stage: number // the human stage number reached (stageIndex + 1).
  currencyBanked: number // floor(score · CURRENCY_RATIO) — the amount added to the shared bank this run.
  bestScore: number // the freshly-bumped best (GameScene read it from MetaState after bankRun).
  bestStage: number
}
const DEFAULT_SUMMARY: RunSummary = { score: 0, stage: 0, currencyBanked: 0, bestScore: 0, bestStage: 0 }

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver')
  }

  // Phaser passes scene-start DATA to create(); fall back to the safe defaults if absent (D8/AC5).
  create(data: Partial<RunSummary>): void {
    const summary: RunSummary = { ...DEFAULT_SUMMARY, ...(data || {}) }
    const cx = DESIGN_WIDTH / 2
    const cy = DESIGN_HEIGHT / 2

    // ── Header: red "GAME OVER" (the endless game has no win state — Decision 2). ──
    this.add
      .text(cx, cy - 150, t('over.heading'), {
        fontFamily: UI_FONT,
        fontSize: '72px',
        color: '#e5484d',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)

    // ── Summary block (AC5) — score / stage reached / CURRENCY BANKED / best score / best stage. One centered
    // line per stat (primitives + t('...') only — AC11). The {n} interpolation fills the localised template. ──
    const lines = [
      t('over.score', { n: summary.score }),
      t('over.stage', { n: summary.stage }),
      t('over.banked', { n: summary.currencyBanked }),
      t('over.bestScore', { n: summary.bestScore }),
      t('over.bestStage', { n: summary.bestStage }),
    ]
    const rowH = 40
    const blockTop = cy - 60
    lines.forEach((line, i) => {
      // The CURRENCY BANKED line (index 2) is highlighted (cyan) — it's the meta payoff the run earned.
      const color = i === 2 ? '#4dd0e1' : '#e6edf3'
      this.add
        .text(cx, blockTop + i * rowH, line, { fontFamily: UI_FONT, fontSize: '26px', color })
        .setOrigin(0.5)
    })

    this.add
      .text(cx, blockTop + lines.length * rowH + 36, t('over.continue'), {
        fontFamily: UI_FONT,
        fontSize: '22px',
        color: '#8b949e',
      })
      .setOrigin(0.5)

    // GameOver → HUB (D8/AC7) so banked currency is immediately spendable — the loop closes. `once` so a held
    // key can't double-fire. 'Hub' is a registered scene (main.ts), so the transition is reachable.
    const toHub = () => this.scene.start('Hub')
    this.input.keyboard!.once('keydown-SPACE', toHub)
    this.input.keyboard!.once('keydown-ENTER', toHub)
    this.input.once('pointerdown', toHub)
  }
}
